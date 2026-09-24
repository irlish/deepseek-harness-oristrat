/**
 * Service Definition for the sidebar browser automation seam (`ctx.browser`):
 * driving the embedded browser pane the desktop client shows, through an
 * interchangeable browser backend.
 *
 * The seam is deliberately narrow. It exposes page-level operations — navigate,
 * observe, act, screenshot, console, state, evaluate — because every consumer
 * needs those verbs and none of them needs to know whether the backend speaks
 * CDP over the desktop shell or through some other transport. Element
 * references, observation text, and error codes are owned here so tools,
 * providers, and clients cannot drift apart on their meaning.
 * @module @deepseek-ai/dsh-browser
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  BrowserActOutcome,
  BrowserActRequest,
  BrowserConsolePage,
  BrowserConsoleRequest,
  BrowserEvaluateRequest,
  BrowserEvaluateResult,
  BrowserNavigateRequest,
  BrowserNavigation,
  BrowserObservation,
  BrowserObserveRequest,
  BrowserOwner,
  BrowserPageState,
  BrowserScreenshot,
  BrowserScreenshotRequest,
} from './types.ts'

export {
  BROWSER_ERROR_CODES,
  BROWSER_TRANSPORT_ERROR_CODES,
  BrowserError,
  BrowserTransportError,
  createBrowserRef,
  formatBrowserOwner,
  formatBrowserRef,
  parseBrowserOwner,
  parseBrowserRef,
} from './types.ts'
export type {
  BrowserActionName,
  BrowserActOutcome,
  BrowserActRequest,
  BrowserConsoleEntry,
  BrowserConsolePage,
  BrowserConsoleRequest,
  BrowserElementTarget,
  BrowserErrorCode,
  BrowserEvaluateRequest,
  BrowserEvaluateResult,
  BrowserImageFormat,
  BrowserNavigateRequest,
  BrowserNavigation,
  BrowserNavigationAction,
  BrowserObservation,
  BrowserObserveRequest,
  BrowserOwner,
  BrowserPageIdentity,
  BrowserPageState,
  BrowserRef,
  BrowserScreenshot,
  BrowserScreenshotRequest,
  BrowserTransportErrorCode,
  BrowserViewport,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    browser: BrowserAutomation
  }
}

/**
 * Command channel to one browser view, shaped like the browser's own debugging
 * protocol. A provider receives one of these from its composition and never
 * learns how it is carried. A shell, in-process backend, or remote backend may
 * implement it, provided the composition supplies the channel.
 *
 * Implementations reject with {@link BrowserTransportError} and must settle
 * every call: neither a reply nor a rejection may be dropped.
 */
export interface BrowserTransport {
  /**
   * Run one command against the browser view.
   * @param method - protocol method name, for example `Page.captureScreenshot`.
   * @param params - method parameters, already validated by the provider.
   * @param signal - optional cancellation; aborting settles the returned promise.
   * @returns the method result exactly as the browser view produced it.
   */
  send(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>
}

/**
 * Abstract browser automation backend. Implementations own one browser view,
 * arbitrate which caller may drive it, and report page state after every
 * mutation so a caller can verify an action instead of assuming it landed.
 *
 * Element references are minted by one observation and are valid until a
 * navigation or an observation that drops the node; a stale reference is a
 * `BROWSER_REF_STALE` failure, never a silent action on another element.
 */
export abstract class BrowserAutomation extends Service {
  /**
   * @param ctx - context this service is mounted into.
   */
  constructor(ctx: Context) {
    super(ctx, 'browser')
  }

  /**
   * Read the current page state.
   * @param owner - calling identity, used for lease arbitration.
   * @param signal - optional cancellation.
   * @returns the observable state of the browser view.
   */
  abstract state(owner: BrowserOwner, signal?: AbortSignal): Promise<BrowserPageState>

  /**
   * Navigate the browser view and wait for the resulting document to settle.
   * @param request - navigation verb, optional target URL, and timeout.
   * @param signal - optional cancellation.
   * @returns the settled state, with `reached` false when the wait timed out.
   */
  abstract navigate(request: BrowserNavigateRequest, signal?: AbortSignal): Promise<BrowserNavigation>

  /**
   * Observe the page as reference-bearing text for the model.
   * @param request - owner, optional continuation cursor, and output bounds.
   * @param signal - optional cancellation.
   * @returns one observation generation, bounded by the requested limits.
   */
  abstract observe(request: BrowserObserveRequest, signal?: AbortSignal): Promise<BrowserObservation>

  /**
   * Perform one action on an element or the page.
   * @param request - action verb, target, and verb-specific value.
   * @param signal - optional cancellation.
   * @returns the action outcome and the page state that followed it.
   */
  abstract act(request: BrowserActRequest, signal?: AbortSignal): Promise<BrowserActOutcome>

  /**
   * Capture the page, or one element, as image bytes.
   * @param request - owner, optional full-page or element framing, and format.
   * @param signal - optional cancellation.
   * @returns the captured image; the caller owns storage of its bytes.
   */
  abstract screenshot(request: BrowserScreenshotRequest, signal?: AbortSignal): Promise<BrowserScreenshot>

  /**
   * Read buffered console output and uncaught page errors.
   * @param request - owner, optional lower sequence bound, and entry limits.
   * @param signal - optional cancellation.
   * @returns a bounded, ordered page of entries.
   */
  abstract console(request: BrowserConsoleRequest, signal?: AbortSignal): Promise<BrowserConsolePage>

  /**
   * Evaluate one expression in the page's main frame, awaiting a promise it
   * returns, and project the result to the text the model reads.
   * @param request - owner and expression; the caller decides whether model-authored expressions may run.
   * @param signal - optional cancellation.
   * @returns the text projection of the evaluated value.
   */
  abstract evaluate(request: BrowserEvaluateRequest, signal?: AbortSignal): Promise<BrowserEvaluateResult>
}

export default BrowserAutomation
