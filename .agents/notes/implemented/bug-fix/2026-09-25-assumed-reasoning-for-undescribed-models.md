# Agent Note: Assumed reasoning for models nothing describes

Status: implemented

English | [中文](2026-09-25-assumed-reasoning-for-undescribed-models.zh.md)

## Problem

The composer's reasoning-effort slider disappeared after a model switch whenever the chosen model had no entry in the installed pi-ai catalog — every model of a hand-declared route. `resolveModelReasoning` read the model's capability from the catalog entry alone, so a route whose `models` list names ids the catalog does not ship (`deepseek-v4.1-flash`, `MiniMax-M3`, a deployment's own gateway vocabulary) resolved `reasoning: false`, `reasoningInfo()` published no efforts, and the client rendered neither a slider nor an effort value. A gateway listing reports ids, capacities, and prices; it never reports which levels a model reasons at, so the one fact the selector needed was the one fact no deployment could supply without hand-writing a level map per model. The Oristrat seed and its startup migration declared levels for the ten glm ids only, which is why the same route showed a slider for one model and none for the next ([Oristrat round](../feature/2026-09-22-oristrat-thinking-slider-websearch-mcp-repo-browser-panels.md)).

## Decision

`PiAiProviderProfile` gained `assumeReasoning`, defaulting to `DEFAULT_ASSUME_REASONING` (`true`) and materialized per route into the catalog request, so a model with no installed entry resolves `reasoning: true` and offers pi-ai's own defaulting — the five base levels, without the `xhigh` and `max` spellings pi-ai reserves for an explicit map. The assumption is scoped to `base === undefined`: a model the installed catalog describes keeps its recorded capability, so no shipped-package behavior changes. Leaving a level unset sends no reasoning parameter at all, which bounds the cost of assuming too much. Two opt-outs exist: `assumeReasoning: false` refuses the offer for every model a route lists, and a model entry's `reasoningEfforts: false` refuses it for that one model. Both are ordinary validated schema fields, changed from cordis.yml like the capacity fallbacks they sit beside.

## Alternatives considered

**Infer the levels in the client.** The client cannot see the installed catalog and would have to guess a vocabulary it does not own; the locale package already localizes level ids, so inventing them host-side keeps one source for what a model offers.

**Synthesize a `thinkingLevelMap` for assumed models.** A map would have to spell every level on the wire; pi-ai's defaulting already spells the base five correctly for OpenAI-compatible routes, and a synthesized map would freeze spellings that a gateway may not accept.

**Ship the assumption as opt-in.** Opt-in restores the defect on every deployment that does not know it exists — including the route the report came from, whose settings file the seed cannot rewrite.

**Seed the reporting deployment's settings instead.** Editing `seed/settings.yaml` fixes one installation and leaves every hand-declared route added later in the same position.

## Consequences

Any model a route lists without an installed entry now shows the effort slider, so a genuinely non-reasoning model on such a route needs an explicit `reasoningEfforts: false`. Catalog-known models, the shipped seed routes, and every recorded session keep the capability they had. The offer is a capability statement about the model, not a selection: no effort is written until the user or the settings default chooses one.

## Testing

`packages/llm/llm-pi-ai/tests/catalog.spec.ts` pins the assumption, both opt-outs, and that no `thinkingLevelMap` is synthesized; `tests/config.spec.ts` pins the route default and its rejection of a non-boolean. `apps/web/tests/default-model.e2e.ts` drives a hand-declared route in a real browser and asserts the five-stop slider, its unset caption, and the `high` commit behind it; `apps/web/tests/declared-reasoning.e2e.ts` keeps pinning a declared level set, and the client specs in `packages/client/ui-model-selection/tests` pin the slider's place in the pane and in the keyboard walk.