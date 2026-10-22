import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'

// The prebuilt market plugin exposes its launcher resolver without TypeScript declarations.
const vendorEntry = '../vendor/market-installer/index.js'
const { resolveDshEntry } = await import(vendorEntry) as {
  resolveDshEntry: (argv?: string[], installAnchor?: string) => string
}

async function launcherManifest(bin: object | string | undefined): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-market-launcher-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, 'launcher.js'), 'export {}\n')
  const manifest = join(directory, 'package.json')
  await writeFile(manifest, JSON.stringify({ name: '@fixture/dsh', bin }))
  return manifest
}

it.each([{ dsh: './launcher.js' }, './launcher.js'])('uses the profile launcher with non-CLI host arguments: %j', async (bin) => {
  const manifest = await launcherManifest(bin)
  expect(resolveDshEntry(['node', '/host/browser-test.js'], manifest)).toBe(join(resolve(manifest, '..'), 'launcher.js'))
})

it('rejects a profile manifest without a dsh executable instead of running the host entry', async () => {
  const manifest = await launcherManifest({ other: './launcher.js' })
  expect(() => resolveDshEntry(['node', '/host/bin.js'], manifest)).toThrow('does not declare a dsh binary')
})

it('reports an absent built launcher before package operations start', async () => {
  const manifest = await launcherManifest({ dsh: './missing.js' })
  expect(() => resolveDshEntry(['node', '/host/bin.js'], manifest)).toThrow('build or reinstall the application')
})

it('retains the direct CLI entry for callers without an active profile', () => {
  expect(resolveDshEntry(['node', '/app/lib/bin.js'])).toBe(resolve('/app/lib/bin.js'))
  expect(() => resolveDshEntry(['node', '/host/browser-test.js'])).toThrow('could not be identified')
})
