import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { GuiTerminalController } from '../src/index.ts'

interface TerminalFixture {
  handle: SubprocessTerminalHandle
  output: PassThrough
  done: PromiseWithResolvers<{ exitCode: number; signal: null }>
  write: ReturnType<typeof vi.fn<SubprocessTerminalHandle['write']>>
  terminate: ReturnType<typeof vi.fn<SubprocessTerminalHandle['terminate']>>
}

const roots: Context[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function terminal(): TerminalFixture {
  const output = new PassThrough()
  const done = Promise.withResolvers<{ exitCode: number; signal: null }>()
  const write = vi.fn<SubprocessTerminalHandle['write']>(async () => {})
  const terminate = vi.fn<SubprocessTerminalHandle['terminate']>(async () => {
    output.end()
    done.resolve({ exitCode: 0, signal: null })
  })
  const handle: SubprocessTerminalHandle = {
    pid: 42,
    output,
    done: done.promise,
    write,
    terminate,
    resize: async () => {},
    inspectActivity: async () => ({ state: 'unknown', revision: 0 }),
    inspectForeground: async () => undefined,
    signalForeground: async () => 42,
  }
  return { handle, output, done, write, terminate }
}

function harness() {
  const ctx = new Context()
  roots.push(ctx)
  const dispose = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => dispose },
    contexts: { configureHost: () => dispose },
  } as never)
  const sessions: TerminalFixture[] = []
  const spawnTerminal = vi.fn(async (_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> => {
    const session = terminal()
    sessions.push(session)
    return session.handle
  })
  ctx.provide('subprocess', { spawnTerminal } as never)
  return { ctx, controller: new GuiTerminalController(ctx), sessions, spawnTerminal }
}

describe('GuiTerminalController', () => {
  it('opens a shell with default geometry and resumes retained output from a cursor', async () => {
    const { controller, sessions, spawnTerminal } = harness()
    const opened = await controller.open({})
    expect(opened).toEqual({ id: 'gui-0', scrollback: [], cursor: 0 })
    const spawnSpec = spawnTerminal.mock.calls[0]?.[0]
    expect(spawnSpec).toMatchObject({
      cwd: process.cwd(), cols: 120, rows: 30, terminalType: 'xterm-256color', graceMs: 1000,
    })
    expect(spawnSpec?.env?.TERM).toBe('xterm-256color')
    expect(controller.list()).toEqual([{ id: opened.id, alive: true }])

    sessions[0]!.output.emit('data', Buffer.from(''))
    sessions[0]!.output.write(Buffer.from('hello'))
    sessions[0]!.output.write(Buffer.from(' world'))
    expect(controller.read({ id: opened.id, cursor: 0 })).toEqual({
      frames: [{ seq: 0, data: 'hello' }, { seq: 1, data: ' world' }], cursor: 2, alive: true,
    })
    expect(controller.read({ id: opened.id, cursor: 1 })).toMatchObject({ frames: [{ seq: 1, data: ' world' }], cursor: 2 })
    expect(controller.read({ id: opened.id, cursor: 9 })).toEqual({ frames: [], cursor: 9, alive: true })
    await controller.write({ id: opened.id, data: 'ls\n' })
    expect(sessions[0]!.write).toHaveBeenCalledWith('ls\n')
    await controller.close({ id: opened.id })
    expect(sessions[0]!.terminate).toHaveBeenCalledOnce()
    expect(controller.list()).toEqual([])
    await controller.close({ id: opened.id })
    await expect(controller.write({ id: opened.id, data: 'x' })).rejects.toThrow('unknown gui terminal session')
    expect(() => controller.read({ id: opened.id, cursor: 0 })).toThrow('unknown gui terminal session')
  })

  it('honors requested shell settings and terminates every live PTY on teardown', async () => {
    const { ctx, controller, sessions, spawnTerminal } = harness()
    vi.stubEnv('SHELL', '/bin/zsh')
    const first = await controller.open({ cwd: '/tmp', cols: 80, rows: 24 })
    const second = await controller.open({ cwd: '/var', cols: 100, rows: 32 })
    expect([first.id, second.id]).toEqual(['gui-0', 'gui-1'])
    expect(spawnTerminal).toHaveBeenNthCalledWith(1, expect.objectContaining({
      argv: ['/bin/zsh'], cwd: '/tmp', cols: 80, rows: 24,
    }))
    expect(controller.list()).toEqual([{ id: first.id, alive: true }, { id: second.id, alive: true }])
    await ctx.fiber.dispose()
    expect(sessions.map(session => session.terminate.mock.calls.length)).toEqual([1, 1])
    expect(controller.list()).toEqual([])
  })

  it('uses a safe fallback shell when unset and PowerShell on Windows', async () => {
    const { controller, spawnTerminal } = harness()
    vi.stubEnv('SHELL', undefined)
    await controller.open({})
    expect(spawnTerminal).toHaveBeenNthCalledWith(1, expect.objectContaining({ argv: ['/bin/bash'] }))
    vi.stubEnv('SHELL', '')
    await controller.open({})
    expect(spawnTerminal).toHaveBeenNthCalledWith(2, expect.objectContaining({ argv: ['/bin/bash'] }))
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    if (platform === undefined) throw new Error('process.platform descriptor missing')
    try {
      Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
      await controller.open({})
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
    expect(spawnTerminal).toHaveBeenNthCalledWith(3, expect.objectContaining({ argv: ['powershell.exe', '-NoLogo'] }))
  })

  it('streams retained and live frames, then finishes when the PTY exits', async () => {
    const { controller, sessions } = harness()
    const opened = await controller.open({})
    const session = sessions[0]!
    session.output.write(Buffer.from('before'))
    const stream = controller.output({ id: opened.id, cursor: 0 }, new AbortController().signal)[Symbol.asyncIterator]()
    expect(await stream.next()).toEqual({ done: false, value: { seq: 0, data: 'before' } })
    const next = stream.next()
    await Promise.resolve()
    session.output.write(Buffer.from('after'))
    expect(await next).toEqual({ done: false, value: { seq: 1, data: 'after' } })
    const finished = stream.next()
    session.done.resolve({ exitCode: 0, signal: null })
    expect(await finished).toMatchObject({ done: true })
    expect(controller.list()).toEqual([{ id: opened.id, alive: false }])
    expect(controller.read({ id: opened.id, cursor: 2 })).toEqual({ frames: [], cursor: 2, alive: false })
  })

  it('stops a parked stream on cancellation and retains the newest 2048 frames', async () => {
    const { controller, sessions } = harness()
    const opened = await controller.open({})
    const session = sessions[0]!
    for (let index = 0; index < 2050; index += 1) session.output.write(Buffer.from(String(index)))
    const retained = controller.read({ id: opened.id, cursor: 0 })
    expect(retained.frames).toHaveLength(2048)
    expect(retained.frames[0]).toEqual({ seq: 2, data: '2' })
    expect(retained.cursor).toBe(2050)

    const abort = new AbortController()
    const stream = controller.output({ id: opened.id, cursor: retained.cursor }, abort.signal)[Symbol.asyncIterator]()
    const parked = stream.next()
    abort.abort(new Error('tab closed'))
    await expect(parked).rejects.toThrow('tab closed')
    expect(controller.list()).toEqual([{ id: opened.id, alive: true }])
    await expect(controller.output({ id: opened.id, cursor: 0 }, abort.signal)[Symbol.asyncIterator]().next())
      .rejects.toThrow('tab closed')
    session.done.reject(new Error('shell exited'))
    await vi.waitFor(() => {
      expect(controller.list()).toEqual([{ id: opened.id, alive: false }])
    })
  })
})
