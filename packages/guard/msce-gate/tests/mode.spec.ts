import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as gate from '../src/index.ts'

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

/** Presence-only double satisfying the guard's `tools` inject. */
class StubTools extends Service {
  constructor(ctx: Context) {
    super(ctx, 'tools')
  }
}

/** Sentinel the pass-through base handler returns. */
const PASSED: ToolExecutionResult = { isError: false, value: 'passed', content: [{ type: 'text', text: 'passed' }] }

const workspaces: string[] = []

/** Materialize an MSCE-marked workspace root. */
function msceWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'msce-gate-'))
  writeFileSync(join(dir, 'HARNESS.md'), '# harness\n')
  workspaces.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Boot the guard over stubs with an optional settings document, and dispatch one write. */
async function dispatchWrite(settingsDoc: Record<string, unknown> | undefined, cwd: string): Promise<ToolExecutionResult> {
  const ctx = new Context()
  await ctx.plugin(StubTools)
  if (settingsDoc !== undefined) {
    await ctx.plugin(MemorySettings, { doc: settingsDoc })
    // The norms plugin owns this registration in production; the guard only reads it.
    ;(ctx.get('settings') as MemorySettings)
      .register('oristrat', z.object({ mode: z.union(['coding', 'work']).default('coding') }))
  }
  await ctx.plugin(gate)
  const exec = {
    name: 'write',
    arguments: {},
    agent: { session: { meta: { cwd }, events: [] } },
  }
  // The registry dispatches with a scoped carrier and a prepared execution;
  // the guard reads neither identity, so the stub context stands in for both.
  type Dispatch = (carrier: unknown, name: 'tools/execute', exec: unknown, next: () => Promise<ToolExecutionResult>) => Promise<ToolExecutionResult>
  const dispatch = ctx.waterfall.bind(ctx) as unknown as Dispatch
  return await dispatch(ctx, 'tools/execute', exec, async () => PASSED)
}

describe('msce-gate mode scoping', () => {
  it('blocks an undiscovered mutation in coding mode', async () => {
    const result = await dispatchWrite({}, msceWorkspace())
    expect(result.isError).toBe(true)
    expect((result.error as { info: { code: string } }).info.code).toBe('MSCE_GATE')
  })

  it('passes the same mutation through in work mode', async () => {
    const result = await dispatchWrite({ oristrat: { mode: 'work' } }, msceWorkspace())
    expect(result).toBe(PASSED)
  })

  it('fails closed to coding without a settings service', async () => {
    const result = await dispatchWrite(undefined, msceWorkspace())
    expect(result.isError).toBe(true)
  })

  it('leaves non-MSCE workspaces untouched in coding mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plain-'))
    workspaces.push(dir)
    const result = await dispatchWrite({}, dir)
    expect(result).toBe(PASSED)
  })
})
