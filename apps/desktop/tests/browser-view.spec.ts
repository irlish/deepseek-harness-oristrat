import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_IPC } from '../src/ipc.ts'

/** One fake WebContentsView instance recorded by the electron mock. */
interface FakeView {
  webContents: {
    getURL: ReturnType<typeof vi.fn>
    getTitle: ReturnType<typeof vi.fn>
    isLoading: ReturnType<typeof vi.fn>
    isDestroyed: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
    reload: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
    navigationHistory: {
      canGoBack: ReturnType<typeof vi.fn>
      canGoForward: ReturnType<typeof vi.fn>
      goBack: ReturnType<typeof vi.fn>
      goForward: ReturnType<typeof vi.fn>
    }
  }
  setBounds: ReturnType<typeof vi.fn>
  setBackgroundColor: ReturnType<typeof vi.fn>
}

const electron = vi.hoisted(() => {
  const instances: unknown[] = []
  const makeContents = () => ({
    getURL: vi.fn(() => 'https://example.com/'),
    getTitle: vi.fn(() => 'Example'),
    isLoading: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn(() => Promise.resolve()),
    reload: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    navigationHistory: {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      goBack: vi.fn(),
      goForward: vi.fn(),
    },
  })
  class WebContentsView {
    readonly webContents = makeContents()
    readonly setBounds = vi.fn()
    readonly setBackgroundColor = vi.fn()
    constructor() {
      instances.push(this)
    }
  }
  return { WebContentsView, instances }
})
vi.mock('electron', () => ({ WebContentsView: electron.WebContentsView }))

import { DesktopBrowserViewController, isBrowsableUrl, sanitizeBounds } from '../src/browser-view.ts'

function fakeWindow() {
  return {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn(() => false),
  }
}

type FakeWindow = ReturnType<typeof fakeWindow>

beforeEach(() => {
  electron.instances.length = 0
  vi.clearAllMocks()
})

describe('isBrowsableUrl', () => {
  it('accepts http(s) and refuses every other target', () => {
    expect(isBrowsableUrl('https://example.com')).toBe(true)
    expect(isBrowsableUrl('http://example.com/x?y=1')).toBe(true)
    expect(isBrowsableUrl('file:///etc/passwd')).toBe(false)
    expect(isBrowsableUrl('javascript:alert(1)')).toBe(false)
    expect(isBrowsableUrl('dsh-app://app/index.html')).toBe(false)
    expect(isBrowsableUrl('not a url')).toBe(false)
  })
})

describe('sanitizeBounds', () => {
  it('rounds and clamps finite numbers', () => {
    expect(sanitizeBounds({ x: -3.4, y: 2.6, width: 100.5, height: 4e6 }))
      .toEqual({ x: 0, y: 3, width: 101, height: 100_000 })
  })

  it('refuses malformed payloads', () => {
    expect(sanitizeBounds(null)).toBeUndefined()
    expect(sanitizeBounds('bounds')).toBeUndefined()
    expect(sanitizeBounds({ x: 0, y: 0, width: 10 })).toBeUndefined()
    expect(sanitizeBounds({ x: 0, y: 0, width: Number.NaN, height: 10 })).toBeUndefined()
    expect(sanitizeBounds({ x: 0, y: 0, width: '10', height: 10 })).toBeUndefined()
  })
})

describe('DesktopBrowserViewController', () => {
  let window: FakeWindow
  let controller: DesktopBrowserViewController
  const view = (): FakeView => electron.instances[0] as FakeView

  beforeEach(() => {
    window = fakeWindow()
    controller = new DesktopBrowserViewController(window as never)
  })

  it('attaches, places, loads, and publishes on open', () => {
    controller.open({ x: 8, y: 40, width: 320, height: 480 }, 'https://example.com')
    expect(window.contentView.addChildView).toHaveBeenCalledOnce()
    expect(view().setBounds).toHaveBeenCalledWith({ x: 8, y: 40, width: 320, height: 480 })
    expect(view().webContents.loadURL).toHaveBeenCalledWith('https://example.com')
    expect(window.webContents.send).toHaveBeenCalledWith(DESKTOP_IPC.browserState, {
      url: 'https://example.com/', title: 'Example', canGoBack: false, canGoForward: false, loading: false,
    })
    expect(controller.getState().url).toBe('https://example.com/')
  })

  it('ignores a non-browsable open URL and reuses the attached view', () => {
    controller.open({ x: 0, y: 0, width: 10, height: 10 }, 'javascript:alert(1)')
    controller.open({ x: 1, y: 1, width: 10, height: 10 })
    expect(electron.instances).toHaveLength(1)
    expect(view().webContents.loadURL).not.toHaveBeenCalled()
    expect(window.contentView.addChildView).toHaveBeenCalledTimes(2)
  })

  it('wires the navigation policy at attach time', () => {
    controller.open({ x: 0, y: 0, width: 10, height: 10 })
    const contents = view().webContents
    // Popups never become windows; http(s) targets load in-view.
    const handler = contents.setWindowOpenHandler.mock.calls[0]?.[0] as (details: { url: string }) => { action: string }
    expect(handler({ url: 'https://popup.example' })).toEqual({ action: 'deny' })
    expect(contents.loadURL).toHaveBeenCalledWith('https://popup.example')
    expect(handler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
    expect(contents.loadURL).toHaveBeenCalledTimes(1)
    // will-navigate refuses non-http(s) targets.
    const [channel, listener] = contents.on.mock.calls.find(call => call[0] === 'will-navigate') as [string, (event: { preventDefault: ReturnType<typeof vi.fn> }, target: string) => void]
    expect(channel).toBe('will-navigate')
    const event = { preventDefault: vi.fn() }
    listener(event, 'dsh-app://app/index.html')
    expect(event.preventDefault).toHaveBeenCalled()
    listener({ preventDefault: vi.fn() }, 'https://ok.example')
  })

  it('publishes on every wired navigation event', () => {
    controller.open({ x: 0, y: 0, width: 10, height: 10 })
    const contents = view().webContents
    const channels = contents.on.mock.calls.map((call: unknown[]) => call[0])
    expect(channels).toEqual(expect.arrayContaining([
      'did-start-navigation', 'did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-stop-loading',
    ]))
    const [, navigateListener] = contents.on.mock.calls.find(call => call[0] === 'did-navigate') as [string, () => void]
    window.webContents.send.mockClear()
    contents.getURL.mockReturnValue('https://example.com/two')
    navigateListener()
    expect(window.webContents.send).toHaveBeenCalledWith(DESKTOP_IPC.browserState, expect.objectContaining({ url: 'https://example.com/two' }))
  })

  it('navigates only while open and only to http(s)', () => {
    expect(() => { controller.navigate('https://example.com') }).toThrow('embedded browser is not open')
    controller.open({ x: 0, y: 0, width: 10, height: 10 })
    expect(() => { controller.navigate('file:///etc/passwd') }).toThrow('only loads http(s) URLs')
    controller.navigate('https://example.com/two')
    expect(view().webContents.loadURL).toHaveBeenCalledWith('https://example.com/two')
  })

  it('guards history steps and reloads the attached view', () => {
    controller.back()
    controller.forward()
    controller.reload()
    expect(electron.instances).toHaveLength(0)
    controller.open({ x: 0, y: 0, width: 10, height: 10 })
    const history = view().webContents.navigationHistory
    controller.back()
    controller.forward()
    expect(history.goBack).not.toHaveBeenCalled()
    history.canGoBack.mockReturnValue(true)
    history.canGoForward.mockReturnValue(true)
    controller.back()
    controller.forward()
    expect(history.goBack).toHaveBeenCalledOnce()
    expect(history.goForward).toHaveBeenCalledOnce()
    controller.reload()
    expect(view().webContents.reload).toHaveBeenCalledOnce()
    controller.setBounds({ x: 1, y: 2, width: 3, height: 4 })
    expect(view().setBounds).toHaveBeenLastCalledWith({ x: 1, y: 2, width: 3, height: 4 })
  })

  it('hides without destroying: the same view re-attaches with its document', () => {
    controller.open({ x: 0, y: 0, width: 10, height: 10 })
    const attached = view()
    expect(attached.setBackgroundColor).toHaveBeenCalledWith('#ffffff')
    controller.hide()
    expect(window.contentView.removeChildView).toHaveBeenCalledWith(attached)
    expect(attached.webContents.close).not.toHaveBeenCalled()
    expect(controller.getState().url).toBe('https://example.com/')
    controller.hide()
    expect(window.contentView.removeChildView).toHaveBeenCalledTimes(1)
    controller.open({ x: 5, y: 6, width: 7, height: 8 })
    expect(electron.instances).toHaveLength(1)
    expect(window.contentView.addChildView).toHaveBeenLastCalledWith(attached)
    expect(attached.setBounds).toHaveBeenLastCalledWith({ x: 5, y: 6, width: 7, height: 8 })
  })

  it('detaches, destroys, and resets state on close; a closed view no longer acts', () => {
    controller.open({ x: 0, y: 0, width: 10, height: 10 })
    controller.close()
    expect(window.contentView.removeChildView).toHaveBeenCalledOnce()
    expect(view().webContents.close).toHaveBeenCalledOnce()
    expect(controller.getState()).toEqual({ url: '', title: '', canGoBack: false, canGoForward: false, loading: false })
    controller.close()
    controller.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    controller.back()
    controller.forward()
    controller.reload()
    expect(view().setBounds).toHaveBeenCalledTimes(1)
  })

  it('keeps the last snapshot when the view contents die and skips sends on a destroyed window', () => {
    controller.open({ x: 0, y: 0, width: 10, height: 10 })
    const contents = view().webContents
    const [, navigateListener] = contents.on.mock.calls.find(call => call[0] === 'did-navigate') as [string, () => void]
    contents.isDestroyed.mockReturnValue(true)
    window.isDestroyed.mockReturnValue(true)
    window.webContents.send.mockClear()
    navigateListener()
    expect(window.webContents.send).not.toHaveBeenCalled()
    // The retained snapshot survives a dead view.
    expect(controller.getState().url).toBe('https://example.com/')
  })
})
