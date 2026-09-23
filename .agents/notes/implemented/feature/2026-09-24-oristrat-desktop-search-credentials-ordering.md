# Agent Note: Desktop DashScope search activation waits for the credentials service

Status: implemented

English | [中文](2026-09-24-oristrat-desktop-search-credentials-ordering.zh.md)

> Scope: the `mcp-client` entry in `apps/desktop-host/config/desktop.cordis.patch.yml` and the wiring tests under `apps/desktop-host/tests/`. Extends the deployment decision recorded by the [WebSearch MCP note](2026-09-22-oristrat-thinking-slider-websearch-mcp-repo-browser-panels.md).

## Problem

The shipped Desktop application offered the model no search tool at all. A session that asked a current-events question was given a 43-tool catalog containing `web_fetch` but neither `web_search` nor any `mcp__` tool, so the model called `web_search` once (it arrives before the preset mask applies), read `Error: DeepSeek search has no API key`, then fell back to fetching search-engine result pages, which the `web-fetch-http` SSRF check refuses with `URL hostname "www.bing.com" resolves to a non-public IP address`. The user saw four failed calls and no answer.

Booting the packaged composition out of the installed application reproduced the failure without the GUI: composing the same profile with the same patch, resolving `DASHSCOPE_API_KEY` from `$DSH_HOME/.env` and watching the tool registry produced no `mcp__` tool, while the cordis log buffer held exactly one message — `mcp-client(dashscope-websearch): failed generation did not close within 5000ms — reconnect stopped to avoid overlapping server processes; reload the plugin or restart the Host to retry`. Mounting the same plugin into the same booted context with the same config after boot registered `mcp__dashscope-websearch__bailian_web_search` from the live DashScope endpoint, and a wrapped `fetch` recorded no request to the endpoint during boot, so the entry failed before its first HTTP call.

## Decision

- The Desktop patch's `mcp-client` entry now declares `inject: [tools, credentials]`. The plugin resolves `authorizationEnv` through the credentials service, so activation must not begin before that provider exists.
- The failure mechanism is fixed in the composition rather than in the plugin package: `resolveAuthorization()` throws `authorizationEnv "…" requires the credentials service` when the service is absent, and `connectGeneration` builds its client before connecting, so that rejection leaves a generation that never reports close — `waitForClose` then times out, and `scheduleReconnect` stops for the rest of the run. With `failOnStartupError: false` the entry still resolves, which is why the outage was silent.
- `apps/desktop-host/tests/mcp-search-activation.spec.ts` covers both directions against a keyless local Streamable HTTP MCP fixture: the shipped entry registers the search tool and sends `Authorization: Bearer …`, and an entry declaring only `tools` registers nothing while the credentials provider mounts late. `search-policy.spec.ts` asserts the shipped row's `inject` list.

## Consequences

- Desktop search works again, and the deployment keeps its intended shape: the DashScope MCP tool is the model's only search entry point, while the masked preset `web_search` stays unreachable because the patch disables the DeepSeek search provider.
- A missing `DASHSCOPE_API_KEY` or an offline MCP server still leaves Desktop with no search tool. That path now fails after the credentials exist, so the entry retries per its reconnect policy, and it remains visible only in the cordis log buffer — no session event or GUI surface reports it. The README paragraph that already documented this limitation stays accurate.
- The permanent give-up on a generation that never connected is upstream `mcp-client` behavior and was left unchanged; any other activation failure of this entry has the same blast radius, so the injected dependency is what keeps this entry out of that path.
- Search availability is not asserted against the real DashScope endpoint in the unit suite; the keyless fixture owns the wiring, and the endpoint itself is verified by the packaged-composition probe recorded in the handoff.

## Alternatives considered

- Declaring `credentials` in the plugin's own `inject`: rejected because `authorizationEnv` is optional, so an MCP server that authenticates out-of-band must mount in a composition that has no credentials provider at all.
- Setting `failOnStartupError: true` on the entry: rejected because a missing or rotated key would then stop Desktop from starting, which is the failure mode the patch deliberately avoids.
- Relying on the reconnect supervisor to recover the first failed generation: rejected after measurement — the supervisor stops on the first generation that never closes, so recovery never happens.
- Masking the preset `web_search` only while an MCP search tool is registered: rejected because the patch disables the DeepSeek search provider, so leaving `web_search` visible would only trade a missing tool for a guaranteed failure.