# lib/ — the engine layer

Every number, decision, and validation in NodeVelo is computed here. Flat on purpose ([ADR-0009](../docs/DECISIONS.md)); tests are colocated (`<name>.test.ts`).

- **Per-file map**: [docs/FILE_INDEX.md](../docs/FILE_INDEX.md)
- **How the subsystems fit together**: [docs/COMPASS.md](../docs/COMPASS.md) → [docs/systems/](../docs/COMPASS.md#the-mental-model-60-seconds)
- **Hard contracts before you edit**: [docs/INVARIANTS.md](../docs/INVARIANTS.md)
- **Name traps**: `loading.ts` = carb-loading · `trace.ts` = ride chart, not LLM tracing · `athlete-model` (history) vs `athlete-state` (today) · `durability` (select) vs `durability-score` (grade). Full list: [docs/GLOSSARY.md](../docs/GLOSSARY.md#naming-traps)

## House rules

- Pure where possible; IO lives at the edges (`data-store.ts`, routes). Routes extract testable logic here (`ride-analysis.ts` is the pattern).
- Persistence only through `json-store.ts`/`data-store.ts`; migration flags use truthy checks.
- Prompt text only in `anthropic-prompts.ts` (+ `plan-schema` / `retrospective-schema` / `narrative-critic`).
- Shared math goes in `stats.ts`, shared date logic in `date.ts` — don't re-derive locally.
- New module = new colocated test. jsdom only via per-file docblock (components, not here).
