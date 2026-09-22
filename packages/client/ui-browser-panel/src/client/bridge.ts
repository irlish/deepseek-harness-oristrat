/**
 * The desktop embedded-browser bridge, structurally named: the application
 * document's `window.dshDesktop.browser` face, mirrored here because the
 * owning declaration lives in the desktop application bundle, outside the
 * client package graph.
 */

/** Placement of the embedded view, in application-window CSS pixels. */
export interface BrowserBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Navigation snapshot of the embedded view. */
export interface BrowserState {
  readonly url: string
  readonly title: string
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly loading: boolean
}

/** The desktop bridge's embedded-browser operations. */
export interface DesktopBrowserBridge {
  readonly open: (bounds: BrowserBounds, url?: string) => Promise<void>
  readonly close: () => Promise<void>
  readonly navigate: (url: string) => Promise<void>
  readonly back: () => Promise<void>
  readonly forward: () => Promise<void>
  readonly reload: () => Promise<void>
  readonly setBounds: (bounds: BrowserBounds) => Promise<void>
  readonly state: () => Promise<BrowserState>
  readonly subscribe: (listener: (state: BrowserState) => void) => () => void
}

/**
 * Read the desktop bridge when this document runs inside the desktop app.
 * @returns the embedded-browser face, or undefined on the plain web host.
 */
export function desktopBrowser(): DesktopBrowserBridge | undefined {
  const carrier = (window as { dshDesktop?: { browser?: DesktopBrowserBridge } }).dshDesktop
  return carrier?.browser
}

/**
 * Convert one measured element rect into view placement numbers.
 * @param rect - window-relative CSS-pixel rect, or undefined before layout.
 * @returns rounded, non-negative-safe bounds for the bridge.
 */
export function boundsFromRect(rect: { left: number; top: number; width: number; height: number } | undefined): BrowserBounds {
  return {
    x: Math.round(rect?.left ?? 0),
    y: Math.round(rect?.top ?? 0),
    width: Math.round(rect?.width ?? 0),
    height: Math.round(rect?.height ?? 0),
  }
}

/**
 * Normalize one address-bar entry into a navigable http(s) URL.
 * @param input - raw user text.
 * @returns the URL to load, or undefined when the text names none.
 */
export function normalizeUrlInput(input: string): string | undefined {
  const trimmed = input.trim()
  if (trimmed.length === 0 || /\s/.test(trimmed)) return undefined
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined
  } catch {
    // Text that parses as no URL has no navigation reading.
    return undefined
  }
}
