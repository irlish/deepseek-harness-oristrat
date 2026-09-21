# @deepseek-ai/dsh-guard-msce-gate

[English](README.md) | 中文

Oristrat MSCE 规范的硬性执行一半。规范分节（`dsh-context-oristrat-msce-norms`）让纪律成为 prompt 原生内容；本守卫包装 `tools/execute`，在 MSCE 工作区（根目录携带 HARNESS.md / FRAMEWORK.md / msce 或 Brick 系条目）内物理阻止两种转变：

- 在会话没有任何 Harness-Aware Discovery 证据（一次 read/glob/grep/skill 调用提及 HARNESS.md、FRAMEWORK.md、AGENTS.md 或 `msce-engine-app-development` skill）之前的 `write` / `edit`；
- 在晚于最后一次代码变更事件的 `MSCE_SUBMISSION_GATE: PASS` 标记出现之前的 `bash` git add/commit/push。

被阻止的调用返回指名缺失前置条件的结构化 tool error，让模型修复自身流程而不是停摆。非 MSCE 工作区与所有其他工具原样放行。整个守卫以 `dsh-context-oristrat-msce-norms` 持有的 `oristrat` settings 模式为作用域：`work` 模式下每个分派不经检查直接通过，settings 服务缺失或不可读时失败关闭为 `coding` 强制。

## Model Experience

无 prompt、schema 或 session-log 变化：守卫只拒绝分派。拒绝以普通 tool error 的形式呈现，由模型负责处理。

## Known Limitations and Deferred Work

- 证据扫描读取序列化的会话事件；经由未监视工具（未来的代码变更工具）执行的变更会绕过门禁，直到其被加入 MUTATION_TOOLS。
- PASS 标记是模型撰写的文本；守卫把它排在变更之后，但无法验证其背后 review 的质量。
