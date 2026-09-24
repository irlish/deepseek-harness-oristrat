/**
 * Turning one page into the reference-bearing text a model acts on.
 *
 * The observation is derived from the accessibility tree rather than from a DOM
 * dump: it is the tree the browser already computed for assistive technology,
 * so it omits painted-but-hidden nodes without a visibility heuristic of our
 * own, and it stays two orders of magnitude smaller than the raw DOM snapshot
 * the browser can also produce. Geometry is deliberately absent — an action
 * resolves its own geometry when it runs, so the text stays cheap to read.
 * @module
 */

import {
  BrowserError,
  createBrowserRef,
  formatBrowserRef,
  type BrowserObservation,
  type BrowserPageState,
  type BrowserRef,
} from '@deepseek-ai/dsh-browser'
import type { CdpSession } from './cdp.ts'

/** One accessibility node the browser exposed, reduced to what the model reads. */
interface AxNode {
  readonly nodeId: string
  readonly ignored?: boolean
  readonly role?: { readonly value?: string }
  readonly name?: { readonly value?: string }
  readonly value?: { readonly value?: string }
  readonly properties?: readonly { readonly name: string; readonly value?: { readonly value?: unknown } }[]
  readonly childIds?: readonly string[]
  readonly parentId?: string
  readonly backendDOMNodeId?: number
}

/** Page facts one observation reports alongside its tree. */
interface PageHeader {
  readonly url: string
  readonly title: string
  readonly ready: string
  readonly scrollY: number
  readonly active: string
  readonly dialogs: number
}

/**
 * Byte cost the truncation marker adds to a clipped observation, at the widest
 * `nodes`/`shown`/`next_cursor` values it can report. The bound reserves it so
 * the complete emitted text — marker included — stays inside `maxBytes`.
 */
const TRUNCATION_MARKER_BYTES = Buffer.byteLength('\n[truncated] nodes=9999999 shown=9999999 next_cursor=9999999', 'utf8')

/** Accessibility properties rendered as bracketed states on the node line. */
const STATE_PROPERTIES = [
  'disabled', 'checked', 'expanded', 'focused', 'selected', 'required', 'readonly', 'invalid', 'modal', 'busy',
] as const

/** Roles emitted even without an accessible name, because the model can act on them. */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'combobox',
  'listbox', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'treeitem', 'row', 'cell',
  'dialog', 'alertdialog', 'textfield',
])

/** Roles that give the model the page's structure even when unnamed. */
const STRUCTURAL_ROLES = new Set([
  'form', 'navigation', 'main', 'banner', 'contentinfo', 'region', 'article', 'complementary', 'search',
  'heading', 'img', 'image', 'table', 'list', 'listitem', 'progressbar', 'status', 'alert', 'tooltip', 'iframe',
])

/**
 * Element references for one document. A reference text is minted once and never
 * reused, because the counter advances across observation generations: an older
 * reference can therefore only resolve to the node it was minted for, never to a
 * node a later observation happened to number the same way.
 *
 * The previous generation stays resolvable while its node is still part of the
 * newest observation, so a model that reads a page and then acts on it is not
 * racing its own re-observation. A reference whose node the newest observation
 * dropped, and everything older than the previous generation, is stale.
 */
export class RefStore {
  private current = new Map<BrowserRef, number>()
  private previous = new Map<BrowserRef, number>()
  private observed = new Set<number>()
  private next = 1

  /** Start a new observation generation, demoting the last one to fallback. */
  beginGeneration(): void {
    this.previous = this.current
    this.current = new Map()
    this.observed = new Set()
  }

  /**
   * Mint the reference for one accessibility node.
   * @param backendNodeId - backend DOM node id the reference resolves through.
   * @returns the reference text the model reads as `@eN`.
   */
  mint(backendNodeId: number): BrowserRef {
    const ref = createBrowserRef(this.next)
    this.next += 1
    this.current.set(ref, backendNodeId)
    this.observed.add(backendNodeId)
    return ref
  }

  /**
   * Resolve a reference the model supplied.
   * @param ref - reference text from a model call.
   * @returns the backend DOM node id, or `undefined` when the reference is stale.
   */
  resolve(ref: BrowserRef): number | undefined {
    const current = this.current.get(ref)
    if (current !== undefined) return current
    const previous = this.previous.get(ref)
    // A fallback reference resolves only while the newest observation still
    // holds the node it names.
    return previous !== undefined && this.observed.has(previous) ? previous : undefined
  }

  /** Forget both generations, because the document that owned them is gone. */
  reset(): void {
    this.current = new Map()
    this.previous = new Map()
    this.observed = new Set()
    this.next = 1
  }
}

/**
 * Read the page facts every observation and state answer reports.
 * @param session - command session for the browser view.
 * @param signal - optional caller cancellation.
 * @returns the current page header.
 */
export async function readPageHeader(session: CdpSession, signal?: AbortSignal): Promise<PageHeader> {
  return await session.evaluate<PageHeader>(`(() => {
    const active = document.activeElement
    const dialogs = window.__dshBrowser === undefined ? 0 : window.__dshBrowser.dialogs.length
    return {
      url: location.href,
      title: document.title,
      ready: document.readyState,
      scrollY: Math.round(window.scrollY),
      active: active === null || active === document.body ? '' : active.tagName.toLowerCase()
        + (active.id === '' ? '' : '#' + active.id),
      dialogs,
    }
  })()`, signal)
}

/**
 * Read the observable page state, including history availability.
 * @param session - command session for the browser view.
 * @param signal - optional caller cancellation.
 * @returns the state a caller asserts on.
 */
export async function readPageState(session: CdpSession, signal?: AbortSignal): Promise<BrowserPageState> {
  const [header, viewport, history] = await Promise.all([
    readPageHeader(session, signal),
    session.viewport(signal),
    session.send<{ currentIndex: number; entries: readonly unknown[] }>('Page.getNavigationHistory', {}, signal),
  ])
  return {
    url: header.url,
    title: header.title,
    loading: header.ready !== 'complete',
    canGoBack: history.currentIndex > 0,
    canGoForward: history.currentIndex < history.entries.length - 1,
    viewport,
  }
}

/** One rendered observation line plus the reference it minted. */
interface RenderedLine {
  readonly text: string
  readonly ref?: BrowserRef
}

/**
 * Read and render the accessibility tree of the current page.
 *
 * `maxBytes` bounds the UTF-8 bytes of the complete emitted text: the renderer
 * charges the page header, its focus and dialog lines, the truncation marker,
 * and every node line against it. Text a page renders in a multibyte script
 * therefore costs what it actually occupies in the request, not one byte per
 * UTF-16 code unit. The header and marker are never clipped, so they are the
 * floor below which no node line fits.
 * @param session - command session for the browser view.
 * @param refs - reference store for the document being observed.
 * @param options - output bounds and optional continuation cursor.
 * @param signal - optional caller cancellation.
 * @returns one bounded observation generation.
 */
export async function observePage(
  session: CdpSession,
  refs: RefStore,
  options: { readonly maxDepth: number; readonly maxNodes: number; readonly maxBytes: number; readonly cursor?: string },
  signal?: AbortSignal,
): Promise<BrowserObservation> {
  const startIndex = parseCursor(options.cursor)
  const header = await readPageHeader(session, signal)
  const viewport = await session.viewport(signal)
  const tree = await session.send<{ nodes: readonly AxNode[] }>('Accessibility.getFullAXTree', {}, signal)
  refs.beginGeneration()

  const byId = new Map(tree.nodes.map(node => [node.nodeId, node]))
  const roots = tree.nodes.filter(node => node.parentId === undefined || !byId.has(node.parentId))
  const lines: RenderedLine[] = []
  let emitted = 0
  let lineBytes = 0
  const progress = { truncated: false }

  const headerLine = `[page] url=${header.url} title=${header.title} viewport=${String(viewport.width)}x${String(viewport.height)} scrollY=${String(header.scrollY)}`
  const focusLine = header.active === '' ? '' : `\n[focused] ${header.active}`
  const dialogLine = header.dialogs === 0 ? '' : `\n[dialogs] ${String(header.dialogs)} page dialog(s) were neutralized; see browser_console`
  const prefix = `${headerLine}${focusLine}${dialogLine}\n`
  const lineBudget = Math.max(0, options.maxBytes - utf8ByteLength(prefix) - TRUNCATION_MARKER_BYTES)

  const walk = (node: AxNode, depth: number): void => {
    if (progress.truncated) return
    const children = node.childIds ?? []
    if (node.ignored === true) {
      for (const childId of children) {
        const child = byId.get(childId)
        if (child !== undefined) walk(child, depth)
      }
      return
    }
    const role = node.role?.value ?? 'generic'
    const name = node.name?.value ?? ''
    const body = renderNodeBody(node, role, name, depth, options.maxDepth)
    if (body !== null) {
      if (emitted >= startIndex) {
        // The node bound is decided before the reference is minted, so a line
        // that never renders cannot consume an index the text does not show.
        if (lines.length >= options.maxNodes) {
          progress.truncated = true
          return
        }
        const indent = '  '.repeat(depth)
        const backendDOMNodeId = node.backendDOMNodeId
        const ref = backendDOMNodeId === undefined ? undefined : refs.mint(backendDOMNodeId)
        const text = `${indent}${ref === undefined ? '- ' : `${formatBrowserRef(ref)} `}${body}`
        const bytes = utf8ByteLength(text)
        if (lineBytes + bytes > lineBudget) {
          progress.truncated = true
          return
        }
        lines.push(ref === undefined ? { text } : { text, ref })
        lineBytes += bytes
      }
      emitted += 1
      depth += 1
    }
    if (depth > options.maxDepth) return
    for (const childId of children) {
      const child = byId.get(childId)
      if (child !== undefined) walk(child, depth)
    }
  }
  for (const root of roots) walk(root, 0)

  const truncatedLine = progress.truncated ? `\n[truncated] nodes=${String(emitted)} shown=${String(lines.length)} next_cursor=${String(emitted)}` : ''
  const text = `${prefix}${lines.map(line => line.text).join('\n')}${truncatedLine}`
  return {
    url: header.url,
    title: header.title,
    loading: header.ready !== 'complete',
    viewport,
    text,
    refs: lines.flatMap(line => (line.ref === undefined ? [] : [line.ref])),
    nodeCount: emitted,
    truncated: progress.truncated,
    ...(progress.truncated ? { nextCursor: String(emitted) } : {}),
    byteLength: utf8ByteLength(text),
  }
}

/**
 * Measure one string as the bytes a request carries it in.
 * @param text - rendered observation text.
 * @returns its UTF-8 byte length.
 */
function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * Parse one continuation cursor.
 * @param cursor - cursor text from a model call.
 * @returns the node index to resume at.
 */
function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (!/^[0-9]{1,7}$/u.test(cursor)) {
    throw new BrowserError(`observation cursor ${JSON.stringify(cursor)} is not a node index`, 'BROWSER_PROTOCOL')
  }
  return Number(cursor)
}

/**
 * Render one accessibility node's descriptive body, or decide it adds nothing
 * the model can use.
 * @param node - accessibility node from the browser.
 * @param role - resolved role name.
 * @param name - accessible name.
 * @param depth - tree depth, used only to stop below the requested level.
 * @param maxDepth - deepest level that still renders.
 * @returns the line body without reference or indentation, or `null` to skip.
 */
function renderNodeBody(node: AxNode, role: string, name: string, depth: number, maxDepth: number): string | null {
  const value = node.value?.value ?? ''
  const interesting = name !== '' || value !== '' || INTERACTIVE_ROLES.has(role) || STRUCTURAL_ROLES.has(role)
  if (!interesting) return null
  if (depth > maxDepth) return null
  const states: string[] = []
  for (const property of node.properties ?? []) {
    if (!(STATE_PROPERTIES as readonly string[]).includes(property.name)) continue
    const raw = property.value?.value
    if (raw === true || raw === 'true') states.push(property.name)
    else if (typeof raw === 'string' && raw !== 'false' && property.name === 'checked') states.push(`checked=${raw}`)
  }
  const label = name === '' ? '' : ` ${JSON.stringify(name)}`
  const valueText = value === '' ? '' : ` value=${JSON.stringify(value)}`
  const stateText = states.length === 0 ? '' : ` [${states.join(' ')}]`
  return `${role}${label}${valueText}${stateText}`
}
