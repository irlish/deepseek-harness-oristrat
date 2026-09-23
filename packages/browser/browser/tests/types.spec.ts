import { describe, expect, it } from 'vitest'
import {
  BROWSER_ERROR_CODES,
  BROWSER_TRANSPORT_ERROR_CODES,
  BrowserError,
  BrowserTransportError,
  createBrowserRef,
  formatBrowserOwner,
  formatBrowserRef,
  parseBrowserOwner,
  parseBrowserRef,
} from '../src/types.ts'

describe('element references', () => {
  it('parses reference text with and without the @ sigil', () => {
    expect(String(parseBrowserRef('e1'))).toBe('e1')
    expect(String(parseBrowserRef('@e12'))).toBe('e12')
    expect(String(parseBrowserRef(`e${'9'.repeat(7)}`))).toBe(`e${'9'.repeat(7)}`)
  })

  it('rejects text that is not a reference', () => {
    for (const text of ['', '@', 'e', 'e0', 'e01', 'E1', '@@e1', 'e12345678', 'element1', '#e1', 'e-1']) {
      expect(parseBrowserRef(text), text).toBeUndefined()
    }
  })

  it('formats a reference as the model reads it', () => {
    expect(formatBrowserRef(createBrowserRef(12))).toBe('@e12')
  })

  it('mints a reference from a 1-based element position', () => {
    expect(String(createBrowserRef(1))).toBe('e1')
    expect(String(createBrowserRef(999))).toBe('e999')
  })

  it('refuses a non-positive or non-integer element position', () => {
    expect(() => createBrowserRef(0)).toThrow('browser reference index must be a positive integer, received 0')
    expect(() => createBrowserRef(-3)).toThrow('received -3')
    expect(() => createBrowserRef(1.5)).toThrow('received 1.5')
    expect(() => createBrowserRef(Number.NaN)).toThrow('received NaN')
  })
})

describe('browser owner', () => {
  it('brands and formats one session identity', () => {
    const owner = parseBrowserOwner('session-1')
    expect(String(owner)).toBe('session-1')
    expect(formatBrowserOwner(owner)).toBe('session-1')
  })
})

describe('failure taxonomy', () => {
  it('lists the codes consumers and providers route on', () => {
    expect([...BROWSER_ERROR_CODES]).toEqual([
      'BROWSER_UNAVAILABLE',
      'BROWSER_ORIGIN_DENIED',
      'BROWSER_REF_STALE',
      'BROWSER_BUSY',
      'BROWSER_SCRIPT_EVAL_DENIED',
      'BROWSER_TIMEOUT',
      'BROWSER_ABORTED',
      'BROWSER_NAVIGATION_FAILED',
      'BROWSER_ACTION_FAILED',
      'BROWSER_PROTOCOL',
    ])
    expect([...BROWSER_TRANSPORT_ERROR_CODES]).toEqual([
      'not-open',
      'devtools-open',
      'method-not-allowed',
      'attach-failed',
      'payload-too-large',
      'timeout',
      'aborted',
      'closed',
      'protocol-error',
    ])
  })

  it('carries the seam failure code and class name', () => {
    const error = new BrowserError('the pane is busy', 'BROWSER_BUSY')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('BrowserError')
    expect(error.code).toBe('BROWSER_BUSY')
    expect(error.message).toBe('the pane is busy')
    expect(error.cause).toBeUndefined()
  })

  it('chains a cause on a seam failure', () => {
    const cause = new Error('underlying')
    expect(new BrowserError('wrapped', 'BROWSER_PROTOCOL', { cause }).cause).toBe(cause)
  })

  it('carries the transport failure code and class name', () => {
    const error = new BrowserTransportError('the view is not open', 'not-open')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('BrowserTransportError')
    expect(error.code).toBe('not-open')
    expect(error.cause).toBeUndefined()
  })

  it('chains a cause on a transport failure', () => {
    const cause = new Error('socket closed')
    expect(new BrowserTransportError('attach failed', 'attach-failed', { cause }).cause).toBe(cause)
  })
})
