import { describe, expect, it } from 'vitest'
import { RecordingBrowser, mountHarness } from './harness.ts'

/** Names of the registered tools, sorted, for set comparison. */
function toolNames(ctx: { tools: { schemas(): { name: string }[] } }): string[] {
  return ctx.tools.schemas().map(schema => schema.name).sort()
}

describe('tool-browser registry lifecycles', () => {
  it('registers no browser tool while no browser provider is mounted', async () => {
    const h = await mountHarness({ browser: false })
    expect(toolNames(h.ctx)).toEqual([])
    expect(h.ctx.tools.get('browser_state')).toBeUndefined()
  })

  it('registers the tools once a provider arrives after the plugin', async () => {
    const h = await mountHarness({ browser: false })
    expect(toolNames(h.ctx)).toEqual([])

    await h.ctx.plugin(RecordingBrowser)
    expect(toolNames(h.ctx)).toContain('browser_state')
    expect(toolNames(h.ctx)).toHaveLength(7)
  })

  it('removes every browser tool when the tool fiber is disposed', async () => {
    const h = await mountHarness()
    expect(toolNames(h.ctx)).toHaveLength(7)

    await h.toolFiber.dispose()
    expect(toolNames(h.ctx)).toEqual([])
  })

  it('restores nothing when a disposed tool fiber is disposed again', async () => {
    const h = await mountHarness()
    await h.toolFiber.dispose()
    await h.toolFiber.dispose()
    expect(toolNames(h.ctx)).toEqual([])
  })
})
