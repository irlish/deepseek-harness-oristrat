---
description: "Right-sidebar repository environment tab: read-only branch, upstream divergence, change totals, host name, and remote sources for the session workspace, served by the gui-repo Remote namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-repo-panel

English | [中文](README.zh.md)

## Summary

Use this package to show the session's repository environment in the right Sidebar. The `repo` tab renders one read-only card per session: the current branch with ahead/behind divergence against the configured upstream, working-tree change totals against HEAD (`+X -Y · N files`, untracked files counted in N), the serving host name, and the repository's remote sources. Facts arrive through `ctx.remote.guiRepo.status` for the session's workspace root and re-poll every four seconds while the pane is open; a manual refresh reads immediately. The panel performs no write operations — no commit, push, or checkout — by product decision.

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

Ship the package as a browser row of the web-app bundle; the shipped composition already inserts it. The tab then appears in the right Sidebar's guide as the **Repository environment** entry and opens through `ctx.sidebarRight.openTab('repo')` like any other page type. The card inspects the workspace root the sessions mirror carries for the current session; until the mirror knows it, the Host falls back to the server's working directory.

### When to choose it

Choose it to surface where the session's workspace stands — branch, divergence, pending changes, remotes — as ambient, read-only context beside the conversation. Avoid it when the user must act on the repository: staging, committing, and pushing are deliberately absent, and the agent's bash tool remains the only mutating path. The client plugin waits for the `remote.guiRepo` namespace, so a composition without [`@deepseek-ai/dsh-api-gui-repo`](../../api/gui-repo/README.md) on the Host never registers the tab.

### Minimal configuration

Add one browser row beside the Sidebar stack; the web-app bundle already carries it:

```yaml
- name: '@deepseek-ai/dsh-client-ui-repo-panel'
```

The package has no configuration fields. It requires the right-Sidebar tab registry (`sidebarRightTabs`), the keyed `sidebar.right.pane.tab` and `sidebar.right.pane.tab.title` seats, the locale service, and the `guiRepo` Remote namespace.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin body registers four things under effects: the `repo-panel` locale dictionaries, the `repo` tab type (id `@deepseek-ai/dsh-client-ui-repo-panel`, band `builtin`, guide order 30, claiming no address), the pane body under the keyed `sidebar.right.pane.tab` seat, and the chip title under `sidebar.right.pane.tab.title`. The body reads the session's `cwd` from the sessions mirror and hands it to one poll loop: an immediate `status` read on mount, a fixed 4-second interval refresh, and a manual refresh button. A failed read adds the localized error line while the rows keep the last successful snapshot; a directory outside any worktree renders the not-a-repo state instead of the rows. Divergence renders whichever of `ahead`/`behind` the Host reported, and is omitted entirely without a configured upstream.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Plugin body: dictionaries, tab type, keyed seats, and the `guiRepo` wire face |
| [`src/client/definition.tsx`](src/client/definition.tsx) | The `repo` tab-type definition and its guide entry |
| [`src/client/RepoPanel.tsx`](src/client/RepoPanel.tsx) | The environment card: poll loop, refresh, rows, error and not-a-repo states |
| [`src/client/RepoTabBody.tsx`](src/client/RepoTabBody.tsx), [`RepoTitle.tsx`](src/client/RepoTitle.tsx) | Seat adapters: the session workspace root into the card; the branch mark before the chip title |
| [`src/client/locales.ts`](src/client/locales.ts) | `repo-panel` zh/en dictionaries; the Chinese key set is the source of truth |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-sidebar-right](../ui-sidebar-right/README.md) — the tab registry, the keyed seats, and the navigation controller this package registers into.
- [gui-repo](../../api/gui-repo/README.md) — the Host namespace that gathers every fact the card renders.
- [Remote assembly](../../api/remotes/README.md) — how `ctx.remote.guiRepo` reaches the browser.

-----

<a id="model-experience"></a>
## Model Experience

None, as the panel only reads the `guiRepo` Remote namespace; no verb reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No invariant companion is published because the panel keeps no cross-entry state; every fact is fetched per mount and poll, and the seat lifetimes are asserted by this package's specs.

- Four-second polling with no push channel: divergence and change totals can lag one poll behind the actual worktree.
- Change totals are tracked-only (`git diff --numstat HEAD`); untracked files add to the file count but contribute no `+`/`-` lines.
- Ahead/behind rows are omitted entirely without a configured upstream rather than shown as zero.
- Read-only by product decision: staging, committing, and pushing have no surface here and stay with the agent's bash tool.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
