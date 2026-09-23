---
description: "browser 能力家族的包映射：浏览器自动化 seam、其桌面提供方，以及面向模型的浏览器工具，供选择或浏览该家族的读者阅读。"
kind: "package-group"
---

# browser/：浏览器自动化能力家族

[English](README.md) | 中文

## 概述

`browser/` 各包让 agent（智能体）驱动用户在桌面应用中正在观看的内嵌浏览器面板：导航它、把页面读成携带引用的文本、对元素执行操作、截图，并读取它的控制台。三个包分担这项工作——`browser` 拥有 Service Definition，`browser-desktop` 基于该面板实现它，`tool-browser` 把它暴露为七个面向模型的工具。只有桌面组合挂载提供方，因此在其他任何地方都不存在 `browser_*` 工具。用该家族驱动用户看到的面板，而不是用于无头抓取或第二个浏览器窗口。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

三个包承担浏览器的各个角色；穷尽式词汇与约定由子系统参考页拥有。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`browser/`](browser/README.zh.md) | Service Definition：每个提供方与工具共享的浏览器动词、元素引用与失败码 | 提供 `ctx.browser` |
| [`browser-desktop/`](browser-desktop/README.zh.md) | 提供方：驱动桌面客户端所显示的内嵌面板，含 origin policy、租约与观察上限 | 实现 `ctx.browser` |
| [`tool-browser/`](tool-browser/README.zh.md) | 消费方：基于该 seam 的七个面向模型的工具 | 注册到 `ctx.tools` |

-----

<a id="related-documentation"></a>
## 相关文档

先读子系统参考页了解共享词汇，再读生成目录与该拆分背后的决策。

- [浏览器子系统](../../docs/subsystems/browser.zh.md)——该 seam 的类型定义、语义与生成的 Cordis API。
- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-browser)——工具为模型注册的 schema。
- [生成的配置目录](../../docs/config-catalog.zh.md)——每个受支持的提供方配置字段及其源声明。
- [能力 seam 笔记](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.zh.md)——该族遵循的 Service Definition / Provider / Consumer 拆分。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>