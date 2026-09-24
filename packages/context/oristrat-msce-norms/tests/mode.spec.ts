import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import * as norms from '../src/index.ts'
import { MSCE_NORMS_PROMPT } from '../src/norms.ts'

class StubSystemPrompt extends Service {
  readonly sections: PromptSection[] = []
  constructor(ctx: Context) { super(ctx, 'systemPrompt') }
  section(section: PromptSection): () => void { this.sections.push(section); return () => {} }
  getSectionOrder(): number { return 650 }
}

async function prompt(mode?: 'coding' | 'work'): Promise<string> {
  const ctx = new Context()
  try {
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(norms, mode === undefined ? {} : { mode })
    const promptRegistry = ctx.get('systemPrompt')
    if (!(promptRegistry instanceof StubSystemPrompt)) throw new Error('prompt registry was not mounted')
    const section = promptRegistry.sections.find(entry => entry.name === 'context:oristrat-msce-norms')
    if (section === undefined) throw new Error('norms section was not registered')
    return typeof section.text === 'function' ? section.text({}) : section.text
  } finally {
    await ctx.fiber.dispose()
  }
}

describe('Oristrat work mode', () => {
  it('enforces MSCE norms by default and in coding mode', async () => {
    expect(await prompt()).toBe(MSCE_NORMS_PROMPT)
    expect(await prompt('coding')).toBe(MSCE_NORMS_PROMPT)
  })

  it('removes MSCE norms in work mode', async () => {
    expect(await prompt('work')).toBe('')
  })

  it('exposes a validated live configuration field', () => {
    expect(norms.Config({ mode: 'work' }).mode.get()).toBe('work')
    expect(() => norms.Config({ mode: 'invalid' as never })).toThrow()
  })
})
