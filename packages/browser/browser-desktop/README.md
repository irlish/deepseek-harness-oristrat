---
description: "The desktop provider for the browser automation seam (ctx.browser): driving the embedded browser pane the desktop client shows, with its origin policy, single-owner lease, observation bounds, and configuration fields, for users and maintainers choosing, configuring, or debugging it."
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-desktop

English | [中文](README.zh.md)

## Summary

`dsh-browser-desktop` lets an agent drive the browser pane a person is watching in the desktop app: navigate it, read the page, click and type into it, capture it, and read its console. Input reaches the page as protocol events, so the window is never focused and the user keeps working in the application. Mount it only where the desktop shell supplies its command channel, which makes the desktop app the one composition with browser automation. Configuration decides which origins the agent may drive, how large an observation may be, and whether page script may run.

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

Mount this provider where the embedded browser pane lives. It implements `ctx.browser` over the pane the application window owns, and the model-facing tools work over it unchanged.

### Requirements

The provider takes its command channel from the composition: it reads the context key `desktopBrowserTransport` at construction and refuses to load when the composition provides none, because a provider with no channel could only fail at call time. The desktop shell provides that channel for the pane it owns, so every other profile composes the model-facing consumer without a provider. The provider opens no browser and owns no window: it drives the pane that already exists in the application window.

### Minimal configuration

Every field has a default, so the smallest working row is the plugin entry alone:

```yaml
- id: browser-desktop
  name: '@deepseek-ai/dsh-browser-desktop'
```

| Field | Default | Meaning |
|---|---|---|
| `allowScriptEval` | `true` | Whether page script evaluation may run |
| `highlight` | `true` | Whether actions draw the in-page highlight box the user sees |
| `commandTimeoutMs` | `15,000` | Deadline for one brokered command |
| `settleMs` | `150` | Quiet period observed before reading page state after an action |
| `leaseIdleMs` | `300,000` | Idle time after which another session may take the browser lease |
| `defaultOriginDecision` | `allow` | Decision for an origin no pattern matches |
| `allowOrigins` | `[]` | Host, wildcard-host, or origin patterns that grant access |
| `denyOrigins` | `[]` | Patterns that refuse access; they win over `allowOrigins` |
| `observeMaxDepth` | `12` | Deepest accessibility level an observation renders |
| `observeMaxNodes` | `700` | Maximum element lines one observation renders |
| `observeMaxBytes` | `200,000` | Maximum bytes one observation renders |
| `screenshotFormat` | `png` | Image format a capture uses when the call does not choose one |
| `screenshotQuality` | `80` | JPEG quality a capture uses when the call does not choose one |

The generated [configuration catalog](../../../docs/config-catalog.md) is the exhaustive source for every accepted field and its source declaration.

### Origins the agent may drive

The policy is checked on every call, not once at mount, because a link the agent clicks can move the pane to an origin the policy refuses. A pattern matches in one of three ways: a bare host such as `example.com` matches that host only, a wildcard host such as `*.example.com` matches that host and its subdomains, and a full origin such as `https://example.com:8443` matches an exact scheme, host, and port. A URL that cannot be parsed as an absolute URL is refused, because the policy cannot speak about it. `denyOrigins` wins over `allowOrigins`, and `defaultOriginDecision` decides everything else — so a deployment that lists nothing admits every origin, and one that sets `defaultOriginDecision: deny` admits only its allowlist. Navigation targets must be absolute `http`/`https` URLs.

### The single-owner lease

One pane exists per application window, so two sessions must not interleave commands in it. The first caller takes the lease, the same caller keeps it, and a different session is refused with `BROWSER_BUSY` until the holder has been idle for `leaseIdleMs` — a long enough window that an owner is never plausibly mid-test. Activity refreshes the lease, so a slow test keeps it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design of the provider and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The provider is a Service Provider for `ctx.browser` over a command channel it does not own. It never opens a browser, never owns a window, and never synthesizes operating-system input: every keystroke, click, and scroll is a protocol event inside the page, so the application window is never focused or activated. The pane belongs to the shell; the provider sees only the transport the shell exposes, which is why the same package would work over an in-process or remote backend that presents the same channel.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `DesktopBrowserAutomation`, the `Config` schema, the transport context key, origin and lease checks on every call |
| [`src/cdp.ts`](src/cdp.ts) | Command session: one deadline per command and the transport-to-capability failure mapping |
| [`src/observation.ts`](src/observation.ts) | Accessibility-tree reading, reference generations, and the rendered observation text |
| [`src/interaction.ts`](src/interaction.ts) | Element resolution, input dispatch, and waiting for a page to settle |
| [`src/capture.ts`](src/capture.ts) | Viewport, full-page, and element captures |
| [`src/policy.ts`](src/policy.ts) | Origin policy over host and origin patterns, and the single-owner lease |
| [`src/bootstrap.ts`](src/bootstrap.ts) | The injected page script: console capture, dialog neutralization, highlight overlay |
| — | No runtime invariant companion is published; the provider owns no durable or event-sourced relation, and the pane it drives is the shell's. |

### Main flow

Every operation starts the same way. `prepare` claims or refreshes the lease, enables the DOM domain once, registers the page bootstrap for new documents once, and re-applies it when the document on screen does not carry it; every operation then re-checks the origin policy against the page actually loaded before it reads or changes anything — `console` installs nothing and evaluates only its own read-only expression over the buffered ring — and `act` and `navigate` wait for the document to stop loading before reporting state.

### Observation

The observation is rendered from the accessibility tree the browser already computed rather than from a DOM dump: hidden nodes are absent without a visibility heuristic of the provider's own, and the output is far smaller than a raw node snapshot. Each rendered line carries the reference the model passes back; the store never reuses a reference text, so an older reference can only ever name the node it was minted for, and the previous observation stays resolvable while its node is still part of the page. Geometry is deliberately absent from the text — an action resolves its own geometry when it runs — and `observeMaxBytes` bounds the UTF-8 bytes of the complete text, page header and truncation marker included.

### Page bootstrap

One injected script replaces three protocol features this seam does not expose: console capture, because no event channel crosses the transport; dialog neutralization, because a page-authored `alert` would block the very command that could dismiss it; and the highlight overlay, because a native child view composites above page DOM. The script is idempotent, so a recreated view that lost the new-document registration can be repaired by running it again in the existing document.

### Failure mapping

A command that outlives its deadline is abandoned and reported as `BROWSER_TIMEOUT`, a caller abort as `BROWSER_ABORTED`. Transport failures are total over the transport vocabulary: a closed or unattached pane becomes `BROWSER_UNAVAILABLE`, a refused method or malformed reply becomes `BROWSER_PROTOCOL` — stated once, in [`src/cdp.ts`](src/cdp.ts), so no page-level failure is misreported as a transport one.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the provider contract is not enough. They move from the seam reference to the model-facing tools and the composition that mounts this provider.

- [Browser subsystem](../../../docs/subsystems/browser.md) — the type definitions, semantics, and generated Cordis API for this seam.
- [browser seam](../browser/README.md) — the Service Definition this provider implements.
- [tool-browser](../tool-browser/README.md) — the seven model-facing tools over this provider.
- [browser group map](../README.md) — the sibling group page and its package table.
- [Generated configuration catalog](../../../docs/config-catalog.md) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Observation text

#### What the model sees

The `browser_observe` result body is this provider's text. It opens with a page line such as `[page] url=https://example.com/ title=Example viewport=1280x800 scrollY=0`, adds `[focused] <element>` when a page element has focus and `[dialogs] <n> page dialog(s) were neutralized; see browser_console` when the page raised one, then one indented line per rendered accessibility node — `@e3 button "Sign in"`, `@e7 textbox value="user@example.com" [focused]`, `@e9 heading "Results"` — and closes with `[truncated] nodes=… shown=… next_cursor=…` when a bound cut the rendering short.

#### Token effect

Proportional to the rendered node lines, and bounded by the observation limits: the request's own `maxNodes` and `maxDepth`, otherwise `observeMaxNodes` and `observeMaxDepth`, with `observeMaxBytes` capping the UTF-8 bytes of the complete text. The text is read once per observation call and retained in the transcript like any other tool result.

#### KV Cache effect

Append-only. The text is new tool-result content appended after the reusable request prefix, and its size changes result length rather than prefix content.

### Provider failures

#### What the model sees

A refused operation reaches the model as the failed call's message, carrying the seam's code vocabulary: `element @e12 is stale: observe the page again before acting`, `origin refused: denied by *.example.com`, `another session (<owner>) is driving the browser; it was active <n>s ago`, `page script evaluation is disabled by configuration (allowScriptEval)`, and `browser command Page.navigate exceeded 15000ms`. Each message names what failed and, where the model can act, what to do next.

#### Token effect

Zero until a call fails, then one short message per failure. Repeated failures repeat that message in the transcript.

#### KV Cache effect

Append-only; a failure message follows the reusable request prefix and does not invalidate existing entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define where this provider is a poor fit. They are current package constraints, not a task backlog.

- **Desktop-only by construction** — the provider refuses to load without the shell's command channel, so it cannot be mounted in a headless or non-desktop composition, and no other provider exists to take its place.
- **One pane, one owner** — one instance drives the single pane the application window owns; a second session waits out `leaseIdleMs` of holder inactivity, and there is no vocabulary for a second pane or a background browser.
- **Page dialogs are neutralized, never shown** — `alert`, `confirm`, and `prompt` are replaced by the injected script and recorded as console entries, so the model can read that a page raised one but can never answer a real dialog or see the browser's own prompt.
- **Downloads and file pickers cannot be driven** — the desktop channel forwards only the protocol methods the feature needs, so a page that starts a download or opens a file chooser leaves the agent with no operation to complete it.
- **A capture is bytes, not a stored image** — the provider returns image data and owns no storage, so the consumer decides whether the capture survives the call.
- **The default origin decision admits every origin** — with `allowOrigins` and `denyOrigins` both empty, the model may drive any origin the pane can reach, loopback and intranet addresses included. This is the deliberate default for the desktop product, where a person watches the pane and can navigate away at will; a deployment that wants an allowlist sets `defaultOriginDecision: deny` and names its origins.
- **References are consumed within one document** — reference text is never reused, so a document that accumulates more than 9,999,999 minted references, which needs thousands of full observations of one un-navigated page, mints text the reference grammar cannot express: the model can read such a reference but not write it back. Navigating resets the store and the counter.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>