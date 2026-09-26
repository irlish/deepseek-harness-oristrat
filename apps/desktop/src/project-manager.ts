/** Desktop profile initialization and native recovery. */

import {
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  closeSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import {
  DESKTOP_HOST_PACKAGE,
  desktopCorePackageOverrides,
  verifyDesktopCorePackageSet,
} from './core-package-set.ts'
import type { DesktopPaths } from './paths.ts'
import type { DesktopRelease } from './release.ts'
import { readDesktopRuntime } from './runtime-tree.ts'
import { migrateOristratGatewayCompat } from './profile-compat-migration.ts'
import { migrateDesktopProfileLinks } from './profile-packages.ts'
import { migrateOristratThinkingLevels } from './settings-thinking-migration.ts'
import {
  initProfile, PROFILE_TEMPLATES, removeLinkProjections, sanitizeProfile, type ProfileTemplate,
} from '@deepseek-ai/dsh-app-boot'

const PROJECT_NAME = '@deepseek-ai/dsh-desktop-runtime'
const DSH_PACKAGE = '@deepseek-ai/dsh'
const CORE_BUILD_PACKAGE = '@deepseek-ai/dsh-subprocess-local'
const WEB_PROFILE = PROFILE_TEMPLATES.web as ProfileTemplate
/**
 * Unscoped bundles this release mounts from the runtime tree. Their patch layers
 * name them as bare specifiers, so the profile carries a link to the runtime copy
 * instead of a pnpm-installed dependency.
 */
const RUNTIME_LINKED_BUNDLES = ['dsh-ppt', 'dsh-ppt-composer'] as const
/** Built-in bundle prefix of profiles created before the fork PPTD bundles joined the release. */
const LEGACY_PROFILE_BUNDLES: readonly string[] = WEB_PROFILE.bundles
// Fork: the vendored DSH PPTD bundles ship in the core package set and link from
// the runtime tree like the other built-ins, so the composer joins the built-in
// prefix instead of the installable plugin list. The composer applies the
// dsh-ppt plugin itself with its intersected config, so dsh-ppt must not appear
// as its own patch-layer entry (a second entry double-registers its provider).
const DESKTOP_PROFILE_BUNDLES: readonly string[] = [...LEGACY_PROFILE_BUNDLES, 'dsh-ppt-composer']
/** Route plugins an earlier release mounted as their own patch-layer entry; the composer applies dsh-ppt itself. */
const RETIRED_PROFILE_BUNDLES: readonly string[] = ['dsh-ppt']
const WORKSPACE_SETTINGS = 'nodeLinker: hoisted\nautoInstallPeers: false\n'
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 })
}

function workspaceFile(overrides: Readonly<Record<string, string>> = {}): string {
  const entries = Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right))
  const overrideSection = entries.length === 0
    ? ''
    : `overrides:\n${entries.map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`).join('\n')}\n`
  if (entries.length === 0) return `packages:\n  - .\n\n${WORKSPACE_SETTINGS}`
  const coreBuildSpec = overrides[CORE_BUILD_PACKAGE]
  const coreBuildKey = coreBuildSpec === undefined
    ? CORE_BUILD_PACKAGE
    : `${CORE_BUILD_PACKAGE}@${coreBuildSpec.replace('file:./', 'file:')}`
  return `packages:\n  - .\n\n${overrideSection}${WORKSPACE_SETTINGS}allowBuilds:\n  node-pty: true\n  koffi: true\n  fs-ext: true\n  ${JSON.stringify(coreBuildKey)}: true\n  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n`
}

function migrateProfileSettings(projectDir: string): void {
  const path = join(projectDir, 'pnpm-workspace.yaml')
  if (!existsSync(path)) return
  const legacy = `packages:\n  - .\n\n${WORKSPACE_SETTINGS}strictDepBuilds: true\nallowBuilds:\n  node-pty: true\n  koffi: true\n  fs-ext: true\n  "${CORE_BUILD_PACKAGE}": true\n  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n`
  if (readFileSync(path, 'utf8').replaceAll('\r\n', '\n') === legacy) {
    writeFileSync(path, workspaceFile())
  }
}

/** Profile manifest fields this module reads and rewrites. */
interface ProfileBundlesManifest {
  readonly dsh?: { readonly profile?: { readonly bundles?: readonly string[] } }
  readonly [key: string]: unknown
}

/**
 * Rewrite a profile manifest whose bundle list still begins with the legacy
 * prefix so it begins with the current built-in prefix, preserving the order of
 * remaining entries. Manifests with an unknown prefix are left for plugin
 * validation to reject loudly.
 * @param projectDir - Desktop profile directory holding `package.json`.
 * @returns True when the manifest was rewritten.
 */
export function migrateProfileBundles(projectDir: string): boolean {
  const path = join(projectDir, 'package.json')
  if (!existsSync(path)) return false
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as ProfileBundlesManifest
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (DESKTOP_PROFILE_BUNDLES.every((bundle, index) => bundles[index] === bundle)) return false
  if (!LEGACY_PROFILE_BUNDLES.every((bundle, index) => bundles[index] === bundle)) return false
  const plugins = bundles.slice(LEGACY_PROFILE_BUNDLES.length)
    .filter(plugin => !DESKTOP_PROFILE_BUNDLES.includes(plugin) && !RETIRED_PROFILE_BUNDLES.includes(plugin))
  writeJson(path, {
    ...manifest,
    dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...DESKTOP_PROFILE_BUNDLES, ...plugins] } },
  })
  return true
}

/**
 * Link the runtime copies of the prefix bundles whose patch layers name them as
 * bare specifiers. The dependency traversal that resolves the scoped runtime
 * packages for a profile cannot reach these unscoped bundles, so the profile
 * carries a link to the copy its own runtime descriptor declares.
 * @param projectDir - Desktop profile directory receiving the links.
 * @param runtimeDir - Runtime tree owning the bundle packages.
 */
export function linkRuntimeBundles(projectDir: string, runtimeDir: string): void {
  const declared = new Map(readDesktopRuntime(runtimeDir).sharedPackages.map(entry => [entry.name, entry.path]))
  const modules = join(projectDir, 'node_modules')
  for (const name of RUNTIME_LINKED_BUNDLES) {
    const path = declared.get(name)
    // A runtime without the vendored bundles composes its profiles without them.
    if (path === undefined) continue
    const target = runtimePackageDirectory(runtimeDir, path)
    const link = join(modules, name)
    const entry = lstatSync(link, { throwIfNoEntry: false })
    if (entry === undefined) {
      mkdirSync(modules, { recursive: true, mode: 0o700 })
      symlinkSync(target, link, 'dir')
      continue
    }
    // An installed package and a link another installation owns both win over this link.
    if (!entry.isSymbolicLink() || !linksToCopy(link, name)) continue
    if (resolve(dirname(link), readlinkSync(link)) !== resolve(target)) {
      unlinkSync(link)
      symlinkSync(target, link, 'dir')
    }
  }
}

/**
 * Directory a declared runtime package is read from. Electron serves the archive
 * through its own filesystem layer while the operating system reports it as one
 * file, so a link that resolves to a directory on disk wins when a package also
 * ships unpacked.
 * @param runtimeDir - Runtime tree owning the package.
 * @param path - Package path relative to that tree.
 * @returns Absolute package directory.
 */
function runtimePackageDirectory(runtimeDir: string, path: string): string {
  const unpacked = join(runtimeDir.replace(/([\/])app\.asar(?=[\/]|$)/u, '$1app.asar.unpacked'), path)
  return existsSync(unpacked) ? unpacked : join(runtimeDir, path)
}

/** Whether a profile link points at some tree's copy of the same package, rather than an installer's own target. */
function linksToCopy(link: string, name: string): boolean {
  const resolved = resolve(dirname(link), readlinkSync(link))
  return basename(resolved) === name && basename(dirname(resolved)) === 'node_modules'
}

/** Initializes the Desktop profile and disables third-party bundles during recovery. */
export class DesktopProjectManager {
  /**
   * @param paths - Electron-owned package state and reserved desktop profile paths.
   * @param runtime - location of the bundled application runtime.
   */
  constructor(
    readonly paths: DesktopPaths,
    readonly runtime: { readonly dsh: string },
  ) {}

  /**
   * Back up the profile patch and disable third-party bundles without loading application resources.
   * The caller must stop the Host first.
   * @returns Backup path after the locked profile write, or undefined if the patch was absent.
   */
  async disableAllPlugins(): Promise<string | undefined> {
    return this.withLock(() => sanitizeProfile('dsh', this.paths.profile, DESKTOP_PROFILE_BUNDLES))
  }

  /**
   * Load application metadata and prepare the external plugin profile without installing packages.
   * Releases before 0.1.7 linked bundle-carried packages into the profile, where they shadow the
   * runtime bundled with the application; both link-era migrations run before the Host starts.
   */
  async applyRelease(): Promise<void> {
    await this.withLock(async () => {
      // Validation only: an unreadable or mismatched runtime descriptor stops preparation before the Host starts.
      readDesktopRuntime(this.runtime.dsh)
      migrateProfileSettings(this.paths.profile)
      migrateProfileBundles(this.paths.profile)
      createPluginProfile(this.paths.profile)
      linkRuntimeBundles(this.paths.profile, this.runtime.dsh)
      await migrateOristratThinkingLevels(this.paths.home)
      await migrateOristratGatewayCompat(this.paths.profile)
      migrateDesktopProfileLinks(this.paths.profile)
      removeLinkProjections(this.paths.profile)
    })
  }

  private async withLock<T>(operation: () => T | Promise<T>): Promise<T> {
    mkdirSync(this.paths.profile, { recursive: true, mode: 0o700 })
    const lockPath = join(realpathSync(this.paths.profile), 'lock')
    let descriptor: number
    try {
      descriptor = openSync(lockPath, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const lock = lstatSync(lockPath)
        if (lock.isSymbolicLink() || !lock.isFile()) {
          throw new Error('desktop project: profile lock is not a regular file')
        }
        const owner = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10)
        let active = !Number.isSafeInteger(owner) || owner <= 0
        if (!active) {
          try {
            process.kill(owner, 0)
            active = true
          } catch (signalError) {
            active = (signalError as NodeJS.ErrnoException).code !== 'ESRCH'
          }
        }
        if (active) throw new Error('desktop project: another profile operation is active')
        unlinkSync(lockPath)
        descriptor = openSync(lockPath, 'wx', 0o600)
      } else {
        throw error
      }
    }
    try {
      writeSync(descriptor, `${String(process.pid)}\n`)
      fsyncSync(descriptor)
      return await operation()
    } finally {
      closeSync(descriptor)
      unlinkSync(lockPath)
    }
  }
}

/** Create build-only project metadata for materializing the signed runtime. */
export function createRuntimeProjectMetadata(projectDir: string, release: DesktopRelease): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const packageSet = verifyDesktopCorePackageSet(projectDir, release.version)
  const manifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: desktopCorePackageOverrides(packageSet),
    dsh: { profile: { bundles: [...DESKTOP_PROFILE_BUNDLES] } },
  }
  writeJson(join(projectDir, 'package.json'), manifest)
  writeFileSync(
    join(projectDir, 'pnpm-workspace.yaml'),
    workspaceFile(desktopCorePackageOverrides(packageSet)),
    { mode: 0o600 },
  )
}

/**
 * Create metadata for the unpackaged development project that links the current workspace.
 * @param projectDir - Disposable development profile directory.
 * @param release - Release identity shared by the linked CLI package and Electron shell.
 */
export function createDevelopmentProjectMetadata(projectDir: string, release: DesktopRelease): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const manifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: {
      [DSH_PACKAGE]: release.version,
      [DESKTOP_HOST_PACKAGE]: release.version,
    },
    dsh: { profile: { bundles: [...DESKTOP_PROFILE_BUNDLES] } },
  }
  writeJson(join(projectDir, 'package.json'), manifest)
  writeFileSync(join(projectDir, 'pnpm-workspace.yaml'), workspaceFile(), { mode: 0o600 })
}

/** Create the first external plugin profile without running a package manager. */
export function createPluginProfile(projectDir: string): void {
  initProfile(projectDir, DESKTOP_PROFILE_BUNDLES)
}
