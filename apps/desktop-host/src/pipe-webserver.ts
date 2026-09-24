/**
 * Pipe-backed `webServer` stand-in for the Electron desktop host.
 *
 * The desktop host carries every renderer request over framed byte pipes and
 * boots the web-app composition with the listening webserver row disabled, so
 * bundle host plugins that gate web registration on `webServer` (the Office
 * PPT RPC channels among them) would wait forever and their routes would never
 * reach the pipe router. This service provides the same registration surface
 * against an in-process route table and dispatches matched requests from the
 * pipe router through node:http-shaped shims.
 * @module @deepseek-ai/dsh-desktop-host
 */

import { ServerResponse, type IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type { IndexInjection, WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'

/** Cordis plugin identity of the pipe webserver row. */
export const name = 'desktop-pipe-webserver'

/** Host services the stand-in needs before it can mint a pipe session. */
export const inject = ['connection']

/**
 * The two Connection operations the stand-in uses: launch-token URL minting
 * and the index authorization handshake that issues the session cookie.
 */
export interface PipeSessionConnection {
  authenticatedUrl(baseUrl: string): string
  authorizeIndex(request: unknown, response: unknown): boolean
}

/** Loopback authority the stand-in presents on every dispatched request. */
const PIPE_AUTHORITY = '127.0.0.1:3080'

/** Headers the pipe boundary already vouches for; never forwarded verbatim. */
const SUPPRESSED_HEADERS = new Set(['host', 'cookie', 'origin', 'referer', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest'])

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

interface HeaderSink {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(): unknown
}

/**
 * Run the index authorization handshake once and keep the issued cookie: the
 * pipe transport has no browser cookie jar, so the host mints its own
 * loopback-bound session and presents it on every dispatched request.
 * @param connection - live Connection service owning browser authentication.
 * @returns `name=value` cookie pair, or undefined when no cookie was issued.
 */
function mintSessionCookie(connection: PipeSessionConnection): string | undefined {
  const url = new URL(connection.authenticatedUrl(`http://${PIPE_AUTHORITY}/`))
  const search = url.searchParams.toString()
  const request = { method: 'GET', url: search === '' ? '/' : `/?${search}`, headers: { host: PIPE_AUTHORITY } }
  let cookie: string | undefined
  const response: HeaderSink = {
    writeHead(_status, headers) {
      const issued = headers?.['set-cookie']
      if (typeof issued === 'string') cookie = issued.split(';')[0]
      return undefined
    },
    end() { return undefined },
  }
  connection.authorizeIndex(request, response)
  return cookie
}

/** Collecting node:http response backed by ServerResponse's header API. */
class PipeServerResponse extends ServerResponse {
  private readonly chunks: Buffer[] = []
  private readonly finish: () => void
  /** Resolves once end() completes the response. */
  readonly settled: Promise<void>
  private ended = false

  constructor(request: IncomingMessage) {
    super(request)
    let resolveSettled: () => void = () => {}
    this.settled = new Promise<void>((resolve) => { resolveSettled = resolve })
    this.finish = resolveSettled
  }

  override write(
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean {
    this.chunks.push(Buffer.from(chunk))
    if (typeof encoding === 'function') encoding()
    else callback?.()
    return true
  }

  override end(chunk?: string | Uint8Array | (() => void), encoding?: BufferEncoding | (() => void), callback?: () => void): this {
    if (typeof chunk === 'string' || chunk instanceof Uint8Array) this.chunks.push(Buffer.from(chunk))
    if (!this.ended) {
      this.ended = true
      this.finish()
    }
    if (typeof chunk === 'function') chunk()
    else if (typeof encoding === 'function') encoding()
    else callback?.()
    return this
  }

  /** Frozen WHATWG response over the collected status, headers, and body. */
  toResponse(): Response {
    const body = this.chunks.length === 0 ? null : new Uint8Array(Buffer.concat(this.chunks))
    const headers = new Headers(Object.entries(this.getHeaders())
      .map(([key, value]): [string, string] => [key, Array.isArray(value) ? value.join(', ') : String(value)]))
    return new Response(body, { status: this.statusCode, headers })
  }
}

/**
 * Build the node:http request shim one dispatched pipe request reads through.
 * @param request - pipe-forwarded WHATWG request.
 * @param bodyChunks - buffered request body bytes.
 * @param cookie - minted loopback session cookie pair.
 */
function createRequestShim(request: Request, bodyChunks: readonly Buffer[], cookie: string | undefined): IncomingMessage {
  const url = new URL(request.url)
  const headers: Record<string, string> = {}
  for (const [key, value] of request.headers.entries()) {
    const lowered = key.toLowerCase()
    if (!SUPPRESSED_HEADERS.has(lowered)) headers[lowered] = value
  }
  headers.host = PIPE_AUTHORITY
  if (cookie !== undefined) headers.cookie = cookie
  const shim = Readable.from(bodyChunks.slice()) as IncomingMessage
  Object.assign(shim, { method: request.method, url: `${url.pathname}${url.search}`, headers })
  return shim
}

/**
 * Registration surface and pipe dispatch owner served as `webServer`.
 * Route matching mirrors the listening webserver: exact table first, then
 * longest prefix wins; a registered fallback owns everything else.
 */
export class DesktopPipeWebServer extends Service {
  private readonly exact = new Map<string, WebRoute>()
  private readonly prefixes = new Map<string, WebRoute>()
  private readonly upgrades = new Map<string, WebUpgradeRoute>()
  private readonly taps: ((html: string) => string)[] = []
  private readonly injections: IndexInjection[] = []
  private fallback: NodeHandler | undefined
  private readonly cookie: string | undefined

  /**
   * Provide `webServer` over the in-process route table.
   * @param ctx - owning desktop host context.
   * @param connection - Connection service that mints the pipe session cookie.
   */
  constructor(ctx: Context, connection: PipeSessionConnection) {
    super(ctx, 'webServer')
    this.cookie = mintSessionCookie(connection)
    ctx.on('webserver/index-inject', (rows: IndexInjection[]) => {
      this.injections.push(...rows)
    })
  }

  /** The desktop host never binds a socket. */
  get port(): number {
    return 0
  }

  /** Loopback is the only authority the pipe transport presents. */
  get host(): '127.0.0.1' {
    return '127.0.0.1'
  }

  /** Register one exact or prefix route; duplicate (kind, path) throws. */
  register(route: WebRoute): () => void {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) {
      throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
    }
    table.set(route.path, route)
    return () => { table.delete(route.path) }
  }

  /** Upgrades cannot cross the byte pipe; registrations are kept inert. */
  registerUpgrade(route: WebUpgradeRoute): () => void {
    if (this.upgrades.has(route.path)) {
      throw new Error(`webserver: duplicate upgrade route "${route.path}"`)
    }
    this.upgrades.set(route.path, route)
    return () => { this.upgrades.delete(route.path) }
  }

  /** Own every pathname no exact or prefix route matches. */
  registerFallback(handler: NodeHandler): () => void {
    this.fallback = handler
    return () => { this.fallback = undefined }
  }

  /** Queue one index.html transform applied in registration order. */
  tapIndex(transform: (html: string) => string): () => void {
    this.taps.push(transform)
    return () => {
      const at = this.taps.indexOf(transform)
      if (at !== -1) this.taps.splice(at, 1)
    }
  }

  /** Run every queued transform over one index.html body. */
  applyIndexTaps(html: string): string {
    let out = html
    for (const transform of this.taps) out = transform(out)
    return out
  }

  /** Index injections emitted through the shared webserver event. */
  collectIndexInjections(): IndexInjection[] {
    return [...this.injections]
  }

  /** Tap-transform one index.html body (alias of applyIndexTaps). */
  renderIndex(html: string): string {
    return this.applyIndexTaps(html)
  }

  /**
   * Dispatch one pipe-forwarded request against the route table.
   * @param request - request carried over the desktop byte pipe.
   * @returns the route's response, or undefined when no route matches so the
   *   caller falls through to the validated asset handler.
   */
  async dispatch(request: Request): Promise<Response | undefined> {
    const pathname = new URL(request.url).pathname
    const route = this.match(pathname)
    if (route === undefined) return undefined
    const bodyChunks: Buffer[] = []
    if (request.body !== null) {
      for await (const chunk of request.body) bodyChunks.push(Buffer.from(chunk))
    }
    const req = createRequestShim(request, bodyChunks, this.cookie)
    const res = new PipeServerResponse(req)
    await route.handler(req, res)
    await res.settled
    return res.toResponse()
  }

  /** Exact hit first, then longest prefix, then the registered fallback. */
  private match(pathname: string): WebRoute | undefined {
    const exact = this.exact.get(pathname)
    if (exact !== undefined) return exact
    let best: WebRoute | undefined
    for (const [prefix, route] of this.prefixes) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
      if (best === undefined || prefix.length > best.path.length) best = route
    }
    if (best !== undefined) return best
    const fallback = this.fallback
    return fallback === undefined ? undefined : { kind: 'prefix', path: pathname, handler: fallback }
  }
}

/**
 * Provide the pipe-backed webserver stand-in for the desktop composition.
 * The inject face sequences this fiber after Connection, so the service is
 * present when apply runs.
 * @param ctx - desktop host context with the Connection service active.
 */
export function apply(ctx: Context): void {
  new DesktopPipeWebServer(ctx, ctx.get('connection') as PipeSessionConnection)
}
