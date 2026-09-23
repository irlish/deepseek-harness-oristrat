/**
 * Model-facing browser automation tools over the `ctx.browser` seam.
 *
 * The tool set is the observe → act → verify loop an end-to-end check needs:
 * `browser_observe` reads the page as reference-bearing text, `browser_act`
 * drives it, and every action reports the page state it produced, so a step is
 * verified by the operation that made it. Screenshots come back as images the
 * model can look at, which is what lets it judge rendering rather than only
 * structure.
 *
 * Tools are registered only while a `ctx.browser` provider is mounted, so a
 * deployment with no browser pane exposes no `browser_*` tool at all.
 * @module @deepseek-ai/dsh-tool-browser
 */

import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import {
  formatBrowserRef,
  parseBrowserOwner,
  parseBrowserRef,
  type BrowserActRequest,
  type BrowserConsolePage,
  type BrowserElementTarget,
  type BrowserOwner,
  type BrowserScreenshot,
} from '@deepseek-ai/dsh-browser'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterPropertySpec, ParameterSchemaSpec, ToolExecution } from '@deepseek-ai/dsh-tools'

/** Plugin name in the Loader's registry. */
export const name = 'tool-browser'

/** The tool registry plus the browser capability these tools consume. */
export const inject = ['tools', 'browser']

/** Viewport property the page-state and observation outputs report. */
const VIEWPORT_PROPERTY = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    width: { type: 'number', required: true },
    height: { type: 'number', required: true },
  },
} satisfies ParameterPropertySpec

/** Page-state output properties shared by the state, navigation, and act tools. */
const PAGE_STATE_PROPERTIES = {
  url: { type: 'string', required: true },
  title: { type: 'string', required: true },
  loading: { type: 'boolean', required: true },
  canGoBack: { type: 'boolean', required: true },
  canGoForward: { type: 'boolean', required: true },
  viewport: VIEWPORT_PROPERTY,
} satisfies ParameterSchemaSpec

/** Stored-image output properties the screenshot tool reports. */
const IMAGE_PROPERTIES = {
  attachmentId: { type: 'string', required: true },
  mediaType: { type: 'string', required: true, enum: ['image/png', 'image/jpeg'] as const },
  bytes: { type: 'number', required: true },
  width: { type: 'number', required: true },
  height: { type: 'number', required: true },
  name: { type: 'string' },
} satisfies ParameterSchemaSpec

/** The action verbs `browser_act` accepts. */
const ACTION_NAMES = ['click', 'hover', 'fill', 'type', 'press', 'select', 'scroll', 'focus'] as const

/** The console levels `browser_console` filters by. */
const CONSOLE_LEVELS = ['debug', 'info', 'log', 'warn', 'error'] as const

/** Target arguments a caller may supply instead of a reference. */
interface TargetArgs {
  readonly ref?: string
  readonly selector?: string
  readonly x?: number
  readonly y?: number
}

/**
 * Recover the calling session's identity, which arbitrates the browser lease.
 * @param exec - the running tool execution.
 * @returns the branded owner.
 */
function ownerOf(exec: ToolExecution): BrowserOwner {
  const session = exec.agent?.session
  if (session === undefined) {
    throw new Error('browser tools require an agent session: the call ran outside an agent loop')
  }
  return parseBrowserOwner(session.id)
}

/**
 * Assemble an element target from model-supplied arguments.
 *
 * Exactly one of `ref`, `selector`, or a point may be given: a reference is what
 * the model read from an observation, a selector is the fallback for a page it
 * already knows, and a point addresses what has no element identity.
 * @param args - tool arguments carrying an optional target.
 * @param verb - action name, used in the diagnostic.
 * @param required - whether this action needs a target at all.
 * @returns the target, or `undefined` when the action may run without one.
 */
function targetOf(args: TargetArgs, verb: string, required: boolean): BrowserElementTarget | undefined {
  const given = [args.ref, args.selector, args.x].filter(value => value !== undefined)
  if (given.length > 1) {
    throw new Error(`${verb} accepts one of ref, selector, or x/y — not several`)
  }
  if (args.ref !== undefined) {
    const ref = parseBrowserRef(args.ref)
    if (ref === undefined) {
      throw new Error(`ref "${args.ref}" is not an element reference; pass a reference from browser_observe, for example @e12`)
    }
    return { kind: 'ref', ref }
  }
  if (args.selector !== undefined) return { kind: 'selector', selector: args.selector }
  if (args.x !== undefined || args.y !== undefined) {
    if (args.x === undefined || args.y === undefined) throw new Error(`${verb} needs both x and y for a point target`)
    return { kind: 'point', x: args.x, y: args.y }
  }
  if (required) throw new Error(`${verb} requires a target: pass ref, selector, or x/y`)
  return undefined
}

/**
 * Format the page state every mutating tool reports.
 * @param state - state read after the mutation.
 * @returns one line naming the URL, title, and loading status.
 */
function formatState(state: { readonly url: string; readonly title: string; readonly loading: boolean }): string {
  const title = state.title === '' ? '' : ` "${state.title}"`
  return `${state.url}${title}${state.loading ? ' (still loading)' : ''}`
}

/**
 * Format console entries as the model-facing envelope.
 * @param value - console page returned by the provider.
 * @returns one header line plus one line per entry, oldest first.
 */
function formatConsole(value: BrowserConsolePage): string {
  const header = value.entries.length === 0
    ? 'no console output'
    : `${String(value.entries.length)} entr${value.entries.length === 1 ? 'y' : 'ies'}${value.dropped > 0 ? ` (${String(value.dropped)} older dropped)` : ''}`
  return [`${header}; cursor=${String(value.cursor)}`, ...value.entries.map(entry => `[${entry.level}] ${entry.text}`)].join('\n')
}

/**
 * Register the browser tools.
 * @param ctx - context carrying `tools` and `browser`.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'browser_navigate',
    description: 'Move the browser pane to a URL, or walk its history. '
      + 'This drives the browser the user sees in the sidebar, so the user watches the navigation happen. '
      + 'Returns the state reached; a navigation that did not finish loading reports so instead of failing.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['goto', 'back', 'forward', 'reload'] as const,
        description: 'goto requires url; back, forward, and reload use the pane history.',
      },
      url: { type: 'string', description: 'Absolute http(s) URL; required for goto.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ...PAGE_STATE_PROPERTIES, reached: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.reached ? 'reached' : 'did not finish loading'}: ${formatState(value)}`,
      }],
      presentationMeta: (_args, value) => ({ url: value.url, title: value.title, reached: value.reached }),
    },
    async execute(args, exec) {
      return await ctx.browser.navigate({
        owner: ownerOf(exec),
        action: args.action,
        ...(args.url === undefined ? {} : { url: args.url }),
      }, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_observe',
    description: 'Read the current page as a tree of accessibility nodes, each actionable node carrying a reference like @e12. '
      + 'This is how to find elements to act on: read the tree, then pass a reference to browser_act. '
      + 'References stay resolvable for the next call; re-observe after a navigation or a large DOM change. '
      + 'Output is bounded, and a truncated reading reports a cursor to continue from.',
    parameters: {
      cursor: { type: 'string', description: 'Continuation cursor from a truncated observation.' },
      maxNodes: { type: 'number', description: 'Maximum element lines to render.' },
      maxDepth: { type: 'number', description: 'Deepest accessibility level to render.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          loading: { type: 'boolean', required: true },
          viewport: VIEWPORT_PROPERTY,
          text: { type: 'string', required: true },
          refs: { type: 'array', required: true, items: { type: 'string' } },
          nodeCount: { type: 'number', required: true },
          truncated: { type: 'boolean', required: true },
          nextCursor: { type: 'string' },
          byteLength: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
      presentationMeta: (_args, value) => ({
        url: value.url,
        nodeCount: value.nodeCount,
        truncated: value.truncated,
      }),
    },
    async execute(args, exec) {
      const observation = await ctx.browser.observe({
        owner: ownerOf(exec),
        ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
        ...(args.maxNodes === undefined ? {} : { maxNodes: args.maxNodes }),
        ...(args.maxDepth === undefined ? {} : { maxDepth: args.maxDepth }),
      }, exec.signal)
      return { ...observation, refs: observation.refs.map(ref => String(ref)) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_act',
    description: 'Drive the page: click, hover, fill, type, press a key, choose an option, scroll, or focus. '
      + 'Input is sent to the page itself, so the user keeps typing in the application while this runs. '
      + 'Every call returns the page state it produced, which is the verification step — check it instead of assuming the action landed.',
    parameters: {
      action: { type: 'string', required: true, enum: ACTION_NAMES, description: 'The interaction to perform.' },
      ref: { type: 'string', description: 'Element reference from browser_observe, for example @e12.' },
      selector: { type: 'string', description: 'CSS selector, when no reference is available.' },
      x: { type: 'number', description: 'Viewport x coordinate, with y, for a point target.' },
      y: { type: 'number', description: 'Viewport y coordinate, with x, for a point target.' },
      value: { type: 'string', description: 'Text for fill and type, option value or label for select.' },
      key: { type: 'string', description: 'Key name for press, for example Enter, Tab, or ArrowDown.' },
      deltaY: { type: 'number', description: 'Pixels to scroll; defaults to one viewport.' },
      button: { type: 'string', enum: ['left', 'middle', 'right'] as const, description: 'Mouse button for click.' },
      clickCount: { type: 'number', description: 'Click count for click; 2 double-clicks.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...PAGE_STATE_PROPERTIES,
          action: { type: 'string', required: true, enum: ACTION_NAMES },
          ref: { type: 'string', description: 'Reference the action targeted, written as the model writes it.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.action}${value.ref === undefined ? '' : ` ${value.ref}`} → ${formatState(value)}`,
      }],
      presentationMeta: (_args, value) => ({
        action: value.action,
        ...(value.ref === undefined ? {} : { ref: value.ref }),
        url: value.url,
        title: value.title,
      }),
    },
    async execute(args, exec) {
      const action = args.action
      const needsTarget = action !== 'press' && action !== 'scroll'
      const target = targetOf(args, action, needsTarget)
      if ((action === 'fill' || action === 'type' || action === 'select') && args.value === undefined) {
        throw new Error(`${action} requires value`)
      }
      const request: BrowserActRequest = {
        owner: ownerOf(exec),
        action,
        ...(target === undefined ? {} : { target }),
        ...(args.value === undefined ? {} : { value: args.value }),
        ...(args.key === undefined ? {} : { key: args.key }),
        ...(args.deltaY === undefined ? {} : { deltaY: args.deltaY }),
        ...(args.button === undefined ? {} : { button: args.button }),
        ...(args.clickCount === undefined ? {} : { clickCount: args.clickCount }),
      }
      const outcome = await ctx.browser.act(request, exec.signal)
      // The outcome carries the provider's branded reference; the model reads
      // and writes references with the sigil, so the result uses that form.
      return {
        ...outcome,
        ...(outcome.ref === undefined ? {} : { ref: formatBrowserRef(outcome.ref) }),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_screenshot',
    description: 'Capture the browser pane as an image and return it, so layout, styling, and rendering can be judged directly. '
      + 'Capture the viewport, the whole document with full_page, or one element by reference. '
      + 'Requires the current model to accept image input.',
    parameters: {
      full_page: { type: 'boolean', description: 'Capture the whole document instead of the viewport.' },
      ref: { type: 'string', description: 'Element reference to capture exactly one element.' },
      selector: { type: 'string', description: 'CSS selector to capture exactly one element.' },
      format: { type: 'string', enum: ['png', 'jpeg'] as const, description: 'Image format; defaults to the deployment setting.' },
      quality: { type: 'number', description: 'JPEG quality from 1 to 100.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          format: { type: 'string', required: true, enum: ['png', 'jpeg'] as const },
          width: { type: 'number', required: true },
          height: { type: 'number', required: true },
          image: { type: 'object', additionalProperties: false, required: true, properties: IMAGE_PROPERTIES },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `captured ${value.format} ${String(value.width)}x${String(value.height)} of ${value.url}`,
        },
        { type: 'image', attachment: imageRefOf(value.image) },
      ],
      presentationMeta: (_args, value) => ({
        url: value.url,
        format: value.format,
        width: value.width,
        height: value.height,
      }),
    },
    async execute(args, exec) {
      const target = targetOf({
        ...(args.ref === undefined ? {} : { ref: args.ref }),
        ...(args.selector === undefined ? {} : { selector: args.selector }),
      }, 'browser_screenshot', false)
      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        throw new Error('browser_screenshot requires a mounted attachment service to store the capture')
      }
      await assertImageCapableRoute(ctx, exec)
      const capture = await ctx.browser.screenshot({
        owner: ownerOf(exec),
        ...(target === undefined ? {} : { target }),
        ...(args.full_page === undefined ? {} : { fullPage: args.full_page }),
        ...(args.format === undefined ? {} : { format: args.format }),
        ...(args.quality === undefined ? {} : { quality: args.quality }),
      }, exec.signal)
      const stored = await storeCapture(attachments, capture)
      return {
        url: capture.url,
        format: capture.format,
        width: capture.width,
        height: capture.height,
        image: { ...stored, mediaType: capture.mediaType },
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_console',
    description: 'Read recent console output and page errors from the browser pane. '
      + 'Use it to diagnose why a page misbehaved, and to see page dialogs the pane neutralized instead of blocking on.',
    parameters: {
      since: { type: 'number', description: 'Only entries after this cursor; pass the cursor a previous call returned.' },
      levels: { type: 'array', items: { type: 'string', enum: CONSOLE_LEVELS }, description: 'Only these levels.' },
      limit: { type: 'number', description: 'Maximum entries, newest last.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cursor: { type: 'number', required: true },
          dropped: { type: 'number', required: true },
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                seq: { type: 'number', required: true },
                level: { type: 'string', required: true, enum: CONSOLE_LEVELS },
                text: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatConsole(value) }],
      presentationMeta: (_args, value) => ({ cursor: value.cursor, entries: value.entries.length }),
    },
    async execute(args, exec) {
      const page = await ctx.browser.console({
        owner: ownerOf(exec),
        ...(args.since === undefined ? {} : { since: args.since }),
        ...(args.levels === undefined ? {} : { levels: args.levels }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      }, exec.signal)
      return {
        cursor: page.cursor,
        dropped: page.dropped,
        entries: page.entries.map(entry => ({ seq: entry.seq, level: entry.level, text: entry.text })),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_state',
    description: 'Read what the browser pane currently shows: URL, title, loading status, history availability, and viewport size. '
      + 'This is the cheap check between steps when the structure of the page does not matter.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: PAGE_STATE_PROPERTIES,
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${formatState(value)} viewport=${String(value.viewport.width)}x${String(value.viewport.height)}`
          + ` history=${value.canGoBack ? 'back' : '-'}${value.canGoForward ? '/forward' : ''}`,
      }],
      presentationMeta: (_args, value) => ({ url: value.url, title: value.title }),
    },
    async execute(_args, exec) {
      return await ctx.browser.state(ownerOf(exec), exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_eval',
    description: 'Evaluate one expression inside the page and return its value as text. '
      + 'This reads facts the accessibility tree does not carry, such as a computed style or a storage entry. '
      + 'It runs real script in the page, so prefer the structured tools and use this only when they cannot answer the question.',
    parameters: {
      expression: { type: 'string', required: true, description: 'JavaScript expression evaluated in the page.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      if (args.expression.trim() === '') throw new Error('expression must be a non-empty string')
      return await ctx.browser.evaluate({ owner: ownerOf(exec), expression: args.expression }, exec.signal)
    },
  }))
}

/**
 * Store one capture as a durable image attachment.
 * @param attachments - mounted attachment store.
 * @param capture - image bytes the provider produced.
 * @returns the stored image record the tool result carries.
 */
async function storeCapture(attachments: AttachmentStore, capture: BrowserScreenshot): Promise<{
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}> {
  try {
    const ref = await attachments.saveImage({
      data: capture.bytes,
      mediaType: capture.mediaType,
      name: `browser-screenshot.${capture.format}`,
    })
    return {
      attachmentId: ref.attachmentId,
      mediaType: ref.mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
      ...(ref.name === undefined ? {} : { name: ref.name }),
    }
  } catch (error: unknown) {
    if (!(error instanceof AttachmentError)) throw error
    throw new Error(
      `the browser captured a ${String(capture.bytes.byteLength)}-byte image this deployment cannot store (${error.code});`
      + ' capture the viewport instead of the whole page, or lower the JPEG quality',
      { cause: error },
    )
  }
}

/**
 * Re-brand a stored image record into the durable reference an image block
 * carries.
 * @param image - image record from the tool result.
 * @returns the branded attachment reference.
 */
function imageRefOf(image: {
  readonly attachmentId: string
  readonly mediaType: ImageMediaType
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...(image.name === undefined ? {} : { name: image.name }),
  }
}

/**
 * Refuse a capture when the calling route cannot see images: an image the model
 * cannot inspect is a misleading success, so the refusal happens first.
 * @param ctx - context that may carry `llm`.
 * @param exec - the running tool execution.
 */
async function assertImageCapableRoute(ctx: Context, exec: ToolExecution): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('browser_screenshot cannot run: the current model route could not be resolved')
  }
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new Error(`browser_screenshot cannot run: model "${model}" does not declare image input; switch to an image-capable model`)
  }
}
