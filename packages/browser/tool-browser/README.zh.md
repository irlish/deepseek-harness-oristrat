---
description: "基于 ctx.browser seam 的七个面向模型的浏览器工具——browser_navigate、browser_observe、browser_act、browser_screenshot、browser_console、browser_state 与 browser_eval——供选择、配置或排查它们的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-browser

[English](README.md) | 中文

## 概述

`dsh-tool-browser` 为 agent（智能体）提供七个工具来操作用户正在观看的浏览器面板：`browser_navigate`、`browser_observe`、`browser_act`、`browser_screenshot`、`browser_console`、`browser_state` 与 `browser_eval`。循环是「观察、操作、验证」：`browser_observe` 把页面读成文本，其中可操作的节点携带 `@e12` 这类引用；`browser_act` 驱动其中之一；每次操作都会返回它产生的页面状态。只有在挂载浏览器提供方时这些工具才存在，目前即桌面应用；截图还需要挂载附件存储，以及接受图像输入的模型路由。

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

在浏览器提供方可用之处挂载这些工具。它们注册到 `ctx.tools`，并为每项操作调用 `ctx.browser`，因此模型遇到的浏览器行为来自所挂载的提供方，而不是它们自己。

### 前置条件

该插件注入 `tools` 与 `browser`，因此只有二者都存在时才会注册：没有浏览器提供方的配置文件完全不暴露任何 `browser_*` 工具，而不是暴露一个调用时才失败的工具。每次调用都需要有归属的 agent 会话，因为提供方正是用该会话的 id 作为浏览器所有者来仲裁租约；来自 agent loop 之外的调用会失败。`browser_screenshot` 还需要挂载附件存储，以及声明图像输入的模型路由。

### 最小配置

配置行就是插件项本身，而它所消费的提供方在同一组合中由自己的配置行配置：

```yaml
- id: tool-browser
  name: '@deepseek-ai/dsh-tool-browser'
```

这些工具本身没有配置字段：[browser-desktop](../browser-desktop/README.zh.md) 配置行决定 origin policy、观察边界与图像默认值。

### 七个工具

用 `browser_observe`、`browser_state`、`browser_console` 与 `browser_eval` 读取页面；用 `browser_act` 与 `browser_navigate` 改变页面；用 `browser_screenshot` 查看页面。`browser_state` 是步骤之间的低成本检查，`browser_observe` 是产出引用的结构化阅读，`browser_eval` 则是获取无障碍树未携带事实的兜底手段。生成的[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-browser)保存了模型实际接收的每个 schema 与描述。

### 观察、操作、验证循环

`browser_observe` 把页面渲染成文本，其中每个可操作节点都携带 `@e12` 这类引用。`browser_act` 接收该引用——或 CSS 选择器、或视口坐标点，但三者只能取其一——并执行 `click`、`hover`、`fill`、`type`、`press`、`select`、`scroll` 或 `focus` 之一；只有 `press` 与 `scroll` 可以省略目标。每次操作与导航都会返回其后的页面状态，因此通过读取该返回结果验证步骤，而不是假定操作已生效。提供方无法再解析的引用会失败，并告诉模型重新观察页面，而不是对另一个元素执行操作。

### 截图

`browser_screenshot` 把截图作为图像返回给模型查看，因此可以直接判断渲染效果，而不是仅凭结构推断：字节被存为持久附件，并作为图像块返回，旁边附一行描述。当前模型路由未声明图像输入时该工具拒绝运行，因为模型无法查看的图像是误导性的成功。超出尺寸的截图会失败而不会被降采样，消息会指明出路——改为截取视口而非整页，或降低 JPEG 质量。

### 所有权

每次调用都会为调用会话占用浏览器，因此两个会话无法在同一面板中交错命令。第二个会话会失败，直到持有者空闲，消息中会指明持有者。中断会话轮次会通过工具传给提供方的信号中止该调用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释该工具集的设计并指出实现它的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

本包是 seam 的轻量消费方：每项浏览器操作对应一个工具，自身不含浏览器逻辑，因此每个页面事实与每次失败都来自所挂载的提供方，工具接口面在不同提供方之间保持完全一致。每个定义都携带模型描述、参数 schema、输出 schema、结果渲染与展示元数据，因此用户看到的卡片与模型读到的值同源。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：七个工具定义及其参数与输出 schema、结果渲染器与展示元数据 |
| — | 不发布运行时不变式伴生入口；该插件只注册工具，自身不持有状态。 |

### 导出形状

本插件是函数插件：导出 `name`、`inject` 与 `apply`，没有默认导出。多余的 `export default` 会让 Loader 的 `unwrapExports` 折叠模块并丢弃 `inject`（参见 [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.zh.md)）。

### 结果渲染

每个工具返回结构化值，并据此渲染自己的面向模型文本。导航返回 `reached: <url> "<title>"` 或 `did not finish loading: …`；操作返回 `<action> <ref> → <url> "<title>"`；`browser_state` 返回一行，包含视口与前进后退可用性；`browser_console` 渲染一行表头，加上每条记录一行 `[level] text`。工具或提供方抛出的失败会成为失败调用的消息，因此模型读到的是一个字符串，并在可行动之处得到下一步。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当工具约定不够用时阅读以下页面。它们从 seam 及其提供方，逐步进入模型实际接收内容的生成目录。

- [浏览器子系统](../../../docs/subsystems/browser.zh.md) —— 该 seam 的类型定义、语义与生成的 Cordis API。
- [browser-desktop](../browser-desktop/README.zh.md) —— 驱动这些工具所操作内嵌面板的提供方。
- [browser seam](../browser/README.zh.md) —— 这些工具消费的 Service Definition。
- [browser 组映射](../README.zh.md) —— 同级组页面及其包表格。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-browser) —— 模型实际接收的每个 schema 与描述。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

七个 schema 一起注册，[生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-browser)保存了模型实际接收的每一个：`browser_navigate` 接收 `goto`、`back`、`forward` 或 `reload` 的 `action`，外加可选的 `url`；`browser_act` 接收操作名、一种目标形式，以及该动词所需的值；`browser_screenshot` 接收 `full_page`、目标、`format` 与 `quality`。不一致的参数会在调用提供方之前被拒绝，因此同时传入 `ref` 与 `selector` 的 `browser_act` 会返回 `<verb> accepts one of ref, selector, or x/y — not several`。

#### Token 影响

固定：工具可见时，七个 schema 及其描述存在于每个请求中，并在同一包版本下保持稳定。

#### KV Cache 影响

工具集及其描述不变时前缀保持稳定。挂载或移除浏览器提供方会改变可见的工具块，并可能自此使复用失效。

### 工具调用历史与结果

#### 模型看到什么

assistant 调用会保留其参数——操作名、`@e12` 这类引用、值、按键。每个结果都是本包渲染的文本：`reached: https://example.com/ "Example"`、`click @e12 → https://example.com/ "Example"`、`https://example.com/done "Done" viewport=1280x800 history=back/forward`、`captured png 1280x800 of https://example.com/` 及其旁边的图像块，以及 `no console output; cursor=4` 或 `2 entries; cursor=9`，其后跟着 `[warn] page dialog alert: Are you sure?`。`browser_observe` 返回提供方渲染的页面文本，被截断的阅读会携带可继续读取的游标。失败以 `Error: <message>` 形式抵达，例如 `Error: browser tools require an agent session: the call ran outside an agent loop`；被中断的轮次渲染为 `Error: tool call aborted`。

#### Token 影响

观察结果占主要部分，并受提供方的深度、节点数与字节上限约束；控制台读取受 `limit` 约束；一次截图消耗一个图像块加一行；其余结果各为一行短文本。所有内容都会保留在 transcript（文本记录）中直到压缩。

#### KV Cache 影响

仅追加：结果追加在可复用请求前缀之后，且不会重写更早的内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明该工具集何时不合适。它们是当前包约束，不是任务积压。

- **在提供方组合之外缺席**——只有挂载 `ctx.browser` 时工具才会注册，因此没有桌面提供方的配置文件完全不暴露 `browser_*` 工具；仓库中没有其他包提供它。
- **一个面板同一时刻仅一个会话**——调用会话在工作期间占用该面板，第二个会话会被拒绝直到第一个空闲；没有排队、没有交接，也没有在两个 agent 之间共享面板的方式。
- **截图是带尺寸上限的内联图像**——截图以持久附件中的图像块返回，因此必须同时满足附件存储的图像上限与面板通道的转发截图上限；超出尺寸的截图会带指引地失败，而不会被降采样。
- **运行中的调用由轮次而非面板停止**——面板只报告自动化正在运行，不提供逐操作取消，因此中断会话轮次是唯一的停止路径，该中止以被中止的命令形式抵达提供方。
- **没有随包发布的 skill**——这些包不附带教授该循环的 skill 资产，因此模型只能从工具描述与自己的观察中学习它。
- **没有文件、下载或对话框操作**——该工具集无法上传文件、启动下载或应答页面对话框，因此需要其中之一的页面无法被完成；页面对话框由提供方中和而非展示。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>