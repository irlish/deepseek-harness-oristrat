/** First-run thinking-level migration for the shipped Oristrat provider roster. */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dump, load } from 'js-yaml'

/**
 * Reasoning efforts the Oristrat gateway accepts for every routed model, as
 * `reasoningEfforts` wire spellings: level id to the value dispatch sends.
 */
export const ORISTRAT_REASONING_EFFORTS: Readonly<Record<string, string>> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
}

/** The reasoning wire format the Oristrat OpenAI-compatible gateway speaks. */
const ORISTRAT_THINKING_FORMAT = 'openai'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Declare the shipped roster's thinking levels in an existing settings
 * document so the composer's effort slider has levels to offer. Entries that
 * already carry `reasoningEfforts` — including an explicit `false` — keep
 * theirs, and a present `compat.thinkingFormat` is never replaced.
 * @param home - Harness home owning `settings.yaml`.
 * @returns whether the document changed and was rewritten.
 */
export async function migrateOristratThinkingLevels(home: string): Promise<boolean> {
  const target = join(home, 'settings.yaml')
  if (!existsSync(target)) return false
  const parsed = load(await readFile(target, 'utf8'))
  if (!isRecord(parsed)) return false
  const piAi = parsed['llm-pi-ai']
  if (!isRecord(piAi)) return false
  const providers = piAi['providers']
  if (!isRecord(providers)) return false
  const provider = providers['oristrat-official']
  if (!isRecord(provider)) return false
  let changed = false
  const compat = isRecord(provider['compat']) ? provider['compat'] : {}
  if (compat['thinkingFormat'] === undefined) {
    provider['compat'] = { ...compat, thinkingFormat: ORISTRAT_THINKING_FORMAT }
    changed = true
  }
  const models = provider['models']
  if (Array.isArray(models)) {
    for (const entry of models) {
      if (isRecord(entry) && !('reasoningEfforts' in entry)) {
        entry['reasoningEfforts'] = { ...ORISTRAT_REASONING_EFFORTS }
        changed = true
      }
    }
  }
  if (!changed) return false
  await writeFile(target, dump(parsed, { lineWidth: -1 }), 'utf8')
  return true
}
