/** Wire types of the repository environment Remote namespace. */

/** One configured git remote of the inspected worktree. */
export interface GuiRepoSource {
  /** Remote name, e.g. `origin`. */
  name: string
  /** Configured fetch URL, verbatim. */
  url: string
}

/** Status request for one directory. */
export interface GuiRepoStatusRequest {
  /** Absolute directory to inspect; the server process cwd when absent. */
  cwd?: string
}

/**
 * Environment snapshot of one directory. Git facts are present only while
 * `repo` is true; `host` always names the machine serving the request.
 */
export interface GuiRepoStatusValue {
  /** Whether a git worktree was found at or above the inspected directory. */
  repo: boolean
  /** Absolute worktree root. */
  root?: string
  /** Current branch name, or the short HEAD sha while detached. */
  branch?: string
  /** Commits on HEAD not yet on its upstream; absent without an upstream. */
  ahead?: number
  /** Commits on the upstream not yet on HEAD; absent without an upstream. */
  behind?: number
  /** Added-line total across the full worktree diff versus HEAD. */
  additions?: number
  /** Deleted-line total across the full worktree diff versus HEAD. */
  deletions?: number
  /** Changed tracked files plus untracked, non-ignored files. */
  files?: number
  /** Host machine name serving the request. */
  host: string
  /** Configured git remotes, deduplicated by name and URL. */
  sources: GuiRepoSource[]
}

/** Branch listing request for one directory. */
export interface GuiRepoBranchesRequest {
  /** Absolute directory to inspect; the server process cwd when absent. */
  cwd?: string
}

/**
 * Local branch listing of one directory. Git facts are present only while
 * `repo` is true.
 */
export interface GuiRepoBranchesValue {
  /** Whether a git worktree was found at or above the inspected directory. */
  repo: boolean
  /** Current branch name, or the short HEAD sha while detached. */
  current?: string
  /** Local branch names in ref order; empty outside a worktree. */
  branches: string[]
}

/** Switch the inspected worktree to one existing local branch. */
export interface GuiRepoCheckoutRequest {
  /** Absolute worktree directory; the server process cwd when absent. */
  cwd?: string
  /** Existing local branch name to check out. */
  branch: string
}

/** Create one new local branch off HEAD and switch the worktree to it. */
export interface GuiRepoCreateBranchRequest {
  /** Absolute worktree directory; the server process cwd when absent. */
  cwd?: string
  /** New branch name; must satisfy git ref-name rules. */
  name: string
}

/** Outcome of one branch mutation verb. */
export interface GuiRepoBranchMutationValue {
  /** Whether the git command exited zero. */
  ok: boolean
  /** git's stderr (or stdout fallback) when `ok` is false. */
  error?: string
}
