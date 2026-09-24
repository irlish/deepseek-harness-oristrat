---
description: "Hard Oristrat MSCE gates on the tool-execution waterfall: discovery evidence before code mutation and a submission-gate PASS before git handoff, inside MSCE workspaces and the coding settings mode."
kind: "package-reference"
---

# @deepseek-ai/dsh-guard-msce-gate

English | [中文](README.zh.md)

## Summary

Use this package to physically enforce two Oristrat MSCE rules the norms section states as prose. Wrapping `tools/execute` inside MSCE workspaces — a root carrying HARNESS.md, FRAMEWORK.md, or msce/Brick-family entries — it blocks `write`/`edit` before the session shows Harness-Aware Discovery evidence, and blocks `bash` git add/commit/push before an `MSCE_SUBMISSION_GATE: PASS` marker newer than the last code mutation. Blocked calls return a structured tool error naming the missing prerequisite, so the model repairs its process instead of stalling. Non-MSCE workspaces and all other tools pass through untouched, and the whole guard lifts in the `oristrat-msce-norms` plugin's `work` mode.

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

Mount the guard beside the tools runtime in a deployment that also carries [`@deepseek-ai/dsh-context-oristrat-msce-norms`](../../context/oristrat-msce-norms/README.md); the `dsh-base` bundle already carries both rows. The two gates then apply to every agent whose session workspace root carries an MSCE marker — HARNESS.md, FRAMEWORK.md, or msce/Brick-family entries — with no further configuration.

### When to choose it

Choose it when MSCE process rules must hold even if the model skips them: prompt text alone cannot stop a `write` before discovery or a `git commit` before the submission gate. Avoid it outside Oristrat MSCE deployments — the refusal copy is MSCE-specific Chinese text — and avoid relying on it as the whole discipline: it enforces two transitions, while the norms section explains the rest. This guard only enforces; it never adds prompt or schema text of its own.

### Minimal configuration

Mount the plugin with no configuration:

```yaml
- name: '@deepseek-ai/dsh-guard-msce-gate'
```

The plugin has no configuration fields. It injects the `tools` runtime and reads the `oristrat-msce-norms` plugin configuration through `ctx.get('settings')` when present; an absent or unreadable settings service fails closed to `coding` enforcement.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One `tools/execute` listener carries both gates. Per dispatch it first reads the mode — `work` passes every call through unexamined — then resolves the session workspace root and probes it for MSCE markers; a session without a workspace, or a workspace without a marker, passes through. Evidence is the serialized session event list: discovery is any event text naming a read-style tool (`read`, `glob`, `grep`, or `skill`) together with HARNESS.md, FRAMEWORK.md, AGENTS.md, or the `msce-engine-app-development` skill, and the submission gate orders the newest `MSCE_SUBMISSION_GATE: PASS` occurrence against the newest code-mutation (`write`/`edit`) event, refusing a git add/commit/push the marker does not postdate. A refusal replaces the dispatch with a structured error result — `isError: true`, name `MsceGateError`, code `MSCE_GATE` — whose text names the missing prerequisite and the repair step; the waterfall never reaches `next()` for a blocked call. Marker detection is synchronous filesystem probing: `existsSync` for the two files and one `readdirSync` for the entry shapes; an unreadable root reads as non-MSCE.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The plugin: marker detection, mode scope, evidence scanning, and the two refusals |
| [`tests/mode.spec.ts`](tests/mode.spec.ts) | Specs: each accept/reject path and the work-mode and fail-closed scope |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [oristrat-msce-norms](../../context/oristrat-msce-norms/README.md) — the prompt-native half and the owner of the mode this guard reads.
- [Tools subsystem reference](../../../docs/subsystems/tools.md) — the `tools/execute` waterfall this guard wraps.
- [timeout-policy](../timeout-policy/README.md) — a sibling guard with the same conditional-tool-result shape.
- [guard group map](../README.md) — the sibling guard packages and the loop-hygiene family.

-----

<a id="model-experience"></a>
## Model Experience

### Conditional tool result

#### What the model sees

No prompt, schema, or session-log addition: the guard only refuses dispatches. A blocked call returns an ordinary tool error result whose text is `Error: ` plus one of the two refusal messages below, with the structured `MsceGateError` (code `MSCE_GATE`) beside it; passing calls are untouched.

##### Discovery-gate refusal

```markdown
Error: MSCE 门禁阻断：MSCE 工作区内修改代码前必须完成 Harness-Aware Discovery。请先 read/glob 本项目的 HARNESS.md / FRAMEWORK.md / AGENTS.md（或加载 skill msce-engine-app-development），让 loader 或示例决定读取范围后再重试本次写入。
```

##### Submission-gate refusal

```markdown
Error: MSCE 门禁阻断：git add/commit/push 需要先有晚于最后一次代码修改的 MSCE_SUBMISSION_GATE: PASS。请先完成候选范围验证与 MSCE_COMMENT_REVIEW（View 另加 VIEW_COMMENT_REVIEW），在回复中输出 PASS 结论后重试。
```

#### Token effect

Zero tokens on passing dispatches. A refusal adds one retained tool-error result and replaces the would-be tool output; the model's repair attempts add their own ordinary turns.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV Cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No invariant companion is published because the gate is a pure per-request check with no retained state; its specs assert each accept/reject path directly.

- Evidence scanning reads serialized session events; a mutation performed through an unwatched tool bypasses the gate until that tool is added to `MUTATION_TOOLS`.
- The PASS marker is model-authored text; the guard orders it against mutations but cannot verify the review quality behind it.
- Marker detection probes only the workspace root; an MSCE subtree inside an otherwise unmarked repository keeps both gates off.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
