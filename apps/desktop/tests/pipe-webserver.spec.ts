// @vitest-environment node
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import * as plugin from '../../desktop-host/src/pipe-webserver.ts'
import { DesktopPipeWebServer } from '../../desktop-host/src/pipe-webserver.ts'

interface MintedIndexRequest {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string>
}

function stubConnection(): { connection: unknown; authorizeIndex: ReturnType<typeof vi.fn> } {
  const authorizeIndex = vi.fn((request: MintedIndexRequest, response: {
    writeHead(status: number, headers?: Record<string, string>): void
    end(): void
  }) => {
    expect(request.headers.host).toBe('127.0.0.1:3080')
    expect(request.url).toContain('dsh_token=launch')
    response.writeHead(303, { 'set-cookie': 'dsh-web-session.127.0.0.1:3080=minted; Path=/; HttpOnly' })
    response.end()
    return false
  })
  return {
    authorizeIndex,
    connection: {
      authenticatedUrl: (base: string) => `${base}?dsh_token=launch`,
      authorizeIndex,
    },
  }
}

async function boot(): Promise<{ ctx: Context; stub: ReturnType<typeof stubConnection> }> {
  const ctx = new Context()
  const stub = stubConnection()
  ctx.provide('connection', stub.connection)
  await ctx.plugin(plugin)
  return { ctx, stub }
}

function serverOf(ctx: Context): DesktopPipeWebServer {
  const server = ctx.get('webServer')
  expect(server).toBeInstanceOf(DesktopPipeWebServer)
  if (!(server instanceof DesktopPipeWebServer)) throw new Error('webServer stand-in absent')
  return server
}

describe('desktop pipe webserver', () => {
  it('provides webServer with the loopback pipe authority and mints one session', async () => {
    const { ctx, stub } = await boot()
    const server = serverOf(ctx)
    expect(server.port).toBe(0)
    expect(server.host).toBe('127.0.0.1')
    expect(stub.authorizeIndex).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('declares its cordis face and sequences after Connection', async () => {
    expect(plugin.name).toBe('desktop-pipe-webserver')
    expect(plugin.inject).toEqual(['connection'])
  })

  it('dispatches a matched prefix route through node-shaped shims with the minted cookie', async () => {
    const { ctx } = await boot()
    const server = serverOf(ctx)
    server.register({
      kind: 'prefix',
      path: '/dsh-ppt',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          method: req.method,
          url: req.url,
          host: req.headers.host,
          cookie: req.headers.cookie,
          origin: req.headers.origin ?? null,
          body: Buffer.concat(chunks).toString('utf8'),
        }))
      },
    })
    const response = await server.dispatch(new Request('http://dsh-app.invalid/dsh-ppt/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'dsh-app://', cookie: 'foreign=1' },
      body: '{"rpcId":"probe"}',
    }))
    expect(response).toBeInstanceOf(Response)
    expect(response?.status).toBe(200)
    const payload = await response?.json() as Record<string, unknown>
    expect(payload).toMatchObject({
      method: 'POST',
      url: '/dsh-ppt/state',
      host: '127.0.0.1:3080',
      cookie: 'dsh-web-session.127.0.0.1:3080=minted',
      origin: null,
      body: '{"rpcId":"probe"}',
    })
    await ctx.fiber.dispose()
  })

  it('returns undefined for unmatched paths and honors exact over longest prefix', async () => {
    const { ctx } = await boot()
    const server = serverOf(ctx)
    expect(await server.dispatch(new Request('http://dsh-app.invalid/other'))).toBeUndefined()
    const short = vi.fn((_req: IncomingMessage, res: ServerResponse) => { res.writeHead(200); res.end() })
    const long = vi.fn((_req: IncomingMessage, res: ServerResponse) => { res.writeHead(201); res.end() })
    server.register({ kind: 'prefix', path: '/dsh', handler: short })
    server.register({ kind: 'prefix', path: '/dsh-ppt', handler: long })
    server.register({
      kind: 'exact',
      path: '/dsh-ppt/state',
      handler: (_req: IncomingMessage, res: ServerResponse) => { res.writeHead(202); res.end() },
    })
    expect((await server.dispatch(new Request('http://dsh-app.invalid/dsh/other')))?.status).toBe(200)
    expect((await server.dispatch(new Request('http://dsh-app.invalid/dsh-ppt/deck')))?.status).toBe(201)
    expect((await server.dispatch(new Request('http://dsh-app.invalid/dsh-ppt/state')))?.status).toBe(202)
    expect(await server.dispatch(new Request('http://dsh-app.invalid/other'))).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('rejects duplicate registrations and restores the table through disposers', async () => {
    const { ctx } = await boot()
    const server = serverOf(ctx)
    const dispose = server.register({ kind: 'prefix', path: '/dup', handler: (_req: IncomingMessage, res: ServerResponse) => { res.end() } })
    expect(() => server.register({ kind: 'prefix', path: '/dup', handler: (_req: IncomingMessage, res: ServerResponse) => { res.end() } }))
      .toThrow(/duplicate prefix route/u)
    const disposeUpgrade = server.registerUpgrade({ path: '/up', handler: () => {} })
    expect(() => server.registerUpgrade({ path: '/up', handler: () => {} })).toThrow(/duplicate upgrade route/u)
    dispose()
    disposeUpgrade()
    expect(await server.dispatch(new Request('http://dsh-app.invalid/dup'))).toBeUndefined()
    expect(() => server.register({ kind: 'prefix', path: '/dup', handler: (_req: IncomingMessage, res: ServerResponse) => { res.end() } }))
      .not.toThrow()
    await ctx.fiber.dispose()
  })

  it('serves the registered fallback only while it is active', async () => {
    const { ctx } = await boot()
    const server = serverOf(ctx)
    const dispose = server.registerFallback((_req: IncomingMessage, res: ServerResponse) => { res.writeHead(404); res.end('fallback') })
    const response = await server.dispatch(new Request('http://dsh-app.invalid/anything'))
    expect(response?.status).toBe(404)
    expect(await response?.text()).toBe('fallback')
    dispose()
    expect(await server.dispatch(new Request('http://dsh-app.invalid/anything'))).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('keeps index taps and injections for the desktop index renderer', async () => {
    const { ctx } = await boot()
    const server = serverOf(ctx)
    const dispose = server.tapIndex(html => `${html}<!--tapped-->`)
    expect(server.applyIndexTaps('<html></html>')).toBe('<html></html><!--tapped-->')
    expect(server.renderIndex('<i>')).toBe('<i><!--tapped-->')
    dispose()
    expect(server.applyIndexTaps('<i>')).toBe('<i>')
    const row = { kind: 'script', placement: 'head', text: 'x' } as IndexInjection
    ctx.emit('webserver/index-inject', [row])
    expect(server.collectIndexInjections()).toEqual([row])
    await ctx.fiber.dispose()
  })

  it('completes bodyless responses without hanging the dispatch', async () => {
    const { ctx } = await boot()
    const server = serverOf(ctx)
    server.register({
      kind: 'exact',
      path: '/empty',
      handler: (_req: IncomingMessage, res: ServerResponse) => { res.writeHead(204); res.end() },
    })
    const response = await server.dispatch(new Request('http://dsh-app.invalid/empty'))
    expect(response?.status).toBe(204)
    expect(response?.body).toBeNull()
    await ctx.fiber.dispose()
  })
})
