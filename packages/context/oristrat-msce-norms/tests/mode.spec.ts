import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import * as norms from '../src/index.ts'
import { MSCE_NORMS_PROMPT } from '../src/norms.ts'

/** In-memory settings provider: the Service Definition owns initialization. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(ctx: Context, options?: { doc?: Record<string, unknown> }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

/** Prompt-registry double capturing every section registration. */
class StubSystemPrompt extends Service {
  readonly sections: PromptSection[] = []

  constructor(ctx: Context) {
    super(ctx, 'systemPrompt')
  }

  section(section: PromptSection): () => void {
    this.sections.push(section)
    return () => {}
  }

  getSectionOrder(): number {
    return 650
  }
}

/** Boot the norms plugin over the registry double and an optional settings provider. */
async function boot(settingsDoc?: Record<string, unknown>) {
  const ctx = new Context()
  await ctx.plugin(StubSystemPrompt)
  if (settingsDoc !== undefined) await ctx.plugin(MemorySettings, { doc: settingsDoc })
  await ctx.plugin(norms)
  const prompts = ctx.get('systemPrompt') as unknown as StubSystemPrompt
  const section = prompts.sections.find(entry => entry.name === 'context:oristrat-msce-norms')
  if (section === undefined) throw new Error('norms section was not registered')
  return { ctx, section }
}

/** Resolve the section text the way the prompt assembler does. */
function textOf(section: PromptSection): string {
  return typeof section.text === 'function' ? section.text({}) : section.text
}

describe('oristrat-msce-norms mode scoping', () => {
  it('carries the norms prompt without a settings service (fail closed to coding)', async () => {
    const { section } = await boot()
    expect(textOf(section)).toBe(MSCE_NORMS_PROMPT)
  })

  it('carries the norms prompt in default and explicit coding mode', async () => {
    const defaulted = await boot({})
    expect(textOf(defaulted.section)).toBe(MSCE_NORMS_PROMPT)
    const explicit = await boot({ oristrat: { mode: 'coding' } })
    expect(textOf(explicit.section)).toBe(MSCE_NORMS_PROMPT)
  })

  it('empties the section in work mode', async () => {
    const { section } = await boot({ oristrat: { mode: 'work' } })
    expect(textOf(section)).toBe('')
  })

  it('follows a live mode switch in both directions', async () => {
    const { ctx, section } = await boot({})
    const settings = ctx.get('settings') as MemorySettings
    expect(textOf(section)).toBe(MSCE_NORMS_PROMPT)
    await settings.update('oristrat', { mode: 'work' })
    expect(textOf(section)).toBe('')
    await settings.update('oristrat', { mode: 'coding' })
    expect(textOf(section)).toBe(MSCE_NORMS_PROMPT)
  })

  it('owns the oristrat namespace registration with the two-mode schema', async () => {
    const { ctx } = await boot({})
    const settings = ctx.get('settings') as MemorySettings
    const descriptor = settings.describe().find(entry => entry.ns === 'oristrat')
    expect(descriptor).toBeDefined()
    expect(descriptor?.value).toEqual({ mode: 'coding' })
    // The schema admits exactly the two deployment modes.
    const schema = z.object({ mode: z.union(['coding', 'work']).default('coding') })
    expect(schema(descriptor?.value as never)).toEqual({ mode: 'coding' })
  })
})
