/**
 * The workbench catalog reader accepts only the documented query vocabulary:
 * unknown parameters, duplicated cache flags, and malformed force values are
 * refused with the catalog error codes the client renders.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

interface WorkbenchesPlugin {
  catalogReadOptions(request: { url: string }): { cachedOnly?: boolean; force?: boolean }
}

const plugin = require('dsh-desktop-workbenches') as WorkbenchesPlugin

const read = (query: string): unknown => plugin.catalogReadOptions({ url: `https://host/api/desktop-workbenches/catalog${query}` })

describe('workbench catalog query validation', () => {
  it('defaults to a cached-when-fresh read', () => {
    expect(read('')).toEqual({ force: false })
  })

  it('honours a single force flag', () => {
    expect(read('?force=1')).toEqual({ force: true })
  })

  it('honours a single cache flag', () => {
    expect(read('?cache=1')).toEqual({ cachedOnly: true })
  })

  it.each(['?unknown=1', '?cache=1&force=1', '?cache=2', '?force=1&force=2'])('refuses %s', (query) => {
    expect(() => read(query)).toThrow()
  })
})
