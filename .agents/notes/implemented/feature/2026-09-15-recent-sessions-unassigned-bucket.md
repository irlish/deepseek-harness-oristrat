# Agent Note: Recent Sessions unassigned bucket

Status: implemented

English | [中文](2026-09-15-recent-sessions-unassigned-bucket.zh.md)

## Problem

The web GUI had no path to a session without a Workspace. New Session always resolved a Workspace target — explicit, current-session, or most recent — and when no Workspace existed at all, `startSession()` dead-ended by clearing the selection and leaving the session-less view with no visible way forward. The Ungrouped bucket existed only as a trailing catch-all rendered when a stray Session already surfaced, so a workspace-less Session had no standing home in the sidebar and the zero-Workspace instance looked broken rather than empty. The Host already supports the case: `SessionCommandController.create` falls back from the Workspace path to an explicit `cwd` to its `defaultCwd`, and the Client `sessions.create()` accepts no options.

## Decision

`UiWorkspaceService` gained `connectUnassigned()`: it reuses the first blank, unarchived Session that belongs to no Workspace, and otherwise calls `sessions.create()` with no options so the Host lands the Session on its `defaultCwd`; concurrent starts coalesce on one in-flight promise. `startSession()` without a resolvable Workspace target opens that bucket through `openUnassigned()`, which obeys the same navigation-supersession guard as `openWorkspace`. Cold start with no Workspace keeps the session-less hero — whose composer is already live — so an unassigned Session is created only on explicit intent. `deriveGroups` now always renders the Ungrouped bucket first, even while empty. In the browser, the bucket is expanded by default unless the persisted `groupExpansion` holds its own key, its ＋ calls `startSession()` (previously inert), its expanded empty state shows the `empty.unassigned` copy, and the workspace list-start drop boundary anchors on the first workspace group rather than the leading bucket. Locale copy names the bucket **Recent Sessions** (zh 最近会话) through the existing `group.ungrouped` key, adds `empty.unassigned`, and the Workspace delete dialog says retained Sessions appear under it. The global `empty.none` state remains only for the flat list. The Session Intent hero needed no change: it already renders for a blank Session and its WorkspaceChip can adopt a Workspace before the first message.

## Alternatives considered

**Register a pseudo-Workspace for workspace-less Sessions.** Host Workspaces are directory-owned and path-deduplicated; a synthetic path would pollute registry semantics, the bootstrap account, and drag ordering for a purely client-side presentation need.

**Keep the bucket trailing and conditional on a stray Session.** The first workspace-less Session would stay invisible until opened, and the zero-Workspace instance would keep its dead-end New Session. The product requirement is a dedicated, always-visible column users can start from.

**Require an explicit cwd pick before starting a workspace-less Session.** Extra friction for the common "just start typing" case; the Host `defaultCwd` is a sound landing, and the hero chip already offers Workspace adoption before the first prompt.

**Auto-connect the unassigned bucket on cold start when no Workspace exists.** Symmetric with the recent-Workspace auto-connect, but it turns every workspace-less boot into a `session/create` RPC: full-assembly test benches for unrelated features would each need a create rule, and a fresh user would find a Session they never asked for. The session-less hero already offers a live composer, so creation stays on explicit intent.

## Consequences

A workspace-less Session persists its Host `defaultCwd` in the session header, so it never joins a Workspace on its own — adoption happens only through the hero picker or a later New Session inside a Workspace. The grouped tree always carries the leading bucket header, which shifts row indices in browser specs and renders an empty-state line instead of nothing. Order and expansion accounts are unchanged: the bucket keeps the browser-local Ungrouped account, and its default-expanded state yields to any explicit persisted record. New Session now always produces a usable composer — a Workspace session when one resolves, an unassigned one otherwise — while a workspace-less cold start still lands on the session-less hero and creates nothing until the user asks.

## Testing

`tree.client.spec.ts` pins the leading always-present bucket and its empty rows; `workspaces-service.client.spec.ts` pins blank reuse, in-flight coalescing, skipping Workspace-member blanks on a pending baseline, unassigned failure warnings, and that a workspace-less cold start creates nothing; `workspace-browser.client.spec.tsx` pins default expansion, the active ＋, the `empty.unassigned` copy, the delete-dialog wording, and the shifted drag indices. Package coverage stays at 100% per file.

The browser specs adapt to the leading bucket: the cold-summary bootstrap barrier waits for the first session row beside the always-present header instead of the header itself; workspace-less scenarios keep `first()` as the bucket header with a conditional expand and `nth(1)` as the session row, while Workspace scenarios shift their positional group/row locators by one; withdrawal assertions invert to the bucket's empty-state copy; and the Sessions-tree aria goldens gain the header (plus the empty-state line where the bucket holds no visible row). Row filters that match a Workspace title by substring scope to group headers through `[aria-expanded]`: a Session row whose title projection has not landed reads as the adopted directory basename, and the leading bucket places that row before the Workspace header.
