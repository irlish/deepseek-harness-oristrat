---
description: "只读仓库环境 Remote BFF：通过一次性本地 git 调用暴露分支、上游分歧、工作区变更总量、远端来源与服务主机名。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-gui-repo

[English](README.md) | 中文

## 概述

使用本包可为 Web GUI 提供一个目录 git 环境的只读视图。唯一的 `status` 动词快照工作树根、分支、相对已配置上游的领先/落后、增删行总量与变更及未跟踪文件数、服务机器的主机名，以及去重后的远端列表——全部通过 `ctx.subprocess` 的一次性本地 `git` 调用完成。所有命令均不触网，凭据提示被禁止，每次调用受 8 秒墙钟约束，spawn 失败或超时按缺失事实处理，而不是向调用方抛错。

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

把控制器与 Typert Gateway 及 subprocess 提供方一起挂载在 Host 侧；`dsh-web-app` bundle 已为随附组合插入该条目。浏览器客户端调用 `ctx.remote.guiRepo.status({ cwd })`——`cwd` 是要检查的绝对目录，缺省为服务器进程的工作目录——并得到一份 `GuiRepoStatusValue` 快照。

| 字段 | 含义 |
|---|---|
| `repo` | 在 `cwd` 处或其上方是否找到 git 工作树 |
| `root` | 绝对工作树根；`repo` 为 false 时缺席 |
| `branch` | 当前分支名，分离头指针时为短 HEAD sha，尚无提交时为 unborn 分支名 |
| `ahead` / `behind` | HEAD 上尚未到上游的提交数，以及上游上尚未到 HEAD 的提交数；未配置上游时两者均缺席 |
| `additions` / `deletions` | `git diff --numstat HEAD` 全量的增/删行数；二进制条目不计行数 |
| `files` | 已跟踪的变更文件数加上未跟踪且未忽略的文件数 |
| `host` | 服务本次请求的主机名；始终在场 |
| `sources` | 已配置的 git 远端，按名称与 URL 去重 |

### 何时选择

当浏览器界面需要报告一个目录的仓库状态——分支、分歧、待处理变更、远端——而不做任何修改时选择它。当界面需要历史、blame、staging 或任何写操作时避免它：按产品决策该命名空间只有一个动词，而面向模型的 agent 已经通过其 bash 工具触达 git。[`@deepseek-ai/dsh-client-ui-repo-panel`](../../client/ui-repo-panel/README.zh.md) 是随附消费方。

### 最小配置

在提供 `typert`（网关）与 `subprocess` 的 Host 上以无配置挂载本服务：

```yaml
- name: '@deepseek-ai/dsh-api-gui-repo'
```

本服务没有配置字段。Typert 生成经 `./typert` 与 `./remote` 暴露的 Host 与 Client Remote 产物；[`@deepseek-ai/dsh-api-remotes`](../remotes/README.zh.md) 把 client 产物聚合进 `ctx.remote.guiRepo`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

`GuiRepoController` 在命名空间 `guiRepo` 下扩展 `TypertRemoteService`；`@Remote('status')` 方法就是全部表面。一次 `status` 调用先用 `git rev-parse --show-toplevel` 解析工作树根；失败立即返回 `{ repo: false, host, sources: [] }`。工作树内五个调用并发执行：分支（`rev-parse --abbrev-ref HEAD`，unborn 分支回退到 `symbolic-ref --short HEAD`，分离头指针回退到短 sha）、上游分歧（`rev-list --left-right --count @{upstream}...HEAD`）、已跟踪变更总量（`diff --numstat HEAD`，由 `parseNumstat` 汇总）、未跟踪文件（`ls-files --others --exclude-standard`，计数）与远端（`remote -v`，由 `parseRemotes` 去重）。每次调用都经同一个私有 `runGit` 辅助：`ctx.subprocess.spawn` 携带 `GIT_TERMINAL_PROMPT=0`、忽略 stdin、两路输出流在 1 MiB 上限内收集、1 秒终止宽限与 8 秒中止定时器。spawn 失败、超时与非零退出都按「无答案」处理——调用方按退出码分支，绝不依赖异常——单项事实失败降级为缺席字段，而不是让整个快照失败。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `GuiRepoController`：`guiRepo` 命名空间、`status` 动词、`runGit`、`parseNumstat`、`parseRemotes` |
| [`src/types.ts`](src/types.ts) | 线路类型 `GuiRepoStatusRequest`、`GuiRepoStatusValue`、`GuiRepoSource`，以 `./types` 发布给 Client 包 |
| [`tests/gui-repo.host.spec.ts`](tests/gui-repo.host.spec.ts) | Host 规格：快照组合、numstat/remote 解析、失败降级 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-repo-panel](../../client/ui-repo-panel/README.zh.md)——本命名空间服务的浏览器面板。
- [Remote 装配](../remotes/README.zh.md)——Client 包如何触达 `guiRepo` 命名空间。
- [Subprocess 能力](../../subprocess/subprocess/README.zh.md)——每次 git 调用经由的 `ctx.subprocess.spawn` 契约。
- [Typert 协议](../../typert/protocol/README.zh.md)——`TypertRemoteService` 与 `@Remote` 动词装饰器。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该命名空间只服务浏览器仓库环境面板；任何动词都不进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

不发布 invariant 伴生包：每次请求都由本地 git 调用即时重新推导，调用之间不保留可变事实，不存在可与之分叉的独立观测。

- 客户端轮询 `status`；没有推送流或文件系统监视动词，因此变更最多延迟一个轮询间隔才到达面板。
- 行总量只统计相对 HEAD 的已跟踪变更；未跟踪文件计入文件数，但不计入增删行总量。
- 任何已认证的浏览器客户端都可以检查宿主用户可读的任意目录，与 Web GUI 面向 agent 的 bash 工具同一信任级；没有按用户的路径策略。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
