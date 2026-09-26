# Agent Note: Remove the Desktop production profile core-package cleanup

Status: implemented

English | [中文](2026-09-19-remove-desktop-profile-core-cleanup.zh.md)

## Problem

Since 2026-09-15, production Desktop cleaned the profile before starting the Host, using the package names listed by the runtime descriptor: it deleted same-named entries under `$DSH_HOME/profiles/desktop/node_modules`, pruned the manifest's dependency declarations and pnpm overrides for those names, discarded the lockfile when package state changed, and removed development-time links once according to `desktop-runtime-state.json`. It targeted two kinds of residue: earlier Desktop builds had installed the core packages into the profile as local tarballs through pnpm, writing declarations, overrides, and a lockfile; and the development mode of the link backend had projected the installation closure into the same profile's `node_modules`. Under nearest-wins resolution those copies shadowed the runtime bundled with the application, combining an old Web frontend with new plugins.

The core-package residue existed only on internal development and test machines, because no Desktop release installed core packages into a profile; since the runtime ships inside the application, new profiles no longer contain core packages either. The link residue is not confined to those machines: released Oristrat 0.1.5 builds projected their installation closure into the profiles of installed applications, and that half of the removed cleanup was restored as [the legacy profile link migration](../bug-fix/2026-09-25-desktop-legacy-profile-link-migration.md). The core-package cleanup had to rerun on every production launch and fought the next pnpm operation, which reinstalled packages from the retained declarations.

## Decision

Delete `apps/desktop/src/profile-core-cleanup.ts` and its spec. `DesktopProjectManager.applyRelease` validates the runtime descriptor, migrates profile settings, creates the profile files, and removes the projections earlier link-era releases wrote through the shared `removeLinkProjections` and the restored [legacy link migration](../bug-fix/2026-09-25-desktop-legacy-profile-link-migration.md); beyond that, launches modify neither the profile's `node_modules` nor its manifest, overrides, or lockfile.

Resolution inside the profile follows the [lookup-order Note](../architecture/2026-09-19-profile-resolution-lookup-order.md): packages in the profile's own `node_modules` win as the nearest layer, and installation package names are occupied by the generation at `$DSH_HOME/profiles/node_modules`. When a package installed into the profile declares `@deepseek-ai/*` packages under `dependencies`, pnpm installs copies into the profile and those copies run at their own versions. Official packages keep only pure-function packages under `dependencies` and declare every package with module-level identity as a peer; a third-party plugin that declares an identity-bearing dsh package as a real dependency makes that packaging choice for itself.

Capability given up: core-package copies and their declarations that earlier Desktop builds installed into a profile need one manual removal. Projections the link backend wrote are removed by the shared profile load, see the [lookup-order Note](../architecture/2026-09-19-profile-resolution-lookup-order.md), and the links `desktop-runtime-state.json` records by the [legacy link migration](../bug-fix/2026-09-25-desktop-legacy-profile-link-migration.md).

Reintroduction conditions: official packages change their dependency conventions so that profiles gain copies competing with the runtime for identity. The core-package condition, a released Desktop writing those copies into external users' profiles, has not occurred; the link condition occurred and is recorded in the successor Note.

## Alternatives considered

**Keep the original cleanup.** The residue it served is no longer produced, yet it deleted directories, pruned declarations, and discarded the lockfile on every production launch, fighting the following pnpm operations.

**Delete only same-named directories under the profile's `node_modules`, leaving declarations and the lockfile alone.** The 2026-09-15 decision already rejected this: pnpm reinstalls the same old packages from the retained declarations and overrides.

**Give `@deepseek-ai/*` generation entries absolute precedence over same-named copies inside the profile.** That overrides versions plugins bring along and is a new resolution-rule decision outside the scope of removing the cleanup.

**Clean only in the installer.** The 2026-09-15 decision already rejected this: it misses other profiles and cannot reach copies recreated after installation.

## Verification

- [project-manager.spec.ts](../../../../apps/desktop/tests/project-manager.spec.ts) asserts that after one launch preparation the installed core package directory, the third-party plugin directory, the manifest declarations, and the lockfile are byte-for-byte unchanged, and that a recorded link into a previous installation is removed without touching its target.
- The repository has no remaining references to `cleanProfileCorePackages` or `CLEAN_PROFILE_CORE_PACKAGES`; `migrateDesktopProfileLinks` and `DESKTOP_PROFILE_STATE` live in `apps/desktop/src/profile-packages.ts` and are owned by the successor Note.

## Consequences

Bought: production launches no longer write into the profile, there is no temporary enable switch, and Desktop and the CLI apply one rule to copies inside a profile. Paid: core-package copies earlier Desktop builds installed into a profile are removed by hand; dsh copies that third-party plugins bring into the profile as real dependencies run at their own versions.
