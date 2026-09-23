import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_IPC, type DesktopBrowserActivity, type DshDesktopAppApi, type DshDesktopStartupApi } from '../src/ipc.ts'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}))
vi.mock('electron', () => electron)

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules() })

it.each(['dsh-app://other/index.html', 'https://shell/startup.html'])('exposes only the carrier marker to %s', async (url) => {
  vi.stubGlobal('location', new URL(url))
  await import('../src/preload-app.ts')
  expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('dshDesktop', { protocolVersion: 1 })
})

it('exposes the embedded-browser face to application documents', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/index.html'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as DshDesktopAppApi
  expect(api.protocolVersion).toBe(1)
  await api.browser.open({ x: 0, y: 0, width: 10, height: 10 }, 'https://example.com')
  await api.browser.navigate('https://example.com/two')
  await api.browser.back()
  await api.browser.forward()
  await api.browser.reload()
  await api.browser.setBounds({ x: 1, y: 2, width: 3, height: 4 })
  await api.browser.state()
  await api.browser.hide()
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
    [DESKTOP_IPC.browserOpen, { x: 0, y: 0, width: 10, height: 10 }, 'https://example.com'],
    [DESKTOP_IPC.browserNavigate, 'https://example.com/two'],
    [DESKTOP_IPC.browserBack], [DESKTOP_IPC.browserForward], [DESKTOP_IPC.browserReload],
    [DESKTOP_IPC.browserSetBounds, { x: 1, y: 2, width: 3, height: 4 }],
    [DESKTOP_IPC.browserGetState], [DESKTOP_IPC.browserHide],
  ])
  const listener = vi.fn()
  const dispose = api.browser.subscribe(listener)
  const handler = electron.ipcRenderer.on.mock.calls[0]?.[1] as (event: unknown, state: unknown) => void
  handler({}, { url: 'https://example.com', title: 'Ex', canGoBack: false, canGoForward: false, loading: false })
  expect(listener).toHaveBeenCalledWith({ url: 'https://example.com', title: 'Ex', canGoBack: false, canGoForward: false, loading: false })
  dispose()
  expect(electron.ipcRenderer.off).toHaveBeenCalledWith(DESKTOP_IPC.browserState, handler)
  expect(api).not.toHaveProperty('plugins')
  expect(api).not.toHaveProperty('backend')
})

it('forwards reveal requests and automation activity, and removes both listeners on unsubscribe', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/index.html'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as DshDesktopAppApi

  const reveal = vi.fn()
  const disposeReveal = api.browser.subscribeReveal(reveal)
  const revealHandler = electron.ipcRenderer.on.mock.calls.find(call => call[0] === DESKTOP_IPC.browserReveal)?.[1] as () => void
  expect(electron.ipcRenderer.on).toHaveBeenCalledWith(DESKTOP_IPC.browserReveal, revealHandler)
  revealHandler()
  expect(reveal).toHaveBeenCalledWith()
  disposeReveal()
  expect(electron.ipcRenderer.off).toHaveBeenCalledWith(DESKTOP_IPC.browserReveal, revealHandler)

  const activity = vi.fn()
  const disposeActivity = api.browser.subscribeActivity(activity)
  const activityHandler = electron.ipcRenderer.on.mock.calls
    .find(call => call[0] === DESKTOP_IPC.browserActivity)?.[1] as (event: unknown, value: DesktopBrowserActivity) => void
  expect(electron.ipcRenderer.on).toHaveBeenCalledWith(DESKTOP_IPC.browserActivity, activityHandler)
  activityHandler({}, { active: true, method: 'Page.navigate', since: 1_700_000_000_000 })
  expect(activity).toHaveBeenCalledWith({ active: true, method: 'Page.navigate', since: 1_700_000_000_000 })
  activityHandler({}, { active: false, method: '', since: 0 })
  expect(activity).toHaveBeenLastCalledWith({ active: false, method: '', since: 0 })
  disposeActivity()
  expect(electron.ipcRenderer.off).toHaveBeenCalledWith(DESKTOP_IPC.browserActivity, activityHandler)
})

it('provides startup controls and a removable state subscription to shell documents', async () => {
  vi.stubGlobal('location', new URL('dsh-app://shell/startup.html'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as DshDesktopStartupApi
  await api.locale()
  await api.backend.status()
  await api.disablePlugins()
  await api.resetConfiguration()
  await api.restart()
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
    [DESKTOP_IPC.localeGet], [DESKTOP_IPC.backendStatus],
    [DESKTOP_IPC.pluginsDisableAll], [DESKTOP_IPC.configurationReset], [DESKTOP_IPC.applicationRestart],
  ])
  const listener = vi.fn()
  const dispose = api.backend.subscribe(listener)
  const handler = electron.ipcRenderer.on.mock.calls[0]?.[1] as (event: unknown, state: unknown) => void
  handler({}, { phase: 'error', message: 'startup failed' })
  expect(listener).toHaveBeenCalledWith({ phase: 'error', message: 'startup failed' })
  dispose()
  expect(electron.ipcRenderer.off).toHaveBeenCalledWith(DESKTOP_IPC.backendState, handler)
  expect(api).not.toHaveProperty('plugins')
})
