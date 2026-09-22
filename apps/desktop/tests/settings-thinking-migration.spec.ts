import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { migrateOristratThinkingLevels } from '../src/settings-thinking-migration.ts'

async function freshHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-thinking-migration-'))
}

describe('migrateOristratThinkingLevels', () => {
  it('reports no change when the settings document is absent', async () => {
    const home = await freshHome()
    await expect(migrateOristratThinkingLevels(home)).resolves.toBe(false)
  })

  it('reports no change for a document without the pi-ai provider', async () => {
    const home = await freshHome()
    await writeFile(join(home, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: x\n', 'utf8')
    await expect(migrateOristratThinkingLevels(home)).resolves.toBe(false)
  })

  it('declares efforts and the gateway thinking format on a bare roster', async () => {
    const home = await freshHome()
    await writeFile(join(home, 'settings.yaml'), [
      'llm-pi-ai:',
      '  providers:',
      '    oristrat-official:',
      '      displayName: Oristrat - official',
      '      models:',
      '        - id: glm-5.3',
      '          name: GLM-5.3',
      '        - id: qwen3.8-max',
      '          name: Qwen3.8-Max',
      '          reasoningEfforts: false',
      '',
    ].join('\n'), 'utf8')
    await expect(migrateOristratThinkingLevels(home)).resolves.toBe(true)
    const parsed = load(await readFile(join(home, 'settings.yaml'), 'utf8')) as {
      'llm-pi-ai': { providers: { 'oristrat-official': {
        compat: { thinkingFormat: string }
        models: { id: string; reasoningEfforts?: unknown }[]
      } } }
    }
    const provider = parsed['llm-pi-ai'].providers['oristrat-official']
    expect(provider.compat.thinkingFormat).toBe('openai')
    expect(provider.models[0]?.reasoningEfforts).toEqual({ low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' })
    // An explicit `false` is a decision, not an absence.
    expect(provider.models[1]?.reasoningEfforts).toBe(false)
  })

  it('is idempotent and keeps a declared thinking format', async () => {
    const home = await freshHome()
    await writeFile(join(home, 'settings.yaml'), [
      'llm-pi-ai:',
      '  providers:',
      '    oristrat-official:',
      '      compat:',
      '        thinkingFormat: qwen',
      '      models:',
      '        - id: glm-5.3',
      '          name: GLM-5.3',
      '          reasoningEfforts:',
      '            low: low',
      '',
    ].join('\n'), 'utf8')
    await expect(migrateOristratThinkingLevels(home)).resolves.toBe(false)
    const parsed = load(await readFile(join(home, 'settings.yaml'), 'utf8')) as {
      'llm-pi-ai': { providers: { 'oristrat-official': { compat: { thinkingFormat: string } } } }
    }
    expect(parsed['llm-pi-ai'].providers['oristrat-official'].compat.thinkingFormat).toBe('qwen')
  })

  it('reports no change for a non-document settings file', async () => {
    const home = await freshHome()
    await writeFile(join(home, 'settings.yaml'), '- just\n- a\n- list\n', 'utf8')
    await expect(migrateOristratThinkingLevels(home)).resolves.toBe(false)
  })
})
