// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as nodeApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { RepoEnvAction } from '../src/client/RepoEnvAction.tsx'
import { zh } from '../src/client/locales.ts'

const t = (key: string, params?: Record<string, unknown>): string => {
  const template = (zh as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

afterEach(cleanup)

/** One recorded fake client context: effects run immediately, seats capture. */
function fakeCtx(wire: Record<string, (request: unknown) => Promise<unknown>>) {
  const registered: Array<{ definition: { id?: string; name?: string; inject?: () => unknown }; component: unknown }> = []
  const seats: string[] = []
  const ctx = {
    locale: { register: vi.fn() },
    remote: { guiRepo: wire },
    slots: {
      inject: vi.fn((name: string, factory: () => unknown) => { seats.push(name); factory(); return () => {} }),
      register: vi.fn((definition: never, component: unknown) => { registered.push({ definition, component }); return () => {} }),
    },
    effect: (fn: () => unknown) => { fn() },
  }
  return { ctx: ctx as never, registered, seats, dictionaries: ctx.locale.register }
}

describe('plugin registration', () => {
  it('exposes the empty node half and the declared browser services', () => {
    expect(() => { nodeApply() }).not.toThrow()
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.guiRepo'])
  })

  it('registers dictionaries and the header utilities menu', () => {
    const fake = fakeCtx({
      status: async () => ({ ok: true, value: { repo: false, host: 'h', sources: [] } }),
      branches: async () => ({ ok: true, value: { repo: false, branches: [] } }),
      checkout: async () => ({ ok: true, value: { ok: true } }),
      createBranch: async () => ({ ok: true, value: { ok: true } }),
    })
    apply(fake.ctx)
    expect(fake.dictionaries).toHaveBeenCalledOnce()
    expect(fake.seats).toEqual(['conversation.session.header.utilities'])
    expect(fake.registered.map(entry => entry.component)).toEqual([RepoEnvAction])
    expect(fake.registered[0]?.definition).toMatchObject({
      name: 'conversation.session.header.utilities',
      id: 'repo-env',
      locale: 'repo-panel',
    })
  })

  it('unwraps ok envelopes and turns host errors into throws', async () => {
    const status = vi.fn().mockResolvedValue({ ok: true, value: { repo: false, host: 'h', sources: [] } })
    const branches = vi.fn().mockResolvedValue({ ok: false, error: 'boom' })
    const fake = fakeCtx({
      status,
      branches,
      checkout: vi.fn().mockResolvedValue({ ok: true, value: { ok: true } }),
      createBranch: vi.fn().mockResolvedValue({ ok: false, error: { code: 7 } }),
    })
    apply(fake.ctx)
    const injected = (fake.registered[0]?.definition as {
      inject: () => {
        repoStatus: (request: unknown) => Promise<unknown>
        repoBranches: (request: unknown) => Promise<unknown>
        repoCheckout: (request: unknown) => Promise<unknown>
        repoCreateBranch: (request: unknown) => Promise<unknown>
      }
    }).inject()
    await expect(injected.repoStatus({ cwd: '/w' })).resolves.toEqual({ repo: false, host: 'h', sources: [] })
    await expect(injected.repoBranches({ cwd: '/w' })).rejects.toThrow('boom')
    await expect(injected.repoCheckout({ cwd: '/w', branch: 'x' })).resolves.toEqual({ ok: true })
    await expect(injected.repoCreateBranch({ cwd: '/w', name: 'x' })).rejects.toThrow('{"code":7}')
  })

  it('binds the package dictionary for component copy', () => {
    render(<div>{t('menu.title')}</div>)
    expect(screen.getByText('环境信息')).toBeTruthy()
  })
})
