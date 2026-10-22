---
description: "Native Word, Excel, and PowerPoint creation, workspace file history, and optional Office templates for Web and Desktop."
kind: "package-reference"
---

# dsh-desktop-office

English | [中文](README.zh.md)

## Summary

Registers native Office creation in Web and Desktop. The creation dialog and `office_create` tool save real DOCX, XLSX, and PPTX files from supplied content without an LLM or a separately installed Office runtime. Word uses one paragraph per line; Excel accepts TSV and preserves formula-looking input as literal text; PowerPoint uses blank lines between slides, then a heading and body on each slide. Every save uses a new `office-files/<id>/` directory and never replaces an existing file.

## Use this package

Mount `dsh-desktop-office` with an absolute `config.root` for private UI state. Web and Desktop enable the row by default. `runtimeOwner` defaults to `plugin`; Desktop sets it to `desktop` because the Desktop Host installs its bundled Office skills and dependencies, including when `resources` is omitted. The active session must have a writable workspace; the writer runs under its existing sandbox policy. `maxInputBytes`, `maxSlides`, `maxCells`, `timeoutMs`, `maxDocuments`, `maxActivities`, `maxStateBytes`, and `maxDownloadBytes` configure bounded input, work, history, and downloads.

The dialog lists recent files from sessions sharing the same resolved workspace directory, including files created before the first model turn. Entries retain their originating session ID. Refreshing or opening a fresh session in that workspace preserves access to these files; unrelated workspaces are excluded. Opening uses the document sidebar; downloading reads the actual workspace file. Word and PowerPoint previews depend on the existing Office conversion service; Excel uses the existing spreadsheet viewer. The dialog creates files, while further rich editing uses the agent tools or an external Office application.

Optional `resources` and `cli` absolute paths enable prepared template assets, Word template editing, business skills, and the bundled Python runtime. `pnpm run office:prepare` prepares the installation resources; `apps/desktop/vendor/office/scripts/prepare-templates.mjs` adds the bundled examples. The resource directory is installation-owned and does not resolve relative to the session workspace. Missing configured resources fail activation; omitting them leaves native creation available with an empty template catalogue.

## Model Experience

`office_create` shares the dialog's writer and returns the saved path, format, title, byte count, and SHA-256 for `present`. Selecting Word or Excel injects the relevant bundled skill through logged `user/message` events. Mode selections and file history are separate atomic UI state, not new Session events; all model-visible instructions and tool results remain reconstructable from the Session log. PPT template authoring stays with the existing `pptd_*` tools.

#### KV Cache effect

The tool schema is stable while the plugin is active. Selecting a mode adds logged skill instructions to the next model request; it does not rewrite earlier messages.

## Validation

`apps/desktop-host/tests/vendor-office-authoring.spec.ts` runs the committed JavaScript and its native writer as a built-artifact smoke. Its tests reopen Office files, inspect OOXML content, compare downloads, check concurrent saves and workspace isolation, and reject malformed worker output or read-only writes. Web acceptance is in `apps/web/tests/office-creation.e2e.ts`. The keyless `apps/web/tests/office-authoring.snapshot.ts` replays a model call through real creation and `present`, compares its complete logged output and schema, and checks every member of the saved DOCX archive. Only the verified file identity and document timestamps are normalized for this scenario.

## Dev Note

This vendored package is maintained directly in its committed JavaScript files. Native creation uses `docx`, `exceljs`, and `pptxgenjs`; the optional prepared runtime remains compatible with Desktop installations.
