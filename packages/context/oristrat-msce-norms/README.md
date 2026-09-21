# @deepseek-ai/dsh-context-oristrat-msce-norms

English | [中文](README.zh.md)

Always-on Oristrat MSCE engine development norms for the fork deployment: one system-prompt section, registered at whatever context owns the prompt registry, carrying the condensed normative core of the `msce-engine-app-development` skill (component boundaries, View import and Less/I18n discipline, engineering comment reviews, the submission-coupled gate, and validation classifications).

The plugin also owns the `oristrat` settings namespace (`mode: coding | work`, default `coding`). In `work` mode the section contributes empty text — the norms stay out of the prompt for free-form proposal/PPT/document sessions — and the companion guard (`dsh-guard-msce-gate`) passes every dispatch through. Without a settings service the mode fails closed to `coding`.

## Model Experience

The section adds fixed normative prose to every assembled system prompt while the deployment mode is `coding`; in `work` mode it contributes nothing. It consumes no session tokens beyond its own text, touches the KV cache only as ordinary prompt prefix content, and changes no tool schema or model-visible event. Deep checklists remain in the installed skill and load on demand.

## Known Limitations and Deferred Work

- The norms are advisory prompt text: enforcement beyond model compliance (blocking code tools until a review passes) needs a loop-level guard plugin.
- PowerShell gate scripts referenced by the skill have no native non-Windows equivalents; the section mandates honest NOT_TESTED reporting instead.
