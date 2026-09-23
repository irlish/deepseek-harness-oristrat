# Agent Note: 通过调试协议的侧边栏浏览器 agent 自动化

Status: implemented

[English](2026-09-24-oristrat-sidebar-browser-agent-automation.md) | 中文

> 范围：`browser/` 能力 seam（`dsh-browser`、`dsh-browser-desktop`、`dsh-tool-browser`）、`apps/desktop` 与 `apps/desktop-host` 中桌面 shell 的浏览器命令通道（协议版本 4），以及让自动化运行可观测的 `ui-browser-panel` 显示面与活动面。依赖[第二轮 note](2026-09-22-oristrat-thinking-slider-websearch-mcp-repo-browser-panels.zh.md)记录的内嵌面板，以及[第三轮 note](2026-09-23-oristrat-header-repo-menu-browser-view-reuse.zh.md)记录的视图复用生命周期。

## 问题

桌面应用交付了一个只有人类才能驱动的内嵌侧边栏浏览器。agent 无法看到页面，也无法操作它，因此任何面向 web 的改动都靠请用户把屏幕内容读回来验证，也没有任何自动化检查能在已交付的应用里复现一条点击路径。产品负责人要求反过来安排：agent 驱动用户正在观看的那块面板，运行过程实时可见，截图到达模型，并且——这是硬约束——人类的鼠标与键盘绝不被打扰。

## 决策

### 按角色拆分的 seam

- `packages/browser/browser`（`@deepseek-ai/dsh-browser`）是 Service Definition：品牌化的 `BrowserRef`/`BrowserOwner` 身份、请求/结果词汇、封闭的 `BrowserError` 错误码清单，以及以 `ctx.browser` 注册、带七个操作（`state`、`navigate`、`observe`、`act`、`screenshot`、`console`、`evaluate`）的抽象 `BrowserAutomation` 服务。每个改变页面的操作都返回其后的状态，因此验证就是该操作自身的结果，而不是另一次读取。
- `packages/browser/browser-desktop`（`@deepseek-ai/dsh-browser-desktop`）是 Service Provider：它通过从上下文中以 `desktopBrowserTransport` 解析出的 `BrowserTransport`，经调试协议驱动该面板。
- `packages/browser/tool-browser`（`@deepseek-ai/dsh-tool-browser`）是 Consumer：七个面向模型的工具，`inject: ['tools', 'browser']`，因此没有提供方的组合不会注册其中任何一个。

提供方与消费方挂载在不同的平面上：提供方属于 desktop patch，因为 shell 是唯一能提供命令通道的一方；工具则属于 agent preset，因为它们面向模型。`ctx.browser` 是二者之间唯一的边。

### 输入进入页面，绝不进入操作系统

- 每个动作都是一条协议命令：click、hover 与 wheel 使用 `Input.dispatchMouseEvent`；`fill` 先经 `Runtime.callFunctionOn` 的聚焦/选中步骤，再使用 `Input.insertText`；`press` 使用 `rawKeyDown` + `char` + `keyUp`。没有任何代码合成操作系统输入、调用 `webContents.focus()`、激活窗口或提升窗口的 z-order。
- phase-0 spike 在应用窗口失焦（`isFocused() === false`）的情况下对已交付的面板跑通了整个循环：文本输入、一次点击与一次滚轮滚动都生效，滚动偏移与窗口焦点都没有变化。分离出去的视图（`removeChildView`）同样接受输入并持续捕获实时像素，因此隐藏面板不会破坏正确性。

### 观测是可访问性树，渲染为文本

- `observe` 遍历可访问性树，把每个节点渲染为 `role "name" value="…" [state]` 并在前面加上它的 `@eN` 引用，同时跳过被忽略的节点而不跳过它们的子树。几何信息被有意略去：在含 1,500 个链接的页面上，`Accessibility.getFullAXTree` 测得 3,478,506 字节，`DOMSnapshot.captureSnapshot` 测得 830,203 字节，因此携带几何信息的观测根本无法放进模型的上下文。需要坐标的消费方改为截图或按引用操作。
- 引用按观测代际铸造，并由 `RefStore` 解析：它接纳上一个代际，但对更早的一律报 `BROWSER_REF_STALE`，因此模型无法对它凭空编造或两步之前读到的元素采取动作。
- 输出受深度、节点数与字节数约束；被截断的读取会报告 `nextCursor`，下一次 `observe` 调用可以接受它。

### 命令通道

- `apps/desktop-host` 在既有的子进程 IPC 之上以 `DesktopBrowserChannel` 实现 `BrowserTransport`：出方向一个 `browser/cdp` 事件，回来一个 `browser/cdp-result` 或 `browser/cdp-error` 回复，以请求 id 为键。`DESKTOP_HOST_PROTOCOL_VERSION` 为 4；错误码清单取自 Definition 包的 `BROWSER_TRANSPORT_ERROR_CODES`，而不是第二份副本。
- `apps/desktop` 在主进程中经 `DesktopBrowserCdpBroker` 代理命令：它持有一份十八条协议方法的白名单（该通道的全部能力），在第一条命令时惰性附加调试器，附加期间禁用后台节流，一次只运行一条命令，为每条命令设定截止时间，并限制捕获图像的字节数。
- 通道上不传输任何协议事件。控制台捕获、错误捕获、对话框中和与元素高亮都作为一段被求值的引导脚本（`PAGE_BOOTSTRAP_SOURCE`）安装进页面，它在 `window.__dshBrowser` 中维护一个有界的环形缓冲区；提供方经 `Runtime.evaluate` 读取它。`alert`、`confirm` 与 `prompt` 被中和进该缓冲区，而不是留着阻塞面板，因为被阻塞的渲染进程无法回答打开它的那条命令。

### 运行可见，面板自动显示

- 当自动化附加到用户尚未打开的面板时，主进程请求渲染进程显示该面板（`browserReveal`），并在第一条命令之前等待由此产生的 `open`；`ui-browser-panel` 通过 `ctx.sidebarRight.openTab` 打开浏览器标签页作为应答。
- 命令运行期间，主进程发布 `browserActivity`（active 标志、方法名、开始时间），面板据此渲染一条活动条。该活动条仅是展示：没有新增会话事件类型，`SESSION_FORMAT_VERSION` 也未改动，因为工具调用及其结果已经承载了模型可见的表面。

### 安全与成本边界

- 按 origin 的策略（`allowOrigins`/`denyOrigins`，精确 origin、裸主机名或 `*.host` 通配；拒绝优先；无法解析的 URL 一律拒绝）在导航之前以及每条命令之前针对当前页面检查。
- 每个应用窗口只有一个浏览器视图，因此 `BrowserLease` 仲裁单一驱动者：第二个所有者会被以 `BROWSER_BUSY` 拒绝，空闲租约在 `leaseIdleMs` 之后可被抢占。
- 截图以内联方式返回，并有硬性字节上限；超过上限即 `payload-too-large`，消息中给出格式与整页建议。脚本求值由 `allowScriptEval` 门控（默认 `true`，因为该面板就是用户自己的浏览器，缺少它观测无法完整）。
- 面板保持 `sandbox: true`、`contextIsolation: true` 且没有 preload；URL 在导航前解析，只接受 `http:`/`https:`。

## 影响

- 四项已批准方案条目在实现期间发生变化，此处按已交付的现实记录。(1) 截图以内联 base64 返回并给出可据以行动的大小错误，而不是移交临时文件：仓库的 1 MiB 帧上限适用于管道成帧的宿主传输（fd3/fd4），不适用于 Node IPC，因此文件移交只会多出一个需要管理的生命周期，却不会抬高任何真实上限。(2) 没有 `visibility` 配置：main 总是请求渲染进程显示面板，因为隐藏面板会让要求观看这次运行的用户无法观测它。(3) 活动条由上述 main→renderer 推送提供，而不是已被放弃的 Remote 活动面；逐动作取消与持久的活动历史仍然缺席，停止一轮运行仍是既有的会话中断，工具通过 `exec.signal` 遵循它。(4) 本轮不随附打包的 skill：observe→act→verify 循环存在于工具描述中，等该循环的措辞稳定后可以再补一个 skill。
- 自动化观测并驱动面板；它无法发起下载、接受原生文件选择器，或读取面板所屏蔽站点的像素。整页截图受字节上限约束，非常高的页面必须按视口大小分步捕获。
- 提供方仅限桌面端。Web 与 headless profile 注册零个 `browser_*` 工具，这正是 `inject` 等待 `ctx.browser` 的预期读法，而不是一个要用桩填补的能力缺口。
- `apps/desktop/src/host-protocol.ts` 与 `apps/desktop-host` 之间的协议重复是有意的，并由 `apps/desktop/tests/host-protocol.spec.ts` 交叉验证，其中包括一条断言：两侧的错误码清单都等于 `BROWSER_TRANSPORT_ERROR_CODES`。
- 面板在分离状态下仍接受输入，且自动化从不让视图获得焦点，因此用户在应用里打字时，整轮运行期间都一直在应用里打字。该性质是本功能的前提，并在传输层被断言：没有任何代码路径触达操作系统输入。

## 考虑过的替代方案

- 在宿主进程内用浏览器自动化库（Playwright 或其协议客户端）驱动面板：本轮否决，因为该面板是 shell 已经拥有的 Electron `WebContentsView`，对既有视图附加调试器不需要第二个浏览器、不需要驱动进程，也不需要新的监听端口。由库支撑的提供方仍可在同一 `BrowserAutomation` seam 之后实现。
- 用 `DOMSnapshot.captureSnapshot` 或逐节点 `DOM.getBoxModel` 调用来渲染观测：经测量后否决——快照在普通页面上就超过 800 KB，且 box-model 坐标是文档坐标，会因滚动偏移而偏离视口目标。
- 仅用 `rawKeyDown` 按键：spike 证明它不插入文本后否决；可用的序列是 `rawKeyDown` + `char`（携带 `text`）+ `keyUp`。
- 在自动化运行期间抑制面板的 `hide()`：spike 表明分离出去的视图仍接受输入并仍捕获实时像素后否决，因此显示推送是可见性要求，而不是正确性要求。
- 让协议事件经命令通道转发，以便控制台与对话框能在发生时被消费：否决，因为那会把请求/响应通道变成事件流，从而带来它自己的生命周期、顺序与背压问题；一段被求值的引导脚本通过既有的 `Runtime.evaluate` 命令交付同样的事实。
- 在会话中为 `browser_screenshot` 设一张专用工具卡片：未添加，因为通用工具卡片已经通过 `tool.call.images` 渲染结果图像，而该工具的文本一半承载捕获元数据。以后可以添加专用卡片，而无需改变工具的输出。
