---
description: "Oristrat 浏览器包：Session 浏览器工具与共享浏览器资源所有权。"
kind: "package-group"
---

# packages/oristrat

[English](README.md) | 中文

## 摘要

使用 Oristrat 浏览器包，从 Agent（智能体）或 Web 侧边栏检查并操作 Chromium。Chrome DevTools 提供方提供浏览器控制。共享运行时为提供方管理 Session 浏览器资源。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

提供方使用共享运行时，在多轮之间保留浏览器状态。

| 包 | 职责 |
|---|---|
| [`browser-chrome-devtools-mcp`](browser-chrome-devtools-mcp/README.zh.md) | Chromium 工具与人工浏览器控制 |
| [`browser-use-runtime`](browser-use-runtime/README.zh.md) | Session 浏览器资源所有权 |

<a id="related-documentation"></a>
## 相关文档

- [浏览器使用](../../docs/subsystems/browser-use.zh.md) — 提供方选择、Session 所有权及浏览器控制类型。
- [MCP](../../docs/subsystems/mcp.zh.md) — 服务端连接、资源与工具发现。

<a id="dev-note"></a>
## 开发备注

无。
