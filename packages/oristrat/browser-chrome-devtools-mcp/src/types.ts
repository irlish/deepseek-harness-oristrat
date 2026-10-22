/** Browser automation controls shared by the Host and sidebar. */

/** Browser connection selected by the deployment profile. */
export interface BrowserAutomationConnection {
  readonly mode: 'launch' | 'attach'
  readonly endpoint?: string
  readonly headless?: boolean
}

/** Explicit browser operation requested by a person in a Session. */
export type BrowserAutomationAction =
  | { readonly kind: 'pages' }
  | { readonly kind: 'observe' | 'back' | 'forward' | 'reload'; readonly pageId: number }
  | { readonly kind: 'navigate'; readonly url: string }
  | { readonly kind: 'select'; readonly pageId: number }
  | { readonly kind: 'click'; readonly pageId: number; readonly uid: string }
  | { readonly kind: 'fill'; readonly pageId: number; readonly uid: string; readonly value: string }

/** A browser response verified by the Session's MCP connection. */
export interface BrowserAutomationResult {
  readonly connection: BrowserAutomationConnection
  readonly status: 'connected' | 'failed' | 'unavailable' | 'busy' | 'invalid-address'
  readonly text: string
}
