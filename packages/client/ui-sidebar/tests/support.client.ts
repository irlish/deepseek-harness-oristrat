/** Shared settings-scope double for the sidebar specs: the `oristrat` mode section. */
import type { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope, type StubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'

/** Stored section shape the work-mode scope mirrors. */
export interface OristratModeSettings {
  mode?: unknown
}

/**
 * Provide `settingsScope` bound to one stub scope over the work-mode
 * namespace. Seeding publishes a committed section before the plugin mounts,
 * mirroring the shared describe mirror's eager read; later `publish` calls
 * stand in for Host commit folds.
 * @param ctx - the Context the double registers on.
 * @param initial - optional committed mode seeded into the stub snapshot.
 * @returns the stub handle: write spies, listener count, and publish control.
 */
export function provideSidebarModeScope(
  ctx: Context, initial?: 'coding' | 'work',
): StubSettingsScope<OristratModeSettings> {
  const stub = stubSettingsScope<OristratModeSettings>()
  if (initial !== undefined) stub.publish({ status: 'ready', value: { mode: initial }, writable: true })
  ctx.provide('settingsScope', { bind: () => stub.scope } as never)
  return stub
}
