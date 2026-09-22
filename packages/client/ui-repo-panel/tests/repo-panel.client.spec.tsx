// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GuiRepoStatusValue } from '@deepseek-ai/dsh-api-gui-repo/types'
import type { ComponentProps } from 'react'
import { RepoPanel } from '../src/client/RepoPanel.tsx'
import { zh } from '../src/client/locales.ts'

// The seat's key domain is repo-panel alone; the stub mirrors the real lookup
// chain: package dictionary, then the key.
const t: ComponentProps<typeof RepoPanel>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function repoStatus(overrides: Partial<GuiRepoStatusValue> = {}): GuiRepoStatusValue {
  return {
    repo: true,
    root: '/work/fork',
    branch: 'main',
    additions: 12,
    deletions: 3,
    files: 4,
    host: 'oristrat-mac',
    sources: [{ name: 'origin', url: 'https://example.com/a.git' }],
    ...overrides,
  }
}

function resolved(value: GuiRepoStatusValue) {
  return vi.fn().mockResolvedValue(value)
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('RepoPanel', () => {
  it('reads the snapshot on mount and renders every environment row', async () => {
    const repoStatusFn = resolved(repoStatus({ ahead: 2, behind: 1 }))
    render(<RepoPanel t={t} repoStatus={repoStatusFn} cwd="/work/fork" />)

    expect(screen.getByText('正在读取仓库状态…')).toBeTruthy()
    await waitFor(() => {
      // The branch shows twice: the header title and the Branch row.
      expect(screen.getAllByText('main')).toHaveLength(2)
    })
    expect(repoStatusFn).toHaveBeenCalledWith({ cwd: '/work/fork' })
    expect(screen.getByText('领先 2 · 落后 1')).toBeTruthy()
    expect(screen.getByText('+12 -3 · 4 个文件')).toBeTruthy()
    expect(screen.getByText('oristrat-mac')).toBeTruthy()
    expect(screen.getByText('origin')).toBeTruthy()
    expect(screen.getByText('https://example.com/a.git')).toBeTruthy()
  })

  it('omits cwd from the request while the session workspace is unknown', async () => {
    const repoStatusFn = resolved(repoStatus())
    render(<RepoPanel t={t} repoStatus={repoStatusFn} />)
    await waitFor(() => {
      expect(repoStatusFn).toHaveBeenCalledWith({})
    })
  })

  it('renders one-sided upstream divergence', async () => {
    const { unmount } = render(<RepoPanel t={t} repoStatus={resolved(repoStatus({ ahead: 3 }))} />)
    await waitFor(() => {
      expect(screen.getByText('领先 3')).toBeTruthy()
    })
    unmount()
    render(<RepoPanel t={t} repoStatus={resolved(repoStatus({ behind: 5 }))} />)
    await waitFor(() => {
      expect(screen.getByText('落后 5')).toBeTruthy()
    })
  })

  it('reports a clean tree, no remotes, and the root while the branch is unnamed', async () => {
    render(<RepoPanel t={t} repoStatus={resolved(repoStatus({ branch: '', additions: 0, deletions: 0, files: 0, sources: [] }))} />)
    await waitFor(() => {
      expect(screen.getByText('工作区干净')).toBeTruthy()
    })
    expect(screen.getByText('未配置远端')).toBeTruthy()
    // The header falls back to the worktree root while the branch name is empty.
    expect(screen.getByText('/work/fork', { selector: 'span' })).toBeTruthy()
  })

  it('announces a directory outside any worktree', async () => {
    render(<RepoPanel t={t} repoStatus={resolved({ repo: false, host: 'oristrat-mac', sources: [] })} />)
    await waitFor(() => {
      expect(screen.getByText('当前目录不是 Git 仓库')).toBeTruthy()
    })
    expect(screen.queryByText('分支')).toBeNull()
  })

  it('surfaces a rejected read and recovers on the manual refresh', async () => {
    const repoStatusFn = vi.fn()
      .mockRejectedValueOnce(new Error('host unreachable'))
      .mockResolvedValueOnce(repoStatus())
    render(<RepoPanel t={t} repoStatus={repoStatusFn} />)

    await waitFor(() => {
      expect(screen.getByText('读取失败：host unreachable')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => {
      expect(screen.getAllByText('main')).toHaveLength(2)
    })
    expect(screen.queryByText(/读取失败/)).toBeNull()
  })

  it('stringifies a non-error rejection', async () => {
    render(<RepoPanel t={t} repoStatus={vi.fn().mockRejectedValue('boom')} />)
    await waitFor(() => {
      expect(screen.getByText('读取失败：boom')).toBeTruthy()
    })
  })

  it('polls on the fixed interval and stops after unmount', async () => {
    vi.useFakeTimers()
    const repoStatusFn = resolved(repoStatus())
    render(<RepoPanel t={t} repoStatus={repoStatusFn} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(repoStatusFn).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(repoStatusFn).toHaveBeenCalledTimes(2)
    cleanup()
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    expect(repoStatusFn).toHaveBeenCalledTimes(2)
  })
})
