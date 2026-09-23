import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import BrowserAutomation, {
  parseBrowserOwner,
  type BrowserActOutcome,
  type BrowserActRequest,
  type BrowserConsolePage,
  type BrowserConsoleRequest,
  type BrowserEvaluateRequest,
  type BrowserEvaluateResult,
  type BrowserNavigateRequest,
  type BrowserNavigation,
  type BrowserObservation,
  type BrowserObserveRequest,
  type BrowserOwner,
  type BrowserPageState,
  type BrowserScreenshot,
  type BrowserScreenshotRequest,
} from '../src/index.ts'

const PAGE_STATE: BrowserPageState = {
  url: 'https://example.test/',
  title: 'Example',
  loading: false,
  viewport: { width: 800, height: 600 },
  canGoBack: false,
  canGoForward: false,
}

/** Minimal provider proving the abstract surface is implementable and registered as `browser`. */
class StubBrowser extends BrowserAutomation {
  readonly calls: string[] = []

  override state(owner: BrowserOwner): Promise<BrowserPageState> {
    this.calls.push(`state:${String(owner)}`)
    return Promise.resolve(PAGE_STATE)
  }

  override navigate(request: BrowserNavigateRequest): Promise<BrowserNavigation> {
    this.calls.push(`navigate:${request.action}`)
    return Promise.resolve({ ...PAGE_STATE, reached: true })
  }

  override observe(request: BrowserObserveRequest): Promise<BrowserObservation> {
    this.calls.push(`observe:${String(request.owner)}`)
    return Promise.resolve({
      ...PAGE_STATE,
      text: 'button "Go"',
      refs: [],
      nodeCount: 1,
      truncated: false,
      byteLength: 11,
    })
  }

  override act(request: BrowserActRequest): Promise<BrowserActOutcome> {
    this.calls.push(`act:${request.action}`)
    return Promise.resolve({ ...PAGE_STATE, action: request.action })
  }

  override screenshot(request: BrowserScreenshotRequest): Promise<BrowserScreenshot> {
    this.calls.push(`screenshot:${String(request.owner)}`)
    return Promise.resolve({
      format: 'png',
      mediaType: 'image/png',
      bytes: new Uint8Array([1]),
      width: 1,
      height: 1,
      url: PAGE_STATE.url,
    })
  }

  override console(request: BrowserConsoleRequest): Promise<BrowserConsolePage> {
    this.calls.push(`console:${String(request.owner)}`)
    return Promise.resolve({ entries: [], dropped: 0, cursor: 0 })
  }

  override evaluate(request: BrowserEvaluateRequest): Promise<BrowserEvaluateResult> {
    this.calls.push(`evaluate:${request.expression}`)
    return Promise.resolve({ text: '1' })
  }
}

async function mount(): Promise<{ ctx: Context; fiber: Awaited<ReturnType<Context['plugin']>>; browser: StubBrowser }> {
  const ctx = new Context()
  const fiber = await ctx.plugin(StubBrowser)
  return { ctx, fiber, browser: ctx.browser as StubBrowser }
}

describe('BrowserAutomation service', () => {
  it('registers itself under the service name browser', async () => {
    const { ctx, browser } = await mount()
    expect(browser.name).toBe('browser')
    expect(ctx.get('browser')).toBeDefined()
    expect(browser instanceof BrowserAutomation).toBe(true)
  })

  it('routes every seam verb to the mounted provider', async () => {
    const { browser } = await mount()
    const owner = parseBrowserOwner('session-1')

    expect(await browser.state(owner)).toEqual(PAGE_STATE)
    expect((await browser.navigate({ owner, action: 'reload' })).reached).toBe(true)
    expect((await browser.observe({ owner })).text).toBe('button "Go"')
    expect((await browser.act({ owner, action: 'click' })).action).toBe('click')
    expect((await browser.screenshot({ owner })).mediaType).toBe('image/png')
    expect(await browser.console({ owner })).toEqual({ entries: [], dropped: 0, cursor: 0 })
    expect(await browser.evaluate({ owner, expression: '1' })).toEqual({ text: '1' })

    expect(browser.calls).toEqual([
      'state:session-1',
      'navigate:reload',
      'observe:session-1',
      'act:click',
      'screenshot:session-1',
      'console:session-1',
      'evaluate:1',
    ])
  })

  it('unregisters the service with its owning fiber', async () => {
    const { ctx, fiber } = await mount()
    await fiber.dispose()
    expect(ctx.get('browser')).toBeUndefined()
  })

  it('refuses a second provider for the same service name', async () => {
    const ctx = new Context()
    await ctx.plugin(StubBrowser)
    await expect(ctx.plugin(StubBrowser)).rejects.toThrow('service "browser" has been registered')
  })
})
