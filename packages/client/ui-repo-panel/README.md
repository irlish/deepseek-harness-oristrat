---
description: "Session-header repository environment menu: branch, upstream divergence, change totals, host name, and remote sources for the session workspace, plus local-branch switching, served by the gui-repo Remote namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-repo-panel

English | [中文](README.zh.md)

## Summary

Use this package to surface the session's repository environment in the Session header. The trigger opens one popover per session: the current branch with upstream ahead/behind, working-tree change totals against HEAD (`+X -Y · N files`, untracked counted in N), the host name, and remote sources. The branch row's submenu lists local branches behind a search filter, checks out the picked branch, and creates-and-checks-out a new one from a draft. Facts arrive through `ctx.remote.guiRepo` and re-poll every four seconds while open. Committing and pushing stay absent by product decision.

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

Ship the package as a browser row of the web-app bundle; the shipped composition already inserts it. The trigger then renders in every Session header's utilities cluster, beside the Session menu button, and opens its popover on click. The menu inspects the workspace root the sessions mirror carries for the current session; until the mirror knows it, the Host falls back to the server's working directory.

### When to choose it

Choose it to surface where the session's workspace stands — branch, divergence, pending changes, remotes — and to switch branches without leaving the conversation. Avoid it when the user must publish history: staging, committing, and pushing are deliberately absent, and the agent's bash tool remains the only publishing path. The client plugin waits for the `remote.guiRepo` namespace, so a composition without [`@deepseek-ai/dsh-api-gui-repo`](../../api/gui-repo/README.md) on the Host never registers the menu.

### Minimal configuration

Add one browser row beside the header stack; the web-app bundle already carries it:

```yaml
- name: '@deepseek-ai/dsh-client-ui-repo-panel'
```

The package has no configuration fields. It requires the `conversation.session.header.utilities` seat, the locale service, and the `guiRepo` Remote namespace.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin body registers two things under effects: the `repo-panel` locale dictionaries and one `conversation.session.header.utilities` entry (id `repo-env`, order 0). The action reads the session's `cwd` from the sessions mirror and, while open, runs one poll loop: an immediate `status` read, a fixed 4-second interval refresh, and — while the branch submenu is open — the same cadence for `branches`. A failed read keeps the loading note; a session without a workspace and a directory outside any worktree render their own notes instead of the rows. The submenu filters the listing by substring, marks the current branch with a checked radio row, and routes picks through `checkout` (`git switch`) and the draft form through `createBranch` (`git switch --create`); a refused mutation shows git's own message inside the submenu. Escape and outside pointer-down dismiss the popover.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Plugin body: dictionaries and the header utilities entry with the `guiRepo` wire face |
| [`src/client/RepoEnvAction.tsx`](src/client/RepoEnvAction.tsx) | Trigger, popover, environment rows, branch submenu, poll loop, and mutation handlers |
| [`src/client/glyphs.tsx`](src/client/glyphs.tsx) | The branch glyph drawn on currentColor for the trigger and the branch row |
| [`src/client/locales.ts`](src/client/locales.ts) | `repo-panel` zh/en dictionaries; the Chinese key set is the source of truth |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-conversation](../ui-conversation/README.md) — the Session header whose utilities seat this package registers into.
- [gui-repo](../../api/gui-repo/README.md) — the Host namespace that gathers every fact the menu renders and runs its branch verbs.
- [Remote assembly](../../api/remotes/README.md) — how `ctx.remote.guiRepo` reaches the browser.

-----

<a id="model-experience"></a>
## Model Experience

None, as the menu only reads and switches branches through the `guiRepo` Remote namespace; no verb reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No invariant companion is published because the menu keeps no cross-entry state; every fact is fetched per open and poll, and the seat lifetimes are asserted by this package's specs.

- Four-second polling with no push channel: divergence and change totals can lag one poll behind the actual worktree.
- Change totals are tracked-only (`git diff --numstat HEAD`); untracked files add to the file count but contribute no `+`/`-` lines.
- Ahead/behind rows are omitted entirely without a configured upstream rather than shown as zero.
- Publishing history is absent by product decision: staging, committing, and pushing have no surface here and stay with the agent's bash tool; branch switching is the menu's only mutation.
- The branch submenu lists local branches only; remote-tracking refs are neither listed nor fetched.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
