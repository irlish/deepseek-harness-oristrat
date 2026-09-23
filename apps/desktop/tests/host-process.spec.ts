import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopHostProcess } from '../src/host-process.ts'
import { DesktopBrowserCdpError } from '../src/browser-cdp.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'

const roots: string[] = []

const HOST_WIRE = `
import { closeSync, createReadStream, createWriteStream } from 'node:fs'
const requestPipe = createReadStream('', { fd: 3, autoClose: false })
const responsePipe = createWriteStream('', { fd: 4, autoClose: false })
const MAGIC = 0x44534833
const HEADER = 13
function responseFrame(type, streamId, payload = Buffer.alloc(0)) {
  const frame = Buffer.allocUnsafe(HEADER + payload.length)
  frame.writeUInt32BE(MAGIC, 0)
  frame.writeUInt8(type, 4)
  frame.writeUInt32BE(streamId, 5)
  frame.writeUInt32BE(payload.length, 9)
  payload.copy(frame, HEADER)
  return frame
}
function responseStart(streamId, options = {}) {
  const value = { status: options.status ?? 200, headers: options.headers ?? [], hasBody: options.hasBody ?? true }
  responsePipe.write(responseFrame(1, streamId, Buffer.from(JSON.stringify(value))))
}
function responseData(streamId, data) {
  responsePipe.write(responseFrame(2, streamId, Buffer.from(data)))
}
function responseEnd(streamId) { responsePipe.write(responseFrame(3, streamId)) }
function responseError(streamId, message) {
  responsePipe.write(responseFrame(4, streamId, Buffer.from(JSON.stringify({ message }))))
}
let requestBuffer = Buffer.alloc(0)
requestPipe.on('data', chunk => {
  requestBuffer = requestBuffer.length === 0 ? chunk : Buffer.concat([requestBuffer, chunk])
  while (requestBuffer.length >= HEADER) {
    if (requestBuffer.readUInt32BE(0) !== MAGIC) throw new Error('invalid request marker')
    const type = requestBuffer.readUInt8(4)
    const streamId = requestBuffer.readUInt32BE(5)
    const length = requestBuffer.readUInt32BE(9)
    if (requestBuffer.length < HEADER + length) return
    const payload = requestBuffer.subarray(HEADER, HEADER + length)
    requestBuffer = requestBuffer.subarray(HEADER + length)
    onRequestFrame({ type, streamId, payload })
  }
})
process.on('message', message => {
  if (message.type === 'shutdown') {
    requestPipe.destroy()
    closeSync(3)
    responsePipe.end(() => {
      responsePipe.destroy()
      closeSync(4)
      process.disconnect()
      process.exitCode = 0
    })
  }
})
`

function projectWithHost(source: string): string {
  const project = mkdtempSync(join(tmpdir(), 'dsh-desktop-host-test-'))
  roots.push(project)
  const packageRoot = join(project, 'node_modules', '@deepseek-ai', 'dsh-desktop-host')
  mkdirSync(join(packageRoot, 'lib'), { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), '{"name":"@deepseek-ai/dsh-desktop-host","type":"module"}\n')
  writeFileSync(join(packageRoot, 'lib', 'index.js'), `${HOST_WIRE}\n${source}`)
  return project
}

/**
 * Child Host that raises one brokered browser command for every request and
 * answers that request with the replies it received, so the test observes the
 * exact bytes the application process sent back.
 */
function browserCdpProject(): string {
  return projectWithHost(`
const replies = []
let waiting
process.send({ type: 'ready', protocolVersion: ${String(DESKTOP_HOST_PROTOCOL_VERSION)}, dshVersion: 'browser-cdp' })
process.on('message', message => {
  if (message.type === 'shutdown' || waiting === undefined) return
  replies.push(message)
  const streamId = waiting
  waiting = undefined
  responseStart(streamId, { headers: [['content-type', 'application/json']] })
  responseData(streamId, JSON.stringify(replies.splice(0)))
  responseEnd(streamId)
})
function onRequestFrame(frame) {
  if (frame.type !== 1) return
  const method = new URL(JSON.parse(frame.payload).url).searchParams.get('method')
  process.send({ type: 'browser/cdp', requestId: 41, method, params: { url: 'https://example.com' } })
  waiting = frame.streamId
}
`)
}

/** Child Host that raises one brokered browser command and answers the request immediately. */
function browserCdpRaiseProject(): string {
  return projectWithHost(`
process.send({ type: 'ready', protocolVersion: ${String(DESKTOP_HOST_PROTOCOL_VERSION)}, dshVersion: 'browser-cdp-raise' })
function onRequestFrame(frame) {
  if (frame.type !== 1) return
  const method = new URL(JSON.parse(frame.payload).url).searchParams.get('method')
  process.send({ type: 'browser/cdp', requestId: 7, method, params: {} })
  responseStart(frame.streamId, { headers: [['content-type', 'application/json']] })
  responseData(frame.streamId, JSON.stringify({ raised: method }))
  responseEnd(frame.streamId)
}
`)
}

/** One manually settled promise. */
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop host process', () => {
  it('reports a fatal event after readiness once and stops the child', async () => {
    const runtime = projectWithHost(`
process.send({ type: 'ready', protocolVersion: ${String(DESKTOP_HOST_PROTOCOL_VERSION)}, dshVersion: '1.0.0' })
function onRequestFrame(frame) {
  if (frame.type === 1) process.send({ type: 'fatal', message: 'plugin unavailable' })
}
`)
    const failure = vi.fn()
    const host = new DesktopHostProcess(process.execPath, runtime, runtime, undefined, process.env, failure)
    try {
      await host.start()
      await expect(host.fetch(new Request('dsh-app://app/'))).rejects.toThrow('plugin unavailable')
      await host.stop()
      expect(failure).toHaveBeenCalledTimes(1)
      expect(failure).toHaveBeenCalledWith(new Error('plugin unavailable'))
    } finally { await host.stop() }
  })

  it('settles teardown when the executable cannot be spawned', async () => {
    const runtime = projectWithHost('function onRequestFrame() {}')
    const host = new DesktopHostProcess(join(runtime, 'missing-node'), runtime, runtime)
    try { await expect(host.start()).rejects.toThrow() } finally { await host.stop() }
  })

  it('loads the resource entry with a separate profile and scrubs Node resolution overrides', async () => {
    const runtime = projectWithHost(`
process.send({ type: 'ready', protocolVersion: ${String(DESKTOP_HOST_PROTOCOL_VERSION)}, dshVersion: 'split-runtime' })
function onRequestFrame(frame) {
  if (frame.type !== 1) return
  responseStart(frame.streamId)
  responseData(frame.streamId, JSON.stringify({runtime: process.argv[2], profile: process.argv[3], cwd: process.cwd(), nodePath: process.env.NODE_PATH}))
  responseEnd(frame.streamId)
}
`)
    const profile = mkdtempSync(join(tmpdir(), 'desktop-external-profile-'))
    roots.push(profile)
    const host = new DesktopHostProcess(process.execPath, runtime, profile, undefined, {
      ...process.env, NODE_OPTIONS: '--invalid-desktop-test-option', NODE_PATH: '/unowned',
    })
    try {
      const response = await host.fetch(new Request('dsh-app://app/environment'))
      expect(await response.json()).toEqual({ runtime, profile, cwd: realpathSync(profile) })
    } finally { await host.stop() }
  })

  it('carries raw request and response bytes and shuts the child down cleanly', async () => {
    const project = projectWithHost(`
const bodies = new Map()
process.send({ type: 'ready', protocolVersion: ${String(DESKTOP_HOST_PROTOCOL_VERSION)}, dshVersion: process.env.NODE_OPTIONS ?? 'clean' })
function onRequestFrame(frame) {
  if (frame.type === 1) {
    const request = JSON.parse(frame.payload)
    bodies.set(frame.streamId, Buffer.alloc(0))
    if (!request.hasBody) answer(frame.streamId)
  } else if (frame.type === 2) {
    bodies.set(frame.streamId, Buffer.concat([bodies.get(frame.streamId), frame.payload]))
  } else if (frame.type === 3) {
    answer(frame.streamId)
  }
}
function answer(streamId) {
  responseStart(streamId, { headers: [['content-type', 'text/plain']] })
  responseData(streamId, Buffer.concat([Buffer.from('desktop:'), bodies.get(streamId)]))
  responseEnd(streamId)
}
`)
    const previous = process.env.NODE_OPTIONS
    process.env.NODE_OPTIONS = '--require /path/that-must-not-reach-the-child'
    const host = new DesktopHostProcess(process.execPath, project, project)
    try {
      await expect(host.start()).resolves.toMatchObject({ dshVersion: 'clean' })
      const response = await host.fetch(new Request('dsh-app://app/example', { method: 'POST', body: 'request' }))
      expect(response.status).toBe(200)
      await expect(response.text()).resolves.toBe('desktop:request')
      await expect(host.stop()).resolves.toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS
      else process.env.NODE_OPTIONS = previous
      await host.stop().catch(() => undefined)
    }
  })

  it('streams a large binary response in bounded raw frames', async () => {
    const size = 2 * 1024 * 1024
    const project = projectWithHost(`
process.send({ type: 'ready', protocolVersion: ${String(DESKTOP_HOST_PROTOCOL_VERSION)}, dshVersion: 'large-response' })
function onRequestFrame(frame) {
  if (frame.type !== 1) return
  responseStart(frame.streamId)
  const bytes = Buffer.alloc(${String(64 * 1024)}, 97)
  for (let offset = 0; offset < ${String(size)}; offset += bytes.length) responseData(frame.streamId, bytes)
  responseEnd(frame.streamId)
}
`)
    const host = new DesktopHostProcess(process.execPath, project, project)
    try {
      const response = await host.fetch(new Request('dsh-app://app/large'))
      const body = new Uint8Array(await response.arrayBuffer())
      expect(body).toHaveLength(size)
      expect(body[0]).toBe(97)
      expect(body.at(-1)).toBe(97)
    } finally {
      await host.stop().catch(() => undefined)
    }
  })

  it('stops an unfinished upload when the Host completes its response early', async () => {
    const project = projectWithHost(`
process.send({ type: 'ready', protocolVersion: ${String(DESKTOP_HOST_PROTOCOL_VERSION)}, dshVersion: 'early-response' })
function onRequestFrame(frame) {
  if (frame.type !== 2) return
  responseStart(frame.streamId)
  responseData(frame.streamId, 'accepted')
  responseEnd(frame.streamId)
}
`)
    let canceled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Buffer.from('first')) },
      cancel() { canceled = true },
    })
    const host = new DesktopHostProcess(process.execPath, project, project)
    try {
      const request = new Request('dsh-app://app/early', {
        method: 'POST',
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' })
      const response = await host.fetch(request)
      await expect(response.text()).resolves.toBe('accepted')
      await expect.poll(() => canceled).toBe(true)
    } finally {
      await host.stop().catch(() => undefined)
    }
  })

  it('ignores a response end that arrives after the renderer cancels its stream', async () => {
    const project = projectWithHost(`
process.send({ type: 'ready', protocolVersion: ${String(DESKTOP_HOST_PROTOCOL_VERSION)}, dshVersion: 'cancel-race' })
const urls = new Map()
function onRequestFrame(frame) {
  if (frame.type === 1) {
    const request = JSON.parse(frame.payload)
    urls.set(frame.streamId, request.url)
    responseStart(frame.streamId)
    if (request.url.endsWith('/after')) {
      responseData(frame.streamId, 'alive')
      responseEnd(frame.streamId)
    }
  } else if (frame.type === 4 && urls.get(frame.streamId).endsWith('/cancel')) {
    responseEnd(frame.streamId)
  }
}
`)
    const host = new DesktopHostProcess(process.execPath, project, project)
    try {
      const canceled = await host.fetch(new Request('dsh-app://app/cancel'))
      await canceled.body?.cancel()
      await new Promise(resolve => setTimeout(resolve, 25))
      const after = await host.fetch(new Request('dsh-app://app/after'))
      await expect(after.text()).resolves.toBe('alive')
    } finally {
      await host.stop().catch(() => undefined)
    }
  })

  it('rejects invalid response framing and a clean exit before readiness', async () => {
    const invalid = new DesktopHostProcess(process.execPath, projectWithHost(`
process.send({ type: 'ready', protocolVersion: ${String(DESKTOP_HOST_PROTOCOL_VERSION)}, dshVersion: 'invalid-frame' })
function onRequestFrame(frame) {
  if (frame.type === 1) responsePipe.write(Buffer.alloc(13))
}
`), projectWithHost(''))
    await invalid.start()
    await expect(invalid.fetch(new Request('dsh-app://app/invalid'))).rejects.toThrow(/invalid Host response frame marker/u)
    await invalid.stop().catch(() => undefined)

    const earlyExit = new DesktopHostProcess(process.execPath, projectWithHost(`
function onRequestFrame() {}
process.exit(0)
`), projectWithHost(''))
    await expect(earlyExit.start()).rejects.toThrow(/response pipe ended/u)
  })
})

describe('desktop host process browser commands', () => {
  it('runs a brokered command and returns its result to the Host', async () => {
    const project = browserCdpProject()
    const host = new DesktopHostProcess(process.execPath, project, project)
    host.setBrowserCdpHandler(async (method, params) => ({ method, params, frameId: 'F1' }))
    try {
      const response = await host.fetch(new Request('dsh-app://app/browser?method=Page.navigate'))

      expect(await response.json()).toEqual([{
        type: 'browser/cdp-result',
        requestId: 41,
        result: { method: 'Page.navigate', params: { url: 'https://example.com' }, frameId: 'F1' },
      }])
    } finally {
      await host.stop().catch(() => undefined)
    }
  })

  it('reports a handler failure with the code the browser provider routes on', async () => {
    const project = browserCdpProject()
    const host = new DesktopHostProcess(process.execPath, project, project)
    host.setBrowserCdpHandler(async (method) => {
      if (method === 'Page.navigate') {
        throw new DesktopBrowserCdpError('method-not-allowed', 'dsh desktop: browser method Page.navigate is not available to automation')
      }
      if (method === 'Runtime.evaluate') throw new Error('the pane closed its debugging session')
      throw 'pane gone'
    })
    try {
      const refused = await host.fetch(new Request('dsh-app://app/browser?method=Page.navigate'))
      expect(await refused.json()).toEqual([{
        type: 'browser/cdp-error',
        requestId: 41,
        code: 'method-not-allowed',
        message: 'dsh desktop: browser method Page.navigate is not available to automation',
      }])

      const failed = await host.fetch(new Request('dsh-app://app/browser?method=Runtime.evaluate'))
      expect(await failed.json()).toEqual([{
        type: 'browser/cdp-error',
        requestId: 41,
        code: 'protocol-error',
        message: 'the pane closed its debugging session',
      }])

      const described = await host.fetch(new Request('dsh-app://app/browser?method=Page.reload'))
      expect(await described.json()).toEqual([{
        type: 'browser/cdp-error',
        requestId: 41,
        code: 'protocol-error',
        message: 'pane gone',
      }])
    } finally {
      await host.stop().catch(() => undefined)
    }
  })

  it('answers a brokered command with closed when no handler is installed', async () => {
    const project = browserCdpProject()
    const host = new DesktopHostProcess(process.execPath, project, project)
    try {
      const response = await host.fetch(new Request('dsh-app://app/browser?method=Page.enable'))

      expect(await response.json()).toEqual([{
        type: 'browser/cdp-error',
        requestId: 41,
        code: 'closed',
        message: 'dsh desktop: this application serves no browser pane',
      }])
    } finally {
      await host.stop().catch(() => undefined)
    }
  })

  it('drops a brokered command that settles after the child went away', async () => {
    const project = browserCdpRaiseProject()
    const failure = vi.fn()
    const host = new DesktopHostProcess(process.execPath, project, project, undefined, process.env, failure)
    const started = deferred<undefined>()
    const gate = deferred<unknown>()
    host.setBrowserCdpHandler(async () => {
      started.resolve(undefined)
      return await gate.promise
    })
    try {
      const response = await host.fetch(new Request('dsh-app://app/browser?method=Page.enable'))
      expect(await response.json()).toEqual({ raised: 'Page.enable' })
      await started.promise
      await host.stop()

      // The child is gone by now, so answering this command has no reader and
      // must not raise: an attempt would reject serveBrowserCdp unhandled.
      gate.resolve({ frameId: 'F1' })
      await new Promise(resolve => setTimeout(resolve, 25))
      expect(failure).toHaveBeenCalledTimes(1)
      const reported = failure.mock.calls[0]?.[0] as Error
      expect(reported).toBeInstanceOf(Error)
      expect(reported.message).toMatch(/dsh desktop host (?:stopped|response pipe ended)/u)
    } finally {
      await host.stop().catch(() => undefined)
    }
  })

  it('refuses a Host that reports another protocol version', async () => {
    const project = projectWithHost(`
process.send({ type: 'ready', protocolVersion: 3, dshVersion: '1.0.0' })
function onRequestFrame() {}
`)
    const host = new DesktopHostProcess(process.execPath, project, project)
    try {
      await expect(host.start()).rejects.toThrow(/invalid IPC event/u)
    } finally {
      await host.stop().catch(() => undefined)
    }
  })

  it('refuses a brokered browser event that carries no request id', async () => {
    const project = projectWithHost(`
process.send({ type: 'ready', protocolVersion: ${String(DESKTOP_HOST_PROTOCOL_VERSION)}, dshVersion: 'malformed-cdp' })
process.send({ type: 'browser/cdp', requestId: 'first', method: 'Page.enable' })
function onRequestFrame() {}
`)
    const failure = vi.fn()
    const host = new DesktopHostProcess(process.execPath, project, project, undefined, process.env, failure)
    try {
      await host.start()

      await expect.poll(() => failure.mock.calls.length).toBe(1)
      const reported = failure.mock.calls[0]?.[0] as Error
      expect(reported.message).toBe('dsh desktop host sent an invalid IPC event')
    } finally {
      await host.stop().catch(() => undefined)
    }
  })
})
