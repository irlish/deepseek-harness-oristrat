# Agent Note: Desktop search through DashScope MCP

Status: implemented

English | [中文](2026-09-24-desktop-dashscope-search.zh.md)

## Problem

The Oristrat Desktop profile inherited the Web preset's `web_search` tool. It called the DeepSeek search provider even when the user had configured a DashScope API key, producing a missing `DEEPSEEK_API_KEY` error. Adding an MCP server alone did not remove the inherited tool from the model's request. After the upstream MCP SDK update, DashScope's WebSearch endpoint answered the SDK's modern `server/discover` probe with HTTP 500, so the MCP tool would remain unavailable even with a valid key.

## Decision

The Desktop Host applies a profile patch after the shared base and Web bundles. The patch disables the DeepSeek search provider, adds one DashScope WebSearch MCP client entry, and waits for both tools and credentials before activating it. The Host hides inherited `web_search` from each Desktop agent's prompt and tool dispatch, including after a preset switch. An agent may still register its own scoped tool with that name. Other profiles keep the official search composition.

The MCP client accepts a Streamable HTTP `authorizationEnv` credential reference and resolves it through the existing credentials service for every connection attempt. The same transport uses the official SDK's protocol negotiation option. Its default remains `auto`; the Desktop DashScope entry selects `legacy` because that endpoint rejects the modern probe but accepts the SDK's legacy `initialize` handshake. The MCP tool retains the server-qualified name `mcp__dashscope-websearch__bailian_web_search`.

## Alternatives considered

**Replace the shared Web search provider.** This would change other profiles and conflict with the official bundle's ownership of their search composition.

**Use the SDK's legacy handshake for every MCP server.** This would discard modern protocol negotiation for servers that support it. The configuration field keeps the exception local to DashScope.

**Expose both search tools to Desktop agents.** The model could still choose `web_search` and repeat the missing DeepSeek key failure, so the Desktop scope hides the inherited tool.

## Consequences

Desktop needs a configured `DASHSCOPE_API_KEY` before MCP search tools appear. A failed connection leaves the Host usable, with `web_fetch` still available, while the MCP client follows its configured reconnect policy. The credential reference is never written into the profile patch as a secret value. Existing user profile entries can add their own MCP servers and agent-owned tools.

## Testing

The Desktop composition and scoped tool tests verify provider disablement, MCP entry order, prompt and dispatch behavior, and preset changes. The MCP client tests verify credential resolution, missing-credential failures, and selection of the SDK handshake mode. A live connection to the DashScope WebSearch endpoint with a local key discovered `bailian_web_search` and returned a non-error result from a search call using `legacy`; the same endpoint returned HTTP 500 for the SDK's `auto` probe.
