# Agent Note: Parent directory events for file watches

Status: implemented

English | [中文](2026-09-24-local-file-watch-rename-events.zh.md)

## Problem

A real macOS watch for a missing file sometimes failed to report creation by renaming a staged sibling into the target path during the complete test suite. Extending the test timeout from five to fifteen seconds still left the stream without a change frame. A direct 20-watch probe reproduced five missed target events with OS watching and none with Chokidar polling.

## Decision

File watches keep Chokidar's nonrecursive parent-directory watch and filter delivered events by the resolved target path in the provider callback. A watch opened while its target file is missing uses polling with the validated `missingFileWatchIntervalMs` setting, defaulting to 100 ms. Existing file and directory watches retain OS events.

## Alternatives considered

**Extend the test timeout.** The fifteen-second run still missed the event, so waiting longer did not address delivery.

**Remove Chokidar's sibling filter alone.** The complete test suite still missed the event after this change, so the callback filter alone cannot recover an omitted OS notification.

**Poll every file watch.** Existing files can use OS events without recurring metadata reads. Polling is limited to initially missing targets where the missed creation was reproduced.

## Consequences

Initially missing file watches perform periodic filesystem work for their lifetime, including after the file appears. Chokidar processes sibling events in the watched parent directory, while the provider still reports only the selected file. The watch remains nonrecursive and requires the caller to close it after readiness. The real-watch integration case covers creation of a missing outside file by atomic rename; adapter tests cover the polling selection, interval validation, sibling-event filtering, and closure.
