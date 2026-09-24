import { describe, expect, it } from 'vitest'
import { parseBrowserRef, type BrowserRef } from '@deepseek-ai/dsh-browser'
import { CdpSession } from '../src/cdp.ts'
import { observePage, readPageHeader, readPageState, RefStore } from '../src/observation.ts'
import { axTree, type AxSpec } from './accessibility-tree.ts'
import { fakeTransport, type FakeBrowserTransport } from './fake-browser-transport.ts'
import { scriptPageWorld, type PageWorld } from './page-world.ts'

/** One observation request that renders everything the tree contains. */
const UNBOUNDED = { maxDepth: 500, maxNodes: 10_000, maxBytes: 10_000_000 }

/**
 * Slack a byte bound leaves above the node lines it must fit, covering the
 * truncation marker's widest `nodes`/`shown`/`next_cursor` values.
 */
const MARKER_RESERVE = 64

/**
 * Script one transport with a page world, an accessibility tree, and history.
 * @param options - tree, world overrides, and navigation history the page reports.
 * @returns the scripted transport.
 */
function pageTransport(options: {
  readonly tree?: readonly AxSpec[]
  readonly world?: Partial<PageWorld>
  readonly history?: { readonly currentIndex: number; readonly entries: readonly { readonly id: number; readonly url: string }[] }
} = {}): FakeBrowserTransport {
  const transport = fakeTransport()
  scriptPageWorld(transport, options.world ?? {})
  transport.on('Accessibility.getFullAXTree', () => axTree(options.tree ?? []))
  transport.on('Page.getNavigationHistory', () => options.history ?? {
    currentIndex: 0,
    entries: [{ id: 1, url: 'https://example.com/page' }],
  })
  return transport
}

/**
 * Wrap one transport in a command session.
 * @param transport - scripted transport.
 * @returns the session the provider modules use.
 */
function sessionOf(transport: FakeBrowserTransport): CdpSession {
  return new CdpSession(transport, 1_000)
}

/**
 * Mint-free reference text for a reference an observation never minted.
 * @param text - reference text with its sigil.
 * @returns the branded reference.
 */
function refOf(text: string): BrowserRef {
  const ref = parseBrowserRef(text)
  if (ref === undefined) throw new Error(`test reference ${text} is not a browser reference`)
  return ref
}

describe('RefStore generations', () => {
  it('mints sequential references and resolves them to backend node ids', () => {
    const refs = new RefStore()

    const first = refs.mint(101)
    const second = refs.mint(202)

    expect(first).toBe('e1')
    expect(second).toBe('e2')
    expect(refs.resolve(first)).toBe(101)
    expect(refs.resolve(second)).toBe(202)
  })

  it('reports a reference it never minted as unresolved', () => {
    expect(new RefStore().resolve(refOf('@e9'))).toBeUndefined()
  })

  it('keeps the previous generation resolvable without reusing its index', () => {
    const refs = new RefStore()
    const kept = refs.mint(101)
    const dropped = refs.mint(202)

    refs.beginGeneration()
    const fresh = refs.mint(303)
    refs.mint(101)

    expect(fresh).toBe('e3')
    expect(refs.resolve(fresh)).toBe(303)
    expect(refs.resolve(kept)).toBe(101)
    expect(refs.resolve(dropped)).toBeUndefined()
  })

  it('forgets a generation older than the one the newest observation replaced', () => {
    const refs = new RefStore()
    const oldest = refs.mint(101)

    refs.beginGeneration()
    refs.mint(101)
    refs.beginGeneration()
    refs.mint(101)

    expect(refs.resolve(oldest)).toBeUndefined()
  })

  it('forgets every generation on reset', () => {
    const refs = new RefStore()
    const ref = refs.mint(101)
    refs.beginGeneration()

    refs.reset()

    expect(refs.resolve(ref)).toBeUndefined()
    expect(refs.mint(404)).toBe('e1')
  })
})

describe('readPageHeader', () => {
  it('reports the page facts the observation text starts from', async () => {
    const transport = pageTransport({
      world: { url: 'https://example.com/checkout', title: 'Checkout', ready: 'loading', scrollY: 123.5, active: 'input#q', dialogs: 2 },
    })

    await expect(readPageHeader(sessionOf(transport))).resolves.toEqual({
      url: 'https://example.com/checkout',
      title: 'Checkout',
      ready: 'loading',
      scrollY: 124,
      active: 'input#q',
      dialogs: 2,
    })
  })
})

describe('readPageState', () => {
  it('reports a loaded page with a forward entry only', async () => {
    const transport = pageTransport({ history: { currentIndex: 0, entries: [{ id: 1, url: 'a' }, { id: 2, url: 'b' }] } })

    await expect(readPageState(sessionOf(transport))).resolves.toEqual({
      url: 'https://example.com/page',
      title: 'Example',
      loading: false,
      canGoBack: false,
      canGoForward: true,
      viewport: { width: 1000, height: 800 },
    })
    expect(transport.paramsOf('Page.getNavigationHistory')).toEqual({})
  })

  it('reports a still-loading page with a back entry only', async () => {
    const transport = pageTransport({
      world: { ready: 'interactive' },
      history: { currentIndex: 1, entries: [{ id: 1, url: 'a' }, { id: 2, url: 'b' }] },
    })

    await expect(readPageState(sessionOf(transport))).resolves.toEqual({
      url: 'https://example.com/page',
      title: 'Example',
      loading: true,
      canGoBack: true,
      canGoForward: false,
      viewport: { width: 1000, height: 800 },
    })
  })
})

describe('observePage rendering', () => {
  it('renders roles, names, values, and states with one reference per node', async () => {
    const transport = pageTransport({
      tree: [{
        role: 'RootWebArea',
        name: 'Example',
        backendNodeId: 101,
        children: [
          {
            role: 'heading',
            name: 'Welcome',
            backendNodeId: 102,
            properties: [{ name: 'level', value: 3 }, { name: 'focused', value: 'true' }],
          },
          { role: 'button', name: 'Buy', backendNodeId: 103, properties: [{ name: 'disabled', value: true }] },
          {
            role: 'textbox',
            value: 'hello',
            backendNodeId: 104,
            properties: [{ name: 'checked', value: 'mixed' }, { name: 'expanded', value: 'false' }, { name: 'busy' }],
          },
        ],
      }],
    })

    const observation = await observePage(sessionOf(transport), new RefStore(), UNBOUNDED)

    expect(observation.text).toBe([
      '[page] url=https://example.com/page title=Example viewport=1000x800 scrollY=0',
      '@e1 RootWebArea "Example"',
      '  @e2 heading "Welcome" [focused]',
      '  @e3 button "Buy" [disabled]',
      '  @e4 textbox value="hello" [checked=mixed]',
    ].join('\n'))
    expect(observation.refs).toEqual(['e1', 'e2', 'e3', 'e4'])
    expect(observation.nodeCount).toBe(4)
    expect(observation.truncated).toBe(false)
    expect(observation.nextCursor).toBeUndefined()
    expect(observation.byteLength).toBe(Buffer.byteLength(observation.text, 'utf8'))
    expect(observation.url).toBe('https://example.com/page')
    expect(observation.title).toBe('Example')
    expect(observation.loading).toBe(false)
    expect(observation.viewport).toEqual({ width: 1000, height: 800 })
  })

  it('reports focus and neutralized dialogs next to the page header', async () => {
    const transport = pageTransport({
      world: { active: 'input#q', dialogs: 2 },
      tree: [{ role: 'button', name: 'Buy', backendNodeId: 101 }],
    })

    const observation = await observePage(sessionOf(transport), new RefStore(), UNBOUNDED)

    expect(observation.text).toBe([
      '[page] url=https://example.com/page title=Example viewport=1000x800 scrollY=0',
      '[focused] input#q',
      '[dialogs] 2 page dialog(s) were neutralized; see browser_console',
      '@e1 button "Buy"',
    ].join('\n'))
  })

  it('reports a not-yet-loaded page as loading', async () => {
    const transport = pageTransport({ world: { ready: 'loading' }, tree: [] })

    const observation = await observePage(sessionOf(transport), new RefStore(), UNBOUNDED)

    expect(observation.loading).toBe(true)
    expect(observation.nodeCount).toBe(0)
  })

  it('hoists the children of an ignored node and skips a node that adds nothing', async () => {
    const transport = pageTransport({
      tree: [{
        role: 'RootWebArea',
        name: 'Example',
        backendNodeId: 101,
        children: [{
          ignored: true,
          missingChildren: ['veiled'],
          children: [
            { children: [{ role: 'link', name: 'Home', backendNodeId: 102 }] },
            { role: 'link', name: 'Missing child', backendNodeId: 103, missingChildren: ['veiled'] },
          ],
        }],
      }],
    })

    const observation = await observePage(sessionOf(transport), new RefStore(), UNBOUNDED)

    expect(observation.text).toBe([
      '[page] url=https://example.com/page title=Example viewport=1000x800 scrollY=0',
      '@e1 RootWebArea "Example"',
      '  @e2 link "Home"',
      '  @e3 link "Missing child"',
    ].join('\n'))
    expect(observation.nodeCount).toBe(3)
  })

  it('renders a node the tree does not connect to its reported parent as a root', async () => {
    const transport = pageTransport({ tree: [{ role: 'button', name: 'Orphan', parentId: 'ghost', backendNodeId: 101 }] })

    const observation = await observePage(sessionOf(transport), new RefStore(), UNBOUNDED)

    expect(observation.text).toBe([
      '[page] url=https://example.com/page title=Example viewport=1000x800 scrollY=0',
      '@e1 button "Orphan"',
    ].join('\n'))
  })

  it('omits the reference of a node the browser reports no backend node for', async () => {
    const transport = pageTransport({ tree: [{ role: 'generic', name: 'Wrapper', children: [{ role: 'button', name: 'Inner' }] }] })

    const observation = await observePage(sessionOf(transport), new RefStore(), UNBOUNDED)

    expect(observation.text).toBe([
      '[page] url=https://example.com/page title=Example viewport=1000x800 scrollY=0',
      '- generic "Wrapper"',
      '  - button "Inner"',
    ].join('\n'))
    expect(observation.refs).toEqual([])
  })

  it('stops below the requested depth', async () => {
    const transport = pageTransport({
      tree: [{ role: 'RootWebArea', name: 'Example', backendNodeId: 101, children: [{ role: 'button', name: 'Buy', backendNodeId: 102 }] }],
    })

    const observation = await observePage(sessionOf(transport), new RefStore(), { ...UNBOUNDED, maxDepth: 0 })

    expect(observation.text).toBe([
      '[page] url=https://example.com/page title=Example viewport=1000x800 scrollY=0',
      '@e1 RootWebArea "Example"',
    ].join('\n'))
    expect(observation.nodeCount).toBe(1)
  })

  it('renders nothing for a depth bound that excludes the root itself', async () => {
    const transport = pageTransport({ tree: [{ role: 'button', name: 'Buy', backendNodeId: 101 }] })

    const observation = await observePage(sessionOf(transport), new RefStore(), { ...UNBOUNDED, maxDepth: -1 })

    expect(observation.text).toBe('[page] url=https://example.com/page title=Example viewport=1000x800 scrollY=0\n')
    expect(observation.nodeCount).toBe(0)
    expect(observation.truncated).toBe(false)
  })
})

describe('observePage bounds', () => {
  it('truncates at the node bound and continues at the index it reached', async () => {
    const transport = pageTransport({
      tree: [
        {
          role: 'RootWebArea',
          name: 'Example',
          backendNodeId: 101,
          children: [
            { role: 'button', name: 'One', backendNodeId: 102 },
            { role: 'button', name: 'Two', backendNodeId: 103 },
            { role: 'button', name: 'Three', backendNodeId: 104 },
          ],
        },
        { role: 'button', name: 'Second root', backendNodeId: 105 },
      ],
    })

    const observation = await observePage(sessionOf(transport), new RefStore(), { ...UNBOUNDED, maxNodes: 2 })

    expect(observation.text).toBe([
      '[page] url=https://example.com/page title=Example viewport=1000x800 scrollY=0',
      '@e1 RootWebArea "Example"',
      '  @e2 button "One"',
      '[truncated] nodes=2 shown=2 next_cursor=2',
    ].join('\n'))
    expect(observation.truncated).toBe(true)
    expect(observation.nextCursor).toBe('2')
    expect(observation.nodeCount).toBe(2)
    expect(observation.refs).toEqual(['e1', 'e2'])
  })

  it('truncates at the byte bound and keeps the complete text inside it', async () => {
    const transport = pageTransport({
      tree: [{ role: 'button', name: 'One', backendNodeId: 101, children: [{ role: 'button', name: 'Two', backendNodeId: 102 }] }],
    })
    const header = '[page] url=https://example.com/page title=Example viewport=1000x800 scrollY=0'
    const maxBytes = Buffer.byteLength(`${header}\n@e1 button "One"`, 'utf8') + MARKER_RESERVE

    const observation = await observePage(sessionOf(transport), new RefStore(), { ...UNBOUNDED, maxBytes })

    expect(observation.text).toBe([
      header,
      '@e1 button "One"',
      '[truncated] nodes=1 shown=1 next_cursor=1',
    ].join('\n'))
    expect(observation.refs).toEqual(['e1'])
    expect(observation.byteLength).toBe(Buffer.byteLength(observation.text, 'utf8'))
    expect(observation.byteLength).toBeLessThanOrEqual(maxBytes)
  })

  it('emits the page header alone when the bound cannot hold a node line', async () => {
    const transport = pageTransport({
      tree: [{ role: 'button', name: 'One', backendNodeId: 101 }],
    })

    const observation = await observePage(sessionOf(transport), new RefStore(), { ...UNBOUNDED, maxBytes: 8 })

    expect(observation.text).toBe([
      '[page] url=https://example.com/page title=Example viewport=1000x800 scrollY=0',
      '',
      '[truncated] nodes=0 shown=0 next_cursor=0',
    ].join('\n'))
    expect(observation.refs).toEqual([])
    expect(observation.truncated).toBe(true)
    expect(observation.nextCursor).toBe('0')
  })

  it('measures the bound in bytes rather than UTF-16 code units', async () => {
    const transport = pageTransport({
      tree: [{ role: 'button', name: '购买', backendNodeId: 101, children: [{ role: 'button', name: '结算', backendNodeId: 102 }] }],
    })
    const header = '[page] url=https://example.com/page title=Example viewport=1000x800 scrollY=0'
    const first = '@e1 button "购买"'
    const maxBytes = Buffer.byteLength(`${header}\n${first}`, 'utf8') + MARKER_RESERVE

    const observation = await observePage(sessionOf(transport), new RefStore(), { ...UNBOUNDED, maxBytes })

    expect(Buffer.byteLength(first, 'utf8')).toBeGreaterThan(first.length)
    expect(observation.text).toBe([
      header,
      first,
      '[truncated] nodes=1 shown=1 next_cursor=1',
    ].join('\n'))
    expect(observation.byteLength).toBe(Buffer.byteLength(observation.text, 'utf8'))
    expect(observation.byteLength).toBeLessThanOrEqual(maxBytes)
  })

  it('resumes at the cursor and mints references for the continuation only', async () => {
    const transport = pageTransport({
      tree: [{
        role: 'RootWebArea',
        name: 'Example',
        backendNodeId: 101,
        children: [
          { role: 'button', name: 'One', backendNodeId: 102 },
          { role: 'button', name: 'Two', backendNodeId: 103 },
        ],
      }],
    })
    const refs = new RefStore()

    const observation = await observePage(sessionOf(transport), refs, { ...UNBOUNDED, cursor: '2' })

    expect(observation.text).toBe([
      '[page] url=https://example.com/page title=Example viewport=1000x800 scrollY=0',
      '  @e1 button "Two"',
    ].join('\n'))
    expect(observation.nodeCount).toBe(3)
    expect(observation.refs).toEqual(['e1'])
    expect(refs.resolve(refOf('@e1'))).toBe(103)
  })

  it('refuses a cursor that is not a node index', async () => {
    const transport = pageTransport({ tree: [] })

    await expect(observePage(sessionOf(transport), new RefStore(), { ...UNBOUNDED, cursor: 'page-2' })).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_PROTOCOL', message: 'observation cursor "page-2" is not a node index' }),
    )
    await expect(observePage(sessionOf(transport), new RefStore(), { ...UNBOUNDED, cursor: '12345678' })).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_PROTOCOL' }),
    )
    expect(transport.count('Accessibility.getFullAXTree')).toBe(0)
  })

  it('treats the zero cursor as the first node and the seven-digit cursor as a valid index', async () => {
    const transport = pageTransport({ tree: [{ role: 'button', name: 'One', backendNodeId: 101 }] })

    const fromZero = await observePage(sessionOf(transport), new RefStore(), { ...UNBOUNDED, cursor: '0' })
    const beyond = await observePage(sessionOf(transport), new RefStore(), { ...UNBOUNDED, cursor: '9999999' })

    expect(fromZero.refs).toEqual(['e1'])
    expect(fromZero.nodeCount).toBe(1)
    expect(beyond.refs).toEqual([])
    expect(beyond.nodeCount).toBe(1)
    expect(beyond.text).toBe('[page] url=https://example.com/page title=Example viewport=1000x800 scrollY=0\n')
  })
})
