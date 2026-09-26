# Agent Note: The installed product owns its Harness home and provider set

Status: implemented

English | [中文](2026-09-25-installed-product-owns-its-harness-home.zh.md)

## Problem

The packaged app adopted whatever `DSH_HOME` its launcher carried: `main()` set `~/.oristrat` only while the variable was unset. Any launch from a shell inside another Harness installation — the DSH Desktop app, a support terminal, a script that exports the variable for the CLI — therefore booted this product on the *other* installation's home. That home carries `profiles/desktop/node_modules`, whose links pointed into `/Applications/DSH Desktop.app`, so the Host resolved this product's plugins from a different build: the typert parameter codecs failed zod validation, six plugins stayed pending on `sessionPersistence` and `workspaceRegistry`, and startup aborted with "1 required plugin did not activate" behind the crash dialog. The same home also carried the other installation's `settings.yaml`, so the Models page listed its hand-declared providers (`oristrat`) beside the shipped ones and its default model selected a route this product does not ship. Two installations were configuring one another. The [legacy-link migration](2026-09-25-desktop-legacy-profile-link-migration.md) covers the same failing signature from links a profile recorded itself; this note covers the links it never owned.

## Decision

The packaged app assigns `process.env.DSH_HOME = resolveProductHome()` on every launch, replacing an inherited value instead of deferring to it, and `resolveProductHome()` returns `~/.oristrat` unless `ORISTRAT_HOME` names a different home. An unpackaged launch keeps the ambient home, because `dev:desktop` runs against a disposable profile in the checkout. The Models page adds the matching boundary on its own surface: Host configuration `providerEditing` (default `true`) rides the existing bootstrap payload, and the Client turns it off whenever the Electron preload marker is present, so the desktop product lists the provider it ships — readable, key-editable, and unremovable — with no add-provider entry at all. Both changes make the product own its environment rather than inherit one.

## Alternatives considered

**Keep the `=== undefined` guard and repair the profile instead.** The [legacy-link migration](2026-09-25-desktop-legacy-profile-link-migration.md) removes only the links a profile recorded in its own state file; foreign links belong to whichever installation wrote them, so the next DSH launch restores the condition.

**Separate the two products by profile name.** The profile parent `node_modules` and the plugin resolution scope are shared by every profile under one home, so a distinct profile name still reads the other product's links.

**Detect the foreign home and warn.** A warning leaves the user with an app that cannot start and no way to fix it.

**Gate the whole Models section away.** The page is also the diagnostic surface for a missing key, so hiding it would leave a first-run user with no explanation; only the add and remove affordances belong to the deployment.

**Hardcode the desktop shell check in the components.** A validated Host option plus the preload marker keeps the choice configurable from a profile patch and testable without a browser.

## Consequences

Any launch of the installed app — from Finder, a terminal, or a DSH session — uses `~/.oristrat`, and the DSH installation keeps its own home untouched. Support and tests point the app at another home with `ORISTRAT_HOME`. On the desktop the Models page cannot add a provider or remove the shipped one; the Web build and `dsh web` keep full provider editing, and a deployment that wants the add flow back sets `providerEditing` in its profile patch.

## Testing

`apps/desktop/tests/main-startup.spec.ts` pins that a packaged launch replaces an inherited `DSH_HOME` with the product home, that an unpackaged launch keeps the ambient one, and that `ORISTRAT_HOME` wins; its `paths.ts` module mock now spreads the real module so the helper stays exercised. `packages/client/ui-settings-models/tests/apply.client.spec.ts` pins the published bootstrap payload, the schema default, the rejection of a non-boolean, and that the desktop marker turns provider editing off; `tests/components.client.spec.tsx` pins the locked page — the shipped row stays visible and editable while the add and remove controls are absent.