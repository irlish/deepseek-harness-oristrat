# @deepseek-ai/dsh-context-oristrat-msce-norms

[English](README.md) | 中文

面向本 fork 部署的常开 Oristrat MSCE 引擎开发规范：一个 system-prompt 分节，注册在持有 prompt 注册表的上下文，携带 `msce-engine-app-development` skill 的精简规范内核（组件边界、View import 与 Less/I18n 纪律、工程 comment review、与提交耦合的门禁，以及验证分级）。

插件还持有 `oristrat` settings 命名空间（`mode: coding | work`，默认 `coding`）。`work` 模式下该分节贡献空文本——自由创作的方案/PPT/文档会话不携带这些规范——并且伴随的守卫（`dsh-guard-msce-gate`）对每个分派直接放行。没有 settings 服务时，模式失败关闭为 `coding`。

## Model Experience

部署模式为 `coding` 时，该分节向每个组装的 system prompt 添加固定的规范性文本；`work` 模式下不贡献任何内容。除自身文本外不消耗会话 token，只作为普通 prompt 前缀内容影响 KV cache，且不改变任何工具 schema 或模型可见事件。深度清单保留在已安装的 skill 中并按需加载。

## Known Limitations and Deferred Work

- 规范是建议性 prompt 文本：超出模型遵从性的强制（在 review 通过前阻止代码工具）需要 loop 级守卫插件。
- skill 引用的 PowerShell 门禁脚本没有原生的非 Windows 等价物；该分节转而要求诚实的 NOT_TESTED 报告。
