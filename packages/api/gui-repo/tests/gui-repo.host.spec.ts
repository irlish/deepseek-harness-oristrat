import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import GuiRepoController, { parseNumstat, parseRemotes } from '../src/index.ts'

const roots: Context[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

function tempDir(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
  tempDirs.push(dir)
  return dir
}

async function harness(): Promise<{ controller: GuiRepoController; ctx: Context }> {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(LocalSubprocessRuntime)
  const dispose = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => dispose },
    contexts: { configureHost: () => dispose },
  } as never)
  return { controller: new GuiRepoController(ctx), ctx }
}

/** One real git worktree with an initial commit; `git` runs through execFileSync for fixture setup only. */
function gitRepo(): string {
  const dir = tempDir('dsh-gui-repo-')
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '--initial-branch=main')
  git('config', 'user.email', 'spec@example.com')
  git('config', 'user.name', 'Spec')
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  git('add', 'a.txt')
  git('commit', '-m', 'initial')
  return dir
}

describe('parseNumstat', () => {
  it('sums numeric entries and counts binary entries as files only', () => {
    expect(parseNumstat('3\t1\tsrc/a.ts\n-\t-\timage.png\n\n')).toEqual({ additions: 3, deletions: 1, files: 2 })
  })
})

describe('parseRemotes', () => {
  it('deduplicates fetch/push pairs and skips malformed lines', () => {
    expect(parseRemotes('origin\thttps://example.com/a.git (fetch)\norigin\thttps://example.com/a.git (push)\nbroken\n')).toEqual([
      { name: 'origin', url: 'https://example.com/a.git' },
    ])
  })
})

describe('GuiRepoController.status', () => {
  it('reports a clean committed worktree', async () => {
    const { controller } = await harness()
    const dir = gitRepo()
    const value = await controller.status({ cwd: dir })
    expect(value).toMatchObject({ repo: true, branch: 'main', additions: 0, deletions: 0, files: 0, host: hostname(), sources: [] })
    expect(value.root).toBe(dir)
    expect(value.ahead).toBeUndefined()
  })

  it('totals staged and unstaged changes plus untracked files', async () => {
    const { controller } = await harness()
    const dir = gitRepo()
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    writeFileSync(join(dir, 'b.txt'), 'new\n')
    const value = await controller.status({ cwd: dir })
    expect(value).toMatchObject({ additions: 1, deletions: 0, files: 2 })
  })

  it('reports zeroed change totals when a corrupted index fails both worktree readers', async () => {
    const { controller } = await harness()
    const dir = gitRepo()
    writeFileSync(join(dir, '.git', 'index'), 'not an index')
    const value = await controller.status({ cwd: dir })
    expect(value).toMatchObject({ repo: true, branch: 'main', additions: 0, deletions: 0, files: 0, host: hostname() })
  })

  it('reports upstream divergence from a local origin', async () => {
    const { controller } = await harness()
    const origin = gitRepo()
    const clone = tempDir('dsh-gui-repo-clone-')
    execFileSync('git', ['clone', origin, clone], { stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'spec@example.com'], { cwd: clone })
    execFileSync('git', ['config', 'user.name', 'Spec'], { cwd: clone })
    writeFileSync(join(clone, 'c.txt'), 'clone work\n')
    execFileSync('git', ['add', 'c.txt'], { cwd: clone })
    execFileSync('git', ['commit', '-m', 'clone commit'], { cwd: clone })

    const value = await controller.status({ cwd: clone })
    expect(value).toMatchObject({ repo: true, branch: 'main', ahead: 1, behind: 0 })
    expect(value.sources).toEqual([{ name: 'origin', url: origin }])
  })

  it('names the unborn branch and counts untracked files before the first commit', async () => {
    const { controller } = await harness()
    const dir = tempDir('dsh-gui-repo-unborn-')
    execFileSync('git', ['init', '--initial-branch=trunk'], { cwd: dir, stdio: 'ignore' })
    writeFileSync(join(dir, 'wip.txt'), 'wip\n')
    const value = await controller.status({ cwd: dir })
    expect(value).toMatchObject({ repo: true, branch: 'trunk', additions: 0, deletions: 0, files: 1 })
  })

  it('falls back to the short HEAD sha while detached', async () => {
    const { controller } = await harness()
    const dir = gitRepo()
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    execFileSync('git', ['add', 'a.txt'], { cwd: dir })
    execFileSync('git', ['commit', '-m', 'second'], { cwd: dir })
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD~1'], { cwd: dir, encoding: 'utf8' }).trim()
    execFileSync('git', ['checkout', '--detach', 'HEAD~1'], { cwd: dir, stdio: 'ignore' })
    const value = await controller.status({ cwd: dir })
    expect(value.branch).toBe(sha)
  })

  it('reports an empty branch when both HEAD readers fail', async () => {
    const { controller } = await harness()
    const dir = gitRepo()
    // A HEAD naming no valid ref: the worktree still resolves, but neither
    // rev-parse nor symbolic-ref can name the branch.
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/\n')
    const value = await controller.status({ cwd: dir })
    expect(value).toMatchObject({ repo: true, branch: '' })
  })

  it('reports a non-repo directory without git facts', async () => {
    const { controller } = await harness()
    const value = await controller.status({ cwd: tempDir('dsh-gui-repo-plain-') })
    expect(value).toEqual({ repo: false, host: hostname(), sources: [] })
  })

  it('answers from the server cwd when the request omits one', async () => {
    const { controller } = await harness()
    const value = await controller.status({})
    expect(value.host).toBe(hostname())
  })

  it('answers repo:false when the inspected directory vanished', async () => {
    const { controller } = await harness()
    // A spawn failure (ENOENT cwd) reads as "no answer", not a rejection.
    const value = await controller.status({ cwd: join(tempDir('dsh-gui-repo-gone-'), 'missing-subdir') })
    expect(value).toEqual({ repo: false, host: hostname(), sources: [] })
  })

  it('terminates a hanging git invocation at the wall-clock bound', async () => {
    const { controller } = await harness()
    const bin = tempDir('dsh-gui-repo-bin-')
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nsleep 30\n')
    chmodSync(join(bin, 'git'), 0o755)
    const savedPath = process.env.PATH
    process.env.PATH = `${bin}:${savedPath ?? ''}`
    try {
      vi.useFakeTimers()
      const pending = controller.status({ cwd: tempDir('dsh-gui-repo-hang-') })
      await vi.advanceTimersByTimeAsync(8_000)
      const value = await pending
      // The aborted first probe reports "no answer": a non-repo snapshot.
      expect(value).toEqual({ repo: false, host: hostname(), sources: [] })
    } finally {
      process.env.PATH = savedPath
    }
  })
})
