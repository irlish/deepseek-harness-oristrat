import { describe, expect, it } from 'vitest'
import { BROWSER_TRANSPORT_ERROR_CODES } from '@deepseek-ai/dsh-browser'
import { DesktopBrowserChannel } from '../../desktop-host/src/browser-channel.ts'
import {
  DESKTOP_HOST_PROTOCOL_VERSION as HOST_PIPE_PROTOCOL_VERSION,
  DesktopHostRequestDecoder,
  encodeDesktopResponseData,
  encodeDesktopResponseEnd,
  encodeDesktopResponseError,
  encodeDesktopResponseStart,
} from '../../desktop-host/src/wire.ts'
import {
  DESKTOP_BROWSER_CDP_ERROR_CODES,
  DESKTOP_HOST_PROTOCOL_VERSION,
  DesktopHostResponseDecoder,
  encodeDesktopRequestCancel,
  encodeDesktopRequestData,
  encodeDesktopRequestEnd,
  encodeDesktopRequestStart,
  type DesktopBrowserCdpErrorCode,
  type DesktopHostCommand,
  type DesktopHostEvent,
} from '../src/host-protocol.ts'

/** One reply the desktop shell returns for a brokered browser command. */
type DesktopBrowserCdpReply = Extract<DesktopHostCommand, { type: 'browser/cdp-result' | 'browser/cdp-error' }>

function decodeInPieces<T>(bytes: Buffer, push: (chunk: Buffer) => readonly T[]): T[] {
  const values: T[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += 7) {
    values.push(...push(bytes.subarray(offset, offset + 7)))
  }
  return values
}

/** Round-trip one control message through JSON, which is how Node IPC carries it. */
function throughIpc<T>(message: T): T {
  return JSON.parse(JSON.stringify(message)) as T
}

/**
 * Settle one brokered command with the reply the shell built.
 * The parameter type proves the desktop reply union is a valid Host reply union.
 */
function settleReply(channel: DesktopBrowserChannel, reply: DesktopBrowserCdpReply): void {
  channel.settle(reply)
}

describe('desktop Host pipe protocol', () => {
  it('keeps Electron request frames compatible with the installed Host decoder', () => {
    const decoder = new DesktopHostRequestDecoder()
    const bytes = Buffer.concat([
      encodeDesktopRequestStart(7, {
        url: 'dsh-app://app/api/session',
        method: 'POST',
        headers: [['content-type', 'application/json']],
        hasBody: true,
      }),
      encodeDesktopRequestData(7, Buffer.from('{"ok":true}')),
      encodeDesktopRequestEnd(7),
      encodeDesktopRequestCancel(7),
    ])

    expect(decodeInPieces(bytes, chunk => decoder.push(chunk))).toEqual([
      {
        type: 'start',
        streamId: 7,
        url: 'dsh-app://app/api/session',
        method: 'POST',
        headers: [['content-type', 'application/json']],
        hasBody: true,
      },
      { type: 'data', streamId: 7, data: Buffer.from('{"ok":true}') },
      { type: 'end', streamId: 7 },
      { type: 'cancel', streamId: 7 },
    ])
    expect(() => { decoder.finish() }).not.toThrow()
  })

  it('keeps Host response frames compatible with the Electron decoder', () => {
    const decoder = new DesktopHostResponseDecoder()
    const bytes = Buffer.concat([
      encodeDesktopResponseStart(9, {
        status: 201,
        headers: [['content-type', 'application/octet-stream']],
        hasBody: true,
      }),
      encodeDesktopResponseData(9, Buffer.from([0, 1, 2, 255])),
      encodeDesktopResponseEnd(9),
      encodeDesktopResponseError(10, 'failed'),
    ])

    expect(decodeInPieces(bytes, chunk => decoder.push(chunk))).toEqual([
      {
        type: 'start',
        streamId: 9,
        status: 201,
        headers: [['content-type', 'application/octet-stream']],
        hasBody: true,
      },
      { type: 'data', streamId: 9, data: Buffer.from([0, 1, 2, 255]) },
      { type: 'end', streamId: 9 },
      { type: 'error', streamId: 10, message: 'failed' },
    ])
    expect(() => { decoder.finish() }).not.toThrow()
  })

  it('rejects a corrupt marker and truncated EOF on both directions', () => {
    const request = new DesktopHostRequestDecoder()
    const response = new DesktopHostResponseDecoder()
    expect(() => request.push(Buffer.alloc(13))).toThrow(/request frame marker/u)
    expect(() => response.push(Buffer.alloc(13))).toThrow(/response frame marker/u)

    const partialRequest = new DesktopHostRequestDecoder()
    partialRequest.push(encodeDesktopRequestEnd(1).subarray(0, 5))
    expect(() => { partialRequest.finish() }).toThrow(/ended inside a frame/u)

    const partialResponse = new DesktopHostResponseDecoder()
    partialResponse.push(encodeDesktopResponseEnd(1).subarray(0, 5))
    expect(() => { partialResponse.finish() }).toThrow(/ended inside a frame/u)
  })
})

describe('desktop Host browser protocol', () => {
  it('pins one protocol version for the shell and the installed Host', () => {
    expect(DESKTOP_HOST_PROTOCOL_VERSION).toBe(4)
    expect(HOST_PIPE_PROTOCOL_VERSION).toBe(DESKTOP_HOST_PROTOCOL_VERSION)
  })

  it('takes its brokered failure codes from the browser capability', () => {
    expect(DESKTOP_BROWSER_CDP_ERROR_CODES).toEqual([...BROWSER_TRANSPORT_ERROR_CODES])
    for (const code of BROWSER_TRANSPORT_ERROR_CODES) {
      const desktopCode: DesktopBrowserCdpErrorCode = code
      expect(DESKTOP_BROWSER_CDP_ERROR_CODES).toContain(desktopCode)
    }
  })

  it('round-trips a brokered command and its replies through the real channel', async () => {
    // The callback parameter pins the Host's own event type against the
    // desktop union the shell decodes: both apps must agree on `browser/cdp`.
    const posted: Extract<DesktopHostEvent, { type: 'browser/cdp' }>[] = []
    const channel = new DesktopBrowserChannel((event: DesktopHostEvent) => {
      if (event.type === 'browser/cdp') posted.push(event)
    }, 5_000)

    const result = channel.send('Page.navigate', { url: 'https://example.com' })
    const refusal = channel.send('Page.captureScreenshot', { format: 'png' })

    expect(posted.map(throughIpc)).toStrictEqual([
      { type: 'browser/cdp', requestId: 1, method: 'Page.navigate', params: { url: 'https://example.com' } },
      { type: 'browser/cdp', requestId: 2, method: 'Page.captureScreenshot', params: { format: 'png' } },
    ])

    const command = posted[0]!
    const capture = posted[1]!
    settleReply(channel, throughIpc({
      type: 'browser/cdp-result',
      requestId: command.requestId,
      result: { frameId: 'F1' },
    }))
    settleReply(channel, throughIpc({
      type: 'browser/cdp-error',
      requestId: capture.requestId,
      code: 'payload-too-large',
      message: 'dsh desktop: the capture exceeds the 8MiB image limit',
    }))

    await expect(result).resolves.toEqual({ frameId: 'F1' })
    const failure = await refusal.then(() => undefined, (reason: unknown) => reason)
    expect(failure).toMatchObject({
      name: 'BrowserTransportError',
      code: 'payload-too-large',
      message: 'dsh desktop: the capture exceeds the 8MiB image limit',
    })
  })
})
