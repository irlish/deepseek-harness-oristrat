---
description: "Browser-interactive terminal Remote BFF: one PTY per browser session over the subprocess terminal surface, exposed as unary verbs plus a cursor-resumable output stream."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-gui-terminal

English | [中文](README.zh.md)

## Summary

Use this package to give the Web GUI interactive shell panes. Each browser terminal tab owns one PTY spawned through `ctx.subprocess.spawnTerminal`, and the Typert gateway exposes `open`, `write`, `read`, `close`, and `list` verbs plus a cursor-resumable `output` stream over the shared Remote mux. Sessions are host-process scoped rather than agent scoped: the model-facing `ctx.terminals` family fences sessions behind live Agent owners, which a browser panel does not have, so this controller owns its session table and terminates every PTY with its effect scope.

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

Mount the controller on the Host beside the Typert Gateway and a subprocess provider; the `dsh-web-app` bundle inserts the row for the shipped composition. A browser client calls `ctx.remote.guiTerminal.open({ cwd?, cols?, rows? })`, receives `{ id, scrollback, cursor }`, then writes keystrokes, reads output from its cursor, and closes the session when its pane unmounts. `cwd` defaults to the server process's working directory and the geometry to 120×30.

| Verb | Returns | Purpose |
|---|---|---|
| `open({ cwd?, cols?, rows? })` | `{ id, scrollback, cursor }` | Spawn one interactive shell PTY — the login shell from `$SHELL` (fallback `/bin/bash`), `powershell.exe -NoLogo` on Windows — with `TERM=xterm-256color` and a 1-second termination grace |
| `write({ id, data })` | — | Forward raw terminal input bytes to the PTY |
| `read({ id, cursor })` | `{ frames, cursor, alive }` | Retained frames at or after the cursor, the resume cursor, and liveness, without parking |
| `output({ id, cursor })` | stream of `{ seq, data }` | Retained frames first, then live frames until the PTY exits or the generation cancels |
| `close({ id })` | — | Terminate the session's PTY process tree and forget the session; an unknown id closes nothing |
| `list()` | `{ id, alive }[]` | Liveness summaries of every session, in open order |

`write`, `read`, and `output` throw on an unknown session id.

### When to choose it

Choose it when a browser surface needs its own interactive shell per pane — a human terminal beside the conversation. Avoid it for model-driven terminal work: the agent-facing session family in [`@deepseek-ai/dsh-terminal`](../../terminal/terminal/README.md) fences PTYs behind live Agent owners and is the model's path. [`@deepseek-ai/dsh-client-ui-terminal-panel`](../../client/ui-terminal-panel/README.md) is the shipped consumer.

### Minimal configuration

Mount the service with no configuration, on a Host that provides `typert` (the gateway) and `subprocess`:

```yaml
- name: '@deepseek-ai/dsh-api-gui-terminal'
```

The service has no configuration fields. Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`; [`@deepseek-ai/dsh-api-remotes`](../remotes/README.md) aggregates the client artifact into `ctx.remote.guiTerminal`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The controller keeps one in-memory session table with ids minted as `gui-<n>`. `open` spawns the platform shell through `ctx.subprocess.spawnTerminal` and subscribes the session's bounded ring: every PTY output chunk becomes one `{ seq, data }` frame, and the ring retains the newest 2048 frames, so a reconnecting client resumes from its cursor until it falls more than 2048 frames behind and silently skips the gap. `read` answers from the ring without parking; an `output` generation parks on a waiter set that each push, the PTY's exit, and the generation's abort signal wake. The PTY's `done` promise settling either way marks the session dead, which finishes parked streams and makes `read` report `alive: false` with its last frames. `close` removes one session and terminates its PTY process tree; the controller's effect-scope teardown terminates every remaining PTY on plugin unload, so no session outlives the Host composition.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `GuiTerminalController`: the `guiTerminal` namespace, the session table, the bounded output ring, and the six verbs |
| [`src/types.ts`](src/types.ts) | Wire types for requests, frames, and results, published as `./types` for Client packages |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-terminal-panel](../../client/ui-terminal-panel/README.md) — the browser pane this namespace serves.
- [Remote assembly](../remotes/README.md) — how Client packages reach the `guiTerminal` namespace.
- [Subprocess capability](../../subprocess/subprocess/README.md) — the `spawnTerminal` PTY surface sessions are spawned through.
- [Terminal sessions](../../terminal/terminal/README.md) — the agent-scoped PTY family this namespace deliberately does not reuse.

-----

<a id="model-experience"></a>
## Model Experience

None, as the namespace serves only the browser terminal panel; no verb reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No invariant companion is published because the session table is private to this controller and every PTY is terminated with its effect scope; no independent observation exists to diverge from it.

- No PTY resize verb: the subprocess terminal handle exposes no resize, so a session keeps its open-time geometry (120×30 default) while the browser pane reflows visually.
- The shipped client polls `read` at 60ms instead of consuming the `output` stream; the stream verb exists for a future push client.
- Output retention is bounded at 2048 frames per session; a client that falls further behind resumes from the oldest retained frame and loses the gap.
- Any authenticated browser client may open a shell, the same trust level as the Web GUI's agent-facing bash tool; there is no per-user shell policy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
