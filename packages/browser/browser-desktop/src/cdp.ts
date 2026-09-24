/**
 * CDP command session over a brokered browser transport: one deadline per
 * command, one error vocabulary, and the protocol method names this provider
 * uses. Nothing here knows how the transport is carried.
 * @module
 */

import {
  BrowserError,
  BrowserTransportError,
  type BrowserErrorCode,
  type BrowserTransport,
  type BrowserTransportErrorCode,
  type BrowserViewport,
} from '@deepseek-ai/dsh-browser'

/** One CDP command result of the shape a caller expects. */
export type CdpResult<T> = T

/** Transport failure to capability failure, total over the transport vocabulary. */
const TRANSPORT_TO_BROWSER: Record<BrowserTransportErrorCode, BrowserErrorCode> = {
  'not-open': 'BROWSER_UNAVAILABLE',
  'devtools-open': 'BROWSER_UNAVAILABLE',
  'attach-failed': 'BROWSER_UNAVAILABLE',
  'closed': 'BROWSER_UNAVAILABLE',
  'method-not-allowed': 'BROWSER_PROTOCOL',
  'payload-too-large': 'BROWSER_PROTOCOL',
  'protocol-error': 'BROWSER_PROTOCOL',
  'timeout': 'BROWSER_TIMEOUT',
  'aborted': 'BROWSER_ABORTED',
}

/**
 * Translate one transport failure into the capability vocabulary.
 * @param error - failure raised by the transport or an unrelated throw.
 * @returns the typed capability error a caller routes on.
 */
export function browserErrorOf(error: unknown): BrowserError {
  if (error instanceof BrowserError) return error
  if (error instanceof BrowserTransportError) {
    return new BrowserError(error.message, TRANSPORT_TO_BROWSER[error.code], { cause: error })
  }
  return new BrowserError(error instanceof Error ? error.message : String(error), 'BROWSER_PROTOCOL', { cause: error })
}

/** Why one command ended, when the deadline rather than the caller ended it. */
function deadlineExceeded(signal: AbortSignal | undefined, error: unknown): boolean {
  return signal?.aborted !== true && error instanceof Error && error.name === 'TimeoutError'
}

/**
 * Drive one browser view through a transport with a per-command deadline.
 * A command that outlives its deadline is abandoned and reported as
 * `BROWSER_TIMEOUT`; a caller abort is reported as `BROWSER_ABORTED`.
 */
export class CdpSession {
  /**
   * @param transport - brokered command channel to the browser view.
   * @param timeoutMs - deadline for one command.
   */
  constructor(
    private readonly transport: BrowserTransport,
    private readonly timeoutMs: number,
  ) {}

  /**
   * Run one command against the browser view.
   * @param method - CDP method name.
   * @param params - method parameters.
   * @param signal - optional caller cancellation.
   * @returns the method result.
   */
  async send<T>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<CdpResult<T>> {
    if (signal?.aborted === true) throw new BrowserError('browser command aborted', 'BROWSER_ABORTED')
    const deadline = AbortSignal.timeout(this.timeoutMs)
    const combined = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
    try {
      return await this.transport.send(method, params, combined) as T
    } catch (error) {
      if (deadlineExceeded(signal, error)) {
        throw new BrowserError(`browser command ${method} exceeded ${String(this.timeoutMs)}ms`, 'BROWSER_TIMEOUT', { cause: error })
      }
      throw browserErrorOf(error)
    }
  }

  /**
   * Evaluate one expression in the main frame and return its value.
   * @param expression - expression source supplied by the trusted caller.
   * @param signal - optional caller cancellation.
   * @returns the unserialized evaluation result.
   */
  async evaluate<T>(expression: string, signal?: AbortSignal): Promise<T> {
    const result = await this.send<{ result: { value?: T }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      signal,
    )
    if (result.exceptionDetails !== undefined) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'evaluation failed'
      throw new BrowserError(`page script failed: ${detail}`, 'BROWSER_ACTION_FAILED')
    }
    return result.result.value as T
  }

  /**
   * Read the viewport size in CSS pixels.
   * @param signal - optional caller cancellation.
   * @returns integer viewport dimensions.
   */
  async viewport(signal?: AbortSignal): Promise<BrowserViewport> {
    const size = await this.evaluate<{ width: number; height: number }>(
      '({ width: window.innerWidth, height: window.innerHeight })',
      signal,
    )
    return { width: Math.round(size.width), height: Math.round(size.height) }
  }
}
