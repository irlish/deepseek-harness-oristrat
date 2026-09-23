import { Context } from '@deepseek-ai/cordis'
import AttachmentStore, { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type {
  AttachmentError,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import BrowserAutomation, { createBrowserRef } from '@deepseek-ai/dsh-browser'
import type {
  BrowserActOutcome,
  BrowserActRequest,
  BrowserConsolePage,
  BrowserConsoleRequest,
  BrowserEvaluateRequest,
  BrowserEvaluateResult,
  BrowserNavigateRequest,
  BrowserNavigation,
  BrowserObservation,
  BrowserObserveRequest,
  BrowserOwner,
  BrowserPageState,
  BrowserScreenshot,
  BrowserScreenshotRequest,
} from '@deepseek-ai/dsh-browser'
import { LlmAdapter, LlmRuntime, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, ModelModality, StreamChunk } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as ToolBrowser from '../src/index.ts'

/** Caller cancellation every spec hands to the registry. */
export const TEST_SIGNAL = new AbortController().signal

/** The page state every canned provider answer reports unless a spec overrides it. */
export const PAGE_STATE: BrowserPageState = {
  url: 'https://example.test/form',
  title: 'Example form',
  loading: false,
  viewport: { width: 1280, height: 720 },
  canGoBack: true,
  canGoForward: true,
}

/** Plausible deployment image limits for the attachment fake. */
export const IMAGE_LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 4_000_000,
  maxImagesPerMessage: 4,
  maxMessageImageBytes: 8_000_000,
  maxImagePixels: 4_000_000,
  maxImageDimension: 4000,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

/** Seam verbs the recording provider answers. */
export type Verb = 'state' | 'navigate' | 'observe' | 'act' | 'screenshot' | 'console' | 'evaluate'

/** One recorded provider call: its verb, the request the tool built, and the forwarded signal. */
export interface RecordedCall {
  readonly verb: Verb
  readonly request: unknown
  readonly signal: AbortSignal | undefined
}

/**
 * Fake `ctx.browser` provider that records every request and answers from
 * fields a spec can replace.
 */
export class RecordingBrowser extends BrowserAutomation {
  /** The instance the most recent {@link mountHarness} constructed, for request assertions. */
  static latest: RecordingBrowser | undefined

  readonly calls: RecordedCall[] = []
  pageState: BrowserPageState = PAGE_STATE
  navigation: BrowserNavigation = { ...PAGE_STATE, reached: true }
  observation: BrowserObservation = {
    url: PAGE_STATE.url,
    title: PAGE_STATE.title,
    loading: false,
    viewport: PAGE_STATE.viewport,
    text: 'button "Submit" @e1',
    refs: [createBrowserRef(1)],
    nodeCount: 3,
    truncated: false,
    byteLength: 18,
  }

  actOutcome: BrowserActOutcome = { ...PAGE_STATE, action: 'click' }
  capture: BrowserScreenshot = {
    format: 'png',
    mediaType: 'image/png',
    bytes: new Uint8Array([137, 80, 78, 71]),
    width: 1280,
    height: 720,
    url: PAGE_STATE.url,
  }

  consolePage: BrowserConsolePage = { entries: [], dropped: 0, cursor: 0 }
  evaluation: BrowserEvaluateResult = { text: '42' }
  /** Per-verb failure the provider rejects with instead of answering. */
  failures: Partial<Record<Verb, Error>> = {}

  constructor(ctx: Context) {
    super(ctx)
    RecordingBrowser.latest = this
  }

  private settle<T>(verb: Verb, request: unknown, signal: AbortSignal | undefined, answer: () => T): Promise<T> {
    this.calls.push({ verb, request, signal })
    const failure = this.failures[verb]
    return failure === undefined ? Promise.resolve(answer()) : Promise.reject(failure)
  }

  override state(owner: BrowserOwner, signal?: AbortSignal): Promise<BrowserPageState> {
    return this.settle('state', { owner }, signal, () => this.pageState)
  }

  override navigate(request: BrowserNavigateRequest, signal?: AbortSignal): Promise<BrowserNavigation> {
    return this.settle('navigate', request, signal, () => this.navigation)
  }

  override observe(request: BrowserObserveRequest, signal?: AbortSignal): Promise<BrowserObservation> {
    return this.settle('observe', request, signal, () => this.observation)
  }

  override act(request: BrowserActRequest, signal?: AbortSignal): Promise<BrowserActOutcome> {
    return this.settle('act', request, signal, () => this.actOutcome)
  }

  override screenshot(request: BrowserScreenshotRequest, signal?: AbortSignal): Promise<BrowserScreenshot> {
    return this.settle('screenshot', request, signal, () => this.capture)
  }

  override console(request: BrowserConsoleRequest, signal?: AbortSignal): Promise<BrowserConsolePage> {
    return this.settle('console', request, signal, () => this.consolePage)
  }

  override evaluate(request: BrowserEvaluateRequest, signal?: AbortSignal): Promise<BrowserEvaluateResult> {
    return this.settle('evaluate', request, signal, () => this.evaluation)
  }
}

/** The provider instance the harness under test mounted. */
export function recordingBrowser(): RecordingBrowser {
  const browser = RecordingBrowser.latest
  if (browser === undefined) throw new Error('no RecordingBrowser is mounted')
  return browser
}

/** The request each seam verb receives, so a spec reads back the typed request it built. */
export interface RequestByVerb {
  state: { owner: BrowserOwner }
  navigate: BrowserNavigateRequest
  observe: BrowserObserveRequest
  act: BrowserActRequest
  screenshot: BrowserScreenshotRequest
  console: BrowserConsoleRequest
  evaluate: BrowserEvaluateRequest
}

/**
 * Exact request of the last recorded call for one verb.
 * @param verb - the seam verb whose request is read back.
 * @returns the request the tool built for that verb.
 */
export function requestOf<K extends Verb>(verb: K): RequestByVerb[K] {
  const call = [...recordingBrowser().calls].reverse().find(entry => entry.verb === verb)
  if (call === undefined) throw new Error(`no ${verb} call was recorded`)
  return call.request as RequestByVerb[K]
}

/** The last recorded call for one verb, for signal assertions. */
export function callOf(verb: Verb): RecordedCall {
  const call = [...recordingBrowser().calls].reverse().find(entry => entry.verb === verb)
  if (call === undefined) throw new Error(`no ${verb} call was recorded`)
  return call
}

/** Attachment store fake that records the exact bytes the tool submitted. */
export class RecordingAttachmentStore extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = IMAGE_LIMITS
  readonly saved: SaveImageAttachment[] = []
  /** When set, every `saveImage` rejects with this failure. */
  failure: AttachmentError | undefined
  /** Whether the stored reference echoes the submitted display name. */
  storesName = false

  override validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.resolve()
  }

  override saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    if (this.failure !== undefined) return Promise.reject(this.failure)
    this.saved.push(input)
    return Promise.resolve({
      attachmentId: AttachmentId(`sha256:${'0'.repeat(64)}`),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1280,
      height: 720,
      ...this.storesName && input.name !== undefined ? { name: input.name } : {},
    })
  }

  override readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    return Promise.reject(new Error('tool-browser specs never read stored images'))
  }
}

/** Declared input modalities per model id the specs route to. */
const ROUTE_MODALITIES: Readonly<Record<string, readonly ModelModality[] | undefined>> = {
  vision: ['text', 'image'],
  'text-only': ['text'],
  plain: undefined,
}

/** Route catalog fake: only `vision` declares image input. */
class RouteCatalogAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const modalities = ROUTE_MODALITIES[model]
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...modalities === undefined ? {} : { inputModalities: modalities },
    })
  }

  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('tool-browser specs never stream')
  }
}

/** Calling-agent stand-in whose route comes from its request header or its options. */
export interface AgentStub {
  readonly options: { provider?: string; model?: string }
  readonly session: {
    readonly id: string
    readonly requestHeader: () => { config: { provider: string; model: string } } | undefined
  }
}

/**
 * Build a calling agent.
 * @param options - session id, the route its request header reports, and its
 *   fallback route options.
 * @returns the agent stand-in the registry accepts as a scope key.
 */
export function agentStub(options: {
  sessionId?: string
  header?: { provider: string; model: string }
  provider?: string
  model?: string
} = {}): unknown {
  return {
    options: {
      ...options.provider === undefined ? {} : { provider: options.provider },
      ...options.model === undefined ? {} : { model: options.model },
    },
    session: {
      id: options.sessionId ?? 'session-1',
      requestHeader: () => options.header === undefined ? undefined : { config: options.header },
    },
  }
}

/** Caller sentinel that runs one execution with no caller agent at all. */
export const NO_AGENT: unique symbol = Symbol('no-agent')

/** Options selecting which optional services the harness mounts. */
export interface HarnessOptions {
  /** Mount the fake `ctx.browser` provider (default true). */
  readonly browser?: boolean
  /** Mount the recording attachment store (default true). */
  readonly attachments?: boolean
  /** Mount the LLM route service (default true). */
  readonly llm?: boolean
}

/** Real registry plus fake seam services, with a helper that executes one tool call. */
export interface Harness {
  readonly ctx: Context
  readonly toolFiber: Awaited<ReturnType<Context['plugin']>>
  readonly agent: unknown
  call(name: string, args: unknown, caller?: unknown): Promise<ToolExecutionResult>
}

let callCounter = 0

/**
 * Mount the real tools registry, the fake seam providers, and `tool-browser`.
 * @param options - which optional services participate.
 * @returns the mounted context, fiber, calling agent, and an execution helper.
 */
export async function mountHarness(options: HarnessOptions = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (options.attachments !== false) await ctx.plugin(RecordingAttachmentStore)
  if (options.llm !== false) {
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['visual'], new RouteCatalogAdapter())
  }
  if (options.browser !== false) await ctx.plugin(RecordingBrowser)
  const toolFiber = await ctx.plugin(ToolBrowser)
  const agent = agentStub()
  return {
    ctx,
    toolFiber,
    agent,
    call: (name, args, caller = agent) => ctx.tools.execute({
      signal: TEST_SIGNAL,
      callId: ToolCallId(`call-${++callCounter}`),
      name,
      arguments: args,
      ...caller === NO_AGENT ? {} : { agent: caller as never },
    }),
  }
}

/** The mounted attachment fake, or a failure when the harness omitted it. */
export function attachmentsOf(h: Harness): RecordingAttachmentStore {
  const store = h.ctx.get('attachments')
  if (store === undefined) throw new Error('no attachment store is mounted')
  return store as RecordingAttachmentStore
}

/** Collect the model-facing text of one tool result. */
export function textOf(result: ToolExecutionResult): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

/** Canonical success value of one tool result. */
export function valueOf(result: ToolExecutionResult): Record<string, unknown> {
  if (result.isError) throw new Error(`expected a successful call, received: ${textOf(result)}`)
  return result.value as Record<string, unknown>
}
