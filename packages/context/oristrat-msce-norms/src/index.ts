/**
 * Oristrat MSCE development norms as a mode-scoped system-prompt section: in
 * coding mode every agent of this deployment carries it, so MSCE engine and
 * component norms govern code work natively instead of waiting for a skill
 * invocation. Work mode (volatile plugin config `oristrat-msce-norms.mode`) empties the section and the
 * paired hard gate passes through, leaving proposal, PPT, and document work
 * free of the engine discipline. The official plugin settings form exposes
 * this mode to the client and the paired guard.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { MSCE_NORMS_PROMPT } from './norms.ts'

/** Plugin name as the Loader row sees it. */
export const name = 'oristrat-msce-norms'

/** Services this plugin waits on before applying. */
export const inject = ['systemPrompt']

/** Deployment work modes. */
export interface Config {
  /** `coding` enforces the MSCE norms and paired guard; `work` lifts both. */
  mode: Volatile<'coding' | 'work'>
}

/** Live configuration exposed through the official plugin settings form. */
export const Config = z.object({ mode: z.union(['coding', 'work']).default('coding').volatile() })

/**
 * Register the mode-scoped norms section for this plugin configuration.
 * @param ctx - plugin context carrying the system-prompt registry.
 * @param config - selected Oristrat work mode.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.systemPrompt.section({
    name: 'context:oristrat-msce-norms',
    order: ctx.systemPrompt.getSectionOrder('ORISTRAT_MSCE_NORMS'),
    text: () => (config.mode.get() === 'work' ? '' : MSCE_NORMS_PROMPT),
  })
}
