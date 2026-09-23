# Agent Note: Oristrat round 3 — header repository environment menu, browser view reuse, and toolbar cleanup

Status: implemented

English | [中文](2026-09-23-oristrat-header-repo-menu-browser-view-reuse.zh.md)

> Scope: (1) the `ui-repo-panel` move from the right-sidebar tab to a Codex-style Session-header utilities menu with a branch-switching submenu, plus the `gui-repo` branch verbs that back it; (2) the embedded browser's hide-not-destroy lifecycle in `apps/desktop` and `ui-browser-panel` so browsing state survives tab switches; (3) the browser toolbar cleanup that removes the invisible submit button and lands the view at settled layout bounds. Supersedes in part the [round-2 note](2026-09-22-oristrat-thinking-slider-websearch-mcp-repo-browser-panels.md), which records the original sidebar-tab placement and close-on-unmount lifecycle.

## Problem

Three product-visible defects and requests arrived together after round 2 shipped:

- The control right of the browser address bar painted black-on-black: the `.go` submit button's brand background and label tokens resolved to the same dark color, and a gray square appeared over the dock because the `WebContentsView` kept stale bounds measured mid-animation (`getBoundingClientRect` during the pane's open transform, with no observer firing after it settles).
- Switching away from the browser tab destroyed the view, so the document, cookies, and history were lost on every tab switch; the product owner asked that the page persist like a background browser tab.
- The repository environment lived as a right-sidebar tab and was strictly read-only; the product owner asked for Codex parity: a glyph button beside the Session header's "⋯" menu opening a dropdown with the environment facts and a branch list that can search, switch, and create branches.

## Decision

### gui-repo branch verbs

- `gui-repo` gains three verbs beside `status`: `branches` (concurrent `for-each-ref refs/heads` + `rev-parse --abbrev-ref HEAD` after the same toplevel probe), `checkout` (`git switch -- <branch>`), and `createBranch` (exported `isValidBranchName` guard, then `git switch --create <name>`). Both mutations share one private `mutate` helper answering `{ ok }` or `{ ok: false, error }` with git's trimmed stderr, stdout fallback, then a `git <verb> failed` default; `runGit` now collects stderr. Committing and pushing remain absent by product decision.

### Header environment menu

- `ui-repo-panel` deletes its sidebar tab registration (`definition.tsx`, `RepoTabBody.tsx`, `RepoTitle.tsx`, `RepoPanel.tsx`) and registers one `conversation.session.header.utilities` entry (id `repo-env`, order 0) rendering `RepoEnvAction`: a currentColor branch-glyph trigger, a portaled popover positioned by `useAnchoredPosition` and dismissed by `useDismissOnOutsidePointer` plus Escape, environment rows (change totals, host, branch with divergence, sources), and a branch submenu with a substring search filter, `menuitemradio` rows checking the current branch, checkout on pick, and an inline create-and-checkout draft form. Status polls every 4s while open; branches poll only while the submenu is open. Mutations are guarded against double-fire and close the popover on success or show git's refusal inside the submenu.

### Browser view reuse

- `browser-view.ts` keeps one `WebContentsView` per application window for the window's lifetime: `hide()` detaches via `removeChildView` behind an `attached` flag without destroying the view, `open()` idempotently re-attaches the same instance (no reload), and `attach` sets a `#ffffff` background so an unpainted view never shows as a dark rectangle. The renderer face renames `close` to `hide` (IPC channel `dsh-desktop:browser-hide`); `close` survives only for window teardown.
- `ui-browser-panel` removes the `.go` button (the address form navigates on Enter alone, as its placeholder already stated) and measures bounds through the new `boundsFromLayout` offset-chain walk, which is final while ancestor transform animations run; mount pushes immediately plus a 300ms settle push beside the existing ResizeObserver/scroll/resize pushers, and unmount hides instead of closing.

## Alternatives considered

- Fixing the `.go` button's tokens instead of removing it: Enter already submitted the form, so the button was a duplicate affordance whose only shipped behavior was painting black-on-black.
- Detaching the view by hiding a DOM element: a `WebContentsView` is a native child of the window, not of the DOM; only `removeChildView` stops it painting over the app.
- Restoring browsing state by reloading the last URL on reopen: loses form input, scroll position, in-page history, and any uncommitted page state; keeping the view alive costs one idle renderer per window instead.
- `git checkout <branch>` for switching: the pathspec ambiguity forces `--`, and `checkout -b -- <name>` treats the name as a start-point reference; `git switch` is unambiguous for both verbs and has shipped since git 2.23.
- Keeping the environment surface as a sidebar tab and adding branches there: the product owner explicitly requested the Codex-style header seat and dropdown; the sidebar tab type, guide entry, and keyed seats were deleted rather than left dormant.

## Consequences

- Per-file 100% coverage holds for all three packages; genuinely unreachable defensive arms (post-unmount read settlements guarded by disabled buttons, the submenu offset fallback, `for-each-ref` failure behind a working toplevel probe) carry reasoned `v8 ignore` comments, and the post-unmount and fallback arms that are reachable are asserted by specs.
- Browsing state now survives every tab switch and dies only with the application window; one idle `WebContentsView` per window is the accepted memory cost.
- Branch switching is the GUI's only repository mutation; commit/push parity stays with the agent's bash tool by product decision.
- The header menu registers wherever the `guiRepo` Remote namespace exists, so the web host gains it too; the browser pane stays desktop-only.
