# Proven workout library generation — Design

**Date:** 2026-08-02  
**Status:** Design approved 2026-08-02; re-scoped 2026-08-05 (athlete decision) to defer automatic
evidence-based promotion and the historical bootstrap — see §5a and §12. Corrected 2026-08-11 against a
hostile review that verified 7 real gaps against the live codebase (event slots, Z2 template coverage,
durability-template provenance, backup/critical-file protection, AI provenance, export idempotency,
RaceSim reservation) — see §3, §5, §6, §7, §8, §10, §11.  
**Supersedes:** `2026-07-18-workout-library-sync-design.md` (retired 2026-08-05) — its manual-push-to-Intervals.icu
mechanism is folded into §8 below; do not implement it separately.

## 1. Problem

Block generation currently asks Claude to author every session even when NodeVelo has already prescribed
and observed successful quality workouts. This repeats work, spends the same generation cost as the
library grows, and does not turn execution history into reusable training assets.

NodeVelo will build a local, evidence-backed library of proven quality workouts. Existing deterministic
block logic remains responsible for focus, weekly volume, session budgets, placement, sequencing, and
slot constraints. The library fills compatible quality slots with unchanged prescriptions; Claude
authors only quality slots that have no suitable match. Fixed templates cover routine endurance work.

## 2. Goals and non-goals

### Goals (v1)

- Allow the athlete to promote a personally valued completed workout manually.
- Reuse proven prescriptions unchanged while preserving existing block-creation rules.
- Reduce workout-authoring calls as the athlete manually curates the library.
- Export every promoted workout to Intervals.icu without making that service the source of truth.
- Make selection, provenance, evidence, retirement, and export state inspectable.

### Non-goals (v1)

- Replacing season selection, the block skeleton, scheduling, nutrition, or validators.
- Learning Z2, Recovery, Rest, or Strength prescriptions from execution history.
- Scaling or editing proven workout steps to fit a slot.
- A workout editor, ratings system, folders UI, duplicate-merging UI, or savings dashboard.
- Depending on Intervals.icu availability during block generation.
- **Automatic evidence-based promotion and the historical bootstrap** — deferred to a later slice, see
  §5a. `applyEvidence`'s score-threshold rules (Task 1, already shipped) stay in the codebase as a tested,
  unused-for-now primitive; nothing calls it in v1.

## 3. Architecture

The existing deterministic engines remain authoritative for:

- season focus and session requirements;
- weekly hours and recovery structure;
- day placement, sequencing, and quality-session budget;
- slot workout type and duration envelope;
- nutrition targets and validation.

After `computeBlockSkeleton`, a new selector attempts to fill each **quality slot** from the local
library — defined for this document as any `DaySlot` with `kind: "quality"` *or* `kind: "event"`. A
calendar event forces `kind: "event"` on its day with `allowedTypes: ["RaceSim"]`
(`block-skeleton.ts`'s event-override render step) — a real, live mechanism (event-aware race planning),
not a dormant one, so an event day needs exactly the same library-or-AI treatment as any other RaceSim
quality slot. Every "quality slot" reference in this document (§6, §7) includes event-kind slots unless
stated otherwise. Learned entries are limited to `Threshold`, `VO2max`, `SIT`, and `RaceSim`.

Z2 uses one **parameterized** template (warmup → steady → cooldown, its steady segment scaled to fill
whatever duration the slot's envelope asks for) covering the athlete's full configurable long-ride range
(`longRideDurationMinutes`, validated 60–480 min in `app/api/settings/route.ts`) — not a fixed set of
duration points, which would leave most of that legal range with no matching template. The template
applies only when the week's long ride is supposed to be unbroken Z2: the block's rotating durability
template (`lib/durability.ts`, A–E, selected once per block and stamped onto every long-ride day
regardless of how that day's content was actually produced) governs this. Template A ("pure
accumulation") and any recovery week are unbroken Z2 by definition — the deterministic template applies.
Templates B–E prescribe embedded harder efforts placed late in the ride, described as fuzzy prose ranges
meant for an LLM to phrase into a concrete schedule (e.g. "~2–3h steady, then 2–3 × 8–15min threshold"),
not a fixed structure a deterministic template could mechanically implement without inventing a new
range-picking scheduler. Those long-ride days are therefore never template-filled — they route through
the same missing-slot AI-authoring path as quality slots, carrying `formatDurabilityForPrompt`'s existing
instruction, exactly as today's pre-plan generator already does. This keeps the `durabilityTemplate`
stamp (`app/api/write/route.ts`) honest: it's written unconditionally onto every long-ride day, so a
generic Z2 template silently standing in for a B–E prescription would otherwise be false provenance —
the record would claim embedded work the athlete never received. Recovery remains deterministic. Rest and
Strength stay outside the library; configured Strength days use one static, existing-KB-backed
prescription so they do not require workout authoring.

Library prescriptions are immutable. Selection controls where an entry is used but cannot resize,
rewrite, or otherwise adapt its steps. If no active entry satisfies a slot, Claude authors only that
missing quality session with the surrounding week, focus, adjacent sessions, and slot constraints in
context. Once all days are assembled, the existing repair and validation pipeline runs over the whole
block. A separate cheap call writes the overview; on failure, generation returns the valid block with a
deterministic fallback overview.

NodeVelo's local JSON store is authoritative. Intervals.icu is an athlete-facing export mirror and is
never read during generation.

## 4. Library record and identity

Each normalized quality prescription has one record:

```ts
type WorkoutLibraryEntry = {
  id: string;
  workoutType: "Threshold" | "VO2max" | "SIT" | "RaceSim";
  durationMin: number;
  workoutText: string;
  status: "candidate" | "active" | "retired";
  promotedBy?: "automatic" | "manual";
  evidence: Array<{
    date: string;
    executionScore: number;
  }>;
  useCount: number;
  createdAt: string;
  promotedAt?: string;
  intervalsExport?: {
    status: "pending" | "synced" | "failed";
    workoutId?: string;
    error?: string;
  };
};
```

The stable `id` is a hash of normalized structured steps. Normalization removes names, dates, and
prose-only differences while preserving step order, repetitions, durations, and targets. Two rides
count as evidence for the same prescription only when their normalized structured steps match.

The prescription fields are immutable. Evidence, usage count, status, and export state may change.
Evidence dates are unique.

## 5. Promotion and retirement (v1: manual only)

In v1, the only way a prescription enters the library is an explicit athlete action: manual promotion
of a completed quality session. It requires at least one completed, non-compromised ride and overrides
the score thresholds described in §5a, but not structural safety checks. Manual promotion sets
`status: "active"` and `promotedBy: "manual"` directly — there is no `"candidate"` state to pass through
in v1, since nothing else creates entries.

"Completed" is not prose shorthand for "has a score" — the app already models this precisely as
`SessionDisposition` (`data/dispositions.json`, read via `readDispositions()`): `"completed" | "partial" |
"missed" | "compromised"`. A partial (cut-short) ride can still receive a real `executionScore` for what
was ridden, so promotion must not accept a `"partial"`-tagged ride just because a score exists.

Disposition tagging is athlete-optional, not a required step on every ride — `SessionDisposition.tsx`'s
own comment frames it as "the fact the system can't infer," and the rest of the codebase already treats
an absent entry as no negative signal (`lib/reschedule.ts`'s eligibility check, `compromisedDates()`).
Most fully-ridden sessions never get an explicit tag at all, so requiring a literal `"completed"` entry
would reject nearly every real ride. The correct check is the same shape used elsewhere: reject only on
an **explicit** `"partial"`, `"missed"`, or `"compromised"` entry for that date; no entry, or an explicit
`"completed"` one, is eligible.

A promotion (manual, in v1) requires:

- a supported quality workout type;
- non-empty structured workout steps;
- no severe protocol violation under current validation rules; and
- no explicit `data/dispositions.json` entry for that date tagged `"partial"`, `"missed"`, or
  `"compromised"` — absence of an entry, or an explicit `"completed"` one, both qualify.

Retirement prevents future selection but preserves the prescription, evidence, usage, and export
history. New evidence never restores a retired entry automatically. Restore is an explicit athlete
action.

## 5a. Deferred: automatic evidence-based promotion + historical bootstrap

Not built in v1 (athlete decision, 2026-08-05) — real evidence is sparse enough right now (see §13) that
wiring this up before it can prove itself isn't worth the persistence/locking/bootstrap surface it needs.
Recorded here so the follow-on slice has a design to build from rather than starting cold:

A completed prescription would become active automatically when either condition is met:

1. one uncompromised execution has `executionScore >= 8`; or
2. two distinct uncompromised executions of the same normalized prescription each have
   `executionScore >= 6`.

Scores below 6 would not contribute qualifying evidence. On first use, one truthy-marker-guarded,
idempotent bootstrap would scan current-block and enriched block-history days; when a preserved
prescription can be joined by date to a frozen score-ledger entry, the same evidence and promotion rules
would apply. Days without preserved prescriptions would be skipped; no workout would be reconstructed or
guessed, and the append-only score ledger would never be mutated. Going forward (not just the historical
backfill), each newly-scored ride would be matched by fingerprint against existing entries and folded in
via `applyEvidence` (Task 1, already shipped and tested — this is its intended caller).

Reopen this slice once the manually-curated library has enough real usage to show whether repeat
prescriptions are common enough for the two-distinct-≥6 path to ever fire in practice.

## 6. Matching and selection

For each quality slot (`kind: "quality"` or `kind: "event"`, §3), selection filters active entries by:

- exact required workout type;
- duration inside the skeleton's existing slot envelope;
- compatibility with current session requirements; and
- passing current protocol validation.

Eligible entries are ranked deterministically by:

1. strongest execution evidence (highest single score);
2. most qualifying evidence instances at that strength — repeated proof of the same peak outranks a
   one-off, before duration is even considered;
3. closest duration to the slot's nominal duration;
4. fewest recent uses; and
5. stable entry ID as the final tie-breaker.

Repeated evidence ranks above a manual promotion with weak evidence; manual promotion grants
eligibility but does not invent a high score. An entry may appear only once in a block while another
eligible entry of the same type exists. Reuse within a block is allowed only when no alternative can
fill the required type and slot.

**Fill order protects block-wide type requirements before greedy ranking.** Only the block's first
loading-week quality slot is locked to the season focus type; every other quality slot is flexible across
all four learned types (`block-skeleton.ts`'s `flexibleSlot` case) — which is exactly where
`deriveSessionRequirements`'s block-wide floors (e.g. `requireRaceSim`: "the block must carry ≥1 RaceSim
session somewhere") get satisfied today. A single greedy pass that fills every flexible slot by
type-agnostic best-match ranking can exhaust all of them with, say, Threshold entries before any
requirement check runs — leaving no slot free for AI to place the missing RaceSim either, since only
*uncovered* slots reach AI authoring (§7). So selection runs two passes: first, for each unmet block-wide
requirement, reserve and fill (from the library if a matching active entry exists, else leave uncovered
for AI) one flexible slot of the required type; only then does the ordinary best-match ranking fill the
remaining flexible slots. This doesn't newly guarantee the floor — `validateSessionRequirements` has
always been a warn-only check, unchanged here — it just keeps the library from making that warning fire
*more* often than it already does today.

An AI-authored fallback is a candidate, not an active entry. It must later satisfy the same execution
or manual-promotion rules.

## 7. Generation flow and provenance

The assembled plan preserves the existing two-phase contract: generation proposes and `/api/write`
commits. Library promotion and export occur from an explicit manual action (§5), not from
`/api/generate` — and not from score/history processing in v1 (§5a is deferred).

Each generated day records one source:

- `library:<entry-id>`;
- `template:z2-<duration-min>` (the parameterized template, §3 — e.g. `template:z2-150`, not one of a
  fixed set of names); or
- `ai:<model>/<prompt-version>`.

AI usage records distinguish missing-slot authoring from overview writing. This permits later reporting
of coverage and avoided authoring calls without adding a dashboard in this release.

**AI-authored slots include event-kind quality sessions and any durability-template-driven long-ride day
(§3)** — not only `kind: "quality"` dates. The missing-slot request context carries
`formatDurabilityForPrompt`'s instruction for any requested long-ride date so the athlete still gets the
block's actual durability prescription (B–E) rather than a plain Z2 fallback.

If every quality slot is covered, NodeVelo makes no workout-authoring call. It still makes the cheap
overview call. If only some slots are covered, one bounded authoring request produces the missing
quality sessions only; it must not rewrite library- or template-backed days.

**`GeneratedPlan`'s single `model`/`promptVersion`/`raw` fields don't fit a plan that can now involve zero,
one, or two distinct AI calls with different models** (the missing-slot call, and a separate
`QUICK_MODEL` overview call — implementation plan Task 6). `sources` already gives per-day attribution for the
slot-authoring call (the `ai:<model>/<prompt-version>` form above); the actual gap is narrower than "no
provenance at all." Fix: make `model`/`promptVersion`/`raw` optional (a full-coverage block makes no
slot-authoring call, so there's nothing to put there — they currently aren't optional in the type even
though this design's own §3 requires that case to exist), and add a small `overview?: { model: string;
raw: string }` for the second call rather than conflating two AI responses into one field.

## 8. Intervals.icu export

Every promotion (manual, in v1 — see §5a for the deferred automatic path) immediately marks export
`pending` and attempts to create the workout in the appropriate `NodeVelo — <WorkoutType>` folder.
Successful export stores the remote workout ID and marks the entry `synced`. Because v1 only ever
promotes one entry at a time from an explicit athlete action, export is a single-entry call from the
promotion route — no bulk "sweep pending entries" pass is needed until §5a's bootstrap ships.

Export failure marks the entry `failed` with a displayable error. The local active entry remains usable
and block generation continues normally. Retry is explicit and idempotent: an entry with a stored remote
workout ID is never created again.

**"Never created again" needs more than reading local state before the POST.** Doing the remote create
outside the JSON lock (deliberate — a slow network call shouldn't hold the file lock, §10) and persisting
the result after means two genuinely concurrent triggers for the same entry (a double-clicked retry, two
open tabs) can each read "not yet synced" and both create a remote workout before either persists; a
crash between a successful POST and the local persist leaves an orphaned remote duplicate no local state
even remembers to check for. A per-entry in-process single-flight closes the concurrent-request case but
can't survive the crash case — that needs a remote lookup by the entry's deterministic identity
(workout name already encodes the entry's `id`-prefix, §3) before creating, so a retry after a crash finds
its own prior orphan instead of making a second one.

This replaces the earlier sync design's manual-only export trigger for this feature. Its confirmed
reuse of `workoutText` as Intervals.icu's structured `description`, folder convention, and dedicated
export plumbing remain applicable.

## 9. UI

The first release adds a Workout Library view with active, candidate, and retired sections — kept in
this shape even though v1's "candidate" section is always empty (nothing creates a candidate without
§5a), so the later slice doesn't force a UI rework. Each entry shows:

- workout type and duration;
- qualifying evidence count plus best and most recent score;
- manual promotion source (v1 — `promotedBy` will also read `"automatic"` once §5a ships);
- usage count;
- active or retired state; and
- Intervals.icu export state.

Available actions are Retire, Restore, and Retry export. Completed quality-session surfaces expose
`Add to library` when the prescription is not active. A blocked manual promotion explains the concrete
structural or protocol reason. Editing, ratings, folder management, and duplicate merging are omitted.

## 10. Failure handling

- **Library read or parse failure:** stop before spending an AI call and return a local-data error.
- **No eligible match:** author only the uncovered quality slot or slots.
- **Slot-authoring failure:** fail generation without persisting a partial block.
- **Overview failure:** return the valid assembled block with deterministic fallback prose.
- **Intervals.icu export failure:** retain the local entry, mark export failed, and allow retry.
- **Current validator rejects a stored entry:** exclude it from selection without silently retiring it;
  show the validation issue in the library view.
- **Concurrent promotion/retry:** use `updateJsonFile` locking and re-check state inside the lock.
- **Double corruption (live file and `.bak` both unreadable):** `workout-library.json` must join
  `json-store.ts`'s `CRITICAL` set (same as `score-log.json`, `current-block.json`, and 6 other
  irreplaceable stores) — otherwise a promoted, evidence-backed library is exactly the kind of data this
  set exists to protect, but reads would silently fall back to `{entries: []}` and a subsequent write
  could persist that empty state as truth. Matches the codebase's existing convention: reads stay lenient
  everywhere (never throw), only the write path refuses to entrench a corrupt fallback — no new "throw on
  read" behavior is needed, just the `CRITICAL` membership.

## 11. Verification

Automated checks cover:

- fingerprint normalization, stable identity, and evidence-date de-duplication;
- manual promotion gates, including compromised rides (the automatic score-threshold gates and
  aggregation-across-two-dates path already have unit coverage on the pure `applyEvidence` primitive from
  Task 1; no live caller exists to test end-to-end until §5a);
- retirement, restoration, and validation-based selection exclusion;
- deterministic filtering, ranking, tie-breaking, and within-block repetition policy, including that a
  block-wide requirement (e.g. `requireRaceSim`) reserves a flexible slot before greedy ranking consumes
  it (§6);
- the parameterized Z2 template across the full 60–480 min settings range, and that it is *not* selected
  when the block's active durability template is B–E outside a recovery week (§3);
- event-kind (`kind: "event"`) slots filled identically to quality slots, by both the library pass and
  the AI-authoring fallback (§3, §7);
- mixed library/AI assembly and complete-library assembly;
- proof that a fully covered block makes no workout-authoring call;
- full-plan repair and validation after mixed-source assembly;
- source provenance and usage counting only on accepted blocks;
- export idempotency under concurrent triggers and a simulated crash-after-POST, not just sequential
  retry (§8);
- `workout-library.json`'s `CRITICAL`-set membership: a simulated double corruption must refuse to
  persist the empty fallback as truth (§10); and
- API/UI behavior for manual promotion and library management.

Before completion, run one live partial-coverage generation, one live full-coverage generation, and one
real Intervals.icu export. Confirm the full-coverage run skips workout authoring and confirm the exported
workout renders as structured steps in Intervals.icu.

## 12. Scope boundary

This is one feature delivered in slices, not a replacement training engine. The implementation plan
must preserve the current block skeleton and validators, establish the local library and promotion flow
first, then change generation to consume it. Savings dashboards, automatic workout adaptation,
non-quality learned workouts, and — per the 2026-08-05 re-scope — automatic evidence-based promotion
and the historical bootstrap (§5a) require separate evidence and design work, deferred until the
manually-curated library shows real usage.

## 13. Known rough edges

- **The library starts and stays empty until the athlete acts.** v1 has no automatic path in (§5a is
  deferred), so library growth is bounded entirely by how often the athlete clicks "Add to library" on a
  completed quality day. This is expected, not a bug — don't read a quiet library as the feature failing.
- **Fingerprint stability is coupled to prompt stability.** `PROMPT_VERSION` bumps or model changes can
  shift how Claude phrases an otherwise-equivalent prescription (step ordering, rep grouping), producing
  a new fingerprint for what an athlete would call "the same workout." Low-stakes in v1 (fingerprints
  only need to match a slot's requirements, not each other, since there's no automatic aggregation
  path yet) but relevant again once §5a ships and cross-date matching starts to matter.
- **Durability templates B–E keep a permanent AI-cost floor.** Even a fully mature library can't
  eliminate authoring cost for every long-ride day — B–E's embedded-effort structures are fuzzy prose
  ranges an LLM interprets, not a fixed schedule, so those days always route through AI authoring (§3).
  Only template A and recovery weeks are template-fillable. This is a real, permanent characteristic of
  the durability-rotation design, not a gap this feature is expected to close.
- **Real evidence volume, for scoping §5a later:** the current 147-entry score ledger has only ~12 rides
  across the three learned types besides RaceSim scoring ≥8 (the single-execution path); the
  two-distinct-≥6 path additionally needs an exact normalized-fingerprint repeat, which freehand AI
  authoring has no obligation to produce. Whatever the manually-curated library shows about how often
  athletes reuse near-identical prescriptions is more informative than this historical snapshot for
  deciding whether §5a is worth building.
