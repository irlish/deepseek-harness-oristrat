---
description: "Right-sidebar terminal tab: per-tab PTY sessions over the gui-terminal Remote namespace, with a xterm-style pane, cursor-resumed output polling, and write/close verbs."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-terminal-panel

English | [中文](README.zh.md)

## Summary

Use this package to give every right-Sidebar tab its own interactive shell. The `terminal` tab renders one xterm.js pane bound to one host PTY through `ctx.remote.guiTerminal`: keystrokes write through, output arrives by 60 ms polling with a resume cursor, and unmounting the tab closes the session. Multiple terminals are simply multiple tabs of this type, each with its own PTY, and `⌘J`/`Ctrl+J` opens the page from anywhere in the client. Sessions are browser-scoped rather than agent-scoped; the host controller owns the session table and terminates every PTY with its effect scope.

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

Ship the package as a browser row of the web-app bundle; the shipped composition already inserts it. The tab appears in the right Sidebar's guide as the **Terminal** entry, opens through `ctx.sidebarRight.openTab('terminal')`, and answers the `⌘J`/`Ctrl+J` shortcut. Each opened tab starts its PTY in the workspace root the sessions mirror carries for its session; until the mirror knows it, the shell starts in the server's working directory.

### When to choose it

Choose it when the user needs a direct shell beside the conversation — inspecting state, running one-off commands — without routing through the agent. Avoid it for work the model should see or repeat: the pane is a human surface, its transcript never enters the session log, and the agent's own terminal and bash tools stay the model-facing path. The PTY itself lives in [`@deepseek-ai/dsh-api-gui-terminal`](../../api/gui-terminal/README.md) on the Host; without that namespace the tab type never registers.

### Minimal configuration

Add one browser row beside the Sidebar stack; the web-app bundle already carries it:

```yaml
- name: '@deepseek-ai/dsh-client-ui-terminal-panel'
```

The package has no configuration fields. It requires the right-Sidebar tab registry (`sidebarRightTabs`), the navigation controller (`sidebarRight`), the keyed `sidebar.right.pane.tab` and `sidebar.right.pane.tab.title` seats, the locale service, and the `guiTerminal` Remote namespace.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin body registers the `terminal-panel` locale dictionaries, the `terminal` tab type (id `@deepseek-ai/dsh-client-ui-terminal-panel`, band `builtin`, guide order 20, claiming no address), the pane body under the keyed `sidebar.right.pane.tab` seat, the chip title, and the window-level `⌘J`/`Ctrl+J` shortcut that opens the page in the active docked pane, each under its own effect. The pane mounts one xterm.js `Terminal` (13px, cursor blink, theme colors read from computed CSS variables) with the fit addon; a `ResizeObserver` refits it through sidebar drags, which fire no window resize. Opening a session replays the returned scrollback, forwards `onData` keystrokes through `write`, and starts a 60 ms `read` poll carrying the resume cursor. The poll stops and the status line reports the exited state when the PTY dies with an empty final page, or the failed state with the error detail when a call rejects. Unmount disposes the terminal, clears the poll, and closes the session, so the PTY dies with its tab. The xterm stylesheet installs once per document.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Plugin body: dictionaries, tab type, keyed seats, the `guiTerminal` wire face, and the open shortcut |
| [`src/client/definition.tsx`](src/client/definition.tsx) | The `terminal` tab-type definition and its guide entry |
| [`src/client/TerminalWorkspace.tsx`](src/client/TerminalWorkspace.tsx) | The pane: xterm lifecycle, PTY open/write/poll/close, and the status line |
| [`src/client/TerminalTabBody.tsx`](src/client/TerminalTabBody.tsx), [`TerminalTitle.tsx`](src/client/TerminalTitle.tsx) | Seat adapters: the session workspace root into the pane; the terminal mark before the chip title |
| [`src/client/xterm-css.ts`](src/client/xterm-css.ts), [`locales.ts`](src/client/locales.ts) | The once-installed xterm stylesheet; `terminal-panel` zh/en dictionaries |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-sidebar-right](../ui-sidebar-right/README.md) — the tab registry, the keyed seats, and the navigation controller this package registers into.
- [gui-terminal](../../api/gui-terminal/README.md) — the Host PTY controller behind `ctx.remote.guiTerminal`.
- [Remote assembly](../../api/remotes/README.md) — how `ctx.remote.guiTerminal` reaches the browser.
- [Terminal sessions](../../terminal/terminal/README.md) — the agent-scoped PTY family the browser sessions deliberately do not join.

-----

<a id="model-experience"></a>
## Model Experience

None, as the pane only drives the `guiTerminal` Remote namespace; no verb reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No invariant companion is published because the pane keeps no cross-entry state; the PTY lifecycle is owned by the host controller and its effect scope.

- Output arrives by 60 ms polling of `read` with a resume cursor rather than the host's `output` stream verb; a push client is deferred work.
- The pane keeps its open-time PTY geometry; the host terminal surface exposes no resize verb, so refits are visual only.
- No PTY restore across reloads: tab state is memory-only, so a browser reload shows no terminal tabs, and a PTY opened by the old page stays on the Host until the controller's effect scope tears down.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
