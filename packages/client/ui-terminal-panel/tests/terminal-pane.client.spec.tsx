// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { TerminalPane } from '../src/client/TerminalWorkspace.tsx'
import { en } from '../src/client/locales.ts'

const xterm = vi.hoisted(() => {
  const instances: Array<{
    write: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    input?: (value: string) => void
  }> = []
  const fit = vi.fn()
  return { instances, fit }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    readonly write = vi.fn()
    readonly dispose = vi.fn()
    input?: (value: string) => void
    constructor() { xterm.instances.push(this) }
    open(): void {}
    loadAddon(): void {}
    onData(callback: (value: string) => void): void { this.input = callback }
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void { xterm.fit() } } }))

const t: ComponentProps<typeof TerminalPane>['t'] = (key, params) => {
  const text = key in en ? en[key as keyof typeof en] : key
  return params === undefined ? text : text.replace('{detail}', String(params.detail))
}

let resize: (() => void) | undefined
beforeEach(() => {
  class FakeResizeObserver {
    constructor(callback: () => void) { resize = callback }
    observe(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  resize = undefined
  xterm.instances.length = 0
  xterm.fit.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function callbacks(overrides: Partial<Pick<ComponentProps<typeof TerminalPane>, 'openTerminal' | 'writeTerminal' | 'readTerminal' | 'closeTerminal'>> = {}) {
  return {
    openTerminal: vi.fn().mockResolvedValue({ id: 'gui-0', scrollback: [{ seq: 0, data: 'initial' }], cursor: 1 }),
    writeTerminal: vi.fn().mockResolvedValue(undefined),
    readTerminal: vi.fn().mockResolvedValue({ frames: [], cursor: 1, alive: true }),
    closeTerminal: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('TerminalPane', () => {
  it('opens in the session workspace, forwards input, polls output, and closes its PTY with the tab', async () => {
    const readTerminal = vi.fn()
    readTerminal
      .mockResolvedValueOnce({ frames: [{ seq: 1, data: 'next' }], cursor: 2, alive: true })
      .mockResolvedValueOnce({ frames: [], cursor: 2, alive: false })
    const host = callbacks({ readTerminal })
    const view = render(<TerminalPane {...host} t={t} cwd="/workspace" />)
    expect(screen.getByText(en['panel.opening'])).toBeTruthy()
    await waitFor(() => { expect(xterm.instances).toHaveLength(1) })
    act(() => { resize?.() })
    expect(host.openTerminal).toHaveBeenCalledWith({ cwd: '/workspace' })
    expect(xterm.instances[0]!.write).toHaveBeenCalledWith('initial')
    act(() => { xterm.instances[0]!.input?.('echo ok\n') })
    expect(host.writeTerminal).toHaveBeenCalledWith({ id: 'gui-0', data: 'echo ok\n' })
    await waitFor(() => { expect(xterm.instances[0]!.write).toHaveBeenCalledWith('next') })
    await screen.findByText(en['panel.dead'])
    expect(xterm.fit).toHaveBeenCalled()
    view.unmount()
    expect(xterm.instances[0]!.dispose).toHaveBeenCalledOnce()
    expect(host.closeTerminal).toHaveBeenCalledWith({ id: 'gui-0' })
  })

  it('reports a rejected open and does not try to close a missing PTY', async () => {
    const host = callbacks({ openTerminal: vi.fn().mockRejectedValue(new Error('PTY unavailable')) })
    const view = render(<TerminalPane {...host} t={t} />)
    await screen.findByText('Terminal connection failed: Error: PTY unavailable')
    expect(host.openTerminal).toHaveBeenCalledWith({})
    view.unmount()
    expect(host.closeTerminal).not.toHaveBeenCalled()
  })

  it('closes a PTY that finishes opening after its tab is gone', async () => {
    const pending = Promise.withResolvers<{ id: string; scrollback: []; cursor: number }>()
    const host = callbacks({ openTerminal: vi.fn().mockReturnValue(pending.promise) })
    const view = render(<TerminalPane {...host} t={t} />)
    view.unmount()
    await act(async () => { pending.resolve({ id: 'late', scrollback: [], cursor: 0 }) })
    expect(host.closeTerminal).toHaveBeenCalledWith({ id: 'late' })
    expect(xterm.instances).toHaveLength(0)
  })

  it('reports a failed output poll and closes the PTY', async () => {
    const host = callbacks({ readTerminal: vi.fn().mockRejectedValue('connection lost') })
    const view = render(<TerminalPane {...host} t={t} />)
    await screen.findByText('Terminal connection failed: connection lost')
    view.unmount()
    expect(host.closeTerminal).toHaveBeenCalledWith({ id: 'gui-0' })
  })

  it('ignores output and open failures that settle after unmount', async () => {
    const pendingRead = Promise.withResolvers<{ frames: []; cursor: number; alive: boolean }>()
    const host = callbacks({ readTerminal: vi.fn().mockReturnValue(pendingRead.promise) })
    const view = render(<TerminalPane {...host} t={t} />)
    await waitFor(() => { expect(host.readTerminal).toHaveBeenCalled() })
    view.unmount()
    await act(async () => { pendingRead.resolve({ frames: [], cursor: 1, alive: true }) })

    const rejectedRead = Promise.withResolvers<never>()
    const second = callbacks({ readTerminal: vi.fn().mockReturnValue(rejectedRead.promise) })
    const secondView = render(<TerminalPane {...second} t={t} />)
    await waitFor(() => { expect(second.readTerminal).toHaveBeenCalled() })
    secondView.unmount()
    await act(async () => { rejectedRead.reject(new Error('late disconnect')) })

    const rejectedOpen = Promise.withResolvers<never>()
    const third = callbacks({ openTerminal: vi.fn().mockReturnValue(rejectedOpen.promise) })
    const thirdView = render(<TerminalPane {...third} t={t} />)
    thirdView.unmount()
    await act(async () => { rejectedOpen.reject(new Error('late open failure')) })
    expect(third.closeTerminal).not.toHaveBeenCalled()
  })
})
