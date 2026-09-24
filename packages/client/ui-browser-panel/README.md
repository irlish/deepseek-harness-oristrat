---
description: "Source-only browser panel for the fork's retired WebContentsView bridge; the shipped sidebar uses the upstream webview guest package."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-browser-panel

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-browser-panel` is the fork's source-only panel for a main-process `WebContentsView`. It measures a Sidebar surface and drives navigation through the earlier `window.dshDesktop.browser` bridge. The shipped web-app bundle mounts the upstream `dsh-client-ui-sidebar-browser` package instead; the current Desktop bridge has a different guest lease interface, so this panel cannot drive its browser. Its source remains available for compositions that supply the earlier bridge.

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

Mount this package only in a composition that supplies its earlier `window.dshDesktop.browser` bridge. The shipped web-app bundle uses [sidebar-browser](../ui-sidebar-browser/README.md). With a compatible bridge, its tab appears in the right Sidebar and opens through `ctx.sidebarRight.openTab('browser')`.

### When to choose it

Choose the shipped [sidebar-browser](../ui-sidebar-browser/README.md) for in-app web reading. This package is useful only to maintain a composition with the earlier WebContentsView bridge; a plain web host shows its desktop-only notice.

### Minimal configuration

An integrating composition can add one browser row beside the Sidebar stack after supplying the compatible bridge:

```yaml
- name: '@deepseek-ai/dsh-client-ui-browser-panel'
```

The package has no configuration fields. It requires the right-Sidebar tab registry (`sidebarRightTabs`), the right-Sidebar navigator (`sidebarRight`), the keyed `sidebar.right.pane.tab` and `sidebar.right.pane.tab.title` seats, the locale service, and a bridge implementing the earlier WebContentsView operations. The current Desktop preload does not implement that bridge.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin body registers the `browser-panel` locale dictionaries, the `browser` tab type (id `@deepseek-ai/dsh-client-ui-browser-panel`, band `builtin`, guide order 40, claiming no address), the pane body, and the chip title, and reads the desktop bridge once per apply: on the plain web host it is `undefined` and the body renders the localized desktop-only notice. With a bridge, the body subscribes to navigation state (`url`, `title`, `canGoBack`, `canGoForward`, `loading`), opens the view over the surface's layout box — summed from the element's `offsetLeft`/`offsetTop` chain, which is final while ancestor transform animations run — and re-pushes rounded bounds from a `ResizeObserver` on the element, capture-phase `scroll`, window `resize`, and a 300ms settle timer after mount; unmount unsubscribes and hides the view. The next mount re-attaches the same view through the idempotent open verb, so the document, cookies, and history survive every tab switch without a reload. The address bar normalizes input before navigating: text containing whitespace is refused, a bare host gains an `https://` prefix, and only parseable http(s) URLs navigate. The main-process owner keeps one view per application window on the persistent `persist:dsh-embedded-browser` partition, clamps renderer-supplied bounds, denies window opens, and restricts every navigation to http(s). A reveal request opens the browser tab, because automation drives the pane a person is watching and the pane must be on screen for that to be visible, and the toolbar reports the command in flight until it settles.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Plugin body: dictionaries, tab type, keyed seats, and the once-per-apply bridge read |
| [`src/client/definition.tsx`](src/client/definition.tsx) | The `browser` tab-type definition and its guide entry |
| [`src/client/BrowserPanel.tsx`](src/client/BrowserPanel.tsx) | Toolbar, address bar, bounds pushing, state subscription, and the desktop-only notice |
| [`src/client/bridge.ts`](src/client/bridge.ts) | The structural `window.dshDesktop.browser` face, layout-offset and rect bounds rounding, and URL normalization |
| [`src/client/BrowserTabBody.tsx`](src/client/BrowserTabBody.tsx), [`BrowserTitle.tsx`](src/client/BrowserTitle.tsx) | Seat adapters: the injected bridge into the pane; the globe mark before the chip title |
| [`src/client/locales.ts`](src/client/locales.ts) | `browser-panel` zh/en dictionaries; the Chinese key set is the source of truth |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-sidebar-right](../ui-sidebar-right/README.md) — the tab registry, the keyed seats, and the navigation controller this package registers into.
- [ui-sidebar-browser](../ui-sidebar-browser/README.md) — the shared browser panel mounted in current Desktop profiles; this older panel is retained as source but is not mounted.

-----

<a id="model-experience"></a>
## Model Experience

None, as the pane only steers a desktop-owned view through the preload bridge; no verb reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No invariant companion is published because the pane keeps no cross-entry state; the view lives in the desktop main process, and the panel only forwards measurements and intents over the preload bridge.

- The shipped Desktop does not mount this package and its guest bridge does not implement the required WebContentsView operations.
- A plain web host shows the notice and cannot browse.
- One view instance per application window: a second browser tab reuses the same view, and hiding a tab keeps it alive; the view and its browsing state are destroyed only with the window.
- Placement rides renderer measurements pushed over IPC; the native view can visually lag DOM layout by a frame while the sidebar animates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
