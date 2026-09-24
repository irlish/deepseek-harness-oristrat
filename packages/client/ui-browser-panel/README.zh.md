---
description: "二开旧 WebContentsView 桥使用的源码包；交付的侧边栏改用上游 webview guest 包。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-browser-panel

[English](README.md) | 中文

## 概述

`dsh-client-ui-browser-panel` 是二开旧主进程 `WebContentsView` 使用的源码包。它测量 Sidebar 区域，并通过早期的 `window.dshDesktop.browser` 桥驱动导航。交付的 web-app bundle 改为挂载上游 `dsh-client-ui-sidebar-browser` 包；当前 Desktop 桥使用另一套 guest 租约接口，因此本面板无法驱动它的浏览器。提供旧桥的组合仍可使用本包源码。

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

仅在提供早期 `window.dshDesktop.browser` 桥的组合中挂载本包。交付的 web-app bundle 使用[sidebar-browser](../ui-sidebar-browser/README.zh.md)。有兼容桥时，本包的标签出现在右侧 Sidebar，并可通过 `ctx.sidebarRight.openTab('browser')` 打开。

### 何时选择

要在应用内阅读网页，请选择交付的[sidebar-browser](../ui-sidebar-browser/README.zh.md)。本包只适合维护带早期 WebContentsView 桥的组合；纯 Web 宿主只显示仅桌面端可用的提示。

### 最小配置

在提供兼容桥之后，集成组合可在 Sidebar 栈旁添加本包的浏览器条目：

```yaml
- name: '@deepseek-ai/dsh-client-ui-browser-panel'
```

本包没有配置字段。它需要右侧栏 tab 注册表（`sidebarRightTabs`）、右侧栏导航器（`sidebarRight`）、键控的 `sidebar.right.pane.tab` 与 `sidebar.right.pane.tab.title` 座位、locale 服务，以及实现早期 WebContentsView 操作的桥。当前 Desktop preload 不实现该桥。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

插件主体注册 `browser-panel` locale 字典、`browser` tab 类型（id `@deepseek-ai/dsh-client-ui-browser-panel`、band `builtin`、引导序 40、不认领地址）、面板主体与 chip 标题，并在每次 apply 读取一次桌面桥：纯 Web 宿主上桥为 `undefined`，主体渲染本地化的仅桌面端提示。有桥时，主体订阅导航状态（`url`、`title`、`canGoBack`、`canGoForward`、`loading`），把视图开到 surface 的布局盒上——由元素的 `offsetLeft`/`offsetTop` 链求和得到，该布局在祖先 transform 动画期间即为最终值——并由元素上的 `ResizeObserver`、捕获阶段 `scroll`、窗口 `resize` 与挂载后 300ms 的落定计时器重新推送取整后的边界；卸载时取消订阅并隐藏视图。下一次挂载经幂等的 open 动词重新附着同一视图，因此文档、Cookie 与历史跨每次标签切换保留，无需重新加载。地址栏在导航前归一化输入：含空白的文本被拒绝，裸主机名补 `https://` 前缀，只有可解析的 http(s) URL 才会导航。主进程属主在每个应用窗口上维持一个视图，使用持久分区 `persist:dsh-embedded-browser`，钳制渲染进程提供的边界，拒绝弹出窗口，并把每次导航限制在 http(s)。显示请求会打开浏览器 tab，因为自动化驱动的正是有人看着的那个面板，只有面板在屏幕上这件事才可见；工具栏会报告进行中的命令，直到它落定。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 插件主体：字典、tab 类型、键控座位与每次 apply 一次的桥读取 |
| [`src/client/definition.tsx`](src/client/definition.tsx) | `browser` tab 类型定义及其引导页条目 |
| [`src/client/BrowserPanel.tsx`](src/client/BrowserPanel.tsx) | 工具栏、地址栏、边界推送、状态订阅与仅桌面端提示 |
| [`src/client/bridge.ts`](src/client/bridge.ts) | 结构化命名的 `window.dshDesktop.browser` 面、布局 offset 与矩形到边界的取整，以及 URL 归一化 |
| [`src/client/BrowserTabBody.tsx`](src/client/BrowserTabBody.tsx)、[`BrowserTitle.tsx`](src/client/BrowserTitle.tsx) | 座位适配器：把注入的桥送入面板；chip 标题前的地球标记 |
| [`src/client/locales.ts`](src/client/locales.ts) | `browser-panel` zh/en 字典；中文键集是权威来源 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-sidebar-right](../ui-sidebar-right/README.zh.md)——本包注册进入的 tab 注册表、键控座位与导航控制器。
- [ui-sidebar-browser](../ui-sidebar-browser/README.zh.md)——当前 Desktop profile 挂载的共享浏览器面板；旧面板保留源码，但不再挂载。

-----

<a id="model-experience"></a>
## 模型体验

无，因为面板只经 preload 桥驱动桌面端视图；任何动词都不进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

不发布 invariant 伴生包：面板不保留跨入口状态；视图驻留在桌面主进程，面板只经 preload 桥转发测量与意图。

- 交付的 Desktop 不挂载本包，其 guest 桥也不实现本包要求的 WebContentsView 操作。
- 纯 Web 宿主只显示提示，无法浏览。
- 每个应用窗口只有一个视图实例：第二个浏览器标签复用同一视图，隐藏标签保持其存活；视图及其浏览状态仅随窗口销毁。
- 位置依赖渲染进程测量并经 IPC 推送；侧边栏动画期间原生视图可能比 DOM 布局慢一帧。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
