---
description: "The Oristrat browser packages: Session browser tools and shared browser resource ownership."
kind: "package-group"
---

# packages/oristrat

English | [中文](README.zh.md)

## Summary

Use the Oristrat browser packages to inspect and operate Chromium from an Agent or the Web sidebar. The Chrome DevTools provider supplies browser controls. The shared runtime manages Session browser resources for providers.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The provider uses the shared runtime to retain browser state across turns.

| Package | Role |
|---|---|
| [`browser-chrome-devtools-mcp`](browser-chrome-devtools-mcp/README.md) | Chromium tools and human browser controls |
| [`browser-use-runtime`](browser-use-runtime/README.md) | Session browser resource ownership |

<a id="related-documentation"></a>
## Related documentation

- [Browser use](../../docs/subsystems/browser-use.md) — provider selection, Session ownership, and browser control types.
- [MCP](../../docs/subsystems/mcp.md) — server connections, resources, and tool discovery.

<a id="dev-note"></a>
## Dev Note

None.
