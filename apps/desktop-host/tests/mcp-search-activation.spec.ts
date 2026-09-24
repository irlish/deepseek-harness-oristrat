/**
 * Desktop search wiring: the shipped composition must register the DashScope
 * MCP search tool. The MCP entry resolves `authorizationEnv` through the
 * credentials service during activation, so an entry that activates before that
 * service exists fails its first generation, and the supervisor then gives up
 * for good — leaving every session without any search tool.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import {
  CredentialProvider,
  credentialRef,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { apply, Config as mcpConfig, inject as mcpInject, name as mcpName } from '@deepseek-ai/dsh-mcp-client/src/index.ts'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { startHttpMcpFixture } from '../../../packages/mcp/mcp-client/tests/http-fixture.ts'

/** Credentials provider resolving only the DashScope search key. */
class StubCredentials extends CredentialProvider {
  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return Promise.resolve(ref === credentialRef('DASHSCOPE_API_KEY')
      ? { value: 'sekret', source: 'test' }
      : undefined)
  }

  override describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: false, writable: false })
  }

  override set(_ref: CredentialRef, _value: string): Promise<void> {
    return Promise.resolve()
  }

  override unset(_ref: CredentialRef): Promise<void> {
    return Promise.resolve()
  }

  override readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(undefined)
  }

  override modifyRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return this.readRecord(key)
  }

  override describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.resolve({ configured: false, writable: true })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([])
  }

  override deleteRecord(_key: CredentialKey): Promise<void> {
    return Promise.resolve()
  }
}

/** One row of the shipped Desktop patch layer, limited to the fields this test reads. */
function shippedEntry(id: string): { inject?: string[]; serverName: string; authorizationEnv: string; versionNegotiation: string } {
  const root = new URL('../../../', import.meta.url)
  const entries = composeEntries([loadOverlayPatches('desktop search test', fileURLToPath(
    new URL('apps/desktop-host/config/desktop.cordis.patch.yml', root),
  ))])
  const row = entries.find(entry => entry.id === id)
  if (row === undefined) throw new Error(`desktop patch has no entry "${id}"`)
  const declared = {
    serverName: configField(row, 'serverName'),
    authorizationEnv: configField(row, 'authorizationEnv'),
    versionNegotiation: configField(row, 'versionNegotiation'),
  }
  const inject = Array.isArray(row.inject) ? row.inject.map((entry: unknown) => String(entry)) : undefined
  return inject === undefined ? declared : { inject, ...declared }
}

/** Read a string field out of one patch entry's config. */
function configField(entry: { config?: unknown }, name: string): string {
  const value = (entry.config as Record<string, unknown> | undefined)?.[name]
  if (typeof value !== 'string') throw new Error(`desktop patch entry has no string ${name}`)
  return value
}

/**
 * Mount the Desktop MCP search entry over a local MCP endpoint, registering the
 * credentials provider only after the entry was mounted — a boot order a
 * Desktop Host can produce, where the provider appears while the composition is
 * still activating.
 * @param url - local Streamable HTTP MCP endpoint the entry connects to.
 * @param inject - dependencies the entry declares; the shipped list waits for credentials.
 * @returns the mounted composition and its tool names after the late provider registers.
 */
async function mountSearchEntry(
  url: string,
  inject: readonly string[],
): Promise<{ ctx: Context; names: () => string[] }> {
  const entry = shippedEntry('mcp-client-dashscope-websearch')
  const releaseCredentials: PromiseWithResolvers<void> = Promise.withResolvers()
  const credentialsReady: PromiseWithResolvers<void> = Promise.withResolvers()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.plugin({
    name: 'late-credentials',
    apply: async (inner: Context) => {
      await releaseCredentials.promise
      await inner.plugin(StubCredentials)
      credentialsReady.resolve()
    },
  })
  const fiber = ctx.plugin({ name: mcpName, inject, Config: mcpConfig, apply }, {
    transport: 'streamable-http',
    serverName: entry.serverName,
    url,
    authorizationEnv: entry.authorizationEnv,
    versionNegotiation: entry.versionNegotiation as 'legacy',
    failOnStartupError: false,
  })
  try {
    if (!inject.includes('credentials')) await fiber
    releaseCredentials.resolve()
    await credentialsReady.promise
    await fiber
  } catch (error) {
    releaseCredentials.resolve()
    await ctx.fiber.dispose()
    throw error
  }
  return {
    ctx,
    names: () => ctx.tools.schemas().map(schema => schema.name),
  }
}

describe('Desktop DashScope search wiring', () => {
  it('registers the search tool when the shipped entry waits for credentials', async () => {
    const fixture = await startHttpMcpFixture()
    let ctx: Context | undefined
    try {
      const entry = shippedEntry('mcp-client-dashscope-websearch')
      expect(entry.inject).toEqual(expect.arrayContaining(['tools', 'credentials']))
      expect(entry.versionNegotiation).toBe('legacy')
      const mounted = await mountSearchEntry(fixture.url, entry.inject ?? mcpInject)
      ctx = mounted.ctx
      await vi.waitFor(() => {
        expect(mounted.names()).toContain(`mcp__${entry.serverName}__ping`)
      }, { timeout: 10_000 })
      expect(fixture.authorization).toContain('Bearer sekret')
    } finally {
      await ctx?.fiber.dispose()
      await fixture.close()
    }
  })

  it('registers no search tool when the entry does not wait for credentials', async () => {
    const fixture = await startHttpMcpFixture()
    let ctx: Context | undefined
    try {
      const mounted = await mountSearchEntry(fixture.url, mcpInject)
      ctx = mounted.ctx
      expect(mounted.names().filter(name => name.startsWith('mcp__'))).toEqual([])
    } finally {
      await ctx?.fiber.dispose()
      await fixture.close()
    }
  }, 30_000)
})
