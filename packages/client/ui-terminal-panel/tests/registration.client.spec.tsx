// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { apply as applyHost } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { TerminalTabBody, type TerminalTabBodyInjected } from '../src/client/TerminalTabBody.tsx'
import { TerminalTitle } from '../src/client/TerminalTitle.tsx'
import { TERMINAL_ID, TERMINAL_KIND, terminalDefinition } from '../src/client/definition.tsx'
import { TerminalGlyph } from '../src/client/glyphs.tsx'
import { en, NS, zh } from '../src/client/locales.ts'

vi.mock('../src/client/TerminalWorkspace.tsx', () => ({
  TerminalPane: ({ cwd }: { cwd?: string }) => <div data-testid="pane" data-cwd={cwd} />,
}))

afterEach(cleanup)

const t: Parameters<typeof terminalDefinition>[0] = key => key in en ? en[key as keyof typeof en] : key

it('keeps the terminal type, localized guide, chip, and session directory together', () => {
  const definition = terminalDefinition(t)
  expect(definition).toMatchObject({ id: TERMINAL_ID, kind: TERMINAL_KIND, priority: 'builtin' })
  expect(definition.title({} as never)).toBe('Terminal')
  const guide = definition.guide?.[0]
  if (guide === undefined) throw new Error('terminal guide entry missing')
  expect(guide.title()).toBe('Terminal')
  expect(guide.description?.()).toContain('shell terminal')
  expect(zh['type.label']).toBe('终端')
  render(<TerminalGlyph />)
  expect(document.querySelector('svg')).not.toBeNull()
  cleanup()
  render(<TerminalTitle {...({ useTabInfo: () => ({ tab: { title: 'Console' } }) } as ComponentProps<typeof TerminalTitle>)} />)
  expect(screen.getByText('Console')).toBeTruthy()
  cleanup()
  render(<TerminalTabBody {...({
    t, sessionId: 'session-1',
    useSessions: (select: (value: { byId: Record<string, { cwd: string }> }) => string | undefined) =>
      select({ byId: { 'session-1': { cwd: '/workspace' } } }),
    openTerminal: vi.fn(), writeTerminal: vi.fn(), readTerminal: vi.fn(), closeTerminal: vi.fn(),
  } as ComponentProps<typeof TerminalTabBody>)} />)
  expect(screen.getByTestId('pane').getAttribute('data-cwd')).toBe('/workspace')
  applyHost()
})

it('registers the terminal tab and routes keyboard and Remote calls through the client plugin', async () => {
  const disposed: Array<() => void> = []
  const slotRows: Array<{ key: string; inject?: () => TerminalTabBodyInjected }> = []
  const openTab = vi.fn()
  const wire = {
    open: vi.fn().mockResolvedValue({ ok: true, value: { id: 'gui-0', scrollback: [], cursor: 0 } }),
    write: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    read: vi.fn().mockResolvedValue({ ok: true, value: { frames: [], cursor: 0, alive: true } }),
    close: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  }
  const ctx = {
    effect: (install: () => (() => void) | undefined) => {
      const dispose = install()
      if (dispose !== undefined) disposed.push(dispose)
    },
    locale: { bind: vi.fn(() => t), register: vi.fn(() => () => {}) },
    sidebarRightTabs: { register: vi.fn(() => () => {}) },
    sidebarRight: { openTab },
    remote: { guiTerminal: wire },
    slots: {
      inject: vi.fn((_seat: string, register: () => (() => void)) => register()),
      register: vi.fn((row: { key: string; inject?: () => TerminalTabBodyInjected }) => {
        slotRows.push(row)
        return () => {}
      }),
    },
  }
  apply(ctx as never)
  expect(inject).toContain('remote.guiTerminal')
  expect(ctx.locale.register).toHaveBeenCalledWith(NS, { zh, en })
  expect(ctx.sidebarRightTabs.register).toHaveBeenCalledWith(expect.objectContaining({ kind: TERMINAL_KIND }))
  expect(slotRows.map(row => row.key)).toEqual([TERMINAL_ID, TERMINAL_ID])
  const host = slotRows[0]?.inject?.()
  if (host === undefined) throw new Error('terminal tab injection missing')
  await expect(host.openTerminal({})).resolves.toMatchObject({ id: 'gui-0' })
  await expect(host.writeTerminal({ id: 'gui-0', data: 'a' })).resolves.toBeUndefined()
  await expect(host.readTerminal({ id: 'gui-0', cursor: 0 })).resolves.toMatchObject({ alive: true })
  await expect(host.closeTerminal({ id: 'gui-0' })).resolves.toBeUndefined()

  wire.open.mockResolvedValueOnce({ ok: false, error: 'open denied' })
  await expect(host.openTerminal({})).rejects.toThrow('open denied')
  wire.open.mockResolvedValueOnce({ ok: false, error: { code: 'closed' } })
  await expect(host.openTerminal({})).rejects.toThrow('{"code":"closed"}')

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', ctrlKey: true, bubbles: true }))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
  expect(openTab).not.toHaveBeenCalled()
  const shortcut = new KeyboardEvent('keydown', { key: 'J', ctrlKey: true, bubbles: true, cancelable: true })
  window.dispatchEvent(shortcut)
  expect(shortcut.defaultPrevented).toBe(true)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true }))
  expect(openTab).toHaveBeenCalledTimes(2)
  expect(openTab).toHaveBeenCalledWith(TERMINAL_KIND)
  for (const dispose of disposed.reverse()) dispose()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }))
  expect(openTab).toHaveBeenCalledTimes(2)
})
