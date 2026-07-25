# lib/ — the engine layer

Every number, decision, and validation in NodeVelo is computed here. Flat on purpose ([ADR-0009](../docs/adr/0009-flat-lib-colocated-tests.md)); tests are colocated (`<name>.test.ts`).

- **Per-file map**: [docs/reference/FILE_INDEX.md](../docs/reference/FILE_INDEX.md)
- **How the subsystems fit together**: [docs/ATLAS.md](../docs/ATLAS.md) → [docs/systems/](../docs/START_HERE.md#the-systems-shelf)
- **Hard contracts before you edit**: [docs/reference/INVARIANTS.md](../docs/reference/INVARIANTS.md)
- **Name traps**: `loading.ts` = carb-loading · `trace.ts` = ride chart, not LLM tracing · `athlete-model` (history) vs `athlete-state` (today) · `durability` (select) vs `durability-score` (grade). Full list: [docs/GLOSSARY.md](../docs/GLOSSARY.md#naming-traps)

## House rules

- Pure where possible; IO lives at the edges (`data-store.ts`, routes). Routes extract testable logic here (`ride-analysis.ts` is the pattern).
- Persistence only through `json-store.ts`/`data-store.ts`; migration flags use truthy checks.
- Prompt text only in `anthropic-prompts.ts` (+ `plan-schema` / `retrospective-schema` / `narrative-critic`).
- Shared math goes in `stats.ts`, shared date logic in `date.ts` — don't re-derive locally.
- New module = new colocated test. jsdom only via per-file docblock (components, not here).
