---
description: "浏览器自动化 seam（`ctx.browser`）的桌面提供方：驱动桌面客户端所显示的内嵌浏览器面板，包含其 origin policy、单一所有者租约、观察边界与配置字段，供选择、配置或排查它的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-desktop

[English](README.md) | 中文

## 概述

`dsh-browser-desktop` 通过 shell 提供的调试协议传输实现浏览器自动化：导航、读取页面、输入、截图和控制台读取。当前桌面 profile 使用官方侧边栏 webview guest，不再提供二开旧 WebContentsView 的传输通道，因此交付的应用不会挂载本 provider。提供兼容传输通道的组合仍可使用本 provider 及其 origin、观察和脚本控制。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在为浏览器面板提供调试协议通道的组合中挂载本提供方。它基于该面板实现 `ctx.browser`，面向模型的工具无需改动即可使用。

### 前置条件

提供方从组合中取得命令通道：它在构造时读取 context 键 `desktopBrowserTransport`，当组合没有提供该键时拒绝加载。当前桌面 shell 不提供这个键。提供方不打开浏览器，也不拥有窗口；集成它的 shell 必须先提供传输通道与浏览器面板。

### 最小配置

每个字段都有默认值，因此最小可用配置行只有插件项本身：

```yaml
- id: browser-desktop
  name: '@deepseek-ai/dsh-browser-desktop'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `allowScriptEval` | `true` | 是否允许运行页面脚本求值 |
| `highlight` | `true` | 操作是否绘制用户可见的页面内高亮框 |
| `commandTimeoutMs` | `15,000` | 单条代理命令的截止时间 |
| `settleMs` | `150` | 操作后读取页面状态前观察的静默期 |
| `leaseIdleMs` | `300,000` | 空闲多久后其他会话可以接管浏览器租约 |
| `defaultOriginDecision` | `allow` | 没有任何模式匹配时的 origin 决策 |
| `allowOrigins` | `[]` | 授予访问权限的主机、通配主机或 origin 模式 |
| `denyOrigins` | `[]` | 拒绝访问的模式；它们优先于 `allowOrigins` |
| `observeMaxDepth` | `12` | 一次观察渲染到的最深无障碍层级 |
| `observeMaxNodes` | `700` | 一次观察渲染的最大元素行数 |
| `observeMaxBytes` | `200,000` | 一次观察渲染的最大字节数 |
| `screenshotFormat` | `png` | 调用未指定时截图使用的图像格式 |
| `screenshotQuality` | `80` | 调用未指定时截图使用的 JPEG 质量 |

生成的[配置目录](../../../docs/config-catalog.zh.md)是每个受支持字段及其源声明的穷尽式真源。

### agent 可以驱动的 origin

策略在每次调用时都会检查，而不是在挂载时检查一次，因为 agent 点击的链接可能把面板带到策略拒绝的 origin。模式有三种匹配方式：诸如 `example.com` 的裸主机只匹配该主机；诸如 `*.example.com` 的通配主机匹配该主机及其子域；诸如 `https://example.com:8443` 的完整 origin 匹配精确的 scheme、主机与端口。无法解析为绝对 URL 的地址会被拒绝，因为策略无法对它作出判断。`denyOrigins` 优先于 `allowOrigins`，其余情况由 `defaultOriginDecision` 决定——因此什么都不列出的部署会放行所有 origin，而设置 `defaultOriginDecision: deny` 的部署只放行其允许列表。导航目标必须是绝对的 `http`/`https` URL。

### 单一所有者租约

每个应用窗口只存在一个面板，因此两个会话不得在其间交错命令。第一个调用方取得租约，同一调用方持续持有；其他会话会被以 `BROWSER_BUSY` 拒绝，直到持有者空闲达到 `leaseIdleMs`——这段窗口足够长，使所有者绝不会像是仍在测试途中。活动会刷新租约，因此耗时较长的测试仍能持有它。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释提供方的设计并指出实现它的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

本提供方是 `ctx.browser` 的 Service Provider，建立在它并不拥有的命令通道之上。它从不打开浏览器、从不拥有窗口、也从不合成操作系统输入：每次按键、点击与滚动都是页面内部的协议事件，因此应用窗口永远不会被聚焦或激活。面板属于 shell；提供方只看到 shell 暴露的传输，这正是同一个包也能运行在提供同样通道的进程内或远程后端之上的原因。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`DesktopBrowserAutomation`、`Config` schema、传输 context 键，以及每次调用上的 origin 与租约检查 |
| [`src/cdp.ts`](src/cdp.ts) | 命令会话：每条命令一个截止时间，以及传输失败码到能力失败码的映射 |
| [`src/observation.ts`](src/observation.ts) | 无障碍树读取、引用世代，以及渲染出的观察文本 |
| [`src/interaction.ts`](src/interaction.ts) | 元素解析、输入派发，以及等待页面稳定 |
| [`src/capture.ts`](src/capture.ts) | 视口、整页与元素截图 |
| [`src/policy.ts`](src/policy.ts) | 基于主机与 origin 模式的 origin 策略，以及单一所有者租约 |
| [`src/bootstrap.ts`](src/bootstrap.ts) | 注入的页面脚本：控制台捕获、对话框中和与高亮覆盖层 |
| — | 不发布运行时不变式伴生入口；提供方不拥有任何持久或事件溯源关系，它驱动的面板属于 shell。 |

### 主流程

每项操作都以同样的方式开始。`prepare` 取得或刷新租约、启用一次 DOM 域、为新文档注册一次页面引导脚本，并在屏幕上的文档未携带它时重新应用；随后每项操作都会针对实际加载的页面重新检查 origin 策略才开始读取或改动——`console` 不安装任何东西，只对缓冲的环形记录求值它自己的只读表达式——`act` 与 `navigate` 则在报告状态前等待文档停止加载。

### 观察

观察由浏览器已经计算好的无障碍树渲染，而不是 DOM 转储：隐藏节点无需提供方自建的可见性启发式就已缺席，输出也比原始节点快照小得多。每一渲染行都携带模型回传的引用；存储从不重复使用同一段引用文本，因此旧引用只可能指向它当初被铸造的节点，而上一世代的引用在该节点仍属于当前页面时保持可解析。文本中刻意不含几何信息——操作在运行时自行解析几何——`observeMaxBytes` 约束整份文本（含页面行与截断标记）的 UTF-8 字节数。

### 页面引导脚本

一个注入脚本替代了该 seam 未暴露的三项协议功能：控制台捕获，因为没有事件通道跨越该传输；对话框中和，因为页面自带的 `alert` 会阻塞本可关闭它的那条命令；以及高亮覆盖层，因为原生子视图会合成在页面 DOM 之上。该脚本是幂等的，因此丢失了新文档注册的重建视图可以在现有文档中重新运行它来修复。

### 失败映射

超出截止时间的命令会被放弃并报告为 `BROWSER_TIMEOUT`，调用方中止报告为 `BROWSER_ABORTED`。传输失败对传输词汇是完备的：关闭或未附着的面板变为 `BROWSER_UNAVAILABLE`，被拒绝的方法或畸形回复变为 `BROWSER_PROTOCOL`——只在一处声明，即 [`src/cdp.ts`](src/cdp.ts)，因此不会有页面级失败被误报为传输失败。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当提供方约定不够用时阅读以下页面。它们从 seam 参考逐步进入面向模型的工具，以及挂载本提供方的组合。

- [浏览器子系统](../../../docs/subsystems/browser.zh.md) —— 该 seam 的类型定义、语义与生成的 Cordis API。
- [browser seam](../browser/README.zh.md) —— 本提供方实现的 Service Definition。
- [tool-browser](../tool-browser/README.zh.md) —— 基于本提供方的七个面向模型的工具。
- [browser 组映射](../README.zh.md) —— 同级组页面及其包表格。
- [生成的配置目录](../../../docs/config-catalog.zh.md) —— 每个受支持配置字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

### 观察文本

#### 模型看到什么

`browser_observe` 的结果正文就是本提供方渲染的文本。它以页面行开头，例如 `[page] url=https://example.com/ title=Example viewport=1280x800 scrollY=0`；当页面元素获得焦点时追加 `[focused] <element>`，当页面弹出对话框时追加 `[dialogs] <n> page dialog(s) were neutralized; see browser_console`；随后是每个渲染出的无障碍节点一行，带缩进——`@e3 button "Sign in"`、`@e7 textbox value="user@example.com" [focused]`、`@e9 heading "Results"`；当某个上限截断了渲染时，以 `[truncated] nodes=… shown=… next_cursor=…` 结尾。

#### Token 影响

与渲染出的节点行数成正比，并受观察上限约束：请求自身的 `maxNodes` 与 `maxDepth`，否则是 `observeMaxNodes` 与 `observeMaxDepth`，并由 `observeMaxBytes` 限制整份文本的 UTF-8 字节数。该文本每次观察调用读取一次，并像其他工具结果一样保留在 transcript（文本记录）中。

#### KV Cache 影响

仅追加。该文本是追加在可复用请求前缀之后的新工具结果内容，其大小改变的是结果长度而非前缀内容。

### 提供方失败

#### 模型看到什么

被拒绝的操作以失败调用的消息抵达模型，携带 seam 的失败码词汇：`element @e12 is stale: observe the page again before acting`、`origin refused: denied by *.example.com`、`another session (<owner>) is driving the browser; it was active <n>s ago`、`page script evaluation is disabled by configuration (allowScriptEval)`，以及 `browser command Page.navigate exceeded 15000ms`。每条消息都指出失败对象，并在模型可以行动之处说明下一步该做什么。

#### Token 影响

调用失败前为零，之后每次失败一条短消息。反复失败会在 transcript（文本记录）中重复该消息。

#### KV Cache 影响

仅追加；失败消息位于可复用请求前缀之后，不会使既有条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了本提供方不合适之处。它们是当前包约束，不是任务积压。

- **构造上仅限桌面**——没有 shell 的命令通道时提供方拒绝加载，因此它无法挂载在无头或非桌面组合中，也没有其他提供方可以替代它。
- **一个面板，一个所有者**——一个实例驱动应用窗口拥有的那唯一面板；第二个会话必须等持有者空闲满 `leaseIdleMs`，且不存在第二个面板或后台浏览器的词汇。
- **页面对话框被中和而非展示**——`alert`、`confirm` 与 `prompt` 由注入脚本替换并记录为控制台条目，因此模型可以读到页面弹出过对话框，却永远无法应答真实对话框，也看不到浏览器自带的提示框。
- **无法驱动下载与文件选择器**——桌面通道只转发该功能所需的协议方法，因此启动下载或打开文件选择器的页面会让 agent 没有任何操作可以完成它。
- **截图是字节而非已存储图像**——提供方返回图像数据且不拥有存储，截图能否在调用之后存活由消费方决定。
- **默认 origin 决策放行所有 origin**——当 `allowOrigins` 与 `denyOrigins` 都为空时，模型可以驱动该面板能到达的任何 origin，包括环回与内网地址。这是桌面产品的有意默认值：有人看着面板，随时可以导航离开；若部署方要白名单，请设置 `defaultOriginDecision: deny` 并列出其 origin。
- **引用在单个文档内消耗**——引用文本从不重复使用，因此累积超过 9,999,999 次铸造引用的文档（需要在一次未导航的页面上做数千次完整观察）会铸造出引用语法无法表达的文本：模型能读到该引用，却无法把它写回。导航会重置存储与计数器。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
