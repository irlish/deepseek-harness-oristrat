/**
 * Host owner of the browser-interactive terminal Remote namespace: one PTY
 * per browser session tab, spawned through the subprocess capability's
 * terminal surface and bridged to the Typert gateway as unary verbs plus one
 * cursor-resumable output stream.
 *
 * Sessions are host-process scoped, not agent scoped: the model-facing
 * `ctx.terminals` family fences sessions behind live Agent owners, which a
 * browser panel does not have, so this controller owns its own session table
 * and tears every PTY down with its effect scope.
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import type {
  GuiTerminalCloseRequest, GuiTerminalOpenRequest, GuiTerminalOpenValue, GuiTerminalOutputFrame,
  GuiTerminalOutputRequest, GuiTerminalReadValue, GuiTerminalSessionSummary, GuiTerminalWriteRequest,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host browser-terminal session table and Remote namespace owner. */
    guiTerminalController: GuiTerminalController
  }
}

/** Retained output frames per session before the oldest are dropped. */
const RING_FRAME_LIMIT = 2048

/** Default PTY geometry when the caller omits one side. */
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 30

/** One browser terminal session: the PTY handle plus its retained output. */
class GuiTerminalSession {
  readonly ring: GuiTerminalOutputFrame[] = []
  nextSeq = 0
  alive = true
  private readonly waiters = new Set<() => void>()

  constructor(
    readonly id: string,
    private readonly handle: SubprocessTerminalHandle,
  ) {}

  /** Append one output chunk and wake every parked stream. */
  push(data: string): void {
    if (data.length === 0) return
    this.ring.push({ seq: this.nextSeq, data })
    this.nextSeq += 1
    if (this.ring.length > RING_FRAME_LIMIT) this.ring.splice(0, this.ring.length - RING_FRAME_LIMIT)
    this.wake()
  }

  /** Retained frames at or after one cursor, in order. */
  framesSince(cursor: number): GuiTerminalOutputFrame[] {
    if (cursor >= this.nextSeq) return []
    const oldest = this.ring[0]
    const from = oldest !== undefined && cursor < oldest.seq ? oldest.seq : cursor
    return this.ring.filter(frame => frame.seq >= from)
  }

  /** Mark the PTY gone and wake parked streams so they can finish. */
  markDead(): void {
    if (!this.alive) return
    this.alive = false
    this.wake()
  }

  /** Resolve once the ring grows, the session dies, or the signal aborts. */
  waitForChange(signal: AbortSignal): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>()
    const done = (): void => {
      signal.removeEventListener('abort', done)
      this.waiters.delete(done)
      resolve()
    }
    this.waiters.add(done)
    signal.addEventListener('abort', done, { once: true })
    return promise
  }

  /** Forward raw terminal input to the PTY. */
  write(data: string): Promise<void> {
    return this.handle.write(data)
  }

  /** Terminate the PTY process tree and await quiescence. */
  async terminate(): Promise<void> {
    this.markDead()
    await this.handle.terminate()
  }

  private wake(): void {
    for (const waiter of [...this.waiters]) waiter()
  }
}

/** Shell argv per host platform: the login shell elsewhere, PowerShell on Windows. */
function shellArgv(): string[] {
  if (process.platform === 'win32') return ['powershell.exe', '-NoLogo']
  const shell = process.env.SHELL
  return [shell === undefined || shell.length === 0 ? '/bin/bash' : shell]
}

/** Host service backing the generated `ctx.remote.guiTerminal` namespace. */
export class GuiTerminalController extends TypertRemoteService {
  static inject = ['typert', 'subprocess']

  private readonly sessions = new Map<string, GuiTerminalSession>()
  private nextId = 0

  /** @param ctx - Host context carrying the subprocess terminal surface. */
  constructor(ctx: Context) {
    super(ctx, 'guiTerminalController', { namespace: 'guiTerminal' })
    ctx.effect(() => () => {
      const live = [...this.sessions.values()]
      this.sessions.clear()
      return Promise.allSettled(live.map(session => session.terminate()))
    }, 'gui terminal teardown')
  }

  /**
   * Spawn one interactive shell PTY for the calling browser.
   * @param request - optional cwd and initial geometry.
   * @returns session identity plus the output retained so far.
   */
  @Remote('open')
  async open(request: GuiTerminalOpenRequest): Promise<GuiTerminalOpenValue> {
    const id = `gui-${this.nextId++}`
    const handle = await this.ctx.subprocess.spawnTerminal({
      argv: shellArgv(),
      cwd: request.cwd ?? process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' },
      terminalType: 'xterm-256color',
      cols: request.cols ?? DEFAULT_COLS,
      rows: request.rows ?? DEFAULT_ROWS,
      graceMs: 1000,
    })
    const session = new GuiTerminalSession(id, handle)
    this.sessions.set(id, session)
    handle.output.on('data', (chunk: Buffer) => {
      session.push(chunk.toString('utf8'))
    })
    handle.done.then(
      () => { session.markDead() },
      () => { session.markDead() },
    )
    return { id, scrollback: session.framesSince(0), cursor: session.nextSeq }
  }

  /**
   * Write raw input bytes to one live session's PTY.
   * @param request - session id plus input bytes.
   */
  @Remote('write')
  async write(request: GuiTerminalWriteRequest): Promise<void> {
    const session = this.require(request.id)
    await session.write(request.data)
  }

  /**
   * Terminate one session's PTY process tree.
   * @param request - session id to close.
   */
  @Remote('close')
  async close(request: GuiTerminalCloseRequest): Promise<void> {
    const session = this.sessions.get(request.id)
    if (session === undefined) return
    this.sessions.delete(request.id)
    await session.terminate()
  }

  /**
   * List live sessions for the calling browser.
   * @returns liveness summaries in open order.
   */
  @Remote('list')
  list(): GuiTerminalSessionSummary[] {
    return [...this.sessions.values()].map(session => ({ id: session.id, alive: session.alive }))
  }

  /**
   * Read one session's retained output from a cursor without parking.
   * @param request - session id plus the first needed frame sequence.
   * @returns frames at or after the cursor, the resume cursor, and liveness.
   */
  @Remote('read')
  read(request: GuiTerminalOutputRequest): GuiTerminalReadValue {
    const session = this.require(request.id)
    const frames = session.framesSince(request.cursor)
    const last = frames[frames.length - 1]
    return {
      frames,
      cursor: last === undefined ? request.cursor : last.seq + 1,
      alive: session.alive,
    }
  }

  /**
   * Stream one session's output from a cursor: retained frames first, then
   * live frames until the PTY exits or the generation cancels.
   * @param request - session id plus the first needed frame sequence.
   * @param signal - generation cancellation.
   * @returns ordered output frames.
   */
  @Remote({ mode: 'stream' })
  async * output(request: GuiTerminalOutputRequest, signal: AbortSignal): AsyncIterable<GuiTerminalOutputFrame> {
    const session = this.require(request.id)
    let cursor = request.cursor
    for (;;) {
      signal.throwIfAborted()
      const frames = session.framesSince(cursor)
      if (frames.length > 0) {
        for (const frame of frames) {
          yield frame
          cursor = frame.seq + 1
        }
        continue
      }
      if (!session.alive) return
      await session.waitForChange(signal)
    }
  }

  private require(id: string): GuiTerminalSession {
    const session = this.sessions.get(id)
    if (session === undefined) throw new Error(`unknown gui terminal session "${id}"`)
    return session
  }
}

export default GuiTerminalController
