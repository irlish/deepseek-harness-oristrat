---
description: "浏览器交互终端 Remote BFF：每个浏览器会话标签一个 PTY，走 subprocess 终端面，以 unary 动词加可断点续传的输出流暴露。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-gui-terminal

[English](README.md) | 中文

## 概述

使用本包可为 Web GUI 提供交互式 shell 面板。每个浏览器终端标签拥有一个通过 `ctx.subprocess.spawnTerminal` 派生的 PTY，Typert 网关在共享 Remote mux 上暴露 `open`、`write`、`read`、`close`、`list` 动词以及可按游标续传的输出流 `output`。会话归属宿主进程而非 Agent：面向模型的 `ctx.terminals` 家族把会话围栏在活 Agent 属主之后，而浏览器面板没有 Agent，因此本控制器自持会话表，并随其 effect 作用域终止所有 PTY。

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

把控制器与 Typert Gateway 及 subprocess 提供方一起挂载在 Host 侧；`dsh-web-app` bundle 已为随附组合插入该条目。浏览器客户端调用 `ctx.remote.guiTerminal.open({ cwd?, cols?, rows? })`，得到 `{ id, scrollback, cursor }`，随后写入按键、按游标读取输出，并在其面板卸载时关闭会话。`cwd` 缺省为服务器进程的工作目录，几何缺省为 120×30。

| 动词 | 返回 | 用途 |
|---|---|---|
| `open({ cwd?, cols?, rows? })` | `{ id, scrollback, cursor }` | 派生一个可交互 shell PTY——来自 `$SHELL` 的登录 shell（回退 `/bin/bash`），Windows 上为 `powershell.exe -NoLogo`——携带 `TERM=xterm-256color` 与 1 秒终止宽限 |
| `write({ id, data })` | — | 向 PTY 转发原始终端输入字节 |
| `read({ id, cursor })` | `{ frames, cursor, alive }` | 游标处及其后保留的帧、续读游标与存活状态，不驻留等待 |
| `output({ id, cursor })` | `{ seq, data }` 流 | 先保留帧，随后实时帧，直到 PTY 退出或该代流取消 |
| `close({ id })` | — | 终止该会话的 PTY 进程树并删除会话；未知 id 不关闭任何东西 |
| `list()` | `{ id, alive }[]` | 全部会话的存活摘要，按打开顺序 |

`write`、`read` 与 `output` 对未知会话 id 抛错。

### 何时选择

当浏览器界面需要每个面板一个自己的可交互 shell——会话旁边的人工终端——时选择它。模型驱动的终端工作请避免它：[`@deepseek-ai/dsh-terminal`](../../terminal/terminal/README.zh.md) 中面向 Agent 的会话家族把 PTY 围栏在活 Agent 属主之后，那才是模型的路径。[`@deepseek-ai/dsh-client-ui-terminal-panel`](../../client/ui-terminal-panel/README.zh.md) 是随附消费方。

### 最小配置

在提供 `typert`（网关）与 `subprocess` 的 Host 上以无配置挂载本服务：

```yaml
- name: '@deepseek-ai/dsh-api-gui-terminal'
```

本服务没有配置字段。Typert 生成经 `./typert` 与 `./remote` 暴露的 Host 与 Client Remote 产物；[`@deepseek-ai/dsh-api-remotes`](../remotes/README.zh.md) 把 client 产物聚合进 `ctx.remote.guiTerminal`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

控制器持有一张内存会话表，id 按 `gui-<n>` 铸造。`open` 经 `ctx.subprocess.spawnTerminal` 派生平台 shell，并订阅该会话的有界环：每个 PTY 输出块成为一个 `{ seq, data }` 帧，环保留最新 2048 帧，因此重连客户端可按游标续传，直到落后超过 2048 帧并静默跳过缺口。`read` 直接从环应答，不驻留等待；`output` 的一代流驻留在一个等待者集合上，每次 push、PTY 退出与该代流的中止信号都会唤醒它。PTY 的 `done` promise 以任一方式落定都会把会话标记为死亡，从而结束驻留的流，并让 `read` 报告 `alive: false` 及其最后的帧。`close` 删除一个会话并终止其 PTY 进程树；控制器 effect 作用域的拆除在插件卸载时终止所有剩余 PTY，因此没有会话能活过 Host 组合。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `GuiTerminalController`：`guiTerminal` 命名空间、会话表、有界输出环与六个动词 |
| [`src/types.ts`](src/types.ts) | 请求、帧与结果的线路类型，以 `./types` 发布给 Client 包 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-terminal-panel](../../client/ui-terminal-panel/README.zh.md)——本命名空间服务的浏览器面板。
- [Remote 装配](../remotes/README.zh.md)——Client 包如何触达 `guiTerminal` 命名空间。
- [Subprocess 能力](../../subprocess/subprocess/README.zh.md)——会话经由派生的 `spawnTerminal` PTY 面。
- [终端会话](../../terminal/terminal/README.zh.md)——本命名空间刻意不复用的 Agent 作用域 PTY 家族。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该命名空间只服务浏览器终端面板；任何动词都不进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

不发布 invariant 伴生包：会话表为本控制器私有，所有 PTY 都随其 effect 作用域终止；不存在可与之分叉的独立观测。

- 无 PTY resize 动词：subprocess 终端句柄不暴露 resize，会话保持 open 时几何（默认 120×30），浏览器面板仅视觉重排。
- 随附客户端以 60ms 轮询 `read`，未消费 `output` 流；流动词为未来推送客户端保留。
- 输出保留以每会话 2048 帧为界；落后更多的客户端从最旧保留帧续读，缺口丢失。
- 任何已认证浏览器客户端都可开 shell，与 Web GUI 面向 agent 的 bash 工具同一信任级；无按用户的 shell 策略。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
