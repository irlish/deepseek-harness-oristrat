/**
 * Canned page the fake transport answers `Runtime.evaluate` for.
 *
 * One protocol method serves every page read the provider makes, so the script
 * dispatches on the expression the provider sent and answers from this world.
 * A world value stands for what the page would compute; tests assert the
 * provider's interpretation of it, never the browser's own behavior.
 * @module
 */

import { HIGHLIGHT_ELEMENT_ID, PAGE_BOOTSTRAP_SOURCE } from '../src/bootstrap.ts'
import type { FakeBrowserTransport } from './fake-browser-transport.ts'

/** Page facts one scripted world reports. */
export interface PageWorld {
  readonly url: string
  readonly title: string
  /** `document.readyState` the page reports. */
  readonly ready: string
  readonly scrollX: number
  readonly scrollY: number
  /** `activeElement` description, empty when the body or nothing is focused. */
  readonly active: string
  /** Number of neutralized page dialogs the header reports. */
  readonly dialogs: number
  readonly viewport: { readonly width: number; readonly height: number }
  /** Whether the current document already carries the page bootstrap. */
  readonly bootstrapApplied: boolean
  /** Page-side console ring, or `null` when the document has no bootstrap state. */
  readonly console: {
    readonly entries: readonly { readonly seq: number; readonly level: string; readonly text: string }[]
    readonly seq: number
    readonly dialogs: readonly { readonly kind: string; readonly message: string }[]
  } | null
  /** Answer the highlight overlay draws with. */
  readonly highlight: string
  /** Answer every other expression evaluates to. */
  readonly evaluateText: string
}

/** Page a scripted transport reports when a test overrides nothing. */
export const DEFAULT_PAGE_WORLD: PageWorld = {
  url: 'https://example.com/page',
  title: 'Example',
  ready: 'complete',
  scrollX: 0,
  scrollY: 0,
  active: '',
  dialogs: 0,
  viewport: { width: 1000, height: 800 },
  bootstrapApplied: true,
  console: null,
  highlight: 'drawn',
  evaluateText: 'evaluated',
}

/**
 * Answer one `Runtime.evaluate` expression from a world.
 * @param world - page facts the world reports.
 * @param expression - expression source the provider sent.
 * @returns the protocol result for that expression.
 */
function evaluateFor(world: PageWorld, expression: string): unknown {
  if (expression === 'window.__dshBrowser !== undefined') return { result: { value: world.bootstrapApplied } }
  if (expression === PAGE_BOOTSTRAP_SOURCE) return { result: { value: 'installed' } }
  if (expression.includes('state.entries.slice()')) return { result: { value: world.console } }
  if (expression.includes('document.activeElement')) {
    return {
      result: {
        value: {
          url: world.url,
          title: world.title,
          ready: world.ready,
          scrollY: Math.round(world.scrollY),
          active: world.active,
          dialogs: world.dialogs,
        },
      },
    }
  }
  if (expression.includes('({ ready: document.readyState })')) return { result: { value: { ready: world.ready } } }
  if (expression.includes('({ width: window.innerWidth')) return { result: { value: world.viewport } }
  if (expression.includes('window.scrollX')) return { result: { value: { x: world.scrollX, y: world.scrollY } } }
  if (expression.includes(HIGHLIGHT_ELEMENT_ID)) return { result: { value: world.highlight } }
  return { result: { value: world.evaluateText } }
}

/**
 * Script one transport with a page world.
 * @param transport - transport to script.
 * @param overrides - page facts this world replaces.
 * @returns the world the transport now answers with.
 */
export function scriptPageWorld(transport: FakeBrowserTransport, overrides: Partial<PageWorld> = {}): PageWorld {
  const world = { ...DEFAULT_PAGE_WORLD, ...overrides }
  transport.on('Runtime.evaluate', params => evaluateFor(world, String(params.expression)))
  return world
}
