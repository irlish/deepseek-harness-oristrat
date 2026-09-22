---
description: "Always-on Oristrat MSCE engine development norms as a mode-scoped system-prompt section, plus the oristrat settings namespace (mode: coding | work) that lifts the norms and the paired hard gate."
kind: "package-reference"
---

# @deepseek-ai/dsh-context-oristrat-msce-norms

English | [中文](README.zh.md)

## Summary

Use this package to make the Oristrat MSCE engine development norms prompt-native in this fork's deployments. Every agent's system prompt carries one condensed section — component boundaries, View import and Less/I18n discipline, engineering comment reviews, the submission-coupled gate, and validation classifications — so code work follows the `msce-engine-app-development` skill's normative core without invoking it. The plugin owns the `oristrat` settings namespace (`mode: coding | work`, default `coding`): in `work` mode the section contributes no text and the paired `dsh-guard-msce-gate` passes every dispatch through. Without a settings service the mode fails closed to `coding`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a composition whose agents develop Oristrat MSCE engine applications; the `dsh-base` bundle already carries the row. The norms then govern every assembled system prompt while the deployment mode is `coding`. The mode is a user-facing setting: the shipped client's sidebar work-mode chip writes `oristrat.mode`, and the section's text provider re-reads it at each prompt assembly, so a switch takes effect from the next request without a restart.

### When to choose it

Choose it for deployments whose agents develop Oristrat MSCE engine applications and should carry the discipline natively rather than per skill invocation. Avoid it in general-purpose deployments: the section is unconditional prompt text in `coding` mode, and its rules name MSCE concepts — Brick/Layer/Virtual boundaries, DSL/Env synchronization, the submission gate — that mean nothing outside that ecosystem. The full checklists stay in the installed `msce-engine-app-development` skill; this section is the condensed always-on core with pointers into it.

### Minimal configuration

Mount the plugin with no configuration:

```yaml
- name: '@deepseek-ai/dsh-context-oristrat-msce-norms'
```

The plugin has no configuration fields. It injects the `systemPrompt` registry and attaches to a `settings` service when one exists; without one, the mode reads as `coding` and the norms stay enforced.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One `ctx.systemPrompt.section` registration named `context:oristrat-msce-norms` sits at the registry's `ORISTRAT_MSCE_NORMS` order slot, and its text provider closes over a mode reader. The reader defaults to the constant `coding`; when a `settings` service exists, a nested `ctx.inject(['settings'], ...)` registers the `oristrat` namespace — a schemastery object with a `mode` union of `coding`/`work` defaulting to `coding` — and rebinds the reader to the live settings scope. In `work` mode the provider returns the empty string and prompt assembly filters the section out entirely, contributing no tokens. The norms text itself is one exported constant; both mode consumers — this section and [`dsh-guard-msce-gate`](../../guard/msce-gate/README.md) — read the same namespace, so one switch lifts both halves together.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `oristrat` settings namespace, the mode reader, and the section registration |
| [`src/norms.ts`](src/norms.ts) | `MSCE_NORMS_PROMPT`: the section's complete static text |
| [`tests/mode.spec.ts`](tests/mode.spec.ts) | Mode specs: coding, work, and fail-closed section text |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [msce-gate](../../guard/msce-gate/README.md) — the paired hard gate that reads the same `oristrat` mode.
- [system-prompt registry](../../core/system-prompt/README.md) — the section seam and its ordering.
- [settings capability](../../settings/settings/README.md) — where the `oristrat` namespace lives and how an absent service fails closed.
- [context group map](../README.md) — the sibling request-context packages.

-----

<a id="model-experience"></a>
## Model Experience

### Mode-scoped norms system prompt section

#### What the model sees

While the deployment mode is `coding`, every assembled system prompt contains the section below verbatim at the `ORISTRAT_MSCE_NORMS` order slot; in `work` mode the provider returns empty text and assembly filters the section out. No tool schema, prompt variable, or session event is added.

##### Norms section text

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

#### Token effect

One fixed prompt-prefix cost per request in `coding` mode — the static section is about 5 KB of UTF-8 text — and zero tokens in `work` mode. The section is reassembled per request rather than retained, so it never accumulates; the deep checklists stay in the installed skill and load only on demand.

#### KV Cache effect

The section is prefix-stable while the mode holds: identical bytes at the same position preserve reuse across requests. Switching `oristrat.mode` replaces the section text with the empty string or back, and editing `src/norms.ts` changes it for every session at once; either invalidates prefix reuse from the section's position onward.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No invariant companion is published because the package contributes static norm text only; it owns no mutable relation an independent observation could diverge from.

- The norms are advisory prompt text: enforcement beyond model compliance — blocking code tools until a review passes — needs a loop-level guard, which [`dsh-guard-msce-gate`](../../guard/msce-gate/README.md) provides for the two transitions it watches.
- PowerShell gate scripts referenced by the skill have no native non-Windows equivalents; the section mandates honest NOT_TESTED reporting instead.
- The section is unconditional in `coding` mode: there is no per-session or per-workspace scoping, so non-MSCE work in a `coding` deployment still carries the norms text.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
