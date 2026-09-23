/**
 * The script this provider installs into every document the browser view loads.
 *
 * One injected script replaces three protocol features this seam does not
 * expose: console capture (no CDP event channel crosses the transport), dialog
 * neutralization (a page-authored `alert` would block the very command that
 * could dismiss it), and the in-page highlight overlay (a native child view
 * composites above client DOM, so an overlay must live inside the page).
 * @module
 */

import type { BrowserConsoleEntry } from '@deepseek-ai/dsh-browser'
import type { CdpSession } from './cdp.ts'

/** Maximum entries the page-side ring retains before dropping the oldest. */
export const PAGE_CONSOLE_CAPACITY = 200

/** Highlight box drawn around the element an action resolved. */
export const HIGHLIGHT_ELEMENT_ID = '__dsh-browser-highlight'

/**
 * The injected source. It is written as one expression so it can run both from
 * `Page.addScriptToEvaluateOnNewDocument` and from a re-install after the page
 * already exists; every value it defines is idempotent.
 */
export const PAGE_BOOTSTRAP_SOURCE = `(() => {
  if (window.__dshBrowser !== undefined) return 'already-installed'
  const state = { entries: [], seq: 0, dialogs: [], capacity: ${String(PAGE_CONSOLE_CAPACITY)} }
  window.__dshBrowser = state
  const record = (level, parts) => {
    const text = parts.map((part) => {
      if (typeof part === 'string') return part
      try { return JSON.stringify(part) } catch { return String(part) }
    }).join(' ')
    state.seq += 1
    state.entries.push({ seq: state.seq, level, text })
    while (state.entries.length > state.capacity) state.entries.shift()
  }
  const levels = ['log', 'debug', 'info', 'warn', 'error']
  for (const name of levels) {
    const original = console[name] === undefined ? () => {} : console[name].bind(console)
    console[name] = (...parts) => {
      record(name, parts)
      original(...parts)
    }
  }
  window.addEventListener('error', (event) => {
    record('error', ['uncaught ' + (event.message || 'error') + (event.filename ? ' at ' + event.filename + ':' + event.lineno : '')])
  })
  window.addEventListener('unhandledrejection', (event) => {
    record('error', ['unhandled rejection ' + String(event.reason)])
  })
  const neutralize = (name, fallback) => {
    window[name] = (message) => {
      state.dialogs.push({ kind: name, message: message === undefined ? '' : String(message) })
      record('warn', ['page dialog ' + name + ': ' + String(message === undefined ? '' : message)])
      return fallback
    }
  }
  neutralize('alert', undefined)
  neutralize('confirm', false)
  neutralize('prompt', null)
  return 'installed'
})()`

/** Shape the page-side ring reports back through `Runtime.evaluate`. */
interface PageConsoleState {
  readonly entries: readonly { seq: number; level: BrowserConsoleEntry['level']; text: string }[]
  readonly seq: number
  readonly dialogs: readonly { kind: string; message: string }[]
}

/**
 * Install the page bootstrap in every document this view loads, including the
 * document already displayed.
 * @param session - command session for the browser view.
 * @param signal - optional caller cancellation.
 */
export async function installPageBootstrap(session: CdpSession, signal?: AbortSignal): Promise<void> {
  await session.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_BOOTSTRAP_SOURCE }, signal)
  await ensureBootstrapApplied(session, signal)
}

/**
 * Make sure the document on screen carries the page bootstrap, installing it
 * when a recreated view lost the new-document registration.
 * @param session - command session for the browser view.
 * @param signal - optional caller cancellation.
 */
export async function ensureBootstrapApplied(session: CdpSession, signal?: AbortSignal): Promise<void> {
  const present = await session.evaluate<boolean>('window.__dshBrowser !== undefined', signal)
  if (present) return
  await session.evaluate<string>(PAGE_BOOTSTRAP_SOURCE, signal)
}

/**
 * Read the page-side console ring.
 * @param session - command session for the browser view.
 * @param signal - optional caller cancellation.
 * @returns entries in page order plus the sequence numbers they carry.
 */
export async function readPageConsole(session: CdpSession, signal?: AbortSignal): Promise<{
  readonly entries: readonly BrowserConsoleEntry[]
  readonly cursor: number
  readonly dialogs: readonly { kind: string; message: string }[]
}> {
  const state = await session.evaluate<PageConsoleState | null>(`(() => {
    const state = window.__dshBrowser
    if (state === undefined) return null
    return { entries: state.entries.slice(), seq: state.seq, dialogs: state.dialogs.slice() }
  })()`, signal)
  if (state === null) return { entries: [], cursor: 0, dialogs: [] }
  return {
    entries: state.entries.map(entry => ({ ...entry, level: entry.level })),
    cursor: state.seq,
    dialogs: state.dialogs,
  }
}

/**
 * Draw the action highlight over one viewport rectangle and fade it out.
 * @param session - command session for the browser view.
 * @param rect - viewport-relative rectangle, or `undefined` to clear it.
 * @param signal - optional caller cancellation.
 */
export async function drawHighlight(
  session: CdpSession,
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const payload = JSON.stringify(rect ?? null)
  await session.evaluate<string>(`(() => {
    let box = document.getElementById(${JSON.stringify(HIGHLIGHT_ELEMENT_ID)})
    if (box === null) {
      box = document.createElement('div')
      box.id = ${JSON.stringify(HIGHLIGHT_ELEMENT_ID)}
      box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #2f6feb;border-radius:3px;box-shadow:0 0 0 2px rgba(47,111,235,.25);transition:opacity .25s'
      document.documentElement.appendChild(box)
    }
    const rect = ${payload}
    if (rect === null) { box.style.opacity = '0'; return 'cleared' }
    box.style.left = rect.x + 'px'
    box.style.top = rect.y + 'px'
    box.style.width = rect.width + 'px'
    box.style.height = rect.height + 'px'
    box.style.opacity = '1'
    setTimeout(() => { box.style.opacity = '0' }, 1200)
    return 'drawn'
  })()`, signal)
}
