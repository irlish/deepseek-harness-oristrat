---
description: "Right-sidebar embedded browser tab: a toolbar and a measured surface steering the desktop main-process WebContentsView; desktop-only, with a plain-web notice elsewhere."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-browser-panel

English | [中文](README.zh.md)

## Summary

Use this package to browse the web inside the desktop application's right Sidebar. The `browser` tab opens the main-process `WebContentsView` over its measured surface element and steers it through the `window.dshDesktop.browser` bridge: back, forward, reload, and address-bar navigation normalized to http(s). The pane re-pushes the view's bounds on element resize, capture-phase scroll, and window resize, so the native view tracks the Sidebar. The view keeps its own persistent partition, denies window opens, and restricts navigation to http(s). On the plain web host, where the bridge is absent, the pane renders a desktop-only notice instead.

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

Ship the package as a browser row of the web-app bundle; the shipped composition already inserts it. The tab appears in the right Sidebar's guide as the **Embedded browser** entry and opens through `ctx.sidebarRight.openTab('browser')`. In the desktop application the pane attaches the embedded view on mount and releases it on unmount; the toolbar and address bar drive navigation from then on.

### When to choose it

Choose it when desktop users need quick in-app web reading beside a conversation — documentation, references, previews — without leaving the window. Avoid it on the plain web host, where the pane can only show its desktop-only notice, and avoid it when the browsing must survive a tab close: closing the tab destroys the view with its navigation state. The embedded view is desktop-owned; the browser half of this package only measures and steers it.

### Minimal configuration

Add one browser row beside the Sidebar stack; the web-app bundle already carries it:

```yaml
- name: '@deepseek-ai/dsh-client-ui-browser-panel'
```

The package has no configuration fields. It requires the right-Sidebar tab registry (`sidebarRightTabs`), the keyed `sidebar.right.pane.tab` and `sidebar.right.pane.tab.title` seats, and the locale service; the desktop bridge arrives through `window.dshDesktop.browser`, which the desktop application's preload script installs.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin body registers the `browser-panel` locale dictionaries, the `browser` tab type (id `@deepseek-ai/dsh-client-ui-browser-panel`, band `builtin`, guide order 40, claiming no address), the pane body, and the chip title, and reads the desktop bridge once per apply: on the plain web host it is `undefined` and the body renders the localized desktop-only notice. With a bridge, the body subscribes to navigation state (`url`, `title`, `canGoBack`, `canGoForward`, `loading`), opens the view over the measured surface rect, and re-pushes rounded bounds from a `ResizeObserver` on the element, capture-phase `scroll`, and window `resize`; unmount unsubscribes and closes the view. The address bar normalizes input before navigating: text containing whitespace is refused, a bare host gains an `https://` prefix, and only parseable http(s) URLs navigate. The main-process owner keeps one view per application window on the persistent `persist:dsh-embedded-browser` partition, clamps renderer-supplied bounds, denies window opens, and restricts every navigation to http(s).

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Plugin body: dictionaries, tab type, keyed seats, and the once-per-apply bridge read |
| [`src/client/definition.tsx`](src/client/definition.tsx) | The `browser` tab-type definition and its guide entry |
| [`src/client/BrowserPanel.tsx`](src/client/BrowserPanel.tsx) | Toolbar, address bar, bounds pushing, state subscription, and the desktop-only notice |
| [`src/client/bridge.ts`](src/client/bridge.ts) | The structural `window.dshDesktop.browser` face, rect-to-bounds rounding, and URL normalization |
| [`src/client/BrowserTabBody.tsx`](src/client/BrowserTabBody.tsx), [`BrowserTitle.tsx`](src/client/BrowserTitle.tsx) | Seat adapters: the injected bridge into the pane; the globe mark before the chip title |
| [`src/client/locales.ts`](src/client/locales.ts) | `browser-panel` zh/en dictionaries; the Chinese key set is the source of truth |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-sidebar-right](../ui-sidebar-right/README.md) — the tab registry, the keyed seats, and the navigation controller this package registers into.
- [Desktop browser view](../../../apps/desktop/src/browser-view.ts) — the main-process `WebContentsView` owner the bridge reaches.
- [Desktop preload](../../../apps/desktop/src/preload-app.ts) — the preload script that exposes `window.dshDesktop.browser` to the renderer.

-----

<a id="model-experience"></a>
## Model Experience

None, as the pane only steers a desktop-owned view through the preload bridge; no verb reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No invariant companion is published because the pane keeps no cross-entry state; the view lives in the desktop main process, and the panel only forwards measurements and intents over the preload bridge.

- Desktop-only surface: the plain web host shows the notice and cannot browse.
- One view instance per application window: a second browser tab reuses the same view, and closing the tab destroys it, so browsing state does not survive a close.
- Placement rides renderer measurements pushed over IPC; the native view can visually lag DOM layout by a frame while the sidebar animates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
