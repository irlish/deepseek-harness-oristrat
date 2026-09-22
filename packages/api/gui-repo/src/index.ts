/**
 * Host owner of the browser-facing repository environment Remote namespace:
 * read-only git facts (branch, upstream divergence, working-tree change
 * totals, remote sources) plus the serving machine's name, gathered with
 * one-shot `git` invocations through the subprocess capability.
 *
 * Every verb is local: no command touches the network, so no credential can
 * be prompted for and none is forwarded. The namespace deliberately has no
 * commit, push, or checkout surface — the panel it backs reports the
 * environment, it does not mutate it.
 */

import { hostname } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { GuiRepoSource, GuiRepoStatusRequest, GuiRepoStatusValue } from './types.ts'

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

/** Exit code and collected stdout of one finished git invocation. */
interface GitRun {
  /** Process exit code; null when terminated by signal or spawn failure. */
  exitCode: number | null
  /** Collected stdout text ('' when the stream never produced output). */
  stdout: string
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
      return { exitCode: outcome.exitCode, stdout: handle.collected.stdout?.readFrom(0).text ?? '' }
    } catch {
      // Spawn failure (git missing, cwd gone) reads as "no answer", the same
      // as a non-zero exit: callers branch on exitCode, never on exceptions.
      return { exitCode: null, stdout: '' }
    } finally {
      clearTimeout(timer)
    }
  }
}

export default GuiRepoController
