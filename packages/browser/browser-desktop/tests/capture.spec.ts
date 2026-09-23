import { describe, expect, it } from 'vitest'
import { parseBrowserOwner, type BrowserOwner, type BrowserRef } from '@deepseek-ai/dsh-browser'
import { CdpSession } from '../src/cdp.ts'
import { capturePage } from '../src/capture.ts'
import { RefStore } from '../src/observation.ts'
import { fakeTransport, type FakeBrowserTransport } from './fake-browser-transport.ts'
import { scriptPageWorld } from './page-world.ts'

/** Base64 of the bytes every scripted capture returns. */
const IMAGE_BASE64 = Buffer.from('png-bytes').toString('base64')

/** Element rectangle the scripted measurement returns for a selector target. */
const MEASURED_RECT = { x: 120, y: 240, width: 40, height: 20, description: 'button #go' }

/** Target that resolves through the scripted DOM query. */
const SELECTOR_TARGET = { kind: 'selector', selector: '#go' } as const

/** Owner every capture request in this suite carries. */
const OWNER: BrowserOwner = parseBrowserOwner('session-a')

/**
 * Script one transport with a page world, a selector target, and image bytes.
 * @param measured - element rectangle the scripted measurement returns.
 * @returns the scripted transport.
 */
function captureTransport(measured: Record<string, unknown> = MEASURED_RECT): FakeBrowserTransport {
  const transport = fakeTransport()
  scriptPageWorld(transport)
  transport.on('DOM.getDocument', () => ({ root: { nodeId: 7 } }))
  transport.on('DOM.querySelector', () => ({ nodeId: 9 }))
  transport.on('DOM.resolveNode', () => ({ object: { objectId: 'remote-9' } }))
  transport.on('Runtime.callFunctionOn', () => ({ result: { value: measured } }))
  transport.on('Page.captureScreenshot', () => ({ data: IMAGE_BASE64 }))
  return transport
}

describe('capturePage framing', () => {
  it('captures the viewport by default as PNG', async () => {
    const transport = captureTransport()

    const shot = await capturePage(new CdpSession(transport, 1_000), new RefStore(), { owner: OWNER })

    expect(transport.paramsOf('Page.captureScreenshot')).toEqual({ format: 'png' })
    expect(shot.format).toBe('png')
    expect(shot.mediaType).toBe('image/png')
    expect(shot.bytes).toEqual(new Uint8Array(Buffer.from('png-bytes')))
    expect(shot.width).toBe(1000)
    expect(shot.height).toBe(800)
    expect(shot.url).toBe('https://example.com/page')
  })

  it('sends the default JPEG quality when the call names only the format', async () => {
    const transport = captureTransport()

    const shot = await capturePage(new CdpSession(transport, 1_000), new RefStore(), { owner: OWNER, format: 'jpeg' })

    expect(transport.paramsOf('Page.captureScreenshot')).toEqual({ format: 'jpeg', quality: 80 })
    expect(shot.format).toBe('jpeg')
    expect(shot.mediaType).toBe('image/jpeg')
  })

  it('prefers the quality the call asked for', async () => {
    const transport = captureTransport()

    await capturePage(new CdpSession(transport, 1_000), new RefStore(), { owner: OWNER, format: 'jpeg', quality: 40 })

    expect(transport.paramsOf('Page.captureScreenshot')).toEqual({ format: 'jpeg', quality: 40 })
  })

  it('captures the whole document from its layout metrics', async () => {
    const transport = captureTransport()
    transport.on('Page.getLayoutMetrics', () => ({ cssContentSize: { width: 1200.4, height: 3000.6 } }))

    const shot = await capturePage(new CdpSession(transport, 1_000), new RefStore(), { owner: OWNER, fullPage: true })

    expect(transport.paramsOf('Page.captureScreenshot')).toEqual({
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 1200.4, height: 3000.6, scale: 1 },
    })
    expect(shot.width).toBe(1200)
    expect(shot.height).toBe(3001)
  })

  it('clips an element target in document coordinates', async () => {
    const transport = captureTransport()
    scriptPageWorld(transport, { scrollX: 15, scrollY: 100 })

    const shot = await capturePage(new CdpSession(transport, 1_000), new RefStore(), { owner: OWNER, target: SELECTOR_TARGET })

    expect(transport.paramsOf('DOM.querySelector')).toEqual({ nodeId: 7, selector: '#go' })
    expect(transport.paramsOf('Page.captureScreenshot')).toEqual({
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 115, y: 330, width: 40, height: 20, scale: 1 },
    })
    expect(shot.width).toBe(40)
    expect(shot.height).toBe(20)
  })

  it('never sends a negative clip origin and keeps a sub-pixel box capturable', async () => {
    const transport = captureTransport({ x: -10, y: -20, width: 0.4, height: 0.4, description: 'tiny span' })

    await capturePage(new CdpSession(transport, 1_000), new RefStore(), { owner: OWNER, target: SELECTOR_TARGET })

    expect(transport.paramsOf('Page.captureScreenshot').clip).toEqual({ x: 0, y: 0, width: 1, height: 1, scale: 1 })
  })

  it('resolves a minted reference through the accessibility backend node', async () => {
    const transport = captureTransport()
    transport.on('DOM.resolveNode', params => (
      params.backendNodeId === 4242 ? { object: { objectId: 'remote-4242' } } : {}
    ))
    const refs = new RefStore()
    const ref: BrowserRef = refs.mint(4242)

    await capturePage(new CdpSession(transport, 1_000), refs, { owner: OWNER, target: { kind: 'ref', ref } })

    expect(transport.paramsOf('DOM.resolveNode')).toEqual({ backendNodeId: 4242 })
    expect(transport.paramsOf('Runtime.callFunctionOn').objectId).toBe('remote-4242')
  })

  it('reports a capture the browser answered without bytes', async () => {
    const transport = captureTransport()
    transport.on('Page.captureScreenshot', () => ({}))

    await expect(capturePage(new CdpSession(transport, 1_000), new RefStore(), { owner: OWNER })).rejects.toThrow(
      expect.objectContaining({ code: 'BROWSER_PROTOCOL', message: 'the browser returned no screenshot bytes' }),
    )
  })
})
