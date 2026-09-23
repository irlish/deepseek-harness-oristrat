/**
 * Page and element capture.
 *
 * The provider returns bytes; storing them belongs to the consumer's attachment
 * store, so this module never touches the filesystem.
 * @module
 */

import { BrowserError, type BrowserImageFormat, type BrowserScreenshot, type BrowserScreenshotRequest } from '@deepseek-ai/dsh-browser'
import type { CdpSession } from './cdp.ts'
import { resolveElement, type ResolvedElement } from './interaction.ts'
import { readPageHeader, type RefStore } from './observation.ts'

/** Media type of each format the seam captures. */
const MEDIA_TYPES: Record<BrowserImageFormat, 'image/png' | 'image/jpeg'> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
}

/** Layout metrics the browser reports for the whole document. */
interface LayoutMetrics {
  readonly cssContentSize: { readonly width: number; readonly height: number }
}

/**
 * Capture the viewport, the whole document, or one element.
 * @param session - command session for the browser view.
 * @param refs - reference store that minted the reference, when one was used.
 * @param request - capture framing and format.
 * @param signal - optional caller cancellation.
 * @returns the captured image bytes.
 */
export async function capturePage(
  session: CdpSession,
  refs: RefStore,
  request: BrowserScreenshotRequest,
  signal?: AbortSignal,
): Promise<BrowserScreenshot> {
  const format = request.format ?? 'png'
  const params: Record<string, unknown> = { format }
  if (format === 'jpeg') params.quality = request.quality ?? 80
  let measured: { width: number; height: number } | undefined
  if (request.target !== undefined) {
    const element = await resolveElement(session, refs, request.target, signal)
    measured = { width: Math.round(element.rect.width), height: Math.round(element.rect.height) }
    params.captureBeyondViewport = true
    params.clip = await elementClip(session, element, signal)
  } else if (request.fullPage === true) {
    const metrics = await session.send<LayoutMetrics>('Page.getLayoutMetrics', {}, signal)
    measured = { width: Math.round(metrics.cssContentSize.width), height: Math.round(metrics.cssContentSize.height) }
    params.captureBeyondViewport = true
    params.clip = { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 }
  } else {
    measured = await session.viewport(signal)
  }
  const captured = await session.send<{ data?: string }>('Page.captureScreenshot', params, signal)
  if (captured.data === undefined) {
    throw new BrowserError('the browser returned no screenshot bytes', 'BROWSER_PROTOCOL')
  }
  const header = await readPageHeader(session, signal)
  return {
    format,
    mediaType: MEDIA_TYPES[format],
    bytes: new Uint8Array(Buffer.from(captured.data, 'base64')),
    width: measured.width,
    height: measured.height,
    url: header.url,
  }
}

/**
 * Convert one element's viewport rectangle into the document-space clip that
 * an out-of-viewport capture expects.
 * @param session - command session for the browser view.
 * @param element - resolved element in viewport coordinates.
 * @param signal - optional caller cancellation.
 * @returns the clip rectangle in document coordinates.
 */
async function elementClip(
  session: CdpSession,
  element: ResolvedElement,
  signal?: AbortSignal,
): Promise<{ x: number; y: number; width: number; height: number; scale: number }> {
  const scroll = await session.evaluate<{ x: number; y: number }>('({ x: window.scrollX, y: window.scrollY })', signal)
  const left = element.rect.x - element.rect.width / 2 + scroll.x
  const top = element.rect.y - element.rect.height / 2 + scroll.y
  return {
    x: Math.max(0, Math.round(left)),
    y: Math.max(0, Math.round(top)),
    width: Math.max(1, Math.round(element.rect.width)),
    height: Math.max(1, Math.round(element.rect.height)),
    scale: 1,
  }
}
