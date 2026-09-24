---
description: "The seven model-facing browser tools over the ctx.browser seam — browser_navigate, browser_observe, browser_act, browser_screenshot, browser_console, browser_state, and browser_eval — for users and maintainers choosing, configuring, or debugging them."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-browser

English | [中文](README.zh.md)

## Summary

`dsh-tool-browser` gives an agent seven tools for a provider-owned browser pane: `browser_navigate`, `browser_observe`, `browser_act`, `browser_screenshot`, `browser_console`, `browser_state`, and `browser_eval`. The loop is observe, act, verify: `browser_observe` reads the page as text whose actionable nodes carry references such as `@e12`, `browser_act` drives one of them, and every action returns the page state it produced. These tools exist only while a browser provider is mounted; the current Desktop profile has no compatible provider for its upstream webview guest. Screenshots also need an attachment store and a model route that accepts images.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount these tools wherever a browser provider is available. They register on `ctx.tools` and call `ctx.browser` for every operation, so the browser behavior a model meets is the mounted provider's, not theirs.

### Requirements

The plugin injects `tools` and `browser`, so it registers only while both are present: a profile without a browser provider exposes no `browser_*` tool at all, rather than a tool that fails when it is called. Every call needs an owning agent session, because that session's id is the browser owner a provider arbitrates its lease with; a call from outside an agent loop fails. `browser_screenshot` additionally needs a mounted attachment store and a model route that declares image input.

### Minimal configuration

The row is the plugin entry, and the provider it consumes is configured on its own row in the same composition:

```yaml
- id: tool-browser
  name: '@deepseek-ai/dsh-tool-browser'
```

These tools have no configuration fields of their own: the [browser-desktop](../browser-desktop/README.md) row decides the origin policy, the observation bounds, and the image defaults.

### The seven tools

Read the page with `browser_observe`, `browser_state`, `browser_console`, and `browser_eval`; change it with `browser_act` and `browser_navigate`; look at it with `browser_screenshot`. `browser_state` is the cheap check between steps, `browser_observe` is the structured reading that yields references, and `browser_eval` is the escape hatch for facts the accessibility tree does not carry. The generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-browser) holds each schema and description exactly as the model receives it.

### The observe, act, verify loop

`browser_observe` renders the page as text in which every actionable node carries a reference such as `@e12`. `browser_act` takes that reference — or a CSS selector, or a viewport point, but exactly one of the three — and performs one of `click`, `hover`, `fill`, `type`, `press`, `select`, `scroll`, or `focus`; only `press` and `scroll` may omit the target. Every action and navigation answers with the page state that followed it, so a step is verified by reading that answer instead of assuming the action landed. A reference the provider can no longer resolve fails and tells the model to observe the page again rather than acting on a different element.

### Screenshots

`browser_screenshot` returns the capture as an image the model can look at, so rendering is judged directly rather than inferred from structure: the bytes are stored as a durable attachment and returned as an image block beside a one-line description. The tool refuses to run when the current model route declares no image input, because an image the model cannot inspect is a misleading success. An oversized capture fails rather than being downscaled, and the message names the way out — capture the viewport instead of the whole page, or lower the JPEG quality.

### Ownership

Each call claims the browser for the calling session, so two sessions cannot interleave commands in the one pane. A second session fails until the holder has been idle, and the message names the holder. Interrupting the session turn aborts the call through the signal the tool passes to the provider.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design of the tool set and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The package is a thin Consumer of the seam: one tool per browser operation and no browser logic of its own, so every page fact and every failure comes from the mounted provider and the tool surface stays identical across providers. Each definition carries its model description, parameter schema, output schema, result rendering, and presentation metadata, so the card a user sees derives from the same values the model reads.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the seven tool definitions with their parameter and output schemas, result renderers, and presentation metadata |
| — | No runtime invariant companion is published; the plugin registers tools and holds no state of its own. |

### Export shape

The plugin is a function plugin: it exports `name`, `inject`, and `apply`, and no default export. A stray `export default` would make the Loader's `unwrapExports` collapse the module and drop `inject` (see [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

### Result rendering

Each tool returns structured values and renders its own model-facing text from them. A navigation answers `reached: <url> "<title>"` or `did not finish loading: …`; an action answers `<action> <ref> → <url> "<title>"`; `browser_state` answers one line carrying the viewport and history availability; `browser_console` renders a header line plus one `[level] text` line per entry. Failures thrown by the tool or the provider become the failed call's message, so the model reads one string and, where it can act, a next step.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the tool contract is not enough. They move from the seam and its provider to the generated catalog of what the model actually receives.

- [Browser subsystem](../../../docs/subsystems/browser.md) — the type definitions, semantics, and generated Cordis API for this seam.
- [browser-desktop](../browser-desktop/README.md) — the provider that drives the embedded pane these tools act on.
- [browser seam](../browser/README.md) — the Service Definition these tools consume.
- [browser group map](../README.md) — the sibling group page and its package table.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-browser) — every schema and description as the model receives them.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

All seven schemas register together, and the [generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-browser) holds each of them exactly as the model receives it: `browser_navigate` takes an `action` of `goto`, `back`, `forward`, or `reload` with an optional `url`; `browser_act` takes an action name plus one target form and the value that verb needs; `browser_screenshot` takes `full_page`, a target, `format`, and `quality`. Incoherent arguments are rejected before the provider is called, so `browser_act` given both `ref` and `selector` answers `<verb> accepts one of ref, selector, or x/y — not several`.

#### Token effect

Fixed: seven schemas and their descriptions sit in every request while the tools are visible, and they are stable for a given package version.

#### KV Cache effect

Prefix-stable while the tool set and its descriptions are unchanged. Mounting or removing the browser provider changes the visible tool block and can invalidate reuse from that point onward.

### Tool-call history and result

#### What the model sees

Assistant calls retain their arguments — an action name, a reference such as `@e12`, a value, a key. Each result is the text this package renders: `reached: https://example.com/ "Example"`, `click @e12 → https://example.com/ "Example"`, `https://example.com/done "Done" viewport=1280x800 history=back/forward`, `captured png 1280x800 of https://example.com/` beside an image block, and `no console output; cursor=4` or `2 entries; cursor=9` followed by `[warn] page dialog alert: Are you sure?`. `browser_observe` returns the provider's rendered page text, and a truncated reading carries a cursor to continue from. Failures arrive as `Error: <message>`, such as `Error: browser tools require an agent session: the call ran outside an agent loop`, and an interrupted turn renders `Error: tool call aborted`.

#### Token effect

Observe results dominate and are bounded by the provider's depth, node, and byte limits; console readings are bounded by `limit`; a screenshot costs an image block plus one line; the remaining results are one short line each. Everything stays in the transcript until compaction.

#### KV Cache effect

Append-only: results add content after the reusable request prefix, and none of them rewrites earlier content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the tool set is a poor fit. They are current package constraints, not a task backlog.

- **Absent outside a provider composition** — the tools register only while `ctx.browser` is mounted. The current Desktop profile exposes no `browser_*` tool because it does not mount a compatible provider.
- **One pane, one session at a time** — the calling session owns the pane while it works, a second session is refused until the first has been idle, and there is no queue, no hand-off, and no way to share the pane between two agents.
- **Screenshots are inline images with a size cap** — a capture is returned as an image block from a stored attachment, so it must fit both the attachment store's image limits and the pane channel's forwarded-capture limit; an oversized capture fails with guidance instead of being downscaled.
- **A running call is stopped by the turn, not by the pane** — the pane's activity strip only reports that a command is running and carries no per-action cancel, so interrupting the session turn is the stop path, and that abort reaches the provider as an aborted command.
- **No bundled skill** — these packages ship no skill asset that teaches the loop, so a model learns it from the tool descriptions and its own observations.
- **No file, download, or dialog operation** — the tool set cannot upload a file, start a download, or answer a page dialog, so a page that requires one of them cannot be completed; page dialogs are neutralized by the provider rather than shown.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
