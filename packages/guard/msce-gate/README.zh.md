---
description: "工具执行瀑布上的硬性 Oristrat MSCE 门禁：MSCE 工作区与 coding 设置模式内，代码变更前要求发现证据，git 交接前要求提交门禁 PASS。"
kind: "package-reference"
---

# @deepseek-ai/dsh-guard-msce-gate

[English](README.md) | 中文

## 概述

使用本包可把规范分节以文字陈述的两条 Oristrat MSCE 规则变为物理强制。在 MSCE 工作区——根目录携带 HARNESS.md、FRAMEWORK.md 或 msce/Brick 系条目——内包装 `tools/execute`：会话没有 Harness-Aware Discovery 证据时阻止 `write`/`edit`；晚于最后一次代码修改的 `MSCE_SUBMISSION_GATE: PASS` 标记出现前阻止 `bash` git add/commit/push。被阻止的调用返回指名缺失前置条件的结构化 tool error，让模型修复自身流程而不是停摆。非 MSCE 工作区与所有其他工具原样放行，整个守卫在 `oristrat` 设置的 `work` 模式下解除。

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

在同时携带 [`@deepseek-ai/dsh-context-oristrat-msce-norms`](../../context/oristrat-msce-norms/README.zh.md) 的部署中，把守卫与 tools 运行时一起挂载；`dsh-base` bundle 已携带两个条目。两道门禁随即适用于每个会话工作区根携带 MSCE 标记——HARNESS.md、FRAMEWORK.md 或 msce/Brick 系条目——的 agent，无需更多配置。

### 何时选择

当 MSCE 流程规则必须在模型跳过它们时也成立，选择它：仅靠 prompt 文本无法阻止 discovery 之前的 `write` 或提交门禁之前的 `git commit`。在 Oristrat MSCE 部署之外避免它——拒绝文案是 MSCE 专用中文文本——也不要把整份纪律押在它身上：它强制两个转变，其余由规范分节解释。本守卫只执行强制，从不自带 prompt 或 schema 文本。

### 最小配置

以无配置挂载本插件：

```yaml
- name: '@deepseek-ai/dsh-guard-msce-gate'
```

本插件没有配置字段。它注入 `tools` 运行时，并在存在 settings 服务时经 `ctx.get('settings')` 读取 `oristrat` 命名空间；settings 服务缺失或不可读时失败关闭为 `coding` 强制。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

一个 `tools/execute` 监听器承载两道门禁。每次分派先读模式——`work` 让每个调用不经检查通过——随后解析会话工作区根并探测 MSCE 标记；没有工作区的会话或没有标记的工作区直接放行。证据是序列化的会话事件列表：discovery 是任何同时点名读取类工具（`read`、`glob`、`grep` 或 `skill`）与 HARNESS.md、FRAMEWORK.md、AGENTS.md 或 `msce-engine-app-development` skill 的事件文本；提交门禁把最近的 `MSCE_SUBMISSION_GATE: PASS` 出现位置与最近的代码变更（`write`/`edit`）事件排序，拒绝标记未晚于的 git add/commit/push。拒绝把分派替换为结构化错误结果——`isError: true`、名称 `MsceGateError`、代码 `MSCE_GATE`——其文本指名缺失前置条件与修复步骤；被阻止的调用永不到达瀑布的 `next()`。标记检测是同步文件系统探测：两个文件用 `existsSync`，条目形态用一次 `readdirSync`；不可读的根按非 MSCE 处理。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件本体：标记检测、模式作用域、证据扫描与两种拒绝 |
| [`tests/mode.spec.ts`](tests/mode.spec.ts) | 规格：每条通过/拒绝路径与工作模式及失败关闭作用域 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [oristrat-msce-norms](../../context/oristrat-msce-norms/README.zh.md)——prompt 原生的另一半，也是本守卫读取的 `oristrat` 模式的属主。
- [工具子系统参考](../../../docs/subsystems/tools.zh.md)——本守卫包装的 `tools/execute` 瀑布。
- [timeout-policy](../timeout-policy/README.zh.md)——同为条件工具结果形态的兄弟守卫。
- [guard 组地图](../README.zh.md)——同组守卫包与 loop 卫生家族。

-----

<a id="model-experience"></a>
## 模型体验

### 条件工具结果

#### 模型看到什么

无 prompt、schema 或 session-log 变化：守卫只拒绝分派。被阻止的调用返回普通 tool error 结果，其文本为 `Error: ` 加下方两条拒绝消息之一，并伴随结构化 `MsceGateError`（代码 `MSCE_GATE`）；通过的调用不受影响。

##### 发现门禁拒绝

```markdown
Error: MSCE 门禁阻断：MSCE 工作区内修改代码前必须完成 Harness-Aware Discovery。请先 read/glob 本项目的 HARNESS.md / FRAMEWORK.md / AGENTS.md（或加载 skill msce-engine-app-development），让 loader 或示例决定读取范围后再重试本次写入。
```

##### 提交门禁拒绝

```markdown
Error: MSCE 门禁阻断：git add/commit/push 需要先有晚于最后一次代码修改的 MSCE_SUBMISSION_GATE: PASS。请先完成候选范围验证与 MSCE_COMMENT_REVIEW（View 另加 VIEW_COMMENT_REVIEW），在回复中输出 PASS 结论后重试。
```

#### Token 影响

通过的分派零 token。一次拒绝追加一条保留的 tool-error 结果并替换本应产生的工具输出；模型的修复尝试产生它们自己的普通轮次。

#### KV Cache 影响

追加式；新可见内容跟随可复用请求前缀，不使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

不发布 invariant 伴生包：该门禁是无留存状态的纯请求级检查，其规格直接断言每条通过/拒绝路径。

- 证据扫描读取序列化的会话事件；经由未监视工具执行的变更会绕过门禁，直到该工具被加入 `MUTATION_TOOLS`。
- PASS 标记是模型撰写的文本；守卫把它排在变更之后，但无法验证其背后评审的质量。
- 标记检测只探测工作区根；未标记仓库内的 MSCE 子树让两道门禁都保持关闭。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
