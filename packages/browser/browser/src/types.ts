/**
 * Value vocabulary and error taxonomy for the sidebar browser automation seam.
 * @module
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/**
 * One page-scoped element reference minted by an observation, rendered to the
 * model as `@e12`. References identify an element inside one observation
 * generation only: any navigation, or a newer observation that drops the node,
 * makes the reference stale, and the provider reports `BROWSER_REF_STALE`
 * instead of acting on a different element.
 */
export type BrowserRef = Branded<'BrowserRef'>

/**
 * Opaque identity of the caller that holds the browser view. The provider uses
 * it only to arbitrate the single-view lease; it never parses or displays it.
 */
export type BrowserOwner = Branded<'BrowserOwner'>

/** Reference text the model reads and writes, without the `@` sigil. */
const BROWSER_REF_PATTERN = /^e[1-9][0-9]{0,6}$/u

/**
 * Parse one model-supplied element reference.
 * @param value - reference text with or without a leading `@`.
 * @returns the branded reference, or `undefined` when the text is not one.
 */
export function parseBrowserRef(value: string): BrowserRef | undefined {
  const text = value.startsWith('@') ? value.slice(1) : value
  return BROWSER_REF_PATTERN.test(text) ? brandString<BrowserRef>(text) : undefined
}

/**
 * Render one element reference as the model reads it.
 * @param ref - reference minted by an observation.
 * @returns the reference text with its `@` sigil.
 */
export function formatBrowserRef(ref: BrowserRef): string {
  return `@${ref}`
}

/**
 * Mint the reference for one element of an observation generation.
 * @param index - 1-based position of the element in the observation.
 * @returns the branded reference the model reads as `@e<index>`.
 */
export function createBrowserRef(index: number): BrowserRef {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error(`browser reference index must be a positive integer, received ${String(index)}`)
  }
  return brandString<BrowserRef>(`e${String(index)}`)
}

/**
 * Brand one session identity as the calling identity of a browser request.
 * @param value - identity text, conventionally the session id.
 * @returns the branded owner.
 */
export function parseBrowserOwner(value: string): BrowserOwner {
  return brandString<BrowserOwner>(value)
}

/**
 * Format the calling identity of a browser request.
 * @param owner - calling identity.
 * @returns the identity text a diagnostic names.
 */
export function formatBrowserOwner(owner: BrowserOwner): string {
  return owner
}

/** Failure codes a brokered browser transport reports to the provider. */
export const BROWSER_TRANSPORT_ERROR_CODES = [
  'not-open',
  'devtools-open',
  'method-not-allowed',
  'attach-failed',
  'payload-too-large',
  'timeout',
  'aborted',
  'closed',
  'protocol-error',
] as const

/** One failure code a brokered browser transport reports. */
export type BrowserTransportErrorCode = typeof BROWSER_TRANSPORT_ERROR_CODES[number]

/**
 * Transport failure raised where the browser view is brokered to this process.
 * Codes describe the transport, not the page: the provider maps them onto
 * {@link BrowserErrorCode} before a tool sees them.
 */
export class BrowserTransportError extends HarnessError {
  override readonly code: BrowserTransportErrorCode

  /**
   * @param message - operator-facing failure description.
   * @param code - transport failure class.
   * @param options - optional `cause` chain.
   */
  constructor(message: string, code: BrowserTransportErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/** Failure codes the browser seam reports to its consumers. */
export const BROWSER_ERROR_CODES = [
  'BROWSER_UNAVAILABLE',
  'BROWSER_ORIGIN_DENIED',
  'BROWSER_REF_STALE',
  'BROWSER_BUSY',
  'BROWSER_SCRIPT_EVAL_DENIED',
  'BROWSER_TIMEOUT',
  'BROWSER_ABORTED',
  'BROWSER_NAVIGATION_FAILED',
  'BROWSER_ACTION_FAILED',
  'BROWSER_PROTOCOL',
] as const

/** One failure code the browser seam reports. */
export type BrowserErrorCode = typeof BROWSER_ERROR_CODES[number]

/**
 * Typed browser automation error. The seam owns this vocabulary so every
 * provider reports the same codes instead of inventing message strings, and the
 * tool consumer turns recoverable codes into guidance the model can act on.
 */
export class BrowserError extends HarnessError {
  override readonly code: BrowserErrorCode

  /**
   * @param message - model- and operator-facing failure description.
   * @param code - failure class callers route on.
   * @param options - optional `cause` chain.
   */
  constructor(message: string, code: BrowserErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/** Viewport size of the browser pane in CSS pixels. */
export interface BrowserViewport {
  readonly width: number
  readonly height: number
}

/** Addressable element inside the current page. */
export type BrowserElementTarget = {
  readonly kind: 'ref'
  readonly ref: BrowserRef
} | {
  readonly kind: 'selector'
  readonly selector: string
} | {
  readonly kind: 'point'
  readonly x: number
  readonly y: number
}

/** What the page is, at one moment, without history availability. */
export interface BrowserPageIdentity {
  readonly url: string
  readonly title: string
  readonly loading: boolean
  readonly viewport: BrowserViewport
}

/** Observable page state, including whether history can be walked. */
export interface BrowserPageState extends BrowserPageIdentity {
  readonly canGoBack: boolean
  readonly canGoForward: boolean
}

/** Navigation verbs the seam performs on the browser pane. */
export type BrowserNavigationAction = 'goto' | 'back' | 'forward' | 'reload'

/** One navigation request. */
export interface BrowserNavigateRequest {
  readonly owner: BrowserOwner
  readonly action: BrowserNavigationAction
  readonly url?: string
  readonly timeoutMs?: number
}

/** Settled result of one navigation. */
export interface BrowserNavigation extends BrowserPageState {
  readonly reached: boolean
}

/** Console and uncaught-error entry buffered by the provider. */
export interface BrowserConsoleEntry {
  readonly seq: number
  readonly level: 'log' | 'debug' | 'info' | 'warn' | 'error'
  readonly text: string
  readonly source?: string
}

/** Console read request. */
export interface BrowserConsoleRequest {
  readonly owner: BrowserOwner
  readonly since?: number
  readonly limit?: number
  readonly levels?: readonly BrowserConsoleEntry['level'][]
}

/** Bounded page of console entries, newest last. */
export interface BrowserConsolePage {
  readonly entries: readonly BrowserConsoleEntry[]
  readonly dropped: number
  readonly cursor: number
}

/** Request for the visual observation the model reads. */
export interface BrowserObserveRequest {
  readonly owner: BrowserOwner
  readonly cursor?: string
  readonly maxDepth?: number
  readonly maxNodes?: number
  readonly maxBytes?: number
}

/**
 * One observation generation: the reference-bearing text the model acts on.
 * `refs` contains exactly the references this text used, so a later `act` can
 * reject a reference the model invented or read in an older generation.
 */
export interface BrowserObservation extends BrowserPageIdentity {
  readonly text: string
  readonly refs: readonly BrowserRef[]
  readonly nodeCount: number
  readonly truncated: boolean
  readonly nextCursor?: string
  /** UTF-8 byte length of `text` as emitted, including its page header. */
  readonly byteLength: number
}

/** Verbs the seam performs on one element or the page. */
export type BrowserActionName = 'click' | 'hover' | 'focus' | 'fill' | 'type' | 'press' | 'select' | 'scroll'

/** One action request. */
export interface BrowserActRequest {
  readonly owner: BrowserOwner
  readonly action: BrowserActionName
  readonly target?: BrowserElementTarget
  readonly value?: string
  readonly key?: string
  readonly button?: 'left' | 'middle' | 'right'
  readonly clickCount?: number
  readonly deltaY?: number
  readonly timeoutMs?: number
}

/**
 * Outcome of one action, plus the state the model needs to verify it.
 * `ref` identifies the element the action resolved, which is absent for
 * page-level actions such as `scroll`.
 */
export interface BrowserActOutcome extends BrowserPageState {
  readonly action: BrowserActionName
  readonly ref?: BrowserRef
}

/** Image formats the seam captures. */
export type BrowserImageFormat = 'png' | 'jpeg'

/** One screenshot request. */
export interface BrowserScreenshotRequest {
  readonly owner: BrowserOwner
  readonly fullPage?: boolean
  readonly target?: BrowserElementTarget
  readonly format?: BrowserImageFormat
  readonly quality?: number
}

/** Captured image bytes. The consumer stores them; the seam never owns storage. */
export interface BrowserScreenshot {
  readonly format: BrowserImageFormat
  /** Media type of the captured bytes, which the format decides. */
  readonly mediaType: 'image/png' | 'image/jpeg'
  readonly bytes: Uint8Array
  readonly width: number
  readonly height: number
  /** URL of the page the image was captured from, read as part of the capture. */
  readonly url: string
}

/** One script evaluation request. */
export interface BrowserEvaluateRequest {
  readonly owner: BrowserOwner
  readonly expression: string
}

/**
 * Result of one script evaluation, already projected to text: an awaited
 * promise, `undefined`, a string, or JSON. The projection keeps a page value
 * that cannot cross the protocol (a DOM node, a function) from failing the
 * whole call.
 */
export interface BrowserEvaluateResult {
  readonly text: string
}
