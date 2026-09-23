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
 * Element references for one document. References are minted by an observation
 * and resolve through the accessibility node's backend DOM node, which stays
 * valid while the document does; the previous observation's references remain
 * resolvable so a model that reads a page and then acts on it is never racing
 * its own re-observation.
 */
export class RefStore {
  private current = new Map<BrowserRef, number>()
  private previous = new Map<BrowserRef, number>()
  private next = 1

  /** Start a new observation generation, demoting the last one to fallback. */
  beginGeneration(): void {
    this.previous = this.current
    this.current = new Map()
    this.next = 1
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
    return ref
  }

  /**
   * Resolve a reference the model supplied.
   * @param ref - reference text from a model call.
   * @returns the backend DOM node id, or `undefined` when the reference is stale.
   */
  resolve(ref: BrowserRef): number | undefined {
    return this.current.get(ref) ?? this.previous.get(ref)
  }

  /** Forget both generations, because the document that owned them is gone. */
  reset(): void {
    this.current = new Map()
    this.previous = new Map()
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
  let byteLength = 0
  const progress = { truncated: false }

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
        const indent = '  '.repeat(depth)
        const backendDOMNodeId = node.backendDOMNodeId
        const ref = backendDOMNodeId === undefined ? undefined : refs.mint(backendDOMNodeId)
        const text = `${indent}${ref === undefined ? '- ' : `${formatBrowserRef(ref)} `}${body}`
        if (lines.length >= options.maxNodes || byteLength + text.length > options.maxBytes) {
          progress.truncated = true
          return
        }
        lines.push(ref === undefined ? { text } : { text, ref })
        byteLength += text.length
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

  const headerLine = `[page] url=${header.url} title=${header.title} viewport=${String(viewport.width)}x${String(viewport.height)} scrollY=${String(header.scrollY)}`
  const focusLine = header.active === '' ? '' : `\n[focused] ${header.active}`
  const dialogLine = header.dialogs === 0 ? '' : `\n[dialogs] ${String(header.dialogs)} page dialog(s) were neutralized; see browser_console`
  const truncatedLine = progress.truncated ? `\n[truncated] nodes=${String(emitted)} shown=${String(lines.length)} next_cursor=${String(emitted)}` : ''
  const text = `${headerLine}${focusLine}${dialogLine}\n${lines.map(line => line.text).join('\n')}${truncatedLine}`
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
    byteLength: text.length,
  }
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
