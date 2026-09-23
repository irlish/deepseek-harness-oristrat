/**
 * Brokered command channel between this Host and the Electron shell's embedded
 * browser pane.
 *
 * The Host never touches a browser: it sends one command over Node IPC and gets
 * one reply back, which is what lets the browser automation seam stay in the
 * Host while the pane stays owned by the shell. Every request settles — by
 * reply, by cancellation, by the backstop deadline, or when the shell goes away
 * — because a provider waiting on a dropped reply would hold its lease forever.
 * @module
 */

import { BrowserTransportError, type BrowserTransport, type BrowserTransportErrorCode } from '@deepseek-ai/dsh-browser'
import type { DesktopBrowserCdpReply, DesktopHostEvent } from './index.ts'

/**
 * Backstop deadline for one brokered command.
 *
 * The provider applies its own per-command deadline and cancels through the
 * signal, so this only bounds a reply that was never sent.
 */
const BACKSTOP_MS = 120_000

/** One request waiting for the shell's reply. */
interface PendingRequest {
  settle(outcome: { readonly result: unknown } | { readonly code: BrowserTransportErrorCode; readonly message: string }): void
}

/**
 * Command channel over the application control channel.
 *
 * Requests are single-flight by request id, so a reply that arrives late still
 * resolves the request it belongs to instead of the next one.
 */
export class DesktopBrowserChannel implements BrowserTransport {
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingRequest>()

  /**
   * @param post - sends one event to the Electron application.
   * @param backstopMs - deadline for a reply that never arrives.
   */
  constructor(
    private readonly post: (event: DesktopHostEvent) => void,
    private readonly backstopMs: number = BACKSTOP_MS,
  ) {}

  /** {@inheritDoc BrowserTransport.send} */
  async send(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const requestId = this.nextRequestId
    this.nextRequestId += 1
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new BrowserTransportError(`browser command ${method} got no reply within ${String(this.backstopMs)}ms`, 'timeout'))
      }, this.backstopMs)
      const onAbort = (): void => {
        this.pending.delete(requestId)
        clearTimeout(timer)
        reject(new BrowserTransportError(`browser command ${method} was cancelled`, 'aborted'))
      }
      this.pending.set(requestId, {
        settle: (outcome) => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          if ('result' in outcome) resolve(outcome.result)
          else reject(new BrowserTransportError(outcome.message, outcome.code))
        },
      })
      if (signal?.aborted === true) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        this.post({ type: 'browser/cdp', requestId, method, params })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        this.pending.delete(requestId)
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(new BrowserTransportError(`browser command ${method} could not reach the application: ${message}`, 'closed'))
      }
    })
  }

  /**
   * Settle the request one reply belongs to.
   * @param reply - result or failure the shell reported.
   */
  settle(reply: DesktopBrowserCdpReply): void {
    const pending = this.pending.get(reply.requestId)
    if (pending === undefined) return
    this.pending.delete(reply.requestId)
    pending.settle(reply.type === 'browser/cdp-result'
      ? { result: reply.result }
      : { code: reply.code, message: reply.message })
  }

  /**
   * Fail every waiting request, because the pane or the application went away.
   * @param code - transport failure code reported to the provider.
   * @param message - failure description reported to the provider.
   */
  fail(code: BrowserTransportErrorCode, message: string): void {
    const waiting = [...this.pending.values()]
    this.pending.clear()
    for (const pending of waiting) pending.settle({ code, message })
  }
}
