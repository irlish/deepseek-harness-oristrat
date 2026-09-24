---
description: "右侧栏内嵌浏览器标签页：工具栏加测量 surface，驱动桌面主进程的 WebContentsView；仅桌面端可用，其他环境显示提示。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-browser-panel

[English](README.md) | 中文

## 概述

使用本包可在桌面应用的右侧栏内浏览网页。`browser` 标签把主进程的 `WebContentsView` 覆盖到其 surface 元素上，并通过 `window.dshDesktop.browser` 桥驱动它：后退、前进、刷新，以及归一化为 http(s)、以回车提交的地址栏导航。边界经元素的 offset 链测量，并在元素 resize、捕获阶段滚动、窗口 resize 与挂载后的落定推送时重新推送。卸载隐藏视图；下一次挂载重新附着同一实例，文档与历史跨标签切换保留。在没有该桥的纯 Web 宿主上，面板渲染仅桌面端可用的提示。

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

把本包作为 web-app bundle 的一个浏览器条目发布；随附组合已经插入它。该标签以**内嵌浏览器**条目出现在右侧栏引导页中，并经 `ctx.sidebarRight.openTab('browser')` 打开。在桌面应用中，面板挂载时附着内嵌视图，卸载时隐藏它；此后由工具栏与地址栏驱动导航，地址表单以回车提交——工具栏不再有提交按钮。

### 何时选择

当桌面用户需要在会话旁边快速就地阅读网页——文档、参考资料、预览——而不离开窗口时选择它。在纯 Web 宿主上避免它，那里面板只能显示仅桌面端可用的提示；当浏览状态必须跨应用退出保留时也避免它：隐藏标签会保留视图及其文档、Cookie 与历史，但视图随窗口一同销毁。内嵌视图归桌面端所有；本包的浏览器半边只负责测量与驱动它。

### 最小配置

在 Sidebar 栈旁边添加一个浏览器条目；web-app bundle 已经携带它：

```yaml
- name: '@deepseek-ai/dsh-client-ui-browser-panel'
```

本包没有配置字段。它需要右侧栏 tab 注册表（`sidebarRightTabs`）、键控的 `sidebar.right.pane.tab` 与 `sidebar.right.pane.tab.title` 座位，以及 locale 服务；桌面桥经 `window.dshDesktop.browser` 到达，由桌面应用的 preload 脚本安装。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

插件主体注册 `browser-panel` locale 字典、`browser` tab 类型（id `@deepseek-ai/dsh-client-ui-browser-panel`、band `builtin`、引导序 40、不认领地址）、面板主体与 chip 标题，并在每次 apply 读取一次桌面桥：纯 Web 宿主上桥为 `undefined`，主体渲染本地化的仅桌面端提示。有桥时，主体订阅导航状态（`url`、`title`、`canGoBack`、`canGoForward`、`loading`），把视图开到 surface 的布局盒上——由元素的 `offsetLeft`/`offsetTop` 链求和得到，该布局在祖先 transform 动画期间即为最终值——并由元素上的 `ResizeObserver`、捕获阶段 `scroll`、窗口 `resize` 与挂载后 300ms 的落定计时器重新推送取整后的边界；卸载时取消订阅并隐藏视图。下一次挂载经幂等的 open 动词重新附着同一视图，因此文档、Cookie 与历史跨每次标签切换保留，无需重新加载。地址栏在导航前归一化输入：含空白的文本被拒绝，裸主机名补 `https://` 前缀，只有可解析的 http(s) URL 才会导航。主进程属主在每个应用窗口上维持一个视图，使用持久分区 `persist:dsh-embedded-browser`，钳制渲染进程提供的边界，拒绝弹出窗口，并把每次导航限制在 http(s)。

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

- 仅桌面端可用：纯 Web 宿主只显示提示，无法浏览。
- 每个应用窗口只有一个视图实例：第二个浏览器标签复用同一视图，隐藏标签保持其存活；视图及其浏览状态仅随窗口销毁。
- 位置依赖渲染进程测量并经 IPC 推送；侧边栏动画期间原生视图可能比 DOM 布局慢一帧。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
