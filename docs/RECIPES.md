# Recipes — exactly how to make common changes

One recipe per change type: the files, the order, the trap. (Distinct from root [../WORKFLOW.md](../WORKFLOW.md), which is the daily *commands* cheat sheet.) Verify everything with `npm run check` (tsc + lint + vitest).

## Add a page

1. `app/<name>/page.tsx` — thin server shell (copy `/model`'s pattern; add `dynamic = "force-dynamic"` only if it reads stores server-side like Profile/Settings).
2. Client component in `components/` (PascalCase = single component; lowercase = named-export module — [convention](systems/08-frontend.md#naming-convention-bimodal-deliberate)).
3. Register in `components/Nav.tsx`'s `LINKS` (pick a tier; update keyboard digits).
4. Data: join `SyncProvider` if it needs sync state; otherwise the `useMountLoad` idiom or `useQuery` with a shared key.
5. Layout must satisfy [DESIGN.md](../DESIGN.md) §8 + [UX-CONSTITUTION](../UX-CONSTITUTION.md) §11's pre-ship checklist. Add the page to FEATURES.md.

## Add an API route

1. `app/api/<name>/route.ts`. Logic goes in a `lib/` module (pure where possible); the route stays an IO shell — see `ride-analysis.ts` as the model extraction.
2. Persistence through `data-store.ts` accessors (add one if the store is new; decide `.bak`-CRITICAL or derived).
3. Mutating a block? Adopt the CAS guard (`block-version.blockChangedResponse`).
4. CSRF is already applied by `proxy.ts` — don't add your own.
5. Errors: `{ error: string }` + `lib/log.ts` in the catch. Client side: `lib/client-api.api<T>()`.
6. Add the route to [FILE_INDEX.md](FILE_INDEX.md).

## Change generation behavior (prompt, rules, output shape)

Read [systems/06-generation.md](systems/06-generation.md) first.
- **Wording/rules** → `lib/anthropic-prompts.ts` (pure — iterate offline in its tests). Bump `PROMPT_VERSION` in `anthropic-api.ts` for structural changes.
- **Output shape** → `lib/plan-schema.ts` (`weeks` stays before `overview`).
- **Interval-protocol numbers** → the three-copy trap: KB + hard rules + `workout-validate.PROTOCOL`, together ([INVARIANTS #17](INVARIANTS.md)).
- **Volume/week logic** → `lib/block-skeleton.ts` (keep the feasibility gate and `validateWeekHours` in agreement).
- **Which day gets which session type/duration/ceiling** → `lib/block-skeleton.ts`'s `computeBlockSkeleton` (deterministic — the model fills the slots, it doesn't choose them). The two invariants (durations sum exactly to target; every envelope satisfies `min ≤ nominal ≤ max`) are property-swept across settings combinations in `block-skeleton.test.ts` — an example test alone won't catch a broken allocation, several real bugs only showed up under adversarial settings.
- Finish with **one live generation** and read the output (AGENTS.md rule).

## Turn over a block (end → retrospective → next block)

The first turnover happened and was confirmed clean (2026-07-22 → ARCHIVE.md) — `block-history.json`
and `intervention-log.json` both exist with real entries. Kept as a reusable reference for any
future turnover, attended or not.

1. **Backup first:** `GET /api/export` → save the bundle off-machine. `POST /api/import` is the exact restore path for the managed `data/` + `knowledge-base/` trees if you need to undo the turnover.
2. Sync (`POST /api/sync`) so the final rides are scored into the ledger.
3. **Wrap up on `/plan`:** a finished block proceeds straight to closeout; an unfinished one requires
   typing an explicit early-end reason first (the reason is stamped on the retro frontmatter and the
   history entry, and not-yet-lived days are cut from the archive). Closeout is deterministic-first —
   Claude's narrative + structured reflections are best-effort enrichment, never a gate.
4. Verify: `data/block-history.json` has a new entry, its newest entry carries a `closeout` evidence object, `days` non-empty, `nextBlockSeeds` non-empty.
5. **Review & adopt on `/plan` before generating the next block.** Nothing AI-written reaches generation until adoption (`POST /api/history`) flips `seeds_approved: true` on the retro markdown and stamps `reflectionsApprovedAt` on the history entry — unadopted seeds/reflections inject as empty. Degraded mode (Anthropic key unset or the narrative call fails): the facts + deterministic seeds still land; only the prose narrative is absent.
6. Generate + preview + write the next block on `/plan`. `seasonFocus`/`seasonPhase` land on the NEW
   block's `current-block.json` here, not on the retrospective's `block-history.json` entry.
7. Verify: if coaching directives fired (the common case), `data/intervention-log.json` now exists with this block's directives + baselines — zero directives is a legitimate outcome (no insights cleared the model's gate that day), not a failure; `current-block.json` is the new block.
8. Confirm `/today` shows the new block's first session; the block-completion nudge is gone.
9. **Owed smoke run (PR #92, first genuine turnover after 2026-08-23):** the retrospective
   closeout shipped with its live LLM path unexercised — before calling this turnover done, run
   `POST /api/retrospective` once against the live API on this real block and read the actual
   output: narrative well-formed and `approveSeedsInMarkdown` round-tripping the real frontmatter
   (AGENTS.md rule). The separate degraded-mode check must verify deterministic fallback with
   `## Retrospective` omitted cleanly; it is not the same run as the live narrative check.
   - **If any step fails:** stop, `POST /api/import` the backup, report — do not improvise against live data.

## Add or change a validator

Placement rules → `lib/schedule-validate.ts`; per-session protocol → `lib/workout-validate.ts`; wire into `app/api/generate/route.ts`, which runs them via `lib/publication-gate.ts`'s `evaluatePublicationGate` — classify each finding there by emitter into blocker / preference / advisory ([INVARIANTS #62](INVARIANTS.md)), never by message text; a new validator's findings are unclassified (informational) until you bucket them. Validators warn — they never rewrite ([INVARIANTS #13](INVARIANTS.md)). **One fact, one owner** — before adding a new warning, check no existing validator already states that fact for a different reason; a recovery week once produced three near-identical warnings for one problem ([06-generation.md § Known rough edges](systems/06-generation.md#known-rough-edges), [INVARIANTS § Generation contracts](INVARIANTS.md#generation-contracts)).

## Change scoring

Read [systems/02-scoring-and-learning.md](systems/02-scoring-and-learning.md). Scorer signals → `execution-score.ts`; ledger fields → `score-log.ts` + idempotent backfill in `sync-ledger.ts`. Never retro-score frozen entries. Fixture trap: avoid .x5 float boundaries.

## Add a readiness/state signal

`readiness.ts` (compute) → `athlete-state.athleteStateInputsFrom` (fuse; weights via calibration) → `coach-snapshot.resolveCoachSignals` (surface) → UI via `AthleteStateCard`/`StateDriversCard` (shared band styling in `athlete-state-ui.tsx`). Spec with tunable knobs: [specs/athlete-state.md](specs/athlete-state.md).

## Change physiology / zones

`lib/physiology.ts` is the FTP/zones source of truth (effective-dated; synced from Intervals.icu sport settings). Zones math in `zones.ts`. Never read FTP from `athlete.json` directly for scoring — use `physiologyAsOf` for historical rides.

## Add a calibratable parameter

`calibration.ts`: a `derive*` using `correlation.ts`'s guarded derivers, exposed through `trustedCalibration`, default in the same file, manual-override path via Settings (`block-settings.json`) or `/api/calibration`. Keep the discrimination guard — no calibrating to habit.

## Debug a bad generation

[systems/07-ai-layer.md#debugging-a-bad-generation](systems/07-ai-layer.md#debugging-a-bad-generation). Short version: check `warnings` and the publication-gate buckets on `plan.findings` (blockers / preferences; advisories fold into warnings) → inspect `GeneratedPlan.raw` → reproduce the prompt offline in a test → remember the 60s dedupe window. No trace module exists.

## Debug a sync

Flow map: [systems/01-sync-and-data.md](systems/01-sync-and-data.md). Iterate on today's ride with `npm run reset:today` + re-sync (this re-runs the deterministic pipeline; `reAnalyse()` in the UI forces a fresh coach note). Suspect-empty guard and inbound-move warnings surface in the sync response. Store corruption: check `<file>.bak` and the `corruptFallback` path in `json-store.ts`.

## Trace an API call end-to-end

Client: grep `api('/api/<name>` in `components/` (fetch wrapper is `lib/client-api.ts`). Route: `app/api/<name>/route.ts` → its lib modules ([FILE_INDEX](FILE_INDEX.md) lists both directions). State updates come back via React Query invalidation of `['sync']` — see [systems/08-frontend.md](systems/08-frontend.md).

## Add tests

Engine logic: colocated `lib/<name>.test.ts` (vitest, node env). Components: colocated `.test.tsx` with `/** @vitest-environment jsdom */` docblock (Testing Library — infra since 2026-07-23). Point stores at scratch via `NODEVELO_DATA_DIR`. If existing infra can't exercise the real behavior of a fix, ask the owner (extract-pure-logic vs add infra) rather than silently picking.

## Ship a docs change

Follow the closing ritual's ownership table in [COMPASS.md](COMPASS.md#session-rituals) and the `docs-sweep` skill. Shipped work → ARCHIVE.md; keep README's doc map current; commit docs separately from code.

## Add a workout type

1. `lib/types.ts` — extend the `WorkoutType` union (widest blast radius in the repo; `npm run check` will surface every switch that needs a case).
2. `lib/workout-types.ts` — add its `TYPE_STYLES` entry (badge/cell/accent classes; literal Tailwind strings).
3. `lib/workout-validate.ts` — a `PROTOCOL` entry if it's a quality type with intensity/duration bands. Remember the three-copy rule: the same bands must appear in the KB prose and `buildUserMessage`'s hard rules ([INVARIANTS #17](INVARIANTS.md)).
4. `lib/anthropic-prompts.ts` — teach the generation rules when/how to prescribe it; bump `PROMPT_VERSION`.
5. Check the type-sensitive engines: `execution-score.ts` (how is it graded?), `schedule-validate.ts` (freshness class for sequencing), `ride-classify.ts` (off-plan inference), `session-requirements.ts` (can goals require it?).
6. One live generation smoke run; verify the new type renders on Plan/Today with its styles.
