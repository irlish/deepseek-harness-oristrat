/** Wire types of the read-only repository environment Remote namespace. */

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
