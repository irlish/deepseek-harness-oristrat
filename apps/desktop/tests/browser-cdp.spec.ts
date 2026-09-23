import { describe, expect, it, vi } from 'vitest'
import type { DesktopBrowserViewController } from '../src/browser-view.ts'
import { DesktopBrowserCdpBroker, DesktopBrowserCdpError } from '../src/browser-cdp.ts'

/**
 * Largest captured image the broker forwards, in decoded bytes. Mirrors the
 * module-private constant it enforces; the sizes below sit on both sides of it.
 */
const IMAGE_LIMIT_BYTES = 8 * 1024 * 1024

/** Base64 length whose decoded size is exactly one unit under the limit. */
const DATA_AT_LIMIT = 'A'.repeat(Math.floor(IMAGE_LIMIT_BYTES * 4 / 3))

/** Base64 length whose decoded size is the first unit over the limit. */
const DATA_OVER_LIMIT = 'A'.repeat(Math.floor(IMAGE_LIMIT_BYTES * 4 / 3) + 1)

/** Debugging session of one fake pane's contents. */
interface FakeDebugger {
  isAttached: ReturnType<typeof vi.fn<() => boolean>>
  attach: ReturnType<typeof vi.fn<(version: string) => void>>
  detach: ReturnType<typeof vi.fn<() => void>>
  sendCommand: ReturnType<typeof vi.fn<(method: string, params?: unknown) => Promise<unknown>>>
}

/** Fake `WebContents` the broker attaches its debugging session to. */
interface FakeContents {
  isDestroyed: ReturnType<typeof vi.fn<() => boolean>>
  isDevToolsOpened: ReturnType<typeof vi.fn<() => boolean>>
  setBackgroundThrottling: ReturnType<typeof vi.fn<(throttle: boolean) => void>>
  debugger: FakeDebugger
}

function fakeContents(): FakeContents {
  return {
    isDestroyed: vi.fn<() => boolean>(() => false),
    isDevToolsOpened: vi.fn<() => boolean>(() => false),
    setBackgroundThrottling: vi.fn<(throttle: boolean) => void>(),
    debugger: {
      // A pane nobody drives yet carries no debugging session.
      isAttached: vi.fn<() => boolean>(() => false),
      attach: vi.fn<(version: string) => void>(),
      detach: vi.fn<() => void>(),
      sendCommand: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(),
    },
  }
}

/** One manually settled promise, for asserting what happens while a command runs. */
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

/** Fake pane controller and the callbacks the broker reports through. */
function fixture() {
  const contents = fakeContents()
  const pane = {
    isAttached: vi.fn<() => boolean>(() => true),
    contents: vi.fn<() => FakeContents | undefined>(() => contents),
  }
  const reveal = vi.fn<() => Promise<boolean>>(async () => true)
  const activity = vi.fn<(method: string, active: boolean) => void>()
  const broker = new DesktopBrowserCdpBroker(
    () => pane as unknown as DesktopBrowserViewController,
    reveal,
    activity,
  )
  return { broker, pane, contents, reveal, activity }
}

/** Run one dispatch and return the typed failure it raised. */
async function failureOf(work: Promise<unknown>): Promise<DesktopBrowserCdpError> {
  const outcome = await work.then(() => undefined, (reason: unknown) => reason)
  expect(outcome).toBeInstanceOf(DesktopBrowserCdpError)
  return outcome as DesktopBrowserCdpError
}

/** Wait for one real timer tick, so a wrongly eager command has time to appear. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 5))
}

describe('DesktopBrowserCdpBroker', () => {
  it('refuses a method outside the automation allowlist before touching the pane', async () => {
    const { broker, pane, activity } = fixture()

    const failure = await failureOf(broker.dispatch('Browser.setDownloadBehavior', { behavior: 'allow' }))

    expect(failure.code).toBe('method-not-allowed')
    expect(failure.message).toContain('Browser.setDownloadBehavior')
    expect(failure.message).toContain('is not available to automation')
    expect(pane.isAttached).not.toHaveBeenCalled()
    expect(activity).not.toHaveBeenCalled()
  })

  it('shows a pane the user has not opened, attaches once, and runs the command', async () => {
    const { broker, pane, contents, reveal } = fixture()
    pane.isAttached.mockReturnValue(false)
    reveal.mockImplementation(async () => { pane.isAttached.mockReturnValue(true); return true })
    contents.debugger.sendCommand.mockResolvedValue({ frameId: 'F1' })

    await expect(broker.dispatch('Page.navigate', { url: 'https://example.com' })).resolves.toEqual({ frameId: 'F1' })

    expect(reveal).toHaveBeenCalledOnce()
    expect(pane.isAttached).toHaveBeenCalled()
    expect(contents.debugger.attach).toHaveBeenCalledWith('1.3')
    expect(contents.setBackgroundThrottling).toHaveBeenCalledWith(false)
    expect(contents.debugger.sendCommand).toHaveBeenCalledWith('Page.navigate', { url: 'https://example.com' })
    expect(contents.debugger.attach).toHaveBeenCalledOnce()
    expect(contents.debugger.detach).not.toHaveBeenCalled()
  })

  it('reuses the debugging session it already attached', async () => {
    const { broker, contents } = fixture()

    await broker.dispatch('Page.enable', {})
    await broker.dispatch('DOM.enable', {})

    expect(contents.debugger.attach).toHaveBeenCalledOnce()
    expect(contents.setBackgroundThrottling).toHaveBeenCalledOnce()
  })

  it('reports a reveal that never attached the pane as not open', async () => {
    const { broker, pane, contents, reveal, activity } = fixture()
    pane.isAttached.mockReturnValue(false)
    reveal.mockResolvedValue(false)

    const failure = await failureOf(broker.dispatch('Page.reload', {}))

    expect(failure.code).toBe('not-open')
    expect(failure.message).toContain('the application did not show it')
    expect(reveal).toHaveBeenCalledOnce()
    expect(contents.debugger.attach).not.toHaveBeenCalled()
    expect(activity).not.toHaveBeenCalled()
  })

  it('reports an attached pane whose view was destroyed as not open', async () => {
    const { broker, pane, contents } = fixture()
    pane.contents.mockReturnValue(undefined)

    const failure = await failureOf(broker.dispatch('Page.reload', {}))

    expect(failure.code).toBe('not-open')
    expect(failure.message).toBe('dsh desktop: the browser pane is not open')
    expect(contents.debugger.sendCommand).not.toHaveBeenCalled()
  })

  it('releases a debugging session the broker does not own before attaching', async () => {
    const { broker, contents } = fixture()
    contents.debugger.isAttached.mockReturnValue(true)

    await broker.dispatch('Page.enable', {})

    expect(contents.debugger.detach).toHaveBeenCalledOnce()
    expect(contents.debugger.attach).toHaveBeenCalledWith('1.3')
  })

  it('attaches to a view the pane recreated instead of reusing the old session', async () => {
    const { broker, pane, contents } = fixture()
    await broker.dispatch('Page.enable', {})
    const recreated = fakeContents()
    pane.contents.mockReturnValue(recreated)

    await broker.dispatch('Page.enable', {})

    expect(recreated.debugger.attach).toHaveBeenCalledWith('1.3')
    expect(recreated.setBackgroundThrottling).toHaveBeenCalledWith(false)
    expect(recreated.debugger.sendCommand).toHaveBeenCalledWith('Page.enable', {})
    expect(contents.debugger.sendCommand).toHaveBeenCalledOnce()
  })

  it('reports an attach that failed while the pane DevTools window is closed', async () => {
    const { broker, contents } = fixture()
    contents.debugger.attach.mockImplementation(() => { throw new Error('Another debugger is already attached') })

    const failure = await failureOf(broker.dispatch('Page.enable', {}))

    expect(failure.code).toBe('attach-failed')
    expect(failure.message).toContain('could not attach to the browser pane')
    expect(failure.message).toContain('Another debugger is already attached')
    expect(failure.message).not.toContain('DevTools')
    expect(contents.debugger.sendCommand).not.toHaveBeenCalled()
  })

  it('names the open DevTools window when that is why the attach failed', async () => {
    const { broker, contents } = fixture()
    contents.isDevToolsOpened.mockReturnValue(true)
    contents.debugger.attach.mockImplementation(() => { throw new Error('Another debugger is already attached') })

    const failure = await failureOf(broker.dispatch('Page.enable', {}))

    expect(failure.code).toBe('devtools-open')
    expect(failure.message).toContain('close the pane DevTools window and try again')
  })

  it('reports a command that outlived its deadline as a timeout and stops reporting activity', async () => {
    vi.useFakeTimers()
    try {
      const { broker, contents, activity } = fixture()
      contents.debugger.sendCommand.mockReturnValue(new Promise(() => {}))

      const work = broker.dispatch('Runtime.evaluate', { expression: '1' })
      const failure = failureOf(work)
      await vi.advanceTimersByTimeAsync(29_999)
      expect(activity.mock.calls).toEqual([['Runtime.evaluate', true]])
      await vi.advanceTimersByTimeAsync(1)

      await expect(failure).resolves.toMatchObject({ code: 'timeout' })
      const settled = await failure
      expect(settled.message).toContain('did not answer within 30000ms')
      expect(activity.mock.calls[0]).toEqual(['Runtime.evaluate', true])
      expect(activity.mock.calls.at(-1)).toEqual(['Runtime.evaluate', false])
      expect(activity.mock.calls.filter(call => call[1])).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('forwards a capture exactly at the image limit and refuses one over it', async () => {
    const { broker, contents } = fixture()
    const atLimit = { data: DATA_AT_LIMIT }
    contents.debugger.sendCommand.mockResolvedValueOnce(atLimit)
      .mockResolvedValueOnce({ data: DATA_OVER_LIMIT })
      .mockResolvedValueOnce({ data: DATA_OVER_LIMIT })

    await expect(broker.dispatch('Page.captureScreenshot', { format: 'jpeg' })).resolves.toBe(atLimit)

    const wholePage = await failureOf(broker.dispatch('Page.captureScreenshot', { captureBeyondViewport: true }))
    expect(wholePage.code).toBe('payload-too-large')
    expect(wholePage.message).toContain('the capture exceeds the 8MiB image limit')
    expect(wholePage.message).toContain('capture the viewport instead of the whole page')

    const quality = await failureOf(broker.dispatch('Page.captureScreenshot', { format: 'jpeg', quality: 90 }))
    expect(quality.code).toBe('payload-too-large')
    expect(quality.message).toContain('lower the JPEG quality')
  })

  it('leaves a capture without image data and every other method unbounded', async () => {
    const { broker, contents } = fixture()
    const evaluated = { data: DATA_OVER_LIMIT }
    contents.debugger.sendCommand.mockResolvedValueOnce({ data: 7 })
      .mockResolvedValueOnce(evaluated)

    await expect(broker.dispatch('Page.captureScreenshot', {})).resolves.toEqual({ data: 7 })
    await expect(broker.dispatch('Runtime.evaluate', { expression: 'x' })).resolves.toBe(evaluated)
  })

  it('reports a command the debugging session refused as a protocol error', async () => {
    const { broker, contents, activity } = fixture()
    contents.debugger.sendCommand.mockRejectedValue(new Error('Target closed'))

    const failure = await failureOf(broker.dispatch('Page.reload', {}))

    expect(failure.code).toBe('protocol-error')
    expect(failure.message).toBe('dsh desktop: browser method Page.reload failed: Target closed')
    expect(activity.mock.calls).toEqual([['Page.reload', true], ['Page.reload', false]])
  })

  it('describes a command whose session threw a non-Error value', async () => {
    const { broker, contents } = fixture()
    contents.debugger.sendCommand.mockImplementation(() => { throw 'pane gone' })

    const failure = await failureOf(broker.dispatch('Page.enable', {}))

    expect(failure.code).toBe('protocol-error')
    expect(failure.message).toContain('browser method Page.enable failed: pane gone')
  })

  it('runs concurrent commands one at a time in arrival order', async () => {
    const { broker, contents } = fixture()
    const gate = deferred<unknown>()
    contents.debugger.sendCommand.mockImplementation((method) => {
      if (method === 'Page.navigate') return gate.promise
      return Promise.resolve({ frameId: 'F2' })
    })

    const first = broker.dispatch('Page.navigate', { url: 'https://one.example' })
    const second = broker.dispatch('Page.reload', {})
    await settle()

    expect(contents.debugger.sendCommand).toHaveBeenCalledTimes(1)
    expect(contents.debugger.sendCommand).toHaveBeenCalledWith('Page.navigate', { url: 'https://one.example' })

    gate.resolve({ frameId: 'F1' })
    await expect(first).resolves.toEqual({ frameId: 'F1' })
    await expect(second).resolves.toEqual({ frameId: 'F2' })
    expect(contents.debugger.sendCommand.mock.calls.map(call => call[0])).toEqual(['Page.navigate', 'Page.reload'])
  })

  it('keeps serving the next command after one failed', async () => {
    const { broker, contents } = fixture()
    contents.debugger.sendCommand.mockRejectedValueOnce(new Error('session closed')).mockResolvedValue({ frameId: 'F3' })

    const failure = await failureOf(broker.dispatch('Page.reload', {}))
    expect(failure.code).toBe('protocol-error')

    await expect(broker.dispatch('Page.reload', {})).resolves.toEqual({ frameId: 'F3' })
  })

  it('detaches and restores background rendering on dispose, then attaches again', async () => {
    const { broker, contents } = fixture()
    contents.debugger.attach.mockImplementation(() => { contents.debugger.isAttached.mockReturnValue(true) })
    contents.debugger.detach.mockImplementation(() => { contents.debugger.isAttached.mockReturnValue(false) })
    await broker.dispatch('Page.enable', {})
    contents.setBackgroundThrottling.mockClear()

    broker.dispose()

    expect(contents.debugger.detach).toHaveBeenCalledOnce()
    expect(contents.setBackgroundThrottling).toHaveBeenCalledWith(true)
    await broker.dispatch('Page.enable', {})
    expect(contents.debugger.attach).toHaveBeenCalledTimes(2)
    expect(contents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
  })

  it('disposes a broker that never attached and one whose contents was destroyed', async () => {
    const { broker, contents } = fixture()
    expect(() => { broker.dispose() }).not.toThrow()

    await broker.dispatch('Page.enable', {})
    contents.isDestroyed.mockReturnValue(true)
    broker.dispose()

    expect(contents.debugger.detach).not.toHaveBeenCalled()
    expect(contents.setBackgroundThrottling).toHaveBeenCalledTimes(1)
  })

  it('swallows the teardown race that reports a session already gone', async () => {
    const { broker, contents } = fixture()
    await broker.dispatch('Page.enable', {})
    contents.debugger.isAttached.mockReturnValue(true)
    contents.debugger.detach.mockImplementation(() => { throw new Error('Debugger is not attached to the WebContents') })

    expect(() => { broker.dispose() }).not.toThrow()
  })

  it('reports an unexpected detach failure', async () => {
    const { broker, contents } = fixture()
    await broker.dispatch('Page.enable', {})
    contents.debugger.isAttached.mockReturnValue(true)
    contents.debugger.detach.mockImplementation(() => { throw new Error('debugging session is busy') })

    expect(() => { broker.dispose() }).toThrow('debugging session is busy')
  })
})
