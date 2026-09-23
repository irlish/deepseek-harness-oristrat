# Agent Note: Oristrat round — thinking-level slider, WebSearch MCP, repo-environment panel, embedded browser

Status: implemented

English | [中文](2026-09-22-oristrat-thinking-slider-websearch-mcp-repo-browser-panels.zh.md)

> Scope: (1) the Codex-style reasoning-effort slider in `ui-model-selection` plus the desktop settings seed/migration that give every `api.oristrat.com` model adjustable thinking levels; (2) the `mcp-client` `authorizationEnv` credential reference and the DashScope WebSearch MCP mount in the desktop-host patch; (3) the `gui-repo` Remote BFF and the `ui-repo-panel` read-only right-sidebar environment tab; (4) the desktop `WebContentsView` bridge and the `ui-browser-panel` right-sidebar embedded browser tab; plus the gate normalization (tsconfig paths, manifests, README invariant sentences, translation pairing) the new packages required.

## Problem

The fork's product owner asked for four user-visible capabilities in one round:

- Oristrat models adjust thinking levels through `api.oristrat.com`, but the GUI offered no per-model reasoning control: the composer menu drilled into a static effort pane and the seeded roster declared no `reasoningEfforts`, so the session always rode provider defaults. The requested interaction is a Codex-style animated slider that commits while dragging.
- Agents ran closed-world: no external web search was mounted, and the DashScope WebSearch MCP endpoint (`https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp`) authenticates with a workspace key that must not appear in committed config files.
- With a project mounted as the workspace, nothing beside the session showed the repository environment: branch, pending change totals, local host, remote sources. The product decision is read-only — no commit or push from the panel.
- The right sidebar hosts files and terminal but no browser. `webview` tags and iframes were rejected earlier in the round (sandbox and CSP surface); the approved approach is a main-process `WebContentsView` steered by the renderer.

## Decision

### Thinking-level slider (F1)

- `apps/desktop/seed/settings.yaml` anchors one `reasoningEfforts` map (`low/medium/high/xhigh`) for all ten glm models and sets route `compat.thinkingFormat: openai`; `settings-thinking-migration.ts` applies the same facts to an existing `~/.oristrat/settings.yaml` idempotently at startup, preserving an explicit `false`.
- `ModelSelect`'s root pane replaces the effort drill-in with `EffortSlider`: one stop per adapter-advertised level, filled track and gliding knob, hollow knob plus a provider-default caption while unset. Pointer drag (window-level listeners, refs against stale closures) and keyboard (arrows/Home/End, stopPropagation) commit through the same `directory.select` path; a successful effort commit still closes the menu via the existing settle behavior.

### WebSearch MCP (F2)

- `StreamableHttpConfig` gains `authorizationEnv`: a credential-ref resolved through the credentials service on every connection attempt and merged as `Authorization: Bearer <value>`; a missing credential or missing credentials service fails loud at strict startup, and reconnects pick up a rotated key without restart.
- The desktop-host patch mounts `dashscope-websearch` (streamable-http, `failOnStartupError: false`) so tools surface as `mcp__dashscope-websearch__bailian_web_search`. The key lives only in `$DSH_HOME/.env` as `DASHSCOPE_API_KEY`; config files carry the reference, never the secret.
- Desktop disables the host's `web-search-deepseek` provider and masks preset-inherited `web_search` per agent at creation and before each model step. The mask removes that tool from prompt assembly and execution while retaining `web_fetch` and the DashScope MCP tool. A missing or offline MCP connection leaves search unavailable rather than invoking the DeepSeek provider; a user-owned agent-local search tool remains visible.

### Repo-environment panel (F3)

- New `api/gui-repo` Remote BFF (gui-terminal is the template): one `status` verb runs local git (`rev-parse --show-toplevel`, `abbrev-ref HEAD` with unborn/detached fallbacks, `rev-list --left-right --count @{upstream}...HEAD`, `diff --numstat HEAD`, `ls-files --others`, `remote -v`) through `ctx.subprocess` under an 8s bound and 1MB collection caps; every failure degrades to omitted fields, and a non-repo answers `repo: false`.
- The `ui-repo-panel` client package registers the `repo-env` Session-header utility: a popover with branch + ahead/behind, `+X -Y · N files` (tracked totals plus untracked count), local host, and remote sources, plus a branch submenu that searches local branches, checks out the picked one, and creates-and-checks-out a new one; 4s polling. Commit and push remain absent by product decision (the [round-3 note](2026-09-23-oristrat-header-repo-menu-browser-view-reuse.md) records the header placement and the branch verbs).

### Embedded browser (F4)

- `apps/desktop/src/browser-view.ts` owns one `WebContentsView` per application window: persistent `persist:dsh-embedded-browser` partition, denied window opens (http(s) targets load in-view), http(s)-only navigation, and state pushes (url/title/canGoBack/canGoForward/loading) on every navigation event. Renderer-supplied bounds pass `sanitizeBounds` (finite, rounded, clamped).
- `preload-app.ts` exposes a `browser` face to the `dsh-app://app` document only; new `DESKTOP_IPC.browser*` channels are gated by `assertDesktopSender(event, ['app'])`.
- New `ui-browser-panel` client package registers the `browser` right-sidebar tab type: toolbar (back/forward/reload, address bar normalized to http(s)) above a measured surface; ResizeObserver plus capture-phase scroll, window resize, and a settle push re-push layout-offset bounds; unmount hides the view and the next mount re-attaches the same instance without a reload, and the address form navigates on Enter with no submit button (the [round-3 note](2026-09-23-oristrat-header-repo-menu-browser-view-reuse.md) records the lifecycle). On the plain web host the pane renders a desktop-only notice.

### Gate normalization

- `tsconfig.base.json` paths mappings added for every fork-introduced bundle row (`gui-terminal`, `gui-repo`, `ui-terminal-panel`, `ui-repo-panel`, `ui-browser-panel`, `oristrat-msce-norms`, `msce-gate`), turning `verify-cordis-config` green.
- The new and fork client/api manifests normalized (MIT license, matching cordis peer+dev, `dsh.client.inject` devDeps, `publishConfig.access`, repository directory, exact files lists); README invariant-reason sentences added; `verify-translation-pairing` records refreshed, including two pre-existing committed drifts (ui-conversation README, work-mode Agent Note) re-recorded as shipped.

## Alternatives considered

- Effort selection: keeping the drill-in effort pane (an extra menu level, no drag interaction) or a native `<input type="range">` (cannot render the per-stop dots, filled track, and hollow unset knob, and fights the menu's styling). The custom stop slider commits through the unchanged `directory.select` path, so no host-side selection semantics changed.
- MCP auth: `headers: { Authorization: !!js ... }` puts the secret in a committable config file and needs a restart to rotate; expanding an env var once at config parse time loses per-attempt resolution. `authorizationEnv` resolves through the credentials service on every connection attempt instead.
- Desktop search routing: disabling only `web-search-deepseek` leaves preset `web_search` visible and yields a provider error; a host-only `tool-web` override does not reach the preset's standing scope. The per-agent tool mask removes inherited search from both schemas and dispatch without changing Web and CLI presets.
- Repo facts: `git status --porcelain` gives file lists but no +/- totals; `diff --numstat HEAD` yields the totals directly. A push channel (fs watch or git hooks) was rejected as disproportionate for a read-only panel; 4s polling with a documented one-poll lag was chosen.
- Embedded browser: the `<webview>` tag requires enabling `webviewTag` and adds a deprecated-tag sandbox surface; iframes are refused by most sites' `X-Frame-Options`/CSP `frame-ancestors` and cannot carry an isolated persistent partition; `BrowserView` is deprecated. A main-process `WebContentsView` with renderer-pushed bounds keeps the sandbox defaults and one ownership point.

## Consequences

- Coverage stays per-file 100% for every new source file; genuinely unreachable defensive arms carry reasoned `v8 ignore` comments (git short-sha fallback after detached HEAD, remote-list failure behind show-toplevel, rev-list column guard, stdout collector fallback, effect-time ref guards).
- Pre-existing fork reds are untouched and recorded: `verify-client-ui-i18n` findings in `apps/desktop/renderer/startup.js` and `OristratBrand.tsx`, `main-startup.spec.ts` timeouts at baseline HEAD, `test:gui` drift (ui-layout/ui-settings-models/ui-settings-general/ui-chat/ui-deliverables), and the remaining repo-wide oxlint errors in fork-only files.
- The embedded browser is desktop-only; the web host gets the notice pane. One view per window means a second browser tab reuses the same view, and hiding a tab keeps browsing state alive; it is destroyed only with the window.
- The Desktop search policy's Host tests pin prompt schemas, executor denial, late MCP registration, and the composed patch. A keyless recorded-session replay through the shipped headless profile mounts the same policy with a deterministic MCP tool and pins the complete model-facing prompt and tool catalog. A live DashScope tools/list and search call confirmed `bailian_web_search` and a URL-bearing result; the snapshot does not launch Electron's transport. The entry's activation ordering is owned by the [credentials-ordering note](2026-09-24-oristrat-desktop-search-credentials-ordering.md), which adds the injected credentials service and the wiring tests that keep the tool registered.
