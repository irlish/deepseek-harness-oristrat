/**
 * Scripted brokered browser transport for the desktop provider's suites.
 *
 * Every suite drives the provider through this fake rather than an Electron
 * window: it records each protocol command together with the signal it carried
 * and answers from scripts registered per protocol method, so a test states the
 * commands it expects and no browser process, network, or real page is involved.
 * @module
 */

import type { BrowserTransport } from '@deepseek-ai/dsh-browser'

/** One protocol command the provider sent, with the signal it carried. */
export interface RecordedCommand {
  readonly method: string
  readonly params: Record<string, unknown>
  readonly signal: AbortSignal | undefined
}

/**
 * Answer for one protocol method. Returning a promise is supported: the
 * transport resolves it before the command settles.
 */
export type CommandReply = (params: Record<string, unknown>, signal: AbortSignal | undefined) => unknown

/** Transport that records every command and answers from per-method scripts. */
export class FakeBrowserTransport implements BrowserTransport {
  /** Every command the provider sent, in send order. */
  readonly commands: RecordedCommand[] = []
  private readonly scripts = new Map<string, CommandReply[]>()

  /**
   * Answer every later command for one method with the same reply.
   * @param method - protocol method name.
   * @param reply - answer for the command.
   * @returns this transport, for chaining.
   */
  on(method: string, reply: CommandReply): this {
    this.scripts.set(method, [reply])
    return this
  }

  /**
   * Answer the next commands for one method in order, repeating the last reply
   * once the sequence is exhausted.
   * @param method - protocol method name.
   * @param replies - answers in send order; at least one is required.
   * @returns this transport, for chaining.
   */
  sequence(method: string, ...replies: readonly CommandReply[]): this {
    this.scripts.set(method, [...replies])
    return this
  }

  /**
   * Count the commands sent for one method.
   * @param method - protocol method name.
   * @returns the number of recorded commands.
   */
  count(method: string): number {
    return this.commands.filter(command => command.method === method).length
  }

  /**
   * Read the parameters of one recorded command.
   * @param method - protocol method name.
   * @param index - 0-based position among that method's commands.
   * @returns the recorded parameters.
   */
  paramsOf(method: string, index = 0): Record<string, unknown> {
    const command = this.commands.filter(entry => entry.method === method)[index]
    if (command === undefined) throw new Error(`no recorded ${method} command at index ${String(index)}`)
    return command.params
  }

  /**
   * Read the signal one recorded command carried.
   * @param method - protocol method name.
   * @param index - 0-based position among that method's commands.
   * @returns the cancellation signal the provider combined with its deadline.
   */
  signalOf(method: string, index = 0): AbortSignal | undefined {
    const command = this.commands.filter(entry => entry.method === method)[index]
    if (command === undefined) throw new Error(`no recorded ${method} command at index ${String(index)}`)
    return command.signal
  }

  /**
   * Record one command and answer it from the script registered for its method.
   * @param method - protocol method name.
   * @param params - method parameters.
   * @param signal - cancellation signal the provider attached.
   * @returns the scripted answer.
   */
  async send(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const recorded = params as Record<string, unknown>
    this.commands.push({ method, params: recorded, signal })
    const queue = this.scripts.get(method)
    if (queue === undefined || queue.length === 0) throw new Error(`fake transport: no script for ${method}`)
    const reply = queue.length > 1 ? queue.shift() : queue[0]
    if (reply === undefined) throw new Error(`fake transport: empty script for ${method}`)
    return await reply(recorded, signal)
  }
}

/**
 * Build a transport whose scripts are registered by a caller-supplied body.
 * @param script - receives the empty transport to register replies on.
 * @returns the scripted transport.
 */
export function fakeTransport(script?: (transport: FakeBrowserTransport) => void): FakeBrowserTransport {
  const transport = new FakeBrowserTransport()
  script?.(transport)
  return transport
}
