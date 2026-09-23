# Oristrat AI Stem v9 handoff — Desktop search actually reaches the model

This round fixes the reason the shipped application had **no search tool at all**. The previous round wired the Alibaba Bailian WebSearch MCP server into the Desktop patch, verified the endpoint from the repository, and stopped there; inside the application the MCP entry never registered a tool, and the Desktop search policy had already masked the preset `web_search`, so a model asked about current events had only `web_fetch` — which the `web-fetch-http` SSRF check refuses for search-engine hosts (`URL hostname "www.bing.com" resolves to a non-public IP address`). That is exactly the transcript the product owner reported.

Release artifact: `apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/` (`Oristrat AI Stem.app` under `mac-arm64/`, plus zip/dmg) — zip SHA256 `f451a5730a3379123dfe69daa49699dad8ed7fa1aea8dd9e7bad3576de956bae` (240,962,574 bytes), dmg SHA256 `c753a758703733b7c95f9ed0e0f6babdf35d0aaa39cc69f96650c71d947ad0e1` (231,857,445 bytes), built 2026-09-24 04:11 from this working tree. `app.asar` is byte-identical to the v8 shell (`50488820d381d0ea9cc909099f2aabc9e0094f11fc21b4abe40ea54a11bd3531`) because the fix lives in the unpacked runtime tree, not in the shell bundle. Installed over `/Applications/Oristrat AI Stem.app` with `ditto` after quitting the running app and moving the previous build to `~/Library/Application Support/oristrat-stem-backups/Oristrat AI Stem-v8.app`; relaunched with `env -u ELECTRON_RUN_AS_NODE open -n "/Applications/Oristrat AI Stem.app"`. The two packaging and launch environment requirements from the v8 handoff still apply unchanged (real Node 22 on `PATH`, `DSH_DESKTOP_APP_ID=ai.oristrat.stem`, `ELECTRON_RUN_AS_NODE` unset for the app).

## Root cause

`mcp-client(dashscope-websearch)` activated before the `credentials` service existed. `resolveAuthorization()` then threw `authorizationEnv "DASHSCOPE_API_KEY" requires the credentials service`, and because `connectGeneration` constructs its MCP client before connecting, that rejection left a client that had never connected — its close signal never arrives, so the plugin's `waitForClose` timed out and logged `failed generation did not close within 5000ms — reconnect stopped to avoid overlapping server processes; reload the plugin or restart the Host to retry`. `failOnStartupError: false` then let activation resolve without an error, so nothing reached the user: no search tool, no session event, no GUI surface.

Evidence that fixed blame on activation ordering rather than the endpoint, the key, or the mask:

- A session recorded by the installed application (`~/.oristrat/sessions/--Users-irlish-.oristrat-profiles-desktop--/session-247fb24b-…/session.v3.jsonl.zstd`) carries `request/header.tools` with 43 entries — `web_fetch` present, `web_search` and every `mcp__` name absent — plus the four failed calls the owner screenshotted.
- Booting the packaged composition outside Electron (`.artifacts/v9/probe-composition.mjs`, run with the app's own `Resources/runtime/node/node`) reproduced the outage with the same single log-buffer message, and a wrapped `fetch` recorded **no** request to `dashscope.aliyuncs.com` during boot.
- The same probe resolved `DASHSCOPE_API_KEY` from `~/.oristrat/.env` (`user-env`, 117 characters) and registered `mcp__dashscope-websearch__bailian_web_search` immediately when the entry was mounted after boot, while the loader-mounted entry with the shipped config claimed the same `serverName` and registered nothing.

## The fix

`apps/desktop-host/config/desktop.cordis.patch.yml` now gives the MCP entry `inject: [tools, credentials]`, so activation waits for the credentials provider. One line of composition, plus the comment that records why.

With the installed bundle, the probe shows the connection during boot and the tool registered:

```
FETCH 20:14:25.341 200 in 167ms https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp
FETCH 20:14:25.511 202 in  63ms https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp
t=0s registered=11 mcp=mcp__dashscope-websearch__bailian_web_search
```

## Verification performed

- `apps/desktop-host/tests/mcp-search-activation.spec.ts` (new, keyless): mounts the shipped entry's `inject` and config over a local Streamable HTTP MCP fixture with the credentials provider arriving 30 ms late. The shipped list registers `mcp__dashscope-websearch__ping` and puts `Authorization: Bearer sekret` on the wire; an entry declaring only `tools` registers nothing. Reverting the `inject` line makes the first case fail, so the test bites.
- `apps/desktop-host/tests/search-policy.spec.ts` now asserts the shipped row's `inject` list next to its existing config assertions.
- `npx vitest run apps/desktop-host/tests` → 3 files, 15 tests green. `npx tsc -b tsconfig.host.json` clean. `npx oxlint --config .oxlintrc.json` over both specs → 0 errors (the repo-wide `pnpm run lint` still cannot run on this host: oxlint 1.76.0 SIGTRAPs on `jsPlugins`).
- `pnpm run test:docs` 16/16, including `translation pairing` and `agent note format`, after the README and Agent Note updates.
- Packaging rebuilt end to end with `pnpm --filter @deepseek-ai/dsh-desktop package:mac:arm64:unsigned`; the artifact's patch file and the installed app's patch file both carry the inject, and `diff` against the v8 backup shows that line as the only difference.
- Packaged-composition probe against the **installed** bundle registers the search tool at boot (output above).

## Notes for the next round

- Two diagnostic channels made this findable and are worth reusing. A session log's `request/header.tools` is the exact model-facing catalog (`.artifacts/v9/names.mjs` prints it), and the cordis log buffer at `ctx.logger.buffer` holds what the Desktop GUI never shows (`.artifacts/v9/probe-composition.mjs` reads it after booting the real composition). The session files are concatenated zstd frames, so a single `zstdDecompressSync` call decodes only the first frame — `.artifacts/v9/zread.mjs` walks the frame magic instead.
- The mask in `apps/desktop-host/src/search-policy.ts` is deliberate and keeps its meaning: the patch disables the DeepSeek search provider, so `web_search` can never succeed in Desktop and hiding it is correct. It is *not* conditional on MCP search being present, so any future outage of this entry still costs the session every search tool. If search availability ever needs a user-visible signal, that is the place to add one.
- A missing or rotated `DASHSCOPE_API_KEY`, or an offline MCP server, still leaves Desktop without a search tool and reports only into the log buffer. The reconnect policy retries that failure, but the log buffer is not a user-facing surface.
- The permanent give-up on a never-closed generation is upstream `mcp-client` behavior and was left untouched; the injected dependency is what keeps this entry out of that path.
- GUI-level confirmation still needs one user-issued question in a fresh application session: the fix is verified at composition level (the tool registers), and the per-session catalog can be re-checked from that session's `request/header.tools` afterwards.