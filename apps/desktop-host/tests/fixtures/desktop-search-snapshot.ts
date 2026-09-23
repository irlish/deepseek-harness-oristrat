/** Keyless tool generation for the Desktop search recorded-session snapshot. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { installDesktopSearchPolicy } from '../../src/search-policy.ts'

/** Loader identity for this snapshot-only plugin. */
export const name = 'desktop-search-snapshot'
/** Tool registry dependency. */
export const inject = ['tools']

/**
 * Mount the shipped policy with a deterministic stand-in for the remote MCP tool.
 * @param ctx - test profile context that owns the search tool.
 */
export function apply(ctx: Context): void {
  installDesktopSearchPolicy(ctx)
  ctx.tools.register({
    name: 'mcp__dashscope-websearch__bailian_web_search',
    description: 'Search the web through DashScope WebSearch MCP.',
    parameters: { type: 'object', properties: { query: { type: 'string', required: true } } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: () => Promise.resolve('Deterministic search fixture.'),
  })
}
