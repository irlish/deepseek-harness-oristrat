/**
 * The Oristrat product layer ported from dataelement/dsh-desktop mounts through
 * both shipped patches. Web creation works without installation-owned Office
 * resources, while Desktop retains its packaged resource selection.
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

  it('provides creation without optional resources and assigns Desktop runtime ownership', () => {
    const row = composed(patch).find(entry => entry.id === 'dsh-desktop-office')
    expect(row).toBeDefined()
    expect(row?.disabled).toBeFalsy()
    expect(JSON.stringify((row?.config as { root?: unknown })?.root)).toContain("dshHomePath('office')")
    expect((row?.config as { runtimeOwner?: string })?.runtimeOwner).toBe(patch.startsWith('packages/') ? undefined : 'desktop')
    expect(JSON.stringify((row?.config as { resources?: unknown })?.resources)).toContain('DSH_DESKTOP_OFFICE_RESOURCES')
  })
})

it('mounts the Web PPT composer only when no profile bundle owns it', () => {
  const row = composed('packages/bundle/web-app/cordis.patch.yml').find(entry => entry.id === 'web-ppt-composer')
  expect(row?.name).toBe('dsh-ppt-composer')
  expect(JSON.stringify(row?.disabled)).toContain("startedBundles.includes('dsh-ppt-composer')")
  expect(JSON.stringify((row?.config as { root?: unknown })?.root)).toContain("dshHomePath('kimi-ppt')")
})
