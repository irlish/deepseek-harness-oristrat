// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GuiRepoBranchesValue, GuiRepoStatusValue } from '@deepseek-ai/dsh-api-gui-repo/types'
import type { ComponentProps } from 'react'
import { RepoEnvAction } from '../src/client/RepoEnvAction.tsx'
import { zh } from '../src/client/locales.ts'

// The seat's key domain is repo-panel alone; the stub mirrors the real lookup
// chain: package dictionary, then the key.
const t: ComponentProps<typeof RepoEnvAction>['t'] = (key, params) => {
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
    sources: [{ name: 'origin', url: 'https://example.com/a.git' }, { name: 'gitee', url: 'https://gitee.com/a.git' }],
    ...overrides,
  }
}

function branches(current = 'main', names: readonly string[] = ['main', 'feature/x', 'release/1']): GuiRepoBranchesValue {
  return { repo: true, current, branches: [...names] }
}

/** Sessions mirror stub: one session whose workspace root is configurable. */
function useSessionsWith(cwd: string | undefined) {
  return (selector: (sessions: { byId: Record<string, { cwd?: string }> }) => unknown): unknown =>
    selector({ byId: { s1: cwd === undefined ? {} : { cwd } } })
}

function props(overrides: Partial<ComponentProps<typeof RepoEnvAction>> = {}): ComponentProps<typeof RepoEnvAction> {
  return {
    t,
    sessionId: 's1' as ComponentProps<typeof RepoEnvAction>['sessionId'],
    useSessions: useSessionsWith('/work/fork') as ComponentProps<typeof RepoEnvAction>['useSessions'],
    repoStatus: vi.fn().mockResolvedValue(repoStatus()),
    repoBranches: vi.fn().mockResolvedValue(branches()),
    repoCheckout: vi.fn().mockResolvedValue({ ok: true }),
    repoCreateBranch: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as unknown as ComponentProps<typeof RepoEnvAction>
}

function openMenu(overrides: Partial<ComponentProps<typeof RepoEnvAction>> = {}): ReturnType<typeof render> {
  const view = render(<RepoEnvAction {...props(overrides)} />)
  fireEvent.click(screen.getByRole('button', { name: '仓库环境' }))
  return view
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('RepoEnvAction trigger', () => {
  it('renders one collapsed trigger before the first open', () => {
    render(<RepoEnvAction {...props()} />)
    const trigger = screen.getByRole('button', { name: '仓库环境' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('RepoEnvAction environment rows', () => {
  it('explains a session without a workspace', async () => {
    openMenu({ useSessions: useSessionsWith(undefined) as ComponentProps<typeof RepoEnvAction>['useSessions'] })
    expect(screen.getByRole('menu', { name: '环境信息' })).toBeTruthy()
    expect(screen.getByText('会话未关联工作区')).toBeTruthy()
  })

  it('shows the loading note until the first snapshot lands', () => {
    openMenu({ repoStatus: vi.fn().mockReturnValue(new Promise(() => {})) })
    expect(screen.getByText('正在读取仓库状态…')).toBeTruthy()
  })

  it('keeps the loading note when the read rejects', async () => {
    openMenu({ repoStatus: vi.fn().mockRejectedValue(new Error('down')) })
    await waitFor(() => { expect(screen.getByText('正在读取仓库状态…')).toBeTruthy() })
  })

  it('reports a directory outside any worktree', async () => {
    openMenu({ repoStatus: vi.fn().mockResolvedValue(repoStatus({ repo: false, sources: [] })) })
    await waitFor(() => { expect(screen.getByText('当前工作区不是 Git 仓库')).toBeTruthy() })
  })

  it('renders change totals, host, divergence, and every remote with its url', async () => {
    openMenu({ repoStatus: vi.fn().mockResolvedValue(repoStatus({ ahead: 2, behind: 1 })) })
    await waitFor(() => { expect(screen.getByText('+12 -3 · 4 个文件')).toBeTruthy() })
    expect(screen.getByText('oristrat-mac')).toBeTruthy()
    expect(screen.getByText('领先 2 · 落后 1')).toBeTruthy()
    // Each remote keeps its own row so a long url is never truncated away.
    const names = screen.getAllByRole('listitem').map(item => item.textContent)
    expect(names).toEqual(['originhttps://example.com/a.git', 'giteehttps://gitee.com/a.git'])
  })

  it('labels the trigger icon for pointer and keyboard users', async () => {
    openMenu()
    await waitFor(() => { expect(screen.getByText('gitee')).toBeTruthy() })
    const trigger = screen.getByRole('button', { name: '仓库环境' })
    // The environment mark: two hollow nodes with their bars, no branch curve.
    expect(trigger.querySelectorAll('circle')).toHaveLength(2)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.focus(trigger)
    expect(screen.getByRole('tooltip').textContent).toBe('仓库环境与分支')
    fireEvent.blur(trigger)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(trigger)
    expect(screen.getByRole('tooltip').textContent).toBe('仓库环境与分支')
    fireEvent.mouseLeave(trigger)
    await waitFor(() => { expect(screen.queryByRole('tooltip')).toBeNull() })
  })

  it('names a clean tree and omits divergence without an upstream', async () => {
    openMenu({ repoStatus: vi.fn().mockResolvedValue(repoStatus({ additions: 0, deletions: 0, files: 0, sources: [] })) })
    await waitFor(() => { expect(screen.getByText('工作区干净')).toBeTruthy() })
    expect(screen.getByText('未配置远端')).toBeTruthy()
  })

  it('shows ahead-only and behind-only divergence spellings', async () => {
    const view = openMenu({ repoStatus: vi.fn().mockResolvedValue(repoStatus({ ahead: 3 })) })
    await waitFor(() => { expect(screen.getByText('领先 3')).toBeTruthy() })
    view.unmount()
    openMenu({ repoStatus: vi.fn().mockResolvedValue(repoStatus({ behind: 5 })) })
    await waitFor(() => { expect(screen.getByText('落后 5')).toBeTruthy() })
  })

  it('zeroes absent change totals instead of omitting the row', async () => {
    openMenu({ repoStatus: vi.fn().mockResolvedValue({ repo: true, deletions: 5, host: 'h', sources: [] }) })
    await waitFor(() => { expect(screen.getByText('+0 -5 · 0 个文件')).toBeTruthy() })
  })

  it('zeroes absent deletions and file counts the same way', async () => {
    openMenu({ repoStatus: vi.fn().mockResolvedValue({ repo: true, additions: 7, host: 'h', sources: [] }) })
    await waitFor(() => { expect(screen.getByText('+7 -0 · 0 个文件')).toBeTruthy() })
  })

  it('ignores non-Escape keys while open', async () => {
    openMenu()
    await waitFor(() => { expect(screen.getByRole('menu')).toBeTruthy() })
    fireEvent.keyDown(window, { key: 'a' })
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('drops in-flight reads that land after unmount', async () => {
    let resolveStatus: (value: GuiRepoStatusValue) => void = () => {}
    const repoStatus = vi.fn().mockImplementation(() => new Promise<GuiRepoStatusValue>((resolve) => { resolveStatus = resolve }))
    const view = render(<RepoEnvAction {...props({ repoStatus })} />)
    fireEvent.click(screen.getByRole('button', { name: '仓库环境' }))
    view.unmount()
    resolveStatus(repoStatus())
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
  })

  it('drops a rejected status read that lands after unmount', async () => {
    let rejectStatus: (error: Error) => void = () => {}
    const repoStatus = vi.fn().mockImplementation(() => new Promise<GuiRepoStatusValue>((_resolve, reject) => { rejectStatus = reject }))
    const view = render(<RepoEnvAction {...props({ repoStatus })} />)
    fireEvent.click(screen.getByRole('button', { name: '仓库环境' }))
    view.unmount()
    rejectStatus(new Error('down'))
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
  })

  it('drops in-flight listing reads that land after unmount', async () => {
    let resolveListing: (value: GuiRepoBranchesValue) => void = () => {}
    let rejectListing: (error: Error) => void = () => {}
    const calls = { n: 0 }
    const repoBranches = vi.fn().mockImplementation(() => {
      calls.n += 1
      if (calls.n === 1) return new Promise<GuiRepoBranchesValue>((resolve) => { resolveListing = resolve })
      return new Promise<GuiRepoBranchesValue>((_resolve, reject) => { rejectListing = reject })
    })
    const view = render(<RepoEnvAction {...props({ repoBranches })} />)
    fireEvent.click(screen.getByRole('button', { name: '仓库环境' }))
    await waitFor(() => { expect(screen.getByText('gitee')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    await waitFor(() => { expect(calls.n).toBe(1) })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    await waitFor(() => { expect(calls.n).toBe(2) })
    view.unmount()
    resolveListing(branches())
    rejectListing(new Error('down'))
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
  })

  it('ignores picks and creates while a mutation is in flight', async () => {
    const repoCheckout = vi.fn().mockImplementation(() => new Promise(() => {}))
    const repoCreateBranch = vi.fn().mockImplementation(() => new Promise(() => {}))
    openMenu({ repoCheckout, repoCreateBranch })
    await waitFor(() => { expect(screen.getByText('gitee')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    await waitFor(() => { expect(screen.getAllByRole('menuitemradio')).toHaveLength(3) })
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'feature/x' }))
    const other = screen.getByRole('menuitemradio', { name: 'release/1' })
    expect((other as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(other)
    expect(repoCheckout).toHaveBeenCalledTimes(1)
    const create = screen.getByRole('button', { name: '创建并检出新分支…' })
    expect((create as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(create)
    expect(repoCreateBranch).not.toHaveBeenCalled()
  })

  it('falls back to the localized error when create reports no message', async () => {
    openMenu({ repoCreateBranch: vi.fn().mockResolvedValue({ ok: false }) })
    await waitFor(() => { expect(screen.getByText('gitee')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    await waitFor(() => { expect(screen.getAllByRole('menuitemradio')).toHaveLength(3) })
    fireEvent.click(screen.getByRole('button', { name: '创建并检出新分支…' }))
    fireEvent.change(screen.getByRole('textbox', { name: '新分支名，回车创建' }), { target: { value: 'next' } })
    fireEvent.submit(screen.getByRole('textbox', { name: '新分支名，回车创建' }).closest('form')!)
    await waitFor(() => { expect(screen.getByText('操作失败')).toBeTruthy() })
  })

  it('keeps the submenu loading note when the listing read rejects', async () => {
    openMenu({ repoBranches: vi.fn().mockRejectedValue(new Error('down')) })
    await waitFor(() => { expect(screen.getByText('gitee')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    await waitFor(() => { expect(screen.getByText('正在读取仓库状态…')).toBeTruthy() })
  })

  it('polls the snapshot while the menu stays open', async () => {
    vi.useFakeTimers()
    const statusFn = vi.fn().mockResolvedValue(repoStatus())
    openMenu({ repoStatus: statusFn })
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    const first = statusFn.mock.calls.length
    expect(first).toBeGreaterThan(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(statusFn.mock.calls.length).toBe(first + 1)
  })
})

describe('RepoEnvAction branch submenu', () => {
  it('lists branches behind a search box and checks the current one', async () => {
    openMenu()
    await waitFor(() => { expect(screen.getByText('gitee')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    await waitFor(() => { expect(screen.getByRole('menu', { name: '切换分支' })).toBeTruthy() })
    await waitFor(() => { expect(screen.getAllByRole('menuitemradio')).toHaveLength(3) })
    const current = screen.getByRole('menuitemradio', { name: '当前分支' })
    expect(current.getAttribute('aria-checked')).toBe('true')
    fireEvent.change(screen.getByRole('textbox', { name: '搜索分支' }), { target: { value: 'release' } })
    await waitFor(() => { expect(screen.getAllByRole('menuitemradio')).toHaveLength(1) })
    fireEvent.change(screen.getByRole('textbox', { name: '搜索分支' }), { target: { value: 'zzz' } })
    await waitFor(() => { expect(screen.getByText('没有匹配的分支')).toBeTruthy() })
  })

  it('shows the loading note until the listing lands and on rejection', async () => {
    openMenu({ repoBranches: vi.fn().mockReturnValue(new Promise(() => {})) })
    await waitFor(() => { expect(screen.getByText('gitee')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    expect(screen.getByText('正在读取仓库状态…')).toBeTruthy()
  })

  it('checks out the picked branch and closes the menu', async () => {
    const repoCheckout = vi.fn().mockResolvedValue({ ok: true })
    openMenu({ repoCheckout })
    await waitFor(() => { expect(screen.getByText('gitee')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    await waitFor(() => { expect(screen.getAllByRole('menuitemradio')).toHaveLength(3) })
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'feature/x' }))
    await waitFor(() => { expect(repoCheckout).toHaveBeenCalledWith({ cwd: '/work/fork', branch: 'feature/x' }) })
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
  })

  it('surfaces a refused checkout and a rejected one', async () => {
    const view = openMenu({ repoCheckout: vi.fn().mockResolvedValue({ ok: false, error: 'dirty tree' }) })
    await waitFor(() => { expect(screen.getByText('gitee')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    await waitFor(() => { expect(screen.getAllByRole('menuitemradio')).toHaveLength(3) })
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'feature/x' }))
    await waitFor(() => { expect(screen.getByText('dirty tree')).toBeTruthy() })
    view.unmount()

    const second = openMenu({ repoCheckout: vi.fn().mockRejectedValue(new Error('down')) })
    await waitFor(() => { expect(screen.getByText('gitee')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    await waitFor(() => { expect(screen.getAllByRole('menuitemradio')).toHaveLength(3) })
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'feature/x' }))
    await waitFor(() => { expect(screen.getByText('操作失败')).toBeTruthy() })
    second.unmount()
  })

  it('reports a checkout failure without an error message through the fallback', async () => {
    openMenu({ repoCheckout: vi.fn().mockResolvedValue({ ok: false }) })
    await waitFor(() => { expect(screen.getByText('gitee')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    await waitFor(() => { expect(screen.getAllByRole('menuitemradio')).toHaveLength(3) })
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'feature/x' }))
    await waitFor(() => { expect(screen.getByText('操作失败')).toBeTruthy() })
  })

  it('creates and checks out a new branch from the draft row', async () => {
    const repoCreateBranch = vi.fn().mockResolvedValue({ ok: true })
    openMenu({ repoCreateBranch })
    await waitFor(() => { expect(screen.getByText('gitee')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    await waitFor(() => { expect(screen.getAllByRole('menuitemradio')).toHaveLength(3) })
    fireEvent.click(screen.getByRole('button', { name: '创建并检出新分支…' }))
    const draft = screen.getByRole('textbox', { name: '新分支名，回车创建' })
    fireEvent.submit(draft.closest('form') as HTMLFormElement)
    expect(repoCreateBranch).not.toHaveBeenCalled()
    fireEvent.change(draft, { target: { value: 'feature/new' } })
    fireEvent.submit(draft.closest('form') as HTMLFormElement)
    await waitFor(() => { expect(repoCreateBranch).toHaveBeenCalledWith({ cwd: '/work/fork', name: 'feature/new' }) })
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
  })

  it('surfaces a refused create and a rejected one', async () => {
    const view = openMenu({ repoCreateBranch: vi.fn().mockResolvedValue({ ok: false, error: 'exists' }) })
    await waitFor(() => { expect(screen.getByText('gitee')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    await waitFor(() => { expect(screen.getAllByRole('menuitemradio')).toHaveLength(3) })
    fireEvent.click(screen.getByRole('button', { name: '创建并检出新分支…' }))
    const draft = screen.getByRole('textbox', { name: '新分支名，回车创建' })
    fireEvent.change(draft, { target: { value: 'feature/new' } })
    fireEvent.submit(draft.closest('form') as HTMLFormElement)
    await waitFor(() => { expect(screen.getByText('exists')).toBeTruthy() })
    view.unmount()

    const second = openMenu({ repoCreateBranch: vi.fn().mockRejectedValue(new Error('down')) })
    await waitFor(() => { expect(screen.getByText('gitee')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    await waitFor(() => { expect(screen.getAllByRole('menuitemradio')).toHaveLength(3) })
    fireEvent.click(screen.getByRole('button', { name: '创建并检出新分支…' }))
    const box = screen.getByRole('textbox', { name: '新分支名，回车创建' })
    fireEvent.change(box, { target: { value: 'feature/new' } })
    fireEvent.submit(box.closest('form') as HTMLFormElement)
    await waitFor(() => { expect(screen.getByText('操作失败')).toBeTruthy() })
    second.unmount()
  })

  it('polls the listing while the submenu stays open', async () => {
    vi.useFakeTimers()
    const repoBranches = vi.fn().mockResolvedValue(branches())
    openMenu({ repoBranches })
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    const first = repoBranches.mock.calls.length
    expect(first).toBeGreaterThan(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(repoBranches.mock.calls.length).toBe(first + 1)
  })
})

describe('RepoEnvAction dismissal', () => {
  it('closes on Escape and on pointer-down outside', async () => {
    const view = openMenu()
    await waitFor(() => { expect(screen.getByText('正在读取仓库状态…')).toBeTruthy() })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: '仓库环境' }))
    await waitFor(() => { expect(screen.getByRole('menu')).toBeTruthy() })
    fireEvent.pointerDown(document.body)
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
    view.unmount()
  })

  it('drops the submenu state when the menu closes', async () => {
    const view = openMenu()
    await waitFor(() => { expect(screen.getByText('gitee')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    await waitFor(() => { expect(screen.getByRole('menu', { name: '切换分支' })).toBeTruthy() })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: '仓库环境' }))
    await waitFor(() => { expect(screen.getByRole('menu')).toBeTruthy() })
    expect(screen.queryByRole('menu', { name: '切换分支' })).toBeNull()
    view.unmount()
  })
})
