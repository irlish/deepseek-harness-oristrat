/**
 * Element resolution and input dispatch.
 *
 * Input goes through the browser's own input pipeline as protocol events. No
 * operating-system input is synthesized and the window is never focused, so a
 * user typing in the application's own composer keeps working while the agent
 * drives the page — the property the whole feature is built around.
 *
 * Geometry comes from `getBoundingClientRect` because protocol mouse events
 * take viewport coordinates: the document-absolute box a layout query returns
 * lands on the wrong element as soon as the page is scrolled.
 * @module
 */

import {
  BrowserError,
  formatBrowserRef,
  type BrowserActRequest,
  type BrowserElementTarget,
  type BrowserRef,
} from '@deepseek-ai/dsh-browser'
import type { CdpSession } from './cdp.ts'
import type { RefStore } from './observation.ts'

/** A resolved element: its remote object handle and viewport geometry. */
export interface ResolvedElement {
  readonly objectId: string
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly description: string
}

/** Poll interval while waiting for a page to settle. */
const SETTLE_POLL_MS = 120

/** Longest an action waits for the page to reach a stable, loaded state. */
const SETTLE_TIMEOUT_MS = 5_000

/** Key definitions for the keys a test typically presses. */
const KEYS: Record<string, { readonly key: string; readonly code: string; readonly virtualKeyCode: number; readonly text?: string }> = {
  Enter: { key: 'Enter', code: 'Enter', virtualKeyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', virtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', virtualKeyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', virtualKeyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', virtualKeyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', virtualKeyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', virtualKeyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', virtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', virtualKeyCode: 39 },
  Home: { key: 'Home', code: 'Home', virtualKeyCode: 36 },
  End: { key: 'End', code: 'End', virtualKeyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', virtualKeyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', virtualKeyCode: 34 },
  ' ': { key: ' ', code: 'Space', virtualKeyCode: 32, text: ' ' },
}

/**
 * Resolve one key name to its protocol definition.
 * @param key - key name from a model call, for example `Enter` or `a`.
 * @returns the definition to dispatch.
 */
function keyDefinition(key: string): {
  readonly key: string
  readonly code: string
  readonly virtualKeyCode: number
  readonly text?: string
} {
  const known = KEYS[key]
  if (known !== undefined) return known
  if (key.length === 1) {
    const upper = key.toUpperCase()
    const code = /[a-z]/iu.test(key) ? `Key${upper}` : (/[0-9]/u.test(key) ? `Digit${key}` : '')
    return { key, code, virtualKeyCode: upper.charCodeAt(0), text: key }
  }
  throw new BrowserError(`unsupported key ${JSON.stringify(key)}`, 'BROWSER_ACTION_FAILED')
}

/**
 * Wait for the page to stop loading after an action.
 * @param session - command session for the browser view.
 * @param settleMs - quiet period observed before the first read.
 * @param signal - optional caller cancellation.
 */
export async function settlePage(session: CdpSession, settleMs: number, signal?: AbortSignal): Promise<void> {
  await delay(settleMs, signal)
  const started = Date.now()
  let quietChecks = 0
  for (;;) {
    const header = await session.evaluate<{ ready: string }>('({ ready: document.readyState })', signal)
    quietChecks = header.ready === 'complete' ? quietChecks + 1 : 0
    if (quietChecks >= 2) return
    if (Date.now() - started >= SETTLE_TIMEOUT_MS) return
    await delay(SETTLE_POLL_MS, signal)
  }
}

/**
 * Sleep, aborting early when the caller cancels.
 * @param ms - milliseconds to wait.
 * @param signal - optional caller cancellation.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer)
      reject(new BrowserError('browser action aborted', 'BROWSER_ABORTED'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * Resolve a target to a remote object handle with viewport geometry.
 * @param session - command session for the browser view.
 * @param refs - reference store that minted the reference, when one was used.
 * @param target - reference, selector, or viewport point.
 * @param signal - optional caller cancellation.
 * @returns the resolved element.
 */
export async function resolveElement(
  session: CdpSession,
  refs: RefStore,
  target: BrowserElementTarget,
  signal?: AbortSignal,
): Promise<ResolvedElement> {
  if (target.kind === 'point') {
    return { objectId: '', rect: { x: target.x, y: target.y, width: 0, height: 0 }, description: `point ${String(target.x)},${String(target.y)}` }
  }
  const objectId = target.kind === 'ref'
    ? await resolveRefObject(session, refs, target.ref, signal)
    : await resolveSelectorObject(session, target.selector, signal)
  const measured = await session.send<{ result: { value?: { x: number; y: number; width: number; height: number; description: string } } }>(
    'Runtime.callFunctionOn',
    {
      objectId,
      returnByValue: true,
      functionDeclaration: `function () {
        if (typeof this.scrollIntoView === 'function') this.scrollIntoView({ block: 'center', inline: 'center' })
        const rect = this.getBoundingClientRect()
        const describe = (element) => {
          const tag = element.tagName === undefined ? '' : element.tagName.toLowerCase()
          const role = element.getAttribute === undefined ? null : element.getAttribute('role')
          const label = element.getAttribute === undefined ? null : (element.getAttribute('aria-label') || element.textContent || '')
          return [tag || role || 'element', role === null ? '' : '[' + role + ']', (label || '').trim().slice(0, 60)].filter(Boolean).join(' ')
        }
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height, description: describe(this) }
      }`,
    },
    signal,
  )
  const value = measured.result.value
  if (value === undefined || value.width <= 0 || value.height <= 0) {
    throw new BrowserError('target element has no box to act on (it may be hidden or zero-sized)', 'BROWSER_ACTION_FAILED')
  }
  return { objectId, rect: { x: value.x, y: value.y, width: value.width, height: value.height }, description: value.description }
}

/**
 * Resolve a minted reference to a remote object handle.
 * @param session - command session for the browser view.
 * @param refs - reference store that minted the reference.
 * @param ref - reference text from a model call.
 * @param signal - optional caller cancellation.
 * @returns the remote object id.
 */
async function resolveRefObject(session: CdpSession, refs: RefStore, ref: BrowserRef, signal?: AbortSignal): Promise<string> {
  const backendNodeId = refs.resolve(ref)
  if (backendNodeId === undefined) {
    throw new BrowserError(`element ${formatBrowserRef(ref)} is stale: observe the page again before acting`, 'BROWSER_REF_STALE')
  }
  const resolved = await session.send<{ object?: { objectId?: string } }>('DOM.resolveNode', { backendNodeId }, signal)
  const objectId = resolved.object?.objectId
  if (objectId === undefined) {
    throw new BrowserError(`element ${formatBrowserRef(ref)} is no longer in the document: observe the page again`, 'BROWSER_REF_STALE')
  }
  return objectId
}

/**
 * Resolve a CSS selector to a remote object handle.
 * @param session - command session for the browser view.
 * @param selector - CSS selector from a model call.
 * @param signal - optional caller cancellation.
 * @returns the remote object id.
 */
async function resolveSelectorObject(session: CdpSession, selector: string, signal?: AbortSignal): Promise<string> {
  const document = await session.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0 }, signal)
  const found = await session.send<{ nodeId: number }>('DOM.querySelector', { nodeId: document.root.nodeId, selector }, signal)
  if (found.nodeId === 0) {
    throw new BrowserError(`selector ${JSON.stringify(selector)} matched no element`, 'BROWSER_ACTION_FAILED')
  }
  const resolved = await session.send<{ object?: { objectId?: string } }>('DOM.resolveNode', { nodeId: found.nodeId }, signal)
  const objectId = resolved.object?.objectId
  if (objectId === undefined) {
    throw new BrowserError(`selector ${JSON.stringify(selector)} matched a detached element`, 'BROWSER_ACTION_FAILED')
  }
  return objectId
}

/** One resolved interaction target and the element it came from. */
export interface InteractionOutcome {
  readonly rect?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly description?: string
}

/**
 * Run one action against the page.
 * @param session - command session for the browser view.
 * @param refs - reference store that minted the reference, when one was used.
 * @param request - action verb, target, and verb-specific value.
 * @param viewport - current viewport size, used for page-level scrolling.
 * @param signal - optional caller cancellation.
 * @returns the element the action resolved, when the action had one.
 */
export async function performAction(
  session: CdpSession,
  refs: RefStore,
  request: BrowserActRequest,
  viewport: { readonly width: number; readonly height: number },
  signal?: AbortSignal,
): Promise<InteractionOutcome> {
  switch (request.action) {
    case 'click':
    case 'hover': {
      const element = await resolveElement(session, refs, requiredTarget(request), signal)
      const { x, y } = element.rect
      await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, signal)
      if (request.action === 'hover') return { rect: element.rect, description: element.description }
      const button = request.button ?? 'left'
      const clickCount = request.clickCount ?? 1
      await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount }, signal)
      await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount }, signal)
      return { rect: element.rect, description: element.description }
    }
    case 'focus': {
      const element = await resolveElement(session, refs, requiredTarget(request), signal)
      await session.send('Runtime.callFunctionOn', {
        objectId: element.objectId,
        returnByValue: true,
        functionDeclaration: 'function () { if (typeof this.focus === "function") this.focus(); return true }',
      }, signal)
      return { rect: element.rect, description: element.description }
    }
    case 'fill':
    case 'type': {
      const element = await resolveElement(session, refs, requiredTarget(request), signal)
      const value = request.value ?? ''
      await session.send('Runtime.callFunctionOn', {
        objectId: element.objectId,
        returnByValue: true,
        functionDeclaration: `function () {
          if (typeof this.focus === 'function') this.focus()
          if (${request.action === 'fill' ? 'true' : 'false'} && typeof this.select === 'function') this.select()
          else if (${request.action === 'fill' ? 'true' : 'false'} && this.isContentEditable === true) {
            const range = document.createRange()
            range.selectNodeContents(this)
            const selection = window.getSelection()
            selection.removeAllRanges()
            selection.addRange(range)
          }
          return true
        }`,
      }, signal)
      if (value !== '') await session.send('Input.insertText', { text: value }, signal)
      return { rect: element.rect, description: element.description }
    }
    case 'press': {
      const key = request.key === undefined ? undefined : keyDefinition(request.key)
      if (key === undefined) throw new BrowserError('press requires a key name', 'BROWSER_ACTION_FAILED')
      if (request.target !== undefined) {
        const element = await resolveElement(session, refs, request.target, signal)
        await session.send('Runtime.callFunctionOn', {
          objectId: element.objectId,
          returnByValue: true,
          functionDeclaration: 'function () { if (typeof this.focus === "function") this.focus(); return true }',
        }, signal)
      }
      const base = { key: key.key, code: key.code, windowsVirtualKeyCode: key.virtualKeyCode, nativeVirtualKeyCode: key.virtualKeyCode }
      await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }, signal)
      if (key.text !== undefined) await session.send('Input.dispatchKeyEvent', { type: 'char', ...base, text: key.text, unmodifiedText: key.text }, signal)
      await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, signal)
      return {}
    }
    case 'select': {
      const element = await resolveElement(session, refs, requiredTarget(request), signal)
      const value = request.value ?? ''
      const applied = await session.send<{ result: { value?: string } }>('Runtime.callFunctionOn', {
        objectId: element.objectId,
        returnByValue: true,
        functionDeclaration: `function (wanted) {
          if (this.tagName !== 'SELECT') return 'not-a-select'
          const options = Array.from(this.options)
          const match = options.find((option) => option.value === wanted)
            ?? options.find((option) => option.textContent.trim() === wanted)
          if (match === undefined) return 'no-option'
          this.value = match.value
          this.dispatchEvent(new Event('input', { bubbles: true }))
          this.dispatchEvent(new Event('change', { bubbles: true }))
          return this.value
        }`,
        arguments: [{ value }],
      }, signal)
      const result = applied.result.value
      if (result === 'no-option') throw new BrowserError(`select has no option ${JSON.stringify(value)}`, 'BROWSER_ACTION_FAILED')
      if (result === 'not-a-select') throw new BrowserError('select requires a <select> element', 'BROWSER_ACTION_FAILED')
      return { rect: element.rect, description: element.description }
    }
    case 'scroll': {
      const deltaY = request.deltaY ?? viewport.height
      if (request.target === undefined) {
        await session.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: Math.round(viewport.width / 2),
          y: Math.round(viewport.height / 2),
          deltaX: 0,
          deltaY,
        }, signal)
        return {}
      }
      const element = await resolveElement(session, refs, request.target, signal)
      await session.send('Runtime.callFunctionOn', {
        objectId: element.objectId,
        returnByValue: true,
        functionDeclaration: 'function (delta) { if (typeof this.scrollBy === "function") this.scrollBy({ top: delta, behavior: "instant" }); return true }',
        arguments: [{ value: deltaY }],
      }, signal)
      return { rect: element.rect, description: element.description }
    }
    default:
      // Closed union: a new action verb must be handled above.
      request.action satisfies never
      throw new BrowserError(`unsupported action ${String(request.action)}`, 'BROWSER_PROTOCOL')
  }
}

/**
 * Read a required action target.
 * @param request - action request that needs an element.
 * @returns the target the caller supplied.
 */
function requiredTarget(request: BrowserActRequest): BrowserElementTarget {
  if (request.target === undefined) {
    throw new BrowserError(`${request.action} requires a target reference or selector`, 'BROWSER_ACTION_FAILED')
  }
  return request.target
}
