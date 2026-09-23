---
description: "The browser automation Service Definition (ctx.browser) for DeepSeek Harness: navigation, reference-bearing observations, element actions, screenshots, console reads, script evaluation, and the shared failure codes, for maintainers composing, implementing, or debugging a browser provider."
kind: "package-reference"
---

# @deepseek-ai/dsh-browser

English | [中文](README.zh.md)

## Summary

`dsh-browser` defines what anything in the harness may do with the browser pane a user watches: navigate, read the page as reference-bearing text, act on an element, capture an image, read console output, and evaluate a script. The definitions fix the vocabulary every provider, tool, and client shares — `@e12` element references, the `BROWSER_*` failure codes, and the request and result records. Compose it with a provider to let browser tools drive the pane; the desktop app mounts the only provider today. Mounting this package alone drives nothing: with no provider, `ctx.browser` is absent and no `browser_*` tool exists.

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

Read this package when you consume, implement, or debug browser automation: it is the contract, and a provider supplies the behavior. A consumer calls `ctx.browser`, a provider implements the abstract service, and neither needs to know how the other works.

### The operations a provider implements

Seven operations are the whole surface. `state` reads the current page. `navigate` moves the pane and waits for the resulting document to settle. `observe` renders the page as reference-bearing text. `act` performs one action on an element or on the page. `screenshot` captures image bytes. `console` reads buffered console output and uncaught page errors. `evaluate` runs one expression in the page. Every operation takes the calling identity and returns a declared record, and a provider that cannot serve a call rejects with a `BrowserError` carrying a code from the seam's vocabulary instead of inventing a message string.

### References and the single view

`observe` mints element references that the model reads and writes as `@e12`. A reference identifies an element inside one observation generation, so a navigation or a newer observation that drops the node makes it stale, and a provider reports `BROWSER_REF_STALE` for a reference it cannot resolve rather than acting on a different element. `BrowserOwner` carries the calling identity — conventionally the session id — which a provider uses only to arbitrate who may drive its single view; a second caller is refused with `BROWSER_BUSY`. Both values are branded, so an id minted for another feature cannot be passed where one of these is expected.

### Composing a provider

A profile drives a browser only where a provider is mounted beside the consumer. The desktop app owns the embedded pane and the command channel to it, so it is the composition that mounts one:

```yaml
- id: browser-desktop
  name: '@deepseek-ai/dsh-browser-desktop'
```

Every accepted field on that row belongs to the provider and is documented in [browser-desktop](../browser-desktop/README.md).

### Failures callers route on

The abstract service owns one failure vocabulary. Providers report page-level failures as `BrowserError` codes such as `BROWSER_ORIGIN_DENIED`, `BROWSER_REF_STALE`, `BROWSER_BUSY`, `BROWSER_TIMEOUT`, and `BROWSER_SCRIPT_EVAL_DENIED`, and a transport brokered to this process reports transport failures as `BrowserTransportError`, whose codes describe the channel rather than the page. A provider maps transport codes onto capability codes before a consumer sees them, so callers route on one vocabulary, declared in `BROWSER_ERROR_CODES`; the [browser subsystem](../../../docs/subsystems/browser.md) is the seam's reference page.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design of the seam and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The package is one role of a capability seam: the Service Definition that names the browser contract, with Service Providers and Consumers split so each role evolves independently (see the [capability seams note](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)). Two decisions anchor it:

- **Page-level operations, not protocol methods.** The seam exposes the verbs every consumer needs and names no debugging-protocol call, so a provider that speaks a different protocol implements the same contract.
- **One vocabulary, declared once.** Element references, page state, action outcomes, and failure codes live here, so tools, providers, and clients cannot drift apart on what a call or a failure meant.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the abstract `BrowserAutomation` service, `BrowserTransport`, and the `Context.browser` declaration merge |
| [`src/types.ts`](src/types.ts) | Reference and owner brands, request and result records, `BrowserError`, and both failure-code vocabularies |
| — | No runtime invariant companion is published; the seam is stateless, and providers own the page observations an invariant would check. |

### Where the state lives

The seam holds none. Page state, console buffers, and reference generations belong to a provider; screenshot bytes belong to the caller that stores them; the owner identity is only a lease token. That split is what lets one consumer run over any backend.

### Export shape

The package default-exports the abstract `BrowserAutomation` service class and re-exports its types, brands, helpers, and errors by name. Mounting it registers `ctx.browser` with no implementation behind the property, which is why a provider row is the only way to make the seam usable.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the seam contract is not enough. They move from the reference vocabulary to the provider, the tools, and the decision behind the split.

- [Browser subsystem](../../../docs/subsystems/browser.md) — the type definitions, semantics, and generated Cordis API for this seam.
- [browser-desktop](../browser-desktop/README.md) — the provider that drives the embedded pane the desktop client shows.
- [tool-browser](../tool-browser/README.md) — the seven model-facing tools over this seam.
- [browser group map](../README.md) — the sibling group page and its package table.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-browser) — the schemas the consumer registers for the model.
- [Capability seams note](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md) — the Service Definition / Provider / Consumer split this seam follows.

-----

<a id="model-experience"></a>
## Model Experience

### Effect on the provider contract

#### What the model sees

Nothing this package writes. The seam registers no tool schema, prompt section, or result text, so the canonical tool-schema and tool-call-history sections describe no artifact of this package; what it fixes instead is the vocabulary a model meets inside its tool results — references such as `@e12`, the field names of the observation, state, action, and console records, and the `BROWSER_*` codes that `dsh-tool-browser` renders as failed-call messages.

#### Token effect

Zero direct: this package contributes no tokens to any request. Token cost appears only where a consumer renders the values these definitions describe.

#### KV Cache effect

No direct invalidation. The package assembles no request prefix, so reuse changes only when a consumer's rendered text or registered schema changes, and that consumer owns the effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define where the seam stops. They are current package constraints, not a task backlog.

- **Abstract only** — mounting this package registers the service with no provider behind it, so a composition drives no browser until a provider row is present; `dsh-browser-desktop` is the only provider, and only the desktop app composes it.
- **One view per provider instance** — the seam models the single pane a client shows; there is no target id, window list, or second-pane vocabulary, and `BrowserOwner` exists only to arbitrate that one view between callers.
- **A closed verb set** — the seven operations are the whole surface: no download, upload, file-picker, dialog, cookie, storage, or network operation exists, and element addressing is limited to a minted reference, a CSS selector, or a viewport point.
- **The seam stores nothing** — a screenshot is bytes the caller must store, and no operation persists page state, so a consumer that needs either owns it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>