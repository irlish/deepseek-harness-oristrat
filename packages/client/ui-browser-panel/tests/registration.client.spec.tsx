// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as nodeApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { BROWSER_ID, BROWSER_KIND, browserDefinition } from '../src/client/definition.tsx'
import { BrowserGlyph } from '../src/client/glyphs.tsx'
import { BrowserPanel } from '../src/client/BrowserPanel.tsx'
import { BrowserTabBody } from '../src/client/BrowserTabBody.tsx'
import { BrowserTitle } from '../src/client/BrowserTitle.tsx'
import { normalizeUrlInput, type DesktopBrowserBridge } from '../src/client/bridge.ts'
import { zh } from '../src/client/locales.ts'

const t = (key: string, params?: Record<string, unknown>): string => {
  const template = (zh as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** One recorded fake client context: effects run immediately, seats capture. */
function fakeCtx() {
  const registered: Array<{
    definition: { key?: string; name?: string; inject?: () => { bridge?: DesktopBrowserBridge } }
    component: unknown
  }> = []
  const seats: string[] = []
  const ctx = {
    locale: { bind: () => t, register: vi.fn() },
    sidebarRightTabs: { register: vi.fn<(definition: unknown) => () => void>(() => () => {}) },
    slots: {
      inject: vi.fn((name: string, factory: () => unknown) => { seats.push(name); factory(); return () => {} }),
      register: vi.fn((definition: never, component: unknown) => { registered.push({ definition, component }); return () => {} }),
    },
    sidebarRight: { openTab: vi.fn() },
    effect: (fn: () => unknown) => { fn() },
  }
  return {
    ctx: ctx as never,
    registered,
    seats,
    tabs: ctx.sidebarRightTabs.register,
    dictionaries: ctx.locale.register,
    openTab: ctx.sidebarRight.openTab,
  }
}

/** Every member typed as a vi.fn property so specs can reference the mocks directly. */
type BridgeMocks = Record<keyof DesktopBrowserBridge, ReturnType<typeof vi.fn>>

function fakeBridge(): DesktopBrowserBridge & BridgeMocks {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    hide: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    back: vi.fn().mockResolvedValue(undefined),
    forward: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    setBounds: vi.fn().mockResolvedValue(undefined),
    state: vi.fn().mockResolvedValue({ url: '', title: '', canGoBack: false, canGoForward: false, loading: false }),
    subscribe: vi.fn(() => () => {}),
    subscribeReveal: vi.fn(() => () => {}),
    subscribeActivity: vi.fn(() => () => {}),
  }
}

describe('plugin registration', () => {
  it('exposes the empty node half and the declared browser services', () => {
    expect(() => { nodeApply() }).not.toThrow()
    expect(inject).toEqual(['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'])
  })

  it('registers dictionaries, the browser type, and both keyed seats without a bridge', () => {
    const fake = fakeCtx()
    apply(fake.ctx)
    expect(fake.dictionaries).toHaveBeenCalledOnce()
    const definition = fake.tabs.mock.calls[0]?.[0] as { kind: string; id: string }
    expect(definition).toMatchObject({ kind: BROWSER_KIND, id: BROWSER_ID })
    expect(fake.seats).toEqual(['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])
    expect(fake.registered.map(entry => entry.component)).toEqual([BrowserTabBody, BrowserTitle])
    expect(fake.registered[0]?.definition).toMatchObject({ name: 'sidebar.right.pane.tab', key: BROWSER_ID, locale: 'browser-panel' })
    const face = fake.registered[0]?.definition.inject?.()
    expect(face?.bridge).toBeUndefined()
  })

  it('hands the injected face the desktop bridge when the carrier exposes one', () => {
    const bridge = fakeBridge()
    vi.stubGlobal('window', Object.assign(window, { dshDesktop: { protocolVersion: 1, browser: bridge } }))
    const fake = fakeCtx()
    apply(fake.ctx)
    const face = fake.registered[0]?.definition.inject?.()
    expect(face?.bridge).toBe(bridge)
    delete (window as { dshDesktop?: unknown }).dshDesktop
  })

  it('shows the browser tab when the shell asks for the pane, and never without a bridge', () => {
    const plain = fakeCtx()
    apply(plain.ctx)
    expect(plain.openTab).not.toHaveBeenCalled()

    const bridge = fakeBridge()
    const listeners: Array<() => void> = []
    bridge.subscribeReveal.mockImplementation((listener: () => void) => {
      listeners.push(listener)
      return () => {}
    })
    vi.stubGlobal('window', Object.assign(window, { dshDesktop: { protocolVersion: 1, browser: bridge } }))
    const fake = fakeCtx()
    apply(fake.ctx)
    expect(bridge.subscribeReveal).toHaveBeenCalledOnce()
    listeners[0]?.()
    expect(fake.openTab).toHaveBeenCalledWith(BROWSER_KIND)
    delete (window as { dshDesktop?: unknown }).dshDesktop
  })
})

describe('type definition', () => {
  it('names the type and its guide entry in the bound locale', () => {
    const definition = browserDefinition(t)
    expect(definition.kind).toBe(BROWSER_KIND)
    expect(definition.title('')).toBe('浏览器')
    const entry = definition.guide?.[0]
    expect(entry?.order).toBe(40)
    expect(entry?.title()).toBe('内嵌浏览器')
    expect(entry?.description?.()).toBeTruthy()
    expect(entry?.icon).toBe(BrowserGlyph)
  })

  it('draws the glyph with the default and an explicit seat', () => {
    const { unmount } = render(<BrowserGlyph />)
    expect(document.querySelector('svg')).toBeTruthy()
    unmount()
    render(<BrowserGlyph size={20} className="placed" />)
    const svg = document.querySelector('svg.placed')
    expect(svg?.getAttribute('width')).toBe('20')
  })
})

describe('pane composition', () => {
  it('draws the body with and without a bridge', () => {
    const withoutBridge = render(<BrowserTabBody {...({ t, bridge: undefined } as ComponentProps<typeof BrowserTabBody>)} />)
    expect(withoutBridge.getByText('内嵌浏览器仅在桌面客户端可用')).toBeTruthy()
    withoutBridge.unmount()

    const withBridge = render(<BrowserTabBody {...({ t, bridge: fakeBridge() } as ComponentProps<typeof BrowserTabBody>)} />)
    expect(withBridge.getByRole('button', { name: '后退' })).toBeTruthy()
    withBridge.unmount()
  })

  it('draws the chip title with the glyph before the tab title', () => {
    render(<BrowserTitle {...({ useTabInfo: () => ({ tab: { title: '浏览器' } }) } as ComponentProps<typeof BrowserTitle>)} />)
    expect(screen.getByText('浏览器')).toBeTruthy()
    expect(document.querySelector('svg')).toBeTruthy()
  })
})

describe('bridge failure edges', () => {
  it('refuses text that parses as no URL at the bridge helper', () => {
    expect(normalizeUrlInput('https://[bad')).toBeUndefined()
  })

  it('swallows a rejected open and survives to the next state push', async () => {
    const bridge = fakeBridge()
    bridge.open.mockRejectedValueOnce(new Error('window gone'))
    render(<BrowserPanel t={t} bridge={bridge} />)
    await waitFor(() => {
      expect(bridge.open).toHaveBeenCalled()
    })
    expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy()
  })

  it('renders a non-Error navigation rejection as text', async () => {
    const bridge = fakeBridge()
    bridge.navigate.mockRejectedValueOnce('plain string')
    render(<BrowserPanel t={t} bridge={bridge} />)
    const input = screen.getByRole('textbox')
    const form = input.closest('form')!
    fireEvent.change(input, { target: { value: 'example.com' } })
    fireEvent.submit(form)
    await waitFor(() => {
      expect(screen.getByText('打开失败：plain string')).toBeTruthy()
    })
  })
})
