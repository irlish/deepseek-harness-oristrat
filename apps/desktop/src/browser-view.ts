/**
 * The embedded browser surface: one `WebContentsView` owned by the main
 * process and steered by the application renderer through typed IPC.
 *
 * The view keeps its own persistent partition, so browsing cookies and
 * storage never mix with the application session; window opens are denied as
 * windows and http(s) targets load in-view; every navigation is restricted to
 * http(s). The renderer owns placement: it measures the panel element and
 * pushes window-relative CSS-pixel bounds, and the main process only rounds
 * and clamps them to non-negative integers.
 */

import { WebContentsView } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { DESKTOP_IPC, type DesktopBrowserBounds, type DesktopBrowserState } from './ipc.ts'

/** Persistent storage partition of the embedded view. */
const BROWSER_PARTITION = 'persist:dsh-embedded-browser'

/** Upper bound on each placement side, keeping renderer-supplied numbers finite. */
const MAX_BOUNDS_SIDE = 100_000

/**
 * Whether one URL may load in the embedded view.
 * @param url - candidate navigation target.
 * @returns true only for parseable http(s) URLs.
 */
export function isBrowsableUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    // An unparseable target is exactly what the policy exists to refuse.
    return false
  }
}

/**
 * Sanitize renderer-supplied placement numbers.
 * @param value - raw IPC payload.
 * @returns rounded bounds clamped to [0, MAX_BOUNDS_SIDE], or undefined for a malformed payload.
 */
export function sanitizeBounds(value: unknown): DesktopBrowserBounds | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const clamp = (side: unknown): number | undefined =>
    typeof side === 'number' && Number.isFinite(side)
      ? Math.min(MAX_BOUNDS_SIDE, Math.max(0, Math.round(side)))
      : undefined
  const x = clamp(raw.x)
  const y = clamp(raw.y)
  const width = clamp(raw.width)
  const height = clamp(raw.height)
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined
  return { x, y, width, height }
}

/**
 * Snapshot one webContents into its published navigation state.
 * @param contents - the embedded view's webContents.
 * @returns the state pushed to the renderer.
 */
function snapshotOf(contents: WebContents): DesktopBrowserState {
  return {
    url: contents.getURL(),
    title: contents.getTitle(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    loading: contents.isLoading(),
  }
}

/**
 * Main-process owner of the single embedded browser view of one window.
 * The view exists between `open` and `close`; every other verb is a no-op
 * while it is detached.
 */
export class DesktopBrowserViewController {
  private view: WebContentsView | undefined
  private state: DesktopBrowserState = { url: '', title: '', canGoBack: false, canGoForward: false, loading: false }

  /** @param window - application window whose contentView hosts the view. */
  constructor(private readonly window: BrowserWindow) {}

  /** Latest published navigation snapshot. */
  getState(): DesktopBrowserState {
    return this.state
  }

  /**
   * Attach the view (creating it on first use) at one placement.
   * @param bounds - window-relative CSS-pixel placement.
   * @param url - optional http(s) URL to load after attaching.
   */
  open(bounds: DesktopBrowserBounds, url?: string): void {
    if (this.view === undefined) this.attach()
    const view = this.view
    /* v8 ignore -- attach() always assigns this.view; the guard only narrows the optional field */
    if (view === undefined) return
    this.window.contentView.addChildView(view)
    this.setBounds(bounds)
    if (url !== undefined && isBrowsableUrl(url)) void view.webContents.loadURL(url)
    this.publish()
  }

  /** Detach and destroy the view; the next `open` starts a fresh one. */
  close(): void {
    const view = this.view
    if (view === undefined) return
    this.view = undefined
    this.state = { url: '', title: '', canGoBack: false, canGoForward: false, loading: false }
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(view)
    view.webContents.close()
  }

  /**
   * Load one http(s) URL in the attached view.
   * @param url - navigation target.
   */
  navigate(url: string): void {
    if (this.view === undefined) throw new Error('dsh desktop: embedded browser is not open')
    if (!isBrowsableUrl(url)) throw new Error('dsh desktop: embedded browser only loads http(s) URLs')
    void this.view.webContents.loadURL(url)
  }

  /** Step one entry back in the view's navigation history. */
  back(): void {
    if (this.view !== undefined && this.view.webContents.navigationHistory.canGoBack()) this.view.webContents.navigationHistory.goBack()
  }

  /** Step one entry forward in the view's navigation history. */
  forward(): void {
    const history = this.view?.webContents.navigationHistory
    if (history !== undefined && history.canGoForward()) history.goForward()
  }

  /** Reload the view's current document. */
  reload(): void {
    this.view?.webContents.reload()
  }

  /**
   * Move/resize the attached view.
   * @param bounds - window-relative CSS-pixel placement.
   */
  setBounds(bounds: DesktopBrowserBounds): void {
    this.view?.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
  }

  /** Create the view, wire its navigation policy, and start publishing state. */
  private attach(): void {
    const view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    const contents = view.webContents
    // Popups never become windows; an http(s) target loads in-view instead.
    contents.setWindowOpenHandler(({ url }) => {
      if (isBrowsableUrl(url)) void contents.loadURL(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, target) => {
      if (!isBrowsableUrl(target)) event.preventDefault()
    })
    contents.on('did-start-navigation', () => { this.publish() })
    contents.on('did-navigate', () => { this.publish() })
    contents.on('did-navigate-in-page', () => { this.publish() })
    contents.on('page-title-updated', () => { this.publish() })
    contents.on('did-stop-loading', () => { this.publish() })
    this.view = view
  }

  /** Push the current snapshot to the application renderer. */
  private publish(): void {
    const contents = this.view?.webContents
    if (contents !== undefined && !contents.isDestroyed()) this.state = snapshotOf(contents)
    if (!this.window.isDestroyed()) this.window.webContents.send(DESKTOP_IPC.browserState, this.state)
  }
}
