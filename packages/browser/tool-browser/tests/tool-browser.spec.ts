import { describe, expect, it } from 'vitest'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import * as ToolBrowser from '../src/index.ts'
import {
  NO_AGENT,
  PAGE_STATE,
  TEST_SIGNAL,
  agentStub,
  attachmentsOf,
  callOf,
  mountHarness,
  recordingBrowser,
  requestOf,
  textOf,
  valueOf,
} from './harness.ts'

describe('tool registration', () => {
  it('declares the plugin identity the Loader registers', () => {
    expect(ToolBrowser.name).toBe('tool-browser')
    expect(ToolBrowser.inject).toEqual(['tools', 'browser'])
  })

  it('registers exactly the seven browser tools while a provider is mounted', async () => {
    const h = await mountHarness()
    expect(h.ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'browser_act',
      'browser_console',
      'browser_eval',
      'browser_navigate',
      'browser_observe',
      'browser_screenshot',
      'browser_state',
    ])
  })
})

describe('browser_navigate', () => {
  it('navigates to a URL with the calling session as owner', async () => {
    const h = await mountHarness()
    const result = await h.call('browser_navigate', { action: 'goto', url: 'https://example.test/next' })

    expect(requestOf('navigate')).toEqual({
      owner: 'session-1',
      action: 'goto',
      url: 'https://example.test/next',
    })
    expect(textOf(result)).toBe(`reached: ${PAGE_STATE.url} "${PAGE_STATE.title}"`)
    expect(valueOf(result)).toEqual({ ...PAGE_STATE, reached: true })
    expect(result.meta).toEqual({ url: PAGE_STATE.url, title: PAGE_STATE.title, reached: true })
  })

  it('omits the URL for a history verb and reports a navigation that did not settle', async () => {
    const h = await mountHarness()
    recordingBrowser().navigation = { ...PAGE_STATE, title: '', reached: false }
    const result = await h.call('browser_navigate', { action: 'back' })

    const request = requestOf('navigate')
    expect(request.action).toBe('back')
    expect('url' in request).toBe(false)
    expect(textOf(result)).toBe(`did not finish loading: ${PAGE_STATE.url}`)
    expect(result.meta).toEqual({ url: PAGE_STATE.url, title: '', reached: false })
  })

  it('reports the page state the provider returned after navigation', async () => {
    const h = await mountHarness()
    recordingBrowser().navigation = {
      url: 'https://example.test/other',
      title: 'Other',
      loading: true,
      viewport: { width: 800, height: 600 },
      canGoBack: false,
      canGoForward: false,
      reached: true,
    }
    const result = await h.call('browser_navigate', { action: 'reload' })
    expect(textOf(result)).toBe('reached: https://example.test/other "Other" (still loading)')
  })

  it('forwards the caller signal to the provider', async () => {
    const h = await mountHarness()
    await h.call('browser_navigate', { action: 'reload' })
    expect(callOf('navigate').signal).toBe(TEST_SIGNAL)
  })
})

describe('browser_observe', () => {
  it('passes continuation and bound arguments and serializes references for the model', async () => {
    const h = await mountHarness()
    const result = await h.call('browser_observe', { cursor: 'c-2', maxNodes: 50, maxDepth: 4 })

    expect(requestOf('observe')).toEqual({
      owner: 'session-1',
      cursor: 'c-2',
      maxNodes: 50,
      maxDepth: 4,
    })
    expect(valueOf(result)).toEqual({
      url: PAGE_STATE.url,
      title: PAGE_STATE.title,
      loading: false,
      viewport: { width: 1280, height: 720 },
      text: 'button "Submit" @e1',
      refs: ['e1'],
      nodeCount: 3,
      truncated: false,
      byteLength: 18,
    })
    expect(textOf(result)).toBe('button "Submit" @e1')
    expect(result.meta).toEqual({ url: PAGE_STATE.url, nodeCount: 3, truncated: false })
  })

  it('omits every optional bound when the call supplies none', async () => {
    const h = await mountHarness()
    await h.call('browser_observe', {})
    expect(requestOf('observe')).toEqual({ owner: 'session-1' })
  })

  it('reports a truncated observation with its cursor', async () => {
    const h = await mountHarness()
    recordingBrowser().observation = {
      ...recordingBrowser().observation,
      text: 'partial tree',
      truncated: true,
      nextCursor: 'c-3',
      byteLength: 12,
    }
    const result = await h.call('browser_observe', {})
    expect(valueOf(result)).toMatchObject({ text: 'partial tree', truncated: true, nextCursor: 'c-3' })
    expect(result.meta).toEqual({ url: PAGE_STATE.url, nodeCount: 3, truncated: true })
  })
})

describe('browser_act', () => {
  it('sends a reference action and reports the state it produced', async () => {
    const h = await mountHarness()
    recordingBrowser().actOutcome = { ...PAGE_STATE, action: 'click', ref: 'e2' as never }
    const result = await h.call('browser_act', { action: 'click', ref: '@e2' })

    expect(requestOf('act')).toEqual({
      owner: 'session-1',
      action: 'click',
      target: { kind: 'ref', ref: 'e2' },
    })
    expect(textOf(result)).toBe(`click @e2 → ${PAGE_STATE.url} "${PAGE_STATE.title}"`)
    expect(result.meta).toEqual({
      action: 'click',
      ref: '@e2',
      url: PAGE_STATE.url,
      title: PAGE_STATE.title,
    })
  })

  it('reports a page-level action without a reference', async () => {
    const h = await mountHarness()
    recordingBrowser().actOutcome = { ...PAGE_STATE, action: 'scroll' }
    const result = await h.call('browser_act', { action: 'scroll', deltaY: 400 })

    expect(requestOf('act')).toEqual({ owner: 'session-1', action: 'scroll', deltaY: 400 })
    expect(textOf(result)).toBe(`scroll → ${PAGE_STATE.url} "${PAGE_STATE.title}"`)
    expect(result.meta).toEqual({ action: 'scroll', url: PAGE_STATE.url, title: PAGE_STATE.title })
    expect('ref' in (result.meta as object)).toBe(false)
  })

  it('sends every verb-specific field the call supplies', async () => {
    const h = await mountHarness()
    await h.call('browser_act', {
      action: 'fill',
      ref: 'e3',
      value: 'hello',
      key: 'Enter',
      deltaY: 10,
      button: 'right',
      clickCount: 2,
    })

    expect(requestOf('act')).toEqual({
      owner: 'session-1',
      action: 'fill',
      target: { kind: 'ref', ref: 'e3' },
      value: 'hello',
      key: 'Enter',
      deltaY: 10,
      button: 'right',
      clickCount: 2,
    })
  })

  it('sends a selector target', async () => {
    const h = await mountHarness()
    await h.call('browser_act', { action: 'click', selector: '#submit' })
    expect(requestOf('act')).toEqual({
      owner: 'session-1',
      action: 'click',
      target: { kind: 'selector', selector: '#submit' },
    })
  })

  it('sends a point target', async () => {
    const h = await mountHarness()
    await h.call('browser_act', { action: 'click', x: 12, y: 34 })
    expect(requestOf('act')).toEqual({
      owner: 'session-1',
      action: 'click',
      target: { kind: 'point', x: 12, y: 34 },
    })
  })

  it('presses a key without a target', async () => {
    const h = await mountHarness()
    await h.call('browser_act', { action: 'press', key: 'Tab' })
    expect(requestOf('act')).toEqual({
      owner: 'session-1',
      action: 'press',
      key: 'Tab',
    })
  })

  it('sends a press without a key as the caller gave it', async () => {
    const h = await mountHarness()
    recordingBrowser().actOutcome = { ...PAGE_STATE, action: 'press' }
    const result = await h.call('browser_act', { action: 'press' })
    const request = requestOf('act')
    expect(request).toEqual({ owner: 'session-1', action: 'press' })
    expect('key' in request).toBe(false)
    expect(textOf(result)).toContain('press →')
  })

  it('refuses several targets at once', async () => {
    const h = await mountHarness()
    const result = await h.call('browser_act', { action: 'click', ref: 'e1', selector: '#a' })
    expect(textOf(result)).toContain('click accepts one of ref, selector, or x/y — not several')
    expect(recordingBrowser().calls).toEqual([])
  })

  it('refuses reference text that is not a reference', async () => {
    const h = await mountHarness()
    const result = await h.call('browser_act', { action: 'click', ref: 'submit' })
    expect(textOf(result)).toContain(
      'ref "submit" is not an element reference; pass a reference from browser_observe, for example @e12',
    )
  })

  it('refuses a point that is missing one coordinate', async () => {
    const h = await mountHarness()
    const withoutY = await h.call('browser_act', { action: 'click', x: 12 })
    expect(textOf(withoutY)).toContain('click needs both x and y for a point target')

    const withoutX = await h.call('browser_act', { action: 'click', y: 34 })
    expect(textOf(withoutX)).toContain('click needs both x and y for a point target')
  })

  it('refuses an action that requires a target when none was given', async () => {
    const h = await mountHarness()
    const result = await h.call('browser_act', { action: 'hover' })
    expect(textOf(result)).toContain('hover requires a target: pass ref, selector, or x/y')
  })

  it('refuses a value-taking action without a value', async () => {
    const h = await mountHarness()
    for (const action of ['fill', 'type', 'select']) {
      const result = await h.call('browser_act', { action, ref: 'e1' })
      expect(textOf(result), action).toContain(`${action} requires value`)
    }
    expect(recordingBrowser().calls).toEqual([])
  })

  it('surfaces the provider failure as the tool failure', async () => {
    const h = await mountHarness()
    recordingBrowser().failures.act = new Error('element is detached')
    const result = await h.call('browser_act', { action: 'click', ref: 'e1' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('element is detached')
  })
})

describe('browser_screenshot', () => {
  const headerAgent = agentStub({ header: { provider: 'visual', model: 'vision' } })

  it('captures the viewport, stores the image, and returns the stored reference', async () => {
    const h = await mountHarness()
    const result = await h.call('browser_screenshot', {}, headerAgent)

    expect(requestOf('screenshot')).toEqual({ owner: 'session-1' })
    expect(attachmentsOf(h).saved).toHaveLength(1)
    expect(attachmentsOf(h).saved[0]).toEqual({
      data: recordingBrowser().capture.bytes,
      mediaType: 'image/png',
      name: 'browser-screenshot.png',
    })
    expect(valueOf(result)).toEqual({
      url: PAGE_STATE.url,
      format: 'png',
      width: 1280,
      height: 720,
      image: {
        attachmentId: `sha256:${'0'.repeat(64)}`,
        mediaType: 'image/png',
        bytes: 4,
        width: 1280,
        height: 720,
      },
    })
    expect(textOf(result)).toBe(`captured png 1280x720 of ${PAGE_STATE.url}`)
    expect(result.content[1]).toEqual({
      type: 'image',
      attachment: {
        attachmentId: `sha256:${'0'.repeat(64)}`,
        mediaType: 'image/png',
        bytes: 4,
        width: 1280,
        height: 720,
      },
    })
    expect(result.meta).toEqual({ url: PAGE_STATE.url, format: 'png', width: 1280, height: 720 })
  })

  it('sends element framing, format, and quality, and carries the stored display name', async () => {
    const h = await mountHarness()
    attachmentsOf(h).storesName = true
    recordingBrowser().capture = {
      ...recordingBrowser().capture,
      format: 'jpeg',
      mediaType: 'image/jpeg',
      bytes: new Uint8Array([1, 2, 3]),
    }
    const result = await h.call('browser_screenshot', {
      ref: '@e4',
      full_page: true,
      format: 'jpeg',
      quality: 70,
    }, headerAgent)

    expect(requestOf('screenshot')).toEqual({
      owner: 'session-1',
      target: { kind: 'ref', ref: 'e4' },
      fullPage: true,
      format: 'jpeg',
      quality: 70,
    })
    expect(attachmentsOf(h).saved[0]?.name).toBe('browser-screenshot.jpeg')
    const value = valueOf(result)
    expect(value.image).toEqual({
      attachmentId: `sha256:${'0'.repeat(64)}`,
      mediaType: 'image/jpeg',
      bytes: 3,
      width: 1280,
      height: 720,
      name: 'browser-screenshot.jpeg',
    })
    expect(result.content[1]).toMatchObject({ type: 'image', attachment: { name: 'browser-screenshot.jpeg' } })
    expect(textOf(result)).toBe(`captured jpeg 1280x720 of ${PAGE_STATE.url}`)
  })

  it('captures one element by selector without any optional framing', async () => {
    const h = await mountHarness()
    await h.call('browser_screenshot', { selector: '#chart' }, headerAgent)
    expect(requestOf('screenshot')).toEqual({
      owner: 'session-1',
      target: { kind: 'selector', selector: '#chart' },
    })
  })

  it('refuses to capture without an attachment service', async () => {
    const h = await mountHarness({ attachments: false })
    const result = await h.call('browser_screenshot', {}, headerAgent)
    expect(textOf(result)).toContain('browser_screenshot requires a mounted attachment service to store the capture')
    expect(recordingBrowser().calls).toEqual([])
  })

  it('refuses to capture when no LLM route service is mounted', async () => {
    const h = await mountHarness({ llm: false })
    const result = await h.call('browser_screenshot', {}, headerAgent)
    expect(textOf(result)).toContain('the current model route could not be resolved')
    expect(recordingBrowser().calls).toEqual([])
  })

  it('refuses to capture when the calling agent declares no route', async () => {
    const h = await mountHarness()
    const bare = { options: {}, session: { id: 'session-1', requestHeader: () => undefined } }
    const result = await h.call('browser_screenshot', {}, bare)
    expect(textOf(result)).toContain('the current model route could not be resolved')
  })

  it('refuses to capture when the calling agent declares only a provider', async () => {
    const h = await mountHarness()
    const noModel = agentStub({ provider: 'visual' })
    const result = await h.call('browser_screenshot', {}, noModel)
    expect(textOf(result)).toContain('the current model route could not be resolved')
  })

  it('falls back to the agent route options when no request header exists', async () => {
    const h = await mountHarness()
    const result = await h.call('browser_screenshot', {}, agentStub({ provider: 'visual', model: 'vision' }))
    expect(result.isError).toBe(false)
    expect(requestOf('screenshot')).toEqual({ owner: 'session-1' })
  })

  it('refuses to capture on a model that does not declare image input', async () => {
    const h = await mountHarness()
    const textOnly = agentStub({ header: { provider: 'visual', model: 'text-only' } })
    const result = await h.call('browser_screenshot', {}, textOnly)
    expect(textOf(result)).toContain(
      'browser_screenshot cannot run: model "text-only" does not declare image input; switch to an image-capable model',
    )
    expect(attachmentsOf(h).saved).toEqual([])
    expect(recordingBrowser().calls).toEqual([])
  })

  it('refuses to capture when the model declares no modalities at all', async () => {
    const h = await mountHarness()
    const unlisted = agentStub({ header: { provider: 'visual', model: 'plain' } })
    const result = await h.call('browser_screenshot', {}, unlisted)
    expect(textOf(result)).toContain('model "plain" does not declare image input')
  })

  it('turns a storage refusal into guidance the model can act on', async () => {
    const h = await mountHarness()
    attachmentsOf(h).failure = new AttachmentError('too large', 'IMAGE_TOO_LARGE')
    const result = await h.call('browser_screenshot', { full_page: true }, headerAgent)

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain(
      'the browser captured a 4-byte image this deployment cannot store (IMAGE_TOO_LARGE);'
      + ' capture the viewport instead of the whole page, or lower the JPEG quality',
    )
  })

  it('propagates a storage failure that is not an attachment refusal', async () => {
    const h = await mountHarness()
    attachmentsOf(h).failure = new Error('disk on fire') as never
    const result = await h.call('browser_screenshot', {}, headerAgent)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('disk on fire')
  })
})

describe('browser_console', () => {
  it('reports an empty buffer with its cursor', async () => {
    const h = await mountHarness()
    recordingBrowser().consolePage = { entries: [], dropped: 0, cursor: 12 }
    const result = await h.call('browser_console', {})

    expect(requestOf('console')).toEqual({ owner: 'session-1' })
    expect(valueOf(result)).toEqual({ cursor: 12, dropped: 0, entries: [] })
    expect(textOf(result)).toBe('no console output; cursor=12')
    expect(result.meta).toEqual({ cursor: 12, entries: 0 })
  })

  it('filters by lower bound, levels, and limit', async () => {
    const h = await mountHarness()
    await h.call('browser_console', { since: 4, levels: ['warn', 'error'], limit: 20 })
    expect(requestOf('console')).toEqual({
      owner: 'session-1',
      since: 4,
      levels: ['warn', 'error'],
      limit: 20,
    })
  })

  it('renders one entry with the dropped suffix and hides the entry source', async () => {
    const h = await mountHarness()
    recordingBrowser().consolePage = {
      entries: [{ seq: 7, level: 'error', text: 'TypeError: nope', source: 'app.js:3' }],
      dropped: 2,
      cursor: 7,
    }
    const result = await h.call('browser_console', {})

    expect(valueOf(result)).toEqual({
      cursor: 7,
      dropped: 2,
      entries: [{ seq: 7, level: 'error', text: 'TypeError: nope' }],
    })
    expect(textOf(result)).toBe('1 entry (2 older dropped); cursor=7\n[error] TypeError: nope')
  })

  it('renders several entries oldest first without a dropped suffix', async () => {
    const h = await mountHarness()
    recordingBrowser().consolePage = {
      entries: [
        { seq: 1, level: 'log', text: 'first' },
        { seq: 2, level: 'warn', text: 'second' },
      ],
      dropped: 0,
      cursor: 2,
    }
    const result = await h.call('browser_console', {})
    expect(textOf(result)).toBe('2 entries; cursor=2\n[log] first\n[warn] second')
  })
})

describe('browser_state', () => {
  it('reports a loaded page with history in both directions', async () => {
    const h = await mountHarness()
    const result = await h.call('browser_state', {})

    expect(textOf(result)).toBe(`${PAGE_STATE.url} "${PAGE_STATE.title}" viewport=1280x720 history=back/forward`)
    expect(valueOf(result)).toEqual(PAGE_STATE)
    expect(result.meta).toEqual({ url: PAGE_STATE.url, title: PAGE_STATE.title })
  })

  it('reports an untitled still-loading page with no history', async () => {
    const h = await mountHarness()
    recordingBrowser().pageState = {
      url: 'about:blank',
      title: '',
      loading: true,
      viewport: { width: 800, height: 600 },
      canGoBack: false,
      canGoForward: false,
    }
    const result = await h.call('browser_state', {})
    expect(textOf(result)).toBe('about:blank (still loading) viewport=800x600 history=-')
  })

  it('reports forward-only history', async () => {
    const h = await mountHarness()
    recordingBrowser().pageState = { ...PAGE_STATE, canGoBack: false }
    const result = await h.call('browser_state', {})
    expect(textOf(result)).toContain('history=-/forward')
  })
})

describe('browser_eval', () => {
  it('evaluates an expression and returns its text projection', async () => {
    const h = await mountHarness()
    const result = await h.call('browser_eval', { expression: 'document.title' })

    expect(requestOf('evaluate')).toEqual({
      owner: 'session-1',
      expression: 'document.title',
    })
    expect(valueOf(result)).toEqual({ text: '42' })
    expect(textOf(result)).toBe('42')
    expect(result.meta).toBeUndefined()
  })

  it('refuses an empty or blank expression', async () => {
    const h = await mountHarness()
    for (const expression of ['', '   ']) {
      const result = await h.call('browser_eval', { expression })
      expect(textOf(result), JSON.stringify(expression)).toContain('expression must be a non-empty string')
    }
    expect(recordingBrowser().calls).toEqual([])
  })
})

describe('owner identity', () => {
  it('refuses a call that ran outside an agent loop', async () => {
    const h = await mountHarness()
    const result = await h.call('browser_state', {}, NO_AGENT)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('browser tools require an agent session: the call ran outside an agent loop')
    expect(recordingBrowser().calls).toEqual([])
  })

  it('brands each calling session as its own owner', async () => {
    const h = await mountHarness()
    await h.call('browser_state', {}, agentStub({ sessionId: 'session-9' }))
    expect(requestOf('state')).toEqual({ owner: 'session-9' })
  })
})
