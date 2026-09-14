---
description: "浏览器交互终端 Remote BFF：每个浏览器会话标签一个 PTY，走 subprocess 终端面，以 unary 动词加可断点续传的输出流暴露。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-gui-terminal

[English](README.md) | 中文

## 概要

`gui-terminal` 为 Web GUI 提供交互式 shell 面板：每个浏览器终端标签拥有一个通过 `ctx.subprocess.spawnTerminal` 派生的 PTY，Typert 网关暴露 `open`、`write`、`read`、`close`、`list` 以及共享 Remote mux 上的流式 `output`。会话归属宿主进程而非 Agent：面向模型的 `ctx.terminals` 家族把会话围栏在活 Agent 属主之后，而浏览器面板没有 Agent，因此本控制器自持会话表，并随其 effect 作用域终止所有 PTY。输出保留在每会话有界环（2048 帧）中，重连客户端可按游标续传。

## Model Experience

无。任何动词都不进入模型请求；该命名空间只服务浏览器终端面板（`@deepseek-ai/dsh-client-ui-terminal-panel`）。

## Known Limitations and Deferred Work

- 无 PTY resize 动词：subprocess 终端句柄不暴露 resize，会话保持 open 时几何（默认 120×30），浏览器窗格仅视觉重排。
- 随附客户端以 60ms 轮询 `read`，未消费 `output` 流；流动词为未来推送客户端保留。
- 任何已认证浏览器客户端都可开 shell，与 Web GUI 面向 agent 的 bash 工具同一信任级；无按用户的 shell 策略。
