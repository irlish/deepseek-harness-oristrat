# 浏览器自动化

[English](browser.md) | 中文

由 [`@deepseek-ai/dsh-browser`](../../packages/browser/browser/README.zh.md) 拥有的浏览器自动化 seam：一个面向 agent 的接口，用来观察和驱动浏览器页面；它由持有具体浏览器的 provider 实现，由 [`@deepseek-ai/dsh-tool-browser`](../../packages/browser/tool-browser/README.zh.md) 的模型可见工具消费。桌面应用挂载唯一随仓库发布的 provider——[`@deepseek-ai/dsh-browser-desktop`](../../packages/browser/browser-desktop/README.zh.md)——运行在其内嵌的侧边栏面板之上。包级细节、配置和工具 schema 见这些 README；本页是 seam 的词汇。

来源：[`packages/browser/browser/src/types.ts`](../../packages/browser/browser/src/types.ts)、[`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)

## 标识与引用

页面级元素引用是一个不透明 brand，模型读写它的形式是 `@e12`。provider 在一次观察中铸造引用，在一次动作中解析引用，因此引用不会离开产生它的那次观察。

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

`parseBrowserRef` 接受带或不带 `@` 前缀的引用文本，对其它文本返回 `undefined`；`formatBrowserRef` 渲染出模型看到的前缀形式。`parseBrowserOwner`/`formatBrowserOwner` 为 owner 字符串加 brand 与去 brand，工具层从发起调用的 agent session 派生出它。

## 目标、观察与截图

每个动作指定一个目标：来自前一次观察的引用、CSS 选择器，或视口坐标点。请求中恰好出现一种。

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

观察是 seam 读取页面结构的唯一方式：页面无障碍树的文本渲染、本次铸造的引用，以及产生该阅读的边界。它不携带几何信息——无障碍节点的位置不属于阅读内容，因此需要坐标的消费者应请求截图或按引用执行动作。

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

截图是当前页面、视口、整页或某个元素的一张图像，连同格式决定的媒体类型，以及读取该图像时页面的 URL。

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

## 操作

抽象服务声明了七个操作，全部为异步。`state` 读取页面标识与前进后退可用性；`navigate` 执行 `goto`、`back`、`forward`、`reload` 之一并返回结果状态；`observe` 渲染无障碍树；`act` 执行 `click`、`hover`、`focus`、`fill`、`type`、`press`、`select`、`scroll` 之一并返回它产生的状态；`screenshot` 抓取图像；`console` 读取 provider 自某个游标以来捕获的控制台与错误条目；`evaluate` 在页面中运行脚本并返回其文本结果。

每个改变页面的操作都返回其后的页面状态，因此调用者通过读取该动作产生的状态来验证动作，而不是假定动作已生效。`BrowserError` 的 code 是封闭的，由所有 provider 共用：provider 不得自造 code，因为消费者的恢复策略取决于它读到的 code。

| Code | 触发条件 |
|---|---|
| `BROWSER_UNAVAILABLE` | provider 没有可驱动的浏览器，或它驱动的浏览器已消失 |
| `BROWSER_ORIGIN_DENIED` | 页面或导航目标被配置的 origin policy 拒绝 |
| `BROWSER_NAVIGATION_FAILED` | 请求的地址缺失、不是绝对地址或不是 http(s)，或请求的历史记录项不存在 |
| `BROWSER_REF_STALE` | 引用不再指向它被铸造时的那个元素 |
| `BROWSER_ACTION_FAILED` | 目标没有可操作的盒子、键名未知，或页面脚本抛出异常 |
| `BROWSER_BUSY` | 另一个 owner 持有单一面板租约 |
| `BROWSER_SCRIPT_EVAL_DENIED` | 配置禁用了脚本求值 |
| `BROWSER_TIMEOUT` | 命令超过了 provider 的命令超时 |
| `BROWSER_ABORTED` | 调用者的 signal 取消了命令，或浏览器在命令执行期间关闭 |
| `BROWSER_PROTOCOL` | 命令通道返回了 provider 无法理解的内容，或截图没有返回任何字节 |

provider 与它所驱动的浏览器之间的传输失败使用自己的封闭列表 `BROWSER_TRANSPORT_ERROR_CODES`，并以 `BrowserError` 的形式呈现给消费者：`not-open`、`devtools-open`、`attach-failed`、`closed` 变为 `BROWSER_UNAVAILABLE`；`timeout` 变为 `BROWSER_TIMEOUT`；`aborted` 变为 `BROWSER_ABORTED`；`method-not-allowed`、`payload-too-large`、`protocol-error` 变为 `BROWSER_PROTOCOL`，并带上传输层自己的消息。provider 无法归类的失败同样是 `BROWSER_PROTOCOL`。

## 传输通道

无法在进程内触达其浏览器的 provider 声明一条传输通道：一个窄命令通道，携带一个具名操作及其参数，并返回该操作的结果。该接口刻意不携带事件：需要页面侧状态的 provider 应通过一个操作安装它，而不是订阅事件。

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

provider 从 context 而不是从配置解析其传输通道，因为持有浏览器的一方同时持有该通道：桌面应用在插件树挂载前以 `desktopBrowserTransport` 提供该通道，因此在该 shell 缺席的组合中挂载 provider 会在加载时报出缺少该键的错误，而不是在第一条命令时失败。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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