/**
 * Hard Oristrat MSCE gates on the tool-execution waterfall.
 *
 * The norms section makes MSCE discipline prompt-native; this guard makes two
 * of its rules physical inside MSCE workspaces: no code mutation before
 * Harness-Aware Discovery left evidence in the session, and no git handoff
 * before an `MSCE_SUBMISSION_GATE: PASS` newer than the last mutation. Every
 * other workspace and every other tool passes through untouched. In work mode
 * (volatile plugin config `oristrat-msce-norms.mode`) both gates lift
 * entirely; an absent or unreadable settings service reads as coding, so the
 * gates stay enforced.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/** Plugin name as the Loader row sees it. */
export const name = 'msce-gate'

/** Services this plugin waits on before applying. */
export const inject = ['tools']

/** Files or top-level shapes that mark a workspace as an MSCE project. */
const MARKER_FILES = ['HARNESS.md', 'FRAMEWORK.md'] as const
const MARKER_ENTRIES = /^(msce[\-.]|bricks?$|components?$|logic?$|workflows?$)/i

/** Discovery evidence: a read-style call or skill load naming a harness source. */
const DISCOVERY_TOOLS = /"(read|glob|grep|skill)"/
const DISCOVERY_TOKENS = ['HARNESS.md', 'FRAMEWORK.md', 'AGENTS.md', 'msce-engine-app-development'] as const

/** Code-mutation tools the discovery gate watches. */
const MUTATION_TOOLS = new Set(['write', 'edit'])

/** Git handoff commands the submission gate watches. */
const GIT_SUBMIT = /git\s+(add|commit|push)\b/

/** The gate marker the norms require before any git handoff. */
const GATE_PASS = 'MSCE_SUBMISSION_GATE: PASS'

const DISCOVERY_BLOCK = 'MSCE 门禁阻断：MSCE 工作区内修改代码前必须完成 Harness-Aware Discovery。'
  + '请先 read/glob 本项目的 HARNESS.md / FRAMEWORK.md / AGENTS.md（或加载 skill msce-engine-app-development），'
  + '让 loader 或示例决定读取范围后再重试本次写入。'

const GATE_BLOCK = 'MSCE 门禁阻断：git add/commit/push 需要先有晚于最后一次代码修改的 MSCE_SUBMISSION_GATE: PASS。'
  + '请先完成候选范围验证与 MSCE_COMMENT_REVIEW（View 另加 VIEW_COMMENT_REVIEW），在回复中输出 PASS 结论后重试。'

/** Whether the workspace root carries an MSCE marker. */
function isMsceWorkspace(cwd: string | undefined): boolean {
  if (cwd === undefined) return false
  for (const file of MARKER_FILES) {
    if (existsSync(join(cwd, file))) return true
  }
  let entries: string[]
  try {
    entries = readdirSync(cwd)
  } catch {
    return false
  }
  return entries.some(entry => MARKER_ENTRIES.test(entry))
}

/** Whether the deployment currently runs in free-form work mode. */
function isWorkMode(ctx: Context): boolean {
  const descriptor = ctx.get('settings')?.describe().find(entry => entry.ns === 'oristrat-msce-norms')
  const section = descriptor?.value
  return typeof section === 'object' && section !== null && 'mode' in section && section.mode === 'work'
}

/** Stable text of one session event for marker scanning. */
function textOf(event: unknown): string {
  try {
    // JSON.stringify returns undefined for undefined input despite its string typing.
    const text = JSON.stringify(event) as string | undefined
    return text ?? ''
  } catch {
    return ''
  }
}

/** A blocked dispatch the model reads as a tool error. */
function blocked(message: string): ToolExecutionResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: { message, info: { name: 'MsceGateError', code: 'MSCE_GATE' } },
  }
}

/**
 * Wrap tool execution with the two MSCE gates.
 * @param ctx - plugin context carrying the tool runtime waterfall.
 */
export function apply(ctx: Context): void {
  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    if (isWorkMode(ctx)) return next()
    const session = exec.agent?.session as
      | { meta?: { cwd?: string }; cwd?: string; events?: readonly unknown[] }
      | undefined
    const cwd = session?.meta?.cwd ?? session?.cwd
    if (session === undefined || !isMsceWorkspace(cwd)) return next()
    const events = session.events ?? []
    const texts = events.map(textOf)
    const discovery = texts.some(text => DISCOVERY_TOOLS.test(text) && DISCOVERY_TOKENS.some(token => text.includes(token)))
    if (MUTATION_TOOLS.has(exec.name) && !discovery) return blocked(DISCOVERY_BLOCK)
    const rawCommand = exec.name === 'bash'
      ? (exec.arguments as { command?: unknown } | undefined)?.command
      : undefined
    const command = typeof rawCommand === 'string' ? rawCommand : ''
    if (GIT_SUBMIT.test(command)) {
      let lastMutation = -1
      let lastPass = -1
      texts.forEach((text, index) => {
        if (/"(write|edit)"/.test(text) && /tool/i.test(text)) lastMutation = index
        if (text.includes(GATE_PASS)) lastPass = index
      })
      if (lastPass <= lastMutation) return blocked(GATE_BLOCK)
    }
    return next()
  })
}
