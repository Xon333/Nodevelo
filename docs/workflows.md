# Workflows — where to go for common changes

Task recipes. Each tells you the files, the order, and the trap. Daily commands and runbooks: [../WORKFLOW.md](../WORKFLOW.md). Verify everything with `npm run check` (tsc + lint + vitest).

## Add a page

1. `app/<name>/page.tsx` — thin server shell (copy `/model`'s pattern; add `dynamic = "force-dynamic"` only if it reads stores server-side like Profile/Settings).
2. Client component in `components/` (PascalCase = single component; lowercase = named-export module — [convention](systems/frontend.md#naming-convention-bimodal-deliberate)).
3. Register in `components/Nav.tsx`'s `LINKS` (pick a tier; update keyboard digits).
4. Data: join `SyncProvider` if it needs sync state; otherwise the `useMountLoad` idiom or `useQuery` with a shared key.
5. Layout must satisfy [DESIGN.md](../DESIGN.md) §8 + [UX-CONSTITUTION](../UX-CONSTITUTION.md) §11's pre-ship checklist. Add the page to FEATURES.md.

## Add an API route

1. `app/api/<name>/route.ts`. Logic goes in a `lib/` module (pure where possible); the route stays an IO shell — see `ride-analysis.ts` as the model extraction.
2. Persistence through `data-store.ts` accessors (add one if the store is new; decide `.bak`-CRITICAL or derived).
3. Mutating a block? Adopt the CAS guard (`block-version.blockChangedResponse`).
4. CSRF is already applied by `proxy.ts` — don't add your own.
5. Errors: `{ error: string }` + `lib/log.ts` in the catch. Client side: `lib/client-api.api<T>()`.
6. Add the route to [reference/FILE_INDEX.md](reference/FILE_INDEX.md).

## Change generation behavior (prompt, rules, output shape)

Read [systems/generation-pipeline.md](systems/generation-pipeline.md) first.
- **Wording/rules** → `lib/anthropic-prompts.ts` (pure — iterate offline in its tests). Bump `PROMPT_VERSION` in `anthropic-api.ts` for structural changes.
- **Output shape** → `lib/plan-schema.ts` (`weeks` stays before `overview`).
- **Interval-protocol numbers** → the three-copy trap: KB + hard rules + `workout-validate.PROTOCOL`, together.
- **Volume/week logic** → `lib/block-skeleton.ts` (keep the feasibility gate and `validateWeekHours` in agreement).
- Finish with **one live generation** and read the output (AGENTS.md rule).

## Add or change a validator

Placement rules → `lib/schedule-validate.ts`; per-session protocol → `lib/workout-validate.ts`; wire into `app/api/generate/route.ts`'s `warnings[]`. Validators warn — they never rewrite ([INVARIANTS #13](reference/INVARIANTS.md)).

## Change scoring

Read [systems/scoring-and-learning.md](systems/scoring-and-learning.md). Scorer signals → `execution-score.ts`; ledger fields → `score-log.ts` + idempotent backfill in `sync-ledger.ts`. Never retro-score frozen entries. Fixture trap: avoid .x5 float boundaries.

## Add a readiness/state signal

`readiness.ts` (compute) → `athlete-state.athleteStateInputsFrom` (fuse; weights via calibration) → `coach-snapshot.resolveCoachSignals` (surface) → UI via `AthleteStateCard`/`StateDriversCard` (shared band styling in `athlete-state-ui.tsx`). Spec with tunable knobs: [specs/athlete-state.md](specs/athlete-state.md).

## Change physiology / zones

`lib/physiology.ts` is the FTP/zones source of truth (effective-dated; synced from Intervals.icu sport settings). Zones math in `zones.ts`. Never read FTP from `athlete.json` directly for scoring — use `physiologyAsOf` for historical rides.

## Add a calibratable parameter

`calibration.ts`: a `derive*` using `correlation.ts`'s guarded derivers, exposed through `trustedCalibration`, default in the same file, manual-override path via Settings (`block-settings.json`) or `/api/calibration`. Keep the discrimination guard — no calibrating to habit.

## Debug a bad generation

[systems/ai-layer.md#debugging-a-bad-generation](systems/ai-layer.md#debugging-a-bad-generation). Short version: check `warnings`/`protocolViolations` → inspect `GeneratedPlan.raw` → reproduce the prompt offline in a test → remember the 60s dedupe window. No trace module exists.

## Debug a sync

Flow map: [systems/data-and-sync.md](systems/data-and-sync.md). Iterate on today's ride with `npm run reset:today` + re-sync (this re-runs the deterministic pipeline; `reAnalyse()` in the UI forces a fresh coach note). Suspect-empty guard and inbound-move warnings surface in the sync response. Store corruption: check `<file>.bak` and the `corruptFallback` path in `json-store.ts`.

## Trace an API call end-to-end

Client: grep `api('/api/<name>` in `components/` (fetch wrapper is `lib/client-api.ts`). Route: `app/api/<name>/route.ts` → its lib modules ([FILE_INDEX](reference/FILE_INDEX.md) lists both directions). State updates come back via React Query invalidation of `['sync']` — see [systems/frontend.md](systems/frontend.md).

## Add tests

Engine logic: colocated `lib/<name>.test.ts` (vitest, node env). Components: colocated `.test.tsx` with `/** @vitest-environment jsdom */` docblock (Testing Library — infra since 2026-07-23). Point stores at scratch via `NODEVELO_DATA_DIR`. If existing infra can't exercise the real behavior of a fix, ask the owner (extract-pure-logic vs add infra) rather than silently picking.

## Ship a docs change

Follow the ownership rules in [START_HERE.md](START_HERE.md#ownership-rules-who-documents-what) and the `docs-sweep` skill. Shipped work → ARCHIVE.md; keep README's doc map current; commit docs separately from code.
