/** The vendored Office runtime ships JavaScript; exercise its installed exports and writer process. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('creates native Office files and retains workspace-scoped history through the shipped JavaScript', async () => {
  const result = await promisify(execFile)(process.execPath, ['--test', fileURLToPath(new URL('../../desktop/vendor/office/tests/authoring.test.mjs', import.meta.url))], { timeout: 20_000 })
  expect(result.stdout).toContain('# fail 0')
}, 25_000)
