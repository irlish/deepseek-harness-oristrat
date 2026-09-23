/**
 * Host owner of the browser-facing repository environment Remote namespace:
 * read-only git facts (branch, upstream divergence, working-tree change
 * totals, remote sources) plus the serving machine's name, gathered with
 * one-shot `git` invocations through the subprocess capability, and the two
 * branch-switching verbs the environment menu drives (checkout of an
 * existing local branch, create-and-checkout of a new one).
 *
 * Every verb is local: no command touches the network, so no credential can
 * be prompted for and none is forwarded. The namespace deliberately has no
 * commit or push surface — the menu it backs reports the environment and
 * switches branches, it never publishes history.
 */

import { hostname } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  GuiRepoBranchMutationValue,
  GuiRepoBranchesRequest,
  GuiRepoBranchesValue,
  GuiRepoCheckoutRequest,
  GuiRepoCreateBranchRequest,
  GuiRepoSource,
  GuiRepoStatusRequest,
  GuiRepoStatusValue,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host repository-environment Remote namespace owner. */
    guiRepoController: GuiRepoController
  }
}

/** Wall-clock bound on one local git invocation before it is terminated. */
const GIT_COMMAND_TIMEOUT_MS = 8_000

/** In-memory collection cap per git output stream. */
const MAX_GIT_OUTPUT_BYTES = 1_048_576

/** Exit code and collected output of one finished git invocation. */
interface GitRun {
  /** Process exit code; null when terminated by signal or spawn failure. */
  exitCode: number | null
  /** Collected stdout text ('' when the stream never produced output). */
  stdout: string
  /** Collected stderr text ('' when the stream never produced output). */
  stderr: string
}

/** Sum of one `git diff --numstat` listing: line totals and file count. */
interface NumstatTotals {
  /** Added lines across numeric entries; binary `-` entries add none. */
  additions: number
  /** Deleted lines across numeric entries; binary `-` entries add none. */
  deletions: number
  /** Entry count, one per changed tracked file. */
  files: number
}

/**
 * Parse one `git diff --numstat` listing.
 * @param stdout - raw numstat output.
 * @returns line totals and the changed-file count.
 */
export function parseNumstat(stdout: string): NumstatTotals {
  const totals: NumstatTotals = { additions: 0, deletions: 0, files: 0 }
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue
    const [added, deleted] = line.split('\t')
    totals.files += 1
    if (added !== undefined && added !== '-') totals.additions += Number(added)
    if (deleted !== undefined && deleted !== '-') totals.deletions += Number(deleted)
  }
  return totals
}

/**
 * Parse one `git remote -v` listing, deduplicated by name and URL.
 * @param stdout - raw remote listing.
 * @returns remotes in first-seen order.
 */
export function parseRemotes(stdout: string): GuiRepoSource[] {
  const seen = new Set<string>()
  const sources: GuiRepoSource[] = []
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue
    const [name, url] = line.split(/\s+/)
    if (name === undefined || url === undefined) continue
    const key = `${name}\u0000${url}`
    if (seen.has(key)) continue
    seen.add(key)
    sources.push({ name, url })
  }
  return sources
}

/**
 * Whether one text may name a new git branch: the ref-name subset git
 * accepts for `checkout -b`, minus the spellings git rejects (leading dash
 * or dot, doubled separators, `@{`, `.lock` suffix, trailing slash or dot).
 * @param name - candidate branch name from the environment menu.
 * @returns true when `git checkout -b` may receive the name verbatim.
 */
export function isValidBranchName(name: string): boolean {
  if (name.length === 0 || name.length > 100) return false
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) return false
  if (name.startsWith('-') || name.startsWith('.') || name.endsWith('.') || name.endsWith('/')) return false
  if (name.endsWith('.lock')) return false
  if (name.includes('..') || name.includes('//') || name.includes('@{')) return false
  return true
}

/** Host service backing the generated `ctx.remote.guiRepo` namespace. */
export class GuiRepoController extends TypertRemoteService {
  static inject = ['typert', 'subprocess']

  /** @param ctx - Host context carrying the subprocess capability. */
  constructor(ctx: Context) {
    super(ctx, 'guiRepoController', { namespace: 'guiRepo' })
  }

  /**
   * Snapshot the repository environment of one directory.
   * @param request - optional absolute directory; the server cwd when absent.
   * @returns branch, divergence, change totals, sources, and the host name;
   * git facts absent while the directory is not inside a worktree.
   */
  @Remote('status')
  async status(request: GuiRepoStatusRequest): Promise<GuiRepoStatusValue> {
    const cwd = request.cwd ?? process.cwd()
    const host = hostname()
    const toplevel = await this.runGit(['rev-parse', '--show-toplevel'], cwd)
    if (toplevel.exitCode !== 0) {
      return { repo: false, host, sources: [] }
    }
    const root = toplevel.stdout.trim()
    const [branchRun, upstreamRun, numstatRun, untrackedRun, remoteRun] = await Promise.all([
      this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root),
      this.runGit(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], root),
      this.runGit(['diff', '--numstat', 'HEAD'], root),
      this.runGit(['ls-files', '--others', '--exclude-standard'], root),
      this.runGit(['remote', '-v'], root),
    ])

    let branch = branchRun.stdout.trim()
    if (branchRun.exitCode !== 0) {
      // No commits yet: an unborn branch still reports its name.
      const symbolic = await this.runGit(['symbolic-ref', '--short', 'HEAD'], root)
      branch = symbolic.exitCode === 0 ? symbolic.stdout.trim() : ''
    } else if (branch === 'HEAD') {
      const sha = await this.runGit(['rev-parse', '--short', 'HEAD'], root)
      /* v8 ignore next -- abbrev-ref prints HEAD only when the commit resolves; a broken config fails show-toplevel first. */
      branch = sha.exitCode === 0 ? sha.stdout.trim() : 'HEAD'
    }

    const totals = numstatRun.exitCode === 0 ? parseNumstat(numstatRun.stdout) : { additions: 0, deletions: 0, files: 0 }
    const untracked = untrackedRun.exitCode === 0
      ? untrackedRun.stdout.split('\n').filter(line => line.length > 0).length
      : 0

    const value: GuiRepoStatusValue = {
      repo: true,
      root,
      branch,
      additions: totals.additions,
      deletions: totals.deletions,
      files: totals.files + untracked,
      host,
      /* v8 ignore next -- a broken config fails show-toplevel first, so remote -v cannot fail on a repo:true path. */
      sources: remoteRun.exitCode === 0 ? parseRemotes(remoteRun.stdout) : [],
    }
    if (upstreamRun.exitCode === 0) {
      const [behind, ahead] = upstreamRun.stdout.trim().split('\t')
      /* v8 ignore next -- rev-list --count always prints both columns; the guard only narrows the noUncheckedIndexedAccess split. */
      if (behind !== undefined && ahead !== undefined) {
        value.behind = Number(behind)
        value.ahead = Number(ahead)
      }
    }
    return value
  }

  /**
   * List the local branches of one directory's worktree.
   * @param request - optional absolute directory; the server cwd when absent.
   * @returns the branch names in ref order and the current one; empty
   * listing while the directory is not inside a worktree.
   */
  @Remote('branches')
  async branches(request: GuiRepoBranchesRequest): Promise<GuiRepoBranchesValue> {
    const cwd = request.cwd ?? process.cwd()
    const toplevel = await this.runGit(['rev-parse', '--show-toplevel'], cwd)
    if (toplevel.exitCode !== 0) return { repo: false, branches: [] }
    const root = toplevel.stdout.trim()
    const [listRun, currentRun] = await Promise.all([
      this.runGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], root),
      this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root),
    ])
    const value: GuiRepoBranchesValue = {
      repo: true,
      branches: listRun.exitCode === 0 ? listRun.stdout.split('\n').filter(line => line.length > 0) : [],
    }
    if (currentRun.exitCode === 0) value.current = currentRun.stdout.trim()
    return value
  }

  /**
   * Switch one worktree to an existing local branch.
   * @param request - worktree directory and branch name.
   * @returns the git outcome; a dirty-tree refusal reports `ok: false` with
   * git's own message.
   */
  @Remote('checkout')
  async checkout(request: GuiRepoCheckoutRequest): Promise<GuiRepoBranchMutationValue> {
    return this.mutate(['switch', '--', request.branch], request.cwd)
  }

  /**
   * Create one new local branch off HEAD and switch the worktree to it.
   * @param request - worktree directory and new branch name.
   * @returns the git outcome; a name git rejects reports `ok: false` without
   * running git at all.
   */
  @Remote('createBranch')
  async createBranch(request: GuiRepoCreateBranchRequest): Promise<GuiRepoBranchMutationValue> {
    if (!isValidBranchName(request.name)) return { ok: false, error: `invalid branch name: ${request.name}` }
    // No `--` here: switch reads the token after `--create` as the new name,
    // and isValidBranchName already rules out option-like spellings.
    return this.mutate(['switch', '--create', request.name], request.cwd)
  }

  /**
   * Run one worktree-mutating git command and report its outcome.
   * @param args - git arguments after the executable; branch operands carry
   * `--` where switch accepts it so a same-named path cannot shadow them.
   * @param cwd - optional worktree directory; the server cwd when absent.
   * @returns `ok` with no error, or git's stderr (stdout fallback) as the error.
   */
  private async mutate(args: readonly string[], cwd: string | undefined): Promise<GuiRepoBranchMutationValue> {
    const run = await this.runGit(args, cwd ?? process.cwd())
    if (run.exitCode === 0) return { ok: true }
    const message = run.stderr.trim() || run.stdout.trim()
    return { ok: false, error: message.length > 0 ? message : `git ${args[0]} failed` }
  }

  /**
   * Run one local git invocation to completion under a wall-clock bound.
   * @param args - git arguments; the executable is always `git`.
   * @param cwd - working directory of the invocation.
   * @returns exit code and collected stdout; a spawn failure or timeout
   * reports `exitCode: null` instead of rejecting the caller.
   */
  private async runGit(args: readonly string[], cwd: string): Promise<GitRun> {
    const abort = new AbortController()
    const timer = setTimeout(() => { abort.abort() }, GIT_COMMAND_TIMEOUT_MS)
    try {
      const handle = this.ctx.subprocess.spawn({
        argv: ['git', ...args],
        cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: MAX_GIT_OUTPUT_BYTES },
          stderr: { maxBytes: MAX_GIT_OUTPUT_BYTES },
        },
        graceMs: 1_000,
        signal: abort.signal,
        env: { GIT_TERMINAL_PROMPT: '0' },
      })
      const outcome = await handle.done
      /* v8 ignore next -- the stdio request always collects stdout; the fallback only narrows the optional collector type. */
      return {
        exitCode: outcome.exitCode,
        stdout: handle.collected.stdout?.readFrom(0).text ?? '',
        /* v8 ignore next -- the stdio request always collects stderr; the fallback only narrows the optional collector type. */
        stderr: handle.collected.stderr?.readFrom(0).text ?? '',
      }
    } catch {
      // Spawn failure (git missing, cwd gone) reads as "no answer", the same
      // as a non-zero exit: callers branch on exitCode, never on exceptions.
      return { exitCode: null, stdout: '', stderr: '' }
    } finally {
      clearTimeout(timer)
    }
  }
}

export default GuiRepoController
