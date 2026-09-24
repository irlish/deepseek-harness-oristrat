import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { BrowserError, parseBrowserOwner, parseBrowserRef, type BrowserOwner, type BrowserRef } from '@deepseek-ai/dsh-browser'
import { HIGHLIGHT_ELEMENT_ID, PAGE_BOOTSTRAP_SOURCE } from '../src/bootstrap.ts'
import DesktopBrowserAutomation, { DESKTOP_BROWSER_TRANSPORT_KEY, type Config } from '../src/index.ts'
import { axTree, type AxSpec } from './accessibility-tree.ts'
import { fakeTransport, type FakeBrowserTransport } from './fake-browser-transport.ts'
import { scriptPageWorld, type PageWorld } from './page-world.ts'

/** Owner the first session drives with. */
const OWNER: BrowserOwner = parseBrowserOwner('session-a')

/** Owner of the competing session. */
const OTHER_OWNER: BrowserOwner = parseBrowserOwner('session-b')

/** Base64 of the bytes every scripted capture returns. */
const IMAGE_BASE64 = Buffer.from('png-bytes').toString('base64')

/** Element measurement the scripted page returns. */
const BOX = { x: 100, y: 200, width: 40, height: 20, description: 'button #go' }

/** Target that resolves through the scripted DOM query. */
const SELECTOR_TARGET = { kind: 'selector', selector: '#go' } as const

/** Page tree with one addressable button. */
const BUTTON_TREE: readonly AxSpec[] = [{
  role: 'RootWebArea',
  name: 'Example',
  backendNodeId: 101,
  children: [{ role: 'button', name: 'Buy', backendNodeId: 102 }],
}]

/** Config every test starts from, with the settle wait removed. */
const FAST: Config = { settleMs: 0 }

/** Marker only the script-evaluation projection carries. */
const EVAL_PROJECTION_MARKER = 'const value = await ('

/** Complete config as the schema would resolve it. */
const RESOLVED: Required<Config> = {
  allowScriptEval: true,
  highlight: true,
  commandTimeoutMs: 15_000,
  settleMs: 0,
  leaseIdleMs: 300_000,
  defaultOriginDecision: 'allow',
  allowOrigins: [],
  denyOrigins: [],
  observeMaxDepth: 12,
  observeMaxNodes: 700,
  observeMaxBytes: 200_000,
  screenshotFormat: 'png',
  screenshotQuality: 80,
}

/** Page facts one scripted provider transport reports. */
interface ProviderPage {
  readonly world?: Partial<PageWorld>
  readonly tree?: readonly AxSpec[]
  readonly history?: { readonly currentIndex: number; readonly entries: readonly { readonly id: number; readonly url: string }[] }
  /** Screenshot reply; `'no-bytes'` answers without image data. */
  readonly screenshot?: Record<string, unknown>
  /** Element measurement; `null` answers with no value at all. */
  readonly measurement?: unknown
}

/** Page a scripted transport reports when a test overrides nothing. */
const DEFAULT_HISTORY = { currentIndex: 0, entries: [{ id: 1, url: 'https://example.com/page' }] }

/**
 * Script one transport with every command the provider can send.
 * @param page - page facts this transport reports.
 * @returns the scripted transport.
 */
function providerTransport(page: ProviderPage = {}): FakeBrowserTransport {
  const transport = fakeTransport()
  scriptPageWorld(transport, page.world ?? {})
  transport.on('Accessibility.getFullAXTree', () => axTree(page.tree ?? []))
  transport.on('Page.getNavigationHistory', () => page.history ?? DEFAULT_HISTORY)
  transport.on('Page.captureScreenshot', () => page.screenshot ?? { data: IMAGE_BASE64 })
  transport.on('Runtime.callFunctionOn', (params) => {
    const declaration = String(params.functionDeclaration)
    if (declaration.includes('getBoundingClientRect')) {
      return page.measurement === null ? { result: {} } : { result: { value: page.measurement ?? BOX } }
    }
    return { result: { value: true } }
  })
  transport.on('DOM.getDocument', () => ({ root: { nodeId: 7 } }))
  transport.on('DOM.querySelector', () => ({ nodeId: 9 }))
  transport.on('DOM.resolveNode', () => ({ object: { objectId: 'remote-9' } }))
  transport.on('DOM.enable', () => ({}))
  transport.on('Page.enable', () => ({}))
  transport.on('Page.addScriptToEvaluateOnNewDocument', () => ({ identifier: '1' }))
  transport.on('Page.navigate', () => ({ frameId: 'frame-1' }))
  transport.on('Page.reload', () => ({}))
  transport.on('Page.navigateToHistoryEntry', () => ({}))
  transport.on('Input.dispatchMouseEvent', () => ({}))
  transport.on('Input.dispatchKeyEvent', () => ({}))
  transport.on('Input.insertText', () => ({}))
  return transport
}

/** One mounted provider and the transport behind it. */
interface MountedProvider {
  readonly ctx: Context
  readonly browser: DesktopBrowserAutomation
  readonly transport: FakeBrowserTransport
}

/**
 * Mount the provider on a fresh context over a scripted transport.
 * @param config - plugin config; the suite's fast defaults apply unless overridden.
 * @param transport - scripted transport to provide under the desktop key.
 * @returns the context, the provider, and the transport.
 */
async function mount(config: Config = {}, transport: FakeBrowserTransport = providerTransport()): Promise<MountedProvider> {
  const ctx = new Context()
  ctx.provide(DESKTOP_BROWSER_TRANSPORT_KEY, transport)
  await ctx.plugin(DesktopBrowserAutomation, { ...FAST, ...config })
  return { ctx, browser: ctx.browser as DesktopBrowserAutomation, transport }
}

/**
 * Build a context that provides a transport but mounts nothing.
 * @returns the prepared context.
 */
function transportContext(): Context {
  const ctx = new Context()
  ctx.provide(DESKTOP_BROWSER_TRANSPORT_KEY, providerTransport())
  return ctx
}

/**
 * Every expression the provider evaluated, in send order.
 * @param transport - scripted transport.
 * @returns the evaluated expression sources.
 */
function evaluatedExpressions(transport: FakeBrowserTransport): string[] {
  return transport.commands
    .filter(command => command.method === 'Runtime.evaluate')
    .map(command => String(command.params.expression))
}

/**
 * Mint-free reference text for a reference the observation minted.
 * @param text - reference text without its sigil.
 * @returns the branded reference.
 */
function refOf(text: string): BrowserRef {
  const ref = parseBrowserRef(text)
  if (ref === undefined) throw new Error(`test reference ${text} is not a browser reference`)
  return ref
}

afterEach(() => { vi.useRealTimers() })

describe('DesktopBrowserAutomation mounting', () => {
  it('refuses to mount where the composition provides no brokered transport', async () => {
    const ctx = new Context()

    await expect(ctx.plugin(DesktopBrowserAutomation, {})).rejects.toThrow(
      'browser-desktop: this composition provides no brokered browser transport;'
      + ` mount this provider only where the desktop shell provides ${DESKTOP_BROWSER_TRANSPORT_KEY}`,
    )
  })

  it('provides itself as the browser service', async () => {
    const { ctx, browser } = await mount()

    expect(browser).toBeInstanceOf(DesktopBrowserAutomation)
    expect(ctx.get('browser')).toBeInstanceOf(DesktopBrowserAutomation)
  })

  it('resolves every unset field from the schema defaults', () => {
    expect(DesktopBrowserAutomation.Config({})).toEqual({
      allowScriptEval: true,
      highlight: true,
      commandTimeoutMs: 15_000,
      settleMs: 150,
      leaseIdleMs: 300_000,
      defaultOriginDecision: 'allow',
      allowOrigins: [],
      denyOrigins: [],
      observeMaxDepth: 12,
      observeMaxNodes: 700,
      observeMaxBytes: 200_000,
      screenshotFormat: 'png',
      screenshotQuality: 80,
    })
  })

  it('rejects a bound the schema accepted but cannot be used', async () => {
    const negative = new Context()
    negative.provide(DESKTOP_BROWSER_TRANSPORT_KEY, providerTransport())
    await expect(negative.plugin(DesktopBrowserAutomation, { settleMs: -1 })).rejects.toThrow(
      'browser-desktop: settleMs must be a finite number >= 0, received -1',
    )

    const notANumber = new Context()
    notANumber.provide(DESKTOP_BROWSER_TRANSPORT_KEY, providerTransport())
    await expect(notANumber.plugin(DesktopBrowserAutomation, { observeMaxBytes: Number.NaN })).rejects.toThrow(
      'browser-desktop: observeMaxBytes must be a finite number >= 0, received NaN',
    )

    const unbounded = new Context()
    unbounded.provide(DESKTOP_BROWSER_TRANSPORT_KEY, providerTransport())
    await expect(unbounded.plugin(DesktopBrowserAutomation, { screenshotQuality: Number.POSITIVE_INFINITY })).rejects.toThrow(
      'browser-desktop: screenshotQuality must be a finite number >= 0, received Infinity',
    )
  })

  it('rejects a programmatic construction that skipped the schema', () => {
    expect(() => new DesktopBrowserAutomation(transportContext(), {})).toThrow(
      'browser-desktop: commandTimeoutMs must be a finite number >= 0, received undefined',
    )
    expect(() => new DesktopBrowserAutomation(transportContext(), { ...RESOLVED, leaseIdleMs: -5 })).toThrow(
      'browser-desktop: leaseIdleMs must be a finite number >= 0, received -5',
    )
  })
})

describe('DesktopBrowserAutomation page preparation', () => {
  it('enables the domains and registers the page bootstrap once', async () => {
    const { browser, transport } = await mount()

    await browser.state(OWNER)
    await browser.state(OWNER)

    expect(transport.count('DOM.enable')).toBe(1)
    expect(transport.count('Page.enable')).toBe(1)
    expect(transport.paramsOf('Page.addScriptToEvaluateOnNewDocument')).toEqual({ source: PAGE_BOOTSTRAP_SOURCE })
    expect(evaluatedExpressions(transport).filter(expression => expression === PAGE_BOOTSTRAP_SOURCE)).toEqual([])
  })

  it('re-installs the bootstrap into a document that lost it', async () => {
    const { browser, transport } = await mount({}, providerTransport({ world: { bootstrapApplied: false } }))

    await browser.state(OWNER)
    await browser.state(OWNER)

    expect(transport.count('Page.addScriptToEvaluateOnNewDocument')).toBe(1)
    // The first request installs the source twice: once for the document already
    // displayed, once again when the marker re-check still reports it absent.
    expect(evaluatedExpressions(transport).filter(expression => expression === PAGE_BOOTSTRAP_SOURCE)).toHaveLength(3)
  })
})

describe('DesktopBrowserAutomation.state', () => {
  it('reports the page identity and history availability', async () => {
    const { browser } = await mount({}, providerTransport({
      world: { title: 'Checkout' },
      history: { currentIndex: 0, entries: [{ id: 1, url: 'a' }, { id: 2, url: 'b' }] },
    }))

    await expect(browser.state(OWNER)).resolves.toEqual({
      url: 'https://example.com/page',
      title: 'Checkout',
      loading: false,
      canGoBack: false,
      canGoForward: true,
      viewport: { width: 1000, height: 800 },
    })
  })

  it('refuses a page the origin policy denies', async () => {
    const { browser } = await mount({ denyOrigins: ['example.com'] })

    await expect(browser.state(OWNER)).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_ORIGIN_DENIED',
      message: 'origin refused: denied by example.com',
    }))
  })
})

describe('DesktopBrowserAutomation.navigate', () => {
  it('navigates to the normalized absolute URL and reports the settled page', async () => {
    const { browser, transport } = await mount()

    const navigation = await browser.navigate({ owner: OWNER, action: 'goto', url: 'HTTPS://Example.com/checkout#step' })

    expect(transport.paramsOf('Page.navigate')).toEqual({ url: 'https://example.com/checkout#step' })
    expect(navigation).toEqual({
      url: 'https://example.com/page',
      title: 'Example',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      viewport: { width: 1000, height: 800 },
      reached: true,
    })
  })

  it('requires a URL for a goto', async () => {
    const { browser, transport } = await mount()

    await expect(browser.navigate({ owner: OWNER, action: 'goto' })).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_NAVIGATION_FAILED',
      message: 'goto requires a url',
    }))
    expect(transport.count('Page.navigate')).toBe(0)
  })

  it('refuses a relative target and a non-http scheme', async () => {
    const { browser, transport } = await mount()

    await expect(browser.navigate({ owner: OWNER, action: 'goto', url: 'example.com/page' })).rejects.toThrow(
      expect.objectContaining({
        code: 'BROWSER_NAVIGATION_FAILED',
        message: 'url "example.com/page" is not absolute',
      }),
    )
    await expect(browser.navigate({ owner: OWNER, action: 'goto', url: 'file:///etc/passwd' })).rejects.toThrow(
      expect.objectContaining({
        code: 'BROWSER_NAVIGATION_FAILED',
        message: 'url "file:///etc/passwd" is not http(s)',
      }),
    )
    expect(transport.count('Page.navigate')).toBe(0)
  })

  it('refuses a navigation target the origin policy denies', async () => {
    const { browser, transport } = await mount({ allowOrigins: ['example.com'], defaultOriginDecision: 'deny' })

    await expect(browser.navigate({ owner: OWNER, action: 'goto', url: 'https://elsewhere.test/' })).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_ORIGIN_DENIED', message: 'origin refused: default deny' }),
    )
    expect(transport.count('Page.navigate')).toBe(0)
  })

  it('reloads the current document', async () => {
    const { browser, transport } = await mount()

    const navigation = await browser.navigate({ owner: OWNER, action: 'reload' })

    expect(transport.paramsOf('Page.reload')).toEqual({})
    expect(navigation.reached).toBe(true)
    expect(transport.count('Page.navigate')).toBe(0)
  })

  it('walks one history entry back and one forward', async () => {
    const history = {
      currentIndex: 1,
      entries: [
        { id: 11, url: 'https://example.com/one' },
        { id: 22, url: 'https://example.com/two' },
        { id: 33, url: 'https://example.com/three' },
      ],
    }
    const backwards = await mount({}, providerTransport({ history }))
    const forwards = await mount({}, providerTransport({ history }))

    await backwards.browser.navigate({ owner: OWNER, action: 'back' })
    await forwards.browser.navigate({ owner: OWNER, action: 'forward' })

    expect(backwards.transport.paramsOf('Page.navigateToHistoryEntry')).toEqual({ entryId: 11 })
    expect(forwards.transport.paramsOf('Page.navigateToHistoryEntry')).toEqual({ entryId: 33 })
  })

  it('reports a history step the browser cannot take', async () => {
    const history = { currentIndex: 1, entries: [{ id: 11, url: 'https://example.com/one' }, { id: 22, url: 'https://example.com/two' }] }
    const { browser, transport } = await mount({}, providerTransport({ history }))

    await expect(browser.navigate({ owner: OWNER, action: 'back' })).resolves.toMatchObject({ reached: true })
    expect(backwardsEntry(transport)).toEqual({ entryId: 11 })

    await expect(browser.navigate({ owner: OWNER, action: 'forward' })).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_NAVIGATION_FAILED',
      message: 'the browser has no forward entry to go to',
    }))
    expect(transport.count('Page.navigateToHistoryEntry')).toBe(1)
  })

  it('refuses a history entry the origin policy denies', async () => {
    const history = {
      currentIndex: 0,
      entries: [{ id: 11, url: 'https://example.com/one' }, { id: 22, url: 'https://blocked.test/two' }],
    }
    const { browser, transport } = await mount({ denyOrigins: ['blocked.test'] }, providerTransport({ history }))

    await expect(browser.navigate({ owner: OWNER, action: 'forward' })).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_ORIGIN_DENIED', message: 'origin refused: denied by blocked.test' }),
    )
    expect(transport.count('Page.navigateToHistoryEntry')).toBe(0)
  })

  it('reports a document that did not arrive when the page stays on about:blank', async () => {
    const { browser } = await mount({}, providerTransport({ world: { url: 'about:blank', title: '' } }))

    await expect(browser.navigate({ owner: OWNER, action: 'reload' })).resolves.toMatchObject({ url: 'about:blank', reached: false })
  })

  it('reports a document that is still loading as unreached', async () => {
    const { browser } = await mount({}, providerTransport({ world: { ready: 'loading' } }))

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const navigating = browser.navigate({ owner: OWNER, action: 'reload' })
    await vi.advanceTimersByTimeAsync(6_000)

    await expect(navigating).resolves.toMatchObject({ reached: false })
  })

  it('forgets every observed reference once the document changes', async () => {
    const { browser } = await mount({}, providerTransport({ tree: BUTTON_TREE }))

    const observation = await browser.observe({ owner: OWNER })
    expect(observation.refs).toEqual(['e1', 'e2'])

    await browser.navigate({ owner: OWNER, action: 'reload' })

    await expect(browser.act({ owner: OWNER, action: 'click', target: { kind: 'ref', ref: refOf('e2') } })).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_REF_STALE' }),
    )
  })
})

describe('DesktopBrowserAutomation.observe', () => {
  it('applies the configured bounds when the call requests none', async () => {
    const { browser } = await mount({ observeMaxNodes: 1 }, providerTransport({ tree: BUTTON_TREE }))

    const observation = await browser.observe({ owner: OWNER })

    expect(observation.truncated).toBe(true)
    expect(observation.nextCursor).toBe('1')
    expect(observation.refs).toEqual(['e1'])
  })

  it('lets the call bound the observation more tightly or more loosely', async () => {
    const { browser } = await mount({ observeMaxNodes: 1 }, providerTransport({ tree: BUTTON_TREE }))

    const observation = await browser.observe({ owner: OWNER, maxNodes: 50, maxDepth: 2, maxBytes: 5_000 })

    expect(observation.truncated).toBe(false)
    expect(observation.refs).toEqual(['e1', 'e2'])
    expect(observation.nodeCount).toBe(2)
  })

  it('continues from the cursor the previous observation reported', async () => {
    const { browser } = await mount({ observeMaxNodes: 1 }, providerTransport({ tree: BUTTON_TREE }))

    const first = await browser.observe({ owner: OWNER })
    const cursor = first.nextCursor
    if (cursor === undefined) throw new Error('the bounded observation reported no continuation cursor')
    const second = await browser.observe({ owner: OWNER, cursor })

    expect(second.text).toBe([
      '[page] url=https://example.com/page title=Example viewport=1000x800 scrollY=0',
      '  @e2 button "Buy"',
    ].join('\n'))
    expect(second.nodeCount).toBe(2)
  })

  it('refuses a cursor that is not a node index', async () => {
    const { browser } = await mount()

    await expect(browser.observe({ owner: OWNER, cursor: 'second' })).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_PROTOCOL' }),
    )
  })

  it('refuses to observe a page the origin policy denies', async () => {
    const { browser, transport } = await mount({ denyOrigins: ['example.com'] })

    await expect(browser.observe({ owner: OWNER })).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_ORIGIN_DENIED' }),
    )
    expect(transport.count('Accessibility.getFullAXTree')).toBe(0)
  })
})

describe('DesktopBrowserAutomation.act', () => {
  it('clicks, highlights the resolved element, and reports the state it produced', async () => {
    const { browser, transport } = await mount()

    const outcome = await browser.act({ owner: OWNER, action: 'click', target: SELECTOR_TARGET })

    expect(outcome).toEqual({
      url: 'https://example.com/page',
      title: 'Example',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      viewport: { width: 1000, height: 800 },
      action: 'click',
    })
    expect(transport.count('Input.dispatchMouseEvent')).toBe(3)
    expect(evaluatedExpressions(transport).filter(expression => expression.includes(HIGHLIGHT_ELEMENT_ID))).toHaveLength(1)
  })

  it('reports the reference the action resolved when the model addressed one', async () => {
    const { browser } = await mount({}, providerTransport({ tree: BUTTON_TREE }))
    await browser.observe({ owner: OWNER })

    const outcome = await browser.act({ owner: OWNER, action: 'hover', target: { kind: 'ref', ref: refOf('e2') } })

    expect(outcome.ref).toBe('e2')
    expect(outcome.action).toBe('hover')
  })

  it('draws no highlight when the deployment turned it off', async () => {
    const { browser, transport } = await mount({ highlight: false })

    await browser.act({ owner: OWNER, action: 'click', target: SELECTOR_TARGET })

    expect(evaluatedExpressions(transport).filter(expression => expression.includes(HIGHLIGHT_ELEMENT_ID))).toEqual([])
  })

  it('draws no highlight for an action that resolved no element', async () => {
    const { browser, transport } = await mount()

    const outcome = await browser.act({ owner: OWNER, action: 'scroll' })

    expect(outcome).not.toHaveProperty('ref')
    expect(evaluatedExpressions(transport).filter(expression => expression.includes(HIGHLIGHT_ELEMENT_ID))).toEqual([])
    expect(transport.paramsOf('Input.dispatchMouseEvent')).toMatchObject({ type: 'mouseWheel', deltaY: 800 })
  })

  it('refuses to act on a page the origin policy denies', async () => {
    const { browser, transport } = await mount({ denyOrigins: ['example.com'] })

    await expect(browser.act({ owner: OWNER, action: 'click', target: SELECTOR_TARGET })).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_ORIGIN_DENIED' }),
    )
    expect(transport.count('Input.dispatchMouseEvent')).toBe(0)
  })
})

describe('DesktopBrowserAutomation.screenshot', () => {
  it('captures with the configured format and quality when the call chooses none', async () => {
    const { browser, transport } = await mount({ screenshotFormat: 'jpeg', screenshotQuality: 55 })

    const shot = await browser.screenshot({ owner: OWNER })

    expect(transport.paramsOf('Page.captureScreenshot')).toEqual({ format: 'jpeg', quality: 55 })
    expect(shot.mediaType).toBe('image/jpeg')
    expect(shot.bytes).toEqual(new Uint8Array(Buffer.from('png-bytes')))
    expect(shot.url).toBe('https://example.com/page')
  })

  it('prefers the framing and format the call asked for', async () => {
    const { browser, transport } = await mount({ screenshotFormat: 'jpeg' })

    const shot = await browser.screenshot({ owner: OWNER, target: SELECTOR_TARGET, format: 'png' })

    expect(transport.paramsOf('Page.captureScreenshot')).toMatchObject({ format: 'png', captureBeyondViewport: true })
    expect(transport.paramsOf('Page.captureScreenshot')).not.toHaveProperty('quality')
    expect(shot).toMatchObject({ format: 'png', width: 40, height: 20 })
  })

  it('refuses to capture a page the origin policy denies', async () => {
    const { browser, transport } = await mount({ denyOrigins: ['example.com'] })

    await expect(browser.screenshot({ owner: OWNER })).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_ORIGIN_DENIED' }),
    )
    expect(transport.count('Page.captureScreenshot')).toBe(0)
  })
})

describe('DesktopBrowserAutomation.console', () => {
  /** Ring the scripted page holds for the console tests. */
  const RING = {
    entries: [
      { seq: 5, level: 'log', text: 'first' },
      { seq: 6, level: 'warn', text: 'second' },
      { seq: 7, level: 'error', text: 'third' },
    ],
    seq: 7,
    dialogs: [],
  }

  it('reports every entry with the ring cursor when the call asks for no filter', async () => {
    const { browser } = await mount({}, providerTransport({ world: { console: RING } }))

    await expect(browser.console({ owner: OWNER })).resolves.toEqual({
      entries: RING.entries,
      dropped: 0,
      cursor: 7,
    })
  })

  it('filters by sequence and by level', async () => {
    const { browser } = await mount({}, providerTransport({ world: { console: RING } }))

    await expect(browser.console({ owner: OWNER, since: 5 })).resolves.toMatchObject({
      entries: [{ seq: 6, level: 'warn', text: 'second' }, { seq: 7, level: 'error', text: 'third' }],
      dropped: 0,
    })
    await expect(browser.console({ owner: OWNER, levels: ['error'] })).resolves.toMatchObject({
      entries: [{ seq: 7, level: 'error', text: 'third' }],
      dropped: 0,
    })
    await expect(browser.console({ owner: OWNER, levels: ['error'], since: 7 })).resolves.toEqual({
      entries: [],
      dropped: 0,
      cursor: 7,
    })
  })

  it('keeps the newest entries and counts the ones it dropped', async () => {
    const { browser } = await mount({}, providerTransport({ world: { console: RING } }))

    await expect(browser.console({ owner: OWNER, limit: 1 })).resolves.toEqual({
      entries: [{ seq: 7, level: 'error', text: 'third' }],
      dropped: 2,
      cursor: 7,
    })
  })

  it('keeps the newest hundred entries by default', async () => {
    const entries = Array.from({ length: 105 }, (_value, index) => ({ seq: index + 1, level: 'log', text: `line-${String(index + 1)}` }))
    const { browser } = await mount({}, providerTransport({ world: { console: { entries, seq: 105, dialogs: [] } } }))

    const page = await browser.console({ owner: OWNER })

    expect(page.entries).toHaveLength(100)
    expect(page.entries[0]).toEqual({ seq: 6, level: 'log', text: 'line-6' })
    expect(page.dropped).toBe(5)
    expect(page.cursor).toBe(105)
  })

  it('reports an empty ring for a document that carries no bootstrap state', async () => {
    const { browser } = await mount({}, providerTransport({ world: { console: null } }))

    await expect(browser.console({ owner: OWNER })).resolves.toEqual({ entries: [], dropped: 0, cursor: 0 })
  })

  it('refuses to read the console of a page the origin policy denies', async () => {
    const { browser, transport } = await mount({ denyOrigins: ['example.com'] })

    await expect(browser.console({ owner: OWNER })).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_ORIGIN_DENIED' }),
    )
    expect(evaluatedExpressions(transport).filter(expression => expression.includes('state.entries.slice()'))).toEqual([])
  })
})

describe('DesktopBrowserAutomation.evaluate', () => {
  it('projects the page value to text', async () => {
    const { browser, transport } = await mount({}, providerTransport({ world: { evaluateText: 'Example title' } }))

    await expect(browser.evaluate({ owner: OWNER, expression: 'document.title' })).resolves.toEqual({ text: 'Example title' })
    expect(evaluatedExpressions(transport).some(expression => expression.includes('await (document.title)'))).toBe(true)
  })

  it('refuses to evaluate when the deployment disabled page script', async () => {
    const { browser, transport } = await mount({ allowScriptEval: false })

    await expect(browser.evaluate({ owner: OWNER, expression: 'document.title' })).rejects.toThrow(
      expect.objectContaining({
        code: 'BROWSER_SCRIPT_EVAL_DENIED',
        message: 'page script evaluation is disabled by configuration (allowScriptEval)',
      }),
    )
    expect(evaluatedExpressions(transport).some(expression => expression.includes(EVAL_PROJECTION_MARKER))).toBe(false)
  })

  it('refuses to evaluate on a page the origin policy denies', async () => {
    const { browser, transport } = await mount({ denyOrigins: ['example.com'] })

    await expect(browser.evaluate({ owner: OWNER, expression: 'document.title' })).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_ORIGIN_DENIED' }),
    )
    expect(evaluatedExpressions(transport).some(expression => expression.includes('document.activeElement'))).toBe(true)
    expect(evaluatedExpressions(transport).some(expression => expression.includes(EVAL_PROJECTION_MARKER))).toBe(false)
  })

  it('reports the typed browser error the page script produced', async () => {
    const transport = providerTransport()
    transport.on('Runtime.evaluate', params => (
      String(params.expression) === 'window.__dshBrowser !== undefined'
        ? { result: { value: true } }
        : { result: {}, exceptionDetails: { exception: { description: 'TypeError: boom' } } }
    ))
    const { browser } = await mount({}, transport)

    await expect(browser.evaluate({ owner: OWNER, expression: 'boom()' })).rejects.toBeInstanceOf(BrowserError)
  })
})

describe('DesktopBrowserAutomation lease', () => {
  it('keeps one session driving the pane across sequential requests', async () => {
    const { browser } = await mount()

    await expect(browser.state(OWNER)).resolves.toMatchObject({ title: 'Example' })
    await expect(browser.state(OWNER)).resolves.toMatchObject({ title: 'Example' })
  })

  it('refuses a second session while the first is still driving', async () => {
    const { browser, transport } = await mount()

    await browser.state(OWNER)
    let denied: unknown
    try {
      await browser.state(OTHER_OWNER)
    } catch (error) {
      denied = error
    }
    expect(denied).toBeInstanceOf(BrowserError)
    if (!(denied instanceof BrowserError)) throw new Error('expected a BrowserError')
    expect(denied.code).toBe('BROWSER_BUSY')
    expect(denied.message).toContain('another session (session-a) is driving the browser; it was active')
    expect(transport.count('Page.getNavigationHistory')).toBe(1)
  })

  it('hands the pane to a second session once the first is idle', async () => {
    const { browser } = await mount({ leaseIdleMs: 0 })

    await browser.state(OWNER)

    await expect(browser.state(OTHER_OWNER)).resolves.toMatchObject({ url: 'https://example.com/page' })
  })
})

/**
 * Read the history entry the provider navigated to.
 * @param transport - scripted transport.
 * @returns the parameters of the last history navigation.
 */
function backwardsEntry(transport: FakeBrowserTransport): Record<string, unknown> {
  return transport.paramsOf('Page.navigateToHistoryEntry', transport.count('Page.navigateToHistoryEntry') - 1)
}
