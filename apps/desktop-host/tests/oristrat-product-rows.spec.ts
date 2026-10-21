/**
 * The Oristrat product layer ported from dataelement/dsh-desktop mounts through
 * both shipped patches: the workbench runtime always, the market installer
 * unless ORISTRAT_MARKET=0, and the Office authoring plugin only while its
 * installation-owned resources environment is present (a bare boot must never
 * fail on the missing payload).
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const root = new URL('../../../', import.meta.url)

function composed(patch: string) {
  return composeEntries([loadOverlayPatches('dsh desktop', fileURLToPath(new URL(patch, root)))])
}

describe.each([
  'packages/bundle/web-app/cordis.patch.yml',
  'apps/desktop-host/config/desktop.cordis.patch.yml',
])('oristrat product rows in %s', (patch) => {
  it('mounts the workbench runtime with a harness-home catalog root', () => {
    const row = composed(patch).find(entry => entry.id === 'dsh-desktop-workbenches')
    expect(row).toBeDefined()
    expect(JSON.stringify((row?.config as { root?: unknown })?.root)).toContain('desktop-workbenches')
  })

  it('keeps the market installer switchable off through ORISTRAT_MARKET', () => {
    const row = composed(patch).find(entry => entry.id === 'dsh-desktop-market-installer')
    expect(row).toBeDefined()
    expect(JSON.stringify(row?.disabled)).toContain('ORISTRAT_MARKET')
  })

  it('gates the Office plugin on its resources environment', () => {
    const row = composed(patch).find(entry => entry.id === 'dsh-desktop-office')
    expect(row).toBeDefined()
    expect(JSON.stringify(row?.disabled)).toContain('DSH_DESKTOP_OFFICE_RESOURCES')
    expect(JSON.stringify((row?.config as { resources?: unknown })?.resources)).toContain('DSH_DESKTOP_OFFICE_RESOURCES')
  })
})
