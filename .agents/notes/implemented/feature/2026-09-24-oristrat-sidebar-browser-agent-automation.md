# Agent Note: sidebar browser agent automation over the debugging protocol

Status: implemented

English | [中文](2026-09-24-oristrat-sidebar-browser-agent-automation.zh.md)

The Desktop integration described below was superseded by the upstream webview guest composition; the provider remains source-only. See the [current Desktop browser decision](../architecture/2026-09-24-upstream-desktop-browser-guests.md).

> Scope: the `browser/` capability seam (`dsh-browser`, `dsh-browser-desktop`, `dsh-tool-browser`), the desktop shell's browser command channel in `apps/desktop` and `apps/desktop-host` (protocol version 4), and the `ui-browser-panel` reveal and activity surfaces that make an automation run observable. Depends on the embedded pane recorded by the [round-2 note](2026-09-22-oristrat-thinking-slider-websearch-mcp-repo-browser-panels.md) and the view-reuse lifecycle recorded by the [round-3 note](2026-09-23-oristrat-header-repo-menu-browser-view-reuse.md).

## Problem

The desktop application ships an embedded sidebar browser that only the human could drive. The agent had no way to see the page or operate it, so any web-facing change was verified by asking the user to read the screen back, and no automated check could reproduce a click path in the shipped application. The product owner asked for the opposite arrangement: the agent drives the pane the user is watching, the run is visible while it happens, screenshots reach the model, and — the hard constraint — the human's mouse and keyboard are never disturbed.

## Decision

### The seam, split by role

- `packages/browser/browser` (`@deepseek-ai/dsh-browser`) is the Service Definition: branded `BrowserRef`/`BrowserOwner` identities, the request/result vocabulary, the closed `BrowserError` code list, and the abstract `BrowserAutomation` service registered as `ctx.browser` with seven operations (`state`, `navigate`, `observe`, `act`, `screenshot`, `console`, `evaluate`). Every operation that changes the page returns the state that followed it, so verification is the operation's own result rather than a separate read.
- `packages/browser/browser-desktop` (`@deepseek-ai/dsh-browser-desktop`) is the Provider: it drives the pane over the debugging protocol through a `BrowserTransport` it resolves from the context under `desktopBrowserTransport`.
- `packages/browser/tool-browser` (`@deepseek-ai/dsh-tool-browser`) is the Consumer: seven model-facing tools that `inject: ['tools', 'browser']`, so a composition with no provider registers none of them.

The provider and the consumer are mounted in different planes: the provider belongs to the desktop patch, because the shell is the only party that can supply the command channel, while the tools belong to the agent presets, because they are model-facing. `ctx.browser` is the only edge between them.

### Input goes into the page, never into the operating system

- Every action is a protocol command: `Input.dispatchMouseEvent` for click, hover, and wheel; `Input.insertText` after a `Runtime.callFunctionOn` focus/select step for `fill`; `rawKeyDown` + `char` + `keyUp` for `press`. Nothing synthesizes OS input, calls `webContents.focus()`, activates the window, or raises the window's z-order.
- The phase-0 spike ran the whole loop against the shipped pane with the application window blurred (`isFocused() === false`): text entry, a click, and a wheel scroll all landed, and neither the scroll offset nor the window's focus changed. Detached views (`removeChildView`) also accept input and keep capturing live pixels, so hiding the pane would not have broken correctness.

### Observation is the accessibility tree, rendered as text

- `observe` walks the accessibility tree, renders each node as `role "name" value="…" [state]` with its `@eN` reference prefixed, and skips ignored nodes without skipping their subtrees. Geometry is deliberately absent: `Accessibility.getFullAXTree` measured 3,478,506 bytes and `DOMSnapshot.captureSnapshot` 830,203 bytes on a 1,500-link page, so a geometry-bearing observation would not fit a model's context at all. A consumer that needs coordinates captures an image or acts by reference.
- A reference text is minted once per document and never reused, and the `RefStore` resolves the previous generation only while the node it names is still part of the newest observation; anything else, an invented reference included, is `BROWSER_REF_STALE`, so an older reference can only ever name the element it was minted for.
- Output is bounded by depth, node count, and the UTF-8 bytes of the complete text — page header and truncation marker included; a truncated reading reports `nextCursor`, which the next `observe` call accepts.

### The command channel

- `apps/desktop-host` implements `BrowserTransport` as `DesktopBrowserChannel` over the existing child-process IPC: one `browser/cdp` event out, one `browser/cdp-result` or `browser/cdp-error` reply back, keyed by request id. `DESKTOP_HOST_PROTOCOL_VERSION` is 4; the error-code list is `BROWSER_TRANSPORT_ERROR_CODES` from the Definition package, not a second copy.
- `apps/desktop` brokers commands in the main process through `DesktopBrowserCdpBroker`, which owns an allowlist of eighteen protocol methods (the whole capability of the channel), attaches the debugger lazily on the first command, disables background throttling while attached, runs one command at a time, bounds each command with a deadline, and caps captured image bytes.
- No protocol event crosses the channel. Console capture, error capture, dialog neutralization, and the element highlight are installed into the page as an evaluated bootstrap script (`PAGE_BOOTSTRAP_SOURCE`) that keeps a bounded ring in `window.__dshBrowser`; the provider reads it through `Runtime.evaluate`. `alert`, `confirm`, and `prompt` are neutralized into that ring rather than left to block the pane, because a blocked renderer cannot answer the command that opened it.

### The run is visible, and the pane is revealed automatically

- The main process asks the renderer to show the pane (`browserReveal`) when automation attaches to a pane the user has not opened, and waits for the resulting `open` before the first command; `ui-browser-panel` answers by opening the browser tab through `ctx.sidebarRight.openTab`.
- The main process publishes `browserActivity` (active flag, method name, start time) while a command runs, and the pane renders an activity strip from it. The strip is presentation only: no session event type is added and `SESSION_FORMAT_VERSION` is unchanged, because the tool call and its result already carry the model-visible surface.

### Safety and cost bounds

- Per-origin policy (`allowOrigins`/`denyOrigins`, exact origin, bare host, or `*.host` wildcard; deny wins; unparseable URLs refused) is checked before navigation and before every operation, console reads included, against the page actually loaded.
- The shipped default admits every origin: `allowOrigins` and `denyOrigins` are empty and `defaultOriginDecision` is `allow`, so the model may drive any origin the pane can reach, loopback and intranet addresses included. That is a deliberate decision for a pane a person is watching and can navigate away from; a deployment that wants an allowlist sets `defaultOriginDecision: deny` and names its origins.
- One browser view exists per application window, so `BrowserLease` arbitrates a single driver: a second owner is refused with `BROWSER_BUSY`, and an idle lease is stolen after `leaseIdleMs`.
- Screenshots return inline with a hard byte cap; exceeding it is `payload-too-large` with the format and full-page advice in the message. Script evaluation is gated by `allowScriptEval` (default `true`, since the pane is the user's own browser and observation cannot be complete without it).
- The pane keeps `sandbox: true`, `contextIsolation: true`, and no preload; the URL is parsed before navigation and only `http:`/`https:` are accepted.

## Consequences

- Four approved-plan items changed during implementation and are recorded here as shipped reality. (1) Screenshots return inline base64 with an actionable size error instead of a temporary-file handoff: the repository's 1 MiB frame cap applies to the pipe-framed host transport (fd3/fd4), not to Node IPC, so a file handoff would have added a lifetime to manage without lifting a real limit. (2) There is no `visibility` config: main always asks the renderer to reveal the pane, because a hidden pane makes the run unobservable for the user who asked to watch it. (3) The activity strip is fed by the main→renderer push described above rather than a Remote activity face, which was dropped; per-action cancel and persistent activity history remain absent, and stopping a run is the existing session interrupt, which the tools honour through `exec.signal`. (4) No bundled skill ships with this round: the observe→act→verify loop lives in the tool descriptions, and a skill can be added once the loop's phrasing settles.
- Automation observes and drives the pane; it cannot start a download, accept a native file picker, or read pixels of a site the pane blocks. Screenshots of a full page are bounded by the byte cap, and a very tall page must be captured in viewport-sized steps.
- The provider is desktop-only. Web and headless profiles register zero `browser_*` tools, which is the intended reading of `inject` waiting on `ctx.browser` rather than a capability gap to fill with a stub.
- Protocol duplication between `apps/desktop/src/host-protocol.ts` and `apps/desktop-host` is deliberate and cross-verified by `apps/desktop/tests/host-protocol.spec.ts`, including an assertion that both sides' error-code lists equal `BROWSER_TRANSPORT_ERROR_CODES`.
- The pane accepts input while detached, and the view is never focused by automation, so a user typing in the application keeps typing in the application for the whole run. That property is the feature's premise and is asserted at the transport level: no code path reaches OS input.

## Alternatives considered

- Driving the pane with a browser-automation library (Playwright or its protocol client) inside the host process: rejected for this round because the pane is an Electron `WebContentsView` the shell already owns, and attaching the debugger to that existing view needs no second browser, no driver process, and no new listening port. A library-backed provider remains possible behind the same `BrowserAutomation` seam.
- Rendering the observation from `DOMSnapshot.captureSnapshot` or per-node `DOM.getBoxModel` calls: rejected after measurement — the snapshot exceeded 800 KB on an ordinary page, and box-model coordinates are document coordinates that miss the viewport target by the scroll offset.
- Pressing keys by `rawKeyDown` alone: rejected after the spike proved it inserts no text; the working sequence is `rawKeyDown` + `char` (carrying `text`) + `keyUp`.
- Suppressing the pane's `hide()` while automation runs: rejected after the spike showed a detached view still accepts input and still captures live pixels, so the reveal push is a visibility requirement rather than a correctness one.
- Forwarding protocol events across the command channel so console and dialogs could be consumed as they happen: rejected because it would turn a request/response channel into an event stream with its own lifecycle, ordering, and back-pressure questions; an evaluated bootstrap script delivers the same facts through the existing `Runtime.evaluate` command.
- A dedicated `browser_screenshot` tool card in the conversation: not added, because the generic tool card already renders result images through `tool.call.images`, and the tool's text half carries the capture metadata. A dedicated card can be added later without changing the tool's output.
