# Invariants — what must never break

The contracts that hold NodeVelo together. Some are enforced by code/tests, some only by discipline. Breaking one usually won't fail a build — it corrupts trust, data, or money quietly.

## Data integrity

1. **The ledger is append-only.** Past `score-log.json` entries are frozen with their provenance stamps (FTP-used, calibration, fuel, form state). Only today's entry re-derives. LEDGER-1: a rebuild can never un-plan a frozen entry. LEDGER-2: normal merges never rewrite history. Scoring-logic changes apply forward, never retroactively. Diff check: `score-log.ts` merges must treat past dates as read-only; backfills in `sync-ledger.ts` must be idempotent (fixture: old entries + resync ⇒ byte-identical).
2. **All persistence goes through `json-store.ts`** — atomic write, `.bak` rotation for the CRITICAL set, per-file locks. Never raw `fs` for `data/`. Concurrent read-modify-writes go through `updateJsonFile` (reads inside the lock).
3. **Migration flags use truthy checks, never `=== null`.** A JSON file written before the field existed parses back as `undefined`. (Shipped-bug class; see AGENTS.md.)
4. **A corrupt live file's `.bak` is sacred** — rotation skips when live content doesn't parse; a fallback born from double-corruption is never persisted as truth.
5. **Suspect-empty syncs are refused.** Zero activities + zero wellness after a non-empty sync = upstream hiccup, keep previous data.
6. **The all-time power curve merges monotonically** — a partial fetch can't false-report a PR drop.

## Concurrency

7. **Block mutations are CAS-guarded** on `createdAt` (`block-version.ts` → 409). Accepted exception: morning-check PUT. New block-mutating routes must adopt the guard.
8. **Local commit before calendar mirror** (`persistMirroredMove`): the local move always lands; a mirror failure is surfaced, never rolled back.
9. **Calendar events are keyed `nodevelo-<date>`** — one owned event per block date; upserts are idempotent by design.

## Dates

10. **"Today" is the athlete's local day** — `localToday()`/`resolveToday()` from `lib/date.ts`; the client sends its local date to sync. Never inline `new Date().toISOString().slice(0,10)` for user-facing "today" (UTC drifts near midnight). Pure day-math may stay UTC-anchored.
11. **Form (TSB) is read from the prior day** — today's ride must never leak into "form going in".

## AI output shape

12. **Deterministic numbers, LLM phrasing.** The model never computes a training or nutrition figure; it copies from tables/snapshots the engines built ([DECISIONS](DECISIONS.md) ADR-0002).
13. **Validators warn; they don't rewrite.** The only sanctioned mutations: `reconcileDurationMin` and `repairNutrition` (visible `repairs` note). The narrative critic may rewrite the **overview prose** only.
14. **Per-block data never enters the cached system-prompt half** (`system-prompt.test.ts` is the executable contract).
15. **`weeks` stays declared before `overview`** in `PlanToolSchema` — field order forces the model to commit the schedule before summarizing it.

## AI provenance & cost

16. **Every AI artifact carries `model` + `promptVersion`.** Bump `PROMPT_VERSION` on structural prompt changes.
17. **The three-copy sync**: interval-protocol bands live in KB prose + `buildUserMessage` hard rules + `workout-validate.PROTOCOL`. A change to one is a change to all three.
18. **Model ids are duplicated** in `anthropic-api.ts` and `ai-usage.ts`'s PRICING keys; an unknown id silently records $0 cost.
19. **Changed AI paths get one live smoke run** before being called done (AGENTS.md).

## Architecture directions

20. **`correlation.ts` never imports `calibration.ts`** (calibration consumes correlation; reversing creates a cycle).
21. **Calibration precedence is exactly**: manual override > honestly-derived (must discriminate) > population default — all through `trustedCalibration`.
22. **Generation proposes; `/api/write` commits.** `/api/generate` persists nothing but the CAS-guarded season re-plan, and only after success.
23. **The sync route stays LLM-free** — the coach note is `/api/analyze`'s job (fast sync, isolated Anthropic failures).
24. **CSRF enforcement stays central** in `proxy.ts` — routes must not grow their own opt-outs.
25. **`compliance` is capped by execution** (`resolveCompliance`) — a badly-executed session can never report 100%.

## Documentation & repo process

26. **ROADMAP IDs (#1–4, §5–7, Track A–C) are stable handles** — append, never renumber; "decided against" records survive trims.
27. **`docs/superpowers/plans/` are immutable**; specs get a `Status:` stamp when shipped.
28. **CONTINUE.md is written only by `/handoff`.**
29. **`main` is integration-only.** Claude and Codex implementation tasks use fresh disposable
    worktrees on namespaced branches. Each task stages only its own files and finishes through
    `npm run finish:agent-task`; failed checks and merge conflicts are never bypassed or resolved by
    discarding one side.
30. **Test fixtures avoid .x5 float boundaries** — pre-rounding values sitting on a boundary flip under IEEE arithmetic.
31. **Markdown anchors are load-bearing.** COMPASS/FILE_INDEX/RECIPES link to `##` headings by slug — renaming a linked heading breaks inbound links silently; grep for the old slug before renaming.

## Generation contracts

32. **A block's day-slot durations sum exactly to its week's hour target**, and every slot satisfies `0 ≤ minMin ≤ nominalMin ≤ maxMin` (`block-skeleton.computeBlockSkeleton`, [06-generation.md](systems/06-generation.md#the-week-skeleton-composition-authority)). Property-swept across settings combinations in `block-skeleton.test.ts`, not just example-tested — the guarantee was broken by inputs no example test tried (an event colliding with the canonical long-ride day; a configured budget that couldn't actually be placed).
33. **One fact, one warning owner.** `validateSkeletonConformance` owns day-level facts, `validateWeekHours` owns the weekly total, `validateRecoveryWeekDensity` owns recovery composition — none may restate another's warning. A recovery week once produced three near-identical warnings for one problem before this was enforced.

## Aerobic comparability

34. **A shared variability criterion, not one comparability definition.** `isSteadyEnduranceRide` and
    `qualifyingPwHr` (`lib/aerobic.ts`) both gate on `AEROBIC_MAX_VI`, fail CLOSED when normalized power is
    unavailable — that is the ONLY thing they share. They answer different questions (whole-ride
    comparability for decoupling/EF vs. Z2-segment trustworthiness for the Pw:HR baseline) and must not be
    merged or used to gate each other's consumers: `aerobicEffPct()` already calls `qualifyingPwHr()`
    internally on the ride being scored, so a consumer-side `isSteadyEnduranceRide` check on the SAME value
    is redundant at best and silently over-suppressive at worst (it adds a duration/IF-band requirement
    `qualifyingPwHr` never needed, discarding legitimate short/low-intensity readings). Before gating a
    value against ride comparability, check whether it already flows through a gated producer.
35. **Inferred types may reward, never punish.** An off-plan ride's `plannedType` comes from
    `inferWorkoutType` on its own intensity, so any axis that penalises it against that type is circular.
    `computeExecutionScore` guards this for intensity-vs-type, the easy-ride merged read, and (since
    2026-08-06) the variability index — the bonus half of an axis is not circular (it measures a
    different quantity than the one that inferred the type) and stays live for intrinsic rides; only
    penalties are suppressed. A new penalty axis must add the same `!intrinsic` guard; a new bonus axis
    does not need one.

## Ride origin & intent overlays

36. **Ride origin is derived or asserted by an overlay — never stored on the ledger.** A frozen row is
    `prescribed` or `unspecified` (`originOf`, `lib/ride-origin.ts`); only an active intent overlay may
    assert `self-directed`. The ledger is written during LLM-free sync, before intent parsing.
37. **Drift uses effective origin, never a raw ledger row.** `summariseBehaviour` accepts
    `ResolvedRide[]`, and `buildAthleteModel` resolves once for both execution and behaviour. A
    self-directed ride must never increase `offPlanPct`.
38. **Only coherent, active, unsuperseded overlays apply.** `isApplicable` requires `status === "active"`
    and `supersededBy === null`, plus `isCoherent` (`lib/intent-overlay.ts`): `effectiveExecutionScore`
    and `notScoredReason` must be null/non-null together, `effectiveExecutionScore` and `scoringVersion`
    must be null/non-null together, an overlay whose `notScoredReason` is `no-intent-found`,
    `interpreter-failed`, or `intent-unreliable` must carry `origin: "unspecified"`, and `origin` may
    never be `"prescribed"` — only the ledger's own `planned` flag may establish that. Applicability is
    filtered before newest-wins selection; incoherent, pending, disabled, and superseded records fall
    back to the ledger.
39. **A prescribed ride always resolves to the ledger.** `resolveEffectiveOutcome` returns before overlay
    lookup for `entry.planned`; a post-ride note cannot redefine a formal session or replace its score.
40. **Self-directed outcomes join overall execution only.** Per-type statistics and compliance remain
    prescribed-only because inferred type comes from whole-ride IF and self-directed rides have no
    compliance concept. Overall and per-type EWMAs use separate sample-derived alphas so self-directed
    volume cannot indirectly alter prescribed-only smoothing.
41. **Phase 2b writes only on/after `autoFromDate`.** `IntentOverlayStore.autoFromDate` is a persisted
    floor, initialised on first run to that day's local date (truthy check — a 2a store parses it back
    `undefined`). Rides before it belong to Phase 4's human-reviewed repair; 2b writes nothing there,
    not even `pending`. `force` bypasses idempotency, never the boundary.
42. **The deterministic gate decides scoreability; confidence may only downgrade.** At least one
    grounded, kind-eligible objective plus evidence scope ≥ `max(INTENT_MIN_SCOPE_MIN,
    INTENT_SCOPE_MIN_FRACTION × ride minutes)`. `low` vetoes; `medium` drops `structure`; no confidence
    level can make a ride scoreable that the gate rejected.
43. **Evidence scope is what the evidence speaks about, never what went well.** A clearly stated target
    the athlete missed scores low; it never becomes `Not scored`. Scope is the maximum across
    objectives, not a union — zone arrays are whole-ride aggregates and lap indices carry no stated
    sample interval, so a union is not computable from the available evidence.
44. **Grounding is semantic and field-specific.** Zone tokens are masked out with printable text before
    any numeric scan, so the `4` in `Z4` can never ground `reps: 4`, nor the `5` in `Z5` ground
    `durationMin: 5`. Each field requires its own unit-bearing form. `verifyGrounding` may only lower
    the model's claim and takes no FTP: grounding is about what the note says, not what a number
    converts to.
45. **Objective decomposition cannot move the score**, via four ordered canonicalisation stages:
    (1) drop exact semantic duplicates on `(kind, zone, zoneBasis, durationMin, watts, targetPctFtp,
    reps, targetHrBpm, targetCadenceRpm, terrain)`; (2) merge only what remains distinct — `duration` → max,
    `zone-time` → summed per
    (zone, basis), `effort` reps never summed; (3) cross-kind subsumption, so one phrase contributes
    once (`zone-time` subsumes `zone-emphasis` for its zone and a `duration` sharing its span or
    target); (4) one clamped contribution per kind. Stage order is load-bearing: merging before
    deduping would make an exact duplicate sum as if it were distinct.
46. **The athlete's stated `%FTP` is extracted; watts are derived.** `targetPctFtp` and `watts` are
    separate target fields. The model emits whichever the note states and never converts — it is not
    given FTP. `resolveTargetWatts` converts against the ledger row's `ftpUsed`; without a usable
    anchor the objective is ungraded rather than resolved against a guess.
47. **A zone target is graded on the basis the athlete stated.** `zoneBasis` is `power`, `heart-rate`,
    or `unspecified`, reported from the note and never inferred from the zone number. An explicit basis
    never cross-falls-back: if its array is missing, the objective is ungraded. `unspecified` defaults
    to power, with HR fallback permitted for that basis only, and none at all indoors.
48. **The intent parser is shown the note and ride duration — nothing else.** No decoupling, scores,
    zone data, or FTP. The tool schema has no score, compliance, or drift field. Notes are capped at
    the shared `INTENT_NOTE_MAX_CHARS` (2000) in both intent parsing and ride analysis; longer notes
    get an explicit truncation marker.
49. **A note-less ride is decided without an LLM call.** The empty-note branch precedes client
    construction, and the empty note's fingerprint is stable so the ride is decided once.
50. **Overlay idempotency reads all records, not applicable ones, and transient call failures write
    nothing.** `needsParse` skips any unsuperseded `(activityId, noteFingerprint)` record, including
    `disabled` and `pending`. The runner reports transient failures in `failedIds`; the client echoes
    them as `skip`, so they wait for a later sync rather than retrying in the same loop.
51. **Supersession scope follows the ledger row's key.** Activation and supersession are one
    `updateIntentOverlays` transaction. A row with `activityId` scopes supersession to that id; a legacy
    row without it resolves through the date index, so every unsuperseded overlay for that date is
    superseded. Real-data verification on 2026-08-12 found 149 legacy rows and 5 activity-keyed rows,
    and exercised both paths.
52. **An overlay binds to the date's primary (longest) ride**, via `primaryRideOfDate` using
    `buildRideScores`'s strict comparison and array order, first-wins tie included. When the ledger row
    carries an `activityId`, it must equal that id or the date is skipped and reported; resolution
    never date-falls-back for a keyed row.
53. **`effectiveWorkoutType` is provenance, not a learning input.** It records the stated type, never
    one inferred from IF, and may only accompany `origin: "self-directed"`. Per-type learning stays
    prescribed-only until the two 1–10 scales are shown comparable on a real corpus and compliance
    gains a meaning for rides that currently have none.
54. **`INTENT_PROMPT_VERSION` is independent of `PROMPT_VERSION`.** The latter is stamped on generated
    plans, today analyses, and block-history entries; bumping it for an unrelated intent prompt would
    falsely assert changes to all three artifact families.
55. **The debrief never displays the raw ledger/analysis score once an overlay applies.**
    `RideIntentBlock`/`TodayRideCard` (`components/dashboard/ride-intent.tsx`,
    `components/dashboard/today.tsx`) read `todayOutcome.effectiveExecutionScore` — resolved
    server-side by the same `resolveEffectiveOutcome` seam items 36-40 govern — never
    `TodayAnalysis.executionScore` directly once `todayOutcome.overlay` is non-null. The old
    intrinsic scorer's number is the exact "generic 2/10" pathway design §14.1 replaces; a future
    consumer of `TodayAnalysis` that reads `.executionScore` for display without checking
    `todayOutcome` first would silently reintroduce it.
56. **A `terrain` objective is graded on existence and duration compliance only, never on technique.**
    `gradeTerrain` (`lib/intent-scoring.ts`) must never produce a skill/quality verdict for a climb or
    descent — that stays the explicit non-goal it always was (design doc §10's explicit non-goals). A future
    change that makes gradeTerrain's delta depend on anything besides matched-lap existence and
    duration-vs-stated compliance is the thing this invariant
    exists to catch.
