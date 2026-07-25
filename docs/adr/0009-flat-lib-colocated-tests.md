# ADR-0009 · Flat `lib/` with colocated tests

**Context.** The engine layer grew to ~68 modules. Deep folder taxonomies force premature categorization and constant re-filing as concepts evolve; colocated tests keep the contract next to the code.

**Decision.** `lib/` stays flat; every module ships `<name>.test.ts` beside it (only `types.ts`, `workout-types.ts`, `tool-schema.ts`, `block-version.ts`, `client-api.ts` go without). Modules stay small and single-purpose; big routes extract pure logic into lib for testability (`ride-analysis.ts` is the pattern). Naming leans on suffix families (`-validate`, `-schema`, `-api`, `-store`, `-score`) rather than folders.

**Consequences.** Discovery relies on naming + documentation instead of hierarchy — which is why [FILE_INDEX.md](../reference/FILE_INDEX.md) and the [glossary's naming traps](../GLOSSARY.md#naming-traps) exist and must stay current. The flat listing makes the two look-alike pairs (`durability*`, `athlete-*`) and the two misleading names (`loading`, `trace`) everyone's problem; the docs, not restructuring, carry that load.
