import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { describe, expect, it } from 'vitest'
import { migrateOristratGatewayCompat } from '../src/profile-compat-migration.ts'

async function profile(source?: string): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-oristrat-compat-'))
  const path = join(dir, 'cordis.patch.yml')
  if (source !== undefined) await writeFile(path, source)
  return { dir, path }
}

describe('Oristrat gateway compatibility migration', () => {
  it('leaves a missing or unrelated profile patch unchanged', async () => {
    const missing = await profile()
    expect(await migrateOristratGatewayCompat(missing.dir)).toBe(false)
    const unrelated = await profile('- id: other\n  config:\n    enabled: true\n')
    expect(await migrateOristratGatewayCompat(unrelated.dir)).toBe(false)
  })

  it('adds the system-role switch to an existing Oristrat route without replacing models, comments, or !!js tags', async () => {
    const source = [
      '# Keep this profile comment.',
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      oristrat-official:',
      '        compat:',
      '          thinkingFormat: openai',
      '        models:',
      '          - id: deepseek-v4.1-flash',
      '            reasoningEfforts: { high: high, xhigh: xhigh }',
      '      another-route:',
      '        compat: { supportsDeveloperRole: true }',
      '- id: other',
      '  disabled: !!js "!ctx.get(\'service\')"',
      '',
    ].join('\n')
    const { dir, path } = await profile(source)
    expect(await migrateOristratGatewayCompat(dir)).toBe(true)
    const updated = await readFile(path, 'utf8')
    const document = parseDocument(updated, {
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
    })
    expect(document.errors).toEqual([])
    expect(document.getIn([0, 'config', 'providers', 'oristrat-official', 'compat', 'thinkingFormat'])).toBe('openai')
    expect(document.getIn([0, 'config', 'providers', 'oristrat-official', 'compat', 'supportsDeveloperRole'])).toBe(false)
    expect(document.getIn([0, 'config', 'providers', 'oristrat-official', 'models', 0, 'id'])).toBe('deepseek-v4.1-flash')
    expect(document.getIn([0, 'config', 'providers', 'another-route', 'compat', 'supportsDeveloperRole'])).toBe(true)
    expect(updated).toContain('# Keep this profile comment.')
    expect(updated).toContain('!!js')
    expect(await migrateOristratGatewayCompat(dir)).toBe(false)
    expect(await readFile(path, 'utf8')).toBe(updated)
  })

  it('preserves an explicit compatibility choice', async () => {
    const { dir, path } = await profile('- id: llm-pi-ai\n  config:\n    providers:\n      oristrat-official:\n        compat: { supportsDeveloperRole: true }\n')
    expect(await migrateOristratGatewayCompat(dir)).toBe(false)
    expect(await readFile(path, 'utf8')).toContain('supportsDeveloperRole: true')
  })
})
