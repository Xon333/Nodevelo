# Adaptive self-directed coach — Phase 2b: intent parsing & self-directed execution scoring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the athlete's activity note into a trustworthy, deterministically-scored execution
verdict, written as a correctly-versioned `active` `IntentOverlay`, and read by every current
`buildAthleteModel` consumer — so a no-block self-directed ride with valid intent stops counting as
drift and starts earning an honest score, while missing or unreliable intent produces `Not scored`
rather than a bad one.

**Architecture:** The LLM does exactly one job — translate free text into a constrained
`StructuredIntent` with per-objective grounding flags. Everything that decides *whether* that intent
can be trusted, *which* objectives may be graded, and *what number* comes out is deterministic
TypeScript ([DECISIONS](../../DECISIONS.md) ADR-0002, INVARIANT 12). Parsing runs in a new
`POST /api/intent` sibling of `/api/analyze`, driven by a **derivable work queue** so `POST /api/sync`
stays LLM-free (INVARIANT 23) and any newly-synced *or edited* activity is covered, not just today.
Overlays are written through 2a's `updateIntentOverlays`, with supersession and activation in one
transaction.

**Tech Stack:** TypeScript 5, Next.js 16 (App Router), Vitest, zod 4 (already a dependency),
`@anthropic-ai/sdk` (already a dependency), Node `crypto` (built-in). No new dependencies. No new
`data/` files — 2a's `intent-overlays.json` is the only store.

---

## What this phase changes for the athlete

This is the first phase in the programme that **does** change what the athlete sees. Phase 2a shipped
inert on purpose; 2b supplies its producer. After this lands:

- a no-block ride whose note states measurable objectives gets an execution score derived from those
  objectives, and stops inflating `offPlanPct`;
- a no-block ride with no note, an unreadable note, or nothing measurable reads `Not scored` with a
  named reason, and still contributes every physical-load number it always did;
- a prescribed ride is completely unaffected — the resolution seam returns before overlay lookup
  (INVARIANT 39).

**Out of scope, deliberately:** the Phase 2c debrief UI (§12.2 — the "Intent used:" line, the
evidence trail, the `Not scored` rendering), the Phase 4 historical repair (§11), the Phase 3 TSS
envelope and session suggestion (§8/§9), any pre-ride button, confirmation step or new athlete
friction (locked decision #1), and segment-scoped decoupling (§7 step 2 — see Task 7's deferral gate).
2b writes the data 2c will render; it renders nothing new itself.

---

## Global constraints

- **The sync route stays LLM-free** (INVARIANT 23). `POST /api/sync` gains no Anthropic call and no
  import that transitively reaches one. Pinned by a test that greps the route's module graph.
- **The ledger stays append-only and is never rewritten** (INVARIANT 1). An overlay layers over it.
- **Deterministic numbers, LLM phrasing** (INVARIANT 12). The model returns *structure and grounding
  flags only*. It never returns a score, a percentage, a compliance figure, or a decoupling value, and
  the tool schema makes those fields unexpressible.
- **LLM confidence may downgrade, never promote** (locked decision #7, and the single most important
  rule in this plan). The deterministic gate decides scoreability first; confidence can only shrink
  the gradable set or veto it entirely.
- **A prescribed ride is never touched** (INVARIANT 39, decision #14). The queue never enqueues one.
- **Per-type learning and compliance stay prescribed-only** (INVARIANT 40). 2b adds
  `effectiveWorkoutType` as provenance but does **not** admit self-directed rides into per-type stats
  — see Task 1's rationale.
- **Every new consumer of `origin` / `status` / `supersededBy` / `activityId` / `legacy` re-derives
  the whole record lifecycle for itself.** This is the Phase 2a review lesson
  ([02-scoring-and-learning § Known rough edges](../../systems/02-scoring-and-learning.md#known-rough-edges)):
  four bugs, one shape — a validity gate correct where its author was looking and silently absent one
  path over. Every task below that reads one of those fields carries a **lifecycle test** (a record's
  real sequence of states over time), not only an isolated unit fixture.
- **Migration flags use truthy checks, never `=== null`** (INVARIANT 3). Overlays written before a
  field existed parse back `undefined`.
- **All persistence goes through `json-store.ts`** (INVARIANT 2), via 2a's `updateIntentOverlays`.
- **"Today" is the athlete's local day** (INVARIANT 10) — `resolveToday()` in the new route, exactly
  as `/api/analyze` does.
- Tests are colocated `lib/*.test.ts`, Vitest. **`npm run check` before every commit.** Stage only the
  files the task names — never `git add -A`.

---

## The eight questions this plan had to resolve

Recorded up front because they are the decisions a reviewer should attack first.

### 1. The deterministic scoreability threshold

Three pure predicates in `lib/intent-scoring.ts`, applied in this order:

**(a) Grounding — applies at every confidence level.** An objective is *grounded* only when every
numeric target it carries appears in the raw note. The interpreter must return `sourceText` (the
substring it read the objective from) and `grounded`; the deterministic check re-verifies grounding
itself by scanning the normalized note for each number, and **overrides the model's flag downward**
when it can't confirm it. This is design §5.2's "reject invented specificity" made enforceable rather
than requested: `"some Z4 and Z5 efforts"` cannot become `4 × 5 min`, because `4` and `5 min` are not
in the note.

**(b) Kind eligibility by confidence.** Five objective kinds:

| kind | target | graded from | needs a delimited time window? |
|---|---|---|---|
| `duration` | total ride minutes | `movingTimeSec` | no |
| `zone-time` | minutes in a named zone | `powerZoneTimes` / `hrZoneTimes` | no (total across the ride) |
| `zone-emphasis` | "mostly Z2", no number | zone times, as a *share* of the ride | no |
| `effort` | explicit watts and/or duration for a named effort | executed laps (`fetchIntervals`) | no |
| `structure` | ordered phases | phase-boundary attribution | **yes** |
| `qualitative` | skill/technique claims | — never graded | — |

```
GRADABLE_KINDS_BY_CONFIDENCE = {
  high:   ["duration", "zone-time", "zone-emphasis", "effort", "structure"],
  medium: ["duration", "zone-time", "zone-emphasis", "effort"],   // structure dropped
  low:    [],
}
```
`qualitative` is never in any list — it is *acknowledged* (`measurable: false, scored: false`) so the
debrief can say the athlete attempted it, and never graded (design §6: speed/braking/GPS cannot
establish that cornering was good).

**(c) The coverage gate.** At least one gradable objective must survive (a) and (b), and the gradable
set must speak about enough of the ride:

```ts
export const INTENT_MIN_COVERED_MIN = 20;   // absolute floor, minutes
export const INTENT_COVERAGE_MIN = 0.33;    // fraction of the ride's moving time

scoreable  ⇔  gradable.length >= 1
           && coveredMin >= Math.max(INTENT_MIN_COVERED_MIN, INTENT_COVERAGE_MIN * durationMin)
```

`coveredMin` is the **measured** minutes each gradable objective speaks about, not the claimed ones:
`duration` covers the whole ride; `zone-time` and `zone-emphasis` cover the measured minutes actually
in that zone; `effort` covers the matched lap's duration; `structure` adds nothing on its own
(it re-describes objectives already counted). Overlap is not double-counted — coverage is computed as
the union of covered minutes by kind, with `duration` short-circuiting to the full ride.

**Why measured, not claimed:** a note claiming "3 hours of Z2" on a 40-minute ride would otherwise
pass coverage on a fiction. Measuring it means an unfulfilled claim reduces coverage *and* costs
score, which is the correct pair of consequences.

**Why a coverage gate at all:** without it, one grounded 9-minute effort would license a whole-ride
1–10 verdict on 8% of a 118-minute ride — the "confident number from thin evidence" failure the
`Not scored` state exists to prevent (design §6: "a score requires enough objective evidence to be
meaningful").

**Confidence is one-way.** `low` ⇒ `intent-unreliable`, unconditionally, whatever (a)–(c) say.
`medium` ⇒ run (a)–(c) with the smaller kind list. `high` ⇒ run (a)–(c) unchanged. **There is no path
by which a higher confidence makes a ride scoreable that the deterministic gate rejected.** Pinned by
a property-style test that runs every fixture at all three confidences and asserts the scoreable set
is monotonically non-increasing as confidence falls, and never larger at `high` than the gate alone
allows.

### 2. Where parsing runs, with sync still LLM-free

**A new `POST /api/intent`, a sibling of `/api/analyze`, driven by a derivable queue.**

Rejected alternatives and why:

- *Inside `POST /api/sync`* — violates INVARIANT 23 outright.
- *Widen `/api/analyze`* — `addCoachNote` early-returns unless `analysis.activityDate === today`
  ([sync-analysis.ts:42](../../../lib/sync-analysis.ts)), and decision #12 requires coverage of *any*
  newly-synced or edited activity. Widening it would also fuse two prompts, two prompt versions and
  two failure domains into one route; an Anthropic hiccup parsing a 12-day-old ride would then take
  today's coach note down with it.
- *A background cron/worker* — no such runtime exists in this local-first app, and it would add a
  scheduler for a workload of at most a handful of calls per sync.

The queue is **derivable, not persisted**. `buildIntentQueue` (pure) recomputes it from
`readLastSync()` + `readScoreLog()` + `readIntentOverlays()`. An activity is enqueued iff:

1. it is a `Ride` / `VirtualRide` in the sync window with `date <= today`; **and**
2. its ledger entry exists and has `planned === false` (a prescribed ride is never enqueued —
   decision #14 enforced at the producer as well as at the seam); **and**
3. it is the **primary (longest) ride of its date** (see question 5); **and**
4. no overlay for that `activityId` carries the current note's `noteFingerprint` with
   `supersededBy === null` (see question 4).

`/api/intent` processes at most `INTENT_MAX_PER_RUN = 5` per invocation, newest date first, and
returns `{ processed, remaining, warnings }` so the client can call again while `remaining > 0`
(bounded loop, max 6 rounds, so a first-ever run over a 182-day window can't fan out unbounded LLM
calls or spend unbounded wall time). `SyncProvider` triggers it in the same deferred step that
already calls `/api/analyze`, and the existing manual re-analyse action passes `force: true`. **No
new button, no new athlete-facing control** (locked decision #1, non-goal "new pre-ride planning,
confirmation or completion buttons").

### 3. `effectiveWorkoutType` — add it, but keep per-type learning prescribed-only

**Add the field. Do not admit self-directed rides into per-type statistics in 2b.**

`IntentOverlay.effectiveWorkoutType: WorkoutType | null` is derived by a pure
`intentWorkoutType(intent)` from the *stated* purpose and zones — never from IF, which is the
circularity INVARIANT 35/40 exist to prevent. It is genuinely authoritative in a way `inferWorkoutType`
never was: the athlete said what the session was for.

It is nevertheless **provenance only** in 2b, and INVARIANT 40 stands unchanged. Two independent
reasons, both of which must be cleared before a later phase flips it:

1. **The two score populations are not yet known to be comparable.** A prescribed ride's score comes
   from adherence/duration-compliance/IF-band axes; a self-directed score comes from
   objective-grading axes (Task 3). Pooling them into one per-type EWMA asserts the two scales mean
   the same thing on the same 1–10 ruler. Nothing has measured that, because the overlay store is
   empty as this plan is written. Establishing it needs a real corpus and a comparison — Phase 2c/4
   work with data in hand, not a 2b assumption.
2. **Compliance still has no meaning for these rides** (decision #7). `complianceEwma`'s
   `comps.length ? … : 0` fallback would report 0% for a group with no compliance concept — the
   defect the 2a review caught. Admitting them per-type reopens it.

So Task 1 adds the field and its coherence rule, Task 6 leaves `buildAthleteModel`'s per-type filter
untouched, and Task 8 records the exact unlock condition in
[02-scoring-and-learning.md](../../systems/02-scoring-and-learning.md) beside INVARIANT 40's existing
revisit note. **A reviewer expecting per-type behaviour to change in this phase should read this
section first.**

### 4. Fingerprinting, idempotency, retry, atomic supersession

**Fingerprint.** `noteFingerprint(description)` = first 16 hex chars of
`sha256(normalize(description))`, where `normalize = (d ?? "").trim().replace(/\s+/g, " ")`. Node
`crypto.createHash`, no dependency. Whitespace-only and absent notes normalize to `""` and therefore
share one stable fingerprint — which is what makes "no note" idempotent rather than a permanent
re-queue.

**Idempotency — the lifecycle rule.** The skip test reads **all** overlays for the activity, not the
applicable ones:

```ts
needsParse(activityId, fp, overlays) =
  !overlays.some(o => o.activityId === activityId && o.noteFingerprint === fp && o.supersededBy === null);
```

Deliberately *not* `isApplicable`. Each status means something different to a re-parse:

| existing record for this `(activityId, fingerprint)` | re-parse? | why |
|---|---|---|
| `active`, not superseded | no | already done |
| `disabled`, not superseded | **no** | a human turned it off; re-parsing would resurrect it |
| `pending`, not superseded | **no** | Phase 4 prepared it for review; re-parsing would race the reviewer |
| any status, `supersededBy !== null` | yes | it interpreted a note that no longer exists |
| none | yes | never parsed |

Using `isApplicable` here — the natural-looking choice, and exactly the shape of all four Phase 2a
bugs — would silently re-parse and re-bill every `disabled` and `pending` record on every sync, and
would resurrect decisions a human deliberately made. A lifecycle test walks one activity through
`absent → active → note edited → superseded + new active → disabled` and asserts the queue decision at
each step.

**Retry.** A parse failure writes an `interpreter-failed` overlay immediately
(`origin: "unspecified"`, `effectiveExecutionScore: null`, `interpretation: null`,
`scoringVersion: null`) rather than leaving the activity silently queued forever. The athlete's
existing re-analyse action passes `force: true`, which bypasses the skip test for that activity and
supersedes the failed record. This is design §13's "leave the existing re-analysis retry path
available" with no attempt counter and no new UI. Anthropic-not-configured is **not** a parse failure:
it writes nothing at all and the activity stays queued for whenever a key exists.

**Atomic supersession.** One `updateIntentOverlays` call does both halves:

```ts
await updateIntentOverlays((existing) => [
  ...existing.map((o) =>
    o.activityId === activityId && o.supersededBy === null ? { ...o, supersededBy: next.id } : o
  ),
  next,
]);
```

Every unsuperseded record for the activity is superseded regardless of status — including `pending`
and `disabled` — because the note they interpreted is gone. `updateJson` reads inside the lock
(INVARIANT 2), so a concurrent sync and re-analyse cannot interleave into two live records.
Resolution never *depends* on that atomicity (2a rejects a superseded record whatever its status), but
the write must still be atomic so the store never contains two unsuperseded records for one activity.
Pinned by a test that asserts the invariant `overlays.filter(o => o.activityId === X && !o.supersededBy).length <= 1`
holds after every write in a simulated edit sequence.

### 5. Primary-ride binding on multi-ride dates

The queue binds an overlay to the **longest** ride of its date — the same rule `buildRideScores`
applies when it stamps `activityId` ([score-log.ts:334-336](../../../lib/score-log.ts)). Secondary
rides get no overlay in 2b; the ledger doesn't score them either, so an overlay for one would have
nothing to layer over.

The rule is extracted into one exported pure helper, `primaryRideOfDate(activities, date)`, so the two
cannot drift — **including the tie-break.** `buildRideScores` keeps the first-seen ride on an exact
duration tie (`entry.durationMin > prior.durationMin` is a strict comparison over the array in
Intervals' own order), so `primaryRideOfDate` must use the identical strict comparison over the
identical array order. A test asserts, on a two-ride and a tied-duration fixture, that
`primaryRideOfDate(...).id === buildRideScores(...)[0].activityId`. Getting this wrong binds an
overlay to a ride the ledger never scored, and the overlay would then resolve against nothing —
invisible from either side's unit tests, which is why the assertion is cross-module.

### 6. How a missing note avoids an LLM call

The fingerprint and the emptiness test are computed **before** the Anthropic client is touched. When
`normalize(description) === ""` the runner writes a deterministic overlay
(`no-intent-found`, `origin: "unspecified"`, `interpretation: null`, `scoringVersion: null`) and moves
on. Because the empty fingerprint is stable, the ride is decided exactly once and never re-queued.
Pinned by a test that injects a throwing parse function and asserts a note-less activity still yields
a correct overlay — the call is not merely skipped by luck of ordering, it is structurally unreachable.

### 7. How medium confidence grades supported objectives only

Mechanically: `medium` drops the `structure` kind from `GRADABLE_KINDS_BY_CONFIDENCE`, and the
grounding check (question 1a) drops any objective whose numbers the note doesn't contain — at every
confidence. What is left at `medium` is precisely "objectives directly supported by the note and
data" (design §5.3).

`structure` is the one kind that needs the interpreter to have correctly *ordered and delimited* the
ride's phases, which is the thing medium confidence is saying it is unsure about. Grading ordering on
an uncertain ordering is a fabricated verdict; grading "you were in Z2 for 44 minutes" is not, because
that reading needs no phase boundaries at all.

Acceptance example 14.2 (the scouting ride) is the executable fixture: no durations, no ordering,
`medium` → grade the Z2 emphasis and any grounded effort, invent no interval targets, and do not score
poorly merely because no block existed.

### 8. Mixed rides, whole-ride decoupling, and the segment deferral

Three separate statements, because they are three separate mechanisms:

**(a) The intent path never sees whole-ride decoupling.** The parse prompt receives the note text and
the ride's duration — nothing else. No decoupling, no scores, no zone data, no efficiency figures. Two
tests: the built prompt string contains none of them, and `lib/intent-scoring.ts` has no reference to
`decoupling` anywhere in its module graph. This is both the anti-contamination rule and the mechanism
that keeps the model from computing a number (INVARIANT 12): it cannot report a drift verdict it was
never shown.

**(b) The already-closed paths stay closed.** Phase 1 gated whole-ride decoupling behind
`isSteadyEnduranceRide` at both debrief producers — [ride-analysis.ts:242](../../../lib/ride-analysis.ts)
and [anthropic-prompts.ts:535](../../../lib/anthropic-prompts.ts). A mixed ride's 15.7% is already
`null` there, so the acceptance-14.1 failure ("treated a whole-ride 15.7% drift as an aerobic
durability failure") cannot recur through the debrief. 2b adds nothing to those paths and must not
loosen them.

**(c) One remaining LLM-facing leak is closed here (Task 7).**
[app/api/retrospective/route.ts:122](../../../app/api/retrospective/route.ts) averages
`activity.decoupling` across **all** block activities with no comparability gate and feeds the result
verbatim into the retrospective prompt. That is a raw mixed-ride number presented to a model as
evidence — the same defect shape in a different path, which is exactly the class the Phase 2a review
told us to hunt. It is a one-line gate with the ftp already in scope at that call site.
`lib/readiness.ts`'s `computeRollingBaselines` (`avgDecoupling90d` on the Recent Baselines card) is
**deliberately left**: it needs a parameter widening plus an ftp thread from three call sites, it is a
descriptive 90-day average rather than a per-ride aerobic-failure claim, and no LLM reads it. It stays
recorded as a named follow-up in the systems doc, not silently dropped.

**(d) Segment decoupling stays absent.** Design §7 step 2 (search the stream for a qualifying steady
segment) is **not implemented in 2b**, and a ride with no whole-ride-steady qualification renders
`Aerobic drift not measurable` — design §7 step 5, which is already the current behaviour. The
unlock gate, to be cleared with real data before any future phase writes segment code:

1. measure the actual sample rate of `fetchActivityStream` output across ≥20 of this athlete's real
   activities (the endpoint returns one array with no timestamps — the per-sample interval is assumed,
   not stated);
2. characterise dropout: how gaps and sensor cut-outs are represented (absent samples vs. zero-fill),
   because a zero-filled gap inside a candidate window silently depresses the second half and
   manufactures drift;
3. show on real data that a 30-minute window's half-split result is stable under (1) and (2) —
   specifically that re-deriving it from a re-fetched stream reproduces the same value.

Until all three are evidenced, a segment number would be a confident figure from unverified inputs,
which is the exact thing this whole programme exists to stop.

---

## File structure

| File | Change | Responsibility after this plan |
|---|---|---|
| `docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md` | **Restore** | The approved design basis, durable on `main`; status stamp only |
| `lib/types.ts` | Modify | `ObjectiveKind`; `ScoredObjective` gains `kind`/`grounded`/`sourceText`/`target`; `StructuredIntent.phases[].kind`; `IntentOverlay.effectiveWorkoutType` |
| `lib/intent-overlay.ts` | Modify | `isCoherent` gains the `effectiveWorkoutType` rule |
| `lib/intent-overlay.test.ts` | Modify | Coherence + lifecycle for the new field |
| `lib/intent-queue.ts` | **Create** | Pure: `normalizeNote`, `noteFingerprint`, `primaryRideOfDate`, `needsParse`, `buildIntentQueue` |
| `lib/intent-queue.test.ts` | **Create** | Queue rules, primary-ride parity with the ledger, the full status lifecycle |
| `lib/intent-scoring.ts` | **Create** | Pure: `INTENT_SCORING_VERSION`, grounding, `gradableObjectives`, `coveredMinutes`, `assessScoreability`, `scoreIntentExecution`, `intentWorkoutType`, `buildOverlay` |
| `lib/intent-scoring.test.ts` | **Create** | The threshold, the one-way confidence rule, every grader, the acceptance examples |
| `lib/intent-schema.ts` | **Create** | zod schema + `INTENT_TOOL` + `parseIntentToolOutput` |
| `lib/intent-schema.test.ts` | **Create** | Schema rejects unexpressible fields and malformed output |
| `lib/intent-prompt.ts` | **Create** | Pure `buildIntentPrompt(note, durationMin)` + `INTENT_PROMPT_VERSION` |
| `lib/intent-prompt.test.ts` | **Create** | Prompt carries the note and duration and *nothing else* |
| `lib/anthropic-api.ts` | Modify | `parseRideIntent()` — the thin SDK shell (RV-8 split convention) |
| `lib/ai-usage.test.ts` | Modify | Every model id used by a call site is present in `PRICING` (INVARIANT 18) |
| `lib/intent-runner.ts` | **Create** | Impure orchestrator: read stores → decide → parse or not → write atomically |
| `lib/intent-runner.test.ts` | **Create** | Missing-note short-circuit, failure handling, atomic supersession, `force` |
| `app/api/intent/route.ts` | **Create** | `POST` — `resolveToday`, bounded batch, `{ processed, remaining, warnings }` |
| `components/SyncProvider.tsx` | Modify | Fire the deferred intent step alongside `/api/analyze`; `force` on re-analyse |
| `lib/coach-snapshot.ts`, `lib/season-signals.ts`, `app/api/generate/route.ts`, `app/api/write/route.ts`, `app/api/trends/route.ts`, `app/api/sync/route.ts` (×3) | Modify | Thread the real overlay store into `buildAthleteModel` |
| `app/api/retrospective/route.ts` | Modify | Gate the block decoupling average on `isSteadyEnduranceRide` |
| `docs/INVARIANTS.md`, `docs/systems/02-scoring-and-learning.md`, `docs/FILE_INDEX.md`, `docs/systems/07-ai-layer.md`, `ROADMAP.md`, `FEATURES.md` | Modify | Record the contracts, the new call site, the shipped capability |

---

## Task list

| # | Task | Files touched | Commit |
|---|---|---|---|
| 0 | Restore the approved design spec + this plan | 2 docs | `docs: restore the approved adaptive-coach design scope` |
| 1 | Overlay schema: objective kinds + `effectiveWorkoutType` coherence | `types.ts`, `intent-overlay.ts` (+test) | `feat(scoring): extend the intent-overlay schema` |
| 2 | Note fingerprinting + the derivable parse queue | `intent-queue.ts` (+test) | `feat(scoring): derive the intent-parse queue` |
| 3 | Deterministic scoreability + objective grading | `intent-scoring.ts` (+test) | `feat(scoring): score self-directed intent deterministically` |
| 4 | The LLM seam: schema, prompt, call, pricing | `intent-schema.ts`, `intent-prompt.ts`, `anthropic-api.ts` (+tests) | `feat(ai): parse activity-note intent into structured objectives` |
| 5 | The runner + `POST /api/intent` + client wiring | `intent-runner.ts`, `app/api/intent/route.ts`, `SyncProvider.tsx` (+test) | `feat(api): run intent parsing outside the LLM-free sync` |
| 6 | Thread overlays into every `buildAthleteModel` consumer | 6 files (+tests) | `feat(scoring): read intent overlays in every athlete-model consumer` |
| 7 | Close the retrospective decoupling leak | `app/api/retrospective/route.ts` (+test) | `fix(retrospective): gate the block decoupling average` |
| 8 | Real-data verification, live smoke run, docs | 6 docs | `docs: record the intent-scoring contracts` |

Each task is independently committable and leaves the suite green. Tasks 2–4 have no dependency on
each other beyond Task 1's types and can be parallelised if dispatched to more than one agent; Task 5
depends on 2–4; Task 6 depends on 1; Tasks 7–8 depend on everything.

---

### Task 0: Restore the approved design spec

**Files:** `docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md` (restore),
`docs/superpowers/plans/2026-08-07-adaptive-coach-p2b-intent-scoring.md` (this file).

The approved design (commit `8041077`) never reached `main` — the phase plans reference it but it
exists only in that commit. Restoring it makes the design basis durable and reviewable alongside the
code it authorises. **Its §2 locked product decisions are preserved verbatim**; the only edit is the
`Status:` stamp recording which phases have shipped.

- [ ] **Step 1: Bring the file across and stamp its status** (already done in this worktree — verify)

```bash
git diff --stat 8041077 -- docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md
```

Expected: only the `Status:` block differs. If anything in §2 differs, **stop** — the locked
decisions must not be edited.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md docs/superpowers/plans/2026-08-07-adaptive-coach-p2b-intent-scoring.md
git commit -m "$(cat <<'EOF'
docs: restore the approved adaptive-coach design scope and plan Phase 2b

The design spec approved 2026-08-06 never reached main — Phases 1 and 2a shipped
against a document that existed only in commit 8041077. Restored verbatim except
its status stamp so the locked product decisions are durable and reviewable
alongside the code they authorise.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1: Overlay schema — objective kinds and `effectiveWorkoutType`

**Files:**
- Modify: `lib/types.ts`, `lib/intent-overlay.ts`, `lib/intent-overlay.test.ts`

**Interfaces:**
- Consumes: 2a's `IntentOverlay`, `ScoredObjective`, `StructuredIntent`, `WorkoutType`.
- Produces:
  - `export type ObjectiveKind = "duration" | "zone-time" | "zone-emphasis" | "effort" | "structure" | "qualitative"`
  - `ScoredObjective` gains `kind`, `grounded`, `sourceText`, `target`, `coveredMin`
  - `StructuredIntent.phases[]` gains `kind: ObjectiveKind`
  - `IntentOverlay.effectiveWorkoutType?: WorkoutType | null`
  - `isCoherent` rejects an overlay carrying `effectiveWorkoutType` with a non-`self-directed` origin

Tasks 3–6 consume all of these.

**Why `effectiveWorkoutType` is optional (`?`).** Every overlay written before this field existed
parses back `undefined`, not `null` (INVARIANT 3) — and although the store ships empty today, Phase 4
will write records this code must still read. The coherence rule therefore tests
`overlay.effectiveWorkoutType` truthily, never `!== null`. A literal pre-2b fixture pins it.

**Why the coherence rule exists at all.** `effectiveWorkoutType` is a fifth field a consumer can read
through a different path, which is precisely the Phase 2a defect shape. An `unspecified` overlay
means "no trustworthy intent was recovered" — a record that simultaneously asserts an authoritative
workout type contradicts itself, and a future per-type consumer reading the type without re-checking
the origin would pick up a type derived from nothing. The gate lives beside the existing
origin-coherence rules so there is one place to look.

- [ ] **Step 1: Write the failing tests**

Add to `lib/intent-overlay.test.ts` (extend, do not rewrite — the file's existing `overlay()` /
`notScored()` helpers are reused; add `effectiveWorkoutType: null` to `overlay()`'s defaults):

```ts
describe("isCoherent — effectiveWorkoutType (Phase 2b)", () => {
  it("accepts an authoritative type on a self-directed overlay", () => {
    const o = overlay({ origin: "self-directed", effectiveWorkoutType: "Z2" });
    const r = resolveEffectiveOutcome(entry({ activityId: "a1", executionScore: 5 }), indexOverlaysByActivity([o]), new Map());
    expect(r.source).toBe("overlay");
    expect(r.overlay?.effectiveWorkoutType).toBe("Z2");
  });

  it("REJECTS an authoritative type on an unspecified overlay", () => {
    // `unspecified` means no trustworthy intent was recovered. A record that then claims to know the
    // session's type contradicts itself, and a later per-type consumer reading the type through a
    // different path would inherit a type derived from nothing.
    const o = notScored("intent-unreliable", { effectiveWorkoutType: "Threshold" });
    const r = resolveEffectiveOutcome(entry({ activityId: "a1", executionScore: 5 }), indexOverlaysByActivity([o]), new Map());
    expect(r.source).toBe("ledger");
  });

  it("accepts a self-directed overlay with nothing measurable and no type", () => {
    const o = notScored("no-measurable-objectives", { effectiveWorkoutType: null });
    expect(resolveEffectiveOutcome(entry({ activityId: "a1" }), indexOverlaysByActivity([o]), new Map()).source).toBe("overlay");
  });

  it("treats a pre-2b record with the field ABSENT as coherent (INVARIANT 3)", () => {
    // Not `=== null` — a record written before the field existed parses back `undefined`. Guarding
    // with an equality check would reject every historical overlay Phase 4 has to read.
    const legacyRecord = { ...overlay({ origin: "self-directed" }) } as IntentOverlay;
    delete (legacyRecord as Partial<IntentOverlay>).effectiveWorkoutType;
    const r = resolveEffectiveOutcome(entry({ activityId: "a1", executionScore: 5 }), indexOverlaysByActivity([legacyRecord]), new Map());
    expect(r.source).toBe("overlay");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run lib/intent-overlay.test.ts -t "effectiveWorkoutType"
```

Expected: FAIL — the field doesn't exist (`tsc` will also object; that is the red state).

- [ ] **Step 3: Extend the types in `lib/types.ts`**

Locate the Phase 2a block (`OverlayStatus` around line 668). Add before `StructuredIntent`:

```ts
// What KIND of thing an objective is, which decides which grader can judge it and — for `structure`
// — whether medium confidence may grade it at all. `qualitative` is never graded: sensors cannot
// establish that cornering technique was good (design §6), so it is acknowledged and left alone.
export type ObjectiveKind =
  | "duration" // total ride time vs a stated total
  | "zone-time" // stated minutes in a named zone, measured across the whole ride
  | "zone-emphasis" // "mostly Z2" — a share claim with no number
  | "effort" // a named effort with explicit watts and/or duration
  | "structure" // ordered phases — the ONLY kind needing delimited time windows
  | "qualitative"; // skill/technique — acknowledged, never graded
```

Extend `StructuredIntent.phases[]` with `kind: ObjectiveKind` and replace `ScoredObjective` with:

```ts
// One stated objective, what the ride data could say about it, and the provenance that lets the
// deterministic layer re-verify the interpreter's claim instead of trusting it.
//   • `grounded` — every numeric target appears in the raw note. The interpreter reports it; the
//     deterministic check RE-VERIFIES and may only lower it (design §5.2, reject invented specificity).
//   • `sourceText` — the note substring the objective was read from, so grounding is auditable.
//   • `coveredMin` — the MEASURED minutes this objective speaks about, filled by the scorer, not the
//     model. Claimed minutes would let a note pass the coverage gate on a fiction.
// `scored: false` with `measurable: false` is the acknowledged-but-ungraded case (design §12.2).
export interface ScoredObjective {
  description: string;
  kind: ObjectiveKind;
  target: { durationMin?: number; watts?: number; zone?: string; reps?: number } | null;
  grounded: boolean;
  sourceText: string | null;
  measurable: boolean;
  scored: boolean;
  coveredMin: number | null;
  evidence: string | null;
}
```

Add to `IntentOverlay`, after `origin`:

```ts
  // The authoritative workout type the ATHLETE STATED — derived from the parsed intent, never from
  // whole-ride IF (that inference is the circularity INVARIANTS 35/40 forbid). OPTIONAL: records
  // written before this field existed parse back `undefined`, so every read is a truthy check, never
  // `=== null` (INVARIANT 3).
  //
  // PROVENANCE ONLY in Phase 2b — per-type learning stays prescribed-only (INVARIANT 40). Two
  // conditions must both be cleared before a later phase may admit these into per-type statistics:
  // (1) the prescribed and self-directed 1–10 scales must be shown comparable on a real corpus, and
  // (2) compliance must gain a meaning for rides that have none (decision #7). Neither is a 2b claim.
  // MUST be null/absent whenever `origin !== "self-directed"` — `isCoherent` enforces it.
  effectiveWorkoutType?: WorkoutType | null;
```

- [ ] **Step 4: Extend `isCoherent` in `lib/intent-overlay.ts`**

Add, immediately after the existing `origin === "prescribed"` rejection:

```ts
  // An authoritative workout type may only accompany a recovered intent. `unspecified` means no
  // trustworthy intent existed, so a type asserted alongside it was derived from nothing — and a
  // future per-type consumer reading the field through a different path would inherit it silently.
  // Truthy check, not `!== null`: a record written before this field existed parses back `undefined`
  // (INVARIANT 3), and rejecting those would break every historical overlay Phase 4 must read.
  if (overlay.effectiveWorkoutType && overlay.origin !== "self-directed") return false;
```

- [ ] **Step 5: Run the tests, then the full check**

```bash
npx vitest run lib/intent-overlay.test.ts && npm run check
```

Expected: both PASS. `ScoredObjective`'s new required fields will break any existing literal in the
2a test file — extend those fixtures; **do not change an existing assertion's expected value.**

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/intent-overlay.ts lib/intent-overlay.test.ts
git commit -m "$(cat <<'EOF'
feat(scoring): extend the intent-overlay schema for Phase 2b

Objectives now carry their kind, their grounding provenance and the measured
minutes they speak about, so the deterministic layer can re-verify the
interpreter's claims rather than trust them.

effectiveWorkoutType records the type the athlete STATED, never one inferred from
IF. It stays provenance only — per-type learning remains prescribed-only
(INVARIANT 40) until the two score scales are shown comparable on real data.
isCoherent rejects it on any non-self-directed overlay, guarded truthily so a
record predating the field still reads.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Note fingerprinting and the derivable parse queue

**Files:**
- Create: `lib/intent-queue.ts`, `lib/intent-queue.test.ts`

**Interfaces:**
- Consumes: `ActivitySummary`, `RideScoreEntry`, `IntentOverlay` (Task 1).
- Produces:
  - `normalizeNote(d: string | null | undefined): string`
  - `noteFingerprint(d: string | null | undefined): string`
  - `primaryRideOfDate(activities: ActivitySummary[], date: string): ActivitySummary | null`
  - `needsParse(activityId: string, fingerprint: string, overlays: IntentOverlay[]): boolean`
  - `buildIntentQueue(activities, entries, overlays, today): IntentQueueItem[]`
  - `export interface IntentQueueItem { activityId: string; date: string; note: string; fingerprint: string; durationMin: number }`
  - `export const INTENT_MAX_PER_RUN = 5`

Task 5 consumes all of them.

- [ ] **Step 1: Write the failing tests**

Create `lib/intent-queue.test.ts`. Reuse `lib/score-log.test.ts`'s `activity()` helper shape (read it
first — `Partial<ActivitySummary> & { date: string }`); define local `entry()`/`overlay()` builders
mirroring `lib/intent-overlay.test.ts`.

```ts
describe("noteFingerprint", () => {
  it("is stable and whitespace-insensitive", () => {
    expect(noteFingerprint("45 min Z2\n\nthen  climbing")).toBe(noteFingerprint(" 45 min Z2 then climbing "));
  });
  it("differs when the note's content changes", () => {
    expect(noteFingerprint("45 min Z2")).not.toBe(noteFingerprint("60 min Z2"));
  });
  it("gives null, empty and whitespace-only notes ONE stable fingerprint", () => {
    // This is what makes "no note" idempotent: the ride is decided once and never re-queued.
    const fp = noteFingerprint(null);
    expect(noteFingerprint("")).toBe(fp);
    expect(noteFingerprint("   \n  ")).toBe(fp);
    expect(noteFingerprint(undefined)).toBe(fp);
  });
});

describe("primaryRideOfDate — must agree with the ledger's own rule", () => {
  it("picks the longest ride of the date", () => {
    const acts = [activity({ date: "2026-01-05", id: "short", movingTimeSec: 1800 }), activity({ date: "2026-01-05", id: "long", movingTimeSec: 5400 })];
    expect(primaryRideOfDate(acts, "2026-01-05")?.id).toBe("long");
  });

  it("matches the activityId buildRideScores actually stamps, ties included", () => {
    // Cross-module, deliberately: buildRideScores keeps the FIRST ride on an exact duration tie
    // (`entry.durationMin > prior.durationMin` is strict). A helper that used `>=` would bind an
    // overlay to a ride the ledger never scored — invisible from either module's own unit tests.
    for (const acts of [
      [activity({ date: "2026-01-05", id: "a", movingTimeSec: 3600 }), activity({ date: "2026-01-05", id: "b", movingTimeSec: 3600 })],
      [activity({ date: "2026-01-05", id: "a", movingTimeSec: 1800 }), activity({ date: "2026-01-05", id: "b", movingTimeSec: 5400 })],
    ]) {
      const stamped = buildRideScores(null, acts, () => 288, "2026-01-10", "2026-01-01")[0];
      expect(primaryRideOfDate(acts, "2026-01-05")?.id).toBe(stamped.activityId);
    }
  });

  it("ignores non-ride activities", () => {
    const acts = [activity({ date: "2026-01-05", id: "gym", type: "WeightTraining", movingTimeSec: 7200 }), activity({ date: "2026-01-05", id: "ride", movingTimeSec: 3600 })];
    expect(primaryRideOfDate(acts, "2026-01-05")?.id).toBe("ride");
  });
});

describe("needsParse — the full record lifecycle, not just applicability", () => {
  const fp = "fp-1";
  const rec = (over: Partial<IntentOverlay>) => overlay({ activityId: "a1", noteFingerprint: fp, ...over });

  it("parses when nothing exists", () => {
    expect(needsParse("a1", fp, [])).toBe(true);
  });
  it("does NOT re-parse an active record", () => {
    expect(needsParse("a1", fp, [rec({ status: "active" })])).toBe(false);
  });
  it("does NOT re-parse a DISABLED record — a human turned it off", () => {
    // isApplicable() would return false here, and using it as the skip test (the natural-looking
    // choice, and the exact shape of all four Phase 2a bugs) would re-parse, re-bill, and resurrect
    // a decision a human deliberately made.
    expect(needsParse("a1", fp, [rec({ status: "disabled" })])).toBe(false);
  });
  it("does NOT re-parse a PENDING record — Phase 4 prepared it for review", () => {
    expect(needsParse("a1", fp, [rec({ status: "pending" })])).toBe(false);
  });
  it("DOES re-parse when every record for the fingerprint is superseded", () => {
    expect(needsParse("a1", fp, [rec({ status: "active", supersededBy: "ov-2" })])).toBe(true);
  });
  it("DOES parse a new fingerprint even while the old note's record is live", () => {
    expect(needsParse("a1", "fp-2", [rec({ status: "active" })])).toBe(true);
  });
  it("ignores records for a different activity", () => {
    expect(needsParse("a1", fp, [rec({ activityId: "other" })])).toBe(true);
  });
});

describe("needsParse — lifecycle walk", () => {
  it("decides correctly at each step of one activity's real history", () => {
    const fpA = noteFingerprint("45 min Z2");
    const fpB = noteFingerprint("45 min Z2 then 9 min at 292W");
    let store: IntentOverlay[] = [];

    expect(needsParse("a1", fpA, store)).toBe(true); // never parsed
    store = [overlay({ id: "ov-1", activityId: "a1", noteFingerprint: fpA, status: "active" })];
    expect(needsParse("a1", fpA, store)).toBe(false); // parsed

    // athlete edits the note
    expect(needsParse("a1", fpB, store)).toBe(true);
    store = [
      { ...store[0], supersededBy: "ov-2" },
      overlay({ id: "ov-2", activityId: "a1", noteFingerprint: fpB, status: "active" }),
    ];
    expect(needsParse("a1", fpB, store)).toBe(false);
    expect(needsParse("a1", fpA, store)).toBe(true); // the OLD note would re-parse if it came back

    // a human disables the correction
    store = [store[0], { ...store[1], status: "disabled" as const }];
    expect(needsParse("a1", fpB, store)).toBe(false); // stays off
  });
});

describe("buildIntentQueue", () => {
  const ftp = () => 288;
  const ledger = (over: Partial<RideScoreEntry> & { date: string }): RideScoreEntry => ({ /* … */ } as RideScoreEntry);

  it("enqueues an unplanned primary ride with a note", () => {
    const acts = [activity({ date: "2026-01-05", id: "a1", description: "45 min Z2" })];
    const q = buildIntentQueue(acts, [ledger({ date: "2026-01-05", planned: false, activityId: "a1" })], [], "2026-01-10");
    expect(q.map((i) => i.activityId)).toEqual(["a1"]);
    expect(q[0].note).toBe("45 min Z2");
  });

  it("NEVER enqueues a prescribed ride, however good its note (decision #14)", () => {
    const acts = [activity({ date: "2026-01-05", id: "a1", description: "45 min Z2" })];
    const q = buildIntentQueue(acts, [ledger({ date: "2026-01-05", planned: true, activityId: "a1" })], [], "2026-01-10");
    expect(q).toEqual([]);
  });

  it("enqueues a note-less ride too — it still needs a deterministic no-intent-found decision", () => {
    const acts = [activity({ date: "2026-01-05", id: "a1", description: null })];
    const q = buildIntentQueue(acts, [ledger({ date: "2026-01-05", planned: false, activityId: "a1" })], [], "2026-01-10");
    expect(q).toHaveLength(1);
    expect(q[0].note).toBe("");
  });

  it("enqueues only the primary ride of a two-ride date", () => {
    const acts = [
      activity({ date: "2026-01-05", id: "short", movingTimeSec: 1800, description: "spin" }),
      activity({ date: "2026-01-05", id: "long", movingTimeSec: 5400, description: "45 min Z2" }),
    ];
    const q = buildIntentQueue(acts, [ledger({ date: "2026-01-05", planned: false, activityId: "long" })], [], "2026-01-10");
    expect(q.map((i) => i.activityId)).toEqual(["long"]);
  });

  it("skips an activity with no ledger entry at all", () => {
    // No frozen row means nothing for an overlay to layer over (a zero-duration ride, or one outside
    // the ledger's 400-entry cap). Writing an overlay for it would create an orphan.
    const acts = [activity({ date: "2026-01-05", id: "a1", description: "45 min Z2" })];
    expect(buildIntentQueue(acts, [], [], "2026-01-10")).toEqual([]);
  });

  it("skips future-dated activities", () => {
    const acts = [activity({ date: "2026-01-20", id: "a1", description: "45 min Z2" })];
    expect(buildIntentQueue(acts, [ledger({ date: "2026-01-20", planned: false, activityId: "a1" })], [], "2026-01-10")).toEqual([]);
  });

  it("returns newest first, so a bounded run always processes the most relevant rides", () => {
    const acts = ["2026-01-03", "2026-01-05", "2026-01-04"].map((d, i) => activity({ date: d, id: `a${i}`, description: "45 min Z2" }));
    const entries = acts.map((a) => ledger({ date: a.date, planned: false, activityId: a.id }));
    expect(buildIntentQueue(acts, entries, [], "2026-01-10").map((i) => i.date)).toEqual(["2026-01-05", "2026-01-04", "2026-01-03"]);
  });

  it("is idempotent — a second call after the overlays are written returns nothing", () => {
    const acts = [activity({ date: "2026-01-05", id: "a1", description: "45 min Z2" })];
    const entries = [ledger({ date: "2026-01-05", planned: false, activityId: "a1" })];
    const q1 = buildIntentQueue(acts, entries, [], "2026-01-10");
    const written = [overlay({ id: "ov-1", activityId: "a1", noteFingerprint: q1[0].fingerprint, status: "active" })];
    expect(buildIntentQueue(acts, entries, written, "2026-01-10")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run lib/intent-queue.test.ts
```

Expected: FAIL — `Failed to resolve import "./intent-queue"`.

- [ ] **Step 3: Create `lib/intent-queue.ts`**

Pure, no I/O. `import { createHash } from "crypto"`. Implement exactly the rules in questions 4–6
above. Required properties, each already pinned by Step 1:

- `normalizeNote` = `(d ?? "").trim().replace(/\s+/g, " ")`; `noteFingerprint` = first 16 hex of
  `sha256` over it.
- `primaryRideOfDate` filters `type === "Ride" || type === "VirtualRide"` and `movingTimeSec > 0`,
  then reduces with a **strict** `>` in array order — the identical comparison and order
  `buildRideScores` uses. Add the comment explaining why `>=` would be wrong.
- `needsParse` scans **all** overlays (not `isApplicable`) — carry the table from question 4 as a
  comment above it.
- `buildIntentQueue` indexes entries by `date`, requires `entry.planned === false`, requires the
  activity to be `primaryRideOfDate`, requires `activity.date <= today`, then applies `needsParse`;
  sorts descending by date. It does **not** slice to `INTENT_MAX_PER_RUN` — that is the runner's call,
  so the queue length stays an honest `remaining` count.

- [ ] **Step 4: Run the tests, then the full check**

```bash
npx vitest run lib/intent-queue.test.ts && npm run check
```

- [ ] **Step 5: Commit**

```bash
git add lib/intent-queue.ts lib/intent-queue.test.ts
git commit -m "$(cat <<'EOF'
feat(scoring): derive the intent-parse queue from stores, not persisted state

An activity needs a parse iff it is an unplanned primary ride with a ledger row
and no unsuperseded overlay for its current note fingerprint. Derivable means
idempotent for free: a re-run after a successful write returns nothing.

The skip test reads ALL overlays rather than the applicable ones. Using
isApplicable — the natural-looking choice, and the exact shape of all four Phase
2a bugs — would re-parse and re-bill every disabled and pending record on every
sync, resurrecting decisions a human deliberately made.

primaryRideOfDate uses the ledger's own strict comparison and array order so an
overlay can never bind to a ride buildRideScores didn't stamp.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Deterministic scoreability and objective grading

**Files:**
- Create: `lib/intent-scoring.ts`, `lib/intent-scoring.test.ts`

**Interfaces:**
- Consumes: `StructuredIntent`, `ScoredObjective`, `ObjectiveKind`, `IntentInterpretation`,
  `NotScoredReason`, `IntentOverlay`, `WorkoutType`, `ActivitySummary`, `ExecutedInterval`.
- Produces:
  - `export const INTENT_SCORING_VERSION = 1`
  - `export const INTENT_MIN_COVERED_MIN`, `INTENT_COVERAGE_MIN`, `GRADABLE_KINDS_BY_CONFIDENCE`
  - `verifyGrounding(objective, normalizedNote): boolean`
  - `gradableObjectives(objectives, confidence, normalizedNote): ScoredObjective[]`
  - `gradeObjective(objective, evidence: RideEvidence): ScoredObjective` — fills `scored`, `coveredMin`, `evidence`, and an internal `delta`
  - `assessScoreability(objectives, durationMin): { scoreable: boolean; coveredMin: number; reason: NotScoredReason | null }`
  - `scoreIntentExecution(interpretation, evidence): { score: number | null; objectives: ScoredObjective[]; reason: NotScoredReason | null }`
  - `intentWorkoutType(intent: StructuredIntent): WorkoutType | null`
  - `buildOverlay(args): IntentOverlay`
  - `export interface RideEvidence { durationMin: number; powerZoneTimes: number[] | null; hrZoneTimes: number[] | null; laps: ExecutedInterval[]; ftp: number }`

Task 5 consumes `scoreIntentExecution` and `buildOverlay`.

**This module never imports the Anthropic SDK, never reads `activity.decoupling`, and never sees a
ride's existing execution score.** All three are pinned by tests (question 8a).

**The score model.** Start from the same baseline the prescribed scorer uses (5), then apply one
bounded delta per graded objective, then clamp to 1–10 — deliberately the same shape as
`computeExecutionScore` so the two scales are at least structurally alike, which is the
precondition question 3 names for ever pooling them:

| kind | graded from | delta |
|---|---|---|
| `duration` | `durationMin / target.durationMin` | ≥95% → +2 · ≥85% → +1 · ≥70% → 0 · ≥55% → −1 · else −2 |
| `zone-time` | measured minutes in the zone ÷ target minutes | same band table as `duration` |
| `zone-emphasis` | measured share of ride in the zone | ≥60% → +2 · ≥45% → +1 · ≥30% → 0 · else −1 |
| `effort` | best matching lap's avg watts ÷ target watts (lap matched by duration, ±20%, nearest) | the `computeExecutionScore` non-SIT adherence table (95–106 → +2 …) |
| `structure` | stated phase order vs the laps' chronological zone order | in order → +1 · else 0 (**never negative** — see below) |
| `qualitative` | — | never graded, never contributes |

**`structure` is reward-only, on purpose.** An out-of-order reading is at least as likely to be the
interpreter mis-ordering an ambiguous note as the athlete riding out of order — and design §6's "the
scorer must not penalize … deviation from the optional morning suggestion / absence of a formal
block" rests on the principle that structural facts about a self-directed ride are not failures. A
bonus is not circular; a penalty would grade the athlete on the parser's confidence.

**Missing data is never a failure** (design §13). When the evidence a grader needs is absent
(`powerZoneTimes === null`, no matching lap), the objective is returned `measurable: true,
scored: false, coveredMin: 0, evidence: "no <x> data"` and contributes **no delta** — it simply
doesn't count toward coverage either, which is the honest consequence.

- [ ] **Step 1: Write the failing tests**

Create `lib/intent-scoring.test.ts`. Required cases, at minimum:

*Grounding*
- an objective whose `target.durationMin: 5, reps: 4` is absent from the note `"some Z4 and Z5 efforts"` is not grounded, at every confidence (design §5.2's literal example);
- an objective whose numbers all appear in the note is grounded;
- the deterministic check **overrides a model-claimed `grounded: true`** it cannot confirm, and never overrides `false` upward.

*Confidence is one-way — the decisive test*
```ts
it("confidence can only ever shrink the gradable set, never grow it", () => {
  // The single rule this phase must not get wrong. Run every fixture at all three confidences and
  // assert monotonicity; a bug that let `high` license something the deterministic gate rejected
  // would be invisible in any per-confidence example test.
  for (const objectives of FIXTURES) {
    const hi = gradableObjectives(objectives, "high", NOTE).length;
    const mid = gradableObjectives(objectives, "medium", NOTE).length;
    const lo = gradableObjectives(objectives, "low", NOTE).length;
    expect(mid).toBeLessThanOrEqual(hi);
    expect(lo).toBe(0);
  }
});

it("a `low` confidence interpretation is intent-unreliable even with perfect grounded objectives", () => {
  const r = scoreIntentExecution(interpretation({ confidence: "low", objectives: [perfectDuration] }), evidence());
  expect(r.score).toBeNull();
  expect(r.reason).toBe("intent-unreliable");
});

it("`high` confidence cannot rescue a ride the coverage gate rejects", () => {
  const r = scoreIntentExecution(
    interpretation({ confidence: "high", objectives: [nineMinuteEffort] }), // 9 min of a 118 min ride
    evidence({ durationMin: 118 })
  );
  expect(r.score).toBeNull();
  expect(r.reason).toBe("no-measurable-objectives");
});
```

*The coverage gate*
- exactly at the boundary (`coveredMin === Math.max(20, 0.33 * durationMin)`) → scoreable;
- one minute under → `no-measurable-objectives`;
- a `duration` objective alone always covers the full ride and passes;
- **a claim the ride didn't fulfil reduces coverage**: `"3 hours of Z2"` on a 40-minute ride scores the
  duration objective badly *and* fails coverage — assert the reason is `no-measurable-objectives`, not
  a low score. Use durations that avoid `.x5` pre-rounding boundaries (INVARIANT 30).

*Each grader*, including the missing-data path for each (`powerZoneTimes: null`, `laps: []`).

*Acceptance examples, as executable fixtures* — these are the plan's real contract:
- **14.1** (118 min, note describing 45 min Z2 → variable climbing → 9 min ~292 W → descending
  practice, `high`): the four phases interpret; Z2, climbing and the 9-min effort are graded from
  their own data; descending is `measurable: false, scored: false`; **no variability penalty appears
  anywhere** (assert `objectives.every(o => o.kind !== "structure" || o.evidence !== null)` and that no
  delta derives from VI); the score is a real number, not `2`.
- **14.2** (119 min scouting note, `medium`): scores; grades the Z2 emphasis; grades no invented
  interval target (assert every `scored` objective is `grounded`); `structure` is absent from the
  graded set.

*Anti-contamination*
```ts
it("never reads whole-ride decoupling", () => {
  const src = readFileSync(new URL("./intent-scoring.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/decoupling/i);
});
```

*`intentWorkoutType`*
- maps stated Z2/endurance → `"Z2"`, stated threshold/tempo → `"Threshold"`, stated VO2/intervals → `"VO2max"`, recovery → `"Recovery"`;
- returns `null` when the stated purpose maps to nothing;
- **never consults intensity factor** — assert the function's signature takes only `StructuredIntent`
  (no activity, no IF), which makes the circularity unexpressible rather than merely avoided.

*`buildOverlay`*
- every combination of the five outcome rows in the 2a handoff table produces a record that
  `isApplicable` **accepts** (round-trip through `lib/intent-overlay.ts` — the two modules must agree,
  and a producer emitting records its own consumer rejects is precisely the 2a defect shape);
- `effectiveWorkoutType` is `null` on every `unspecified` row;
- `scoringVersion` is `INTENT_SCORING_VERSION` exactly when a score exists, `null` otherwise.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run lib/intent-scoring.test.ts
```

Expected: FAIL — `Failed to resolve import "./intent-scoring"`.

- [ ] **Step 3: Create `lib/intent-scoring.ts`**

Implement to the tests. Header comment must state: pure, no I/O, no SDK, no decoupling, and that the
deterministic layer is the sole authority on scoreability (INVARIANT 12 + locked decision #7).

- [ ] **Step 4: Run the tests, then the full check**

```bash
npx vitest run lib/intent-scoring.test.ts && npm run check
```

- [ ] **Step 5: Commit**

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts
git commit -m "$(cat <<'EOF'
feat(scoring): score self-directed intent deterministically

Grounding, kind-eligibility and a measured-coverage gate decide scoreability
before confidence is consulted; confidence can then only shrink the gradable set
or veto it. There is no path by which a high-confidence parse licenses a score the
deterministic gate rejected — pinned by a monotonicity test rather than per-level
examples, which would not have caught the inverse.

Coverage counts MEASURED minutes, not claimed ones, so an unfulfilled claim costs
both score and coverage instead of passing the gate on a fiction. Missing data is
never a failed metric: an ungradable objective contributes no delta and no
coverage. Structure is reward-only — an out-of-order reading is as likely to be
the parser's ambiguity as the athlete's.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The LLM seam — schema, prompt, call, pricing

**Files:**
- Create: `lib/intent-schema.ts`, `lib/intent-schema.test.ts`, `lib/intent-prompt.ts`, `lib/intent-prompt.test.ts`
- Modify: `lib/anthropic-api.ts`, `lib/ai-usage.test.ts`

**Interfaces:**
- Produces:
  - `INTENT_TOOL` (Anthropic tool definition), `IntentToolSchema` (zod), `parseIntentToolOutput(input: unknown): IntentInterpretation | null`
  - `buildIntentPrompt(note: string, durationMin: number): string`, `INTENT_PROMPT_VERSION = 1`
  - `parseRideIntent(note: string, durationMin: number): Promise<IntentInterpretation | null>` in `anthropic-api.ts`

**Model:** `GENERATION_MODEL` (`claude-sonnet-4-6`), already in `PRICING`. Not `QUICK_MODEL`: the whole
value of this call is disciplined refusal to invent specificity, which is a judgement task, and the
per-parse token count is tiny (a note plus a tool schema) so the cost difference is negligible against
the correctness risk.

**`INTENT_PROMPT_VERSION` is separate from `PROMPT_VERSION` — a deliberate deviation from the Phase 2a
plan's handoff note**, which said 2b's call site "bumps `PROMPT_VERSION`". `PROMPT_VERSION` is stamped
onto `GeneratedPlan`, `TodayAnalysis` and `BlockHistoryEntry` (INVARIANT 16) and means *those*
prompts changed. Bumping it for a new, unrelated prompt would assert a change to three artifact
families that didn't change and would invalidate their provenance comparisons. A sibling constant,
versioned independently and stamped only on `IntentInterpretation.promptVersion`, is what the
invariant actually asks for. Task 8 records this in INVARIANTS 16.

**The tool schema is where "the model never computes a number" is enforced.** It has no field for a
score, a percentage, a compliance figure, a decoupling value or an evidence verdict — those are
unexpressible, not merely discouraged. What it returns:

```
primaryPurpose: string
phases: [{ description, kind, durationMin?, targetZone?, targetWatts?, reps? }]
objectives: [{ description, kind, target?, grounded, sourceText }]
confidence: "high" | "medium" | "low"
```

- [ ] **Step 1: Write the failing tests**

`lib/intent-schema.test.ts`:
- valid tool output parses into an `IntentInterpretation`;
- output containing an unexpected `score` / `executionScore` / `decoupling` key is **rejected or
  stripped** (assert the parsed result carries no such field — zod `.strict()` on the objects);
- a missing `confidence`, an unknown `kind`, or a non-array `objectives` yields `null` rather than
  throwing (the caller degrades to `interpreter-failed`);
- an objective claiming `grounded: true` is passed through unchanged — the schema does not verify
  grounding, `lib/intent-scoring.ts` does (assert the module boundary explicitly so the responsibility
  isn't duplicated in two places that can drift).

`lib/intent-prompt.test.ts`:
- the prompt contains the note verbatim (truncated at a stated cap — mirror `buildRideAnalysisPrompt`'s
  400-char slice) and the ride duration;
- **the prompt contains no ride metrics at all**: assert it does not contain `decoupling`, `IF `,
  `TSS`, `NP`, `watts` figures from the activity, or any execution score. Feed a `RideEvidence`-shaped
  object into the test's scope and assert none of its numbers appear;
- the prompt instructs refusal of invented specificity (assert the literal rule text is present, so a
  later edit that drops it fails a test rather than silently weakening the contract);
- the prompt is deterministic — same inputs, byte-identical output.

`lib/ai-usage.test.ts` (add):
```ts
it("prices every model id any call site actually uses (INVARIANT 18)", () => {
  // An unknown id silently records $0. This asserts the pair rather than the table, so adding a call
  // site with a new model fails here instead of quietly under-reporting spend.
  for (const model of [GENERATION_MODEL, QUICK_MODEL]) {
    expect(estimateCostUsd(model, { input_tokens: 1_000_000, output_tokens: 0 })).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run lib/intent-schema.test.ts lib/intent-prompt.test.ts lib/ai-usage.test.ts
```

- [ ] **Step 3: Create `lib/intent-schema.ts` and `lib/intent-prompt.ts`**

Follow `lib/retrospective-schema.ts` and `lib/narrative-critic.ts` for shape — those are the two
existing tool-use call sites and this must not invent a third convention.

- [ ] **Step 4: Add `parseRideIntent` to `lib/anthropic-api.ts`**

Thin SDK shell only (the file's stated RV-8 role). Mirror `generateStructuredRetrospective`'s
graceful-degradation contract exactly: forced `tool_choice`, `void recordUsage(GENERATION_MODEL, response.usage)`,
return `null` when no `tool_use` block or the schema rejects. `max_tokens: 900`, `temperature: 0.3`.
Do **not** swallow a thrown SDK error here — the runner needs to distinguish "the model declined to
produce valid structure" (`null` → `intent-unreliable`) from "the call failed" (throw →
`interpreter-failed`). Add a comment saying so; conflating them is how a transient network blip
becomes a permanent `intent-unreliable` verdict on a perfectly good note.

- [ ] **Step 5: Run the tests, then the full check**

```bash
npx vitest run lib/intent-schema.test.ts lib/intent-prompt.test.ts lib/ai-usage.test.ts && npm run check
```

- [ ] **Step 6: Commit**

```bash
git add lib/intent-schema.ts lib/intent-schema.test.ts lib/intent-prompt.ts lib/intent-prompt.test.ts lib/anthropic-api.ts lib/ai-usage.test.ts
git commit -m "$(cat <<'EOF'
feat(ai): parse activity-note intent into structured objectives

The tool schema has no field for a score, a percentage or a decoupling value, so
"the model never computes a number" is unexpressible rather than merely
instructed. The prompt carries the note and the ride's duration and nothing else
— a model shown no drift figure cannot report a drift verdict.

INTENT_PROMPT_VERSION is versioned separately from PROMPT_VERSION: the latter is
stamped on GeneratedPlan, TodayAnalysis and BlockHistoryEntry, and bumping it for
an unrelated new prompt would assert a change to three artifact families that
didn't change.

parseRideIntent returns null when the model declines to produce valid structure
but THROWS when the call fails, so a transient network blip can't become a
permanent intent-unreliable verdict on a good note.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The runner and `POST /api/intent`

**Files:**
- Create: `lib/intent-runner.ts`, `lib/intent-runner.test.ts`, `app/api/intent/route.ts`
- Modify: `components/SyncProvider.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–4, plus `readLastSync`, `readScoreLog`, `readIntentOverlays`,
  `updateIntentOverlays`, `readAthleteProfile`, `fetchIntervals`, `isAnthropicConfigured`.
- Produces:
  - `runIntentParsing(today: string, warnings: string[], opts?: { force?: string[]; limit?: number }): Promise<{ processed: number; remaining: number }>`
  - `POST /api/intent` → `{ processed, remaining, warnings }`

**The runner's decision order** — this is the whole of question 6's structural guarantee:

```
for each queued item (newest first, up to limit):
  1. if normalizeNote(item.note) === ""      → write no-intent-found overlay. NO client, NO call.
  2. if !isAnthropicConfigured()             → write NOTHING; leave queued; warn once.
  3. gather evidence (zone times from the ActivitySummary; laps via fetchIntervals, best-effort → [])
  4. interpretation = await parseRideIntent(note, durationMin)
       - throws  → write interpreter-failed overlay (unspecified, null score)
       - null    → write intent-unreliable overlay (unspecified, null score)
  5. verdict = scoreIntentExecution(interpretation, evidence)
  6. overlay = buildOverlay({...})            → status "active" (2b auto-accepts; Phase 4 writes pending)
  7. ONE updateIntentOverlays call: supersede every unsuperseded record for this activityId, append.
```

Step 1 precedes step 2 deliberately: a note-less ride is decided even with no API key configured,
because that decision needs no model.

`force: string[]` is a list of activity ids whose skip test is bypassed (the re-analyse action sends
today's primary ride id). It never bypasses the *prescribed* or *primary-ride* rules — only
idempotency.

**Evidence gathering caveat, recorded rather than hidden.** For a non-today activity,
`powerZoneTimes` / `hrZoneTimes` come from Intervals.icu's own zone definitions
([intervals-api.ts:253](../../../lib/intervals-api.ts)), not the athlete's physiology store — unlike
today's ride, which `/api/sync` re-buckets from raw streams against the athlete's own zones. The two
can disagree at zone edges. 2b accepts Intervals' buckets rather than fetching and re-bucketing every
historical stream (a per-ride stream fetch for a whole backlog is a materially larger change), and
Task 8 records the limitation in the systems doc. It biases individual zone-time gradings slightly,
never the scoreable/not-scoreable decision, which rests on relative shares.

- [ ] **Step 1: Write the failing tests**

`lib/intent-runner.test.ts`. Mock the data-store and Anthropic modules with `vi.mock` (follow whatever
mocking convention the existing route/lib tests use — read one first). Required cases:

```ts
it("decides a note-less ride with NO parse call at all", async () => {
  // Structural, not incidental: inject a parse function that throws if called. A "we skip it" that
  // relied on ordering luck would still bill the athlete for every rest-day ride with an empty note.
  const parse = vi.fn(() => { throw new Error("must not be called"); });
  // …
  expect(parse).not.toHaveBeenCalled();
  expect(written[0].notScoredReason).toBe("no-intent-found");
  expect(written[0].origin).toBe("unspecified");
  expect(written[0].interpretation).toBeNull();
  expect(written[0].scoringVersion).toBeNull();
});

it("writes NOTHING when Anthropic is unconfigured, leaving the ride queued", async () => { /* … */ });

it("writes interpreter-failed when the call throws, and intent-unreliable when it returns null", async () => { /* … */ });

it("supersedes and activates in ONE store write", async () => {
  // The transaction, not the outcome: assert updateIntentOverlays was called exactly once and that
  // the array it produced has the predecessor superseded AND the successor appended.
});

it("never leaves two unsuperseded records for one activity, across an edit sequence", async () => {
  // The lifecycle invariant. Walk: parse → edit → re-parse → force re-analyse, asserting after EACH
  // write that overlays.filter(o => o.activityId === "a1" && !o.supersededBy).length <= 1.
});

it("supersedes a pending and a disabled predecessor too — the note they read is gone", async () => { /* … */ });

it("respects the batch limit and reports the true remaining count", async () => { /* … */ });

it("writes only records its own consumer accepts", async () => {
  // Producer/consumer round-trip: every overlay this runner writes must satisfy isApplicable (for the
  // active ones) — a producer emitting records its resolver rejects is the 2a defect shape exactly.
  for (const o of written) expect(isApplicable(o)).toBe(true);
});

it("never enqueues or writes for a prescribed ride, even with force", async () => { /* … */ });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run lib/intent-runner.test.ts
```

- [ ] **Step 3: Create `lib/intent-runner.ts`**

Mirror `lib/sync-analysis.ts`'s structure and its warning discipline (`warnings.push`, never throw out
of the loop — one bad ride must not abort the batch).

- [ ] **Step 4: Create `app/api/intent/route.ts`**

Copy `app/api/analyze/route.ts`'s shape exactly: `export const maxDuration = 60`, tolerant body parse,
`resolveToday(body?.today)` (INVARIANT 10), `force` from the body. Return
`{ processed, remaining, warnings }`. **Do not** guard the whole route on `isAnthropicConfigured()` the
way `/api/analyze` does — a note-less ride is still decidable without a key.

- [ ] **Step 5: Wire the deferred step in `components/SyncProvider.tsx`**

Extend the existing `runAnalysis` callback so the same deferred step also calls `/api/intent`, looping
while `remaining > 0` up to 6 rounds. Reuse `analyzingRef` as the re-entrancy guard (UXA-6's lesson —
a double-click must not double-bill). Surface warnings through the existing `setSyncWarnings`. **No new
button and no new UI state**: `analyzing` already covers it.

- [ ] **Step 6: Prove the sync route is still LLM-free**

Add to whichever test file covers the sync route (or create `app/api/sync/route.llm-free.test.ts`):

```ts
it("POST /api/sync imports nothing that reaches the Anthropic SDK (INVARIANT 23)", () => {
  // Static, not behavioural: a behavioural test passes as long as the call happens to be guarded.
  // Walk the route's transitive local imports and assert none is @anthropic-ai/sdk.
});
```

- [ ] **Step 7: Run the full check and commit**

```bash
npm run check
```

```bash
git add lib/intent-runner.ts lib/intent-runner.test.ts app/api/intent/route.ts components/SyncProvider.tsx
git commit -m "$(cat <<'EOF'
feat(api): run intent parsing outside the LLM-free sync

A sibling of /api/analyze rather than a widening of it: addCoachNote is today-only
by construction, decision #12 needs any newly-synced or edited activity, and
fusing the two would take today's coach note down with a failed parse of a
12-day-old ride.

A note-less ride is decided before the client is constructed, so the skip is
structural rather than a matter of ordering luck. Supersession and activation
happen in one updateIntentOverlays call, so the store never holds two
unsuperseded records for one activity.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Thread overlays into every `buildAthleteModel` consumer

**Files:**
- Modify: `lib/coach-snapshot.ts`, `lib/season-signals.ts`, `app/api/generate/route.ts`,
  `app/api/write/route.ts`, `app/api/trends/route.ts`, `app/api/sync/route.ts` (three call sites)
- Test: `lib/athlete-model.test.ts`, plus each module's own test file where one exists

**Interfaces:** no signature changes — 2a already gave `buildAthleteModel` its optional second
parameter. This task fills it in at all eight production call sites.

**Re-grep first; the 2a plan's line numbers may have drifted:**

```bash
grep -rn "buildAthleteModel(" --include='*.ts' --include='*.tsx' lib/ app/ components/ | grep -v test
```

Expected eight, all currently one-argument: `coach-snapshot.ts:335`, `season-signals.ts:67`,
`generate/route.ts:182`, `write/route.ts:277`, `trends/route.ts:111`, `sync/route.ts:111/720/960`.
**If the count is not eight, stop and report** — a call site added since 2a would otherwise silently
keep reading the ledger while its siblings read overlays, which is the 2a defect shape one more time.

`lib/coach-snapshot.ts` and `lib/season-signals.ts` are pure-ish builders taking their data in. Thread
the overlays through their input objects rather than adding an I/O read inside them; the routes that
call them already read stores. Confirm each builder's existing input shape before editing.

- [ ] **Step 1: Write the failing test**

Add to `lib/athlete-model.test.ts`:

```ts
it("every production call site passes overlays (no silent ledger-only reader left)", () => {
  // A grep-style guard rather than eight behavioural tests. The failure this catches — one consumer
  // still reading the raw ledger while the rest read overlays — produces two different answers to
  // "was this ride drift" inside one request, which no single-module test can see.
  const sources = ["lib/coach-snapshot.ts", "lib/season-signals.ts", "app/api/generate/route.ts",
    "app/api/write/route.ts", "app/api/trends/route.ts", "app/api/sync/route.ts"];
  for (const f of sources) {
    const src = readFileSync(f, "utf8");
    for (const call of src.match(/buildAthleteModel\([^)]*\)/g) ?? []) {
      expect(call).toMatch(/,/); // two arguments, not one
    }
  }
});
```

Plus a behavioural lifecycle test:

```ts
it("a self-directed ride reads identically through every consumer's resolution", () => {
  // Resolve once, feed both — asserted end-to-end rather than trusted: the same entries + overlays
  // must give the same offPlanPct and sampleSize whichever consumer built the model.
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run lib/athlete-model.test.ts -t "every production call site"
```

- [ ] **Step 3: Thread the store through, one call site at a time**

Each route reads `readIntentOverlays()` alongside its existing `readScoreLog()` (add it to the
existing `Promise.all` where one exists — do not add a serial await) and passes
`overlays.overlays`. In `app/api/sync/route.ts`, the store must be read **after** the ledger is
written, at each of the three sites, so the model sees the same generation of data the response
reports.

- [ ] **Step 4: Run the full check and commit**

```bash
npm run check
```

```bash
git add lib/coach-snapshot.ts lib/season-signals.ts app/api/generate/route.ts app/api/write/route.ts app/api/trends/route.ts app/api/sync/route.ts lib/athlete-model.test.ts
git commit -m "$(cat <<'EOF'
feat(scoring): read intent overlays in every athlete-model consumer

Eight production call sites, all previously ledger-only. One left behind would
answer "was this ride drift" differently from its siblings inside a single
request — the Phase 2a defect shape, and invisible to any single-module test, so
the completeness of the sweep is asserted directly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Close the retrospective decoupling leak

**Files:** `app/api/retrospective/route.ts` + its test file (create if absent)

`decoupList` at [route.ts:122](../../../app/api/retrospective/route.ts) averages `activity.decoupling`
across every block activity with no comparability gate, and the average goes verbatim into the
retrospective LLM prompt. On a block containing mixed climbing days that number is a ride-structure
artifact presented to a model as durability evidence — the same defect Phase 1 fixed at the two
debrief producers, surviving one path over. Locked decision #9: "Decoupling is segment-aware or
absent."

- [ ] **Step 1: Write the failing test** — a block whose activities include one steady endurance ride
  and two high-VI mixed rides yields `avgDecoupling` equal to the steady ride's value alone; a block
  with no qualifying ride yields `null` (not `0`).

- [ ] **Step 2: Apply the gate** — `.filter((a) => isSteadyEnduranceRide(a, athleteProfile.performance.ftp))`
  before the existing `.map`. Confirm `athleteProfile` is already in scope at line 122 (it is used at
  :141); if it is read later, hoist the read rather than adding a second one. Add a comment naming
  INVARIANT 34 and why this is `isSteadyEnduranceRide` (whole-ride comparability) and not
  `qualifyingPwHr` (Z2-segment trustworthiness) — the two answer different questions and INVARIANT 34
  forbids using one to gate the other's consumers.

- [ ] **Step 3: Run the full check and commit**

```bash
npm run check
```

```bash
git add app/api/retrospective/route.ts app/api/retrospective/route.test.ts
git commit -m "$(cat <<'EOF'
fix(retrospective): gate the block decoupling average on ride comparability

The block average went verbatim into the retrospective prompt with no
comparability gate, so a block containing mixed climbing days handed the model a
ride-structure artifact as durability evidence. Phase 1 closed this at both
debrief producers; this was the same gate missing one path over.

isSteadyEnduranceRide, not qualifyingPwHr: this is a whole-ride comparability
question (INVARIANT 34).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Real-data verification, live smoke run, docs

**Files:**
- Create (temporary, never committed): `lib/_verify-p2b.test.ts`
- Modify: `docs/INVARIANTS.md`, `docs/systems/02-scoring-and-learning.md`,
  `docs/systems/07-ai-layer.md`, `docs/FILE_INDEX.md`, `ROADMAP.md`, `FEATURES.md`

**Safety boundary:** read `/Users/otis/Cycling App/data/*.json` with plain `readFileSync`. Never run a
git command in that directory, never `cd` there, never write there.

- [ ] **Step 1: Backward-compatibility and inertness against the real stores**

Write `lib/_verify-p2b.test.ts` asserting, against the athlete's real `score-log.json`,
`last-sync.json` and `intent-overlays.json`:

1. **Inertness of the read path.** With the *current* (still empty, or already-written) overlay store,
   `buildAthleteModel(entries, overlays)` reproduces `buildAthleteModel(entries)` exactly when the
   store is empty. Print `sampleSize`, `overallExecEwma`, `behaviourAllTime.offPlanPct`,
   `driftAvgQuality`.
2. **Queue sanity.** Print `buildIntentQueue(...).length`, how many queued items have empty notes, and
   the date range. **Sanity-check the number by hand before proceeding** — a queue of 150 on a
   182-day window means the primary-ride or ledger-match rule is wrong, not that the athlete writes
   many notes.
3. **Back-compat.** Assert every existing ledger entry still parses, that entries lacking `activityId`
   (the pre-2a rows — expect ~most of the 400) produce no queue item bound to a wrong activity, and
   that a literal pre-2b overlay fixture (no `effectiveWorkoutType` key) is accepted by `isApplicable`.
4. **Primary-ride parity on real data.** For every date with ≥2 rides in the real sync window, assert
   `primaryRideOfDate(...)?.id === ledgerEntry.activityId`. Print the count of such dates; if it is
   zero, say so in the report rather than claiming the check passed on nothing.

```bash
npx vitest run lib/_verify-p2b.test.ts
```

**If any assertion fails, STOP and report.** Do not adjust the test to match.

- [ ] **Step 2: The live smoke run** (AGENTS.md's fourth recurring bug class; INVARIANT 19)

Unit tests prove the scaffolding, never the real call. With `ANTHROPIC_API_KEY` set and the dev server
running:

```bash
npm run dev
```
```bash
curl -sf -X POST http://127.0.0.1:3000/api/intent -H 'content-type: application/json' -d '{"today":"<local YYYY-MM-DD>"}' | head -50
```

Then **read the actual output**, not just the status code. Record in the report:

- how many rides were processed and how many remain;
- for at least one real self-directed ride: the raw note, the parsed `primaryPurpose` and objectives,
  the `confidence`, which objectives were graded and which acknowledged, the `coveredMin`, the final
  `effectiveExecutionScore` or `notScoredReason`, and the `effectiveWorkoutType`;
- the resulting `data/intent-overlays.json` record in full;
- the delta in `data/ai-usage.json` (tokens + cost for the call).

**Judge the output, don't just observe it.** Specifically check: did the model invent any number not
in the note? Did it mark a qualitative objective as measurable? Is the score defensible against the
note a human would read? If the answer to any of those is bad, that is a finding to report — a
syntactically valid response is not a correct one. Re-run against the two acceptance-example rides
(2026-08-05 and 2026-08-06) with `force` if they are still in the sync window; those are the
screenshots the whole design exists to fix, and "no longer 2/10 Poor" is the concrete acceptance bar.

- [ ] **Step 3: Delete the verification script**

```bash
rm lib/_verify-p2b.test.ts && git status --short lib/_verify-p2b.test.ts
```

Expected: no output.

- [ ] **Step 4: Update `docs/INVARIANTS.md`**

Extend the existing `## Ride origin & intent overlays` section (do not renumber 36–40):

```markdown
41. **The deterministic gate decides scoreability; confidence may only downgrade.** `assessScoreability`
    (`lib/intent-scoring.ts`) requires ≥1 grounded, kind-eligible objective and measured coverage of
    `max(INTENT_MIN_COVERED_MIN, INTENT_COVERAGE_MIN × ride minutes)`. `low` confidence vetoes
    unconditionally; `medium` drops the `structure` kind; **no confidence level can make a ride
    scoreable that the gate rejected.** Coverage counts MEASURED minutes, never claimed ones.
42. **The intent parser is shown the note and the ride's duration — nothing else.** No decoupling, no
    scores, no zone data (`lib/intent-prompt.ts`, pinned by test). The tool schema has no field for a
    score, percentage or drift value, so INVARIANT 12 is unexpressible rather than instructed.
43. **A note-less ride is decided without an LLM call.** The empty-note branch precedes client
    construction in `lib/intent-runner.ts`; the empty note's fingerprint is stable so the ride is
    decided exactly once.
44. **Overlay idempotency reads ALL records, not applicable ones.** `needsParse` skips on any
    unsuperseded record for the `(activityId, noteFingerprint)` pair — including `disabled` (a human
    decision) and `pending` (Phase 4's, awaiting review). Supersession and activation happen in one
    `updateIntentOverlays` transaction; the store never holds two unsuperseded records for one activity.
45. **An overlay binds to the date's primary (longest) ride**, selected by `primaryRideOfDate` with the
    identical strict comparison and array order `buildRideScores` uses to stamp `activityId` — including
    the first-wins tie-break. A cross-module test asserts the two agree.
46. **`effectiveWorkoutType` is provenance, not a learning input.** It records the type the athlete
    STATED (never one inferred from IF) and may only accompany `origin: "self-directed"`. Per-type
    learning stays prescribed-only (INVARIANT 40) until the prescribed and self-directed 1–10 scales are
    shown comparable on a real corpus AND compliance gains a meaning for rides that have none.
47. **`INTENT_PROMPT_VERSION` is versioned independently of `PROMPT_VERSION`.** The latter is stamped on
    GeneratedPlan / TodayAnalysis / BlockHistoryEntry; bumping it for an unrelated prompt would assert a
    change to three artifact families that didn't change. INVARIANT 16's requirement is that every AI
    artifact carries *a* model + prompt version, not that one counter serves every prompt.
```

- [ ] **Step 5: Update `docs/systems/02-scoring-and-learning.md`**

Replace the "Phase 2a is infrastructure — nothing is classified `self-directed` yet" rough edge (it is
now false) and extend the section with the honest residue:

- Phase 2b shipped the producer on `<date>`; state the real numbers Step 1 printed.
- **Per-type learning is still prescribed-only** — restate the two unlock conditions from question 3
  verbatim, replacing the old "revisit when 2b supplies an authoritative type" note, which 2b has now
  partly satisfied without satisfying the rest.
- **Non-today zone times come from Intervals' own zone definitions**, not the athlete's physiology
  store (Task 5's recorded caveat), so an individual zone-time grading can differ from what today's
  re-bucketed path would produce.
- **Segment decoupling is deliberately absent**, with the three-point unlock gate from question 8d.
- **`computeRollingBaselines`'s `avgDecoupling90d` remains ungated** — one raw consumer left, with the
  reason (needs a parameter widening plus an ftp thread; descriptive average, no LLM reads it).

- [ ] **Step 6: Update `docs/systems/07-ai-layer.md`, `docs/FILE_INDEX.md`, `ROADMAP.md`, `FEATURES.md`**

- `07-ai-layer.md` — add `parseRideIntent` to the **every LLM call site** list with its model, prompt
  version constant, and degradation behaviour. INVARIANT 31: this doc is linked by slug from COMPASS —
  do not rename the heading.
- `FILE_INDEX.md` — rows for `lib/intent-queue.ts`, `lib/intent-scoring.ts`, `lib/intent-schema.ts`,
  `lib/intent-prompt.ts`, `lib/intent-runner.ts`, and the `app/api/intent` route. Match the existing
  column shape; no line-count column.
- `ROADMAP.md` — update the Phase 2 row: 2b shipped, 2c (debrief UI) and 3/4 remain. 1–2 lines with a
  link out (the file's own discipline). Do not renumber IDs (INVARIANT 26).
- `FEATURES.md` — the user-facing capability: a self-directed ride is now judged against the objective
  the athlete wrote, or explicitly `Not scored`.

**Before committing, verify every pointer this task touched still resolves** (AGENTS.md's fourth
recurring bug class): grep for links to the "Phase 2a is infrastructure" rough-edge text you removed,
and for any `// AI:` comment pointing at a heading you renamed.

- [ ] **Step 7: Run the full check and commit**

```bash
npm run check
```

Confirm `lib/_verify-p2b.test.ts` is gone first — it would fail on any machine without this athlete's
`data/`.

```bash
git add docs/INVARIANTS.md docs/systems/02-scoring-and-learning.md docs/systems/07-ai-layer.md docs/FILE_INDEX.md ROADMAP.md FEATURES.md
git commit -m "$(cat <<'EOF'
docs: record the intent-scoring contracts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Handoff boundary to Phase 2c

**2b ends with data written and read. 2c renders it.** The line is: 2b touches no component under
`components/dashboard/` and adds no user-visible string beyond what already existed.

What 2c consumes, all present after this phase:

- `IntentOverlay.interpretation.intent` — the "**Intent used:** 45 min steady Z2 → variable climbing →
  9 min around 292 W → descending practice" line (design §12.2). Phase ordering is already in
  `phases[]`.
- `IntentOverlay.interpretation.objectives[]` — each carries `kind`, `scored`, `measurable`,
  `evidence`, `coveredMin`, `sourceText`. §12.2's "concise evidence for measurable objectives" and
  "qualitative objectives that were acknowledged but not graded" are a partition of this array on
  `measurable`.
- `IntentOverlay.notScoredReason` — the four distinct `Not scored` messages design §13 enumerates.
  The string wording is 2c's, not 2b's; 2b ships the discriminator only.
- `IntentOverlay.effectiveWorkoutType`, `scoringVersion`, `interpretation.confidence`,
  `interpretation.model` / `promptVersion` — the provenance §11.3 requires on display.
- `resolveEffectiveOutcome(entry, …).overlay` — the single read seam; 2c must not re-implement
  overlay-then-ledger fallback.

What 2c must decide, which 2b deliberately does not:

1. Where the intent block sits relative to the existing score explanation on Today, and what an
   `unspecified` ride shows instead (design §12.2 says "before the score explanation").
2. Whether `TodayAnalysis` gains the resolved overlay or the component resolves it — 2b leaves
   `TodayAnalysis` untouched, so this is an open choice.
3. The `Aerobic drift not measurable — no sufficiently steady aerobic segment` string (§7 step 5) and
   where it renders. The *value* is already correctly `null`; only the wording is missing.
4. Whether the coach-note prompt should be told the intent verdict. **2b does not change
   `buildRideAnalysisPrompt`** — doing so would have changed the coach note in the same PR that
   changed scoring, making a bad note impossible to attribute. It is a clean 2c decision.

What 2c must NOT assume carries over: **re-derive every validity guarantee at each new read site.**
2c will add consumers of `origin`, `status` and `notScoredReason` in components — a layer with no
existing overlay tests. The Phase 2a review's four bugs were all a gate holding where its author was
looking and absent one path over; a rendering path reading `overlay.effectiveExecutionScore` without
re-checking `isApplicable` would display a `pending` Phase 4 draft as the athlete's live score.

---

## Appendix — dispatching this plan to Codex

This plan is written to be executed by an agent that has not seen the conversation that produced it.
Everything an implementer needs is in the task bodies; the prompt below supplies orientation and the
operating rules that live outside the plan file.

**Before starting**, from the primary checkout:

```bash
npm run sync
```
```bash
npm run start:agent-task -- codex adaptive-coach-p2b-intent-scoring
```

That creates an isolated worktree on `codex/adaptive-coach-p2b-intent-scoring` off current
`origin/main`. This plan file and the restored design spec live on the branch
`claude/adaptive-coach-p2b-intent-scoring-plan`, which may not be merged yet — bring them across
first:

```bash
cd .worktrees/codex-adaptive-coach-p2b-intent-scoring
git checkout claude/adaptive-coach-p2b-intent-scoring-plan -- docs/superpowers/plans/2026-08-07-adaptive-coach-p2b-intent-scoring.md docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md
git add docs/superpowers/plans/2026-08-07-adaptive-coach-p2b-intent-scoring.md docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md
git commit -m "docs: bring the Phase 2b plan and design spec onto the implementation branch"
```

(If the plan branch has already merged, skip this — Task 0 is then already done and its steps are a
no-op verification.)

### The prompt

> You are implementing an 8-task plan in an isolated git worktree. Work from
> `/Users/otis/Cycling App/.worktrees/codex-adaptive-coach-p2b-intent-scoring` on branch
> `codex/adaptive-coach-p2b-intent-scoring`. This is not the primary checkout — commit freely here,
> and never run git commands against `/Users/otis/Cycling App` itself.
>
> **Read first, in this order:** `AGENTS.md` (operating law and four recurring bug classes),
> `docs/INVARIANTS.md` (hard contracts, especially 1, 2, 3, 10, 12, 16, 18, 19, 23, 34, 35 and 36–40),
> `docs/systems/02-scoring-and-learning.md` — **its "Known rough edges" section in full**, which
> records four bugs found across three review passes on this exact feature and is the single best
> predictor of how this task fails — then your plan:
> `docs/superpowers/plans/2026-08-07-adaptive-coach-p2b-intent-scoring.md`, and the design basis it
> implements: `docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md` (§2's locked
> decisions are not reopenable, §5, §6, §13 and §14 are the contract).
>
> **Read the plan's preamble in full before Task 1** — "What this phase changes for the athlete",
> "Global constraints", and all eight entries under "The eight questions this plan had to resolve".
> Those eight are the decisions a reviewer will attack first, and each one has a rejected alternative
> that looks more natural than the chosen answer.
>
> **What this builds:** a cycling training app judges every ride against a training block's
> prescription. When no block is active, the athlete still states an objective in the ride's
> Intervals.icu note — and the app currently ignores it, infers a workout type from whole-ride
> intensity, and scores mixed rides 2/10 while also counting them as "drifting off-plan." Earlier
> phases built the origin taxonomy and the overlay store. This phase supplies the producer: parse the
> note into structured objectives with an LLM, decide *deterministically* whether that intent is
> trustworthy and scoreable, score only the measurable objectives the athlete actually stated, and
> write the result as an overlay every consumer of the athlete model reads.
>
> **The rule that matters most:** the LLM's confidence may DOWNGRADE the outcome but may never
> PROMOTE it. The deterministic gate decides scoreability first, on grounded objectives and measured
> coverage. A high-confidence parse can never make a ride scoreable that the gate rejected. If any
> code you write could violate that, it is wrong even if every test passes.
>
> **Execute the tasks in order, one at a time.** Follow TDD as written: write the failing tests, run
> them and confirm they fail for the stated reason, then implement, then confirm green. Run
> `npm run check` (`tsc --noEmit && eslint && vitest run`) before every commit. Commit after every
> task using the exact commit message in that task's final step, staging only the files that task
> names — never `git add -A`.
>
> **Where the plan and reality disagree, stop and report rather than improvising.** Line numbers were
> accurate when written but may have drifted; locate code by content and say so in your report when a
> cited line moved. If a *pre-existing* test breaks in a way the plan did not predict, do not adjust
> its expected value — that would mean the change altered behaviour it must not. Report it.
>
> Specific traps this plan calls out:
> - `needsParse` reads **all** overlays, not `isApplicable` ones. Using `isApplicable` there would
>   re-parse and re-bill every `disabled` and `pending` record on every sync. Four Phase 2a bugs had
>   exactly this shape — a gate correct where its author was looking, absent one path over.
> - `primaryRideOfDate` must use `buildRideScores`'s strict `>` and array order, tie-break included.
> - A note-less ride must be decided **before** the Anthropic client is constructed, not merely
>   skipped by luck of ordering.
> - Supersession and activation are ONE `updateIntentOverlays` call.
> - Coverage counts **measured** minutes, never claimed ones.
> - `POST /api/sync` must remain LLM-free (INVARIANT 23) — no new import that transitively reaches the
>   SDK.
> - `INTENT_PROMPT_VERSION` is a NEW constant. Do **not** bump the shared `PROMPT_VERSION`.
> - Task 8's temporary verification script must be deleted before the final commit and never staged.
> - Test fixtures must avoid `.x5` float boundaries (INVARIANT 30) — a prior plan's detector fixture
>   was bitten by this.
>
> **Task 8's live smoke run is mandatory and is not satisfied by a 200 response.** Read the actual
> model output and judge it: did it invent a number absent from the note? Did it mark a qualitative
> objective measurable? Is the score defensible against the note a human would read? Report the raw
> note, the parsed objectives, the verdict and the token/cost delta.
>
> **Do not run `npm run finish:agent-task`.** Stop after Task 8's commit and report. A Claude review
> gates this branch before it merges (`WORKFLOW.md § Reviewing a codex PR`).
>
> When done, report: which tasks completed, the commit SHAs, `npm run check` output, the real numbers
> Task 8 Step 1 printed, the full live-smoke output and your judgement of it, anything where the plan
> and the code disagreed, and anything you were unsure about.

### After Codex finishes

Ask a Claude session: **"review PR #`<n>`"** — or, if Codex stopped before opening a PR, **"review the
`codex/adaptive-coach-p2b-intent-scoring` branch against its plan."**

The review must specifically re-verify, by simulating the data lifecycle by hand rather than by
reading the test names:

1. every new read of `origin`, `status`, `supersededBy`, `activityId`, `legacy` or
   `effectiveWorkoutType` — including the ones in `components/SyncProvider.tsx` and the new route;
2. that no path exists by which LLM confidence promotes scoreability;
3. that the producer (`buildOverlay`) and the consumer (`isApplicable`) agree on every one of the five
   outcome rows;
4. that a `pending` or `disabled` record is neither re-parsed nor applied;
5. that `POST /api/sync` still reaches no Anthropic call.

A green suite whose fixtures encode the wrong expectation is the failure mode this feature's own
history has now demonstrated three times.
