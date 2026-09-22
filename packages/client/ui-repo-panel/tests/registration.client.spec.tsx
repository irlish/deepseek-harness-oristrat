// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as nodeApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { REPO_ID, REPO_KIND, repoDefinition } from '../src/client/definition.tsx'
import { RepoGlyph } from '../src/client/glyphs.tsx'
import { RepoPanel } from '../src/client/RepoPanel.tsx'
import { RepoTabBody } from '../src/client/RepoTabBody.tsx'
import { RepoTitle } from '../src/client/RepoTitle.tsx'
import { zh } from '../src/client/locales.ts'

const t = (key: string, params?: Record<string, unknown>): string => {
  const template = (zh as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

afterEach(cleanup)

/** One recorded fake client context: effects run immediately, seats capture. */
function fakeCtx(statusImpl: (request: unknown) => Promise<unknown>) {
  const registered: Array<{ definition: { key?: string; name?: string; inject?: () => unknown }; component: unknown }> = []
  const seats: string[] = []
  const ctx = {
    locale: { bind: () => t, register: vi.fn() },
    sidebarRightTabs: { register: vi.fn<(definition: unknown) => () => void>(() => () => {}) },
    remote: { guiRepo: { status: statusImpl } },
    slots: {
      inject: vi.fn((name: string, factory: () => unknown) => { seats.push(name); factory(); return () => {} }),
      register: vi.fn((definition: never, component: unknown) => { registered.push({ definition, component }); return () => {} }),
    },
    effect: (fn: () => unknown) => { fn() },
  }
  return { ctx: ctx as never, registered, seats, tabs: ctx.sidebarRightTabs.register, dictionaries: ctx.locale.register }
}

describe('plugin registration', () => {
  it('exposes the empty node half and the declared browser services', () => {
    expect(() => { nodeApply() }).not.toThrow()
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.guiRepo', 'sidebarRightTabs'])
  })

  it('registers dictionaries, the repo type, and both keyed seats', () => {
    const fake = fakeCtx(async () => ({ ok: true, value: { repo: false, host: 'h', sources: [] } }))
    apply(fake.ctx)
    expect(fake.dictionaries).toHaveBeenCalledOnce()
    expect(fake.tabs).toHaveBeenCalledOnce()
    const definition = fake.tabs.mock.calls[0]?.[0] as { kind: string; id: string }
    expect(definition).toMatchObject({ kind: REPO_KIND, id: REPO_ID })
    expect(fake.seats).toEqual(['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])
    expect(fake.registered.map(entry => entry.component)).toEqual([RepoTabBody, RepoTitle])
    expect(fake.registered[0]?.definition).toMatchObject({ name: 'sidebar.right.pane.tab', key: REPO_ID, locale: 'repo-panel' })
    expect(fake.registered[1]?.definition).toMatchObject({ name: 'sidebar.right.pane.tab.title', key: REPO_ID })
  })

  it('unwraps ok envelopes and turns host errors into throws', async () => {
    const envelope = fakeCtx(async () => ({ ok: true, value: { repo: true, host: 'h', sources: [] } }))
    apply(envelope.ctx)
    const face = envelope.registered[0]?.definition.inject?.() as { repoStatus: (request: { cwd?: string }) => Promise<unknown> }
    await expect(face.repoStatus({ cwd: '/repo' })).resolves.toEqual({ repo: true, host: 'h', sources: [] })

    const textError = fakeCtx(async () => ({ ok: false, error: 'boom' }))
    apply(textError.ctx)
    const textFace = textError.registered[0]?.definition.inject?.() as { repoStatus: (request: object) => Promise<unknown> }
    await expect(textFace.repoStatus({})).rejects.toThrow('boom')

    const structuredError = fakeCtx(async () => ({ ok: false, error: { code: 7 } }))
    apply(structuredError.ctx)
    const structuredFace = structuredError.registered[0]?.definition.inject?.() as { repoStatus: (request: object) => Promise<unknown> }
    await expect(structuredFace.repoStatus({})).rejects.toThrow('{"code":7}')
  })
})

describe('type definition', () => {
  it('names the type and its guide entry in the bound locale', () => {
    const definition = repoDefinition(t)
    expect(definition.kind).toBe(REPO_KIND)
    expect(definition.title('')).toBe('环境')
    const entry = definition.guide?.[0]
    expect(entry?.order).toBe(30)
    expect(entry?.title()).toBe('仓库环境')
    expect(entry?.description?.()).toBeTruthy()
    expect(entry?.icon).toBe(RepoGlyph)
  })

  it('draws the glyph with the default and an explicit seat', () => {
    const { unmount } = render(<RepoGlyph />)
    expect(document.querySelector('svg')).toBeTruthy()
    unmount()
    render(<RepoGlyph size={20} className="placed" />)
    const svg = document.querySelector('svg.placed')
    expect(svg?.getAttribute('width')).toBe('20')
  })
})

describe('pane composition', () => {
  const sessions = { byId: { s1: { cwd: '/repo' }, s2: {} } }
  const useSessions = (selector: (state: typeof sessions) => unknown): unknown => selector(sessions)

  it('draws the body with the session cwd, without a session, and for an unknown id', async () => {
    const repoStatus = vi.fn(async () => ({ repo: true, branch: 'main', host: 'h', sources: [] }))
    const { unmount } = render(<RepoTabBody {...({ t, sessionId: 's1', useSessions, repoStatus } as unknown as ComponentProps<typeof RepoTabBody>)} />)
    expect(await screen.findAllByText('main')).toHaveLength(2)
    expect(repoStatus).toHaveBeenCalledWith({ cwd: '/repo' })
    unmount()

    const noSession = render(<RepoTabBody {...({ t, useSessions, repoStatus } as unknown as ComponentProps<typeof RepoTabBody>)} />)
    expect(await noSession.findAllByText('main')).toHaveLength(2)
    noSession.unmount()

    const unknown = render(<RepoTabBody {...({ t, sessionId: 'nope', useSessions, repoStatus } as unknown as ComponentProps<typeof RepoTabBody>)} />)
    expect(await unknown.findAllByText('main')).toHaveLength(2)
    unknown.unmount()
    expect(repoStatus).toHaveBeenLastCalledWith({})
  })

  it('draws the chip title with the glyph before the tab title', () => {
    render(<RepoTitle {...({ useTabInfo: () => ({ tab: { title: '环境' } }) } as unknown as ComponentProps<typeof RepoTitle>)} />)
    expect(screen.getByText('环境')).toBeTruthy()
    expect(document.querySelector('svg')).toBeTruthy()
  })

  it('renders file counts without addition/deletion totals as zeroed sums', async () => {
    const repoStatus = vi.fn(async () => ({ repo: true, branch: 'main', files: 2, host: 'h', sources: [] }))
    render(<RepoPanel {...{ t, cwd: '/repo', repoStatus }} />)
    await screen.findByText('+0 -0 · 2 个文件')
  })
})
