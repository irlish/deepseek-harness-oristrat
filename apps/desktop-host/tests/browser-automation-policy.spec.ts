/**
 * The Oristrat compositions mount exactly one official browser-use provider:
 * Chrome DevTools MCP in visible launch mode, so the agent can drive Chromium
 * while the person watches. The browser-use seam refuses a second provider,
 * so the patches must never grow a rival row.
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const root = new URL('../../../', import.meta.url)

const PROVIDER_IDS = [
  'browser-use-chrome-devtools-mcp',
  'browser-use-playwright-mcp',
  'browser-use-stagehand-native',
] as const

function composed(patch: string) {
  return composeEntries([loadOverlayPatches('dsh desktop', fileURLToPath(new URL(patch, root)))])
}

describe('browser automation composition policy', () => {
  it.each([
    'packages/bundle/web-app/cordis.patch.yml',
    'apps/desktop-host/config/desktop.cordis.patch.yml',
  ])('%s mounts the Chrome DevTools MCP provider visibly and alone', (patch) => {
    const entries = composed(patch)
    const providers = entries.filter(entry => (PROVIDER_IDS as readonly string[]).includes(entry.id))
    expect(providers.map(entry => entry.id)).toEqual(['browser-use-chrome-devtools-mcp'])
    expect(providers[0]?.config).toMatchObject({ mode: 'launch', headless: false })
    expect(providers[0]?.disabled).toBeFalsy()
  })
})
