import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseBrowserOwner,
  parseBrowserRef,
  type BrowserActionName,
  type BrowserActRequest,
  type BrowserOwner,
  type BrowserRef,
} from '@deepseek-ai/dsh-browser'
import { CdpSession } from '../src/cdp.ts'
import { performAction, resolveElement, settlePage } from '../src/interaction.ts'
import { RefStore } from '../src/observation.ts'
import { fakeTransport, type FakeBrowserTransport } from './fake-browser-transport.ts'
import { scriptPageWorld, type PageWorld } from './page-world.ts'

/** Owner every request in this suite carries. */
const OWNER: BrowserOwner = parseBrowserOwner('session-a')

/** Viewport the provider read before the action. */
const VIEWPORT = { width: 900, height: 700 }

/** Element measurement the scripted page returns. */
const BOX = { x: 100, y: 200, width: 40, height: 20, description: 'button #go' }

/** Target that resolves through the scripted DOM query. */
const SELECTOR_TARGET = { kind: 'selector', selector: '#go' } as const

/** Script one transport with element resolution and the page world. */
interface ActionScript {
  /** Element measurement; `null` answers the measurement with no value at all. */
  readonly measurement?: unknown
  /** Answer of the page-side select function. */
  readonly selectResult?: string
  /** Node id the DOM query reports; `0` means no element matched. */
  readonly queryNodeId?: number
  /** Object id the DOM resolution returns; `null` answers without an object. */
  readonly objectId?: string | null
  readonly world?: Partial<PageWorld>
}

/**
 * Script one transport with element resolution, input dispatch, and a page world.
 * @param script - element answers this transport reports.
 * @returns the scripted transport.
 */
function actionTransport(script: ActionScript = {}): FakeBrowserTransport {
  const transport = fakeTransport()
  scriptPageWorld(transport, script.world ?? {})
  transport.on('DOM.getDocument', () => ({ root: { nodeId: 7 } }))
  transport.on('DOM.querySelector', () => ({ nodeId: script.queryNodeId ?? 9 }))
  transport.on('DOM.resolveNode', () => (
    script.objectId === null ? {} : { object: { objectId: script.objectId ?? 'remote-9' } }
  ))
  transport.on('Runtime.callFunctionOn', (params) => {
    const declaration = String(params.functionDeclaration)
    if (declaration.includes('getBoundingClientRect')) {
      return script.measurement === null ? { result: {} } : { result: { value: script.measurement ?? BOX } }
    }
    if (declaration.includes("this.tagName !== 'SELECT'")) return { result: { value: script.selectResult ?? 'applied' } }
    return { result: { value: true } }
  })
  transport.on('Input.dispatchMouseEvent', () => ({}))
  transport.on('Input.dispatchKeyEvent', () => ({}))
  transport.on('Input.insertText', () => ({}))
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
 * Build one action request for the owner every test uses.
 * @param request - action verb and its parameters.
 * @returns the complete request.
 */
function requestOf(request: Partial<BrowserActRequest> & { readonly action: BrowserActionName }): BrowserActRequest {
  return { owner: OWNER, ...request }
}

/**
 * Mint-free reference text for a reference no store ever minted.
 * @param text - reference text without its sigil.
 * @returns the branded reference.
 */
function refOf(text: string): BrowserRef {
  const ref = parseBrowserRef(text)
  if (ref === undefined) throw new Error(`test reference ${text} is not a browser reference`)
  return ref
}

describe('settlePage', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('returns once the document reported complete twice in a row', async () => {
    const transport = actionTransport({ world: { ready: 'complete' } })

    const settling = settlePage(sessionOf(transport), 0)
    await vi.advanceTimersByTimeAsync(200)
    await settling

    expect(transport.count('Runtime.evaluate')).toBe(2)
    expect(transport.paramsOf('Runtime.evaluate').expression).toBe('({ ready: document.readyState })')
  })

  it('keeps polling while the document is still loading and gives up at its own deadline', async () => {
    const transport = actionTransport({ world: { ready: 'loading' } })

    const settling = settlePage(sessionOf(transport), 0)
    await vi.advanceTimersByTimeAsync(6_000)
    await settling

    expect(transport.count('Runtime.evaluate')).toBeGreaterThanOrEqual(41)
    expect(transport.count('Runtime.evaluate')).toBeLessThanOrEqual(45)
  })

  it('waits out the quiet period before the first read', async () => {
    const transport = actionTransport({ world: { ready: 'complete' } })
    const session = sessionOf(transport)

    const settling = settlePage(session, 250)
    await vi.advanceTimersByTimeAsync(249)
    expect(transport.count('Runtime.evaluate')).toBe(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(transport.count('Runtime.evaluate')).toBe(1)

    await vi.advanceTimersByTimeAsync(120)
    await settling
    expect(transport.count('Runtime.evaluate')).toBe(2)
  })

  it('refuses to wait when the caller already cancelled', async () => {
    const transport = actionTransport()

    await expect(settlePage(sessionOf(transport), 0, AbortSignal.abort())).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_ABORTED', message: 'browser action aborted' }),
    )
    expect(transport.count('Runtime.evaluate')).toBe(0)
  })

  it('stops waiting as soon as the caller cancels during the quiet period', async () => {
    const transport = actionTransport()
    const controller = new AbortController()

    const settling = settlePage(sessionOf(transport), 250, controller.signal)
    controller.abort()

    await expect(settling).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ABORTED' }))
    expect(transport.count('Runtime.evaluate')).toBe(0)
  })

  it('keeps a caller signal readable after the page settled', async () => {
    const transport = actionTransport({ world: { ready: 'complete' } })
    const controller = new AbortController()

    const settling = settlePage(sessionOf(transport), 0, controller.signal)
    await vi.advanceTimersByTimeAsync(200)
    await settling
    const probes = transport.count('Runtime.evaluate')

    controller.abort()

    expect(transport.count('Runtime.evaluate')).toBe(probes)
  })
})

describe('resolveElement', () => {
  it('resolves a viewport point without asking the page', async () => {
    const transport = actionTransport()

    await expect(resolveElement(sessionOf(transport), new RefStore(), { kind: 'point', x: 12, y: 34 })).resolves.toEqual({
      objectId: '',
      rect: { x: 12, y: 34, width: 0, height: 0 },
      description: 'point 12,34',
    })
    expect(transport.commands).toEqual([])
  })

  it('measures a CSS selector match in viewport coordinates', async () => {
    const transport = actionTransport()

    await expect(resolveElement(sessionOf(transport), new RefStore(), SELECTOR_TARGET)).resolves.toEqual({
      objectId: 'remote-9',
      rect: { x: 100, y: 200, width: 40, height: 20 },
      description: 'button #go',
    })
    expect(transport.paramsOf('DOM.querySelector')).toEqual({ nodeId: 7, selector: '#go' })
    expect(transport.paramsOf('Runtime.callFunctionOn').objectId).toBe('remote-9')
  })

  it('resolves a minted reference through its backend node', async () => {
    const transport = actionTransport()
    transport.on('DOM.resolveNode', params => ({ object: { objectId: `remote-${String(params.backendNodeId)}` } }))
    const refs = new RefStore()
    const ref = refs.mint(5150)

    await expect(resolveElement(sessionOf(transport), refs, { kind: 'ref', ref })).resolves.toMatchObject({
      objectId: 'remote-5150',
    })
    expect(transport.paramsOf('DOM.resolveNode')).toEqual({ backendNodeId: 5150 })
    expect(transport.count('DOM.querySelector')).toBe(0)
  })

  it('refuses a reference no observation minted', async () => {
    const transport = actionTransport()

    await expect(resolveElement(sessionOf(transport), new RefStore(), { kind: 'ref', ref: refOf('e9') })).rejects.toThrow(
      expect.objectContaining({
        code: 'BROWSER_REF_STALE',
        message: 'element @e9 is stale: observe the page again before acting',
      }),
    )
    expect(transport.count('DOM.resolveNode')).toBe(0)
  })

  it('refuses a reference whose element the page no longer holds', async () => {
    const transport = actionTransport({ objectId: null })
    const refs = new RefStore()

    await expect(resolveElement(sessionOf(transport), refs, { kind: 'ref', ref: refs.mint(12) })).rejects.toThrow(
      expect.objectContaining({
        code: 'BROWSER_REF_STALE',
        message: 'element @e1 is no longer in the document: observe the page again',
      }),
    )
  })

  it('refuses a selector that matched no element', async () => {
    const transport = actionTransport({ queryNodeId: 0 })

    await expect(resolveElement(sessionOf(transport), new RefStore(), { kind: 'selector', selector: '.missing' })).rejects.toThrow(
      expect.objectContaining({
        code: 'BROWSER_ACTION_FAILED',
        message: 'selector ".missing" matched no element',
      }),
    )
    expect(transport.count('DOM.resolveNode')).toBe(0)
  })

  it('refuses a selector whose element is detached', async () => {
    const transport = actionTransport({ objectId: null })

    await expect(resolveElement(sessionOf(transport), new RefStore(), SELECTOR_TARGET)).rejects.toThrow(
      expect.objectContaining({
        code: 'BROWSER_ACTION_FAILED',
        message: 'selector "#go" matched a detached element',
      }),
    )
  })

  it('refuses an element the page reports no box for', async () => {
    const transport = actionTransport({ measurement: null })

    await expect(resolveElement(sessionOf(transport), new RefStore(), SELECTOR_TARGET)).rejects.toThrow(
      expect.objectContaining({
        code: 'BROWSER_ACTION_FAILED',
        message: 'target element has no box to act on (it may be hidden or zero-sized)',
      }),
    )
  })

  it('refuses a zero-width box and a zero-height box', async () => {
    const flat = actionTransport({ measurement: { ...BOX, width: 0 } })
    const empty = actionTransport({ measurement: { ...BOX, height: 0 } })

    await expect(resolveElement(sessionOf(flat), new RefStore(), SELECTOR_TARGET)).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_ACTION_FAILED' }),
    )
    await expect(resolveElement(sessionOf(empty), new RefStore(), SELECTOR_TARGET)).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_ACTION_FAILED' }),
    )
  })
})

describe('performAction targeting', () => {
  it('requires a target for a verb that acts on an element', async () => {
    const transport = actionTransport()

    await expect(performAction(sessionOf(transport), new RefStore(), requestOf({ action: 'focus' }), VIEWPORT)).rejects.toThrow(
      expect.objectContaining({
        code: 'BROWSER_ACTION_FAILED',
        message: 'focus requires a target reference or selector',
      }),
    )
    await expect(performAction(sessionOf(transport), new RefStore(), requestOf({ action: 'click' }), VIEWPORT)).rejects.toThrow(
      expect.objectContaining({ message: 'click requires a target reference or selector' }),
    )
  })

  it('refuses an action verb outside the closed union', async () => {
    const transport = actionTransport()
    const unsupported = requestOf({ action: 'teleport' as BrowserActionName })

    await expect(performAction(sessionOf(transport), new RefStore(), unsupported, VIEWPORT)).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_PROTOCOL', message: 'unsupported action teleport' }),
    )
  })
})

describe('performAction pointer and focus verbs', () => {
  it('clicks the element center with the left button once by default', async () => {
    const transport = actionTransport()

    await expect(performAction(sessionOf(transport), new RefStore(), requestOf({
      action: 'click',
      target: SELECTOR_TARGET,
    }), VIEWPORT)).resolves.toEqual({ rect: { x: 100, y: 200, width: 40, height: 20 }, description: 'button #go' })

    expect(transport.count('Input.dispatchMouseEvent')).toBe(3)
    expect(transport.paramsOf('Input.dispatchMouseEvent', 0)).toEqual({ type: 'mouseMoved', x: 100, y: 200 })
    expect(transport.paramsOf('Input.dispatchMouseEvent', 1)).toEqual({
      type: 'mousePressed',
      x: 100,
      y: 200,
      button: 'left',
      clickCount: 1,
    })
    expect(transport.paramsOf('Input.dispatchMouseEvent', 2)).toEqual({
      type: 'mouseReleased',
      x: 100,
      y: 200,
      button: 'left',
      clickCount: 1,
    })
  })

  it('honors the requested button and click count', async () => {
    const transport = actionTransport()

    await performAction(sessionOf(transport), new RefStore(), requestOf({
      action: 'click',
      target: SELECTOR_TARGET,
      button: 'middle',
      clickCount: 2,
    }), VIEWPORT)

    expect(transport.paramsOf('Input.dispatchMouseEvent', 1)).toEqual({
      type: 'mousePressed',
      x: 100,
      y: 200,
      button: 'middle',
      clickCount: 2,
    })
    expect(transport.paramsOf('Input.dispatchMouseEvent', 2)).toEqual({
      type: 'mouseReleased',
      x: 100,
      y: 200,
      button: 'middle',
      clickCount: 2,
    })
  })

  it('hovers without pressing any button', async () => {
    const transport = actionTransport()

    await expect(performAction(sessionOf(transport), new RefStore(), requestOf({
      action: 'hover',
      target: SELECTOR_TARGET,
    }), VIEWPORT)).resolves.toEqual({ rect: { x: 100, y: 200, width: 40, height: 20 }, description: 'button #go' })

    expect(transport.count('Input.dispatchMouseEvent')).toBe(1)
    expect(transport.paramsOf('Input.dispatchMouseEvent')).toEqual({ type: 'mouseMoved', x: 100, y: 200 })
  })

  it('focuses through the page rather than by activating the window', async () => {
    const transport = actionTransport()

    await expect(performAction(sessionOf(transport), new RefStore(), requestOf({
      action: 'focus',
      target: SELECTOR_TARGET,
    }), VIEWPORT)).resolves.toEqual({ rect: { x: 100, y: 200, width: 40, height: 20 }, description: 'button #go' })

    expect(transport.paramsOf('Runtime.callFunctionOn', 1).functionDeclaration).toBe(
      'function () { if (typeof this.focus === "function") this.focus(); return true }',
    )
    expect(transport.count('Input.dispatchMouseEvent')).toBe(0)
  })
})

describe('performAction text verbs', () => {
  it('replaces the field contents before inserting the text', async () => {
    const transport = actionTransport()

    await expect(performAction(sessionOf(transport), new RefStore(), requestOf({
      action: 'fill',
      target: SELECTOR_TARGET,
      value: 'hello',
    }), VIEWPORT)).resolves.toEqual({ rect: { x: 100, y: 200, width: 40, height: 20 }, description: 'button #go' })

    const declaration = String(transport.paramsOf('Runtime.callFunctionOn', 1).functionDeclaration)
    expect(declaration).toContain("if (true && typeof this.select === 'function') this.select()")
    expect(transport.paramsOf('Input.insertText')).toEqual({ text: 'hello' })
  })

  it('types into the field at the current selection', async () => {
    const transport = actionTransport()

    await performAction(sessionOf(transport), new RefStore(), requestOf({
      action: 'type',
      target: SELECTOR_TARGET,
      value: 'hi',
    }), VIEWPORT)

    const declaration = String(transport.paramsOf('Runtime.callFunctionOn', 1).functionDeclaration)
    expect(declaration).toContain("if (false && typeof this.select === 'function') this.select()")
    expect(transport.paramsOf('Input.insertText')).toEqual({ text: 'hi' })
  })

  it('focuses an empty field without inserting text', async () => {
    const transport = actionTransport()

    await performAction(sessionOf(transport), new RefStore(), requestOf({ action: 'fill', target: SELECTOR_TARGET }), VIEWPORT)

    expect(transport.count('Input.insertText')).toBe(0)
    expect(transport.count('Runtime.callFunctionOn')).toBe(2)
  })
})

describe('performAction press', () => {
  it('requires a key name', async () => {
    const transport = actionTransport()

    await expect(performAction(sessionOf(transport), new RefStore(), requestOf({ action: 'press' }), VIEWPORT)).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_ACTION_FAILED', message: 'press requires a key name' }),
    )
    expect(transport.count('Input.dispatchKeyEvent')).toBe(0)
  })

  it('refuses a key name it has no definition for', async () => {
    const transport = actionTransport()

    await expect(performAction(sessionOf(transport), new RefStore(), requestOf({
      action: 'press',
      key: 'F13',
    }), VIEWPORT)).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_ACTION_FAILED',
      message: 'unsupported key "F13"',
    }))
  })

  it('presses Enter with its carriage-return text', async () => {
    const transport = actionTransport()

    await expect(performAction(sessionOf(transport), new RefStore(), requestOf({
      action: 'press',
      key: 'Enter',
    }), VIEWPORT)).resolves.toEqual({})

    expect(transport.count('Input.dispatchKeyEvent')).toBe(3)
    expect(transport.paramsOf('Input.dispatchKeyEvent', 0)).toEqual({
      type: 'rawKeyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })
    expect(transport.paramsOf('Input.dispatchKeyEvent', 1)).toEqual({
      type: 'char',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      text: '\r',
      unmodifiedText: '\r',
    })
    expect(transport.paramsOf('Input.dispatchKeyEvent', 2)).toMatchObject({ type: 'keyUp', code: 'Enter' })
  })

  it('presses a navigation key that carries no text', async () => {
    const transport = actionTransport()

    await performAction(sessionOf(transport), new RefStore(), requestOf({ action: 'press', key: 'PageDown' }), VIEWPORT)

    expect(transport.count('Input.dispatchKeyEvent')).toBe(2)
    expect(transport.paramsOf('Input.dispatchKeyEvent', 1)).toMatchObject({
      type: 'keyUp',
      key: 'PageDown',
      windowsVirtualKeyCode: 34,
    })
  })

  it('presses the space key with its own text', async () => {
    const transport = actionTransport()

    await performAction(sessionOf(transport), new RefStore(), requestOf({ action: 'press', key: ' ' }), VIEWPORT)

    expect(transport.paramsOf('Input.dispatchKeyEvent', 1)).toMatchObject({ type: 'char', code: 'Space', text: ' ' })
  })

  it('derives letter, digit, and symbol keys the browser has no definition for', async () => {
    const transport = actionTransport()

    await performAction(sessionOf(transport), new RefStore(), requestOf({ action: 'press', key: 'a' }), VIEWPORT)
    expect(transport.paramsOf('Input.dispatchKeyEvent', 0)).toEqual({
      type: 'rawKeyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
    })
    expect(transport.paramsOf('Input.dispatchKeyEvent', 1)).toMatchObject({ type: 'char', text: 'a', unmodifiedText: 'a' })

    await performAction(sessionOf(transport), new RefStore(), requestOf({ action: 'press', key: '7' }), VIEWPORT)
    expect(transport.paramsOf('Input.dispatchKeyEvent', 3)).toMatchObject({ key: '7', code: 'Digit7', windowsVirtualKeyCode: 55 })

    await performAction(sessionOf(transport), new RefStore(), requestOf({ action: 'press', key: '?' }), VIEWPORT)
    expect(transport.paramsOf('Input.dispatchKeyEvent', 6)).toMatchObject({ key: '?', code: '', windowsVirtualKeyCode: 63 })
  })

  it('focuses the target before pressing a key into it', async () => {
    const transport = actionTransport()

    await performAction(sessionOf(transport), new RefStore(), requestOf({
      action: 'press',
      key: 'Tab',
      target: SELECTOR_TARGET,
    }), VIEWPORT)

    expect(transport.paramsOf('Runtime.callFunctionOn', 1).functionDeclaration).toBe(
      'function () { if (typeof this.focus === "function") this.focus(); return true }',
    )
    expect(transport.count('Input.dispatchKeyEvent')).toBe(2)
  })

  it('presses the key at a viewport point without resolving an element', async () => {
    const transport = actionTransport()

    await performAction(sessionOf(transport), new RefStore(), requestOf({
      action: 'press',
      key: 'Escape',
      target: { kind: 'point', x: 5, y: 6 },
    }), VIEWPORT)

    expect(transport.count('Runtime.callFunctionOn')).toBe(1)
    expect(transport.paramsOf('Runtime.callFunctionOn', 0).objectId).toBe('')
  })
})

describe('performAction select', () => {
  it('reports the option the page applied', async () => {
    const transport = actionTransport({ selectResult: 'de' })

    await expect(performAction(sessionOf(transport), new RefStore(), requestOf({
      action: 'select',
      target: SELECTOR_TARGET,
      value: 'de',
    }), VIEWPORT)).resolves.toEqual({ rect: { x: 100, y: 200, width: 40, height: 20 }, description: 'button #go' })

    expect(transport.count('Runtime.callFunctionOn')).toBe(2)
    expect(transport.paramsOf('Runtime.callFunctionOn', 1).arguments).toEqual([{ value: 'de' }])
  })

  it('defaults the requested option to the empty value', async () => {
    const transport = actionTransport()

    await performAction(sessionOf(transport), new RefStore(), requestOf({ action: 'select', target: SELECTOR_TARGET }), VIEWPORT)

    expect(transport.paramsOf('Runtime.callFunctionOn', 1).arguments).toEqual([{ value: '' }])
  })

  it('refuses an option the select does not offer', async () => {
    const transport = actionTransport({ selectResult: 'no-option' })

    await expect(performAction(sessionOf(transport), new RefStore(), requestOf({
      action: 'select',
      target: SELECTOR_TARGET,
      value: 'zz',
    }), VIEWPORT)).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_ACTION_FAILED',
      message: 'select has no option "zz"',
    }))
  })

  it('refuses to select on an element that is not a select', async () => {
    const transport = actionTransport({ selectResult: 'not-a-select' })

    await expect(performAction(sessionOf(transport), new RefStore(), requestOf({
      action: 'select',
      target: SELECTOR_TARGET,
      value: 'de',
    }), VIEWPORT)).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_ACTION_FAILED',
      message: 'select requires a <select> element',
    }))
  })
})

describe('performAction scroll', () => {
  it('scrolls the page by one viewport when no distance is given', async () => {
    const transport = actionTransport()

    await expect(performAction(sessionOf(transport), new RefStore(), requestOf({ action: 'scroll' }), VIEWPORT)).resolves.toEqual({})

    expect(transport.paramsOf('Input.dispatchMouseEvent')).toEqual({
      type: 'mouseWheel',
      x: 450,
      y: 350,
      deltaX: 0,
      deltaY: 700,
    })
  })

  it('scrolls the page by the requested distance', async () => {
    const transport = actionTransport()

    await performAction(sessionOf(transport), new RefStore(), requestOf({ action: 'scroll', deltaY: -120 }), VIEWPORT)

    expect(transport.paramsOf('Input.dispatchMouseEvent')).toMatchObject({ deltaY: -120 })
  })

  it('scrolls a target element by the requested distance', async () => {
    const transport = actionTransport()

    await expect(performAction(sessionOf(transport), new RefStore(), requestOf({
      action: 'scroll',
      target: SELECTOR_TARGET,
      deltaY: 300,
    }), VIEWPORT)).resolves.toEqual({ rect: { x: 100, y: 200, width: 40, height: 20 }, description: 'button #go' })

    expect(transport.count('Input.dispatchMouseEvent')).toBe(0)
    expect(transport.paramsOf('Runtime.callFunctionOn', 1).arguments).toEqual([{ value: 300 }])
    expect(String(transport.paramsOf('Runtime.callFunctionOn', 1).functionDeclaration)).toContain('this.scrollBy')
  })
})
