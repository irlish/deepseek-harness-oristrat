# @deepseek-ai/dsh-guard-msce-gate

English | [中文](README.zh.md)

Hard enforcement half of the Oristrat MSCE norms. The norms section (`dsh-context-oristrat-msce-norms`) makes the discipline prompt-native; this guard wraps `tools/execute` and physically blocks two transitions inside MSCE workspaces (root carries HARNESS.md / FRAMEWORK.md / msce or Brick-family entries):

- `write` / `edit` before any session evidence of Harness-Aware Discovery (a read/glob/grep/skill call naming HARNESS.md, FRAMEWORK.md, AGENTS.md, or the `msce-engine-app-development` skill);
- `bash` git add/commit/push before an `MSCE_SUBMISSION_GATE: PASS` marker newer than the last code-mutation event.

Blocked calls return a structured tool error naming the missing prerequisite, so the model repairs its process instead of stalling. Non-MSCE workspaces and all other tools pass through untouched. The whole guard is scoped to the `oristrat` settings mode owned by `dsh-context-oristrat-msce-norms`: in `work` mode every dispatch passes through unexamined, and a missing or unreadable settings service fails closed to `coding` enforcement.

## Model Experience

No prompt, schema, or session-log change: the guard only refuses dispatches. Refusals surface as ordinary tool errors the model must address.

## Known Limitations and Deferred Work

- Evidence scanning reads serialized session events; a mutation performed through an unwatched tool (future code-mutation tools) bypasses the gate until added to MUTATION_TOOLS.
- The PASS marker is model-authored text; the guard orders it against mutations but cannot verify the review quality behind it.
