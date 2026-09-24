import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import ToolRuntime, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-web'
import { installDesktopSearchPolicy } from '../src/search-policy.ts'

const MCP_SEARCH = 'mcp__dashscope-websearch__bailian_web_search'
const signal = new AbortController().signal

function tool(name: string, reply = 'dashscope result'): ToolDefinition {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: () => Promise.resolve(reply),
  }
}

async function fixture(withPresetSearch = true, withMcpSearch = true): Promise<{ ctx: Context; agent: Agent; standing: Scope }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(WebRuntime, {})
  installDesktopSearchPolicy(ctx)
  const parent = {}
  let standing!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { standing = createScope(inner, parent) }, {
    inject: ['tools', 'systemPrompt', 'web'],
  }))
  if (withPresetSearch) await standing.ctx.plugin(ToolWeb, { fetch: true, searchTimeoutMs: 60_000 })
  if (withMcpSearch) ctx.tools.register(tool(MCP_SEARCH))
  const agent = { id: 'desktop-search-agent' } as Agent
  await ctx.plugin(Object.assign((inner: Context) => {
    ;(agent as { ctx: Context }).ctx = createScope(inner, agent, { parent }).ctx
  }, { inject: ['tools', 'systemPrompt'] }))
  agentEvents(ctx, agent).emit('agent/created', { source: 'startup' })
  return { ctx, agent, standing }
}

async function call(ctx: Context, agent: Agent, name: string): Promise<string> {
  const result = await ctx.tools.execute({
    signal,
    callId: ToolCallId(`call-${name}`),
    name,
    arguments: {},
    agent,
  })
  const first = result.content[0]
  return first?.type === 'text' ? first.text : ''
}

describe('Desktop search policy', () => {
  it('removes inherited DeepSeek search from prompts and dispatch while retaining MCP search and web_fetch', async () => {
    const { ctx, agent } = await fixture()
    try {
      const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent })
      const names = assembly.tools.map(item => item.name)
      expect(names).toContain(MCP_SEARCH)
      expect(names).toContain('web_fetch')
      expect(names).not.toContain('web_search')
      expect(renderPrompt(assembly)).not.toContain('Use the web_search tool')
      expect(await call(ctx, agent, 'web_search')).toBe('Error: unknown tool "web_search"')
      expect(await call(ctx, agent, MCP_SEARCH)).toBe('dashscope result')
      agent.ctx.tools.register(tool('web_search', 'agent-local result'))
      expect(await call(ctx, agent, 'web_search')).toBe('agent-local result')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('masks search after a preset is attached before the next model step', async () => {
    const { ctx, agent, standing } = await fixture(false)
    try {
      expect(ctx.tools.get('web_search', agent)).toBeUndefined()
      await standing.ctx.plugin(ToolWeb, { fetch: true, searchTimeoutMs: 60_000 })
      await agentEvents(ctx, agent).waterfall(
        'agent/pre-step',
        { messages: [], turn: 1, step: 1, signal },
        () => Promise.resolve({ kind: 'enter', messages: [] }),
      )
      expect(ctx.tools.get('web_search', agent)).toBeUndefined()
      expect(ctx.tools.get(MCP_SEARCH, agent)).toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps Desktop usable without MCP search and exposes it after reconnection', async () => {
    const { ctx, agent } = await fixture(true, false)
    try {
      expect((await ctx.systemPrompt.assemble({ agent, scope: agent })).tools.map(item => item.name))
        .not.toContain('web_search')
      expect(ctx.tools.get(MCP_SEARCH, agent)).toBeUndefined()
      expect(ctx.tools.get('web_fetch', agent)).toBeDefined()
      ctx.tools.register(tool(MCP_SEARCH))
      expect((await ctx.systemPrompt.assemble({ agent, scope: agent })).tools.map(item => item.name))
        .toContain(MCP_SEARCH)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('composes the shipped Desktop patch with DashScope MCP and disables the DeepSeek provider', () => {
    const root = new URL('../../../', import.meta.url)
    const patches = [
      'packages/bundle/base/cordis.patch.yml',
      'packages/bundle/web-app/cordis.patch.yml',
      'apps/desktop-host/config/desktop.cordis.patch.yml',
    ].map(path => loadOverlayPatches('dsh desktop', fileURLToPath(new URL(path, root))))
    const entries = composeEntries(patches)
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    expect(byId.get('web-search-deepseek')?.disabled).toBe(true)
    expect(byId.get('mcp-client-dashscope-websearch')?.config).toMatchObject({
      serverName: 'dashscope-websearch',
      authorizationEnv: 'DASHSCOPE_API_KEY',
      versionNegotiation: 'legacy',
      failOnStartupError: false,
    })
    // The entry resolves `authorizationEnv` at activation: without waiting for
    // `credentials` the first generation fails and search is lost for good.
    expect(byId.get('mcp-client-dashscope-websearch')?.inject).toEqual(expect.arrayContaining(['tools', 'credentials']))
  })
})
