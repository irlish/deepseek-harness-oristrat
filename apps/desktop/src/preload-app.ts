/** Startup controls for shell documents; the embedded-browser face for application documents. */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type DesktopBrowserApi, type DesktopBrowserState, type DshDesktopAppApi, type DshDesktopStartupApi } from './ipc.ts'
import type { DesktopBackendState } from './backend-controller.ts'

const startup: DshDesktopStartupApi = {
  protocolVersion: 1,
  locale: () => ipcRenderer.invoke(DESKTOP_IPC.localeGet) as ReturnType<DshDesktopStartupApi['locale']>,
  backend: {
    status: () => ipcRenderer.invoke(DESKTOP_IPC.backendStatus) as ReturnType<DshDesktopStartupApi['backend']['status']>,
    subscribe(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: DesktopBackendState): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.backendState, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.backendState, handle) }
    },
  },
  disablePlugins: () => ipcRenderer.invoke(DESKTOP_IPC.pluginsDisableAll) as Promise<void>,
  restart: () => ipcRenderer.invoke(DESKTOP_IPC.applicationRestart) as Promise<void>,
  resetConfiguration: () => ipcRenderer.invoke(DESKTOP_IPC.configurationReset) as Promise<void>,
}

const browser: DesktopBrowserApi = {
  open: (bounds, url) => ipcRenderer.invoke(DESKTOP_IPC.browserOpen, bounds, url) as Promise<void>,
  close: () => ipcRenderer.invoke(DESKTOP_IPC.browserClose) as Promise<void>,
  navigate: url => ipcRenderer.invoke(DESKTOP_IPC.browserNavigate, url) as Promise<void>,
  back: () => ipcRenderer.invoke(DESKTOP_IPC.browserBack) as Promise<void>,
  forward: () => ipcRenderer.invoke(DESKTOP_IPC.browserForward) as Promise<void>,
  reload: () => ipcRenderer.invoke(DESKTOP_IPC.browserReload) as Promise<void>,
  setBounds: bounds => ipcRenderer.invoke(DESKTOP_IPC.browserSetBounds, bounds) as Promise<void>,
  state: () => ipcRenderer.invoke(DESKTOP_IPC.browserGetState) as Promise<DesktopBrowserState>,
  subscribe(listener) {
    const handle = (_event: Electron.IpcRendererEvent, state: DesktopBrowserState): void => { listener(state) }
    ipcRenderer.on(DESKTOP_IPC.browserState, handle)
    return () => { ipcRenderer.off(DESKTOP_IPC.browserState, handle) }
  },
}

const application: DshDesktopAppApi = { protocolVersion: 1, browser }

contextBridge.exposeInMainWorld('dshDesktop', location.protocol === 'dsh-app:' && location.hostname === 'shell'
  ? startup
  : location.protocol === 'dsh-app:' && location.hostname === 'app'
    ? application
    : { protocolVersion: 1 })
