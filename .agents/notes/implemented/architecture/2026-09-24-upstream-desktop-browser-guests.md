# Agent Note: Desktop browser guests after the upstream merge

Status: implemented

English | [中文](2026-09-24-upstream-desktop-browser-guests.zh.md)

## Problem

The fork's agent browser automation drove a main-process browser view through a private CDP channel. Upstream v0.1.7 moved the sidebar browser to leased, isolated webview guests. Keeping the old channel would require a second browser owner and conflict with the upstream guest lifecycle; removing it leaves the fork's browser provider without a transport.

## Decision

Desktop uses the upstream `DesktopBrowserGuests` ownership, partition, attachment, and navigation rules. The old main-process CDP broker and Host channel are absent. The `dsh-browser-desktop` provider and `dsh-tool-browser` consumer remain as source packages but are not mounted in the Desktop profile: the current guest controller supplies no `desktopBrowserTransport`. The sidebar browser remains available for human use. The Desktop search patch and DashScope MCP tools do not depend on browser automation.

The [original automation decision](../feature/2026-09-24-oristrat-sidebar-browser-agent-automation.md) records the transport and input guarantees that would need reconsideration if agent control is restored. A future integration must target the leased webview guest, preserve upstream session isolation and ownership, and prove that agent input cannot steal the person's focus. It must not revive the retired WebContentsView lifecycle merely to attach CDP.

## Alternatives considered

**Keep the fork's WebContentsView broker alongside upstream guests.** This would give one sidebar two independent browser owners, storage policies, and teardown paths. The official guest implementation takes precedence where the implementations conflict.

**Mount the provider without a transport.** The provider fails at load when `desktopBrowserTransport` is absent, so this would prevent Desktop startup.

## Consequences

The shipped Desktop does not expose `browser_*` agent tools. Browser tabs, web search through DashScope MCP, and `web_fetch` remain separate capabilities. Package tests continue to exercise the source-only browser provider, while Desktop tests cover guest lease handling and startup. Restoring agent browser control requires a new guest-compatible transport and end-to-end tests in the packaged application.
