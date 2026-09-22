/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopPluginRecord } from './project-manager.ts'
import type { DesktopLocale } from './locale.ts'
import type { DesktopBackendState } from './backend-controller.ts'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  localeGet: 'dsh-desktop:locale-get',
  pluginsList: 'dsh-desktop:plugins-list',
  pluginsAdd: 'dsh-desktop:plugins-add',
  pluginsRemove: 'dsh-desktop:plugins-remove',
  pluginsUpdate: 'dsh-desktop:plugins-update',
  pluginsToggle: 'dsh-desktop:plugins-toggle',
  pluginsDisableAll: 'dsh-desktop:plugins-disable-all',
  backendStatus: 'dsh-desktop:backend-status',
  backendRetry: 'dsh-desktop:backend-retry',
  applicationRestart: 'dsh-desktop:application-restart',
  configurationReset: 'dsh-desktop:configuration-reset',
  backendState: 'dsh-desktop:backend-state',
  updatesCheck: 'dsh-desktop:updates-check',
  updatesInstall: 'dsh-desktop:updates-install',
  updatesState: 'dsh-desktop:updates-state',
  browserOpen: 'dsh-desktop:browser-open',
  browserClose: 'dsh-desktop:browser-close',
  browserNavigate: 'dsh-desktop:browser-navigate',
  browserBack: 'dsh-desktop:browser-back',
  browserForward: 'dsh-desktop:browser-forward',
  browserReload: 'dsh-desktop:browser-reload',
  browserSetBounds: 'dsh-desktop:browser-set-bounds',
  browserGetState: 'dsh-desktop:browser-get-state',
  browserState: 'dsh-desktop:browser-state',
} as const

/** Desktop release update state rendered by desktop-owned UI. */
export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
}

/** Placement of the embedded browser view, in application-window CSS pixels. */
export interface DesktopBrowserBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Navigation snapshot of the embedded browser view. */
export interface DesktopBrowserState {
  readonly url: string
  readonly title: string
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly loading: boolean
}

/** Embedded-browser controls of the desktop bridge. */
export interface DesktopBrowserApi {
  /** Attach (or re-attach) the view at one placement and optionally load a URL. */
  open(bounds: DesktopBrowserBounds, url?: string): Promise<void>
  /** Detach and destroy the view; a later `open` starts a fresh one. */
  close(): Promise<void>
  /** Load one http(s) URL in the view. */
  navigate(url: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  reload(): Promise<void>
  /** Move/resize the attached view to one placement. */
  setBounds(bounds: DesktopBrowserBounds): Promise<void>
  /** Current navigation snapshot. */
  state(): Promise<DesktopBrowserState>
  /** Subscribe to navigation snapshot pushes; returns the unsubscribe. */
  subscribe(listener: (state: DesktopBrowserState) => void): () => void
}

/** Narrow bridge exposed through context isolation. */
export interface DshDesktopApi {
  readonly protocolVersion: 1
  locale(): Promise<DesktopLocale>
  readonly plugins: {
    list(): Promise<readonly DesktopPluginRecord[]>
    add(spec: string): Promise<void>
    remove(name: string): Promise<void>
    update(name: string, version: string): Promise<void>
    toggle(name: string, enabled: boolean): Promise<void>
    disableAll(): Promise<void>
  }
  readonly backend: {
    status(): Promise<DesktopBackendState>
    retry(): Promise<void>
    subscribe(listener: (state: DesktopBackendState) => void): () => void
  }
  readonly updates: {
    check(): Promise<DesktopUpdateState>
    install(): Promise<void>
    subscribe(listener: (state: DesktopUpdateState) => void): () => void
  }
}

/** Startup-page controls, unavailable to backend-provided application documents. */
export interface DshDesktopStartupApi extends Pick<DshDesktopApi, 'protocolVersion' | 'locale'> {
  readonly backend: Omit<DshDesktopApi['backend'], 'retry'>
  disablePlugins(): Promise<void>
  restart(): Promise<void>
  resetConfiguration(): Promise<void>
}

/** Application-document controls: the embedded browser and nothing else. */
export interface DshDesktopAppApi {
  readonly protocolVersion: 1
  readonly browser: DesktopBrowserApi
}
