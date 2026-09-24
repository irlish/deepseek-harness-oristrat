---
description: "Oristrat MSCE 开发规范以模式作用域的 system-prompt 分节注入，由官方插件动态配置控制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-context-oristrat-msce-norms

[English](README.md) | 中文

## 概述

使用本包可让 Oristrat MSCE 引擎开发规范在本 fork 部署中成为 prompt 原生内容。每个 agent 的 system prompt 都携带一个精简分节——组件边界、View import 与 Less/I18n 纪律、工程注释评审、与提交耦合的门禁，以及验证分级——代码工作无需调用 `msce-engine-app-development` skill 即遵循其规范内核。官方插件设置表单持有 `oristrat-msce-norms.mode`（默认 `coding`）。`work` 模式下分节不贡献文本，配对的 `dsh-guard-msce-gate` 对每个分派直接放行。没有 settings 服务时，守卫失败关闭为 `coding`。

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

在 agent 开发 Oristrat MSCE 引擎应用的组合中挂载本插件；`dsh-base` bundle 已携带该条目。部署模式为 `coding` 期间，规范随即治理每个组装的 system prompt。随附客户端侧边栏的工作模式 chip 修改官方插件动态配置，分节在每次 prompt 组装时读取当前值，因此切换从下一个请求起生效，无需重启。

### 何时选择

为 agent 开发 Oristrat MSCE 引擎应用、且应原生携带该纪律而非按 skill 调用携带的部署选择它。通用部署请避免它：`coding` 模式下该分节是无条件 prompt 文本，其规则点名 MSCE 概念——Brick/Layer/Virtual 边界、DSL/Env 同步、提交门禁——在该生态之外毫无意义。完整清单保留在已安装的 `msce-engine-app-development` skill 中；本分节是带指针的精简常开内核。

### 最小配置

以默认 `coding` 模式挂载本插件：

```yaml
- name: '@deepseek-ai/dsh-context-oristrat-msce-norms'
```

`mode` 配置字段接受 `coding` 或 `work`，属于动态配置，官方设置表单可在 Host 运行时修改。插件注入 `systemPrompt` 注册表；配对守卫通过 settings 服务读取当前模式，服务缺失时强制按 `coding` 处理。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

一个名为 `context:oristrat-msce-norms` 的 `ctx.systemPrompt.section` 注册位于注册表的 `ORISTRAT_MSCE_NORMS` 顺序槽，其文本提供方读取动态 `mode` 配置值。`work` 模式下提供方返回空字符串，prompt 组装把该分节整个过滤掉，不贡献 token。规范文本本身是一个导出常量；两个模式消费方——本分节与 [`dsh-guard-msce-gate`](../../guard/msce-gate/README.zh.md)——读取同一官方插件配置，因此一个开关同时解除两半。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：动态 `mode` 配置与分节注册 |
| [`src/norms.ts`](src/norms.ts) | `MSCE_NORMS_PROMPT`：分节的完整静态文本 |
| [`tests/mode.spec.ts`](tests/mode.spec.ts) | 模式规格：coding、work 与失败关闭的分节文本 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [msce-gate](../../guard/msce-gate/README.zh.md)——读取同一模式的配对硬门禁。
- [system-prompt 注册表](../../core/system-prompt/README.zh.md)——分节接缝及其排序。
- [settings 能力](../../settings/settings/README.zh.md)——官方插件配置表单，以及服务缺席时如何失败关闭。
- [context 组地图](../README.zh.md)——同组请求上下文包。

-----

<a id="model-experience"></a>
## 模型体验

### 模式作用域的规范 system prompt 分节

#### 模型看到什么

部署模式为 `coding` 期间，每个组装的 system prompt 都在 `ORISTRAT_MSCE_NORMS` 顺序槽逐字包含下方分节；`work` 模式下提供方返回空文本，组装把该分节过滤掉。不添加任何工具 schema、prompt 变量或会话事件。

##### 规范分节文本

```markdown
# Oristrat MSCE 开发规范（常驻）

本 agent 是 Oristrat AI 平台的专属开发 agent。以下规范对所有客户端/应用代码工作天然生效，无需用户或模型主动调用；优先级低于用户当次指令与工作区自身的 AGENTS.md / HARNESS.md。

## 适用范围与识别

工作区出现任一标记即按 MSCE（MortiseSpecCodeEngine）项目执行：存在 HARNESS.md 或 FRAMEWORK.md；存在 msce 命名的配置、DSL/Workflow/Env 注册文件；代码呈现 Brick / Layer / Virtual / Component / Logic / Workflow 结构；或用户声明项目属于 Oristrat / MSCE 体系。无标记的普通仓库仍应借鉴下列工程纪律（注释、验证分类、提交门禁精神）。

## Harness-Aware Discovery（动手前）

1. 项目 HARNESS.md 定义 MSCE loader 时，先让 loader 决定需要读取、审查还是组件目录遍历；按其响应措辞执行，不预先宣布状态。
2. 只加载 loader 点名的章节；缓存章节有效时不重读整份 FRAMEWORK.md / HARNESS.md。
3. 无 loader 时，编辑前读 AGENTS.md、HARNESS.md、相关 FRAMEWORK.md 章节与最接近的现有示例。
4. 目标组件、任务类型或 harness 文件变化时重新 discovery。

## 组件边界（Core Boundaries）

- Brick/Layer/Virtual：只保留 MSCE 挂载、代理生命周期、state/action 桥接与子装配。
- Component：只做 React 渲染与交互；DB/网络操作一律走 Logic。
- Logic：持有 API 与业务编排；禁止 View 猜测服务端契约。
- Workflow：以 DSL name 作为收发方，事件字符串用常量。
- DSL/Env：View、Logic、Workflow、ActionKeys、StateKeys、shell 顺序、导航与注册保持同步。
- View 导入：仅本 View 的 action/state/data/less/view；禁止导入其他 View 的 UI 或 Less。
- Less：组件前缀全 kebab-case；避免 _、BEM --、var(--...)，除非当前 harness 明确改规。
- I18n：可见文案、placeholder、aria label、按钮、页签、空/错误态、标题全部走项目语言文件。

## 工程注释与评审

- 新写或实质修改的 MSCE Web 代码：实现前读 skill references/code-commenting.md，实现后执行 MSCE_COMMENT_REVIEW；所有权、权威来源、事件/数据契约、生命周期、不变量、并发、注册、失败风险与不显而易见的布局行为都是必备注释；低价值逐行叙述不算通过。
- View 变更追加 view-commenting.md 的 ENTRY/React 状态/私有组件/可访问性/JSX/Less 职责与 VIEW_COMMENT_REVIEW。
- 陈旧、误导、无支撑注释在同一次变更中修复或删除。

## 提交耦合门禁（不可跳过）

1. Git 轮次开启前验证候选工作树范围：记录受影响组件、路径、Harness 章节、示例、命令、退出码与基线分类。
2. 完成所需 comment review 后，仅当无 NEW_REGRESSION、无必需 NOT_TESTED、无未决 staged 依赖、无 review 失败时输出 MSCE_SUBMISSION_GATE: PASS；否则 FAIL / NOT_TESTED 并阻断 Git 交接。
3. 本规范与 skill 不授权执行 git add/commit/push。
4. 任何代码编辑、partial-stage 不一致、依赖/注册变化、生成文件变化或 scope 扩大都使 PASS 失效并重跑。

## 验证节奏与分类

- 定向变更：lint 变更文件；类型或契约变化时跑 TypeScript。
- 路由、schema、包、Env、DSL、注册或大面积 UI 变更：lint/type 后跑 build。
- 每个长检查独立退出码、耗时与日志；wrapper 超时无子输出记 NOT_TESTED。
- 分类只用 TARGET_PASS / REPO_PASS / PARTIAL / NOT_TESTED；全仓失败可能是历史基线，需证明归属不得按文件范围臆断。
- 门禁脚本为 PowerShell：非 Windows 主机用等价本地命令完成同一验证并记录；无法等价执行时如实 NOT_TESTED，禁止伪造 PASS。

## 计划模式与技术规划（Plan / Spec / PRD）

处于计划模式或产出任何技术方案、spec、PRD、路线图时，计划本身必须基于 MSCE 引擎进行技术规划，禁止脱离引擎自由设计：

1. 组件拆解映射到 Brick / Layer / Virtual / Component / Logic / Workflow 边界，并声明每个新组件的归属与禁止事项（View 不猜服务端契约、Component 不碰 DB/网络等）。
2. 列出 DSL / Env / ActionKeys / StateKeys / 注册 / 导航 / shell 顺序的同步计划与影响面。
3. 给出 i18n 与 Less 命名策略（组件前缀 kebab-case、文案入语言文件）。
4. 内嵌质量计划：MSCE_COMMENT_REVIEW / VIEW_COMMENT_REVIEW 的执行点、staged-scope 审计、验证命令与基线分类预期（TARGET_PASS / REPO_PASS / PARTIAL / NOT_TESTED）。
5. 标明 Harness 章节依据（HARNESS.md / FRAMEWORK.md 的哪些章节约束本计划）与将参考的现有示例；无 loader 时先补 discovery 再出计划。
6. 交付型计划追加提交耦合门禁步骤：候选范围验证 → review → MSCE_SUBMISSION_GATE 结论 → 授权后 staged 审计。

## 深度参考

完整 checklist、示例地图与 staged-scope 审计脚本在已安装 skill `msce-engine-app-development`（及 oristrat-product-ui-governor / fullstack-delivery-orchestration / product-testing）；本段已含强制核心，深度细节按需加载，不构成前置条件。
```

#### Token 影响

`coding` 模式下每请求一笔固定 prompt 前缀开销——静态分节约 5 KB UTF-8 文本——`work` 模式下为零 token。分节按请求重新组装而非保留，因此从不累积；深度清单保留在已安装的 skill 中，仅按需加载。

#### KV Cache 影响

模式保持期间分节前缀稳定：相同字节在相同位置跨请求保留复用。切换 `oristrat-msce-norms.mode` 把分节文本替换为空字符串或换回，编辑 `src/norms.ts` 则一次改变所有会话的分节；两者都会使自该分节位置起的前缀复用失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

不发布 invariant 伴生包：本包只贡献静态规范文本，不持有任何可变关系，不存在可与之分叉的独立观测。

- 规范是建议性 prompt 文本：超出模型遵从性的强制——在评审通过前阻止代码工具——需要 loop 级守卫，[`dsh-guard-msce-gate`](../../guard/msce-gate/README.zh.md) 为其监视的两个转变提供这种强制。
- skill 引用的 PowerShell 门禁脚本没有原生的非 Windows 等价物；该分节转而要求诚实的 NOT_TESTED 报告。
- `coding` 模式下分节是无条件的：没有按会话或按工作区的作用域，因此 `coding` 部署中的非 MSCE 工作仍携带规范文本。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
