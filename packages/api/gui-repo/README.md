---
description: "Repository environment Remote BFF: branch, upstream divergence, working-tree change totals, remote sources, and the serving host name over one-shot local git invocations, plus local-branch listing, checkout, and create-and-checkout."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-gui-repo

English | [中文](README.zh.md)

## Summary

Use this package to give the Web GUI a view of one directory's git environment. The `status` verb snapshots the worktree root, branch, upstream ahead/behind, change and untracked totals, host name, and remote list through one-shot local `git` invocations via `ctx.subprocess`. Three branch verbs accompany it: `branches` lists local branches, `checkout` switches to one (`git switch -- <branch>`), and `createBranch` validates the name, then creates-and-switches. Committing and pushing have no surface by product decision. Nothing touches the network; every invocation is time-bounded, and failures read as absent facts.

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

Mount the controller on the Host beside the Typert Gateway and a subprocess provider; the `dsh-web-app` bundle inserts the row for the shipped composition. Browser clients call `ctx.remote.guiRepo.status({ cwd })` — `cwd` is the absolute directory to inspect and defaults to the server process's working directory — and receive one `GuiRepoStatusValue` snapshot. `branches({ cwd })` answers the local listing, and `checkout({ cwd, branch })` and `createBranch({ cwd, name })` answer `{ ok }` or `{ ok: false, error }` carrying git's own refusal message.

| Field | Meaning |
|---|---|
| `repo` | Whether a git worktree was found at or above `cwd` |
| `root` | Absolute worktree root; absent while `repo` is false |
| `branch` | Current branch name, the short HEAD sha while detached, or the unborn branch name before the first commit |
| `ahead` / `behind` | Commits on HEAD not yet on its upstream, and on the upstream not yet on HEAD; both absent without a configured upstream |
| `additions` / `deletions` | Line totals across `git diff --numstat HEAD`; binary entries add none |
| `files` | Changed tracked files plus untracked, non-ignored files |
| `host` | Host machine name serving the request; always present |
| `sources` | Configured git remotes, deduplicated by name and URL |

### When to choose it

Choose it when a browser surface must report where a directory's repository stands — branch, divergence, pending changes, remotes — without mutating anything. Avoid it when the surface needs history, blame, staging, or any write: the namespace has exactly one verb by product decision, and the model-facing agent already reaches git through its bash tool. [`@deepseek-ai/dsh-client-ui-repo-panel`](../../client/ui-repo-panel/README.md) is the shipped consumer.

### Minimal configuration

Mount the service with no configuration, on a Host that provides `typert` (the gateway) and `subprocess`:

```yaml
- name: '@deepseek-ai/dsh-api-gui-repo'
```

The service has no configuration fields. Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`; [`@deepseek-ai/dsh-api-remotes`](../remotes/README.md) aggregates the client artifact into `ctx.remote.guiRepo`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`GuiRepoController` extends `TypertRemoteService` under the namespace `guiRepo`; four `@Remote` methods are the whole surface. One `status` call first resolves the worktree root with `git rev-parse --show-toplevel`; a failure returns `{ repo: false, host, sources: [] }` immediately. Inside a worktree, five invocations run concurrently: branch (`rev-parse --abbrev-ref HEAD`, falling back to `symbolic-ref --short HEAD` for an unborn branch and to the short sha when detached), upstream divergence (`rev-list --left-right --count @{upstream}...HEAD`), tracked change totals (`diff --numstat HEAD`, folded by `parseNumstat`), untracked files (`ls-files --others --exclude-standard`, counted), and remotes (`remote -v`, deduplicated by `parseRemotes`). Every invocation goes through one private `runGit` helper: `ctx.subprocess.spawn` with `GIT_TERMINAL_PROMPT=0`, stdin ignored, both output streams collected under a 1 MiB cap, a 1-second termination grace, and an 8-second abort timer. A spawn failure, a timeout, and a non-zero exit all read as "no answer" — callers branch on exit codes, never on exceptions — and a per-fact failure degrades to an absent field instead of failing the whole snapshot. `branches` resolves the toplevel the same way, then reads `for-each-ref refs/heads` and the current branch concurrently. The two mutation verbs share one private `mutate` helper: a zero exit answers `{ ok: true }`; anything else answers `{ ok: false, error }` with git's trimmed stderr, its stdout as fallback, then a `git <verb> failed` default. `createBranch` runs the exported `isValidBranchName` guard first — length, ref-legal characters, and the git-refused spellings (leading `-`/`.`, trailing `.`/`/`, `.lock`, `..`, `//`, `@{`) — and refuses without invoking git.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `GuiRepoController`: the `guiRepo` namespace, the four verbs, `runGit`, `mutate`, `isValidBranchName`, `parseNumstat`, `parseRemotes` |
| [`src/types.ts`](src/types.ts) | Wire types `GuiRepoStatusRequest`, `GuiRepoStatusValue`, `GuiRepoSource`, published as `./types` for Client packages |
| [`tests/gui-repo.host.spec.ts`](tests/gui-repo.host.spec.ts) | Host specs: snapshot composition, numstat/remote parsing, failure degradation |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-repo-panel](../../client/ui-repo-panel/README.md) — the browser panel this namespace serves.
- [Remote assembly](../remotes/README.md) — how Client packages reach the `guiRepo` namespace.
- [Subprocess capability](../../subprocess/subprocess/README.md) — the `ctx.subprocess.spawn` contract every git invocation runs through.
- [Typert protocol](../../typert/protocol/README.md) — `TypertRemoteService` and the `@Remote` verb decorator.

-----

<a id="model-experience"></a>
## Model Experience

None, as the namespace serves only the browser repository environment panel; no verb reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No invariant companion is published because every answer is re-derived from local git invocations per request; no mutable fact persists between calls that an independent observation could diverge from.

- The client polls `status`; there is no push stream or filesystem-watch verb, so a change reaches the pane after up to one poll interval.
- Line totals count tracked changes versus HEAD only; untracked files contribute to the file count but not to the added/deleted totals.
- Any authenticated browser client may inspect any directory the host user can read, the same trust level as the Web GUI's agent-facing bash tool; there is no per-user path policy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
