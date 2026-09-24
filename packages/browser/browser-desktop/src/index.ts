/**
 * Desktop provider for the browser automation seam (`ctx.browser`).
 *
 * It drives the embedded browser pane the desktop client shows — the same
 * `WebContentsView` the right-sidebar browser tab renders — through a brokered
 * command channel the desktop shell supplies over the application's control
 * channel. Nothing in this package opens a browser, owns a window, or
 * synthesizes operating-system input: every keystroke, click, and scroll is a
 * protocol event inside the page, so a user keeps working in the application
 * while the agent drives the pane.
 * @module @deepseek-ai/dsh-browser-desktop
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  BrowserAutomation,
  BrowserError,
  type BrowserActOutcome,
  type BrowserActRequest,
  type BrowserConsolePage,
  type BrowserConsoleRequest,
  type BrowserEvaluateRequest,
  type BrowserEvaluateResult,
  type BrowserNavigateRequest,
  type BrowserNavigation,
  type BrowserObservation,
  type BrowserObserveRequest,
  type BrowserOwner,
  type BrowserPageState,
  type BrowserScreenshot,
  type BrowserScreenshotRequest,
  type BrowserTransport,
} from '@deepseek-ai/dsh-browser'
import { CdpSession } from './cdp.ts'
import { drawHighlight, ensureBootstrapApplied, installPageBootstrap, readPageConsole } from './bootstrap.ts'
import { observePage, readPageHeader, readPageState, RefStore } from './observation.ts'
import { performAction, settlePage } from './interaction.ts'
import { capturePage } from './capture.ts'
import { assertLease, BrowserLease, OriginPolicy } from './policy.ts'

/**
 * Context key under which a composition provides the brokered command channel.
 * The desktop shell provides it while composing the Host; a composition without
 * it cannot mount this provider, which is how browser tools stay absent from
 * deployments that have no browser pane to drive.
 */
export const DESKTOP_BROWSER_TRANSPORT_KEY = 'desktopBrowserTransport'

/** Plugin config; every field is optional because the schema supplies defaults. */
export interface Config {
  /** Whether `browser_eval` may run page script. */
  allowScriptEval?: boolean
  /** Whether actions draw the in-page highlight box the user sees. */
  highlight?: boolean
  /** Deadline for one brokered command. */
  commandTimeoutMs?: number
  /** Quiet period observed before reading page state after an action. */
  settleMs?: number
  /** Idle time after which another session may take the browser lease. */
  leaseIdleMs?: number
  /** Decision for an origin no pattern matches. */
  defaultOriginDecision?: 'allow' | 'deny'
  /** Host, wildcard-host, or origin patterns that grant access. */
  allowOrigins?: string[]
  /** Patterns that refuse access; they win over `allowOrigins`. */
  denyOrigins?: string[]
  /** Deepest accessibility level an observation renders. */
  observeMaxDepth?: number
  /** Maximum element lines one observation renders. */
  observeMaxNodes?: number
  /** Maximum bytes one observation renders. */
  observeMaxBytes?: number
  /** Image format a capture uses when the call does not choose one. */
  screenshotFormat?: 'png' | 'jpeg'
  /** JPEG quality a capture uses when the call does not choose one. */
  screenshotQuality?: number
}

/** Config after schemastery applied its defaults. */
interface ResolvedConfig {
  readonly allowScriptEval: boolean
  readonly highlight: boolean
  readonly commandTimeoutMs: number
  readonly settleMs: number
  readonly leaseIdleMs: number
  readonly defaultOriginDecision: 'allow' | 'deny'
  readonly allowOrigins: readonly string[]
  readonly denyOrigins: readonly string[]
  readonly observeMaxDepth: number
  readonly observeMaxNodes: number
  readonly observeMaxBytes: number
  readonly screenshotFormat: 'png' | 'jpeg'
  readonly screenshotQuality: number
}

/**
 * Re-check every configured bound fail-loud, because programmatic construction
 * can bypass the schema.
 * @param config - validated plugin config.
 * @returns the config with numeric fields proven usable.
 */
function resolveConfig(config: Config): ResolvedConfig {
  const settings = config as ResolvedConfig
  for (const [field, value] of [
    ['commandTimeoutMs', settings.commandTimeoutMs],
    ['settleMs', settings.settleMs],
    ['leaseIdleMs', settings.leaseIdleMs],
    ['observeMaxDepth', settings.observeMaxDepth],
    ['observeMaxNodes', settings.observeMaxNodes],
    ['observeMaxBytes', settings.observeMaxBytes],
    ['screenshotQuality', settings.screenshotQuality],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`browser-desktop: ${field} must be a finite number >= 0, received ${String(value)}`)
    }
  }
  return settings
}

/**
 * Browser automation over the embedded pane the desktop client shows.
 *
 * One instance drives the one pane the application window owns. Every request
 * claims the lease so two sessions cannot interleave commands in that pane, and
 * every request re-checks the origin policy against the page actually loaded,
 * because a link the agent clicks can move the pane to an origin the policy
 * refuses.
 */
export class DesktopBrowserAutomation extends BrowserAutomation {
  static Config: z<Config> = z.object({
    allowScriptEval: z.boolean().default(true),
    highlight: z.boolean().default(true),
    commandTimeoutMs: z.number().default(15_000),
    settleMs: z.number().default(150),
    leaseIdleMs: z.number().default(300_000),
    defaultOriginDecision: z.union(['allow', 'deny'] as const).default('allow'),
    allowOrigins: z.array(z.string()).default([]),
    denyOrigins: z.array(z.string()).default([]),
    observeMaxDepth: z.number().default(12),
    observeMaxNodes: z.number().default(700),
    observeMaxBytes: z.number().default(200_000),
    screenshotFormat: z.union(['png', 'jpeg'] as const).default('png'),
    screenshotQuality: z.number().default(80),
  })

  private readonly settings: ResolvedConfig
  private readonly session: CdpSession
  private readonly refs = new RefStore()
  private readonly policy: OriginPolicy
  private readonly lease: BrowserLease
  private domEnabled = false
  private newDocumentScriptRegistered = false

  /**
   * @param ctx - context this service is provided into.
   * @param config - plugin config; defaults come from the schema.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    const transport = ctx.get(DESKTOP_BROWSER_TRANSPORT_KEY) as BrowserTransport | undefined
    if (transport === undefined) {
      throw new Error(
        'browser-desktop: this composition provides no brokered browser transport;'
        + ` mount this provider only where the desktop shell provides ${DESKTOP_BROWSER_TRANSPORT_KEY}`,
      )
    }
    this.settings = resolveConfig(config)
    this.session = new CdpSession(transport, this.settings.commandTimeoutMs)
    this.policy = new OriginPolicy({
      defaultDecision: this.settings.defaultOriginDecision,
      allow: this.settings.allowOrigins,
      deny: this.settings.denyOrigins,
    })
    this.lease = new BrowserLease(this.settings.leaseIdleMs)
  }

  /** {@inheritDoc BrowserAutomation.state} */
  async state(owner: BrowserOwner, signal?: AbortSignal): Promise<BrowserPageState> {
    await this.prepare(owner, signal)
    const state = await readPageState(this.session, signal)
    this.policy.assertAllowed(state.url)
    return state
  }

  /** {@inheritDoc BrowserAutomation.navigate} */
  async navigate(request: BrowserNavigateRequest, signal?: AbortSignal): Promise<BrowserNavigation> {
    await this.prepare(request.owner, signal)
    if (request.action === 'goto') {
      if (request.url === undefined) throw new BrowserError('goto requires a url', 'BROWSER_NAVIGATION_FAILED')
      const target = parseNavigableUrl(request.url)
      this.policy.assertAllowed(target)
      await this.session.send('Page.navigate', { url: target }, signal)
    } else if (request.action === 'reload') {
      await this.session.send('Page.reload', {}, signal)
    } else {
      const step = request.action === 'back' ? -1 : 1
      const history = await this.session.send<{ currentIndex: number; entries: readonly { id: number; url: string }[] }>(
        'Page.getNavigationHistory',
        {},
        signal,
      )
      const entry = history.entries[history.currentIndex + step]
      if (entry === undefined) {
        throw new BrowserError(`the browser has no ${request.action} entry to go to`, 'BROWSER_NAVIGATION_FAILED')
      }
      this.policy.assertAllowed(entry.url)
      await this.session.send('Page.navigateToHistoryEntry', { entryId: entry.id }, signal)
    }
    this.refs.reset()
    await settlePage(this.session, this.settings.settleMs, signal)
    const header = await readPageHeader(this.session, signal)
    const state = await readPageState(this.session, signal)
    this.policy.assertAllowed(state.url)
    return { ...state, reached: header.ready === 'complete' && !header.url.startsWith('about:') }
  }

  /** {@inheritDoc BrowserAutomation.observe} */
  async observe(request: BrowserObserveRequest, signal?: AbortSignal): Promise<BrowserObservation> {
    await this.prepare(request.owner, signal)
    await this.assertCurrentPageAllowed(signal)
    return await observePage(this.session, this.refs, {
      maxDepth: request.maxDepth ?? this.settings.observeMaxDepth,
      maxNodes: request.maxNodes ?? this.settings.observeMaxNodes,
      maxBytes: request.maxBytes ?? this.settings.observeMaxBytes,
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    }, signal)
  }

  /** {@inheritDoc BrowserAutomation.act} */
  async act(request: BrowserActRequest, signal?: AbortSignal): Promise<BrowserActOutcome> {
    await this.prepare(request.owner, signal)
    await this.assertCurrentPageAllowed(signal)
    const viewport = await this.session.viewport(signal)
    const outcome = await performAction(this.session, this.refs, request, viewport, signal)
    if (this.settings.highlight && outcome.rect !== undefined) {
      await drawHighlight(this.session, outcome.rect, signal)
    }
    await settlePage(this.session, this.settings.settleMs, signal)
    const state = await readPageState(this.session, signal)
    return {
      ...state,
      action: request.action,
      ...(request.target?.kind === 'ref' ? { ref: request.target.ref } : {}),
    }
  }

  /** {@inheritDoc BrowserAutomation.screenshot} */
  async screenshot(request: BrowserScreenshotRequest, signal?: AbortSignal): Promise<BrowserScreenshot> {
    await this.prepare(request.owner, signal)
    await this.assertCurrentPageAllowed(signal)
    return await capturePage(this.session, this.refs, {
      ...request,
      format: request.format ?? this.settings.screenshotFormat,
      quality: request.quality ?? this.settings.screenshotQuality,
    }, signal)
  }

  /** {@inheritDoc BrowserAutomation.console} */
  async console(request: BrowserConsoleRequest, signal?: AbortSignal): Promise<BrowserConsolePage> {
    await this.prepare(request.owner, signal)
    await this.assertCurrentPageAllowed(signal)
    const ring = await readPageConsole(this.session, signal)
    const levels = request.levels === undefined ? undefined : new Set(request.levels)
    const after = ring.entries.filter(entry => entry.seq > (request.since ?? 0) && (levels === undefined || levels.has(entry.level)))
    const limit = request.limit ?? 100
    const entries = after.slice(Math.max(0, after.length - limit))
    return { entries, dropped: after.length - entries.length, cursor: ring.cursor }
  }

  /** {@inheritDoc BrowserAutomation.evaluate} */
  async evaluate(request: BrowserEvaluateRequest, signal?: AbortSignal): Promise<BrowserEvaluateResult> {
    await this.prepare(request.owner, signal)
    if (!this.settings.allowScriptEval) {
      throw new BrowserError('page script evaluation is disabled by configuration (allowScriptEval)', 'BROWSER_SCRIPT_EVAL_DENIED')
    }
    await this.assertCurrentPageAllowed(signal)
    const projection = await this.session.evaluate<string>(`(async () => {
      const value = await (${request.expression})
      if (value === undefined) return 'undefined'
      if (typeof value === 'string') return value
      try { return JSON.stringify(value) } catch { return String(value) }
    })()`, signal)
    return { text: projection }
  }

  /**
   * Claim the lease, install the page bootstrap, and enable the DOM domain.
   * @param owner - caller asking to drive the pane.
   * @param signal - optional caller cancellation.
   */
  private async prepare(owner: BrowserOwner, signal?: AbortSignal): Promise<void> {
    assertLease(this.lease, owner)
    this.lease.touch(owner)
    if (!this.domEnabled) {
      await this.session.send('DOM.enable', {}, signal)
      this.domEnabled = true
    }
    if (!this.newDocumentScriptRegistered) {
      await this.session.send('Page.enable', {}, signal)
      await installPageBootstrap(this.session, signal)
      this.newDocumentScriptRegistered = true
    }
    // A recreated view loses the registration while this provider survives, so
    // the page-side marker decides whether the current document carries it.
    await ensureBootstrapApplied(this.session, signal)
  }

  /**
   * Refuse to act while the pane shows an origin the policy denies.
   * @param signal - optional caller cancellation.
   */
  private async assertCurrentPageAllowed(signal?: AbortSignal): Promise<void> {
    const header = await readPageHeader(this.session, signal)
    this.policy.assertAllowed(header.url)
  }
}

/**
 * Validate a navigation target.
 * @param url - URL text from a model call.
 * @returns the absolute http(s) URL to navigate to.
 */
function parseNavigableUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new BrowserError(`url ${JSON.stringify(url)} is not absolute`, 'BROWSER_NAVIGATION_FAILED')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BrowserError(`url ${JSON.stringify(url)} is not http(s)`, 'BROWSER_NAVIGATION_FAILED')
  }
  return parsed.href
}

export default DesktopBrowserAutomation
