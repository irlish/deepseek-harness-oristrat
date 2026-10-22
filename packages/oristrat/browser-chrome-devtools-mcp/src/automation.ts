/** Session-scoped human browser controls over the same MCP tools used by the agent. */
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-tools'
import type { BrowserMcpConfig } from '@oristrat/dsh-browser-use-runtime/mcp'
import type { BrowserAutomationAction, BrowserAutomationConnection, BrowserAutomationResult } from './types.ts'

const PREFIX = 'mcp__chrome-devtools-mcp__'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Human controls for the current Session's Chrome DevTools connection. */
    browserAutomation: BrowserAutomation
  }
}

/** Browser control Remote owner; no independent browser or model runtime is created. */
export class BrowserAutomation extends TypertRemoteService {
  static inject = ['typert', 'agents', 'tools']

  private readonly connection: BrowserAutomationConnection

  /**
   * @param ctx - provider context.
   * @param config - profile-owned browser connection.
   */
  constructor(ctx: Context, config: BrowserMcpConfig) {
    super(ctx, 'browserAutomation', { namespace: 'browserAutomation' })
    this.connection = config.mode === 'attach'
      ? { mode: 'attach', endpoint: publicEndpoint(config.endpoint) }
      : { mode: 'launch', headless: config.headless }
  }

  /**
   * Inspect the profile-selected connection without starting Chromium.
   * @returns the deployment-owned launch or attachment settings.
   */
  @Remote
  configuration(): BrowserAutomationConnection {
    return this.connection
  }

  /**
   * Operate the Session browser and return fresh text from Chromium. Agent turns and other Sessions retain their ownership.
   * @param agent - live Session owner resolved by the Web Session controller.
   * @param action - one explicit page operation.
   * @param signal - cancels queued work; an already delivered browser action may have taken effect.
   * @returns a verified response or visible failure; failures retain the browser for inspection.
   */
  @Remote
  async perform(agent: Agent, action: BrowserAutomationAction, signal: AbortSignal): Promise<BrowserAutomationResult> {
    const answer = (status: BrowserAutomationResult['status'], text: string): BrowserAutomationResult => ({ connection: this.connection, status, text })
    if (agent.status === 'running') return answer('busy', '')
    const request = browserToolRequest(action)
    if (request === undefined) return answer('invalid-address', '')
    if (this.ctx.tools.get(`${PREFIX}${request.name}`, agent) === undefined) return answer('unavailable', '')
    const result = await this.ctx.tools.execute({
      agent, name: `${PREFIX}${request.name}`, arguments: request.arguments,
      callId: ToolCallId(randomUUID()), signal,
    })
    const text = result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    return answer(result.isError ? 'failed' : 'connected', text)
  }
}

function browserToolRequest(
  action: BrowserAutomationAction,
): { name: string; arguments: Record<string, string | number | boolean> } | undefined {
  switch (action.kind) {
    case 'pages': return { name: 'list_pages', arguments: {} }
    case 'observe': return { name: 'take_snapshot', arguments: { pageId: action.pageId } }
    case 'navigate': {
      let url: URL
      try { url = new URL(action.url) } catch (_error) {
        // Invalid user input has not reached Chromium.
        return undefined
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
      return { name: 'new_page', arguments: { url: url.href } }
    }
    case 'select': return { name: 'select_page', arguments: { pageId: action.pageId, bringToFront: true } }
    case 'click': return { name: 'click', arguments: { pageId: action.pageId, uid: action.uid, includeSnapshot: true } }
    case 'fill': return { name: 'fill', arguments: { pageId: action.pageId, uid: action.uid, value: action.value, includeSnapshot: true } }
    case 'back': case 'forward': case 'reload': return { name: 'navigate_page', arguments: { pageId: action.pageId, type: action.kind } }
    default: return assertNever(action)
  }
}

function publicEndpoint(endpoint: string): string {
  const url = new URL(endpoint)
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return url.href
}
