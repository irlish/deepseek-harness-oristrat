# Agent Note: Session statistics render in every Oristrat mode

Status: implemented

English | [中文](2026-09-27-session-statistics-in-every-mode.zh.md)

## Problem

The composer's statistics row — session counts with speed, the session token total with cache-hit share, and the two dialogs behind them (`会话统计` with model time, tool time, mean TTFT, and TPS; `Token 用量` with every billing bucket) — never appeared in a default installation. Oristrat passes the point-in-time Session input zone to the composer's accessory and dock seats only while the deployment mode is `work` (`oristrat-msce-norms.mode`), and the shipped default is `coding`. First-party statistics therefore rode a gate meant for extension entries: the dock was never dispatched in coding mode, so `StatsPills` could not mount and both dialogs were unreachable. The reference desktop product shows them in every mode.

## Decision

The statistics dock follows the Session, not the deployment mode: `InputBar` passes the Session zone to `conversation.composer.dock` whenever a Session and input state exist, while `conversation.input.accessory` entries stay Work-only and the owner-passed accessory node stays mode-independent. The dock is the seat of first-party readouts — today only `StatsPills` — so its availability belongs to the Session lifecycle rather than to an extension surface. The presentation preference is unchanged: `ui-chat` still defaults `performanceUsage` to `detailed`, and a user who picks Compact keeps the plain readings.

## Alternatives considered

**Default the deployment to `work`.** Work mode also carries the MSCE norms suspension, the extension seats, and their copy; a statistics row must not select a different agent prompt.

**Render the dock through a new first-party seat.** A second composer row would have duplicated the dock's layout, styling, and dialog positioning for one contribution, and the existing seat already carries the correct Session-scoped zone.

**Register `StatsPills` on `conversation.input.right`.** That seat is part of the composer control row on the right; the statistics row belongs under the composer beside the context meter, which is where the reference product places it.

## Consequences

Both dialogs are reachable in coding and work mode, at the composer's bottom row, in the Oristrat app and the Web build alike. Extension entries registered on `conversation.input.accessory` still appear only in work mode. Deployments that want the dock gone again cannot switch it off from configuration; a future seat-level switch would have to name the dock explicitly.

## Testing

`packages/client/ui-conversation/tests/input-bar.client.spec.tsx` replaces the "keeps the extension seats unmounted outside Work mode" case with one that pins the split: without `workMode` the accessory slot stays undispatched while the dock dispatches against the same Session zone, and the zone-less case keeps both undispatched. The regenerated `cordis-client-runner` client catalog and the `ui-conversation` README pair record the changed seat contract.
