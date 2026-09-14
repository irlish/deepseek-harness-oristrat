---
description: "Browser-interactive terminal Remote BFF: one PTY per browser session over the subprocess terminal surface, exposed as unary verbs plus a cursor-resumable output stream."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-gui-terminal

English | [中文](README.zh.md)

## Summary

`gui-terminal` gives the Web GUI an interactive shell panel: each browser terminal tab owns one PTY spawned through `ctx.subprocess.spawnTerminal`, and the Typert gateway exposes `open`, `write`, `read`, `close`, `list`, plus a stream `output` over the shared Remote mux. Sessions are host-process scoped rather than agent scoped: the model-facing `ctx.terminals` family fences sessions behind live Agent owners, which a browser panel does not have, so this controller owns its session table and terminates every PTY with its effect scope. Output is retained in a bounded per-session ring (2048 frames) so a reconnecting client resumes from a cursor.

## Model Experience

None. No verb reaches a model request; the namespace serves only the browser terminal panel (`@deepseek-ai/dsh-client-ui-terminal-panel`).

## Known Limitations and Deferred Work

- No PTY resize verb: the subprocess terminal handle exposes no resize, so a session keeps its open-time geometry (120×30 default) while the browser pane reflows visually.
- The shipped client polls `read` at 60ms instead of consuming the `output` stream; the stream verb exists for a future push client.
- Any authenticated browser client may open a shell, the same trust level as the Web GUI's agent-facing bash tool; there is no per-user shell policy.
