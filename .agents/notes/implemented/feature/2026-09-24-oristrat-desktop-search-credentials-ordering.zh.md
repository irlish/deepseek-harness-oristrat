# Agent Note：桌面端 DashScope 检索激活需等待凭据服务

Status: implemented

[English](2026-09-24-oristrat-desktop-search-credentials-ordering.md) | 中文

> 范围：`apps/desktop-host/config/desktop.cordis.patch.yml` 中的 `mcp-client` 条目，以及 `apps/desktop-host/tests/` 下的接线测试。延续 [WebSearch MCP 笔记](2026-09-22-oristrat-thinking-slider-websearch-mcp-repo-browser-panels.zh.md)记录的部署决策。

## Problem

已发布的桌面端应用完全没有向模型提供检索工具。一个询问时事问题的会话拿到的是 43 个工具的目录，其中包含 `web_fetch`，但既没有 `web_search`，也没有任何 `mcp__` 工具；于是模型先调用了一次 `web_search`（该工具在 preset 屏蔽生效前已下发），读到 `Error: DeepSeek search has no API key`，随后退化为抓取搜索引擎结果页，而 `web-fetch-http` 的 SSRF 检查以 `URL hostname "www.bing.com" resolves to a non-public IP address` 拒绝。用户看到四次失败调用，没有得到答案。

脱离 GUI、直接启动已安装应用中的打包组合即可复现该故障：用同一份 patch 组合同一份 profile、从 `$DSH_HOME/.env` 解析 `DASHSCOPE_API_KEY` 并观察工具注册表，结果是没有任何 `mcp__` 工具，而 cordis 日志缓冲区中恰好只有一条消息——`mcp-client(dashscope-websearch): failed generation did not close within 5000ms — reconnect stopped to avoid overlapping server processes; reload the plugin or restart the Host to retry`。把同一个插件在同一份已启动上下文中以相同配置在启动后挂载，则从线上 DashScope 端点注册出 `mcp__dashscope-websearch__bailian_web_search`；同时被包裹的 `fetch` 在启动期间没有记录到任何发往该端点的请求，说明该条目在首次 HTTP 调用之前就已失败。

## Decision

- 桌面端 patch 的 `mcp-client` 条目现在声明 `inject: [tools, credentials]`。该插件通过凭据服务解析 `authorizationEnv`，因此在其提供方存在之前不得开始激活。
- 故障机制在组合层而非插件包内修复：当服务缺失时 `resolveAuthorization()` 抛出 `authorizationEnv "…" requires the credentials service`，而 `connectGeneration` 在连接之前就构造了客户端，于是该拒绝留下一个从不上报关闭的代际——`waitForClose` 随后超时，`scheduleReconnect` 在此后整个运行期间停止。由于 `failOnStartupError: false`，该条目仍会解析完成，这就是故障静默的原因。
- `apps/desktop-host/tests/mcp-search-activation.spec.ts` 针对无需密钥的本地 Streamable HTTP MCP 夹具覆盖了两个方向：按发货配置的条目会注册检索工具并发送 `Authorization: Bearer …`，而只声明 `tools` 的条目在凭据提供方延迟挂载时什么都不注册。`search-policy.spec.ts` 断言发货条目的 `inject` 列表。

## Consequences

- 桌面端检索恢复，且部署形态保持原意：DashScope MCP 工具仍是模型唯一的检索入口，而被屏蔽的 preset `web_search` 依旧不可达，因为该 patch 禁用了 DeepSeek 检索提供方。
- 缺少 `DASHSCOPE_API_KEY` 或 MCP 服务器离线时，桌面端仍然没有检索工具。这条路径现在会在凭据存在之后失败，因此该条目会按其重连策略重试，但它依旧只体现在 cordis 日志缓冲区中——没有任何会话事件或 GUI 界面会报告它。README 中已经记录该限制的段落仍然准确。
- 「从未连接成功的代际被永久放弃」属于上游 `mcp-client` 行为，本次未改动；该条目的任何其他激活失败都有同样的影响面，注入依赖正是让该条目远离这条路径的原因。
- 单元测试不针对真实 DashScope 端点断言检索可用性；无需密钥的夹具负责接线，端点本身由交接文档中记录的打包组合探针验证。

## Alternatives considered

- 在插件自身的 `inject` 中声明 `credentials`：否决，因为 `authorizationEnv` 是可选项，采用带外认证的 MCP 服务器必须能在完全没有凭据提供方的组合中挂载。
- 在该条目上设置 `failOnStartupError: true`：否决，因为密钥缺失或轮换后会直接导致桌面端无法启动，而这正是该 patch 刻意规避的故障模式。
- 依赖重连监管器恢复首次失败的代际：经实测否决——监管器在第一个从不上报关闭的代际上就会停止，恢复永远不会发生。
- 仅在已注册 MCP 检索工具时屏蔽 preset `web_search`：否决，因为该 patch 禁用了 DeepSeek 检索提供方，让 `web_search` 可见只会把「缺少工具」换成「必然失败」。