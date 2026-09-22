---
description: "右侧栏仓库环境标签页：只读展示会话工作区的分支、上游领先/落后、变更合计、主机名与远程来源，数据来自 gui-repo Remote 命名空间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-repo-panel

[English](README.md) | 中文

## 概述

使用本包可在右侧栏展示会话的仓库环境。`repo` 标签为每个会话渲染一张只读卡片：当前分支及相对已配置上游的领先/落后分歧、相对 HEAD 的工作区变更合计（`+X -Y · N 个文件`，未跟踪文件计入 N）、服务主机名，以及仓库的远程来源。数据通过 `ctx.remote.guiRepo.status` 按会话工作区根读取，面板打开期间每四秒重新轮询；手动刷新立即读取。按产品决策，面板不执行任何写操作——没有提交、推送或检出。

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

把本包作为 web-app bundle 的一个浏览器条目发布；随附组合已经插入它。该标签随后以**仓库环境**条目出现在右侧栏引导页中，并像其他页类型一样经 `ctx.sidebarRight.openTab('repo')` 打开。卡片检查 sessions mirror 为当前会话携带的工作区根；mirror 尚不知道该根时，Host 回退到服务器的工作目录。

### 何时选择

把它作为会话旁边的环境只读上下文，展示会话工作区的状态——分支、分歧、待处理变更、远端——时选择它。当用户需要对仓库执行操作时避免它：staging、提交与推送被刻意省略，agent 的 bash 工具仍是唯一的修改路径。客户端插件等待 `remote.guiRepo` 命名空间，因此 Host 上没有 [`@deepseek-ai/dsh-api-gui-repo`](../../api/gui-repo/README.zh.md) 的组合永远不会注册该标签。

### 最小配置

在 Sidebar 栈旁边添加一个浏览器条目；web-app bundle 已经携带它：

```yaml
- name: '@deepseek-ai/dsh-client-ui-repo-panel'
```

本包没有配置字段。它需要右侧栏 tab 注册表（`sidebarRightTabs`）、键控的 `sidebar.right.pane.tab` 与 `sidebar.right.pane.tab.title` 座位、locale 服务，以及 `guiRepo` Remote 命名空间。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

插件主体在 effect 下注册四样东西：`repo-panel` locale 字典、`repo` tab 类型（id `@deepseek-ai/dsh-client-ui-repo-panel`、band `builtin`、引导序 30、不认领地址）、键控 `sidebar.right.pane.tab` 座位下的面板主体，以及 `sidebar.right.pane.tab.title` 下的 chip 标题。主体从 sessions mirror 读取会话的 `cwd` 并交给一个轮询循环：挂载时立即 `status` 读取、固定 4 秒间隔刷新，以及手动刷新按钮。读取失败追加本地化错误行，行区保留最近一次成功快照；位于任何工作树之外的目录渲染「非仓库」状态而不是行区。分歧渲染 Host 报告的 `ahead`/`behind` 中在场的部分；未配置上游时整体省略。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 插件主体：字典、tab 类型、键控座位与 `guiRepo` 线上面 |
| [`src/client/definition.tsx`](src/client/definition.tsx) | `repo` tab 类型定义及其引导页条目 |
| [`src/client/RepoPanel.tsx`](src/client/RepoPanel.tsx) | 环境卡片：轮询循环、刷新、行区、错误与非仓库状态 |
| [`src/client/RepoTabBody.tsx`](src/client/RepoTabBody.tsx)、[`RepoTitle.tsx`](src/client/RepoTitle.tsx) | 座位适配器：把会话工作区根送入卡片；chip 标题前的分支标记 |
| [`src/client/locales.ts`](src/client/locales.ts) | `repo-panel` zh/en 字典；中文键集是权威来源 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-sidebar-right](../ui-sidebar-right/README.zh.md)——本包注册进入的 tab 注册表、键控座位与导航控制器。
- [gui-repo](../../api/gui-repo/README.zh.md)——收集卡片渲染的每一项事实的 Host 命名空间。
- [Remote 装配](../../api/remotes/README.zh.md)——`ctx.remote.guiRepo` 如何到达浏览器。

-----

<a id="model-experience"></a>
## 模型体验

无，因为面板只读取 `guiRepo` Remote 命名空间；任何动词都不进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

不发布 invariant 伴生包：面板不保留跨入口状态；所有事实按挂载与轮询即时获取，座位生命周期由本包的规格断言。

- 四秒轮询、无推送通道：分歧与变更合计最多滞后实际工作树一次轮询。
- 变更合计只统计已跟踪文件（`git diff --numstat HEAD`）；未跟踪文件只增加文件数，不贡献 `+`/`-` 行数。
- 未配置上游时整行省略领先/落后，而不是显示为零。
- 按产品决策只读：staging、提交与推送在这里没有界面，仍留在 agent 的 bash 工具中。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
