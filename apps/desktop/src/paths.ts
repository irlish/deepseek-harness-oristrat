/** Filesystem ownership for the Electron-managed desktop installation. */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Harness home directory owned by this packaged product. */
export const PRODUCT_HOME_DIR_NAME = '.oristrat'

/** Environment variable carrying an explicit product-home override. */
export const PRODUCT_HOME_ENV = 'ORISTRAT_HOME'

/**
 * Resolve the Harness home the packaged application owns.
 *
 * `DSH_HOME` names the home of whichever Harness installation started this process, so an installed
 * application never adopts it: that home carries the other installation's profile links, provider
 * settings, and sessions, none of which belong to this product.
 * @param environment - environment holding the optional product-home override.
 * @returns absolute Harness home for this product.
 */
export function resolveProductHome(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment[PRODUCT_HOME_ENV]
  return configured === undefined || configured === '' ? join(homedir(), PRODUCT_HOME_DIR_NAME) : configured
}

/** Stable desktop installation paths under the shared Harness home. */
export interface DesktopPaths {
  readonly home: string
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve every Electron-owned path without changing the shared data roots.
 * @param dshHome - Harness home shared with npm-installed dsh.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(dshHome: string = resolveDshHome()): DesktopPaths {
  return {
    home: dshHome,
    profile: join(dshHome, 'profiles', 'desktop'),
    lock: join(dshHome, 'profiles', 'desktop', 'lock'),
  }
}
