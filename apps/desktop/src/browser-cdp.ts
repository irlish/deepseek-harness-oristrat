/**
 * Main-process broker for the embedded browser pane's debugging protocol.
 *
 * The Host asks for protocol commands; this module decides whether the command
 * is one the feature needs, makes sure the pane exists and is attached, and
 * forwards it to the pane's own debugging session. Input commands reach the page
 * as protocol events inside it, so a person keeps typing in the application
 * while an agent drives the pane.
 *
 * Two invariants hold here rather than in the caller. The window is never
 * focused, activated, or forced on top: a pane that automation needs is shown
 * by asking the application to open its tab, never by stealing the user's
 * keyboard. And every command runs one at a time, because the pane is one
 * document and interleaved commands would race their own effects.
 * @module
 */

import type { WebContents } from 'electron'
import type { DesktopBrowserViewController } from './browser-view.ts'
import type { DesktopBrowserCdpErrorCode } from './host-protocol.ts'

/** Debugging protocol version of the bundled Chromium. */
const DEBUGGER_PROTOCOL_VERSION = '1.3'

/** Longest one brokered command may take before the Host is told it timed out. */
const COMMAND_TIMEOUT_MS = 30_000

/** Longest the main process waits for the renderer to show the pane. */
export const BROWSER_REVEAL_TIMEOUT_MS = 3_000

/** Largest captured image the broker forwards, measured in decoded bytes. */
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024

/**
 * Protocol methods the feature uses, and nothing else.
 *
 * The list is the whole capability of this channel: a compromised or buggy Host
 * cannot reach `Browser.setDownloadBehavior`, `Network.*`, or a
 * `Target.*` command that would escape the pane, because the broker refuses
 * every method it does not name.
 */
const ALLOWED_METHODS: readonly string[] = [
  'Accessibility.getFullAXTree',
  'DOM.enable',
  'DOM.getDocument',
  'DOM.querySelector',
  'DOM.resolveNode',
  'Input.dispatchKeyEvent',
  'Input.dispatchMouseEvent',
  'Input.insertText',
  'Page.addScriptToEvaluateOnNewDocument',
  'Page.captureScreenshot',
  'Page.enable',
  'Page.getLayoutMetrics',
  'Page.getNavigationHistory',
  'Page.navigate',
  'Page.navigateToHistoryEntry',
  'Page.reload',
  'Runtime.callFunctionOn',
  'Runtime.evaluate',
]

/** A brokered command failure, carrying the code the Host routes on. */
export class DesktopBrowserCdpError extends Error {
  /** Transport failure code reported to the Host. */
  readonly code: DesktopBrowserCdpErrorCode

  /**
   * @param code - transport failure code reported to the Host.
   * @param message - operator-facing description.
   */
  constructor(code: DesktopBrowserCdpErrorCode, message: string) {
    super(message)
    this.name = 'DesktopBrowserCdpError'
    this.code = code
  }
}

/**
 * Owner of the pane's debugging session.
 *
 * The debugging session attaches on the first command and detaches with the
 * view, so the pane carries no debugging overhead while nothing drives it.
 */
export class DesktopBrowserCdpBroker {
  private attachedContents: WebContents | undefined
  private queue: Promise<unknown> = Promise.resolve()

  /**
   * @param pane - resolves the window's embedded browser view.
   * @param reveal - asks the application to show the pane and resolves when it is attached.
   * @param activity - reports that a command started or settled, for the pane's activity strip.
   */
  constructor(
    private readonly pane: () => DesktopBrowserViewController,
    private readonly reveal: () => Promise<boolean>,
    private readonly activity: (method: string, active: boolean) => void,
  ) {}

  /**
   * Run one protocol command against the pane.
   * @param method - protocol method name; anything outside {@link ALLOWED_METHODS} is refused.
   * @param params - method parameters.
   * @returns the method result exactly as the pane produced it.
   * @throws DesktopBrowserCdpError with the code the Host reports to the provider.
   */
  async dispatch(method: string, params: unknown): Promise<unknown> {
    if (!ALLOWED_METHODS.includes(method)) {
      throw new DesktopBrowserCdpError('method-not-allowed', `dsh desktop: browser method ${method} is not available to automation`)
    }
    const run = this.queue.then(async () => await this.run(method, params), async () => await this.run(method, params))
    this.queue = run.then(() => undefined, () => undefined)
    return await run
  }

  /** Detach the debugging session and stop reporting activity. */
  dispose(): void {
    const contents = this.attachedContents
    this.attachedContents = undefined
    if (contents === undefined || contents.isDestroyed()) return
    try {
      if (contents.debugger.isAttached()) contents.debugger.detach()
      contents.setBackgroundThrottling(true)
    } catch (error) {
      // Teardown races window destruction: a contents that went away between the
      // check and the call has no debugging session left to release.
      if (!(error instanceof Error) || !/destroyed|not attached/iu.test(error.message)) throw error
    }
  }

  /**
   * Show the pane when the user has not opened it, then run one command.
   * @param method - allowed protocol method name.
   * @param params - method parameters.
   * @returns the method result.
   */
  private async run(method: string, params: unknown): Promise<unknown> {
    const contents = await this.attachedContentsFor()
    const timer = setTimeout(() => { this.activity(method, false) }, COMMAND_TIMEOUT_MS)
    this.activity(method, true)
    try {
      const result = await withTimeout(
        contents.debugger.sendCommand(method, params),
        COMMAND_TIMEOUT_MS,
        method,
      )
      return this.bounded(method, params, result)
    } catch (error: unknown) {
      if (error instanceof DesktopBrowserCdpError) throw error
      throw new DesktopBrowserCdpError('protocol-error', `dsh desktop: browser method ${method} failed: ${describe(error)}`)
    } finally {
      clearTimeout(timer)
      this.activity(method, false)
    }
  }

  /**
   * Refuse a capture larger than the channel carries, naming the way out.
   * @param method - protocol method name.
   * @param params - method parameters the caller sent.
   * @param result - method result.
   * @returns the result, unchanged when it fits.
   */
  private bounded(method: string, params: unknown, result: unknown): unknown {
    if (method !== 'Page.captureScreenshot') return result
    const data = (result as { data?: unknown }).data
    if (typeof data !== 'string') return result
    if (data.length * 3 / 4 <= MAX_SCREENSHOT_BYTES) return result
    const fullPage = (params as { captureBeyondViewport?: unknown } | undefined)?.captureBeyondViewport === true
    throw new DesktopBrowserCdpError(
      'payload-too-large',
      `dsh desktop: the capture exceeds the ${String(Math.round(MAX_SCREENSHOT_BYTES / 1024 / 1024))}MiB image limit`
      + (fullPage ? '; capture the viewport instead of the whole page' : '; lower the JPEG quality'),
    )
  }

  /**
   * Attach the pane's debugging session, showing the pane first when needed.
   * @returns the pane's attached webContents.
   */
  private async attachedContentsFor(): Promise<WebContents> {
    const pane = this.pane()
    if (!pane.isAttached()) {
      const shown = await this.reveal()
      if (!shown) {
        throw new DesktopBrowserCdpError('not-open', 'dsh desktop: the browser pane is not open and the application did not show it')
      }
    }
    const contents = pane.contents()
    if (contents === undefined) {
      throw new DesktopBrowserCdpError('not-open', 'dsh desktop: the browser pane is not open')
    }
    if (this.attachedContents !== contents) {
      if (contents.debugger.isAttached()) contents.debugger.detach()
      try {
        contents.debugger.attach(DEBUGGER_PROTOCOL_VERSION)
      } catch (error: unknown) {
        const code: DesktopBrowserCdpErrorCode = contents.isDevToolsOpened() ? 'devtools-open' : 'attach-failed'
        const hint = code === 'devtools-open' ? '; close the pane DevTools window and try again' : ''
        throw new DesktopBrowserCdpError(code, `dsh desktop: could not attach to the browser pane${hint}: ${describe(error)}`)
      }
      // Automation keeps driving a pane the user has switched away from, so the
      // pane must keep running its timers and rendering its frames while hidden.
      contents.setBackgroundThrottling(false)
      this.attachedContents = contents
    }
    return contents
  }
}

/**
 * Bound one protocol command in time.
 * @param work - the pending command.
 * @param ms - deadline in milliseconds.
 * @param method - protocol method name, named in the failure.
 * @returns the command result.
 * @throws DesktopBrowserCdpError with `timeout` when the deadline passes first.
 */
async function withTimeout(work: Promise<unknown>, ms: number, method: string): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new DesktopBrowserCdpError('timeout', `dsh desktop: browser method ${method} did not answer within ${String(ms)}ms`))
        }, ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Describe one thrown value for a diagnostic.
 * @param error - the thrown value.
 * @returns its message, or its string form.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
