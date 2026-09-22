// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { BrowserPanel } from '../src/client/BrowserPanel.tsx'
import { boundsFromRect, desktopBrowser, normalizeUrlInput, type BrowserState, type DesktopBrowserBridge } from '../src/client/bridge.ts'
import { zh } from '../src/client/locales.ts'

const t: ComponentProps<typeof BrowserPanel>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

/** Every member typed as a vi.fn property so specs can reference the mocks directly. */
type BridgeMocks = Record<keyof DesktopBrowserBridge, ReturnType<typeof vi.fn>>

function fakeBridge(): DesktopBrowserBridge & BridgeMocks {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    back: vi.fn().mockResolvedValue(undefined),
    forward: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    setBounds: vi.fn().mockResolvedValue(undefined),
    state: vi.fn().mockResolvedValue({ url: '', title: '', canGoBack: false, canGoForward: false, loading: false }),
    subscribe: vi.fn(() => () => {}),
  }
}

function stateOf(overrides: Partial<BrowserState> = {}): BrowserState {
  return { url: '', title: '', canGoBack: false, canGoForward: false, loading: false, ...overrides }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('normalizeUrlInput', () => {
  it('upgrades bare hosts and keeps http(s) URLs', () => {
    expect(normalizeUrlInput('example.com')).toBe('https://example.com/')
    expect(normalizeUrlInput(' http://x.dev/a ')).toBe('http://x.dev/a')
  })

  it('refuses empty text, spaced text, other schemes, and unparsable targets', () => {
    expect(normalizeUrlInput('')).toBeUndefined()
    expect(normalizeUrlInput('two words')).toBeUndefined()
    expect(normalizeUrlInput('javascript:alert(1)')).toBeUndefined()
    expect(normalizeUrlInput('ftp://files.example')).toBeUndefined()
    expect(normalizeUrlInput('https://ex ample.com')).toBeUndefined()
  })
})

describe('boundsFromRect', () => {
  it('rounds a measured rect and zeroes an absent one', () => {
    expect(boundsFromRect({ left: 1.4, top: 39.6, width: 320.5, height: 480.2 }))
      .toEqual({ x: 1, y: 40, width: 321, height: 480 })
    expect(boundsFromRect(undefined)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('desktopBrowser', () => {
  it('reads the bridge only from the desktop carrier', () => {
    expect(desktopBrowser()).toBeUndefined()
    const bridge = fakeBridge()
    vi.stubGlobal('window', Object.assign(window, { dshDesktop: { protocolVersion: 1, browser: bridge } }))
    expect(desktopBrowser()).toBe(bridge)
    delete (window as { dshDesktop?: unknown }).dshDesktop
  })
})

describe('BrowserPanel', () => {
  it('explains the desktop-only surface without a bridge', () => {
    render(<BrowserPanel t={t} bridge={undefined} />)
    expect(screen.getByText('内嵌浏览器仅在桌面客户端可用')).toBeTruthy()
  })

  it('opens the view over the surface, follows state pushes, and closes on unmount', async () => {
    const bridge = fakeBridge()
    const unsubscribe = vi.fn()
    bridge.subscribe.mockReturnValue(unsubscribe)
    const { unmount } = render(<BrowserPanel t={t} bridge={bridge} />)
    await waitFor(() => {
      expect(bridge.open).toHaveBeenCalledWith({ x: 0, y: 0, width: 0, height: 0 })
    })
    const push = bridge.subscribe.mock.calls[0]?.[0] as (state: BrowserState) => void
    // The pushed blank state surfaces the start hint; a URL replaces it.
    act(() => { push(stateOf()) })
    expect(screen.getByText('输入网址开始浏览')).toBeTruthy()
    act(() => { push(stateOf({ url: 'https://example.com/', canGoBack: true })) })
    expect(screen.queryByText('输入网址开始浏览')).toBeNull()
    // Window resizes re-push the measured bounds.
    fireEvent(window, new Event('resize'))
    expect(bridge.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 0, height: 0 })
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
    expect(bridge.close).toHaveBeenCalled()
  })

  it('drives the toolbar: history guards, reload, and the address form', async () => {
    const bridge = fakeBridge()
    render(<BrowserPanel t={t} bridge={bridge} />)
    const push = bridge.subscribe.mock.calls[0]?.[0] as (state: BrowserState) => void
    const back = screen.getByRole('button', { name: '后退' })
    const forward = screen.getByRole('button', { name: '前进' })
    expect(back.hasAttribute('disabled')).toBe(true)
    expect(forward.hasAttribute('disabled')).toBe(true)
    act(() => { push(stateOf({ url: 'https://a.example/', canGoBack: true, canGoForward: true })) })
    expect(back.hasAttribute('disabled')).toBe(false)
    fireEvent.click(back)
    fireEvent.click(forward)
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(bridge.back).toHaveBeenCalled()
    expect(bridge.forward).toHaveBeenCalled()
    expect(bridge.reload).toHaveBeenCalled()

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'example.com' } })
    fireEvent.submit(screen.getByRole('button', { name: '打开' }).closest('form')!)
    await waitFor(() => {
      expect(bridge.navigate).toHaveBeenCalledWith('https://example.com/')
    })
    // Spaced text names no URL and never reaches the bridge.
    fireEvent.change(input, { target: { value: 'two words' } })
    fireEvent.submit(screen.getByRole('button', { name: '打开' }).closest('form')!)
    expect(bridge.navigate).toHaveBeenCalledTimes(1)
  })

  it('announces a rejected navigation and clears the notice on the next attempt', async () => {
    const bridge = fakeBridge()
    bridge.navigate
      .mockRejectedValueOnce(new Error('only http(s)'))
      .mockResolvedValueOnce(undefined)
    render(<BrowserPanel t={t} bridge={bridge} />)
    const input = screen.getByRole('textbox')
    const form = screen.getByRole('button', { name: '打开' }).closest('form')!
    fireEvent.change(input, { target: { value: 'example.com' } })
    fireEvent.submit(form)
    await waitFor(() => {
      expect(screen.getByText('打开失败：only http(s)')).toBeTruthy()
    })
    fireEvent.submit(form)
    await waitFor(() => {
      expect(screen.queryByText(/打开失败/)).toBeNull()
    })
  })

  it('observes surface resizes when the host provides ResizeObserver', async () => {
    const observed: Element[] = []
    const disconnected = vi.fn()
    let resizeCallback: (() => void) | undefined
    class FakeResizeObserver {
      constructor(callback: () => void) { resizeCallback = callback }
      observe(element: Element): void { observed.push(element) }
      disconnect(): void { disconnected() }
      unobserve(): void {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const bridge = fakeBridge()
    const { unmount } = render(<BrowserPanel t={t} bridge={bridge} />)
    await waitFor(() => {
      expect(observed).toHaveLength(1)
    })
    act(() => { resizeCallback?.() })
    expect(bridge.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 0, height: 0 })
    unmount()
    expect(disconnected).toHaveBeenCalled()
  })
})
