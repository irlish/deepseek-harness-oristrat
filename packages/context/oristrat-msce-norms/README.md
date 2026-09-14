# @deepseek-ai/dsh-context-oristrat-msce-norms

Always-on Oristrat MSCE engine development norms for the fork deployment: one
system-prompt section, registered at whatever context owns the prompt registry,
carrying the condensed normative core of the `msce-engine-app-development`
skill (component boundaries, View import and Less/I18n discipline, engineering
comment reviews, the submission-coupled gate, and validation classifications).

## Model Experience

The section adds fixed normative prose to every assembled system prompt; it
consumes no session tokens beyond its own text, touches the KV cache only as
ordinary prompt prefix content, and changes no tool schema or model-visible
event. Deep checklists remain in the installed skill and load on demand.

## Known Limitations and Deferred Work

- The norms are advisory prompt text: enforcement beyond model compliance
  (blocking code tools until a review passes) needs a loop-level guard plugin.
- PowerShell gate scripts referenced by the skill have no native non-Windows
  equivalents; the section mandates honest NOT_TESTED reporting instead.
