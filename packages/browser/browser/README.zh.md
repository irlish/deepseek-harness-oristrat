---
description: "面向 DeepSeek Harness 的浏览器自动化 Service Definition（`ctx.browser`）：导航、携带引用的观察、元素操作、截图、控制台读取、脚本求值，以及共享的失败码，供组合、实现或排查浏览器提供方的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser

[English](README.md) | 中文

## 概述

`dsh-browser` 定义 harness（智能体框架）能对浏览器面板执行的操作：导航、读取带引用的文本、操作元素、截图、读取控制台与求值脚本。提供方和工具共用 `@e12` 元素引用、`BROWSER_*` 失败码以及请求和结果记录。把它与提供方组合才能驱动面板。当前 Desktop profile 没有适配其 webview guest 的提供方。只挂载本包不会驱动面板：没有提供方时 `ctx.browser` 不存在，也不会有 `browser_*` 工具。

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

当你消费、实现或排查浏览器自动化时阅读本包：它是约定，行为由提供方提供。消费方调用 `ctx.browser`，提供方实现该抽象服务，双方都不需要知道对方如何工作。

### 提供方实现的七项操作

七项操作就是全部接口面。`state` 读取当前页面。`navigate` 移动面板并等待结果文档稳定。`observe` 把页面渲染成携带引用的文本。`act` 对某个元素或整页执行一项操作。`screenshot` 截取图像字节。`console` 读取缓冲的控制台输出与未捕获的页面错误。`evaluate` 在页面中求值一个表达式。每项操作都接收调用方身份并返回已声明的记录；无法完成调用的提供方会 reject 一个带 seam 词汇表中失败码的 `BrowserError`，而不是自行编造消息文本。

### 引用与单一视图

`observe` 铸出模型读写为 `@e12` 的元素引用。引用只在一次观察世代内标识某个元素，因此一次导航、或一次丢弃该节点的新观察都会使其陈旧；提供方对无法解析的引用报告 `BROWSER_REF_STALE`，而不是对另一个元素执行操作。`BrowserOwner` 携带调用方身份——通常就是会话 id——提供方只用它来仲裁谁可以驱动自己那唯一一个视图；第二个调用方会被以 `BROWSER_BUSY` 拒绝。两个值都带品牌标记，因此为其他功能铸出的 id 无法被传到这里。

### 组合提供方

只有把提供方与消费方一起挂载，配置文件才能驱动浏览器。提供兼容浏览器传输通道的 shell 可以挂载此提供方：

```yaml
- id: browser-desktop
  name: '@deepseek-ai/dsh-browser-desktop'
```

该配置行接受的每个字段都属于提供方，记录在 [browser-desktop](../browser-desktop/README.zh.md) 中。

### 调用方要路由的失败

抽象服务拥有一套失败词汇。提供方以 `BrowserError` 失败码报告页面级失败，例如 `BROWSER_ORIGIN_DENIED`、`BROWSER_REF_STALE`、`BROWSER_BUSY`、`BROWSER_TIMEOUT` 与 `BROWSER_SCRIPT_EVAL_DENIED`；被代理到本进程的传输以 `BrowserTransportError` 报告传输失败，其失败码描述的是通道而非页面。提供方会在消费方看到之前把传输失败码映射为能力失败码，因此调用方只需按一套词汇路由，该词汇声明在 `BROWSER_ERROR_CODES` 中；[浏览器子系统](../../../docs/subsystems/browser.zh.md)是该 seam 的参考页。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释 seam 的设计并指出实现它的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

本包是能力 seam 中的一个角色：命名浏览器约定的 Service Definition，Service Provider 与 Consumer 各自拆分，使每个角色都能独立演进（见[能力 seam 笔记](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.zh.md)）。两项决策锚定了它：

- **页面级操作，而非协议方法。** seam 只暴露每个消费方都需要的动词，不命名任何调试协议调用，因此使用其他协议的提供方实现的仍是同一约定。
- **词汇只声明一次。** 元素引用、页面状态、操作结果与失败码都归属这里，使工具、提供方与客户端不会在一次调用或一次失败的含义上漂移。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：抽象 `BrowserAutomation` 服务、`BrowserTransport` 与 `Context.browser` 声明合并 |
| [`src/types.ts`](src/types.ts) | 引用与所有者品牌、请求与结果记录、`BrowserError`，以及两套失败码词汇 |
| — | 不发布运行时不变式伴生入口；该 seam 无状态，页面观察由提供方拥有，也正是不变式本会校验的对象。 |

### 状态归属

seam 不持有任何状态。页面状态、控制台缓冲与引用世代属于提供方；截图字节属于存储它们的调用方；所有者身份只是一个租约令牌。正是这一拆分让同一份消费方代码可以运行在任意后端之上。

### 导出形状

本包默认导出抽象服务类 `BrowserAutomation`，并按名称再导出其类型、品牌、辅助函数与错误。挂载它只是注册 `ctx.browser`，属性背后并没有实现，因此提供方配置行是让该 seam 可用的唯一方式。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当 seam 约定不够用时阅读以下页面。它们从参考词汇逐步进入提供方、工具，以及这一拆分背后的决策。

- [浏览器子系统](../../../docs/subsystems/browser.zh.md) —— 该 seam 的类型定义、语义与生成的 Cordis API。
- [browser-desktop](../browser-desktop/README.zh.md) —— 使用 shell 提供的调试协议通道的提供方。
- [tool-browser](../tool-browser/README.zh.md) —— 基于该 seam 的七个面向模型的工具。
- [browser 组映射](../README.zh.md) —— 同级组页面及其包表格。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-browser) —— 消费方为模型注册的 schema。
- [能力 seam 笔记](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.zh.md) —— 本 seam 遵循的 Service Definition / Provider / Consumer 拆分。

-----

<a id="model-experience"></a>
## 模型体验

### 对提供方约定的影响

#### 模型看到什么

本包不写入任何内容。该 seam 不注册工具 schema、提示词区段或结果文本，因此标准的「工具 schema」与「工具调用历史与结果」两节并不描述本包的任何产物；它固定的是模型在工具结果中遇到的词汇——`@e12` 这类引用、观察、状态、操作与控制台记录的字段名，以及 `dsh-tool-browser` 渲染为失败调用消息的 `BROWSER_*` 失败码。

#### Token 影响

没有直接影响：本包不向任何请求贡献 token。token 开销只出现在消费方渲染这些定义所描述的值之处。

#### KV Cache 影响

不会直接导致 KV Cache 失效。本包不组装请求前缀，因此只有当消费方渲染的文本或注册的 schema 变化时复用才会改变，而该影响由消费方负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了 seam 止步之处。它们是当前包约束，不是任务积压。

- **仅为抽象**——挂载本包只是注册服务，属性背后没有提供方，因此组合必须存在提供方配置行才能驱动浏览器；`dsh-browser-desktop` 是仓库中唯一的提供方，当前桌面 profile 不组合它。
- **每个提供方实例一个视图**——seam 建模的是客户端显示的单一面板；不存在 target id、窗口列表或第二个面板的词汇，`BrowserOwner` 只用于在调用方之间仲裁那一个视图。
- **封闭的动词集合**——七项操作就是全部接口面：不存在下载、上传、文件选择、对话框、cookie、存储或网络操作，元素寻址也仅限于铸出的引用、CSS 选择器或视口坐标点。
- **seam 不存储任何内容**——截图是调用方必须自行存储的字节，也没有任何操作持久化页面状态，需要其中之一的消费方必须自己负责。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
