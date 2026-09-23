import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserTransportError } from '@deepseek-ai/dsh-browser'
import { DesktopBrowserChannel } from '../src/browser-channel.ts'
import type { DesktopHostEvent } from '../src/index.ts'

/** One posted event recorded by the fake application channel. */
type PostedEvent = Extract<DesktopHostEvent, { type: 'browser/cdp' }>

function channel(post?: (event: DesktopHostEvent) => void, backstopMs?: number) {
  const events: PostedEvent[] = []
  const sent = vi.fn<(event: DesktopHostEvent) => void>(post ?? ((event) => {
    if (event.type === 'browser/cdp') events.push(event)
  }))
  const transport = new DesktopBrowserChannel(sent, backstopMs)
  return { transport, sent, events }
}

/** Run one command and return the typed transport failure it raised. */
async function failureOf(work: Promise<unknown>): Promise<BrowserTransportError> {
  const outcome = await work.then(() => undefined, (reason: unknown) => reason)
  expect(outcome).toBeInstanceOf(BrowserTransportError)
  return outcome as BrowserTransportError
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DesktopBrowserChannel', () => {
  it('posts one application event per command, numbered from the first request', async () => {
    const { transport, events } = channel()

    const first = transport.send('Page.navigate', { url: 'https://example.com' })
    const second = transport.send('Page.reload', undefined)

    expect(events).toStrictEqual([
      { type: 'browser/cdp', requestId: 1, method: 'Page.navigate', params: { url: 'https://example.com' } },
      { type: 'browser/cdp', requestId: 2, method: 'Page.reload', params: undefined },
    ])

    transport.settle({ type: 'browser/cdp-result', requestId: 1, result: { frameId: 'F1' } })
    transport.settle({ type: 'browser/cdp-result', requestId: 2, result: 'reloaded' })
    await expect(first).resolves.toEqual({ frameId: 'F1' })
    await expect(second).resolves.toBe('reloaded')
  })

  it('settles the request a late reply belongs to and ignores an unknown request id', async () => {
    const { transport, events } = channel()
    const first = transport.send('Page.enable', {})
    const second = transport.send('DOM.enable', {})

    transport.settle({ type: 'browser/cdp-result', requestId: events[0]!.requestId, result: 'domains' })
    transport.settle({ type: 'browser/cdp-result', requestId: 999, result: 'stray' })
    transport.settle({ type: 'browser/cdp-error', requestId: 999, code: 'closed', message: 'stray' })

    await expect(first).resolves.toBe('domains')
    transport.settle({ type: 'browser/cdp-result', requestId: events[1]!.requestId, result: 'second' })
    await expect(second).resolves.toBe('second')
  })

  it('fails a request with the code and message the shell reported', async () => {
    const { transport, events } = channel()

    const work = transport.send('Page.captureScreenshot', { format: 'png' })
    transport.settle({
      type: 'browser/cdp-error',
      requestId: events[0]!.requestId,
      code: 'payload-too-large',
      message: 'dsh desktop: the capture exceeds the 8MiB image limit',
    })

    const failure = await failureOf(work)
    expect(failure.code).toBe('payload-too-large')
    expect(failure.message).toBe('dsh desktop: the capture exceeds the 8MiB image limit')
  })

  it('fails every waiting request when the pane or the application goes away', async () => {
    const { transport, events } = channel()
    const first = transport.send('Page.enable', {})
    const second = transport.send('DOM.enable', {})

    transport.fail('closed', 'the desktop Host is stopping')

    const failures = await Promise.all([failureOf(first), failureOf(second)])
    for (const failure of failures) {
      expect(failure.code).toBe('closed')
      expect(failure.message).toBe('the desktop Host is stopping')
    }
    // A reply that raced the failure settles nothing and reports nothing.
    transport.settle({ type: 'browser/cdp-result', requestId: events[0]!.requestId, result: 'late' })
  })

  it('rejects a cancelled command without ever posting it', async () => {
    const { transport, sent, events } = channel()
    const controller = new AbortController()
    controller.abort(new Error('user cancelled'))

    const failure = await failureOf(transport.send('Page.navigate', { url: 'https://example.com' }, controller.signal))

    expect(failure.code).toBe('aborted')
    expect(failure.message).toBe('browser command Page.navigate was cancelled')
    expect(sent).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })

  it('rejects a command cancelled after it was posted and ignores its reply', async () => {
    const { transport, events } = channel()
    const controller = new AbortController()

    const work = transport.send('Page.reload', {}, controller.signal)
    controller.abort()

    const failure = await failureOf(work)
    expect(failure.code).toBe('aborted')
    expect(failure.message).toBe('browser command Page.reload was cancelled')
    transport.settle({ type: 'browser/cdp-result', requestId: events[0]!.requestId, result: 'reloaded' })
  })

  it('rejects a command that got no reply within the backstop deadline', async () => {
    vi.useFakeTimers()
    const { transport } = channel(undefined, 500)

    const work = transport.send('Page.reload', {})
    let settled = false
    void work.then(() => { settled = true }, () => { settled = true })
    await vi.advanceTimersByTimeAsync(499)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    const failure = await failureOf(work)
    expect(failure.code).toBe('timeout')
    expect(failure.message).toBe('browser command Page.reload got no reply within 500ms')
  })

  it('rejects a command the application channel could not carry', async () => {
    const unreachable = vi.fn<(event: DesktopHostEvent) => void>(() => { throw new Error('channel closed') })
    const { transport } = channel(unreachable)

    const failure = await failureOf(transport.send('Page.enable', {}))

    expect(failure.code).toBe('closed')
    expect(failure.message)
      .toBe('browser command Page.enable could not reach the application: channel closed')
    expect(unreachable).toHaveBeenCalledOnce()
  })

  it('describes a non-Error failure from the application channel', async () => {
    const unreachable = vi.fn<(event: DesktopHostEvent) => void>(() => { throw 'channel gone' })
    const { transport } = channel(unreachable)

    const failure = await failureOf(transport.send('Page.enable', {}))

    expect(failure.code).toBe('closed')
    expect(failure.message).toContain('could not reach the application: channel gone')
  })
})
