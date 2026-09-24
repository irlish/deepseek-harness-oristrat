# Browser automation

English | [中文](browser.zh.md)

The browser automation seam owned by [`@deepseek-ai/dsh-browser`](../../packages/browser/browser/README.md): one agent-facing interface for observing and driving a browser page, implemented by a provider that owns a concrete browser and consumed by the model-facing tools of [`@deepseek-ai/dsh-tool-browser`](../../packages/browser/tool-browser/README.md). The desktop application mounts the only shipped provider, [`@deepseek-ai/dsh-browser-desktop`](../../packages/browser/browser-desktop/README.md), over its embedded sidebar pane. Package detail, configuration, and tool schemas live on those READMEs; this page is the seam's vocabulary.

Source: [`packages/browser/browser/src/types.ts`](../../packages/browser/browser/src/types.ts), [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)

## Identity and references

A page-scoped element reference is an opaque brand that the model reads and writes as `@e12`. The provider mints references during an observation and resolves them during an action, so a reference never travels outside the observation that produced it.

```ts type-equiv
/**
 * One page-scoped element reference minted by an observation, rendered to the
 * model as `@e12`. References identify an element inside one observation
 * generation only: any navigation, or a newer observation that drops the node,
 * makes the reference stale, and the provider reports `BROWSER_REF_STALE`
 * instead of acting on a different element.
 */
type BrowserRef = Branded<'BrowserRef'>
```

```ts type-equiv
/**
 * Opaque identity of the caller that holds the browser view. The provider uses
 * it only to arbitrate the single-view lease; it never parses or displays it.
 */
type BrowserOwner = Branded<'BrowserOwner'>
```

`parseBrowserRef` accepts reference text with or without the `@` sigil and returns `undefined` for anything else; `formatBrowserRef` renders the sigil form the model sees. `parseBrowserOwner`/`formatBrowserOwner` brand and unbrand the owner string, which the tool layer derives from the calling agent session.

## Targets, observations, and captures

Every action names one target: a reference from a previous observation, a CSS selector, or a viewport point. Exactly one kind is present in a request.

```ts type-equiv
/** Addressable element inside the current page. */
type BrowserElementTarget = {
  readonly kind: 'ref'
  readonly ref: BrowserRef
} | {
  readonly kind: 'selector'
  readonly selector: string
} | {
  readonly kind: 'point'
  readonly x: number
  readonly y: number
}
```

An observation is the seam's only reading of page structure: a text rendering of the page's accessibility tree, the references it minted, and the bounds that produced it. It carries no geometry — an accessibility node's position is not part of the reading, so a consumer that needs coordinates asks for a capture or acts by reference.

```ts type-equiv
/**
 * One observation generation: the reference-bearing text the model acts on.
 * `refs` contains exactly the references this text used, so a later `act` can
 * reject a reference the model invented or read in an older generation.
 */
interface BrowserObservation extends BrowserPageIdentity {
  readonly text: string
  readonly refs: readonly BrowserRef[]
  readonly nodeCount: number
  readonly truncated: boolean
  readonly nextCursor?: string
  /** UTF-8 byte length of `text` as emitted, including its page header. */
  readonly byteLength: number
}
```

A capture is one image of the current page, the viewport, the full page, or one element, together with the media type the format decides and the URL the capture was read from.

```ts type-equiv
/** Captured image bytes. The consumer stores them; the seam never owns storage. */
interface BrowserScreenshot {
  readonly format: BrowserImageFormat
  /** Media type of the captured bytes, which the format decides. */
  readonly mediaType: 'image/png' | 'image/jpeg'
  readonly bytes: Uint8Array
  readonly width: number
  readonly height: number
  /** URL of the page the image was captured from, read as part of the capture. */
  readonly url: string
}
```

## Operations

The abstract service declares seven operations, all asynchronous. `state` reads the page identity and history availability; `navigate` performs one of `goto`, `back`, `forward`, or `reload` and returns the resulting state; `observe` renders the accessibility tree; `act` performs one of `click`, `hover`, `focus`, `fill`, `type`, `press`, `select`, or `scroll` and returns the state it produced; `screenshot` captures an image; `console` reads the console and error entries a provider captured since a cursor; `evaluate` runs script in the page and returns its text result.

Every operation that changes the page returns the page state that follows it, so a caller verifies an action by reading the state it produced rather than by assuming the action landed. `BrowserError` codes are closed and shared by all providers: a provider may not invent a code, because a consumer's recovery depends on the code it reads.

| Code | Raised when |
|---|---|
| `BROWSER_UNAVAILABLE` | The provider has no browser to drive, or the browser it drives is gone |
| `BROWSER_ORIGIN_DENIED` | The page, or the navigation target, is refused by the configured origin policy |
| `BROWSER_NAVIGATION_FAILED` | The requested address is absent, not absolute, or not http(s), or the requested history entry does not exist |
| `BROWSER_REF_STALE` | A reference no longer identifies the element it was minted for |
| `BROWSER_ACTION_FAILED` | The target has no box to act on, the key name is unknown, or the page script threw |
| `BROWSER_BUSY` | Another owner holds the single-view lease |
| `BROWSER_SCRIPT_EVAL_DENIED` | Script evaluation is disabled by configuration |
| `BROWSER_TIMEOUT` | The command exceeded the provider's command timeout |
| `BROWSER_ABORTED` | The caller's signal cancelled the command, or the browser closed under it |
| `BROWSER_PROTOCOL` | The command channel answered with something the provider does not understand, or a capture returned no bytes |

Transport failures between a provider and the browser it drives use their own closed list, `BROWSER_TRANSPORT_ERROR_CODES`, and surface to consumers as a `BrowserError`: `not-open`, `devtools-open`, `attach-failed`, and `closed` become `BROWSER_UNAVAILABLE`; `timeout` becomes `BROWSER_TIMEOUT`; `aborted` becomes `BROWSER_ABORTED`; and `method-not-allowed`, `payload-too-large`, and `protocol-error` become `BROWSER_PROTOCOL` with the transport's own message. A failure the provider cannot classify is `BROWSER_PROTOCOL` as well.

## The transport

A provider that cannot reach its browser in-process declares a transport: a narrow command channel that carries one named operation with its parameters and returns that operation's result. The interface deliberately carries no events: a provider that needs page-side state installs it through an operation instead of subscribing.

```ts type-equiv
/**
 * Command channel to one browser view, shaped like the browser's own debugging
 * protocol. A provider receives one of these from its composition and never
 * learns how it is carried; the desktop shell brokers it over the app's control
 * channel, and an in-process or remote backend may implement it differently.
 *
 * Implementations reject with {@link BrowserTransportError} and must settle
 * every call: neither a reply nor a rejection may be dropped.
 */
interface BrowserTransport {
  /**
   * Run one command against the browser view.
   * @param method - protocol method name, for example `Page.captureScreenshot`.
   * @param params - method parameters, already validated by the provider.
   * @param signal - optional cancellation; aborting settles the returned promise.
   * @returns the method result exactly as the browser view produced it.
   */
  send(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>
}
```

A provider resolves its transport from the context rather than from configuration, because the party that owns the browser also owns the channel: the desktop application provides the channel under `desktopBrowserTransport` before the tree mounts, so mounting the provider in a composition without that shell fails at load with an error naming the missing key, rather than at the first command.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowser--browserautomation-abstract-seam"></a>

### `ctx.browser` — `BrowserAutomation` (abstract seam)

Abstract browser automation backend. Implementations own one browser view, arbitrate which caller may drive it, and report page state after every mutation so a caller can verify an action instead of assuming it landed.

Element references are minted by one observation and are valid until a navigation or an observation that drops the node; a stale reference is a `BROWSER_REF_STALE` failure, never a silent action on another element.

```ts cordis-catalog
/**
 * Read the current page state.
 * @param owner - calling identity, used for lease arbitration.
 * @param signal - optional cancellation.
 * @returns the observable state of the browser view.
 */
abstract state(owner: BrowserOwner, signal?: AbortSignal): Promise<BrowserPageState>

/**
 * Navigate the browser view and wait for the resulting document to settle.
 * @param request - navigation verb, optional target URL, and timeout.
 * @param signal - optional cancellation.
 * @returns the settled state, with `reached` false when the wait timed out.
 */
abstract navigate(request: BrowserNavigateRequest, signal?: AbortSignal): Promise<BrowserNavigation>

/**
 * Observe the page as reference-bearing text for the model.
 * @param request - owner, optional continuation cursor, and output bounds.
 * @param signal - optional cancellation.
 * @returns one observation generation, bounded by the requested limits.
 */
abstract observe(request: BrowserObserveRequest, signal?: AbortSignal): Promise<BrowserObservation>

/**
 * Perform one action on an element or the page.
 * @param request - action verb, target, and verb-specific value.
 * @param signal - optional cancellation.
 * @returns the action outcome and the page state that followed it.
 */
abstract act(request: BrowserActRequest, signal?: AbortSignal): Promise<BrowserActOutcome>

/**
 * Capture the page, or one element, as image bytes.
 * @param request - owner, optional full-page or element framing, and format.
 * @param signal - optional cancellation.
 * @returns the captured image; the caller owns storage of its bytes.
 */
abstract screenshot(request: BrowserScreenshotRequest, signal?: AbortSignal): Promise<BrowserScreenshot>

/**
 * Read buffered console output and uncaught page errors.
 * @param request - owner, optional lower sequence bound, and entry limits.
 * @param signal - optional cancellation.
 * @returns a bounded, ordered page of entries.
 */
abstract console(request: BrowserConsoleRequest, signal?: AbortSignal): Promise<BrowserConsolePage>

/**
 * Evaluate one expression in the page's main frame, awaiting a promise it
 * returns, and project the result to the text the model reads.
 * @param request - owner and expression source; the caller owns its provenance.
 * @param signal - optional cancellation.
 * @returns the text projection of the evaluated value.
 */
abstract evaluate(request: BrowserEvaluateRequest, signal?: AbortSignal): Promise<BrowserEvaluateResult>
```

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)
<!-- END GENERATED cordis-surface -->