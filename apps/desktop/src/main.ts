/** Electron shell: desktop project ownership, custom protocol, windows, and lifecycle. */

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  type IpcMainInvokeEvent,
  type TitleBarOverlayOptions,
} from 'electron'
import { resolveDesktopPaths } from './paths.ts'
import { migrateOristratThinkingLevels } from './settings-thinking-migration.ts'
import { DesktopProjectManager, type DesktopProjectHooks } from './project-manager.ts'
import { DesktopHostProcess } from './host-process.ts'
import { DesktopBackendController, type DesktopBackendState } from './backend-controller.ts'
import { DESKTOP_IPC, type DesktopUpdateState } from './ipc.ts'
import { DesktopBrowserViewController, sanitizeBounds } from './browser-view.ts'
import { formatDesktopMessage, resolveDesktopLocale } from './locale.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { DesktopUpdateCoordinator } from './update-coordinator.ts'
import { desktopErrorState } from './startup-error.ts'
import { startupFailureDocument } from './startup-document.ts'

const SCHEME = 'dsh-app'

// Fork: name the shell before anything resolves userData so this build keeps
// its own Electron browser data instead of sharing @deepseek-ai/dsh-desktop.
app.setName('Oristrat AI Stem')
let focusPrimaryWindow = (): void => {}
type RecoveryAction = 'restart' | 'plugins' | 'reset'
let profileRecoveryAvailable = (): boolean => false
const emergencyPages = new WeakMap<BrowserWindow, { url: string; message: string; busy: boolean }>()
let recoverApplication = (action: RecoveryAction): Promise<void> => {
  if (action !== 'restart') return Promise.reject(new Error('Desktop recovery could not initialize; reinstall the application'))
  app.relaunch()
  app.quit()
  return Promise.resolve()
}

async function showEmergencyDocument(window: BrowserWindow, message: string): Promise<void> {
  const document = startupFailureDocument(resolveDesktopLocale(app.getLocale()), message, profileRecoveryAvailable())
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(document)}`
  emergencyPages.set(window, { url, message, busy: false })
  await window.loadURL(url)
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    stream: true,
    codeCache: true,
  },
}])

const MIME: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

interface RuntimeResources {
  readonly node: string
  readonly pnpm: string
  readonly dsh: string
}

function runtimeResources(): RuntimeResources {
  const development = !app.isPackaged
  const node = (development ? process.env.DSH_DESKTOP_NODE_BINARY : undefined)
    ?? join(process.resourcesPath, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  const pnpm = (development ? process.env.DSH_DESKTOP_PNPM_ENTRY : undefined)
    ?? join(process.resourcesPath, 'runtime', 'pnpm', 'bin', 'pnpm.mjs')
  const dsh = (development ? process.env.DSH_DESKTOP_DSH_DIR : undefined) ?? join(process.resourcesPath, 'dsh')
  return { node, pnpm, dsh }
}

function developmentHostInspectPort(enabled: boolean): number | undefined {
  const configured = process.env.DSH_DESKTOP_HOST_INSPECT_PORT
  if (!enabled || configured === undefined || configured === '') return undefined
  const port = Number(configured)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('dsh desktop: DSH_DESKTOP_HOST_INSPECT_PORT must be an integer from 1 through 65535')
  }
  return port
}

/**
 * Fork: guarantee clipboard shortcuts reach text fields even when the native
 * menu accelerator path does not consume them (synthetic keys, odd focus).
 * The Edit menu roles stay the primary path; this only fires for key events
 * the renderer actually receives, so a menu-consumed shortcut never doubles.
 * @param contents - web contents to watch.
 */
function installClipboardFallback(contents: BrowserWindow['webContents']): void {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.meta || input.control) || input.isAutoRepeat) return
    const commands: Record<string, 'paste' | 'copy' | 'cut' | 'selectAll'> = {
      v: 'paste', c: 'copy', x: 'cut', a: 'selectAll',
    }
    const command = commands[input.key.toLowerCase()]
    if (command === undefined) return
    event.preventDefault()
    if (command === 'paste') contents.paste()
    else if (command === 'copy') contents.copy()
    else if (command === 'cut') contents.cut()
    else contents.selectAll()
  })
  contents.on('context-menu', () => {
    Menu.buildFromTemplate([
      { role: 'copy' }, { role: 'paste' }, { role: 'cut' }, { type: 'separator' }, { role: 'selectAll' },
    ]).popup()
  })
}

/** Fork: reference-client Windows title bar overlay height in CSS pixels. */
const WINDOWS_TITLEBAR_HEIGHT = 36

/**
 * Fork: window-controls overlay matching the reference client on Windows: a
 * transparent band so the Web header shows through, theme-aware glyphs.
 * @param dark - Whether the current renderer theme is dark.
 * @returns Electron title bar overlay options.
 */
function windowsTitleBarOverlay(dark: boolean): TitleBarOverlayOptions {
  return { color: '#00000000', symbolColor: dark ? '#f3f4f6' : '#202124', height: WINDOWS_TITLEBAR_HEIGHT }
}

function createWindow(preload: string, show = false): BrowserWindow {
  const window = new BrowserWindow({
    // Fork: the reference client keeps the macOS title bar blank; session
    // titles live in the sidebar, not the window chrome.
    title: '',
    // Fork: the reference client hides the native title bar (no hairline,
    // content rides at the window top) and re-shows the traffic lights.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const } : {}),
    // Fork: Windows matches the reference client — hidden title bar with the
    // native window-controls overlay and an auto-hidden menu bar (Alt still
    // reveals it), so no menu row or hairline splits the Web header.
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: windowsTitleBarOverlay(nativeTheme.shouldUseDarkColors),
      autoHideMenuBar: true,
    } : {}),
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 600,
    show,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  installClipboardFallback(window.webContents)
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).protocol !== `${SCHEME}:`) event.preventDefault()
    const page = emergencyPages.get(window)
    if (page === undefined || page.busy || window.webContents.getURL() !== page.url) return
    const action = new URL(url)
    if (action.protocol !== 'dsh-recovery:' || !['restart', 'plugins', 'reset'].includes(action.hostname)) return
    if (action.hostname !== 'restart' && !profileRecoveryAvailable()) return
    page.busy = true
    void recoverApplication(action.hostname as RecoveryAction).catch(async (error: unknown) => {
      if (!window.isDestroyed()) await showEmergencyDocument(window, `${page.message}\n${desktopErrorState(error).message}`)
    }).catch((error: unknown) => { console.error(error) }).finally(() => { page.busy = false })
  })
  return window
}

function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): void {
  const senderFrame = event.senderFrame
  if (senderFrame === null) throw new Error('dsh desktop: rejected IPC without a sender frame')
  const url = new URL(senderFrame.url)
  if (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname)) {
    throw new Error('dsh desktop: rejected IPC from an unowned renderer')
  }
}

async function serveShellAsset(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  const root = resolve(app.getAppPath(), 'renderer')
  const url = new URL(request.url)
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return new Response(null, { status: 400 })
  }
  const target = resolve(normalize(join(root, pathname)))
  if (target !== root && !target.startsWith(root + sep)) return new Response(null, { status: 403 })
  try {
    const body = request.method === 'HEAD' ? null : await readFile(target)
    return new Response(body, { headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' } })
  } catch {
    return new Response(null, { status: 404 })
  }
}

/**
 * Fork: copy the bundled first-run user settings into an empty Desktop home so
 * a fresh install opens on the Oristrat provider roster instead of the catalog
 * fallback. Existing settings are never touched.
 * @param home - Resolved Desktop DSH home directory.
 */
async function seedFirstRunSettings(home: string): Promise<void> {
  if (!app.isPackaged) return
  const target = join(home, 'settings.yaml')
  if (existsSync(target)) return
  const seed = join(process.resourcesPath, 'seed', 'settings.yaml')
  if (!existsSync(seed)) return
  await mkdir(home, { recursive: true })
  await copyFile(seed, target)
}

async function main(): Promise<void> {
  const resources = runtimeResources()
  const paths = resolveDesktopPaths()
  await seedFirstRunSettings(paths.home)
  // Fork: existing settings documents predate the thinking-level roster; the
  // composer slider needs declared efforts. A unreadable document stays for
  // the settings service to fail on loudly.
  await migrateOristratThinkingLevels(paths.home).catch((error: unknown) => { console.error(error) })
  const development = app.isPackaged ? undefined : join(app.getAppPath(), '.desktop-build', 'development', 'project')
  const activeProject = development ?? paths.profile
  const manager = new DesktopProjectManager(paths, resources)
  profileRecoveryAvailable = () => development === undefined && manager.canRecoverProfile()
  let pageError: Extract<DesktopBackendState, { phase: 'error' }> | undefined
  let quitting = false
  let startup: Promise<void> | undefined
  let mainWindow: BrowserWindow | undefined
  let pluginWindow: BrowserWindow | undefined
  let shellInstallerOwnsQuit = false
  let updateState: DesktopUpdateState = { phase: 'idle' }
  const locale = resolveDesktopLocale(app.getLocale())
  const messages = locale.messages
  const appPreload = fileURLToPath(new URL('./preload-app.cjs', import.meta.url))
  const managementPreload = fileURLToPath(new URL('./preload.cjs', import.meta.url))
  const startupUrl = `${SCHEME}://shell/startup.html`
  const applicationUrl = `${SCHEME}://app/index.html`
  let navigation: { window: BrowserWindow; url: string; promise: Promise<void> } | undefined
  let emergencyDocument = false

  const showEmergencyError = async (error: unknown): Promise<void> => {
    if (quitting || emergencyDocument) return
    emergencyDocument = true
    const diagnostic = desktopErrorState(error).message
    pageError = { phase: 'error', message: diagnostic }
    if (mainWindow !== undefined) await showEmergencyDocument(mainWindow, diagnostic)
  }

  const navigateMain = (url: string): Promise<void> => {
    const window = mainWindow
    if (quitting || emergencyDocument || window === undefined || window.isDestroyed()) return Promise.resolve()
    if (navigation?.window === window && navigation.url === url) return navigation.promise
    const next = { window, url, promise: Promise.resolve() }
    next.promise = window.loadURL(url).catch((error: unknown) => {
      if (quitting || window.isDestroyed() || navigation !== next) return
      navigation = undefined
      throw error
    })
    navigation = next
    return next.promise
  }
  const backendState = (): DesktopBackendState => {
    const state = pageError ?? backend.state
    return state.phase === 'error' ? { ...state, profileRecovery: profileRecoveryAvailable() } : state
  }
  const publishBackend = (state: DesktopBackendState): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DESKTOP_IPC.backendState, state)
    }
  }
  const backend = new DesktopBackendController((onFailure) => {
    if (development === undefined) manager.assertProfileRuntime(activeProject)
    const hostInspectPort = developmentHostInspectPort(development !== undefined)
    // Fork: pin the product home (sessions, settings, workspaces) to the
    // isolated Desktop home; an inherited DSH_HOME would leak another install.
    const hostEnv = development === undefined ? { ...process.env, DSH_HOME: paths.home } : process.env
    const host = new DesktopHostProcess(resources.node, development ?? resources.dsh, activeProject,
      hostInspectPort, hostEnv, onFailure)
    return {
      start: () => host.start(),
      stop: () => host.stop(),
      fetch: (request: Request) => host.fetch(request),
    }
  }, (state) => {
    if (state.phase === 'starting' && !emergencyDocument) pageError = undefined
    publishBackend(backendState())
    if (state.phase === 'error') void navigateMain(startupUrl).catch((error: unknown) => { console.error(error) })
  })

  const publishUpdate = (state: DesktopUpdateState): DesktopUpdateState => {
    updateState = state
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DESKTOP_IPC.updatesState, state)
    }
    return state
  }

  const hooks: DesktopProjectHooks = {
    beforeChange: () => backend.stop(),
    afterChange: () => backend.start(async () => {}),
  }

  recoverApplication = async (action): Promise<void> => {
    await startup?.catch(() => undefined)
    await backend.stop()
    if (action === 'restart') {
      app.relaunch()
      app.quit()
      return
    }
    if (!profileRecoveryAvailable()) throw new Error(messages.startupReinstallAdvice)
    if (action === 'reset') await manager.resetConfiguration(hooks)
    else await manager.mutate({ type: 'plugins-disable-all' }, hooks)
    emergencyDocument = false
    pageError = undefined
    navigation = undefined
    await navigateMain(applicationUrl)
  }

  const showStartupError = async (error: unknown): Promise<void> => {
    if (quitting) return
    pageError = desktopErrorState(error)
    try { await navigateMain(startupUrl) }
    catch (navigationError) {
      await showEmergencyError(new AggregateError([error, navigationError], messages.startupFailed))
    }
    publishBackend(backendState())
  }
  const reconcileBackend = (): Promise<void> => {
    startup ??= (async () => {
      pageError = undefined
      await navigateMain(startupUrl)
      await backend.start(async () => {
        if (development === undefined) {
          await manager.applyRelease()
        }
      })
      if (backend.host !== undefined) await navigateMain(applicationUrl)
    })().catch(async (error: unknown) => {
      await showStartupError(error)
      throw error
    }).finally(() => { startup = undefined })
    return startup
  }

  const updates = new DesktopUpdateCoordinator(
    publishUpdate,
    async () => {
      shellInstallerOwnsQuit = true
      await backend.stop()
    },
  )

  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'shell') return serveShellAsset(request).then((response) => {
      if (response.status >= 400 && ['/startup.html', '/startup.js', '/startup.css'].includes(url.pathname)) {
        void showEmergencyError(new Error(`Desktop recovery resource could not be loaded: ${url.pathname} (HTTP ${response.status})`))
          .catch((error: unknown) => { console.error(error) })
      }
      return response
    })
    if (url.hostname !== 'app') return Promise.resolve(new Response(null, { status: 404 }))
    const active = backend.host
    if (active === undefined) return Promise.resolve(new Response('backend unavailable', { status: 503 }))
    return active.fetch(request)
  })

  const mutate = async (event: IpcMainInvokeEvent, mutation: Parameters<DesktopProjectManager['mutate']>[0]): Promise<void> => {
    assertDesktopSender(event, ['shell'])
    if (development !== undefined) {
      throw new Error('dsh desktop: plugin package changes require a packaged application')
    }
    await startup?.catch(() => undefined)
    pageError = undefined
    await navigateMain(startupUrl)
    try {
      await manager.mutate(mutation, hooks)
      await navigateMain(applicationUrl)
    } catch (error) {
      await showStartupError(error)
      throw error
    }
  }
  ipcMain.handle(DESKTOP_IPC.localeGet, (event) => {
    assertDesktopSender(event, ['shell'])
    return locale
  })
  ipcMain.handle(DESKTOP_IPC.pluginsList, (event) => {
    assertDesktopSender(event, ['shell'])
    if (development !== undefined) return []
    return manager.listPlugins()
  })
  ipcMain.handle(DESKTOP_IPC.pluginsAdd, (event, spec: unknown) => {
    if (typeof spec !== 'string') throw new Error('dsh desktop: plugin spec must be a string')
    return mutate(event, { type: 'plugin-add', spec })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsRemove, (event, name: unknown) => {
    if (typeof name !== 'string') throw new Error('dsh desktop: plugin name must be a string')
    return mutate(event, { type: 'plugin-remove', name })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsUpdate, (event, name: unknown, version: unknown) => {
    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new Error('dsh desktop: plugin name and version must be strings')
    }
    return mutate(event, { type: 'plugin-update', name, version })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsToggle, (event, name: unknown, enabled: unknown) => {
    if (typeof name !== 'string' || typeof enabled !== 'boolean') throw new Error('dsh desktop: invalid plugin activation request')
    return mutate(event, { type: 'plugin-toggle', name, enabled })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsDisableAll, event => mutate(event, { type: 'plugins-disable-all' }))
  ipcMain.handle(DESKTOP_IPC.backendStatus, (event) => {
    assertDesktopSender(event, ['shell'])
    return backendState()
  })
  ipcMain.handle(DESKTOP_IPC.backendRetry, async (event) => {
    assertDesktopSender(event, ['shell'])
    await reconcileBackend()
    focusPrimaryWindow()
  })
  ipcMain.handle(DESKTOP_IPC.applicationRestart, async (event) => {
    assertDesktopSender(event, ['shell'])
    try {
      await recoverApplication('restart')
    } catch (error) {
      await showStartupError(error)
    }
  })
  ipcMain.handle(DESKTOP_IPC.configurationReset, async (event) => {
    assertDesktopSender(event, ['shell'])
    if (development !== undefined) throw new Error('Desktop configuration reset requires a packaged application')
    const failure = backendState()
    if (failure.phase !== 'error') {
      throw new Error('Desktop profile reset requires a startup failure')
    }
    await startup?.catch(() => undefined)
    try {
      await recoverApplication('reset')
    } catch (error) {
      await showStartupError(error)
    }
  })
  ipcMain.handle(DESKTOP_IPC.updatesCheck, async (event) => {
    assertDesktopSender(event, ['shell'])
    return updates.check()
  })
  ipcMain.handle(DESKTOP_IPC.updatesInstall, async (event) => {
    assertDesktopSender(event, ['shell'])
    await updates.install()
  })

  // Fork: embedded browser view for the right-sidebar browser panel. The
  // renderer owns placement and navigation intent; the view itself lives in
  // the main process with its own persistent partition.
  let browserController: DesktopBrowserViewController | undefined
  let browserHost: BrowserWindow | undefined
  const browserFor = (): DesktopBrowserViewController => {
    const window = mainWindow
    if (window === undefined || window.isDestroyed()) throw new Error('dsh desktop: no application window for the embedded browser')
    if (browserController === undefined || browserHost !== window) {
      browserController = new DesktopBrowserViewController(window)
      browserHost = window
    }
    return browserController
  }
  ipcMain.handle(DESKTOP_IPC.browserOpen, (event, bounds: unknown, url: unknown) => {
    assertDesktopSender(event, ['app'])
    const placement = sanitizeBounds(bounds)
    if (placement === undefined) throw new Error('dsh desktop: browser bounds must be four finite numbers')
    browserFor().open(placement, typeof url === 'string' ? url : undefined)
  })
  ipcMain.handle(DESKTOP_IPC.browserHide, (event) => {
    assertDesktopSender(event, ['app'])
    browserController?.hide()
  })
  ipcMain.handle(DESKTOP_IPC.browserNavigate, (event, url: unknown) => {
    assertDesktopSender(event, ['app'])
    if (typeof url !== 'string') throw new Error('dsh desktop: browser navigation target must be a string')
    browserFor().navigate(url)
  })
  ipcMain.handle(DESKTOP_IPC.browserBack, (event) => {
    assertDesktopSender(event, ['app'])
    browserController?.back()
  })
  ipcMain.handle(DESKTOP_IPC.browserForward, (event) => {
    assertDesktopSender(event, ['app'])
    browserController?.forward()
  })
  ipcMain.handle(DESKTOP_IPC.browserReload, (event) => {
    assertDesktopSender(event, ['app'])
    browserController?.reload()
  })
  ipcMain.handle(DESKTOP_IPC.browserSetBounds, (event, bounds: unknown) => {
    assertDesktopSender(event, ['app'])
    const placement = sanitizeBounds(bounds)
    if (placement === undefined) throw new Error('dsh desktop: browser bounds must be four finite numbers')
    browserController?.setBounds(placement)
  })
  ipcMain.handle(DESKTOP_IPC.browserGetState, (event) => {
    assertDesktopSender(event, ['app'])
    return browserController?.getState() ?? { url: '', title: '', canGoBack: false, canGoForward: false, loading: false }
  })

  const checkAndPrompt = async (manual: boolean): Promise<void> => {
    const state = await updates.check()
    if (state.phase === 'error') {
      if (manual) {
        await dialog.showMessageBox({
          type: 'error',
          title: messages.updateCheckFailedTitle,
          message: state.message ?? messages.unknownError,
        })
      }
      return
    }
    if (state.phase !== 'available') {
      if (manual) {
        await dialog.showMessageBox({
          type: 'info',
          title: messages.updateCheckTitle,
          message: state.message ?? messages.updateCurrent,
        })
      }
      return
    }
    const result = await dialog.showMessageBox({
      type: 'info',
      title: messages.updateTitle,
      message: messages.updateAvailable,
      detail: formatDesktopMessage(messages.updateDetail, { version: state.version ?? '' }),
      buttons: [messages.installAndRestart, messages.later],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response !== 0) return
    const installed = await updates.install()
    if (installed.phase === 'error') {
      await dialog.showMessageBox({
        type: 'error',
        title: messages.updateFailedTitle,
        message: installed.message ?? messages.unknownError,
      })
    }
  }

  const openPluginWindow = (): void => {
    if (pluginWindow !== undefined && !pluginWindow.isDestroyed()) {
      pluginWindow.focus()
      return
    }
    pluginWindow = createWindow(managementPreload)
    pluginWindow.setSize(900, 620)
    pluginWindow.setTitle(messages.pluginWindowTitle)
    pluginWindow.once('ready-to-show', () => { pluginWindow?.show() })
    pluginWindow.once('closed', () => { pluginWindow = undefined })
    void pluginWindow.loadURL(`${SCHEME}://shell/plugin-manager.html`)
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: process.platform === 'darwin' ? app.name : messages.application,
    submenu: [
      {
        label: development === undefined ? messages.pluginsMenu : messages.pluginsMenuPackagedOnly,
        accelerator: 'CmdOrCtrl+,',
        enabled: development === undefined,
        click: openPluginWindow,
      },
      { label: messages.checkUpdatesMenu, click: () => { void checkAndPrompt(true) } },
      { type: 'separator' },
      { role: 'quit' },
    ],
    // Fork: macOS binds ⌘C/⌘V/X/A in webviews to the Edit menu roles; without
    // them every text field (API key drafts included) silently ignores paste.
  }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]))

  // Fork: keep the Windows overlay glyphs in step with renderer theme flips.
  nativeTheme.on('updated', () => {
    if (process.platform !== 'win32') return
    for (const open of BrowserWindow.getAllWindows()) {
      if (!open.isDestroyed()) open.setTitleBarOverlay(windowsTitleBarOverlay(nativeTheme.shouldUseDarkColors))
    }
  })

  // Fork: desktop drag strip mirroring the reference client: a 24px fixed
  // band between the traffic-light zone (macOS) or the window edge (Windows)
  // and the header actions, injected once per load so the frameless window
  // stays movable. Windows also publishes the window-controls overlay height
  // as `--dsh-wco-top` so the centre and rightbar columns start below it and
  // their header rows sit flush right on the second visual line.
  const installDesktopDragRegion = (window: BrowserWindow): void => {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return
    const inject = (): void => {
      if (window.isDestroyed()) return
      void window.webContents.executeJavaScript(`(() => {
        document.documentElement.style.setProperty('--dsh-wco-top', '${process.platform === 'win32' ? '36px' : '0px'}')
        if (document.getElementById('dsh-desktop-drag-region')) return
        const dragRegion = document.createElement('div')
        dragRegion.id = 'dsh-desktop-drag-region'
        dragRegion.setAttribute('aria-hidden', 'true')
        Object.assign(dragRegion.style, {
          position: 'fixed',
          zIndex: '18',
          top: '0',
          left: '${process.platform === 'darwin' ? '80px' : '0px'}',
          right: '${process.platform === 'darwin' ? '220px' : '140px'}',
          height: '24px',
          background: 'transparent',
          pointerEvents: 'auto',
          userSelect: 'none'
        })
        dragRegion.style.setProperty('-webkit-app-region', 'drag')
        document.body.appendChild(dragRegion)
      })()`).catch(() => {})
    }
    inject()
    window.webContents.on('did-finish-load', inject)
  }

  const alignWindowButtons = (window: BrowserWindow): void => {
    if (window.isDestroyed()) return
    window.setWindowButtonPosition({
      x: Math.round(16 * window.webContents.getZoomFactor()) - 2,
      y: 9,
    })
  }

  const createMainWindow = (): BrowserWindow => {
    const window = createWindow(appPreload, true)
    window.on('page-title-updated', (event) => { event.preventDefault() })
    if (process.platform === 'darwin') {
      window.setWindowButtonVisibility(true)
      alignWindowButtons(window)
      window.webContents.on('did-finish-load', () => { alignWindowButtons(window) })
      window.webContents.on('zoom-changed', () => { setImmediate(() => { alignWindowButtons(window) }) })
    }
    installDesktopDragRegion(window)
    mainWindow = window
    window.on('closed', () => {
      if (mainWindow === window) mainWindow = undefined
      // The embedded view dies with its host window; drop the stale owner.
      if (browserHost === window) {
        browserController = undefined
        browserHost = undefined
      }
    })
    window.webContents.on('preload-error', (_event, _path, error) => {
      void showEmergencyError(error).catch((failure: unknown) => { console.error(failure) })
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      navigation = undefined
      emergencyDocument = false
      void showStartupError(new Error(`Desktop renderer exited: ${details.reason}`))
        .catch((failure: unknown) => { console.error(failure) })
    })
    return window
  }
  focusPrimaryWindow = () => {
    const window = mainWindow
    if (window === undefined || window.isDestroyed()) {
      createMainWindow()
      void navigateMain(backendState().phase === 'ready' ? applicationUrl : startupUrl)
        .catch((error: unknown) => { console.error(error) })
      return
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) focusPrimaryWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (shellInstallerOwnsQuit || quitting) return
    event.preventDefault()
    quitting = true
    void backend.close().catch((error: unknown) => { console.error(error) }).finally(() => { app.quit() })
  })

  mainWindow = createMainWindow()
  await reconcileBackend().catch(() => undefined)
  // Window lifecycle callbacks run while backend startup is pending.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (quitting) return
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (mainWindow !== undefined && development !== undefined && process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
  publishUpdate(updateState)
  setTimeout(() => { void checkAndPrompt(false) }, 10_000)
}

const ownsDesktopInstance = claimDesktopSingleInstance(app, () => { focusPrimaryWindow() })

if (ownsDesktopInstance) void app.whenReady().then(main).catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  const diagnosticFile = process.env.DSH_DESKTOP_DIAGNOSTIC_FILE
  if (diagnosticFile !== undefined) {
    await writeFile(diagnosticFile, `${error instanceof Error ? error.stack ?? message : message}\n`).catch(() => undefined)
  }
  const window = BrowserWindow.getAllWindows()[0] ?? createWindow(fileURLToPath(new URL('./preload-app.cjs', import.meta.url)), true)
  window.once('closed', () => { app.quit() })
  await showEmergencyDocument(window, message)
}).catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})
