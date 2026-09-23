---
description: "The browser package group: the browser automation seam, its desktop provider, and the model-facing browser tools, for readers choosing or navigating the family."
kind: "package-group"
---

# browser/ — browser automation capability family

English | [中文](README.zh.md)

## Summary

The `browser/` packages let an agent drive the embedded browser pane a person watches in the desktop app: navigate it, read the page as reference-bearing text, act on elements, capture a screenshot, and read its console. Three packages split the work — `browser` owns the Service Definition, `browser-desktop` implements it over the pane, and `tool-browser` exposes it as seven model-facing tools. Only the desktop composition mounts a provider, so no `browser_*` tool exists anywhere else. Use this family to drive the pane a user sees, not for headless scraping or a second browser window.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Three packages play the browser roles; the subsystem reference owns the exhaustive vocabulary and contracts.

| Package | Role | ctx key |
|---|---|---|
| [`browser/`](browser/README.md) | Service Definition: the browser verbs, element references, and failure codes every provider and tool shares | provides `ctx.browser` |
| [`browser-desktop/`](browser-desktop/README.md) | Provider: drives the embedded pane the desktop client shows, with its origin policy, lease, and observation limits | implements `ctx.browser` |
| [`tool-browser/`](tool-browser/README.md) | Consumer: the seven model-facing tools over the seam | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the shared vocabulary, then the catalogs and the decision behind the split.

- [Browser subsystem](../../docs/subsystems/browser.md) — the seam's type definitions, semantics, and generated Cordis API.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-browser) — the schemas the tools register for the model.
- [Generated configuration catalog](../../docs/config-catalog.md) — every accepted provider config field and its source declaration.
- [Capability seams note](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md) — the Service Definition / Provider / Consumer split this family follows.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>