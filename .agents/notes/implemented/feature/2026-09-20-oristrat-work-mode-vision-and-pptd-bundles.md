# Agent Note: Oristrat work mode, per-model vision declaration, and vendored PPTD bundles

Status: implemented

English | [中文](2026-09-20-oristrat-work-mode-vision-and-pptd-bundles.zh.md)

## Problem

The fork deployment enforced the MSCE engine-development discipline on every session, including free-form proposal, document, and slide work that the discipline does not describe. Model rows on the Models settings page carried no image-input declaration, so a vision-capable endpoint could only be enabled by hand-editing `settings.yaml`, and a text-only model accepted image attachments up to the pi-ai adapter's request-time refusal. The deployment also had no template-based PPTX composition, while the reference dsh-desktop generation ships one as two patch-layer bundles.

## Decision

One deployment-wide work mode lives in the `oristrat` settings namespace (`mode: coding | work`, default `coding`), registered by `dsh-context-oristrat-msce-norms`; without a settings service both consumers fail closed to coding. In work mode the norms system-prompt section contributes empty text and the `msce-gate` guard passes every `tools/execute` dispatch through unexamined. Sessions are never filtered by mode.

The ui-sidebar hangs a Codex-style mode chip on its own row below the brand row (one row would squeeze the chip against the wordmark in narrow columns): it derives the namespace from the settings domain's shared describe mirror through `ctx.settingsScope.bind` — no wire read of its own and no direct `settings.describe` caller added against the cold-boot RPC budget — moves only on committed writes, and is omitted on the collapsed rail.

`ui-settings-models` gains a shared per-row image-input toggle (`ModelImageInputToggle`) in both catalog editors, writing the adapter-owned modality list explicitly: `input: ['text', 'image']` or `['text']` for a pi-ai route, `inputModalities` for the DeepSeek catalog. Enforcement stays where it already was: the pi-ai adapter refuses image content for a model whose resolved `input` lacks `image`, and endpoint-declared capacities flow through catalog resolution without the toggle.

`ui-conversation` declares two session-scoped list seats mirroring the reference assembly: `conversation.hero.modeActions` (the hero mode cluster, rendered only when the session zone exists and the stored deployment mode is Work) and `conversation.input.accessory` (the composer accessory seat; an owner-passed `accessory` prop wins over the slot, and the extension seat — like `conversation.composer.dock` — renders only in Work mode, read through a boolean snapshot over the same `oristrat` settings scope). An unoccupied accessory seat is layout-neutral: its wrapper hides while the slot container is empty, so committed card-geometry goldens hold until an occupant registers.

The PPTD route ships as the two vendored reference-generation bundles (`dsh-ppt` and `dsh-ppt-composer` 0.1.1-rc.2 tarballs under `apps/desktop/vendor/ppt`). The composer joins `DESKTOP_PROFILE_BUNDLES` as a built-in prefix entry rather than a profile plugin and applies `dsh-ppt` itself with the intersected config — a separate `dsh-ppt` patch entry would register its skill provider twice; root `pnpm-workspace.yaml` overrides pin every resolution — including the composer's own dependency — to the tarballs; `prepare-package-set` roots the closure at them and reads the vendor directory as a packed input; and `migrateProfileBundles` rewrites a legacy two-bundle profile manifest (and an alpha manifest that mounted `dsh-ppt` itself) to the current three-entry prefix in `applyRelease`, preserving plugin order and leaving an unknown prefix for `profilePluginNames` to reject loudly.

## Alternatives considered

**Install the PPTD bundles as profile-local plugins.** `validateDesktopPluginGraph` rejects shared-linked active plugins and symlinked package containers, and the bundles' third-party closure resolves inside the runtime tree; the built-in prefix rides the existing shared-package links instead.

**Adopt the registry `dsh-ppt` line (0.4.x).** It targets a newer host generation than this fork's 0.1.5-rc.2 package set; the reference desktop's own 0.1.1-rc.2 bundles match the generation exactly.

**Gate the composer's image attachment client-side on the resolved model's modalities.** No reactive channel carries per-model modality facts to InputBar today; building one crosses domains for a convenience gate, while the adapter's refusal already surfaces to the user at send time.

**Scope sessions or the switcher per session.** The mode is a deployment posture stored in one settings document; per-session scoping would fork the norms/gate reads and contradict the shared-session requirement.

## Consequences

`plugins-disable-all` now resets to the four built-ins, so the fork bundles are no longer user-disableable from the plugin surface. The mode is deployment-wide: every open session sees the switch immediately through the live settings scope. The PPT composer chip, its hero cluster, and the composer dock chooser are Work-mode-only surfaces — the deployment default is coding, so the feature starts hidden — while sessions themselves stay shared across modes. An existing profile from the two-bundle generation is healed on first launch of the new release, before the profile state is read.

## Testing

`packages/context/oristrat-msce-norms/tests/mode.spec.ts` pins the fail-closed default, the coding/work section text, and the live switch both directions; `packages/guard/msce-gate/tests/mode.spec.ts` pins the dispatch-level pass-through in work mode and unchanged coding enforcement. The ui-sidebar apply spec drives the scope double (a seeded committed section, the write gated on the commit fold, a failed write leaving the last committed mode, malformed and missing sections failing closed, and listener disposal) and the shell specs pin the chip menu behavior and the rail omission. The input-bar spec pins the accessory seat dispatch against the extension zone in Work mode, the prop precedence, and the extension seats staying unmounted outside Work mode; the skeleton spec pins the hero mode-cluster dispatch and its Work-mode gating. `apps/desktop/tests/project-manager.spec.ts` pins the manifest migration and its idempotence, loud-failure prefix, and end-to-end heal through `applyRelease`; `prepare-package-set.spec.ts` pins the fork-bundle closure roots.
