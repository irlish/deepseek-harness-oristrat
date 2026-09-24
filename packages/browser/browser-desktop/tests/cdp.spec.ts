import { describe, expect, it } from 'vitest'
import {
  BROWSER_TRANSPORT_ERROR_CODES,
  BrowserError,
  BrowserTransportError,
  type BrowserErrorCode,
  type BrowserTransportErrorCode,
} from '@deepseek-ai/dsh-browser'
import { browserErrorOf, CdpSession } from '../src/cdp.ts'
import { fakeTransport } from './fake-browser-transport.ts'

/** Capability code each transport failure must become. */
const EXPECTED_CODES: Record<BrowserTransportErrorCode, BrowserErrorCode> = {
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

/** Failure a transport reports when the command outlived its deadline. */
function timeoutFailure(): DOMException {
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError')
}

describe('CdpSession command transport', () => {
  it('sends the method, parameters, and a combined deadline signal', async () => {
    const transport = fakeTransport(t => t.on('Page.reload', () => ({ ok: true })))
    const session = new CdpSession(transport, 1_000)

    await expect(session.send<{ ok: boolean }>('Page.reload', { ignoreCache: true })).resolves.toEqual({ ok: true })

    expect(transport.commands).toHaveLength(1)
    expect(transport.paramsOf('Page.reload')).toEqual({ ignoreCache: true })
    expect(transport.signalOf('Page.reload')).toBeInstanceOf(AbortSignal)
  })

  it('defaults the parameters to an empty object', async () => {
    const transport = fakeTransport(t => t.on('Page.enable', () => ({})))
    const session = new CdpSession(transport, 1_000)

    await session.send('Page.enable')

    expect(transport.paramsOf('Page.enable')).toEqual({})
  })

  it('combines the caller signal with the command deadline so cancellation reaches the transport', async () => {
    const transport = fakeTransport(t => t.on('Page.reload', () => ({})))
    const session = new CdpSession(transport, 1_000)
    const controller = new AbortController()

    await session.send('Page.reload', {}, controller.signal)
    const attached = transport.signalOf('Page.reload')
    expect(attached).not.toBe(controller.signal)
    expect(attached?.aborted).toBe(false)

    controller.abort()
    expect(attached?.aborted).toBe(true)
  })

  it('refuses to send when the caller signal is already aborted', async () => {
    const transport = fakeTransport(t => t.on('Page.reload', () => ({})))
    const session = new CdpSession(transport, 1_000)

    await expect(session.send('Page.reload', {}, AbortSignal.abort())).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_ABORTED', message: 'browser command aborted' }),
    )
    expect(transport.commands).toEqual([])
  })

  it('reports a command that outlived its deadline as BROWSER_TIMEOUT', async () => {
    const transport = fakeTransport(t => t.on('Page.reload', (_params, signal) => new Promise((_resolve, reject) => {
      if (signal === undefined) {
        reject(new Error('no deadline signal was attached'))
        return
      }
      signal.addEventListener('abort', () => { reject(timeoutFailure()) }, { once: true })
    })))
    const session = new CdpSession(transport, 5)

    await expect(session.send('Page.reload')).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_TIMEOUT',
      message: 'browser command Page.reload exceeded 5ms',
    }))
  })

  it('keeps a caller abort distinct from the deadline when both are present', async () => {
    const transport = fakeTransport(t => t.on('Page.reload', (_params, signal) => new Promise((_resolve, reject) => {
      if (signal === undefined) {
        reject(new Error('no deadline signal was attached'))
        return
      }
      signal.addEventListener('abort', () => { reject(timeoutFailure()) }, { once: true })
    })))
    const session = new CdpSession(transport, 5)

    await expect(session.send('Page.reload', {}, new AbortController().signal)).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_TIMEOUT' }),
    )
  })

  it('reports the abort the desktop transport raises on the deadline as BROWSER_TIMEOUT', async () => {
    const transport = fakeTransport(t => t.on('Page.reload', (_params, signal) => new Promise((_resolve, reject) => {
      if (signal === undefined) {
        reject(new Error('no deadline signal was attached'))
        return
      }
      signal.addEventListener('abort', () => { reject(new BrowserTransportError('browser command aborted by the deadline', 'aborted')) }, { once: true })
    })))
    const session = new CdpSession(transport, 5)

    await expect(session.send('Page.reload')).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_TIMEOUT',
      message: 'browser command Page.reload exceeded 5ms',
    }))
  })

  it('reports the caller abort when the deadline passed after the caller gave up', async () => {
    const transport = fakeTransport(t => t.on('Page.reload', () => new Promise((_resolve, reject) => {
      setTimeout(() => { reject(new BrowserTransportError('view closed', 'aborted')) }, 50)
    })))
    const session = new CdpSession(transport, 5)
    const controller = new AbortController()
    const pending = session.send('Page.reload', {}, controller.signal)

    controller.abort()

    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ABORTED', message: 'view closed' }))
  })

  it('reports a transport failure raised while the caller was aborting as BROWSER_ABORTED', async () => {
    const transport = fakeTransport(t => t.on('Page.reload', (_params, signal) => new Promise((_resolve, reject) => {
      if (signal === undefined) {
        reject(new Error('no deadline signal was attached'))
        return
      }
      signal.addEventListener('abort', () => { reject(new BrowserTransportError('view closed', 'aborted')) }, { once: true })
    })))
    const session = new CdpSession(transport, 1_000)
    const controller = new AbortController()
    const pending = session.send('Page.reload', {}, controller.signal)
    controller.abort()

    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ABORTED', message: 'view closed' }))
  })
})

describe('browserErrorOf', () => {
  for (const code of BROWSER_TRANSPORT_ERROR_CODES) {
    it(`maps the transport code ${code} to ${EXPECTED_CODES[code]}`, () => {
      const failure = new BrowserTransportError(`transport reported ${code}`, code)
      const mapped = browserErrorOf(failure)

      expect(mapped).toBeInstanceOf(BrowserError)
      expect(mapped.code).toBe(EXPECTED_CODES[code])
      expect(mapped.message).toBe(`transport reported ${code}`)
      expect(mapped.cause).toBe(failure)
    })
  }

  it('returns an existing capability error unchanged', () => {
    const failure = new BrowserError('origin refused', 'BROWSER_ORIGIN_DENIED')

    expect(browserErrorOf(failure)).toBe(failure)
  })

  it('maps an unrelated Error to BROWSER_PROTOCOL and keeps it as the cause', () => {
    const failure = new Error('socket exploded')
    const mapped = browserErrorOf(failure)

    expect(mapped.code).toBe('BROWSER_PROTOCOL')
    expect(mapped.message).toBe('socket exploded')
    expect(mapped.cause).toBe(failure)
  })

  it('maps a non-Error throw to BROWSER_PROTOCOL by its text form', () => {
    const mapped = browserErrorOf({ odd: true })

    expect(mapped.code).toBe('BROWSER_PROTOCOL')
    expect(mapped.message).toBe('[object Object]')
  })
})

describe('CdpSession.evaluate', () => {
  it('evaluates by value, awaiting promises, and returns the raw value', async () => {
    const transport = fakeTransport(t => t.on('Runtime.evaluate', params => (
      params.expression === 'window.title' ? { result: { value: 'Example' } } : { result: {} }
    )))
    const session = new CdpSession(transport, 1_000)

    await expect(session.evaluate<string>('window.title')).resolves.toBe('Example')
    expect(transport.paramsOf('Runtime.evaluate')).toEqual({
      expression: 'window.title',
      returnByValue: true,
      awaitPromise: true,
    })
  })

  it('reports the exception description when page script throws', async () => {
    const transport = fakeTransport(t => t.on('Runtime.evaluate', () => ({
      result: {},
      exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: nope is not a function' } },
    })))
    const session = new CdpSession(transport, 1_000)

    await expect(session.evaluate('nope()')).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_ACTION_FAILED',
      message: 'page script failed: TypeError: nope is not a function',
    }))
  })

  it('falls back to the exception text when the browser sent no description', async () => {
    const transport = fakeTransport(t => t.on('Runtime.evaluate', () => ({
      result: {},
      exceptionDetails: { text: 'SyntaxError: unexpected token' },
    })))
    const session = new CdpSession(transport, 1_000)

    await expect(session.evaluate('(((')).rejects.toThrow(
      expect.objectContaining({ message: 'page script failed: SyntaxError: unexpected token' }),
    )
  })

  it('names a generic page-script failure when the browser reported no detail', async () => {
    const transport = fakeTransport(t => t.on('Runtime.evaluate', () => ({ result: {}, exceptionDetails: {} })))
    const session = new CdpSession(transport, 1_000)

    await expect(session.evaluate('boom()')).rejects.toThrow(
      expect.objectContaining({ message: 'page script failed: evaluation failed' }),
    )
  })

  it('returns undefined for a value the page did not produce', async () => {
    const transport = fakeTransport(t => t.on('Runtime.evaluate', () => ({ result: {} })))
    const session = new CdpSession(transport, 1_000)

    await expect(session.evaluate<string>('void 0')).resolves.toBeUndefined()
  })
})

describe('CdpSession.viewport', () => {
  it('rounds the reported window size to integer CSS pixels', async () => {
    const transport = fakeTransport(t => t.on('Runtime.evaluate', () => ({
      result: { value: { width: 1023.6, height: 768.4 } },
    })))
    const session = new CdpSession(transport, 1_000)

    await expect(session.viewport()).resolves.toEqual({ width: 1024, height: 768 })
    expect(transport.paramsOf('Runtime.evaluate').expression).toBe('({ width: window.innerWidth, height: window.innerHeight })')
  })
})
