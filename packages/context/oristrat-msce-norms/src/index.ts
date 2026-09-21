/**
 * Oristrat MSCE development norms as a mode-scoped system-prompt section: in
 * coding mode every agent of this deployment carries it, so MSCE engine and
 * component norms govern code work natively instead of waiting for a skill
 * invocation. Work mode (settings `oristrat.mode`) empties the section and the
 * paired hard gate passes through, leaving proposal, PPT, and document work
 * free of the engine discipline. This plugin owns the `oristrat` settings
 * namespace registration that both halves read.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { MSCE_NORMS_PROMPT } from './norms.ts'

/** Plugin name as the Loader row sees it. */
export const name = 'oristrat-msce-norms'

/** Services this plugin waits on before applying. */
export const inject = ['systemPrompt']

/** Settings namespace carrying the deployment work mode. */
const ORISTRAT_NS = 'oristrat'

/** Deployment work modes: coding enforces the MSCE norms, work lifts them. */
const OristratSettings = z.object({
  mode: z.union(['coding', 'work']).default('coding'),
})

/**
 * Register the mode-scoped norms section once per context that owns a prompt
 * registry. Absent a settings service the mode reads as coding, so the norms
 * stay enforced (fail closed to the stricter mode).
 * @param ctx - plugin context carrying the system-prompt registry.
 */
export function apply(ctx: Context): void {
  let readMode: () => string = () => 'coding'
  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(ORISTRAT_NS, OristratSettings)
    readMode = () => scope.get().mode
  })
  ctx.systemPrompt.section({
    name: 'context:oristrat-msce-norms',
    order: ctx.systemPrompt.getSectionOrder('ORISTRAT_MSCE_NORMS'),
    text: () => (readMode() === 'work' ? '' : MSCE_NORMS_PROMPT),
  })
}
