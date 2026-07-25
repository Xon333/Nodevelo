# AI context — orientation for coding agents

Read this first; it replaces ~50 file reads. Operating rules (concurrency, commit policy, recurring bug classes) are in [../AGENTS.md](../AGENTS.md) and [../CLAUDE.md](../CLAUDE.md) — this file is the *map*, those are the *law*.

## What this is

NodeVelo: local-first AI cycling coach, single athlete, no auth, no DB. Next.js **16** (App Router — conventions differ from training data; check `node_modules/next/dist/docs/` before assuming), React 19, Tailwind v4, TypeScript strict, zod 4, vitest. State = JSON files in `data/` via an atomic/locked store; knowledge = markdown in `knowledge-base/` (gitignored) with committed fallbacks. External services: Intervals.icu (ride data + calendar, both directions) and the Anthropic API (exactly 6 call sites — [reference/PROMPT_INDEX.md](reference/PROMPT_INDEX.md)).

**Design center**: deterministic TypeScript computes every number; the LLM only arranges sessions and phrases prose, inside hard constraints. When in doubt about where logic belongs: math/validation in `lib/`, phrasing in the prompt.

## Fast index

- **All engine logic**: flat `lib/` (68 modules, tests colocated). Per-file map: [reference/FILE_INDEX.md](reference/FILE_INDEX.md).
- **Subsystem explanations**: [systems/](START_HERE.md#the-systems-shelf) — generation-pipeline, ai-layer, scoring-and-learning, daily-loop, season-engine, data-and-sync, knowledge-system, frontend.
- **Task recipes**: [workflows.md](workflows.md). **Hard contracts**: [reference/INVARIANTS.md](reference/INVARIANTS.md). **Terms**: [GLOSSARY.md](GLOSSARY.md).
- **Key hubs** (most-imported): `types.ts` (54), `data-store.ts` (31), `date.ts` (27), `client-api.ts` (17), `anthropic-api.ts` (14), `calibration.ts`, `season.ts` (10 each).
- **Biggest files**: `types.ts` 999, `season.ts` 925, `api/sync/route.ts` 905, `dashboard/today.tsx` 740, `AthleteProfileForm.tsx` 712, `anthropic-prompts.ts` 691.

## The traps (cost real debugging time before)

1. `lib/trace.ts` = ride power chart, **not** LLM tracing (none exists; use `GeneratedPlan.raw` + offline prompt tests).
2. `lib/loading.ts` = **carb**-loading, not training load.
3. `system-prompt.test.ts` / `ask-coach.test.ts` have no matching modules — they test `anthropic-prompts.ts`.
4. `/api/generate` doesn't persist the block — `/api/write` does (two-phase accept).
5. `/api/sync` imports `anthropic-api` but never calls the model (capability check only; `/api/analyze` makes the call).
6. `data/block-settings.json` / `loading-log.json` may not exist — defaults apply; and new migration flags need **truthy** checks (`undefined`, not `null`, from pre-field files).
7. Identical generation inputs within 60s return the deduped result (`generate-cache.ts`).
8. Dead-code hunts come back empty: every lib module, route, and component is referenced (verified 2026-07-25). `correlation.ts`'s only importer is `calibration.ts` — intentional.
9. "Today" = athlete-local date (`lib/date.ts`), never UTC-derived.
10. Interval-protocol numbers live in **three** hand-synced places (KB, prompt hard rules, `workout-validate.PROTOCOL`).

## Editing rules of thumb

- Persist only through `data-store.ts`/`json-store.ts`; concurrent mutations via `updateJsonFile`.
- Block-mutating routes take the CAS guard (`block-version.ts`).
- Validators warn, never rewrite (exceptions: durationMin reconcile, nutrition repair).
- Frozen ledger entries are never retro-scored.
- Prompt text only in `anthropic-prompts.ts` (+ its 3 schema/critic satellites); bump `PROMPT_VERSION` on structural change; per-block data stays out of the cached prompt half.
- Component naming: PascalCase = single component; lowercase = named-export module.
- Client data: join `SyncProvider`/React Query or the documented `useMountLoad` idiom; mutations invalidate `['sync']` rather than optimistic-merging.
- Tests: colocated; jsdom via per-file docblock; `NODEVELO_DATA_DIR` for store isolation; avoid .x5 float-boundary fixtures.
- Verify with `npm run check`. A changed AI path additionally needs one live smoke run.

## Doc system contract for agents

When you change behavior, update the owning doc ([START_HERE.md](START_HERE.md#ownership-rules-who-documents-what)): capabilities → FEATURES.md · open work → ROADMAP.md (stable IDs, append-only) · shipped → ARCHIVE.md · subsystem mechanics → the `docs/systems/` doc · per-file facts → FILE_INDEX.md. Never touch CONTINUE.md or `docs/superpowers/plans/`. Commit docs separately from code; stage only files you touched.
