import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { CdpSession } from '../src/cdp.ts'
import {
  drawHighlight,
  ensureBootstrapApplied,
  HIGHLIGHT_ELEMENT_ID,
  installPageBootstrap,
  PAGE_BOOTSTRAP_SOURCE,
  PAGE_CONSOLE_CAPACITY,
  readPageConsole,
} from '../src/bootstrap.ts'
import { fakeTransport, type FakeBrowserTransport } from './fake-browser-transport.ts'
import { scriptPageWorld, type PageWorld } from './page-world.ts'

/** Page-side ring one bootstrap installation leaves on `window`. */
interface PageRing {
  readonly entries: readonly { readonly seq: number; readonly level: string; readonly text: string }[]
  readonly seq: number
  readonly dialogs: readonly { readonly kind: string; readonly message: string }[]
}

/** One window event the bootstrap subscribed to. */
interface PageEvent {
  readonly message?: string
  readonly filename?: string
  readonly lineno?: number
  readonly reason?: unknown
}

/** Page realm one bootstrap script runs against. */
interface PageRealm {
  readonly window: Record<string, unknown>
  /** Console object the page handed the script, with the patched levels. */
  readonly console: Record<string, (...parts: readonly unknown[]) => void>
  /** Event listeners the script registered, by event name. */
  readonly listeners: Map<string, (event: PageEvent) => void>
  /** Every call the page's own console forwarded, in order. */
  readonly forwarded: { readonly level: string; readonly parts: readonly unknown[] }[]
}

/**
 * Run the injected bootstrap against a minimal page realm.
 * @returns the realm the script ran in plus its return value.
 */
function installIntoPageRealm(): PageRealm & { readonly result: unknown } {
  const listeners = new Map<string, (event: PageEvent) => void>()
  const forwarded: { level: string; parts: readonly unknown[] }[] = []
  const record = (level: string) => (...parts: readonly unknown[]): void => { forwarded.push({ level, parts }) }
  const window: Record<string, unknown> = {
    addEventListener: (name: string, listener: (event: PageEvent) => void): void => { listeners.set(name, listener) },
  }
  const pageConsole: Record<string, (...parts: readonly unknown[]) => void> = {
    log: record('log'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  }
  const result = runInNewContext(PAGE_BOOTSTRAP_SOURCE, { window, console: pageConsole }) as unknown
  return { window, console: pageConsole, listeners, forwarded, result }
}

/**
 * Read the page-side ring the bootstrap installed.
 * @param realm - realm the bootstrap ran in.
 * @returns the ring state the script left on `window`.
 */
function ringOf(realm: PageRealm): PageRing {
  return realm.window.__dshBrowser as PageRing
}

/**
 * Script one transport with a page world and the new-document registration.
 * @param world - page facts this world replaces.
 * @returns the scripted transport.
 */
function bootstrapTransport(world: Partial<PageWorld>): FakeBrowserTransport {
  const transport = fakeTransport(t => t.on('Page.addScriptToEvaluateOnNewDocument', () => ({ identifier: '1' })))
  scriptPageWorld(transport, world)
  return transport
}

describe('page bootstrap installation', () => {
  it('registers the bootstrap for every new document and skips a document that already carries it', async () => {
    const transport = bootstrapTransport({ bootstrapApplied: true })

    await installPageBootstrap(new CdpSession(transport, 1_000))

    expect(transport.paramsOf('Page.addScriptToEvaluateOnNewDocument')).toEqual({ source: PAGE_BOOTSTRAP_SOURCE })
    expect(transport.count('Runtime.evaluate')).toBe(1)
  })

  it('installs into the document on screen when the marker is absent', async () => {
    const transport = bootstrapTransport({ bootstrapApplied: false })

    await installPageBootstrap(new CdpSession(transport, 1_000))

    expect(transport.count('Runtime.evaluate')).toBe(2)
    expect(transport.paramsOf('Runtime.evaluate', 0).expression).toBe('window.__dshBrowser !== undefined')
    expect(transport.paramsOf('Runtime.evaluate', 1).expression).toBe(PAGE_BOOTSTRAP_SOURCE)
  })

  it('re-installs only when the current document lost the bootstrap', async () => {
    const present = bootstrapTransport({ bootstrapApplied: true })
    const absent = bootstrapTransport({ bootstrapApplied: false })

    await ensureBootstrapApplied(new CdpSession(present, 1_000))
    await ensureBootstrapApplied(new CdpSession(absent, 1_000))

    expect(present.count('Runtime.evaluate')).toBe(1)
    expect(absent.count('Runtime.evaluate')).toBe(2)
  })
})

describe('readPageConsole', () => {
  it('reports an empty ring when the document carries no bootstrap state', async () => {
    const transport = fakeTransport()
    scriptPageWorld(transport, { console: null })

    await expect(readPageConsole(new CdpSession(transport, 1_000))).resolves.toEqual({
      entries: [],
      cursor: 0,
      dialogs: [],
    })
  })

  it('reports entries in page order with the sequence number as cursor', async () => {
    const transport = fakeTransport()
    scriptPageWorld(transport, {
      console: {
        entries: [
          { seq: 1, level: 'log', text: 'ready' },
          { seq: 2, level: 'error', text: 'uncaught boom' },
        ],
        seq: 2,
        dialogs: [{ kind: 'confirm', message: 'sure?' }],
      },
    })

    await expect(readPageConsole(new CdpSession(transport, 1_000))).resolves.toEqual({
      entries: [
        { seq: 1, level: 'log', text: 'ready' },
        { seq: 2, level: 'error', text: 'uncaught boom' },
      ],
      cursor: 2,
      dialogs: [{ kind: 'confirm', message: 'sure?' }],
    })
  })
})

describe('drawHighlight', () => {
  it('positions the overlay on the action rectangle', async () => {
    const transport = fakeTransport()
    scriptPageWorld(transport, { highlight: 'drawn' })
    const rect = { x: 12, y: 34, width: 56, height: 78 }

    await drawHighlight(new CdpSession(transport, 1_000), rect)

    const expression = String(transport.paramsOf('Runtime.evaluate').expression)
    expect(expression).toContain(HIGHLIGHT_ELEMENT_ID)
    expect(expression).toContain(`const rect = ${JSON.stringify(rect)}`)
  })

  it('clears the overlay when no rectangle is given', async () => {
    const transport = fakeTransport()
    scriptPageWorld(transport, { highlight: 'cleared' })

    await drawHighlight(new CdpSession(transport, 1_000), undefined)

    expect(String(transport.paramsOf('Runtime.evaluate').expression)).toContain('const rect = null')
  })
})

describe('PAGE_BOOTSTRAP_SOURCE page behavior', () => {
  it('installs one ring and reports an already-installed document on the second run', () => {
    const realm = installIntoPageRealm()

    expect(realm.result).toBe('installed')
    expect(runInNewContext(PAGE_BOOTSTRAP_SOURCE, { window: realm.window, console: {} })).toBe('already-installed')
    expect(ringOf(realm).entries).toEqual([])
    expect(ringOf(realm).seq).toBe(0)
  })

  it('records console calls for every level and forwards them to the page console', () => {
    const realm = installIntoPageRealm()

    realm.console.log?.('hello', 42)
    realm.console.debug?.('quiet')

    expect(ringOf(realm).entries).toEqual([
      { seq: 1, level: 'log', text: 'hello 42' },
      { seq: 2, level: 'debug', text: 'quiet' },
    ])
    expect(realm.forwarded).toEqual([{ level: 'log', parts: ['hello', 42] }])
  })

  it('stringifies a value it cannot serialize instead of failing the call', () => {
    const realm = installIntoPageRealm()
    const circular: Record<string, unknown> = {}
    circular.self = circular

    realm.console.log?.(circular)

    expect(ringOf(realm).entries).toEqual([{ seq: 1, level: 'log', text: '[object Object]' }])
  })

  it('drops the oldest entries once the ring reaches its capacity', () => {
    const realm = installIntoPageRealm()

    for (let index = 0; index < PAGE_CONSOLE_CAPACITY + 5; index += 1) realm.console.log?.(`entry-${String(index)}`)

    const ring = ringOf(realm)
    expect(ring.seq).toBe(PAGE_CONSOLE_CAPACITY + 5)
    expect(ring.entries).toHaveLength(PAGE_CONSOLE_CAPACITY)
    expect(ring.entries[0]).toEqual({ seq: 6, level: 'log', text: 'entry-5' })
    expect(ring.entries.at(-1)).toEqual({ seq: 205, level: 'log', text: 'entry-204' })
  })

  it('neutralizes page dialogs, records them, and returns the scripted fallback', () => {
    const realm = installIntoPageRealm()

    const alert = realm.window.alert as (message?: unknown) => unknown
    const confirm = realm.window.confirm as (message?: unknown) => unknown
    const prompt = realm.window.prompt as (message?: unknown, defaultValue?: unknown) => unknown

    expect(alert('bye')).toBeUndefined()
    expect(alert()).toBeUndefined()
    expect(confirm('sure?')).toBe(false)
    expect(prompt('name?', 'x')).toBeNull()

    expect(ringOf(realm).dialogs).toEqual([
      { kind: 'alert', message: 'bye' },
      { kind: 'alert', message: '' },
      { kind: 'confirm', message: 'sure?' },
      { kind: 'prompt', message: 'name?' },
    ])
    expect(ringOf(realm).entries).toEqual([
      { seq: 1, level: 'warn', text: 'page dialog alert: bye' },
      { seq: 2, level: 'warn', text: 'page dialog alert: ' },
      { seq: 3, level: 'warn', text: 'page dialog confirm: sure?' },
      { seq: 4, level: 'warn', text: 'page dialog prompt: name?' },
    ])
  })

  it('records uncaught errors and unhandled rejections off the window events', () => {
    const realm = installIntoPageRealm()

    realm.listeners.get('error')?.({ message: 'boom', filename: 'app.js', lineno: 7 })
    realm.listeners.get('error')?.({})
    realm.listeners.get('unhandledrejection')?.({ reason: 'nope' })

    expect(ringOf(realm).entries).toEqual([
      { seq: 1, level: 'error', text: 'uncaught boom at app.js:7' },
      { seq: 2, level: 'error', text: 'uncaught error' },
      { seq: 3, level: 'error', text: 'unhandled rejection nope' },
    ])
  })
})
