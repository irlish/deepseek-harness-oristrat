# Agent Note: Migrate the Desktop profile links an earlier Oristrat release projected

Status: implemented

English | [中文](2026-09-25-desktop-legacy-profile-link-migration.zh.md)

## Problem

Desktop releases up to 0.1.5 used a link backend: the shell projected the installation's package closure into its own profile as symlinks under `$DSH_HOME/profiles/desktop/node_modules` and recorded each link in `desktop-runtime-state.json`. Resolution reads the profile's own `node_modules` before the runtime resolution, so those links outrank the runtime bundled with the application: a later release launched over such a profile loaded the previous release's plugins against its own `cordis` and `dsh`.

Installing Oristrat AI Stem 0.1.7-rc.2 over an installed 0.1.5 build therefore failed before the Host started, with `settings: TypeError: this.load is not a function`, `session-persistence-jsonl: format catalog v3 does not match Session v4`, `ctx.sessions.registerMessageProjection is not a function`, and typert contributors failing for want of a zod v4 schema. The native recovery dialog reported "the application could not start or stopped unexpectedly" and advised reinstalling, which reproduced the failure. The [link-cleanup removal](../simplification/2026-09-19-remove-desktop-profile-core-cleanup.md) deleted the migration that handled this state, on the premise that link-era residue existed only on internal machines; released 0.1.5 Desktop builds wrote it into external users' profiles, which is the removal note's own reintroduction condition.

## Decision

`DesktopProjectManager.applyRelease` runs `migrateDesktopProfileLinks` on every launch, under the profile lock and before the Host starts, next to the shared `removeLinkProjections` that already handles `.dsh-module-fallback`. The migration reads `desktop-runtime-state.json`, unlinks each recorded link under the profile's `node_modules` whose current target equals its recorded target, and deletes the state file.

Only links the record claims are unlinked. A pnpm-installed directory, a link whose target changed, a link beneath a redirected package directory, and an unrecorded link all survive. A record that lists an invalid package name or a relative target throws before any link is removed, so preparation stops loudly instead of deleting the wrong entry. After the one launch that consumes the record, later launches find no state file and change nothing.

A profile can also carry links written by a *different* installation that shares the same home. That state is outside this record's reach and is handled by the home ownership rule in [the installed product's own Harness home](2026-09-25-installed-product-owns-its-harness-home.md).

## Alternatives considered

**Remove every symlink under the profile's `node_modules` that resolves outside the profile.** Wider than the recorded ownership, and it would delete a user's own `link:` package dependencies, which are legitimate profile content.

**Clean only in the installer.** Installation cannot reach a profile that another home or another user owns, and it cannot repair residue recreated after installation.

**Leave the residue and let users clear it by hand.** The released upgrade path stays broken, and the recovery dialog offers no repair that reaches the profile.

## Consequences

Bought: an installed 0.1.7 release starts over a profile an earlier release prepared, including when the previous application was moved or deleted. Paid: the profile keeps a migration step for a state no current release writes, and the shared `.dsh-module-fallback` cleanup plus this one both live in launch preparation. Core-package copies that earlier Desktop builds installed into a profile as real directories are still removed by hand; this Note restores only the link half of the dropped cleanup.

## Testing

[profile-packages.spec.ts](../../../../apps/desktop/tests/profile-packages.spec.ts) covers recorded-link removal, a broken target, a pnpm-installed directory replacing a recorded link, changed and unrecorded links, an uninitialized profile, escaping package names, and links beneath redirected package directories. [project-manager.spec.ts](../../../../apps/desktop/tests/project-manager.spec.ts) pins that a launch over a profile holding a recorded link into a previous installation removes the link without touching its target, while installed packages, declarations, and the lockfile survive.