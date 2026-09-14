/**
 * Always-on Oristrat MSCE development norms: one system-prompt section every
 * agent of this deployment carries, so MSCE engine and component norms govern
 * code work natively instead of waiting for a skill invocation.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { MSCE_NORMS_PROMPT } from './norms.ts'

/** Plugin name as the Loader row sees it. */
export const name = 'oristrat-msce-norms'

/** Services this plugin waits on before applying. */
export const inject = ['systemPrompt']

/**
 * Register the norms section once per context that owns a prompt registry.
 * @param ctx - plugin context carrying the system-prompt registry.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'context:oristrat-msce-norms',
    order: ctx.systemPrompt.getSectionOrder('ORISTRAT_MSCE_NORMS'),
    text: () => MSCE_NORMS_PROMPT,
  })
}
