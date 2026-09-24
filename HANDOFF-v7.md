# Oristrat AI Stem v7 handoff — repo-environment menu polish (icon, tooltip, sources)

Release artifact: `apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/` (`Oristrat AI Stem.app` under `mac-arm64/`, plus zip/dmg) — zip SHA256 `eb3a3b255431840c2034af9ab46b2588b1b3e3e0b4944ed24a065308ea1393d6` (240,890,601 bytes), built 2026-09-24 from the polish working tree over the then-current fork baseline. Installed over `/Applications/Oristrat AI Stem.app` via `ditto`. On-device evidence in `.artifacts/`: `v7-trigger-tooltip.png` (hover bubble under the header trigger), `v7-sources.png` (per-remote rows with full URLs), `v7-popover.png` (settled popover).

## What shipped (round 4 — product-owner polish on the round-3 menu)

1. **Codex-style trigger icon.** The header trigger now draws the environment mark — two hollow nodes with their bars, the shape the neighboring clients use for repository details — instead of the branch curve; the branch row inside the popover keeps the branch mark, so the two roles stay distinguishable. `glyphs.tsx` exports `EnvGlyph` (trigger) beside `RepoGlyph` (branch row). Verified on device: `2 nodes, 2 bars`.
2. **Hover/focus tooltip.** The trigger is wrapped in the shared `Tooltip` primitive (`side="bottom"`, immediate on focus) with the new locale key `action.tooltip` (仓库环境与分支 / Repository environment and branches); the accessible name stays 仓库环境 so existing aria goldens and the e2e header assertions are unchanged. Verified on device: bubble text read back exactly, absent before hover.
3. **Complete sources row.** The single joined `name · name · …` cell that ellipsized long remotes is replaced by one row per remote carrying its name and its **full URL**, wrapping instead of truncating (`overflow-wrap: anywhere`), with the no-remotes note unchanged. Verified on device against the real the oai-agent workspace: 4 remotes rendered (`gitee`, `origin`, `vtrace-readonly` ×2 including the `DISABLED_DO_NOT_PUSH_VTRACE` target), every URL `clipped: false` — the entries that the previous design hid behind `…` are now readable.

## Verification performed

- `npx vitest run packages/client/ui-repo-panel`: 33/33 green (new cases: per-remote list content, trigger mark shape, tooltip show/hide on focus and hover). Neighbouring suites (ui-browser-panel + gui-repo + browser-view) 58/58 green. `npx tsc -b packages/client/ui-repo-panel` clean; scoped oxlint 0 errors; per-file coverage 100% on ui-repo-panel (no uncovered lines).
- `pnpm run test:gui`: 89 reds at exact baseline parity (unchanged). `verify-client-ui-i18n`: zero findings in `ui-repo-panel` — the reds remain the pre-existing `startup.js`/`OristratBrand.tsx` drift.
- `DSH_SNAPSHOT=replay pnpm run test:web` with a real **clean-HEAD baseline worktree** (own `pnpm install --frozen-lockfile`, own build): baseline 52 files / 102 tests red vs this tree 52 files / 100 tests red, and the extracted failing-file lists are byte-identical (51 entries each, `diff` empty). The polish adds no failure and repairs nothing outside its surface; the two-test delta sits inside the recorded load-sensitive files.
- Documentation gates: `verify-translation-pairing` (819 pairs), `verify-package-readme-summaries` (326), `verify-package-readme-model-experience` (275), `verify-agent-note-format` (347) all green after the README pair and the round-3 note were updated in place and re-recorded.
- Device verification on the packaged app (fresh CDP instance): the three items above, with the exact console lines recorded in the transcript (`PASS icon: environment mark (2 nodes, 2 bars)`, `PASS tooltip: "仓库环境与分支"`, `PASS sources: 4 remote(s) with full name + url, none clipped`).

## Notes for the next round

- The address input's placeholder becomes the current URL once state exists; locate it by `aria-label="输入网址，回车打开"`, not by placeholder text.
- The right-sidebar corner toggle's label is 打开右侧边栏 / 收起右侧边栏 (边栏, not 栏), and the mounted pane can appear twice (an off-screen dock pane); the active one is first in DOM order.
- The workspace the desktop app had open during verification reports its own uncommitted work (+233 -285 · 9 files on `merge/oaiagent-into-fde`); the verification only read it — no branch was switched this round.
