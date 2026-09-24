# Agent Note: 合入上游后的 Desktop 浏览器 guest

Status: implemented

[English](2026-09-24-upstream-desktop-browser-guests.md) | 中文

## 问题

二开的 agent 浏览器自动化通过私有 CDP 通道驱动主进程中的浏览器视图。上游 v0.1.7 将侧边栏浏览器改为带租约的隔离 webview guest。保留旧通道意味着同时维护第二个浏览器所有者，与上游 guest 生命周期冲突；移除旧通道则使二开的浏览器 provider 失去传输通道。

## 决策

Desktop 使用上游 `DesktopBrowserGuests` 的所有权、分区、挂载与导航规则。旧主进程 CDP broker 和 Host 通道不再存在。`dsh-browser-desktop` provider 与 `dsh-tool-browser` consumer 仍保留为源码包，但未挂载到 Desktop profile：当前 guest 控制器不提供 `desktopBrowserTransport`。侧边栏浏览器仍可由用户操作。Desktop 搜索 patch 和 DashScope MCP 工具不依赖浏览器自动化。

[原浏览器自动化决策](../feature/2026-09-24-oristrat-sidebar-browser-agent-automation.zh.md)记录了恢复 agent 控制时需要重新评估的传输和输入保证。未来的集成必须针对带租约的 webview guest，保留上游的会话隔离与所有权，并证明 agent 输入不会抢夺用户焦点。不能仅为了挂接 CDP 而恢复已淘汰的 WebContentsView 生命周期。

## 考虑过的替代方案

**在上游 guest 旁继续保留二开的 WebContentsView broker。** 这会使一个侧边栏有两套浏览器所有者、存储策略和销毁路径。在实现冲突时优先采用官方 guest。

**在没有传输通道时挂载 provider。** 缺少 `desktopBrowserTransport` 会使 provider 在加载时失败，导致 Desktop 无法启动。

## 影响

交付的 Desktop 不暴露 `browser_*` agent 工具。浏览器标签页、通过 DashScope MCP 的网页搜索以及 `web_fetch` 是彼此独立的能力。包级测试继续验证仅保留在源码中的浏览器 provider，Desktop 测试覆盖 guest 租约处理和启动。恢复 agent 浏览器控制需要新的 guest 兼容传输通道，以及打包应用中的端到端测试。
