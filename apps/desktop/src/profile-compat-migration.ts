/** Upgrade the Desktop-owned Oristrat gateway route in existing profile patches. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMap, isSeq, parseDocument } from 'yaml'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/**
 * The Oristrat gateway rejects the OpenAI `developer` message role for its
 * reasoning models. Pi-ai uses that role by default when reasoning is on.
 * Keep an explicitly configured compatibility choice and update only the
 * Oristrat route in the Desktop profile.
 * @param profile - Desktop-owned profile directory.
 * @returns whether the patch was updated.
 */
export async function migrateOristratGatewayCompat(profile: string): Promise<boolean> {
  const filename = join(profile, 'cordis.patch.yml')
  let source: string
  try {
    source = await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  const document = parseDocument(source, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
  })
  const error = document.errors[0]
  if (error !== undefined) throw error
  if (!isSeq(document.contents)) return false
  let changed = false
  for (const [index, row] of document.contents.items.entries()) {
    if (!isMap(row) || document.getIn([index, 'id']) !== 'llm-pi-ai') continue
    const route = [index, 'config', 'providers', 'oristrat-official']
    if (!isMap(document.getIn(route, true))) continue
    const compat = [...route, 'compat']
    if (document.hasIn([...compat, 'supportsDeveloperRole'])) continue
    if (document.hasIn(compat) && !isMap(document.getIn(compat, true))) continue
    document.setIn([...compat, 'supportsDeveloperRole'], false)
    changed = true
  }
  if (!changed) return false
  await writeFileAtomic(filename, String(document), { mode: 0o600 })
  return true
}
