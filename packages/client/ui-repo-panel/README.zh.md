---
description: "会话头部仓库环境菜单：展示会话工作区的分支、上游领先/落后、变更合计、主机名与远程来源，并支持本地分支切换，数据来自 gui-repo Remote 命名空间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-repo-panel

[English](README.md) | 中文

## 概述

使用本包可在会话头部展示会话的仓库环境。触发按钮为每个会话打开一个气泡菜单：当前分支及上游领先/落后、相对 HEAD 的工作区变更合计（`+X -Y · N 个文件`，未跟踪计入 N）、主机名与远程来源。分支行的子菜单在搜索过滤后列出本地分支，检出所选分支，并支持从草稿创建并检出新分支。数据经 `ctx.remote.guiRepo` 到达，打开期间每四秒重新轮询。按产品决策，提交与推送仍然缺席。

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

把本包作为 web-app bundle 的一个浏览器条目发布；随附组合已经插入它。触发按钮随后渲染在每个会话头部的工具簇中、会话菜单按钮旁边，点击即打开气泡菜单。菜单检查 sessions mirror 为当前会话携带的工作区根；mirror 尚不知道该根时，Host 回退到服务器的工作目录。

### 何时选择

把它作为会话旁边的环境上下文，展示会话工作区的状态——分支、分歧、待处理变更、远端——并允许不离开对话就切换分支时，选择它。当用户需要发布历史时避免它：staging、提交与推送被刻意省略，agent 的 bash 工具仍是唯一的发布路径。客户端插件等待 `remote.guiRepo` 命名空间，因此 Host 上没有 [`@deepseek-ai/dsh-api-gui-repo`](../../api/gui-repo/README.zh.md) 的组合永远不会注册该菜单。

### 最小配置

在头部栈旁边添加一个浏览器条目；web-app bundle 已经携带它：

```yaml
- name: '@deepseek-ai/dsh-client-ui-repo-panel'
```

本包没有配置字段。它需要 `conversation.session.header.utilities` 座位、locale 服务，以及 `guiRepo` Remote 命名空间。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

插件主体在 effect 下注册两样东西：`repo-panel` locale 字典，以及一个 `conversation.session.header.utilities` 条目（id `repo-env`、order 0）。动作组件从 sessions mirror 读取会话的 `cwd`，并在打开期间运行一个轮询循环：立即 `status` 读取、固定 4 秒间隔刷新，以及——在分支子菜单打开期间——对 `branches` 采用相同节奏。读取失败保留加载提示；没有工作区的会话与位于任何工作树之外的目录渲染各自的提示而不是行区。子菜单按子串过滤列表，用选中的单选行标记当前分支，把点选经 `checkout`（`git switch`）路由、把草稿表单经 `createBranch`（`git switch --create`）路由；被拒绝的变更在子菜单内显示 git 自己的消息。Escape 与外部指针按下关闭气泡。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 插件主体：字典与携带 `guiRepo` 线上面的头部工具条目 |
| [`src/client/RepoEnvAction.tsx`](src/client/RepoEnvAction.tsx) | 触发按钮、气泡、环境行、分支子菜单、轮询循环与变更处理器 |
| [`src/client/glyphs.tsx`](src/client/glyphs.tsx) | 以 currentColor 绘制的分支字形，用于触发按钮与分支行 |
| [`src/client/locales.ts`](src/client/locales.ts) | `repo-panel` zh/en 字典；中文键集是权威来源 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-conversation](../ui-conversation/README.zh.md)——本包注册进入的会话头部及其工具座位。
- [gui-repo](../../api/gui-repo/README.zh.md)——收集菜单渲染的每一项事实并执行其分支动词的 Host 命名空间。
- [Remote 装配](../../api/remotes/README.zh.md)——`ctx.remote.guiRepo` 如何到达浏览器。

-----

<a id="model-experience"></a>
## 模型体验

无，因为菜单只通过 `guiRepo` Remote 命名空间读取与切换分支；任何动词都不进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

不发布 invariant 伴生包：菜单不保留跨入口状态；所有事实按打开与轮询即时获取，座位生命周期由本包的规格断言。

- 四秒轮询、无推送通道：分歧与变更合计最多滞后实际工作树一次轮询。
- 变更合计只统计已跟踪文件（`git diff --numstat HEAD`）；未跟踪文件只增加文件数，不贡献 `+`/`-` 行数。
- 未配置上游时整行省略领先/落后，而不是显示为零。
- 按产品决策不发布历史：staging、提交与推送在这里没有界面，仍留在 agent 的 bash 工具中；分支切换是菜单唯一的修改操作。
- 分支子菜单只列出本地分支；远程跟踪引用既不列出也不抓取。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
