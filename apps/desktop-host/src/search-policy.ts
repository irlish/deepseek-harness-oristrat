/**
 * Desktop search policy: inherited preset web_search is hidden so the
 * DashScope MCP tool is the model's search entry point. The per-agent mask
 * also applies to execution and survives preset recomposition.
 * @module @deepseek-ai/dsh-desktop-host/search-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import { scopeOf, scopeParentOf } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'

/**
 * Install the Desktop-only search mask before an agent's first request and
 * after a blank-session preset switch. Agent-owned search tools remain the
 * owner's explicit choice; inherited preset search never replaces MCP.
 * @param ctx - Desktop Host root context.
 */
export function installDesktopSearchPolicy(ctx: Context): void {
  const masked = new WeakSet<Agent>()
  const maskInheritedSearch = (agent: Agent): void => {
    if (masked.has(agent)) return
    const key = scopeOf(agent.ctx)
    if (key === undefined) throw new Error('dsh desktop: agent has no tool scope')
    if (ctx.tools.get('web_search', scopeParentOf(key)) === undefined) return
    agent.ctx.tools.restrict({ deny: ['web_search'] })
    masked.add(agent)
  }

  ctx.on('agent/created', ({ agent }) => { maskInheritedSearch(agent) })
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    maskInheritedSearch(agent)
    return next()
  })
}
