/**
 * The ported Office plugin validates its installation-owned configuration
 * before touching the Context: a composition that forgets the absolute
 * resources or CLI path fails loud at activation instead of half-registering.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

interface OfficePlugin {
  readonly name: string
  readonly inject: readonly string[]
  apply(ctx: unknown, config: unknown): Promise<void>
}

const office = require('dsh-desktop-office') as OfficePlugin

describe('dsh-desktop-office plugin shape', () => {
  it('exports the cordis plugin surface', () => {
    expect(office.name).toBe('desktop-office')
    expect(office.inject).toEqual(['skills'])
    expect(typeof office.apply).toBe('function')
  })

  it.each([
    undefined,
    {},
    { resources: 'relative/path', cli: '/opt/node' },
    { resources: '/opt/office', cli: 'node' },
  ])('refuses the invalid config %j', async (config) => {
    await expect(office.apply({}, config)).rejects.toThrow(/absolute resources and CLI paths/u)
  })
})
