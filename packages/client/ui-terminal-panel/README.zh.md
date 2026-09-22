---
description: "右侧栏终端标签页：通过 gui-terminal Remote 命名空间为每个标签持有一个 PTY 会话，输出按游标续读轮询，并提供写入与关闭动词。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-terminal-panel

[English](README.md) | 中文

## 概述

使用本包可为每个右侧栏标签提供自己的可交互 shell。`terminal` 标签通过 `ctx.remote.guiTerminal` 渲染一个绑定宿主 PTY 的 xterm.js 面板：按键直通写入，输出以 60 毫秒轮询按续读游标到达，卸载标签即关闭会话。多个终端就是该类型的多个标签，各自持有一个 PTY；`⌘J`/`Ctrl+J` 在客户端任意位置打开该页。会话属于浏览器作用域而非 Agent 作用域；宿主控制器持有会话表，并随其 effect 作用域终止所有 PTY。

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

把本包作为 web-app bundle 的一个浏览器条目发布；随附组合已经插入它。该标签以**终端**条目出现在右侧栏引导页中，经 `ctx.sidebarRight.openTab('terminal')` 打开，并响应 `⌘J`/`Ctrl+J` 快捷键。每个打开的标签在 sessions mirror 为其会话携带的工作区根中启动 PTY；mirror 尚不知道该根时，shell 在服务器的工作目录中启动。

### 何时选择

当用户需要在会话旁边直接拥有一个 shell——查看状态、运行一次性命令——而不经过 agent 时选择它。模型需要看到或复现的工作请避免它：该面板是人工界面，其终端记录不进入会话日志，agent 自己的终端与 bash 工具仍是面向模型的路径。PTY 本体位于 Host 侧的 [`@deepseek-ai/dsh-api-gui-terminal`](../../api/gui-terminal/README.zh.md)；没有该命名空间，标签类型不会注册。

### 最小配置

在 Sidebar 栈旁边添加一个浏览器条目；web-app bundle 已经携带它：

```yaml
- name: '@deepseek-ai/dsh-client-ui-terminal-panel'
```

本包没有配置字段。它需要右侧栏 tab 注册表（`sidebarRightTabs`）、导航控制器（`sidebarRight`）、键控的 `sidebar.right.pane.tab` 与 `sidebar.right.pane.tab.title` 座位、locale 服务，以及 `guiTerminal` Remote 命名空间。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

插件主体各自在 effect 下注册：`terminal-panel` locale 字典、`terminal` tab 类型（id `@deepseek-ai/dsh-client-ui-terminal-panel`、band `builtin`、引导序 20、不认领地址）、键控 `sidebar.right.pane.tab` 座位下的面板主体、chip 标题，以及在活动停靠格中打开该页的窗口级 `⌘J`/`Ctrl+J` 快捷键。面板挂载一个 xterm.js `Terminal`（13px、光标闪烁、主题色读自计算后的 CSS 变量）与 fit 插件；`ResizeObserver` 让它在不触发窗口 resize 的侧栏拖拽中保持贴合。打开会话时回放返回的 scrollback，把 `onData` 按键经 `write` 转发，并启动携带续读游标的 60 毫秒 `read` 轮询。PTY 以空的最后一页结束时轮询停止、状态行报告已退出；某次调用被拒绝时报告失败及错误详情。卸载时销毁终端、清除轮询并关闭会话，PTY 随标签一起死亡。xterm 样式表每个文档只安装一次。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 插件主体：字典、tab 类型、键控座位、`guiTerminal` 线上面与打开快捷键 |
| [`src/client/definition.tsx`](src/client/definition.tsx) | `terminal` tab 类型定义及其引导页条目 |
| [`src/client/TerminalWorkspace.tsx`](src/client/TerminalWorkspace.tsx) | 面板：xterm 生命周期、PTY open/write/poll/close 与状态行 |
| [`src/client/TerminalTabBody.tsx`](src/client/TerminalTabBody.tsx)、[`TerminalTitle.tsx`](src/client/TerminalTitle.tsx) | 座位适配器：把会话工作区根送入面板；chip 标题前的终端标记 |
| [`src/client/xterm-css.ts`](src/client/xterm-css.ts)、[`locales.ts`](src/client/locales.ts) | 一次性安装的 xterm 样式表；`terminal-panel` zh/en 字典 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-sidebar-right](../ui-sidebar-right/README.zh.md)——本包注册进入的 tab 注册表、键控座位与导航控制器。
- [gui-terminal](../../api/gui-terminal/README.zh.md)——`ctx.remote.guiTerminal` 背后的宿主 PTY 控制器。
- [Remote 装配](../../api/remotes/README.zh.md)——`ctx.remote.guiTerminal` 如何到达浏览器。
- [终端会话](../../terminal/terminal/README.zh.md)——浏览器会话刻意不加入的 Agent 作用域 PTY 家族。

-----

<a id="model-experience"></a>
## 模型体验

无，因为面板只驱动 `guiTerminal` Remote 命名空间；任何动词都不进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

不发布 invariant 伴生包：面板不保留跨入口状态；PTY 生命周期由宿主控制器及其 effect 作用域持有。

- 输出以 60 毫秒轮询 `read` 并按游标续读，而不是消费宿主的 `output` 流动词；推送客户端是延后工作。
- 面板保持打开时的 PTY 几何；宿主终端接口不暴露 resize 动词，因此重贴合仅是视觉上的。
- 重载后不恢复 PTY：标签状态仅在内存中，浏览器重载后没有终端标签，旧页面打开的 PTY 留在 Host 上直到控制器的 effect 作用域拆除。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
