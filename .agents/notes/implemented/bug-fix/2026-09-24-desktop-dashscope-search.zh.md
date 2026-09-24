# Agent Note: Desktop 通过 DashScope MCP 搜索

Status: implemented

[English](2026-09-24-desktop-dashscope-search.md) | 中文

## Problem

Oristrat Desktop profile 继承了 Web preset 的 `web_search` 工具。即使用户已配置 DashScope API Key，该工具仍调用 DeepSeek 搜索 provider，报缺少 `DEEPSEEK_API_KEY`。只增加 MCP 服务器不会从模型请求中移除继承工具。升级到上游 MCP SDK 后，DashScope WebSearch 端点对 SDK 的现代 `server/discover` 探测返回 HTTP 500，即使密钥有效，MCP 工具也无法出现。

## Decision

Desktop Host 在共享 base 与 Web bundle 之后应用专用 profile patch。该 patch 禁用 DeepSeek 搜索 provider，添加 DashScope WebSearch MCP 客户端条目，并在 tools 与 credentials 就绪后才激活。Host 从每个 Desktop agent 的 prompt 与工具调用中隐藏继承的 `web_search`，包括 preset 切换之后。agent 仍可自行注册同名的作用域工具。其他 profile 保留官方搜索组合。

MCP 客户端接受 Streamable HTTP 的 `authorizationEnv` 凭据引用，并在每次连接时通过现有 credentials 服务解析。同一传输使用官方 SDK 的协议协商选项。默认仍是 `auto`；Desktop DashScope 条目选择 `legacy`，因为该端点拒绝现代探测，却接受 SDK 的旧版 `initialize` 握手。MCP 工具保留服务限定名称 `mcp__dashscope-websearch__bailian_web_search`。

## Alternatives considered

**替换共享 Web 搜索 provider。** 这会改变其他 profile，并与官方 bundle 对其搜索组合的所有权冲突。

**让全部 MCP 服务器使用 SDK 旧版握手。** 这会放弃支持现代协议的服务器的协商能力。配置字段把例外限定在 DashScope。

**向 Desktop agent 同时暴露两种搜索工具。** 模型仍可能选择 `web_search` 并重现 DeepSeek 缺少密钥的错误，因此 Desktop 作用域隐藏继承工具。

## Consequences

MCP 搜索工具出现前，Desktop 需要配置 `DASHSCOPE_API_KEY`。连接失败时 Host 仍可使用，`web_fetch` 仍可用，MCP 客户端按配置的重连策略运行。profile patch 只保存凭据引用，不保存密钥值。现有用户 profile 条目仍可增加自己的 MCP 服务器和 agent 自有工具。

## Testing

Desktop 组合与作用域工具测试验证 provider 禁用、MCP 条目顺序、prompt 与调用行为，以及 preset 切换。MCP 客户端测试验证凭据解析、缺少凭据时的失败和 SDK 握手模式的选择。使用本地密钥连接真实 DashScope WebSearch 端点时，`legacy` 模式发现 `bailian_web_search` 并完成一次非错误搜索调用；同一端点对 SDK 的 `auto` 探测返回 HTTP 500。
