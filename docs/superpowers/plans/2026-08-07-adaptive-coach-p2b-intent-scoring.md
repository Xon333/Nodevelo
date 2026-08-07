# Adaptive self-directed coach — Phase 2b: intent parsing & self-directed execution scoring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the athlete's activity note into a trustworthy, deterministically-scored execution
verdict, written as a correctly-versioned `active` `IntentOverlay` for rides **on or after a persisted
rollout boundary**, and read by every current `buildAthleteModel` consumer — so a no-block
self-directed ride with valid intent stops counting as drift and starts teaching the athlete model an
honest score, while missing or unreliable intent produces `Not scored` rather than a bad one.

**Architecture:** The LLM does exactly one job — translate free text into a constrained
`StructuredIntent`. Everything that decides *whether* that intent can be trusted, *which* objectives
may be graded, and *what number* comes out is deterministic TypeScript
([DECISIONS](../../DECISIONS.md) ADR-0002, INVARIANT 12). Parsing runs in a new `POST /api/intent`
sibling of `/api/analyze`, driven by a **derivable work queue** so `POST /api/sync` stays LLM-free
(INVARIANT 23) and any newly-synced *or edited* activity is covered, not just today. Overlays are
written through 2a's `updateIntentOverlays`, with supersession and activation in one transaction.

**Tech Stack:** TypeScript 5, Next.js 16 (App Router), Vitest, zod 4 (already a dependency),
`@anthropic-ai/sdk` (already a dependency), Node `crypto` (built-in). No new dependencies. No new
`data/` files — 2a's `intent-overlays.json` is the only store, gaining one field.

---

## What this phase changes, and what it does not

**Phase 2b changes derived state. It does not change the ride debrief.**

Stated precisely, because an earlier draft of this plan got the framing wrong. The per-ride number the
athlete sees on Today comes from `TodayAnalysis.executionScore` and the frozen `score-log.json` row —
neither of which an overlay touches (INVARIANT 1). A ride that reads `2/10 Poor` today will **still
read `2/10 Poor` after this phase ships.** What changes is everything computed *from* the ledger
through `buildAthleteModel`:

| Surface | Changes in 2b? | Why |
|---|---|---|
| Today's ride card score + debrief | **No** | Reads `TodayAnalysis`/ledger directly; 2c renders the resolved overlay |
| `offPlanPct` / drift narrative | **Yes** | `summariseBehaviour` reads effective origin (2a seam) |
| `overallExecEwma`, `overallTrend`, `sampleSize` | **Yes** | Admits self-directed effective scores |
| Insights, generation directives, season signals, athlete state | **Yes** | All downstream of the model |
| Per-type stats, `compliancePct` | **No** | Prescribed-only, INVARIANT 40 (see question 3) |
| Rides before `autoFromDate` | **No** | Phase 4 owns them (see question 0) |

So the honest acceptance bar for 2b is **"the overlay carries a defensible score and the ride stops
counting as drift"** — not "the card no longer says 2/10." That sentence only becomes true in 2c.

**Out of scope, deliberately:** the Phase 2c debrief UI (§12.2 — the "Intent used:" line, the evidence
trail, the `Not scored` rendering), the Phase 4 historical repair (§11) including the entire no-block
period before `autoFromDate`, the Phase 3 TSS envelope and session suggestion (§8/§9), any pre-ride
button, confirmation step or new athlete friction (locked decision #1), and segment-scoped decoupling
(§7 step 2 — see question 8d).

---

## Global constraints

- **The sync route stays LLM-free** (INVARIANT 23). `POST /api/sync` gains no Anthropic call and no
  import that transitively reaches one. Pinned by a static test.
- **The ledger stays append-only and is never rewritten** (INVARIANT 1). An overlay layers over it.
- **Deterministic numbers, LLM phrasing** (INVARIANT 12). The model returns structure only; the tool
  schema makes a score, percentage, compliance figure or drift value unexpressible.
- **LLM confidence may downgrade, never promote** (locked decision #7). The deterministic gate decides
  first; confidence can only shrink the gradable set or veto it.
- **2b never writes for a date Phase 4 owns** (question 0). `autoFromDate` is a hard, persisted floor.
- **A prescribed ride is never touched** (INVARIANT 39, decision #14). The queue never enqueues one.
- **Per-type learning and compliance stay prescribed-only** (INVARIANT 40, question 3).
- **Every new consumer of `origin` / `status` / `supersededBy` / `activityId` / `legacy` re-derives
  the whole record lifecycle for itself.** The Phase 2a review lesson
  ([02-scoring-and-learning § Known rough edges](../../systems/02-scoring-and-learning.md#known-rough-edges)):
  four bugs, one shape — a validity gate correct where its author was looking and silently absent one
  path over. Every task below that reads one of those fields carries a **lifecycle test**.
- **Migration flags use truthy checks, never `=== null`** (INVARIANT 3).
- **All persistence goes through `json-store.ts`** (INVARIANT 2), via `updateIntentOverlays`.
- **"Today" is the athlete's local day** (INVARIANT 10) — `resolveToday()` in the new route.
- **Test fixtures avoid `.x5` float boundaries** (INVARIANT 30).
- Tests are colocated `lib/*.test.ts`, Vitest. **`npm run check` before every commit.** Stage only the
  files the task names — never `git add -A`.

---

## Ground truth measured against the real stores (2026-08-07)

Every number below was read from `/Users/otis/Cycling App/data/` before this plan was written. They
are the reason several decisions differ from what a reasonable guess would have produced.

- **No ledger row carries `activityId`.** All ~400 rows predate Phase 2a and parse back `undefined`.
  Consequence: overlays written by 2b will resolve through `indexOverlaysByDate`, **not**
  `indexOverlaysByActivity`, until fresh rows accumulate. This makes question 9's queue rule load-bearing.
- **169 rides in the sync window, 29 carrying a note.** Note lengths: max **823**, then 483, 477,
  **455**, 431, 355, 321, 274. The 2026-08-06 acceptance note is **455 characters** — the inherited
  400-char prompt cap would truncate it (question 7).
- **The contiguous no-block period is 2026-07-24 → today**, with an earlier partial gap 2026-07-13 →
  07-19. `current-block.json` is null. This whole span is Phase 4's, not 2b's (question 0).
- **`data/intent-overlays.json` does not exist yet.** 2a shipped the accessor with an in-code default;
  no file has been written. Anything reading it must tolerate absence (it already does).
- **`NODEVELO_DATA_DIR` overrides the data directory** at runtime, read fresh on every call
  ([json-store.ts:20](../../../lib/json-store.ts)). This is what makes question 12's safe smoke run
  possible. **The worktree has no `data/` directory at all.**

---

## The questions this plan resolves

### 0. The rollout boundary — `autoFromDate`

**2b may auto-write `active` overlays only for rides dated on or after a persisted `autoFromDate`. It
writes nothing at all — not even `pending` — for earlier dates.**

Phase 4 owns the historical no-block period (design §11, locked decision #10: "every ride in the
three-week no-block period is manually reviewed from an AI-prepared report … AI reduces repetitive
extraction; it does not silently approve history"). Auto-processing that period would be precisely the
silent approval decision #10 forbids, and it would do it to the ~15-day window that most affects the
athlete model. 2b writing `pending` records there is also wrong: Phase 4's preparation includes the
original score, the proposed score, the ambiguities and the exact inclusive dates for approval, none
of which 2b produces.

**Where it lives.** `IntentOverlayStore.autoFromDate?: string | null` — colocated with what it governs,
in the CRITICAL-backed store, so the boundary and the records it produced can never be separated by a
partial restore.

**How it initialises.** On the runner's first execution, if `!store.autoFromDate` (truthy check —
INVARIANT 3; a store written by 2a parses back `undefined`, not `null`), set it to the runner's
`today` and persist it in the same transaction. The default is therefore **"the day 2b first ran"**,
which means no historical ride is ever auto-processed by accident. It is a plain JSON field the
athlete or a later phase can move deliberately; 2b builds no UI for it.

**How it's enforced.** `buildIntentQueue` takes `autoFromDate` and drops every candidate with
`date < autoFromDate`. Enforced in the queue rather than the runner so a `force` request cannot cross
it either — `force` bypasses idempotency, never the boundary. Pinned by a test asserting a `force`d
historical ride yields nothing.

### 1. The deterministic scoreability threshold

Three predicates in `lib/intent-scoring.ts`, applied in order, then confidence.

**(a) Semantic grounding — question 2.** See below; an objective survives only when each of its
fields is supported by an appropriate *unit-bearing* token in the note.

**(b) Kind eligibility by confidence.**

```
GRADABLE_KINDS_BY_CONFIDENCE = {
  high:   ["duration", "zone-time", "zone-emphasis", "effort", "structure"],
  medium: ["duration", "zone-time", "zone-emphasis", "effort"],   // structure dropped
  low:    [],
}
```

`qualitative` is in no list — it is *acknowledged* (`measurable: false, scored: false`) and never
graded (design §6: speed/braking/GPS cannot establish that cornering was good).

**(c) The evidence-scope gate — question 3.** At least one gradable objective must survive (a) and
(b), and the evidence behind the surviving set must speak about enough of the ride:

```ts
export const INTENT_MIN_SCOPE_MIN = 20;    // absolute floor, minutes
export const INTENT_SCOPE_MIN_FRACTION = 0.33;

scoreable  ⇔  gradable.length >= 1
           && evidenceScopeMin >= Math.max(INTENT_MIN_SCOPE_MIN, INTENT_SCOPE_MIN_FRACTION * rideMin)
```

**`evidenceScopeMin` measures how much of the ride the evidence SPEAKS ABOUT, never how much of it
went well.** This is the correction that removes the earlier draft's contradiction. Per kind:

| kind | evidence scope | why |
|---|---|---|
| `duration` | the whole ride | a claim about the ride's total; observing the total observes the ride |
| `zone-time` | the whole ride, **iff** the needed zone array exists | zone arrays are whole-ride aggregates — reading one reads the entire distribution |
| `zone-emphasis` | the whole ride, **iff** the needed zone array exists | same |
| `effort` | the summed duration of the matched laps | genuinely local: a 9-min lap says nothing about the other 109 minutes |
| `structure` | 0 | re-describes objectives already counted |
| ungradable / no data | 0 | missing data is not evidence |

Two consequences, both required by blocker 3 and both pinned by test:

- **A stated target the athlete missed lowers the score; it never causes `Not scored`.** "3 hours of
  Z2" on a 40-minute ride is a `duration` objective with whole-ride scope, so it *passes* the gate and
  scores `40/180 = 22%` → **−2**. The earlier draft asserted both "duration always covers the ride"
  and "3h on 40m fails coverage"; those contradicted, and the second was wrong on the product too —
  turning a clearly-stated missed target into `Not scored` hides a real failure.
- **The gate now does exactly one job:** it stops a whole-ride 1–10 verdict resting only on *local*
  evidence. A note whose only gradable content is "9 min at 292 W" on a 118-minute ride yields scope 9
  < `max(20, 39)` → `no-measurable-objectives`. That is the case the gate exists for, and now the only one.

**Confidence is one-way.** `low` ⇒ `intent-unreliable`, unconditionally. `medium` ⇒ run (a)–(c) with
the smaller kind list. `high` ⇒ run (a)–(c) unchanged. **No confidence level can make a ride scoreable
that the gate rejected.** Pinned by a monotonicity test across all three levels for every fixture, not
by per-level examples — the inverse bug is invisible to those.

### 2. Semantic, field-specific grounding

Number-presence grounding was wrong and would have manufactured exactly the invented specificity
design §5.2 forbids: in `"some Z4 and Z5 efforts"`, a naive scan finds `4` and `5` and would ground
`reps: 4` and `durationMin: 5`.

**Mechanism.** Before any numeric scan, **mask every zone token out of the note**:

```
ZONE_TOKEN = /\b(?:z|zone\s*)([1-7])\b/gi        // "z4", "Z4", "zone 4", "zone4"
maskedNote = normalizedNote.replace(ZONE_TOKEN, "   ")
```

Zone objectives are grounded against the *unmasked* note; every other field is grounded against the
*masked* one, so a digit that is part of a zone label can never ground a duration, a wattage or a rep
count. Then each field requires its own unit-bearing form:

| field | grounded by (case-insensitive, on the masked note) | never by |
|---|---|---|
| `durationMin: N` | `N min`, `N mins`, `N minute(s)`, `Nmin`, `N'`, `N:SS`; or `H h`/`H hr`/`H hour(s)`/`H:MM` converted to minutes and compared with ±1 min tolerance | a bare `N`; `zN`; `N W`; `N x` |
| `watts: W` | `W w`, `W watt(s)`, `Ww`, `W W`; or `W%` of FTP converted against the ride's `ftpUsed` | a bare `W`; `zW`; `W min` |
| `reps: R` | `R x`, `R×`, `Rx`, `R reps`, `R sets`, `R rounds`, or `R` immediately preceding an `×`/`x` token | a bare `R`; `zR` |
| `zone: "ZN"` | `zN`, `zone N`, or an explicit zone word (`recovery`, `endurance`, `tempo`, `threshold`, `vo2`, `sweet spot`) mapped to its zone | a bare `N` |

Ranges (`"40–50 min"`, `"290-300 W"`) ground a target falling inside the range. Approximation words
(`~`, `about`, `around`, `roughly`) do not weaken grounding — they weaken nothing measurable.

**The deterministic check is authoritative and one-way.** The model returns `grounded` and
`sourceText`; `verifyGrounding` recomputes it and may only lower the flag, never raise it. A model
claiming `grounded: true` for an unsupported field is overridden; a model admitting `false` is
believed.

**Required tests** (each an assertion, not an example):
- `"some Z4 and Z5 efforts"` grounds `zone: Z4` and `zone: Z5` and **nothing else** — explicitly not
  `reps: 4`, not `durationMin: 5`, not `watts: 4`;
- `"45 min steady Z2"` grounds `durationMin: 45` and `zone: Z2`, not `watts: 45`;
- `"9 min around 292 W"` grounds `durationMin: 9` and `watts: 292`;
- `"4 x 5 min at 300w"` grounds `reps: 4`, `durationMin: 5`, `watts: 300`;
- `"1.5 h endurance"` grounds `durationMin: 90` (±1) and `zone: Z2`;
- a model-claimed `grounded: true` on an unsupported field is overridden to `false`.

### 3. `effectiveWorkoutType` — add it, keep per-type learning prescribed-only

**Add the field. Do not admit self-directed rides into per-type statistics in 2b.**

`intentWorkoutType(intent)` derives it from the *stated* purpose and zones — never from IF, the
circularity INVARIANTS 35/40 exist to prevent. It is genuinely authoritative in a way
`inferWorkoutType` never was: the athlete said what the session was for.

It is nevertheless **provenance only** in 2b, and INVARIANT 40 stands. Two independent unlock
conditions, both of which a later phase must clear:

1. **The two score populations are not yet known to be comparable.** A prescribed score comes from
   adherence / duration-compliance / IF-band axes; a self-directed score from objective-grading axes
   (Task 3). Pooling them asserts the two scales mean the same thing on one 1–10 ruler. Nothing has
   measured that — the overlay store is empty as this is written. That needs a real corpus.
2. **Compliance still has no meaning for these rides** (decision #7). `complianceEwma`'s
   `comps.length ? … : 0` fallback would report 0% for a group with no compliance concept — the exact
   defect the 2a review caught.

Task 6 leaves `buildAthleteModel`'s per-type filter untouched; Task 8 records the unlock condition
beside INVARIANT 40's existing revisit note.

### 4. Where parsing runs, with sync still LLM-free

**A new `POST /api/intent`, a sibling of `/api/analyze`, driven by a derivable queue.**

Rejected: *inside `POST /api/sync`* (violates INVARIANT 23); *widening `/api/analyze`* (`addCoachNote`
early-returns unless `analysis.activityDate === today`
[sync-analysis.ts:42](../../../lib/sync-analysis.ts), while decision #12 needs any newly-synced or
edited activity — and fusing them would take today's coach note down with a failed parse of a 12-day-old
ride); *a background worker* (no such runtime exists in this local-first app).

The queue is **derivable, not persisted** — `buildIntentQueue` recomputes it from `readLastSync()` +
`readScoreLog()` + `readIntentOverlays()`, which makes idempotency free. An activity is enqueued iff:

1. it is a `Ride` / `VirtualRide` with `date <= today` **and `date >= autoFromDate`** (question 0);
2. a ledger entry exists for its date with `planned === false`;
3. it is `primaryRideOfDate(...)`, **and the ledger row agrees** (question 9);
4. `needsParse(activityId, fingerprint, overlays)` (question 5).

`/api/intent` processes at most `INTENT_MAX_PER_RUN = 5` per invocation, newest first, returning
`{ processed, remaining, stalled, warnings }`. `SyncProvider` calls it in the same deferred step that
already calls `/api/analyze`, looping while `remaining > 0 && !stalled` up to 6 rounds. **No new
button, no new athlete-facing control** (locked decision #1).

### 5. Fingerprinting, idempotency, retry, atomic supersession

**Fingerprint.** `noteFingerprint(description)` = first 16 hex of `sha256(normalize(description))`,
`normalize = (d ?? "").trim().replace(/\s+/g, " ")`. Node `crypto.createHash`, no dependency.
Whitespace-only and absent notes normalize to `""` and share one stable fingerprint — which is what
makes "no note" idempotent rather than a permanent re-queue.

**Idempotency — the lifecycle rule.** The skip test reads **all** overlays, not the applicable ones:

```ts
needsParse(activityId, fp, overlays) =
  !overlays.some(o => o.activityId === activityId && o.noteFingerprint === fp && o.supersededBy === null);
```

| existing record for `(activityId, fingerprint)` | re-parse? | why |
|---|---|---|
| `active`, not superseded | no | already done |
| `disabled`, not superseded | **no** | a human turned it off; re-parsing would resurrect it |
| `pending`, not superseded | **no** | Phase 4 prepared it; re-parsing would race the reviewer |
| any status, `supersededBy !== null` | yes | it interpreted a note that no longer exists |
| none | yes | never parsed |

Using `isApplicable` here — the natural-looking choice, and the shape of all four Phase 2a bugs —
would re-parse and re-bill every `disabled` and `pending` record on every sync and resurrect
deliberate human decisions.

**Retry semantics — question 10.** The critical distinction is between an outcome the model produced
and a call that never completed:

| what happened | writes an overlay? | queue effect | reason recorded |
|---|---|---|---|
| note is empty | yes, **with no LLM call** | dequeued permanently | `no-intent-found` |
| Anthropic not configured | **no** | stays queued | — |
| `parseRideIntent` **throws** (network, timeout, 429, 5xx) | **no** | **stays queued** | — |
| call completed, no usable tool output (`null`) | yes | dequeued | `interpreter-failed` |
| parsed, `confidence: "low"` | yes | dequeued | `intent-unreliable` |
| parsed, gate found nothing gradable / scope too small | yes | dequeued | `no-measurable-objectives` |
| parsed and scoreable | yes | dequeued | — (a score) |

**A transient exception must never burn the fingerprint.** Writing `interpreter-failed` on a network
blip would permanently skip a non-today ride: the fingerprint is then matched by an unsuperseded
record, `needsParse` returns false forever, and `force` only ever targets *today's* ride (question 11)
— so a 12-day-old ride with a perfectly good note would be silently lost with no path back except
hand-editing JSON. Leaving it queued costs one retry on the next sync and nothing else.

**Zero-progress stop.** The route reports `stalled: processed === 0 && remaining > 0`. The client
stops looping on `stalled`, so a persistent outage produces one failed round per sync, not six.

**Atomic supersession.** One `updateIntentOverlays` call does both halves:

```ts
await updateIntentOverlays((existing) => [
  ...existing.map((o) =>
    o.activityId === activityId && o.supersededBy === null ? { ...o, supersededBy: next.id } : o
  ),
  next,
]);
```

Every unsuperseded record for the activity is superseded regardless of status — the note it
interpreted is gone. `updateJson` reads inside the lock (INVARIANT 2). Pinned by an invariant
assertion after every write: `overlays.filter(o => o.activityId === X && !o.supersededBy).length <= 1`.

### 6. Objective canonicalisation — the LLM must not control the score by how it splits

An unbounded per-objective delta sum lets the model's *decomposition choice* move the score: emitting
`"45 min Z2"` once versus three times, or splitting it into `"20 min Z2"` + `"25 min Z2"`, would
produce three different numbers for one intent. That is the model computing a number by the back door
(INVARIANT 12).

**Canonicalisation, before any grading:**

| kind | canonical key | merge rule |
|---|---|---|
| `duration` | `("duration")` | at most one; take the **max** stated target (they are claims about one total) |
| `zone-time` | `("zone-time", zone)` | **sum** the targets for that zone — a split phase list states parts of one total |
| `zone-emphasis` | `("zone-emphasis", zone)` | dedupe; **dropped entirely if a `zone-time` exists for the same zone** (subsumed by the stronger claim) |
| `effort` | `("effort", durationMin, watts, zone)` after rounding duration to the minute and watts to 5 W | dedupe; `reps` fields are **summed** across merged duplicates |
| `structure` | `("structure")` | at most one |
| `qualitative` | `("qualitative", description)` | dedupe; never graded |

**Bounded aggregation:** grade each canonical objective once, then sum **one contribution per kind**,
each clamped to that kind's band, then clamp the total to 1–10. Within a kind that can hold several
canonical entries (`zone-time` across different zones, `effort` across different targets), the kind's
contribution is the **mean** of its members' deltas, rounded, then clamped. So adding a third zone
objective cannot triple a bonus.

**Required invariance test:**

```ts
it("scores identically however the model splits or duplicates one intent", () => {
  const single    = [obj("zone-time", { zone: "Z2", durationMin: 45 })];
  const duplicate = [single[0], { ...single[0] }, { ...single[0], description: "steady Z2 block" }];
  const split     = [obj("zone-time", { zone: "Z2", durationMin: 20 }), obj("zone-time", { zone: "Z2", durationMin: 25 })];
  const reordered = [...split].reverse();
  const ev = evidence({ durationMin: 90, z2Min: 44 });
  const base = scoreIntentExecution(interp({ objectives: single }), ev).score;
  for (const variant of [duplicate, split, reordered]) {
    expect(scoreIntentExecution(interp({ objectives: variant }), ev).score).toBe(base);
  }
});
```

Grounding runs **before** canonicalisation (a merged target must not inherit grounding from a
different objective's note substring), and the merged target is re-grounded against the note as a
whole after merging — with the merge accepted only when the summed target is itself grounded or when
every merged part was individually grounded. State this explicitly in the module comment; it is the
one place merging could smuggle an ungrounded number through.

### 7. Effort grading — every combination defined

Laps come from `fetchIntervals(activityId)` → `ExecutedInterval[]` (`durationSec`, `avgWatts`,
`npWatts`, `avgHr`, `type`). Matching is deterministic: candidate laps are those whose duration is
within **±20%** of the target; efforts are matched **longest target first**, and a lap once matched is
**consumed** so two efforts cannot both claim it.

| combination | graded? | rule | scope |
|---|---|---|---|
| duration + watts | ✅ | best-watt matching lap; `avgWatts / targetWatts` on `computeExecutionScore`'s non-SIT adherence band (95–106 → +2, 90–94/107–112 → +1, 85–89 → 0, 80–84 → −1, else −2) | matched lap duration |
| duration only | ✅ presence | a matching lap exists → **+1**; none → **−1** | matched lap duration (0 if none) |
| watts only, no duration | ❌ | no window over which to evaluate; `measurable: true, scored: false, evidence: "no duration stated for this effort"` | 0 |
| zone only ("some Z4 efforts") | — | not an `effort`; canonicalised to `zone-emphasis` for that zone | via that kind |
| reps `N` + duration + watts | ✅ | require ≥ `Math.ceil(0.75 * N)` matching laps; grade the **mean** `avgWatts / targetWatts` across matched laps on the same band; short of the threshold → **−1** and no watt grading | sum of matched lap durations |
| reps `N` + duration only | ✅ presence | matched laps ≥ `ceil(0.75 * N)` → **+1**; else **−1** | sum of matched lap durations |
| reps `N` + watts only | ❌ | same reason as watts-only | 0 |
| no lap data at all (`fetchIntervals` failed or returned `[]`) | ❌ | `measurable: true, scored: false, evidence: "no interval data"`, **no delta** | 0 |

Missing data is never a failed metric (design §13): every ❌ row contributes no delta and no scope.
An ungradable effort is still returned in `objectives[]` so 2c can show it was acknowledged.

### 8. Zone evidence — units, arrays, and the honest dependency

**Units.** `powerZoneTimes` and `hrZoneTimes` are **seconds** per zone, index 0 = zone 1
([intervals-api.ts:253](../../../lib/intervals-api.ts) — `icu_power_zone_times ?? icu_zone_times`,
`icu_hr_zone_times`). Convert with `round1(seconds / 60)`; never round the seconds first. `"Z2"` →
index 1. An array that is `null`, shorter than the requested index + 1, or sums to 0 yields **no
evidence** (ungradable, no delta, no scope) rather than a zero reading.

**Which array.** Following `computeExecutionScore`'s established easy-ride precedent (HR is the
terrain-immune judge; outdoor Z2 *power* is unholdable):

- aerobic zones (Z1, Z2, and the `recovery`/`endurance` words): prefer `hrZoneTimes`, fall back to `powerZoneTimes`;
- Z3 and above: prefer `powerZoneTimes`, fall back to `hrZoneTimes`.

Which array was used is recorded in the objective's `evidence` string, so a later reader never has to
guess. Indoor rides (`VirtualRide`) use power for every zone — ERG holds power flat and HR drifts, the
inverse of the outdoor argument.

**`zone-emphasis` grading** uses the measured share of total zone-array time in the named zone:
≥60% → +2 · ≥45% → +1 · ≥30% → 0 · else −1.

**No union of covered minutes — question 4 corrected.** Zone arrays are whole-ride aggregates with no
timestamps, and `ExecutedInterval.startIndex`/`endIndex` are stream *indices* whose sample interval is
not stated by the API. There is therefore no sound way to compute the union of the ride-time two
objectives jointly cover. The rule is **maximum evidence scope**, not union:

```ts
evidenceScopeMin = Math.max(...gradable.map(scopeOf), 0)
```

A conservative lower bound on true coverage, computable from what actually exists.

**The honest zone dependency — question 8 corrected.** The earlier draft claimed Intervals' zone
definitions "bias individual gradings, never the scoreable decision." Under *that* draft's
minutes-based coverage, that was false: zone minutes fed coverage, so a boundary shift could flip
scoreable/not. Under the evidence-scope rule above it is no longer minutes-based — a zone objective's
scope is the whole ride whenever the array *exists*. The honest statement is therefore:

- **Zone boundary definitions affect the zone objective's grade**, and for non-today rides those
  boundaries are Intervals.icu's own, not the athlete's physiology store — unlike today's ride, which
  `/api/sync` re-buckets from raw streams. The two can disagree at zone edges.
- **Zone-array presence/absence affects scoreability.** A ride with no zone data whose only gradable
  objectives are zone objectives has scope 0 and is `no-measurable-objectives`. That is a real,
  intended dependency, not a bias.
- **Boundary definitions cannot flip scoreability**, because scope is presence-based rather than
  minutes-based. This is now true by construction, and is asserted by a test that perturbs a fixture's
  zone distribution across boundaries and checks `scoreable` is invariant while the score moves.

Both facts go in the systems doc. 2b accepts Intervals' buckets rather than fetching and re-bucketing
every historical stream (a per-ride stream fetch across a backlog is a materially larger change).

### 9. Queue-to-ledger binding on multi-ride dates

`primaryRideOfDate(activities, date)` selects the **longest** ride using the identical strict `>`
comparison and array order `buildRideScores` uses when it stamps `activityId`
([score-log.ts:334-336](../../../lib/score-log.ts)) — first-wins on an exact tie. A cross-module test
asserts `primaryRideOfDate(...).id === buildRideScores(...)[0].activityId` on both a two-ride and a
tied-duration fixture.

**Date matching alone is insufficient, and the queue must say so.** For each candidate:

```ts
const primary = primaryRideOfDate(activities, entry.date);
if (!primary) continue;
if (entry.activityId && entry.activityId !== primary.id) {
  // The ledger scored a DIFFERENT ride than the current activity set calls primary. Binding an
  // overlay to `primary` would attach it to a row the resolver will never match: 2a's
  // resolveEffectiveOutcome uses the ACTIVITY index for a row that has an id and never falls back to
  // the date index for it, so the overlay would resolve against nothing — silently, from both sides.
  warnings.push(`intent: ledger/primary mismatch on ${entry.date}`);
  continue;                              // skip and report; never guess
}
```

For a row with **no** `activityId` — which is *every row in the real ledger today* — the overlay
binds to `primary.id` and `entry.date`, and resolution goes through `indexOverlaysByDate`. That index
is not primary-ride-aware, so what makes the date path safe is the queue's own guarantee that **only
the primary ride is ever enqueued for a date**, hence at most one active overlay per date. Pinned by a
test that writes an overlay for a two-ride legacy date and asserts it resolves onto the ledger row
whose duration matches the primary ride.

### 10. `force` — a boolean contract, resolved server-side

`SyncProvider` already has `force: boolean` and has no activity id to send. The route contract is
therefore `{ today?: string, force?: boolean }`, and **the server derives the target itself**:
`primaryRideOfDate(activities, resolveToday(body.today))`. `force` bypasses `needsParse` for that one
id only. It never bypasses the prescribed rule, the primary-ride rule, or `autoFromDate` — those are
correctness, not caching. No activity id crosses the wire, and the client keeps its existing signature.

### 11. Prompt cap

`INTENT_NOTE_MAX_CHARS = 2000` — a dedicated constant, **not** `buildRideAnalysisPrompt`'s inherited
400-char slice, which would truncate the 455-character 2026-08-06 acceptance note and the 823-character
longest note in the corpus. Truncation beyond 2000 appends an explicit `… [note truncated]` marker so
the model knows it is seeing a fragment rather than silently interpreting a partial note. Tests assert
the literal 455-char acceptance note and an 823-char note reach the prompt intact.

### 12. Mixed rides, whole-ride decoupling, the segment deferral

**(a) The intent path never sees whole-ride decoupling.** The parse prompt receives the note and the
ride's duration — nothing else. Two tests: the built prompt contains no decoupling/IF/TSS/score
figures, and `lib/intent-scoring.ts` contains no reference to `decoupling`. This is both the
anti-contamination rule and the mechanism keeping the model from computing a number — it cannot report
a drift verdict it was never shown.

**(b) The already-closed paths stay closed.** Phase 1 gated whole-ride decoupling behind
`isSteadyEnduranceRide` at both debrief producers ([ride-analysis.ts:242](../../../lib/ride-analysis.ts),
[anthropic-prompts.ts:535](../../../lib/anthropic-prompts.ts)). 2b adds nothing there and must not
loosen them.

**(c) One remaining LLM-facing leak is closed here (Task 7).**
[app/api/retrospective/route.ts:122](../../../app/api/retrospective/route.ts) averages
`activity.decoupling` across all block activities with no comparability gate and feeds the result
verbatim into the retrospective prompt — a raw mixed-ride number handed to a model as evidence, the
same defect shape one path over. `lib/readiness.ts`'s `computeRollingBaselines` is **deliberately
left**: it needs a parameter widening plus an ftp thread from three call sites, it is a descriptive
90-day average rather than a per-ride aerobic-failure claim, and no LLM reads it. Recorded as a named
follow-up, not silently dropped.

**(d) Segment decoupling stays absent.** Design §7 step 2 is not implemented; a ride that doesn't
qualify whole-ride renders `Aerobic drift not measurable` (§7 step 5 — already current behaviour). The
unlock gate, to be cleared with real data first:

1. measure the actual sample rate of `fetchActivityStream` output across ≥20 real activities (the
   endpoint returns one array with no timestamps — the per-sample interval is assumed, not stated);
2. characterise dropout: gaps as absent samples vs. zero-fill (a zero-filled gap inside a candidate
   window depresses the second half and manufactures drift);
3. show on real data that a 30-minute window's half-split reproduces under (1) and (2) from a
   re-fetched stream.

---

## File structure

| File | Change | Responsibility after this plan |
|---|---|---|
| `docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md` | **Restore** | The approved design basis, durable on `main`; status stamp only |
| `lib/types.ts` | Modify | `ObjectiveKind`; `ScoredObjective` gains `kind`/`grounded`/`sourceText`/`target`/`scopeMin`; `StructuredIntent.phases[].kind`; `IntentOverlay.effectiveWorkoutType`; `IntentOverlayStore.autoFromDate` |
| `lib/intent-overlay.ts` | Modify | `isCoherent` gains the `effectiveWorkoutType` rule |
| `lib/intent-overlay.test.ts` | Modify | Coherence + lifecycle for the new field |
| `lib/data-store.ts` | Modify | `updateIntentOverlays` gains a store-level mutator variant so `autoFromDate` can be set in the same transaction |
| `lib/intent-queue.ts` | **Create** | Pure: `normalizeNote`, `noteFingerprint`, `primaryRideOfDate`, `needsParse`, `buildIntentQueue` |
| `lib/intent-queue.test.ts` | **Create** | Queue rules, `autoFromDate` floor, ledger/primary binding, the full status lifecycle |
| `lib/intent-grounding.ts` | **Create** | Pure: zone masking + the four field matchers + `verifyGrounding` |
| `lib/intent-grounding.test.ts` | **Create** | The `Z4`/`Z5` case and every field form |
| `lib/intent-scoring.ts` | **Create** | Pure: canonicalisation, graders, scope, `assessScoreability`, `scoreIntentExecution`, `intentWorkoutType`, `buildOverlay` |
| `lib/intent-scoring.test.ts` | **Create** | Gate, one-way confidence, decomposition invariance, every effort combination, acceptance examples |
| `lib/intent-schema.ts` | **Create** | zod schema + `INTENT_TOOL` + `parseIntentToolOutput` |
| `lib/intent-schema.test.ts` | **Create** | Schema rejects unexpressible fields and malformed output |
| `lib/intent-prompt.ts` | **Create** | Pure `buildIntentPrompt` + `INTENT_PROMPT_VERSION` + `INTENT_NOTE_MAX_CHARS` |
| `lib/intent-prompt.test.ts` | **Create** | Real 455/823-char notes reach the parser; no ride metrics leak in |
| `lib/anthropic-api.ts` | Modify | `parseRideIntent()` — the thin SDK shell (RV-8 split convention) |
| `lib/ai-usage.test.ts` | Modify | Every model id used by a call site is priced (INVARIANT 18) |
| `lib/intent-runner.ts` | **Create** | Impure orchestrator: boundary init, decide, parse or not, write atomically |
| `lib/intent-runner.test.ts` | **Create** | Missing-note short-circuit, transient-vs-terminal failure, atomic supersession, `force`, `autoFromDate` |
| `app/api/intent/route.ts` | **Create** | `POST` — `resolveToday`, boolean `force`, bounded batch, `stalled` |
| `components/SyncProvider.tsx` | Modify | Deferred intent step alongside `/api/analyze`; stop on `stalled` |
| `lib/coach-snapshot.ts`, `lib/season-signals.ts`, `app/api/generate/route.ts`, `app/api/write/route.ts`, `app/api/trends/route.ts`, `app/api/sync/route.ts` (×3) | Modify | Thread the overlay store into `buildAthleteModel` |
| `app/api/retrospective/route.ts` | Modify | Gate the block decoupling average on `isSteadyEnduranceRide` |
| `docs/INVARIANTS.md`, `docs/systems/02-scoring-and-learning.md`, `docs/systems/07-ai-layer.md`, `docs/FILE_INDEX.md`, `ROADMAP.md`, `FEATURES.md` | Modify | Record the contracts |

---

## Task list

| # | Task | Commit |
|---|---|---|
| 0 | Restore the approved design spec + this plan | `docs: restore the approved adaptive-coach design scope` ✅ |
| 1 | Overlay schema: kinds, `effectiveWorkoutType`, `autoFromDate` | `feat(scoring): extend the intent-overlay schema` |
| 2 | Semantic grounding (pure) | `feat(scoring): ground intent fields semantically, not by digit` |
| 3 | Fingerprinting + the derivable parse queue | `feat(scoring): derive the intent-parse queue` |
| 4 | Canonicalisation, grading, the evidence-scope gate | `feat(scoring): score self-directed intent deterministically` |
| 5 | The LLM seam: schema, prompt, call, pricing | `feat(ai): parse activity-note intent into structured objectives` |
| 6 | The runner + `POST /api/intent` + client wiring | `feat(api): run intent parsing outside the LLM-free sync` |
| 7 | Thread overlays into every `buildAthleteModel` consumer | `feat(scoring): read intent overlays in every athlete-model consumer` |
| 8 | Close the retrospective decoupling leak | `fix(retrospective): gate the block decoupling average` |
| 9 | Sandboxed real-data verification, live smoke run, docs | `docs: record the intent-scoring contracts` |

Tasks 2, 3 and 5 are independent given Task 1's types. Task 4 depends on 2. Task 6 depends on 3–5.
Task 7 depends on 1. Tasks 8–9 depend on everything.

---

### Task 1: Overlay schema — kinds, `effectiveWorkoutType`, `autoFromDate`

**Files:** modify `lib/types.ts`, `lib/intent-overlay.ts`, `lib/intent-overlay.test.ts`, `lib/data-store.ts`

**Produces:**
- `export type ObjectiveKind = "duration" | "zone-time" | "zone-emphasis" | "effort" | "structure" | "qualitative"`
- `ScoredObjective` gains `kind`, `target`, `grounded`, `sourceText`, `scopeMin`
- `StructuredIntent.phases[]` gains `kind: ObjectiveKind`
- `IntentOverlay.effectiveWorkoutType?: WorkoutType | null`
- `IntentOverlayStore.autoFromDate?: string | null`
- `updateIntentOverlayStore(mutate: (store) => store)` in `data-store.ts` — the store-level transaction
  the runner needs so `autoFromDate` initialisation and the first overlay write are one atomic write.
  Keep the existing `updateIntentOverlays(mutate)` array-level helper; implement it in terms of the new
  one so there is one write path, not two.

**Coherence rule added to `isCoherent`:**

```ts
  // An authoritative workout type may only accompany a recovered intent. `unspecified` means no
  // trustworthy intent existed, so a type asserted alongside it was derived from nothing — and a
  // future per-type consumer reading the field through a different path would inherit it silently.
  // Truthy check, not `!== null`: a record written before this field existed parses back `undefined`
  // (INVARIANT 3), and rejecting those would break every historical overlay Phase 4 must read.
  if (overlay.effectiveWorkoutType && overlay.origin !== "self-directed") return false;
```

- [ ] **Step 1: Failing tests** in `lib/intent-overlay.test.ts` — accepts a type on a self-directed
  overlay; **rejects** one on an `unspecified` overlay; accepts `no-measurable-objectives` +
  self-directed + `null` type; and accepts a record with the key **deleted** (INVARIANT 3 — use
  `delete (record as Partial<IntentOverlay>).effectiveWorkoutType`, not `= null`).
- [ ] **Step 2:** `npx vitest run lib/intent-overlay.test.ts -t "effectiveWorkoutType"` → FAIL.
- [ ] **Step 3:** Add the types. `ScoredObjective.scopeMin: number | null` is documented as *evidence
  scope* — "how much of the ride this objective's evidence speaks about, filled by the scorer, never by
  the model; NOT how much of it went well" — so the blocker-3 correction is visible at the type.
- [ ] **Step 4:** Add the coherence rule and `updateIntentOverlayStore`.
- [ ] **Step 5:** `npx vitest run lib/intent-overlay.test.ts && npm run check`. `ScoredObjective`'s new
  required fields break 2a's literal fixtures — extend them; **do not change an existing expected value.**
- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/intent-overlay.ts lib/intent-overlay.test.ts lib/data-store.ts
git commit -m "$(cat <<'EOF'
feat(scoring): extend the intent-overlay schema for Phase 2b

Objectives carry their kind, their grounding provenance and their EVIDENCE SCOPE
— how much of the ride the evidence speaks about, not how much of it went well.

effectiveWorkoutType records the type the athlete STATED, never one inferred from
IF, and stays provenance only: per-type learning remains prescribed-only
(INVARIANT 40). autoFromDate is the persisted rollout floor that keeps Phase 2b
out of the historical no-block period Phase 4 owns. Both are guarded truthily so a
record predating them still reads.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Semantic, field-specific grounding

**Files:** create `lib/intent-grounding.ts`, `lib/intent-grounding.test.ts`

**Produces:** `maskZoneTokens(note)`, `groundsDuration(note, min)`, `groundsWatts(note, w, ftp)`,
`groundsReps(note, n)`, `groundsZone(note, zone)`, `verifyGrounding(objective, note, ftp): boolean`.

Implement question 2 exactly. Pure, no I/O.

- [ ] **Step 1: Failing tests** — every row of question 2's table, plus:

```ts
it("a digit inside a zone token grounds NOTHING else — the invented-specificity case", () => {
  const note = "some Z4 and Z5 efforts";
  expect(groundsZone(note, "Z4")).toBe(true);
  expect(groundsZone(note, "Z5")).toBe(true);
  expect(groundsReps(note, 4)).toBe(false);       // "4" is part of Z4
  expect(groundsDuration(note, 5)).toBe(false);   // "5" is part of Z5
  expect(groundsWatts(note, 4, 288)).toBe(false);
});

it("verifyGrounding may only LOWER the model's claim", () => {
  const claimed = { grounded: true, kind: "effort", target: { reps: 4 }, sourceText: "some Z4 efforts" };
  expect(verifyGrounding(claimed, "some Z4 efforts", 288)).toBe(false);
  const honest = { ...claimed, grounded: false, target: { durationMin: 9, watts: 292 } };
  expect(verifyGrounding(honest, "9 min around 292 W", 288)).toBe(false); // false stays false
});
```

- [ ] **Step 2:** run → FAIL (`Failed to resolve import "./intent-grounding"`).
- [ ] **Step 3:** Implement. Module header states the masking mechanism and why it exists.
- [ ] **Step 4:** `npx vitest run lib/intent-grounding.test.ts && npm run check`.
- [ ] **Step 5: Commit** — `feat(scoring): ground intent fields semantically, not by digit`, body
  naming the `Z4`→`reps: 4` failure the mask prevents.

---

### Task 3: Fingerprinting and the derivable parse queue

**Files:** create `lib/intent-queue.ts`, `lib/intent-queue.test.ts`

**Produces:** `normalizeNote`, `noteFingerprint`, `primaryRideOfDate`, `needsParse`,
`buildIntentQueue(activities, entries, overlays, today, autoFromDate, opts?)`,
`IntentQueueItem { activityId, date, note, fingerprint, durationMin }`, `INTENT_MAX_PER_RUN = 5`.

Implement questions 5, 9 and 0's floor. `buildIntentQueue` does **not** slice to
`INTENT_MAX_PER_RUN` — the runner does, so `remaining` stays an honest count.

- [ ] **Step 1: Failing tests.** Required, beyond the obvious happy paths:

```ts
describe("autoFromDate — Phase 4's period is untouchable", () => {
  it("drops every candidate before the boundary", () => {
    const q = buildIntentQueue(acts, entries, [], "2026-08-07", "2026-08-07");
    expect(q.map((i) => i.date)).toEqual(["2026-08-07"]); // 08-05, 08-06 are Phase 4's
  });
  it("drops them even under force — force bypasses idempotency, never the boundary", () => {
    const q = buildIntentQueue(acts, entries, [], "2026-08-07", "2026-08-07", { force: ["a-0805"] });
    expect(q.find((i) => i.activityId === "a-0805")).toBeUndefined();
  });
  it("includes a ride exactly ON the boundary", () => { /* >= not > */ });
});

describe("ledger/primary binding (question 9)", () => {
  it("skips a date where the ledger scored a different ride than primaryRideOfDate", () => {
    // The resolver uses the ACTIVITY index for a row that has an id and never falls back to the date
    // index for it, so an overlay bound to the wrong ride resolves against nothing — silently, from
    // both sides. Skip and warn; never guess.
    const entries = [ledger({ date: "2026-01-05", planned: false, activityId: "short" })];
    const acts = [activity({ date: "2026-01-05", id: "short", movingTimeSec: 1800, description: "x" }),
                  activity({ date: "2026-01-05", id: "long",  movingTimeSec: 5400, description: "x" })];
    expect(buildIntentQueue(acts, entries, [], "2026-01-10", "2026-01-01")).toEqual([]);
  });
  it("allows a pre-2a row with NO activityId and binds to the primary ride", () => {
    // Every row in the real ledger today is this case.
    const entries = [ledger({ date: "2026-01-05", planned: false })]; // activityId absent
    expect(buildIntentQueue(acts, entries, [], "2026-01-10", "2026-01-01").map((i) => i.activityId)).toEqual(["long"]);
  });
});

describe("needsParse — lifecycle walk", () => {
  it("decides correctly across absent → active → edited → superseded → disabled", () => { /* … */ });
  it("does NOT re-parse a disabled or a pending record", () => { /* … */ });
});

describe("primaryRideOfDate", () => {
  it("matches the activityId buildRideScores stamps, ties included", () => {
    // Cross-module: buildRideScores keeps the FIRST ride on an exact tie (strict `>`). A helper using
    // `>=` would bind an overlay to a ride the ledger never scored — invisible to either module alone.
  });
});
```

Plus: prescribed rides never enqueue; note-less rides *do* enqueue (they need a deterministic
`no-intent-found`); future dates drop; a date with no ledger entry drops; newest-first ordering;
idempotent second call.

- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run lib/intent-queue.test.ts && npm run check`.
- [ ] **Step 5: Commit** — `feat(scoring): derive the intent-parse queue`, body covering the
  all-statuses skip rule, the `autoFromDate` floor, and the ledger/primary binding requirement.

---

### Task 4: Canonicalisation, grading, and the evidence-scope gate

**Files:** create `lib/intent-scoring.ts`, `lib/intent-scoring.test.ts`

**Produces:** `INTENT_SCORING_VERSION = 1`, `INTENT_MIN_SCOPE_MIN`, `INTENT_SCOPE_MIN_FRACTION`,
`GRADABLE_KINDS_BY_CONFIDENCE`, `canonicalise(objectives)`, `zoneMinutes(evidence, zone)`,
`matchLaps(target, laps)`, `gradeObjective`, `evidenceScope`, `assessScoreability`,
`scoreIntentExecution`, `intentWorkoutType`, `buildOverlay`,
`RideEvidence { durationMin, isIndoor, powerZoneTimes, hrZoneTimes, laps, ftp }`.

Implements questions 1, 3, 6, 7 and 8. **Never imports the SDK, never reads `activity.decoupling`,
never sees the ride's existing execution score** — all three pinned by test.

Score model: baseline 5, one clamped contribution per kind (mean of that kind's canonical members),
summed, clamped to 1–10. `structure` is **reward-only** (+1 in order, 0 otherwise) — an out-of-order
reading is at least as likely to be the parser mis-ordering an ambiguous note as the athlete riding
out of order, and design §6 forbids penalising a self-directed ride for its own structure.

- [ ] **Step 1: Failing tests.** Required:

*The one-way confidence rule*
```ts
it("confidence can only shrink the gradable set, never grow it", () => {
  for (const objectives of FIXTURES) {
    expect(gradableObjectives(objectives, "medium", NOTE).length)
      .toBeLessThanOrEqual(gradableObjectives(objectives, "high", NOTE).length);
    expect(gradableObjectives(objectives, "low", NOTE).length).toBe(0);
  }
});
it("`high` cannot rescue a ride the scope gate rejects", () => {
  // 9-min effort, 118-min ride → scope 9 < max(20, 39)
  expect(scoreIntentExecution(interp({ confidence: "high", objectives: [nineMinEffort] }), evidence({ durationMin: 118 })).reason)
    .toBe("no-measurable-objectives");
});
```

*Evidence scope, not fulfilment — the blocker-3 correction*
```ts
it("a badly missed but clearly stated target SCORES LOW, it is never Not scored", () => {
  // "3 hours of Z2" ridden for 40 minutes. The claim is about the ride's total, so the whole ride is
  // the evidence: the gate passes and the duration axis reports the failure honestly.
  const r = scoreIntentExecution(interp({ objectives: [obj("duration", { durationMin: 180 })] }), evidence({ durationMin: 40 }));
  expect(r.reason).toBeNull();
  expect(r.score).toBeLessThan(5);
});
it("a duration objective always clears the scope gate", () => { /* … */ });
it("an effort-only note on a long ride does not", () => { /* … */ });
```

*Decomposition invariance* — question 6's test verbatim, plus an `effort` variant (same effort emitted
twice vs. once) and a `duration` variant (two duration objectives → max, not sum).

*Every effort combination* — one test per row of question 7's table, including all four ❌ rows
asserting `scored: false`, `scopeMin: 0`, and **no change to the score** versus omitting the objective
entirely.

*Zone semantics* — seconds→minutes conversion; `"Z2"` → index 1; aerobic prefers HR, Z3+ prefers
power, indoor always power; `null`/short/all-zero array → ungradable with scope 0;
```ts
it("zone BOUNDARY definitions move the score but cannot flip scoreability", () => {
  // Scope is presence-based, so shifting minutes across a boundary changes the grade only. This is the
  // claim question 8 makes; assert it rather than asserting the earlier draft's false version.
  const a = evidence({ durationMin: 90, zone: [1200, 3000, 1200, 0, 0, 0, 0] });
  const b = evidence({ durationMin: 90, zone: [1200, 1800, 2400, 0, 0, 0, 0] });
  expect(scoreIntentExecution(I, a).reason).toBe(scoreIntentExecution(I, b).reason); // both null
  expect(scoreIntentExecution(I, a).score).not.toBe(scoreIntentExecution(I, b).score);
});
it("absence of zone data CAN flip scoreability, and that is intended", () => { /* … */ });
```

*Acceptance examples as executable fixtures* — use the **real notes**, read from
`data/last-sync.json` at plan time and pasted as literals (the test must not read `data/`):
- **14.1** — the real 455-char 2026-08-06 note, `high`: four phases interpret; Z2, climbing and the
  9-min effort graded from their own data; descending is `measurable: false, scored: false`; no
  variability-derived delta anywhere; the score is a real number, not 2.
- **14.2** — the real 2026-08-05 note, `medium`: scores; grades the Z2 emphasis; every `scored`
  objective is `grounded`; `structure` absent from the graded set.

*Anti-contamination*
```ts
it("never reads whole-ride decoupling", () => {
  expect(readFileSync(new URL("./intent-scoring.ts", import.meta.url), "utf8")).not.toMatch(/decoupling/i);
});
```

*`intentWorkoutType`* — maps stated purposes; returns `null` for unmappable; **its signature takes
only `StructuredIntent`**, so consulting IF is unexpressible rather than merely avoided.

*`buildOverlay`* — all five outcome rows round-trip through `isApplicable` and are **accepted** (a
producer emitting records its own consumer rejects is the 2a defect shape); `effectiveWorkoutType` is
null on every `unspecified` row; `scoringVersion` is set exactly when a score exists.

- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run lib/intent-scoring.test.ts && npm run check`.
- [ ] **Step 5: Commit**

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts
git commit -m "$(cat <<'EOF'
feat(scoring): score self-directed intent deterministically

Grounding, kind-eligibility and an evidence-scope gate decide scoreability before
confidence is consulted; confidence can then only shrink the gradable set or veto
it. Pinned by a monotonicity test rather than per-level examples, which would not
catch the inverse.

Scope measures how much of the ride the evidence SPEAKS ABOUT, never how much of
it went well: a clearly stated target the athlete missed now scores low instead of
becoming Not scored. Scope is the MAXIMUM across objectives, not a union — zone
arrays are whole-ride aggregates and lap indices carry no stated sample interval,
so a union would be a number we cannot actually compute.

Objectives are canonicalised and aggregated per kind so the model cannot move the
score by choosing how to split or duplicate one intent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The LLM seam — schema, prompt, call, pricing

**Files:** create `lib/intent-schema.ts`, `lib/intent-schema.test.ts`, `lib/intent-prompt.ts`,
`lib/intent-prompt.test.ts`; modify `lib/anthropic-api.ts`, `lib/ai-usage.test.ts`

**Model:** `GENERATION_MODEL` (`claude-sonnet-4-6`), already priced. Not `QUICK_MODEL`: the value of
this call is disciplined refusal to invent specificity — a judgement task — and the token count is a
note plus a schema, so cost is negligible against the correctness risk.

**`INTENT_PROMPT_VERSION = 1` is separate from `PROMPT_VERSION`** — a deliberate deviation from the 2a
handoff note. `PROMPT_VERSION` is stamped on `GeneratedPlan`, `TodayAnalysis` and `BlockHistoryEntry`
(INVARIANT 16); bumping it for an unrelated new prompt asserts a change to three artifact families
that didn't change. Recorded in Task 9 as INVARIANT 47.

**The tool schema is where "the model never computes a number" is enforced** — `.strict()` objects with
no field for a score, percentage, compliance figure, drift value or evidence verdict.

- [ ] **Step 1: Failing tests.**

`intent-schema.test.ts` — valid output parses; output carrying `score`/`executionScore`/`decoupling`
is rejected by `.strict()`; missing `confidence`, unknown `kind` or non-array `objectives` yields
`null` rather than throwing; a model-claimed `grounded: true` passes through **unverified** here (the
schema does not re-verify — `lib/intent-grounding.ts` does; assert the boundary so the responsibility
isn't duplicated in two places that can drift).

`intent-prompt.test.ts`:
```ts
const NOTE_455 = "…"; // the literal 2026-08-06 acceptance note, 455 chars
const NOTE_823 = "…"; // the literal longest note in the corpus, 823 chars

it("does not truncate the real acceptance note (455 chars)", () => {
  expect(NOTE_455.length).toBe(455);                       // guard the fixture itself
  expect(buildIntentPrompt(NOTE_455, 118)).toContain(NOTE_455);
});
it("does not truncate the longest note in the real corpus (823 chars)", () => {
  expect(NOTE_823.length).toBe(823);
  expect(buildIntentPrompt(NOTE_823, 120)).toContain(NOTE_823);
});
it("marks a note it does truncate, so the model knows it sees a fragment", () => {
  expect(buildIntentPrompt("x".repeat(INTENT_NOTE_MAX_CHARS + 50), 60)).toContain("[note truncated]");
});
it("carries no ride metrics at all", () => {
  const p = buildIntentPrompt(NOTE_455, 118);
  for (const leak of ["decoupling", "TSS", "IF ", "NP ", "execution score", "15.7"]) expect(p).not.toContain(leak);
});
it("states the refusal-of-invented-specificity rule verbatim", () => { /* so a later edit fails a test */ });
it("is deterministic", () => { expect(buildIntentPrompt(NOTE_455, 118)).toBe(buildIntentPrompt(NOTE_455, 118)); });
```

`ai-usage.test.ts` — every model id a call site uses is priced:
```ts
it("prices every model id any call site actually uses (INVARIANT 18)", () => {
  for (const model of [GENERATION_MODEL, QUICK_MODEL]) {
    expect(estimateCostUsd(model, { input_tokens: 1_000_000, output_tokens: 0 })).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Create the schema and prompt modules. Follow `lib/retrospective-schema.ts` and
  `lib/narrative-critic.ts` — the two existing tool-use call sites; do not invent a third convention.
- [ ] **Step 4:** Add `parseRideIntent` to `lib/anthropic-api.ts`. Thin SDK shell only. Forced
  `tool_choice`, `void recordUsage(GENERATION_MODEL, response.usage)`, `max_tokens: 900`,
  `temperature: 0.3`. **Return `null` when the model produced no usable tool output; let an SDK error
  THROW.** Comment why: conflating them turns a transient network blip into a permanent verdict
  (question 5's retry table).
- [ ] **Step 5:** `npx vitest run lib/intent-schema.test.ts lib/intent-prompt.test.ts lib/ai-usage.test.ts && npm run check`.
- [ ] **Step 6: Commit** — `feat(ai): parse activity-note intent into structured objectives`, body
  covering the unexpressible-score schema, the 2000-char cap replacing the inherited 400, and the
  null-vs-throw contract.

---

### Task 6: The runner and `POST /api/intent`

**Files:** create `lib/intent-runner.ts`, `lib/intent-runner.test.ts`, `app/api/intent/route.ts`;
modify `components/SyncProvider.tsx`

**Produces:** `runIntentParsing(today, warnings, opts?: { force?: boolean; limit?: number })
: Promise<{ processed: number; remaining: number; stalled: boolean }>`.

**Decision order** — question 5's retry table made executable:

```
0. read stores; if (!store.autoFromDate) initialise it to `today` and persist (one transaction)
1. queue = buildIntentQueue(activities, entries, overlays, today, store.autoFromDate,
                            { force: force ? [primaryRideOfDate(activities, today)?.id] : [] })
2. for each of the first `limit` items:
   a. normalizeNote(item.note) === ""   → write no-intent-found. NO client, NO call. processed++
   b. !isAnthropicConfigured()          → write NOTHING; warn once; leave queued
   c. gather evidence (zone arrays from the ActivitySummary; laps via fetchIntervals, best-effort → [])
   d. interpretation = await parseRideIntent(note, durationMin)
        THROWS → write NOTHING; warn; leave queued; NOT counted as processed
        null   → write interpreter-failed; processed++
   e. verdict = scoreIntentExecution(interpretation, evidence)
   f. overlay = buildOverlay(...) with status "active"
   g. ONE updateIntentOverlays call: supersede every unsuperseded record for this activityId, append
3. return { processed, remaining: queue.length - processed, stalled: processed === 0 && remaining > 0 }
```

Step (a) precedes (b) deliberately: a note-less ride is decidable with no API key.

- [ ] **Step 1: Failing tests.** Required:

```ts
it("decides a note-less ride with NO parse call at all", async () => {
  // Structural, not incidental: inject a parse fn that throws if called. A skip relying on ordering
  // luck would still bill the athlete for every rest-day ride with an empty note.
  expect(parse).not.toHaveBeenCalled();
  expect(written[0]).toMatchObject({ notScoredReason: "no-intent-found", origin: "unspecified",
                                     interpretation: null, scoringVersion: null });
});

it("a TRANSIENT failure writes nothing and leaves the ride queued", async () => {
  // The blocker: writing interpreter-failed here would burn the fingerprint. needsParse would then
  // skip it forever, and `force` only ever targets TODAY's ride — so a 12-day-old ride with a good
  // note would be unrecoverable except by hand-editing JSON.
  parse.mockRejectedValueOnce(new Error("ECONNRESET"));
  const r = await runIntentParsing("2026-08-07", warnings);
  expect(written).toHaveLength(0);
  expect(r.processed).toBe(0);
  expect(r.stalled).toBe(true);
  expect(buildIntentQueue(acts, entries, store.overlays, "2026-08-07", boundary)).toHaveLength(1);
});

it("failure then later success: the second run writes the overlay", async () => {
  parse.mockRejectedValueOnce(new Error("503"));
  await runIntentParsing("2026-08-07", warnings);
  parse.mockResolvedValueOnce(goodInterpretation);
  const r = await runIntentParsing("2026-08-07", warnings);
  expect(r.processed).toBe(1);
  expect(written).toHaveLength(1);
  expect(written[0].notScoredReason).toBeNull();
});

it("a COMPLETED call with no usable output writes interpreter-failed", async () => { /* parse → null */ });
it("a low-confidence parse writes intent-unreliable", async () => { /* … */ });

it("initialises autoFromDate to today on first run and never re-writes it", async () => { /* … */ });
it("writes nothing for a ride before autoFromDate, even with force", async () => { /* … */ });

it("supersedes and activates in ONE store write", async () => { /* assert call count === 1 */ });
it("never leaves two unsuperseded records for one activity across an edit sequence", async () => { /* … */ });
it("supersedes a pending and a disabled predecessor too", async () => { /* … */ });

it("writes only records its own consumer accepts", async () => {
  for (const o of written) expect(isApplicable(o)).toBe(true);
});

it("respects the batch limit and reports a truthful remaining count", async () => { /* … */ });
it("never writes for a prescribed ride, even with force", async () => { /* … */ });
```

- [ ] **Step 2:** run → FAIL. **Step 3:** implement `lib/intent-runner.ts`, mirroring
  `lib/sync-analysis.ts`'s warning discipline (`warnings.push`, never throw out of the loop).
- [ ] **Step 4:** Create `app/api/intent/route.ts` — copy `app/api/analyze/route.ts`'s shape:
  `export const maxDuration = 60`, tolerant body parse, `resolveToday(body?.today)`,
  **`force` as a boolean** (question 10). Return `{ processed, remaining, stalled, warnings }`. **Do
  not** guard the whole route on `isAnthropicConfigured()` — a note-less ride is still decidable.
- [ ] **Step 5:** Wire `components/SyncProvider.tsx`: extend the existing `runAnalysis` callback to
  also call `/api/intent`, looping `while (remaining > 0 && !stalled)` up to 6 rounds, passing the
  same `force` boolean it already has. Reuse `analyzingRef` (UXA-6 — a double-click must not
  double-bill). Warnings through the existing `setSyncWarnings`. **No new button, no new UI state.**
- [ ] **Step 6:** Prove sync is still LLM-free — a static test walking `app/api/sync/route.ts`'s
  transitive local imports and asserting none is `@anthropic-ai/sdk`. Static, not behavioural: a
  behavioural test passes as long as the call happens to be guarded.
- [ ] **Step 7:** `npm run check`, then commit — `feat(api): run intent parsing outside the LLM-free sync`,
  body covering the sibling-route rationale, the structural no-call short-circuit, transient-vs-terminal
  retry, and one-transaction supersession.

---

### Task 7: Thread overlays into every `buildAthleteModel` consumer

**Files:** modify `lib/coach-snapshot.ts`, `lib/season-signals.ts`, `app/api/generate/route.ts`,
`app/api/write/route.ts`, `app/api/trends/route.ts`, `app/api/sync/route.ts` (×3); test
`lib/athlete-model.test.ts`

**Re-grep first** — the 2a plan's line numbers may have drifted:

```bash
grep -rn "buildAthleteModel(" --include='*.ts' --include='*.tsx' lib/ app/ components/ | grep -v test
```

Expected **eight**, all currently one-argument. **If the count is not eight, stop and report** — a call
site added since 2a would silently keep reading the ledger while its siblings read overlays: the 2a
defect shape once more.

- [ ] **Step 1: Failing tests** — a completeness guard plus a behavioural one:

```ts
it("every production call site passes overlays (no silent ledger-only reader left)", () => {
  // A source-level guard rather than eight behavioural tests. The failure it catches — one consumer
  // still reading the raw ledger — makes a single request answer "was this ride drift" two ways, which
  // no single-module test can see.
  for (const f of SOURCES) for (const call of (readFileSync(f, "utf8").match(/buildAthleteModel\([^)]*\)/g) ?? []))
    expect(call).toMatch(/,/);
});
it("the same entries + overlays give the same offPlanPct and sampleSize through every consumer", () => { /* … */ });
```

- [ ] **Step 2:** run → FAIL. **Step 3:** thread `readIntentOverlays()` through each site — added to
  the existing `Promise.all` where one exists, never a serial await. In `app/api/sync/route.ts` read
  the store **after** the ledger is written at each of the three sites, so the model sees the same
  generation of data the response reports. `coach-snapshot.ts` and `season-signals.ts` take their data
  in — thread through their input objects rather than adding I/O inside them.
- [ ] **Step 4:** `npm run check`, then commit — `feat(scoring): read intent overlays in every athlete-model consumer`.

---

### Task 8: Close the retrospective decoupling leak

**Files:** modify `app/api/retrospective/route.ts` + its test file (create if absent)

- [ ] **Step 1: Failing test** — a block mixing one steady endurance ride with two high-VI mixed rides
  yields `avgDecoupling` equal to the steady ride's value alone; a block with no qualifying ride yields
  `null`, not `0`.
- [ ] **Step 2:** add `.filter((a) => isSteadyEnduranceRide(a, athleteProfile.performance.ftp))` before
  the existing `.map`. Confirm `athleteProfile` is in scope at line 122 (it is used at :141); if it is
  read later, hoist the read rather than adding a second. Comment naming INVARIANT 34 and why this is
  `isSteadyEnduranceRide` (whole-ride comparability), not `qualifyingPwHr` (Z2-segment
  trustworthiness) — INVARIANT 34 forbids using one to gate the other's consumers.
- [ ] **Step 3:** `npm run check`, then commit — `fix(retrospective): gate the block decoupling average`.

---

### Task 9: Sandboxed real-data verification, live smoke run, docs

**Files:** create (temporary, never committed) `lib/_verify-p2b.test.ts`; modify `docs/INVARIANTS.md`,
`docs/systems/02-scoring-and-learning.md`, `docs/systems/07-ai-layer.md`, `docs/FILE_INDEX.md`,
`ROADMAP.md`, `FEATURES.md`.

**Safety boundary — read this before running anything.** The worktree has **no `data/` directory**.
The primary store at `/Users/otis/Cycling App/data/` is the athlete's real data, it has **no
`intent-overlays.json`**, and this phase's whole point is that Phase 4's period must not be written
before review. Therefore: **read the primary store, never write to it.** Every write in this task goes
to a temporary directory via `NODEVELO_DATA_DIR`, which
[json-store.ts:20](../../../lib/json-store.ts) reads fresh on every call. Never run a git command in
the primary data directory, never `cd` there.

- [ ] **Step 1: Build the sandbox**

```bash
export SMOKE_DIR="$(mktemp -d -t nodevelo-p2b)"
cp -R "/Users/otis/Cycling App/data/." "$SMOKE_DIR/"
[ -f "$SMOKE_DIR/intent-overlays.json" ] || printf '{"overlays":[],"updatedAt":"1970-01-01T00:00:00.000Z"}\n' > "$SMOKE_DIR/intent-overlays.json"
ls "$SMOKE_DIR" | head -30 && echo "SMOKE_DIR=$SMOKE_DIR"
```

`cp -R` of the whole directory rather than a named subset: the dev server's GET path reads more stores
than the runner does, and an omission would surface as a confusing 500 rather than a clean result.

**Seed the boundary so the acceptance rides are in range** — legitimate only because this is a
throwaway copy, and it also demonstrates that `autoFromDate` is doing its job:

```bash
node -e '
const p=process.env.SMOKE_DIR+"/intent-overlays.json";
const s=JSON.parse(require("fs").readFileSync(p,"utf8"));
s.autoFromDate="2026-08-05";
require("fs").writeFileSync(p, JSON.stringify(s,null,2));
console.log("seeded autoFromDate=2026-08-05 in the SANDBOX only");
'
```

- [ ] **Step 2: Real-data verification, against the sandbox**

Write `lib/_verify-p2b.test.ts` reading `process.env.SMOKE_DIR` (fail loudly if unset — never default
to the primary path). Assert and print:

1. **Inertness.** With an empty overlay store, `buildAthleteModel(entries, [])` equals
   `buildAthleteModel(entries)`. Print `sampleSize`, `overallExecEwma`, `behaviourAllTime.offPlanPct`,
   `driftAvgQuality`.
2. **Boundary.** `buildIntentQueue(..., autoFromDate = <today>)` returns **zero** items dated before
   today — the shipped default writes nothing historical. Print the queue length at the shipped
   boundary and at the seeded `2026-08-05` one.
3. **Queue sanity.** Print length, empty-note count, date range at the seeded boundary. **Sanity-check
   by hand:** the corpus has 169 rides and 29 notes; a queue much larger than the unplanned-rides count
   in range means a rule is wrong, not that the athlete writes many notes.
4. **Back-compat.** Every ledger entry parses; **all rows lack `activityId`** (assert the count is the
   full ledger — if any row has one, the ledger has moved since this plan was measured and question 9's
   mismatch branch is now live); a literal pre-2b overlay fixture with `effectiveWorkoutType` **deleted**
   is accepted by `isApplicable`.
5. **Primary-ride parity on real data.** For every date with ≥2 rides in the sandbox sync window,
   assert `primaryRideOfDate(...)?.id` equals what `buildRideScores` stamps. **Print the count of such
   dates; if it is zero, say so in the report** rather than claiming the check passed on nothing.

```bash
SMOKE_DIR="$SMOKE_DIR" npx vitest run lib/_verify-p2b.test.ts
```

**If any assertion fails, STOP and report.** Do not adjust the test to match.

- [ ] **Step 3: The live smoke run** (AGENTS.md's fourth recurring bug class; INVARIANT 19)

In one terminal:
```bash
NODEVELO_DATA_DIR="$SMOKE_DIR" npm run dev
```

In another:
```bash
curl -sf -X POST http://127.0.0.1:3000/api/intent -H 'content-type: application/json' -d '{"today":"2026-08-07"}' | head -60
```
```bash
cat "$SMOKE_DIR/intent-overlays.json"
```

Then **read and judge the actual output**, not the status code. Record in the report:

- `processed` / `remaining` / `stalled`;
- for the 2026-08-06 acceptance ride: the raw note, parsed `primaryPurpose` and objectives, the
  `confidence`, which objectives were graded vs. acknowledged, each one's `scopeMin`, the
  `evidenceScopeMin`, the final `effectiveExecutionScore` or `notScoredReason`, and
  `effectiveWorkoutType`;
- the same for 2026-08-05 (design §14.2 — expect `medium`);
- the full overlay records;
- the token/cost delta in `$SMOKE_DIR/ai-usage.json`.

**Judgement questions, each of which is a finding if the answer is bad:** did the model invent a number
absent from the note? Did grounding catch it if so? Did it mark a qualitative objective measurable? Is
the score defensible against the note a human would read? A syntactically valid response is not a
correct one. **Note that the ride card would still show the old ledger score** — that is expected in
2b (see "What this phase changes"), and the acceptance bar here is a defensible overlay, not a changed
card.

- [ ] **Step 4: Tear down the sandbox**

```bash
rm -rf "$SMOKE_DIR" && unset SMOKE_DIR && echo "sandbox removed"
```
```bash
ls "/Users/otis/Cycling App/data/intent-overlays.json" 2>&1
```
Expected: **`No such file or directory`** — proof the primary store was never written. If the file
exists, **stop and report**: something ran without `NODEVELO_DATA_DIR`.

- [ ] **Step 5: Delete the verification script**

```bash
rm lib/_verify-p2b.test.ts && git status --short lib/_verify-p2b.test.ts
```
Expected: no output.

- [ ] **Step 6: `docs/INVARIANTS.md`** — extend the existing `## Ride origin & intent overlays` section
  (do not renumber 36–40):

```markdown
41. **Phase 2b writes only on/after `autoFromDate`.** `IntentOverlayStore.autoFromDate` is a persisted
    floor, initialised on first run to that day's local date (truthy check — a 2a store parses it back
    `undefined`). Rides before it belong to Phase 4's human-reviewed repair (design §11, decision #10);
    2b writes nothing there, not even `pending`. `force` bypasses idempotency, never the boundary.
42. **The deterministic gate decides scoreability; confidence may only downgrade.** ≥1 grounded,
    kind-eligible objective plus evidence scope ≥ `max(INTENT_MIN_SCOPE_MIN, INTENT_SCOPE_MIN_FRACTION ×
    ride minutes)`. `low` vetoes; `medium` drops `structure`; **no level can make a ride scoreable that
    the gate rejected.**
43. **Evidence scope is what the evidence SPEAKS ABOUT, never what went well.** A clearly stated target
    the athlete missed scores low; it never becomes `Not scored`. Scope is the **maximum** across
    objectives, not a union — zone arrays are whole-ride aggregates and lap indices carry no stated
    sample interval, so a union is not computable from the available evidence.
44. **Grounding is semantic and field-specific.** Zone tokens are masked out before any numeric scan, so
    the `4` in `Z4` can never ground `reps: 4` nor the `5` in `Z5` ground `durationMin: 5`. Each field
    requires its own unit-bearing form. `verifyGrounding` may only lower the model's claim.
45. **Objective decomposition cannot move the score.** Objectives are canonicalised (duration → max,
    zone-time → summed per zone, effort/emphasis → deduped) and aggregated one clamped contribution per
    kind, so duplicated or differently split representations of one intent score identically.
46. **The intent parser is shown the note and the ride's duration — nothing else.** No decoupling, no
    scores, no zone data. The tool schema has no field for a score, percentage or drift value, so
    INVARIANT 12 is unexpressible rather than instructed. Note cap is `INTENT_NOTE_MAX_CHARS` (2000),
    dedicated — the ride-analysis prompt's 400 would truncate the real corpus.
47. **A note-less ride is decided without an LLM call**, structurally: the empty-note branch precedes
    client construction, and the empty note's fingerprint is stable so the ride is decided once.
48. **Overlay idempotency reads ALL records, not applicable ones**, and a **transient** call failure
    writes nothing. `needsParse` skips on any unsuperseded record for `(activityId, noteFingerprint)` —
    including `disabled` and `pending`. Writing a terminal record on a network error would burn the
    fingerprint and permanently skip a non-today ride, which `force` (today-only) could never recover.
    Supersession and activation are one `updateIntentOverlays` transaction.
49. **An overlay binds to the date's primary (longest) ride**, via `primaryRideOfDate` using
    `buildRideScores`'s strict comparison and array order, first-wins tie included. When the ledger row
    carries an `activityId` it must equal that id or the date is skipped and reported — the resolver
    never date-falls-back for a row with an id, so a mismatched binding would resolve against nothing.
50. **`effectiveWorkoutType` is provenance, not a learning input.** It records the STATED type (never
    one inferred from IF) and may only accompany `origin: "self-directed"`. Per-type learning stays
    prescribed-only (INVARIANT 40) until the two 1–10 scales are shown comparable on a real corpus AND
    compliance gains a meaning for rides that have none.
51. **`INTENT_PROMPT_VERSION` is versioned independently of `PROMPT_VERSION`.** The latter is stamped on
    GeneratedPlan / TodayAnalysis / BlockHistoryEntry; bumping it for an unrelated prompt would assert a
    change to three artifact families that didn't change. INVARIANT 16 requires every AI artifact to
    carry *a* model + prompt version, not that one counter serve every prompt.
```

- [ ] **Step 7: `docs/systems/02-scoring-and-learning.md`** — replace the now-false "Phase 2a is
  infrastructure — nothing is classified `self-directed` yet" rough edge, and record the honest residue:

- 2b shipped the producer on `<date>`; the real numbers Step 2 printed.
- **The ride debrief is still ledger-based** — 2b changes derived state only; 2c renders the overlay.
  Say this plainly, because "the card still says 2/10" will otherwise read as a bug.
- **`autoFromDate` gates the rollout**; the historical no-block period (2026-07-24 → the boundary)
  remains Phase 4's, unprocessed.
- **Per-type learning is still prescribed-only** — restate question 3's two unlock conditions verbatim,
  replacing the old "revisit when 2b supplies an authoritative type" note, which 2b has now partly
  satisfied without satisfying the rest.
- **Zone evidence for non-today rides uses Intervals' own zone boundaries**, not the athlete's
  physiology store: boundary definitions move a zone objective's *grade*; zone-array **absence** can
  flip scoreability, and that is intended.
- **Segment decoupling is deliberately absent**, with question 12d's three-point unlock gate.
- **`computeRollingBaselines`'s `avgDecoupling90d` remains ungated** — the one raw consumer left, with
  the reason.

- [ ] **Step 8: `docs/systems/07-ai-layer.md`, `docs/FILE_INDEX.md`, `ROADMAP.md`, `FEATURES.md`**

- `07-ai-layer.md` — add `parseRideIntent` to the **every LLM call site** list with its model, prompt
  version constant, and degradation behaviour. INVARIANT 31: COMPASS links this heading by slug — do
  not rename it.
- `FILE_INDEX.md` — rows for `lib/intent-queue.ts`, `lib/intent-grounding.ts`, `lib/intent-scoring.ts`,
  `lib/intent-schema.ts`, `lib/intent-prompt.ts`, `lib/intent-runner.ts`, `app/api/intent`. Match the
  existing column shape; no line-count column.
- `ROADMAP.md` — 2b shipped; 2c (debrief UI) and 3/4 remain. 1–2 lines with a link out. Do not
  renumber IDs (INVARIANT 26).
- `FEATURES.md` — the capability, framed honestly: a self-directed ride now teaches the athlete model
  against the objective the athlete wrote, and no longer counts as plan drift. **Do not claim the ride
  card shows it** — that is 2c.

**Before committing, verify every pointer this task touched still resolves** (AGENTS.md's fourth
recurring bug class): grep for links to the rough-edge text you removed and for `// AI:` comments
pointing at any heading you renamed.

- [ ] **Step 9:** `npm run check` (confirm `lib/_verify-p2b.test.ts` is gone first), then commit —
  `docs: record the intent-scoring contracts`.

---

## Handoff boundary to Phase 2c

**2b ends with data written and read. 2c renders it.** 2b touches no component under
`components/dashboard/` and adds no user-visible string beyond what already existed — the only client
change is the deferred fetch in `SyncProvider`.

What 2c consumes, all present after this phase:

- `interpretation.intent` → the "**Intent used:** 45 min steady Z2 → variable climbing → 9 min around
  292 W → descending practice" line (§12.2); phase ordering is already in `phases[]`.
- `interpretation.objectives[]` → each carries `kind`, `target`, `grounded`, `sourceText`, `measurable`,
  `scored`, `scopeMin`, `evidence`. §12.2's "concise evidence for measurable objectives" and
  "qualitative objectives acknowledged but not graded" are a partition of this array on `measurable`.
- `notScoredReason` → the four distinct `Not scored` messages design §13 enumerates. The **wording is
  2c's**; 2b ships the discriminator only.
- `effectiveWorkoutType`, `scoringVersion`, `interpretation.confidence`, `.model`, `.promptVersion` →
  the provenance §11.3 requires on display.
- `resolveEffectiveOutcome(entry, …).overlay` → the single read seam; 2c must not re-implement
  overlay-then-ledger fallback.

What 2c must decide, which 2b deliberately does not:

1. **Making the debrief overlay-aware at all** — this is 2c's headline, not a leftover. The ride card
   currently reads `TodayAnalysis.executionScore`; showing the effective score means resolving the
   overlay at render or threading it onto `TodayAnalysis`. 2b leaves `TodayAnalysis` untouched so the
   choice is clean.
2. Where the intent block sits relative to the score explanation (§12.2 says before it), and what an
   `unspecified` ride shows instead.
3. The `Aerobic drift not measurable — no sufficiently steady aerobic segment` string (§7 step 5). The
   *value* is already correctly `null`; only the wording is missing.
4. Whether the coach-note prompt is told the intent verdict. **2b does not change
   `buildRideAnalysisPrompt`** — changing the coach note in the same PR that changed scoring would make
   a bad note impossible to attribute.

What 2c must NOT assume carries over: **re-derive every validity guarantee at each new read site.** 2c
adds consumers of `origin`, `status` and `notScoredReason` in components — a layer with no existing
overlay tests. A rendering path reading `overlay.effectiveExecutionScore` without re-checking
`isApplicable` would display a `pending` Phase 4 draft as the athlete's live score.

---

## Appendix — dispatching this plan to Codex

**Before starting**, from the primary checkout:

```bash
npm run sync
```
```bash
npm run start:agent-task -- codex adaptive-coach-p2b-intent-scoring
```

This plan and the restored design spec live on `claude/adaptive-coach-p2b-intent-scoring-plan`, which
may not be merged yet — bring them across first (skip if it has merged; Task 0 is then a no-op
verification):

```bash
cd .worktrees/codex-adaptive-coach-p2b-intent-scoring
git checkout claude/adaptive-coach-p2b-intent-scoring-plan -- docs/superpowers/plans/2026-08-07-adaptive-coach-p2b-intent-scoring.md docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md
git add docs/superpowers/plans/2026-08-07-adaptive-coach-p2b-intent-scoring.md docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md
git commit -m "docs: bring the Phase 2b plan and design spec onto the implementation branch"
```

### The prompt

> You are implementing a 9-task plan in an isolated git worktree. Work from
> `/Users/otis/Cycling App/.worktrees/codex-adaptive-coach-p2b-intent-scoring` on branch
> `codex/adaptive-coach-p2b-intent-scoring`. This is not the primary checkout — commit freely here, and
> never run git commands against `/Users/otis/Cycling App` itself.
>
> **Read first, in this order:** `AGENTS.md` (operating law and four recurring bug classes),
> `docs/INVARIANTS.md` (especially 1, 2, 3, 10, 12, 16, 18, 19, 23, 26, 30, 34, 35 and 36–40),
> `docs/systems/02-scoring-and-learning.md` — **its "Known rough edges" section in full**, which records
> four bugs found across three review passes on this exact feature and is the best predictor of how this
> task fails — then your plan:
> `docs/superpowers/plans/2026-08-07-adaptive-coach-p2b-intent-scoring.md`, and the design basis:
> `docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md` (§2's locked decisions are
> not reopenable; §5, §6, §11, §13 and §14 are the contract).
>
> **Read the plan's preamble in full before Task 1** — "What this phase changes, and what it does not",
> "Global constraints", "Ground truth measured against the real stores", and all thirteen entries under
> "The questions this plan resolves". Several of those correct an earlier draft of this same plan that
> was wrong; the rejected version usually looks more natural than the chosen one.
>
> **What this builds:** a cycling training app judges every ride against a training block's
> prescription. With no block active, the athlete still states an objective in the ride's Intervals.icu
> note — and the app ignores it, infers a workout type from whole-ride intensity, scores mixed rides
> 2/10, and counts them as "drifting off-plan." Earlier phases built the origin taxonomy and the overlay
> store. This phase supplies the producer: parse the note into structured objectives with an LLM, decide
> *deterministically* whether that intent is trustworthy and scoreable, score only the measurable
> objectives the athlete actually stated, and write an overlay every athlete-model consumer reads.
>
> **Phase 2b changes DERIVED state only.** The ride card keeps showing the old ledger score until Phase
> 2c renders the overlay. Do not "fix" that — it is the designed boundary.
>
> **The rule that matters most:** the LLM's confidence may DOWNGRADE the outcome but may never PROMOTE
> it. The deterministic gate decides scoreability first. A high-confidence parse can never make a ride
> scoreable that the gate rejected. Any code that could violate that is wrong even if every test passes.
>
> **Execute the tasks in order, one at a time.** Follow TDD as written: write the failing tests, run
> them and confirm they fail for the stated reason, then implement, then confirm green. Run
> `npm run check` before every commit. Commit after every task using that task's exact message, staging
> only the files it names — never `git add -A`.
>
> **Where the plan and reality disagree, stop and report rather than improvising.** Line numbers were
> accurate when written but may have drifted; locate code by content and say so when a cited line moved.
> If a *pre-existing* test breaks in a way the plan did not predict, do not adjust its expected value —
> report it.
>
> Specific traps:
> - **`autoFromDate` is a hard floor.** 2b writes nothing — not even `pending` — for rides before it.
>   `force` bypasses idempotency, never the boundary. The historical no-block period is Phase 4's.
> - **Grounding is semantic.** The `4` in `Z4` must not ground `reps: 4`. Mask zone tokens first.
> - **Evidence scope ≠ successful minutes.** A stated target the athlete missed scores low; it never
>   becomes `Not scored`. Scope is a MAX across objectives, never a union — you do not have the
>   timestamps a union would need.
> - **A transient Anthropic exception writes NOTHING and leaves the ride queued.** Writing a terminal
>   record burns the fingerprint and permanently skips a non-today ride.
> - `needsParse` reads **all** overlays, not `isApplicable` ones.
> - `primaryRideOfDate` uses `buildRideScores`'s strict `>` and array order, tie-break included; and when
>   the ledger row carries an `activityId` it must equal that id or the date is skipped.
> - A note-less ride is decided **before** the Anthropic client is constructed.
> - Supersession and activation are ONE `updateIntentOverlays` call.
> - `POST /api/sync` must remain LLM-free (INVARIANT 23).
> - `INTENT_PROMPT_VERSION` is NEW. Do **not** bump the shared `PROMPT_VERSION`.
> - `INTENT_NOTE_MAX_CHARS` is 2000, not the ride-analysis prompt's 400 — the real acceptance note is 455
>   characters and the corpus reaches 823.
> - Objective canonicalisation must make duplicated and split representations score identically.
> - Test fixtures avoid `.x5` float boundaries (INVARIANT 30).
>
> **Task 9's verification and live smoke run are sandboxed, and this is not optional.** The worktree has
> no `data/` directory; the primary store has no `intent-overlays.json`; and Phase 4's period must not be
> written before review. Copy the primary `data/` into a `mktemp -d` directory, create the empty overlay
> store, run everything with `NODEVELO_DATA_DIR` pointed at the copy, then delete it and **verify
> `/Users/otis/Cycling App/data/intent-overlays.json` still does not exist.** Never point a write at the
> primary athlete data. The temporary verification test must be deleted before the final commit and never
> staged.
>
> **The live smoke run is not satisfied by a 200 response.** Read the model's actual output and judge it:
> did it invent a number absent from the note, and did grounding catch it? Did it mark a qualitative
> objective measurable? Is the score defensible against the note a human would read? Report the raw note,
> the parsed objectives, each one's scope, the verdict, and the token/cost delta.
>
> **Do not run `npm run finish:agent-task`.** Stop after Task 9's commit and report. A Claude review
> gates this branch (`WORKFLOW.md § Reviewing a codex PR`).
>
> When done, report: which tasks completed, the commit SHAs, `npm run check` output, the real numbers
> Task 9 Step 2 printed, the full live-smoke output and your judgement of it, proof the primary data
> directory was never written, anything where the plan and the code disagreed, and anything you were
> unsure about.

### After Codex finishes

Ask a Claude session: **"review PR #`<n>`"** — or **"review the `codex/adaptive-coach-p2b-intent-scoring`
branch against its plan."**

The review must re-verify by simulating the data lifecycle by hand, not by reading test names:

1. every new read of `origin`, `status`, `supersededBy`, `activityId`, `legacy`,
   `effectiveWorkoutType` or `autoFromDate` — including in `SyncProvider.tsx` and the new route;
2. that no path exists by which LLM confidence promotes scoreability;
3. that no path writes an overlay for a date before `autoFromDate`;
4. that a transient parse failure leaves the ride re-parseable on the next run;
5. that the producer (`buildOverlay`) and the consumer (`isApplicable`) agree on all five outcome rows;
6. that a `pending` or `disabled` record is neither re-parsed nor applied;
7. that `POST /api/sync` still reaches no Anthropic call;
8. that the primary `data/` directory was not written during verification.

A green suite whose fixtures encode the wrong expectation is the failure mode this feature's own
history has now demonstrated three times — and this plan's own first draft made it a fourth.
