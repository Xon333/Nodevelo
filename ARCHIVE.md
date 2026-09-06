# NodeVelo — archive (completed work)

A record of shipped work, kept out of the lean live trackers so they stay readable.

- **Live punch-list** (incoming bugs / feedback): [todo.md](todo.md)
- **Forward backlog** (what's next): [ROADMAP.md](ROADMAP.md)
- **Research spikes** (not committed): [research.md](research.md)
- **This file**: everything already done.

Entries are grouped by theme. Most reference the module(s) touched; see git history for the
exact commits.

---

## Agent instruction cleanup (2026-09-06)

Made context reads conditional, removed routine skill approval gates, and aligned operating docs
with the owner's Codex-only workflow. Web skill entrypoints now route to detailed references;
CLAUDE.md remains a single import of AGENTS.md. Required checks and project safeguards remain.

---

## MA-1 — Preserve intent retries after interval HTTP failure (2026-09-05)

The deterministic intent runner now opts into interval-fetch errors, leaving the note eligible for
retry instead of persisting missing evidence after a provider outage. Sync retains its best-effort
fallback. A real-adapter HTTP 503 regression fails before the fix and passes afterward, including
same-note retry; targeted suites pass 61 tests and the full gate passes 2,512. Historical overlays
remain unchanged. See the [maintainer audit](docs/reviews/2026-09-05-maintainer-audit.md).

---

## FR-3 / FR-4 core-journey audit and selection (2026-09-01)

The [accepted FR-3 audit](docs/reviews/2026-09-01-fr3-core-journey-audit.md) exercised Today → Plan
→ ride → closeout → adaptive week and ranked observed failures by trust and task completion.
FR-4 selected exactly one: FR3-01, where an early-end retrospective evaluated the athlete against
unlived future sessions. The approved
[design](docs/superpowers/specs/2026-09-01-fr13-early-end-retrospective-window-design.md) and
[implementation plan](docs/superpowers/plans/2026-09-01-fr13-early-end-retrospective-window.md)
bound the correction to the retrospective input window as additive package FR-13. Adaptive-roadmap
staleness, preview persistence, prose cleanup, and the other audit observations remain outside it.

---

## FR-13 — early-end retrospective effective window (2026-09)

- **Evidence:** [FR3-01](docs/reviews/2026-09-01-fr3-core-journey-audit.md#fr3-01--early-end-narrative-grades-the-unlived-future)
- **Design:** [accepted design](docs/superpowers/specs/2026-09-01-fr13-early-end-retrospective-window-design.md)
- **Plan:** [implementation plan](docs/superpowers/plans/2026-09-01-fr13-early-end-retrospective-window.md)
- **Acceptance:** [attended verification](docs/reviews/2026-09-01-fr13-acceptance.md)
- **Shipped:** one effective closeout date now bounds planned and actual retrospective inputs,
  persisted history hours, and block-window language evidence. Normal completion still covers the
  full block; deterministic closeout and FR-5 authority boundaries are unchanged.

---

## FR-5 deterministic generation authority (2026-08-30)

The approved [design](docs/superpowers/specs/2026-08-29-fr5-deterministic-authority-design.md) and
[implementation plan](docs/superpowers/plans/2026-08-29-fr5-deterministic-authority.md) replaced
AI-authored block composition with a pure TypeScript compiler. Loading target and availability are
separate settings; every cycling workout uses one typed target family, canonical Intervals.icu
render/parse equality, deterministic progression, and the existing publication gate. The generation
route works with Anthropic unset and remains preview-only; `/api/write` is still the sole calendar
commit path. Anthropic remains only for optional ride-analysis and retrospective language.

This supersedes every historical statement below that approved or adopted retrospective seeds,
reflections, directives, or knowledge-base prose can steer generation. Those approval/adoption stamps
now record acknowledgement and workflow history only; deterministic generation never reads them.

The [acceptance record](docs/reviews/2026-08-29-fr5-acceptance.md) closes FR-5: five varied
Anthropic-unset generations were stable across two runs with zero blockers, the owner-approved plan
published cleanly to Intervals.icu, and the owner confirmed the representative Wahoo workouts were
acceptable with no problematic degradation reported.

---

## Named-segment intent scoring (2026-08-19 → 2026-08-23)

A note describing several named Intervals.icu segments was graded against whole-ride zone-time
arrays: each segment's zone claim consumed the aggregate array, merging distinct segments into
misleading whole-ride phase objectives. Live reproduction (2026-08-19, activity `i177434779`; four
segments — Rolling Terrain 1 / Flat 1 / Flat 2 / Short Effort): the ride scored **5/10** on merged
whole-ride claims like "31.6 min in Z3 vs 65" instead of its four actual segment-local comparisons.

- **NV-15 · `lib/intent-scoring.ts`:** `segmentLabelKey` normalizes a curated label;
  `matchSegment` accepts one exact normalized-label match first, then exactly one `<label><n>`
  numbered variant — anything else (missing, multiple exact, multiple suffix, stem already ending in
  digits) stays ungraded rather than guessed. `gradeSegment` grades only that lap: duration vs stated
  range, average-power and normalized-power zones from the lap's own watts against ride-date FTP zone
  tops, never whole-ride zone seconds; a matched lap with no avg/NP reading is also ungraded.
   Segment-backed objectives subsume duplicate whole-ride claims from the same source span; each scored
   segment contributes within its ±3 kind band, with a +1 ride-order bonus when at least two scored
   segments have strictly increasing lap start indices (a single scored segment earns no order point)
   and a +1 all-precise bonus (precise = every stated component fully compliant under the shipped
   semantics: duration inside its stated range and each stated avg/NP watts inside its stated zone).
- **Today hold (`components/dashboard/today.tsx`):** while a noted unplanned ride's intent is still
  being evaluated, Today shows "Evaluating your intent…" instead of a generic off-plan score, so a
  fast sync render never exposes a score the pending analysis is about to replace.
- **Deterministic extraction (2026-08-23):** `lib/intent-note-parser.ts` replaced Claude intent
  identification with strict per-bullet parsing of labelled segment duration, average-power zone, and
  normalized-power zone targets. Synced Intervals.icu laps are authoritative; malformed siblings,
  missing labels, and ambiguous labels never cause guesses, and only stated components earn points.
  Claude receives the finished score/evidence only when writing optional coach prose. A live forced
  sync/re-analysis of activity `i178790011` scored **9/10** from Block 1 / Effort 1 / Effort 2 / Block 2,
  with four segment-local evidence rows and deterministic parser provenance. A live Sonnet smoke at
  `PROMPT_VERSION = 9` preserved that verdict and phrased the supplied evidence without recomputing it.
- **Verified (live re-analysis 2026-08-23):** re-running the August 19 activity (`i177434779`)
  superseded its schema-1 overlay transactionally and persisted overlay `edfc5d9d`
  (schemaVersion 2, scoringVersion 2) scoring **9/10** from four separate `segment` objectives
  matching Rolling Terrain 1 / Flat 1 / Flat 2 / Short Effort, with segment evidence watts
   238/263, 220, 190/214, and 285/309 — the 220 W evidence marked precise (fully compliant per
   component under shipped semantics: Flat 1's duration inside its 45–60m range and its 220 W average
   watts inside its stated Z3) and zero whole-ride
  "min in Z" evidence strings. The ride resolved **`Recovery`**, not `Rest`: the live purpose
  paraphrase contained "Z2 recovery flat", which matches a designed purpose-pattern precedence —
  this is intended behavior, not a misclassification. Genuinely whole-ride zone objectives are
  unchanged.

## Adversarial-review trust-contract closeout (2026-08-20 → 2026-08-27)

The accepted [adversarial investment review](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md)
remains the freeze's master decision record. The following implementation risks are now closed in
code; prospective effectiveness evidence remains open in
[ROADMAP FR-9](ROADMAP.md#fr-9--prospective-cycle-evidence--evidence-accumulates-throughout-the-freeze).

| Review decision/risk | Shipped resolution |
|---|---|
| [Calendar/local divergence](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#calendar-and-persistence-integrity) | PR #87 commits local state before best-effort calendar mirroring and preserves CAS conflicts. |
| [Unsafe retrospective progression and self-reinforcing AI lessons](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#retrospective-and-turnover) | PRs #92/#94 separate deterministic closeout facts, optional AI prose, and explicitly adopted future seeds/reflections. |
| [Named-segment false credit](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#named-segments-and-intent-parsing) | PR #96 makes the authoritative labelled lane deterministic and scored from matched interval evidence; the simpler adjacent-zone grading contract remains an explicit deferred decision. |
| [Publishable structural/safety hazards](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#plan-safety-and-claudes-authority) | PR #97 adds the persisted publication gate: blockers refuse, preferences require acknowledgment, advisories remain informational. |
| [Silent stale physiology](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#intervalsicu-ownership-privacy-and-recovery) | PR #101 exposes freshness, permits temporary sync failure with last-valid data, and blocks missing, malformed, inconsistent, or obsolete physiology. |
| [Causal claims, redundant AI criticism, Ask Coach, and privacy ambiguity](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#disable-remove-or-rewrite) | PR #103 removes causal/injury-risk product claims and Ask Coach, replaces the narrative critic with deterministic overview checks, labels retained AI prose, and separates local persistence from remote Anthropic processing. |

---

## FR-2 restore and critical-state honesty (2026-08-28)

Exact version-1 whole-tree restore now ships as a staged replacement of the managed `data/` and
`knowledge-base/` trees: validation happens before mutation, partial success is rejected, ordinary
swap failures roll back, the accepted crash boundary is stated plainly, and the critical JSON set is
owned in one code list. `lib/kb-loader.ts` now uses atomic temp-file + `fsync` + rename writes for
Markdown mutations, and the final docs sync landed in `16d68a9`.

---

## FR-1 current-generation evidence run (2026-08-28)

The attended current-code synthetic four-week generation completed and was inspected end to end;
its [evidence entry](docs/reviews/2026-08-24-publication-gate-evidence.md#2026-08-28--fr-1-current-code-synthetic-four-week-generation)
records complete structure, fresh physiology, no manual repairs, and a blocked publication verdict.
The run falsified readiness rather than proving it: duration reconciliation left week 1 33 minutes
short, and deterministic skeleton placement conflicted with the sequencing validator in weeks 1–2.
It does not count toward the five structurally valid generations. By explicit owner decision, FR-1
closes as an evidence task and those findings now feed FR-5's deterministic-authority audit.

---

## Trust-contract repairs — calendar mirroring + retrospective closeout (2026-08-22/23, PRs #87/#92/#94)

Two Phase 1 trust contracts shipped back-to-back. PR #87 was reviewed shallow post-merge and
judged SOUND; PR #92 was reviewed at head `bfa2497` with no critical findings, suite green, and
`tsc` clean. PR #94 then shipped the retrospective hardening follow-ups.

- **Calendar trust contract (PR #87, merged 2026-08-22):** `persistMirroredMove`
  (`lib/calendar-mirror.ts`) now commits the authoritative local move under the current-block lock
  *before* any Intervals.icu network call ([INVARIANTS #8](docs/INVARIANTS.md)), aborts with
  `versionConflict` when the block was concurrently deleted or replaced (morning-check surfaces the
  409 instead of consuming the check — [INVARIANTS #7](docs/INVARIANTS.md)), and overlays freshly
  minted mirror eventIds via a targeted lock-held `updateCurrentBlock` rather than re-merging days.
- **Retrospective turnover trust contract (PR #92, merged 2026-08-23):** closeout is
  deterministic-first — evidence and proposed seeds are computed read-only from the frozen ledger
  (`lib/block-closeout.ts`); Claude's narrative/reflections are best-effort enrichment (degraded
  mode returns 200 + `narrativeDegraded`, facts still land); closing an unfinished block requires an
  explicit early-end reason (409 otherwise). Nothing AI-authored steers generation until adoption:
  `POST /api/history` flips `seeds_approved: true` on the retro markdown frontmatter and stamps
  `reflectionsApprovedAt` on the newest reflection-bearing history entry. Degraded closeouts resist
  bare-archive collisions (HR-37 extension) and render a deterministic fallback card, never blank.
  **Deferred:** the live LLM smoke run for the changed retrospective paths is owed at the next real
  block turnover — see [RECIPES § block turnover](docs/RECIPES.md#turn-over-a-block-end--retrospective--next-block).
  **Hardening (PR #94, merged 2026-08-23):** bumped `PROMPT_VERSION` to 8 for the changed
  model-visible context, made YAML quote escaping lossless for goals, reasons, and seeds, scoped
  seed parsing/approval to frontmatter, preserved partial-adoption repair and retry semantics,
  and added approved-only generation-path regression coverage.

- **Publication gate (PR #97, merged 2026-08-23):** `lib/publication-gate.ts` classifies validator
  output into non-overridable blockers and explicit-acknowledgment preferences. Generation persists
  a hash-bound verdict in `generation-gate.json`; `/api/write` rejects unknown, tampered, blocked,
  or unacknowledged plans before any calendar mutation, and records override provenance on the
  published block. Long-term prospective evidence remains open in the [publication-gate evidence
  log](docs/reviews/2026-08-24-publication-gate-evidence.md).

---

## Whole-repo hostile review closeout — HR-60…HR-72 (2026-08-15; workflow closeout 2026-08-21)

- **HR-60/61:** corrected local-date handling in the learning loop and made UTC defaults explicit.
- **HR-62:** made `npm run sync` remove clean worktrees whose branches have merged.
- **HR-63/64:** repaired broken documentation pointers and added link checking to `npm run check`.
- **HR-65:** made `.agents/skills/` the canonical skill home and replaced duplicate Claude skill
  directories with compatibility symlinks.
- **HR-67/68/70:** cleared lint warnings, removed a dead todo entry, and narrowed 18 unnecessary exports.
- **HR-71/72:** recorded as already-routed work: narrow workout-library integration and the existing
  AI-route cost-guard backlog item. They require no duplicate todo entries.

HR-66 and HR-69 still require human decisions and remain in [todo.md](todo.md).

---

## Debrief-audit data-integrity fixes — NV-9, NV-10, NV-11, NV-13 (2026-08-15)

First slice of the 2026-08-15 debrief audit (`todo.md`'s "Post-2026-08-15 debrief audit" block; full
14-item audit ~93% ground-truth-accurate). Sequenced ahead of the audit's own NV-10 remedy because
NV-9's defect is masked only by the current parser failure.

- **NV-9 · zone-array ingestion contract:** `zoneSecs` (`lib/intervals-api.ts`) now validates against
  the ride's `moving_time` at ingestion — the one boundary every consumer reads through — by trying
  progressively shorter prefixes for one that reproduces moving time within a 5%/30s tolerance. Drops
  Intervals.icu's overlapping "Sweet Spot"-style trailing bucket (live-confirmed: an 8-element power-zone
  array whose first 7 elements alone summed to the ride's moving time) instead of letting a downstream
  summing consumer (the intent scorer's denominator) read up to ~2x too much "zone time." No matching
  prefix → `null` (no evidence), never a silently wrong reading.
- **NV-13 · fuel-stamp freshness:** the sync route's live-today ledger patch (`app/api/sync/route.ts`)
  now also re-stamps `fuelStampFor` alongside its existing `calStampFor`/`intervals`/`easyStampFor`
  stamps — previously `mergeScoreLog`'s "existing overrides fresh" rule froze whatever fuel reading (or
  lack of one) the FIRST sync of the day produced, silently discarding carbs logged on Intervals.icu
  later the same day.
- **NV-11 · coasting-time denominator:** `fmtZones` (`lib/anthropic-prompts.ts`) now surfaces coasting/
  no-power time as an explicit clause (e.g. "Coasting/no-power 3% of ride time (179s)") alongside the
  power-zone line, computed from the exact moving-time seconds (`RideAnalysisInput.activityMovingTimeSec`,
  new field) rather than folding the gap silently into the classified-time denominator — the prior
  behaviour let "42% Z3" read as 42% of the whole ride when it was ~40.5%, hiding the exact behaviour
  ("limit coasting") a self-directed objective can be about. HR zones are unaffected — a gap in HR
  seconds is a sensor dropout, not a real physiological zero, so the clause is power-only.
- **NV-10 · parser diagnosability (PRs #55/#56):** a completed-but-unusable `parseRideIntent` response
  now returns a bounded, persisted failure category (`max-tokens` / `missing-tool-use` /
  `schema-invalid`, with the provider's raw `stop_reason` and sanitized Zod issue paths) instead of a
  bare `null` — `IntentOverlay` gains an optional `parseFailure` field, set only when
  `notScoredReason === "interpreter-failed"`. The live smoke run against 2026-08-15's actual failing
  note (fingerprint `521dd9525775bd29`, failed twice earlier that day with zero diagnostics) found a
  real bug in the categorisation itself: Anthropic assembles tool-input JSON in schema-field order, so
  a `max_tokens` cutoff can still leave a syntactically valid but incomplete `tool_use` block behind
  (`primaryPurpose`/`phases` complete, `objectives`/`confidence` never started) — the first cut of the
  logic mis-bucketed that as `schema-invalid` because a block technically existed. Fixed so
  `stop_reason === "max_tokens"` wins the category outright before checking whether a block parsed.
  That same run confirmed the leading (previously unconfirmed) hypothesis that `max_tokens: 900` was
  too tight for a multi-section note — raised to 1800, no longer a guess. Re-verified live after both
  fixes landed: the exact failing note now parses successfully end-to-end (`origin: self-directed`,
  `effectiveExecutionScore: 7`, grounded cadence evidence "89 rpm vs 90 rpm target, 99% adherence"),
  and the Today debrief renders it correctly in place of "Not scored — the ride note couldn't be
  parsed." NV-2's zone-syntax gap (`"3"`/`"2-3"` not matching the grounding regex) is now visible as
  the next open defect in the same overlay's objectives — expected, tracked separately.

## Split-brain debrief + not-scored-reason granularity — NV-1, NV-4 (2026-08-15, PR #58)

- **NV-1 · sequencing + evidence gating:** coach prose used to read the raw ride note independently of
  the intent parser's own verdict on that note, and ran BEFORE intent parsing completed
  (`components/SyncProvider.tsx` awaited `/api/analyze` first, then looped `/api/intent`) — so a note
  the parser was about to reject could still drive a confident, prose-only intent-execution judgment
  sitting right next to the debrief card's own "Not scored" state. Fixed on two levels, per the locked
  product decision: the intent-parsing loop now runs to completion before `/api/analyze` fires (order
  live-confirmed via network trace: `POST /api/intent` completes before `POST /api/analyze` starts),
  and `addCoachNote` (`lib/sync-analysis.ts`) reads today's now-guaranteed-resolved overlay and
  withholds the raw note from the prose prompt entirely when the parse genuinely failed
  (`notScoredReason === "interpreter-failed"`) — metric-level commentary only, same as a no-note ride.
  The raw note stays visible elsewhere on the page (the debrief's own "Your note" card); only the
  PROSE prompt is gated. Live-verified the reordering and the unaffected note-passthrough path against
  a real sync; the withhold branch itself is unit-tested (4 cases: interpreter-failed → withheld, no
  overlay → passed through, resolved overlay → passed through, superseded overlay ignored) but could
  not be live-fired the same day, since NV-10's fix (above) had already resolved the one real failure
  in play — noted as a live-verification gap, not a defect.
- **NV-4 · not-scored-reason granularity:** `assessScoreability`'s single `no-measurable-objectives`
  reason conflated four situations. Split using signals already available at the call site
  (`lib/intent-scoring.ts`): `gradableCount < 1` now distinguishes `no-measurable-objectives` (nothing
  of a gradable KIND was even stated) from `target-not-grounded` (a gradable-kind target was stated,
  but grounding rejected it); `scopeMin < required` now distinguishes `insufficient-scope` (something
  matched, just not enough of the ride) from `target-not-matched` (`scopeMin` exactly 0 despite a
  gradable, grounded target — nothing in the ride data matched it at all). All four remain compatible
  with `origin: "self-directed"`, exactly as the original single reason was. `NO_TRUSTWORTHY_INTENT`
  (`lib/intent-overlay.ts`) is now exported as the single source of truth for the reasons meaning the
  opposite (`unspecified`) — `buildOverlay`'s `selfDirected` derives from its negation instead of
  maintaining a second, driftable list of "which reasons count as self-directed."

## Zone-expression parsing unified — NV-2 (2026-08-15, PR #60)

`zoneIndex` (scoring, `lib/intent-scoring.ts`) accepted `"2"`/`"Z2"`/`"z2"`/`"zone 2"`; `groundsZone`
(grounding, `lib/intent-grounding.ts`) required the exact canonical `"Z2"` and rejected everything
else outright — live-confirmed on a real overlay: the model emitted `target.zone: "3"` with
`grounded: true`, the note literally said "z3 block", and `groundsZone` still returned "not grounded
in the note" because its input wasn't already canonical. Ranges like `"3-4"` (also seen verbatim in
production) were unparseable by either side.

- **`lib/zone-expression.ts` (new):** one shared `parseZoneExpression` — a bare digit, `"Z2"`/`"z2"`/
  `"zone 2"`, a range (`"Z3-4"`, `"3-4"`, `"Z3–Z4"`, `"zone 3 to 4"`), or a comma list (`"z2,z3"`) — all
  resolve to canonical `"Z<n>"` labels. `formatZoneLabel` renders a parsed set for evidence/debrief text
  (a contiguous range as `"Z3-Z4"`, a non-contiguous list as `"Z2/Z4"` so it can never read as implying
  the zones between). Fails closed (`[]`) on anything unparseable or a descending range.
- **`lib/intent-scoring.ts`:** `zoneIndex` now delegates to the shared parser (byte-identical behaviour
  for every existing single-zone input). `zoneMinutes` (and its generalized `readZoneArraySum`, replacing
  the old single-index-only `readZoneArray`) now SUMS across every zone a range/list target names.
- **`lib/intent-grounding.ts`:** `groundsZone` parses through the same shared parser and grounds on the
  note mentioning ANY zone within the claimed expression — presence-based, same leniency as every other
  `groundsX` check here.
- **Live-verified post-merge** by forcing a reparse of the real 2026-08-15 ride: a "15 minutes of varied
  terrain (Z2/Z3)" phase parsed to `target.zone: "Z2-Z3"`, grounded, and scored — the exact range-summing
  path exercised on real data, previously unrepresentable by either side.
- **Residual gap surfaced by that same live run, explicitly out of NV-2's scope:** the range scored
  `65.2 min in Z2-Z3 vs 15 min stated (435% of target)` — the scorer sums the WHOLE ride's Z2+Z3 time
  against a claim that only applied to the ride's final segment, because `zoneMinutes` has no notion of
  "the last 15 minutes." Documented as a known rough edge in
  [02-scoring-and-learning.md](docs/systems/02-scoring-and-learning.md#known-rough-edges) — fixing it
  needs zone-emphasis/zone-time routed through the same terrain/phase-matched-lap machinery
  `effort`/`terrain` objectives already use, a design change, not a parsing fix.

## Compound-label terrain matching narrowed — NV-3 (2026-08-15, PR #62)

`hasLabelHint`'s substring check ("does the label include this terrain word") matched BOTH "climb" and
"descent" on a lap labelled "Rolling climb/descents", so whichever terrain a target asked for first
claimed the whole lap as pure. Live-confirmed: such a lap graded as a pure 15.9-min descent (evidence:
`"15.9 min descent (labelled) — avg -0.6%, max 10.4%, VI 1.08"`) despite its own label naming a climb
too — the exact overlay that surfaced this is 2026-08-14's activity `i175672010`.

- **`isCompoundLabel`** (`lib/intent-scoring.ts`): a lap whose label contains both "climb" and
  "descent" substrings. `hasLabelHint` now returns false for EITHER terrain query on a compound label;
  `filterByTerrain` also excludes it from the gradient-fallback pool, not just label matching — the
  athlete's own label is stronger ground truth than a single peak/net gradient reading, so guessing
  which half applies would contradict it (mirrors P3c Gap A's "exclude from both terrains" precedent).
- **Needed no new data**, unlike P3c's Gap A (deferred 2026-08-14 for lack of a stream-level
  min-gradient field to detect a compound lap from gradient DATA) — the label TEXT itself already
  states both terrains. Narrows, not closes, Gap A: an *unlabelled* compound lap is still
  undetectable and remains open, documented in
  [02-scoring-and-learning.md](docs/systems/02-scoring-and-learning.md#known-rough-edges).
- **Verified the regression test actually exercises the bug** (not a tautology): reverted the fix
  locally, confirmed the new test fails against the exact real numbers from the live overlay
  (avg -0.6%, max 10.4%, label "Rolling climb/descents"), then restored the fix and confirmed it
  passes. Pure deterministic scoring change, no LLM call involved — no live smoke run needed.

## Evidence-bound prose + descending safety — NV-7, NV-5, NV-6 (2026-08-15, PR #64)

Live-confirmed defect: with `intervalComparison: null` and no per-segment evidence, the coach note
asserted "the aero position discipline and constant-pressure approach are **clearly working** as a
durability tool" — an athlete-REPORTED method (was the position actually held?) stated as a confirmed,
measured outcome. No sensor in this prompt can establish posture or skill quality.

Three unconditional instruction clauses added to `buildRideAnalysisPrompt`
(`lib/anthropic-prompts.ts`):

- **NV-7:** every claim must match its evidence tier — a number given in the prompt (power, HR,
  cadence, decoupling, zone-time) may be stated as measured fact; an inferred cause (terrain, a
  specific effort, fatigue) must stay hedged as likely/probably unless timestamped per-segment evidence
  is given (this prompt never gives any); a technique/position the athlete reports using may be
  connected to a measured outcome, but its own effectiveness is never itself measured.
- **NV-5 (narrowed):** a single ride's Pw:HR drift reading is a good/poor on-the-day durability signal
  only, never proof of a lasting physiological adaptation.
- **NV-6:** a low coasting share must never become blanket "stop coasting" advice — coasting and
  braking are the correct, safer choice in corners, traffic, on poor surfaces and technical descents.

**Live-verified post-merge** by forcing a real coach-note regeneration on the exact ride that surfaced
the defect (today's aero-position note, still no interval comparison). The new note: *"The Pw:HR drift
of -2.9% is a strong **on-the-day** aerobic durability signal"* (NV-5); *"The athlete-reported intent to
hold aero position... aligns with the measured outcome of 89 rpm... though **posture and technique
quality cannot be confirmed from the data alone**"* (NV-7 — the exact sentence the audit cited, now
correctly separating reported method from measured outcome); *"the Z4 spike **likely reflects** the
athlete-reported puncher effort"* (NV-7, hedged causality). `data/ai-usage.json`'s `updatedAt` matches
the call timestamp, confirming a real Anthropic call. **NV-6 caveat:** this note reported coasting
neutrally (3%, no escalation) rather than attempting a "stop coasting" recommendation, so the
constraint wasn't exercised against its actual counterfactual — no violation observed, but not a full
test either.

## Interval speed as evidence-only context — NV-14 (2026-08-15, PR #66)

`fetchIntervals` retained power/HR/cadence/gradient per curated interval but mapped no speed, so a
speed-at-power claim ("kept the speed up") couldn't be stated as measured evidence. Verified this does
NOT reopen Phase 2c's locked decision (which bans a distance/GPS *position-locator system*, while its
own bullet 4 admits "metrics already attached to each curated interval" — which `average_speed` is) —
follows Task 11's own precedent exactly (`avgCadence` was dropped for lacking a consumer, then
correctly added in P3b once one existed).

- **Gated on a live payload check first**, per the locked scope: fetched real curated intervals for
  two activities (`i175672010`, `i175980689`) before writing any code and confirmed `average_speed`
  (m/s) is present and populated on all 13 intervals across both — not assumed, matching the discipline
  that already caught `Maxgradient`'s odd casing.
- **`lib/types.ts`:** `ExecutedInterval` gains `avgSpeedKph`. Deliberately NOT added to `TargetSchema`
  (`lib/intent-schema.ts`, untouched) — no objective is ever scored on it. Speed is confounded by wind,
  drafting, surface and tyres in a way power/HR/cadence aren't; grading it would score the athlete on
  the weather.
- **`lib/intervals-api.ts`:** `fetchIntervals` maps `average_speed` → `avgSpeedKph` (× 3.6) at the one
  ingestion boundary. Unit-tested against the exact live-observed value (5.778887 m/s → 20.804 km/h).
- **`lib/intent-scoring.ts`:** `gradeTerrain` surfaces it in the matched-lap evidence string alongside
  gradient/VAM (both terrains, unlike VAM which is climb-only) — verified the delta/scored outcome is
  identical with or without `avgSpeedKph` present, so it's provably evidence, never a grading input.
- **Live-verification boundary, noted honestly:** forcing a fresh reparse of the real ride that
  originally carried a terrain claim found its only candidate lap now correctly excluded by NV-3's
  compound-lap fix (both of that note's real terrain mentions target the same "Rolling climb/descents"
  interval) — so the evidence-string attachment couldn't be observed on a currently-scored real
  objective this session. The field-mapping itself IS live-verified (13/13 real intervals, exact
  conversion math against the real observed value); the full loop (mapping → scored evidence text) is
  unit-tested but not yet seen end-to-end on a live overlay. Revisit once a note produces an
  unambiguous, non-compound terrain match.

## Prose truncation audit + off-plan label fix — NV-8, NV-12 (2026-08-15, PRs #68/#70/#69)

**NV-8:** `analyseRide` returned a bare string, discarding `stop_reason` entirely — a token-limit
cutoff mid-sentence was indistinguishable from a genuinely finished note. New `ProseResult` return
type (`{ text, truncated, stopReason }`, `lib/anthropic-api.ts`) mirrors `GenerationResult`'s existing
pattern; `addCoachNote` (`lib/sync-analysis.ts`) pushes a transient warning on truncation, never a
persisted field, and never blocks writing the note.

**Live-caught regression, same day, first run:** smoke-testing NV-8 against real production data
caught an actual truncation immediately — today's coach note cut off mid-sentence (*"For next session,
the"*). NV-7's evidence-bound-prose clauses (PR #64, shipped earlier the same day) lengthened what the
model needs to write to comply with them, and the `max_tokens: 280` ceiling — sized before NV-7 —
hadn't been revisited. Raised to 450 (PR #70), no longer a guess (same pattern as NV-10's intent-parsing
budget). Re-verified live against the exact same ride: the note now completes cleanly, and — a bonus
confirmation — its text explicitly declines to blame coasting outright (*"it's impossible to separate
intentional cornering/safety coasting from pedalling lapses"*), the first live exercise of NV-6's
descending-safety clause's actual counterfactual.

**NV-12:** `inferWorkoutType`'s broad 0.75–0.9 IF band (tempo/sweet-spot/threshold combined) reuses the
exact name of the real, narrower PRESCRIBED "Threshold" type — live-confirmed misleading on the Trends
hover title (both an IF 0.78 and IF 0.82 off-plan ride showed "Threshold (off-plan)" while the coach
note correctly called the latter "tempo"). **Investigated and ruled out adding a new `WorkoutType`
value**: `WORKOUT_TYPES` gates what block generation may legally prescribe
(`lib/plan-schema.ts`'s LLM tool schema, `app/api/write/route.ts`'s validation) — a new value would
silently expand the model's prescribable vocabulary with no KB protocol backing it. Also confirmed
per-type calibration (`lib/athlete-model.ts`'s `byTypeMap`) already excludes off-plan rides entirely
(INVARIANT 40), narrowing the audit's "leaks into trend labels/fueling logic" framing to a display-only
issue, not a corrupted-aggregate one. Fixed with a display-layer-only `inferredTypeLabel(type, planned)`
(`lib/ride-classify.ts`) — "Tempo/Threshold" for an off-plan Threshold inference, the raw name
everywhere else (prescribed Threshold included); the stored `WorkoutType`/`inferredType` value is
unchanged. Live-verified on the running Trends page: both bars now read "Tempo/Threshold (off-plan)".

**The 2026-08-15 debrief audit closes here — 14/14 findings shipped the same day**, ~93%
ground-truth-accurate against the real codebase and live data throughout. Three live-caught regressions
along the way (NV-9's poisoned zone denominator, NV-10's own truncation-categorization bug plus its
900→1800 token-budget fix, and this section's NV-8-catches-NV-7 truncation) — the live-smoke-run
discipline (AGENTS.md) earned its keep multiple times over, not just as a checkbox.

## Two-agent concurrency dry run — mechanical half proven (2026-08-15, PRs #72–#74)

`WORKFLOW.md`'s "Two agents at once" section had flagged true concurrency and the same-file
writer/reviewer fallback as unproven — every Codex PR to date had landed sequentially. Dry-run before
relying on either under real time pressure.

- **Concurrency (disjoint files):** started `codex/nv-eslint-unused-vars-config` and
  `claude/nv-execution-score-test-cleanup` off the same `origin/main` at once, then ran `codex exec`
  as a genuine independent background process (confirmed alive via `ps`, not just a launched-and-idle
  shell) while implementing and finishing the Claude side concurrently in its own worktree. Codex fixed
  `eslint.config.mjs` (added a `^_` ignore pattern for this repo's established
  "intentionally-unused-variable" convention, which it root-caused correctly on its own); Claude
  removed an unused test import. Both `finish:agent-task` runs completed correctly under real
  simultaneous access — `claude/*` auto-merged (PR #72), `codex/*` opened a PR and stopped short of
  merging (PR #73), exactly the documented per-prefix behavior.
- **Same-file writer/reviewer fallback:** assigned Codex sole ownership of
  `prototypes/impeccable-audit/detect.mjs`'s one remaining lint fix; Claude deliberately never opened
  a competing branch touching that file, only reviewed the finished PR (PR #74) per `WORKFLOW.md`'s
  "Reviewing a codex PR" procedure (`gh pr diff`, checked against AGENTS.md's bug classes and
  `docs/INVARIANTS.md`, squash-merged).
- **Result:** repo-wide lint warnings dropped from the 14 that had held steady all session to 3 (one
  genuine remaining case — `lib/nutrition.ts`'s `legacyBuffer`, an unused function parameter with
  4 real call sites, deliberately left alone as bigger blast radius than this dry run's scope). PR #73
  also surfaced 2 new, harmless "unused eslint-disable directive" warnings (stale suppression comments
  the fixed rule no longer needs) — a minor, un-chased follow-up, not a regression.
- **What this does NOT prove:** genuine two-human/two-session concurrency. This run was
  single-orchestrator — one Claude session drove both agents, including invoking `codex exec`
  headlessly via Bash rather than the user separately driving Codex Desktop/T3 Code. The mechanical
  worktree/branch/finish-command isolation is now proven under real simultaneous filesystem access;
  whether a genuinely independent, human-paced Codex session introduces different races remains open.

## Adaptive self-directed coach — Phases 1–3c (2026-08-06–14)

- **Phase 1 · aerobic eligibility (PR #28):** mixed/off-plan rides no longer manufacture aerobic or
  variability penalties from structurally unsuitable data.
- **Phase 2a · origin + overlays (PR #29):** the immutable ledger stays untouched while coherent,
  active overlays can supply effective origin and outcome to derived coaching state.
- **Phase 2b · intent scoring (PR #35):** deferred note parsing extracts grounded objectives; deterministic
  scoring writes idempotent overlays behind an `autoFromDate` rollout boundary.
- **Phase 2c · debrief (PRs #38/#40):** Today renders interpreted intent, supported evidence, and the
  overlay-resolved score or `Not scored`; sync refreshes the result after parsing.
- **Coach-note completeness (PR #36):** ride analysis now shares the intent parser's 2,000-character note
  cap and marks real truncation instead of silently cutting at 400 characters.
- **Phase 3a · no-block Today (2026-08-13):** a weekly TSS envelope (Monday-resolved, one-way
  reduction-only through the week), one suggested session (`gatherFocusInputs`/`chooseNextFocus` reuse,
  gated on the envelope's own range vs. week-to-date load), and a three-stream Load/Recovery/Execution
  read replace the bare "No active training block yet" fallback — for both the never-had-a-block state
  and a finished-but-not-regenerated block. No new LLM call; Zone 1's fused `AthleteStateCard` unchanged
  (flagged in `todo.md` to revisit). Design and plan went through two external-review rounds each before
  implementation; see [docs/superpowers/specs/2026-08-12-adaptive-coach-p3a-no-block-today-design.md](docs/superpowers/specs/2026-08-12-adaptive-coach-p3a-no-block-today-design.md)
  and [docs/superpowers/plans/2026-08-13-adaptive-coach-p3a-no-block-today.md](docs/superpowers/plans/2026-08-13-adaptive-coach-p3a-no-block-today.md).
  **Follow-up fix (PR #50, same day):** a brand-new athlete's 0–0 envelope no longer reads as "already
  at range top" (no suggestion instead), plus a json-store no-op-write skip and a preloaded-inputs
  path to avoid a redundant disk read per sync. Phase 4 remains in [ROADMAP.md](ROADMAP.md).
- **Phase 3b · curated-interval context (PR #48, 2026-08-12):** self-directed intent-matching gains
  HR-ceiling, cadence, and terrain claims (`ExecutedInterval` gains `maxHr`/`avgCadenceRpm`/
  `maxGradientPct`/`elevationGainM`/`label`); `matchLaps` ranks by whichever target field an objective
  states (never a blend — at most one of {power, HR, cadence, terrain} per objective). Terrain
  matching is label-first (Intervals.icu's own per-lap labelling — real, but null on every ride
  sampled during design), gradient-fallback second (climb = peak `maxGradientPct`, descent = signed
  average `avgGradientPct`). An HR/cadence claim with no stated interval duration grades against the
  whole ride (`RideEvidence.wholeRideMaxHr`/`wholeRideAvgCadence`) instead of staying ungraded.
  Implemented and live-smoke-tested 2026-08-13, Claude-reviewed. Design/plan:
  [docs/superpowers/specs/2026-08-12-adaptive-coach-p3b-interval-context-design.md](docs/superpowers/specs/2026-08-12-adaptive-coach-p3b-interval-context-design.md),
  [docs/superpowers/plans/2026-08-12-adaptive-coach-p3b-interval-context.md](docs/superpowers/plans/2026-08-12-adaptive-coach-p3b-interval-context.md).
- **Phase 3c · terrain gradient-fallback overmatch fix (PR #51, 2026-08-14, `5c8b473`):** closed a
  live-smoke defect where an unlabelled 103-minute lap satisfied a stated 10-minute climb through a
  peak-gradient floor and `complianceDelta` rewarded it as full compliance. `matchTerrain` in
  `lib/intent-scoring.ts` now rejects an unlabelled gradient-fallback candidate longer than 3×
  (`TERRAIN_OVERMATCH_RATIO`) the stated duration, leaving the objective ungraded instead;
  label-matched laps and the no-stated-duration path are unaffected. A compound climb+descent-in-one-
  lap gap remains — Phase 3c's 25-payload data gate found no minimum/trough-gradient field to detect
  it — tracked in [ROADMAP.md](ROADMAP.md)'s stable handles. Design/plan:
  [docs/superpowers/specs/2026-08-14-adaptive-coach-p3c-terrain-fixes-design.md](docs/superpowers/specs/2026-08-14-adaptive-coach-p3c-terrain-fixes-design.md),
  [docs/superpowers/plans/2026-08-14-adaptive-coach-p3c-terrain-fixes.md](docs/superpowers/plans/2026-08-14-adaptive-coach-p3c-terrain-fixes.md).

## Nutrition hardening follow-ups (2026-08-05–06)

- **Accounting + calibration (PRs #11–#15, #19, #22):** active burn is net of its resting cost;
  day-type solves are confidence-gated, reset safely, shrink toward a same-window pooled solve, and use
  window-mean weight for RMR.
- **Closed follow-ups:** derived route coverage, coach-snapshot local-date fallback, and conditional
  RMR-floor transparency.
- **Safety + validation (PRs #18/#20):** carb-reference validation covers pre/in-ride lines, and Today
  warns when the prescription itself falls in the app's low-EA band without changing calories.
- **Honest presentation (PRs #21/#25–#27):** target arithmetic is whole-kcal consistent; imbalance
  warnings bind to the active record; gross-vs-net burn is explained; mechanical kJ is no longer labelled
  as kcal.

## Proven-workout library — foundation tasks 1–5 (2026-08-03/11–20)

The domain model and selection rules (PRs #3/#32), JSON persistence and manual promotion (PR #77),
Intervals.icu export (PR #78), API routes (PR #79), and deterministic routine templates (PR #80)
shipped. Generation integration, accepted-use accounting, and management UI remain in
[ROADMAP.md](ROADMAP.md#phase-4--complete-the-narrow-workout-library-loop).

---

## Developer workflow — isolated Claude + Codex integration (2026-08-03)

Claude Desktop, Codex Desktop, and optional T3 Code sessions now share one low-friction protocol:
implementation runs in disposable `claude/<task>` / `codex/<task>` worktrees, while protected `main`
is integration-only. `npm run finish:agent-task` verifies, pushes, opens a PR, and enables squash
auto-merge; GitHub repeats the full check before merging. Concurrent agents own disjoint files, or one
writes while the other reviews. Current runbook: [WORKFLOW.md § Codex + opencode
workflow](WORKFLOW.md#codex--opencode-workflow). Shipped and live-verified in
[PR #2](https://github.com/Xon333/Nodevelo/pull/2); the legacy mixed Claude/Codex branch followed the
new path successfully in [PR #3](https://github.com/Xon333/Nodevelo/pull/3).

---

## Nutrition rebuild — Phases 1–3 + the buffer redesign (2026-07-30/31)

- **Nutrition early trend warning (2026-08-03).** Today now surfaces a 21-day evidence-gated, informational
  weight-trend mismatch warning with estimated prescription adherence; it never changes calories or
  calibration. `lib/nutrition.ts`, `app/api/sync/route.ts`, `components/dashboard/today.tsx`.

Full logic: **[docs/systems/09-nutrition.md](docs/systems/09-nutrition.md)**. Specs:
[accuracy design](docs/superpowers/specs/2026-07-30-day-to-day-nutrition-accuracy-design.md) ·
[buffer redesign](docs/superpowers/specs/2026-07-31-buffer-redesign-feedforward.md).

Started as "scope a better day-to-day nutrition system" and found that most of the target defects were
**already live in production**, not missing features.

**Phase 1 — five live defects (D1–D5).**
- **D1** `calculateDailyTarget` ran two independent formulas, so a training day only overtook a rest day
  once burn cleared ~300 kcal — **every Strength session (225 kcal) and short recovery ride prescribed
  less food than doing nothing.** Replaced by one formula where a rest day is `activeBurnKcal = 0`; the
  inversion is now unrepresentable. Swept 15,750 configs, zero violations.
- **D2** `BUFFER_MIN_KCAL = 0` on top of a maintenance floor meant the app **could not express a deficit
  at all**. Buffer is now signed.
- **D3** `targetWeight` was passed into the config and **never read by any calculation**; the buffer drove
  toward weight *stability* and cut 150 kcal on glycogen rebound — actively fighting recovery from
  underfuelling.
- **D4** `ActivitySummary.kj` is *mechanical work* but every consumer treated it as calories. Now consumes
  Intervals.icu's active-burn figure verbatim via a single `activeBurn()` accessor.
- **D5/D7** off-bike burn was dropped entirely, and `weeklyEnergy` used a *second* rest-day definition, so
  logging a 150 kcal walk **reduced** that day's need by ~210 kcal.

**Phase 2 — stop guessing NEAT.** `calibrateNeat` solves the energy-balance identity over the athlete's own
logs. Live: **k = 1.2584 at high confidence** (42-day window, 39 logged days, 21 weigh-ins) against the
shipped 1.20 — worth ~130 kcal/day, and the reason the old buffer had climbed to +190 chasing its own model
error. Coverage is measured over the *loggable* range so batch transfers don't make it flicker. Adds the
athlete-set rate goal, an RMR floor (a −500 buffer used to yield **1460 kcal against an RMR of 1631**), and
the Profile derivation panel.

**The buffer redesign.** Simulating a year of the athlete eating exactly the prescription exposed two
defects: a proportional controller with no integral term parked them **1.3 kg past target**, and — worse —
because it read only *trend error* and never the buffer's **sign**, a configured surplus could stand
against a weight-loss goal indefinitely (66 kg → target 63 ended at **66.94 kg**, the wrong direction).
Replaced by feed-forward: `buffer = rate × 7700 ÷ 7`. Both directions now converge and hold (63.05 / 63.20,
65/65 days in the deadband). `NutritionSettings.buffer` retired as a setting; the rate goal is the single
owned input.

**Phase 3 — the under-fuelling streak alert**, measured against *unbuffered* maintenance so a deliberate
deficit doesn't trip a health signal. Deliberately a different denominator from `weeklyEnergy`'s
plan-adherence ratio.

**Two reviews.** The Phase 1 review found a Critical (the Today card still read `kj`, showing the
*rest-day* figure on a 2007 kcal day and feeding it to the LLM). The Phase 2 review found another: the
weight trend anchored at the last weigh-in rather than the window, so a 21-day weigh-in lapse solved `k`
to **1.157 at high confidence** — a 165 kcal/day cut *plus* a food-log accusation against a correct log.
Both fixed and pinned by regression tests.

Also fixed along the way: `readAthleteProfile`'s self-heal was an **unlocked read-modify-write** that
silently discarded concurrent writes — measured losing both a fresh calibration and a manual override
*after the UI showed "Saved"*. Now atomic (HR-40/51/52 precedent).

---

## Block generation — recovery-week defect + deterministic skeleton (Phase A + B, 2026-07-29)

The season tripwire ([05-season.md](docs/systems/05-season.md#known-rough-edges)) **fired** and its
prescribed response shipped the same day. A hand-reviewed 2-week block's "recovery" week cut volume
~19% against a mandated ~40% *and* kept all three quality types (SIT, Threshold, and a long ride with
threshold efforts embedded in it), each merely trimmed rather than dropped.

**Phase A — correctness** ([plan](docs/superpowers/plans/2026-07-29-block-generation-phase-a-correctness.md), 16 commits).
Two root causes: the recovery-week prompt instruction specified volume only, with no composition rule,
while the prompt's only structural section was headed "loading weeks"; and the durability template
that shapes the long ride is chosen per *block* but was injected for every *week*, so a recovery week's
long ride was explicitly instructed to carry threshold efforts. Tracing those surfaced three
silent-degradation bugs, all fixed: an A-priority event on the calendar skipped focus selection
entirely (no focus context, two validators dark, no `seasonFocus` stamp, next block's variety rule
degraded); recovery weeks vanished on any season-replan exception (a malformed `season-plan.json` date
reaches `addWeeks` → `RangeError`), announced only in a server log; and `validateEventTaper` used the
narrow quality-type check, so a long ride with embedded threshold work the day before a race passed
clean. Live-verified: recovery week 7.0h vs 11.2h loading (**38% cut**), one quality session, other
types absent, long ride unbroken despite template B being selected.

**Phase B — deterministic week skeleton** ([plan](docs/superpowers/plans/2026-07-29-block-generation-phase-b-skeleton.md), 8 commits).
`computeBlockSkeleton` allocates seven typed day-slots per week whose durations sum **exactly** to the
week's hour target, rendered as a per-day table that supersedes the bare hour figure, plus
`validateSkeletonConformance` (warn-only by staged decision). Loading weeks went from 1/4 inside the
30-min tolerance to 3/4. Details + the traps → [06-generation.md § The week skeleton](docs/systems/06-generation.md#the-week-skeleton-composition-authority).

**Worth remembering from this pass:** four of the defects were caught only by *running* the code with
adversarial inputs or by *printing* the output, not by reading diffs — a Saturday event zeroed the
long-ride slot; the arithmetic was driven by a configured budget rather than the slots actually
placed; every loading-week quality slot was locked to the focus type, producing two identical sessions
and making the block-wide RaceSim floor unsatisfiable; and a flat quality-slot size flagged correct
~55min SIT sessions every single week. Example-based tests missed all of them because they only
exercised `DEFAULT_BLOCK_SETTINGS`; an invariant sweep over tens of thousands of settings
combinations is what actually pinned the guarantees.

## Block-generation architecture redesign — P1–P7 (2026-07-24)

Prompted by a real 6-week block review: every non-recovery week missed its own explicit hour floor,
SIT/neuromuscular work vanished from the back half despite the block's own overview claiming
otherwise, a loading week skipped its standalone Threshold session entirely, zero VO2max sessions
fired despite VO2max being the profile-flagged FTP limiter, and a priority-B goal event got no taper
support at all. A research pass (TrainerRoad/Xert/TrainingPeaks/Intervals.icu/JOIN Cycling,
open-source plan-generator repos, coaching-forum consensus) plus a full re-audit of `lib/season.ts`/
`lib/anthropic-prompts.ts` found root cause: `SEASON_SHAPES_GENERATION` bundled two independent
things — the doubted fixed-phase event arc AND the *not*-doubted, already-tested rolling/support
layer (`chooseNextFocus`, `validateBlockFocus`, etc.) — so disabling one disabled both. Produced a
7-part plan (P1–P7). Commits `b478e84` (P1, P4, P2a-d, P3a-c) and `5ba1797` (P5).

- **P1 — split the flag.** Kept the event-anchored bundle (`formatSeasonContext`,
  `validateSeasonFit`/`validateFocusMatch`) behind `SEASON_SHAPES_GENERATION`; reconnected the
  rolling/support bundle (`formatFocusContext`, `formatRecoveryWeeks`, `formatRetestNote`,
  `validateBlockFocus`, `/api/season`'s outlook) unconditionally in `app/api/generate/route.ts` and
  `app/api/season/route.ts`. 1337 tests, live-smoked twice (a real block correctly opened with a
  recovery week, citing "the ≥4-week gap since the last light week").
- **P2 — deterministic per-block skeleton, 4 sub-phases** (new `lib/block-skeleton.ts`). P2a
  `checkBlockFeasibility` refuses an infeasible `BlockSettings` combo with a 400 before spending an
  LLM call. P2b `computeWeekTargets`/`formatWeekTargets`/`validateWeekHours` — one exact hour figure
  per week (replacing the old min-max range), recovery depth derived from the loading target (60%,
  clamped to a widened 6–8h) instead of blind to it. P2c `lib/season.ts:
  focusSessionMatchers`/`formatFocusCoverageLine` — the chosen focus injects a mandatory "include ≥1
  {type} session" requirement. P2d `lib/plan-schema.ts` — `weeks` declared before `overview` so
  Claude fills every day before writing the summary. 34 new/updated tests (1360 total), live-smoked
  twice. Net effect: recovery depth and coverage requirements land reliably; hour-target and
  taper-week compliance are narrowed, not perfect (tracked open → [ROADMAP.md](ROADMAP.md)).
- **P3a/b/c — tiered post-generation validators** (P3d/e deliberately deferred, tracked open in
  ROADMAP). P3a new `lib/nutrition-validate.ts: repairNutrition` auto-corrects a kcal mismatch
  instead of warn-only (live-confirmed: an invented 3000 kcal figure corrected to 3810). P3b
  `lib/workout-validate.ts` exempts sub-90s VO2max touches from the 122%/20-min durability-insert
  ceiling check (a KB-sanctioned neuromuscular pattern, not a malformed insert). P3c new
  `lib/narrative-critic.ts` + `lib/anthropic-api.ts: critiqueOverview` — a cheap follow-up call
  fact-checks the written overview against deterministically-extracted per-week facts and rewrites it
  if it disagrees. 20 new/updated tests (1380 total), live-smoked: fired and corrected a real
  overview, but a later run still let a "4-hour" mis-description of a 200-minute ride through —
  inconsistent, not proven broken.
- **P4 — a lightweight taper tier for priority-B/C events.** New `lib/schedule-validate.ts:
  validateEventTaper` — no quality session in the final 2 days before the event, capped quality
  budget for its own week; paired with a strengthened prompt cue in `formatUpcomingEventsForBlock`. 9
  new tests, live-smoked against the athlete's real KOM event (the block opened with a recovery week,
  zero other quality that week).
- **P5 — temporal sequencing + one primary quality per block.** RaceSim relaxed from a
  per-loading-week requirement to sporadic/block-wide (`lib/session-requirements.ts`) — athlete
  direction: the block's primary quality takes priority over RaceSim for the shared weekly budget.
  P5a `lib/season.ts: validatePrimaryQualityCadence` — the chosen focus's matching session must
  appear in every loading week. P5b `lib/schedule-validate.ts: validateWeekSequencing` —
  freshness-dependent quality (VO2max/SIT) must land earlier in the week than fatigue-tolerant quality
  (Threshold/RaceSim). 24 new/updated tests (1394 total), live-smoked: the model correctly reordered
  SIT-before-Threshold, and the narrative critic's correction was fully accurate. Real gap found: the
  KOM event's own week still stacked 3 quality sessions and a hard embedded-effort long ride still
  landed the day before the event — `validateEventTaper`'s 2-day rule only covers standalone quality
  types, not embedded-effort Z2 days (tracked open → ROADMAP).
- **P7 (verify, not a fix).** `chooseNextFocus` closes the literal fixed-sequence bug —
  `aerobic-base` is no longer an unconditional first phase, it's one of five scored candidates every
  block, so the athlete's literal worry ("always assigning base regardless of existing fitness") no
  longer happens by construction. A narrower residual gap survives: the urgency signal only sees
  NodeVelo-generated block history (tracked open, not scheduled → ROADMAP).

**Was a more drastic re-architecture warranted instead of P1–P7?** Evaluated explicitly: 11 candidate
architectures (LLM-as-copywriter over a fully deterministic skeleton; a library+guided-search engine;
a hard constraint solver; a two-clock macro-envelope/weekly-fill split; full rolling-horizon
generation with no block concept; a TrainerRoad-style per-zone progression-level state machine; a
Xert-style soft-phase+daily-override hybrid; a backward-from-event planner with block length as an
output; a generate→LLM-critique→repair loop; a forecast-only "flight simulator"; a negotiation UX
where the LLM only translates feedback into constraint edits) were scored against this app's real
constraints — solo maintainer, the mission's own "not a re-skin of Intervals.icu" line, the
review-before-write ritual as a deliberately-built explainability feature, the deterministic infra
already working, and the decisive fact: the athlete model runs at n=1–8 observations per type, below
its own confidence gates, with first learning-loop verdicts maturing ~2026-08-12. **Verdict: P1–P7
already is the correctly-sized drastic change** — it strips the LLM of exactly the structural
authorship where every reviewed-block defect occurred, and most surviving candidates decompose into
ingredients P1–P7 already contains. Re-architecting toward a data-hungry primitive now would reset
the exact corpus the app's whole thesis depends on, right as it starts accruing.

**Held for a scheduled reopen, not rejected:** the TrainerRoad-style per-zone progression-level state
machine — the most genuinely interesting drastic option from this evaluation, blocked purely by data
thinness. Reopen once per-type observation counts clear the athlete-model's own ≥3-obs gates (watch
after the 2026-08-12 verdict maturation).

**Eliminated outright (don't re-propose without a real reason):** a full constraint solver (the one
good idea — refuse to silently arbitrate an over-constrained ask — is already in P2a as a plain
pre-check); full rolling-horizon generation with no block concept (deletes real look-ahead value,
turns review into something that only catches failures after they're ridden); a full
backward-from-event planner as the *primary* generative move (makes a mostly-empty, self-declared
event calendar the highest-authority input for no real gain over P4's lightweight tier).

All `tsc`/lint clean throughout. Remaining open gaps (P3d/e, P6, the P4/P5 event-week overstack, P7's
urgency-signal gap) and full file/line-level scoping → [ROADMAP.md](ROADMAP.md) stable handles.

---

## Hostile review — block/sync/archive data flows (HR-2026-07-23)

Prompted by a real bug: the athlete deleted their active block; it vanished from the UI but came back
on refresh. Root cause (found and fixed same-session, not part of this round): `readJsonFile` treated
a legitimately-parsed `null` — exactly what `current-block.json` holds when there's no active block —
as a failed read, and silently fell back to the `.bak` snapshot (the pre-write content, i.e. the just-
deleted block). This round: 4 parallel review passes (data-store mechanics, API route correctness,
client-side state, block-history archival) hunting the same *class* of bug — silent data loss/
resurrection in the read-modify-write paths around blocks, sync, and archiving. 35 raw findings,
deduped to 29 (6 pairs found independently by two agents). Continues the HR- series (append, not
renumber). All 29 fixed same session. Commits `6dffb3a`..`a8df100`.

**P1 — correctness / data-integrity**
- **HR-31** — `mergeCurrentBlockDays` (`lib/data-store.ts`) no longer falls back to the caller's
  pre-write snapshot when the on-disk block reads back `null` — a cleared block stays cleared. Dropped
  the now-pointless `fallback` parameter (4 call sites). Regression test reproduces the exact
  resurrection sequence (write → delete → merge).
- **HR-32** — All 3 archive sites (sync DELETE, write-replace, retrospective) now accept a
  client-supplied `today` (`resolveToday`) instead of hardcoding `utcToday()`, threaded from
  `PlanView.tsx`'s `localToday()`.
- **HR-33** — `/api/retrospective` POST now accepts `expectedBlockCreatedAt` and reuses
  `lib/block-version.ts`'s CAS check before the live LLM call.
- **HR-34** — `PlanPreview` gets its own `writeError` prop instead of `PlanView.tsx` misusing
  `generateError`.

**P2 — high-value correctness**
- **HR-35** — `updateCurrentBlock`/`mergeCurrentBlockDays` take an optional `expectedCreatedAt`,
  re-compared INSIDE the per-file lock — a real compare-and-swap, threaded through all 4
  block-mutating routes (sync DELETE, write, reschedule, retrospective).
- **HR-36** — New locked `updateInterventionLog` (`lib/data-store.ts`); removed the orphaned unlocked
  `writeInterventionLog`.
- **HR-37** — `appendBlockHistory` now checks inside the lock whether the entry it's about to displace
  carries a `retrospective` the incoming one lacks — the richer entry always wins.
- **HR-38** — `app/api/write/route.ts` snapshots the OLD block's live calendar descriptions before the
  write loop, so a partial-failure rollback restores a shared date's real content instead of deleting
  it.
- **HR-39** — `app/api/reschedule/route.ts` POST now 400s onto an occupied day (matching PUT/PATCH),
  instead of overwriting it.
- **HR-40** — `updateScoreLog` accepts an async mutate; sync moved its dispositions read inside the
  lock, immediately before applying.
- **HR-41** — `atomicWrite` (`lib/json-store.ts`) rethrows genuine `.bak`-copy failures and skips
  rotation on a corrupt live-file parse, instead of silently swallowing/clobbering.
- **HR-42** — New `readJsonFileWithStatus` signals `corruptFallback`; `updateJsonFile` now refuses to
  persist a CRITICAL store derived from a corrupt fallback.
- **HR-43** — New `shapeMergeProfile` (`lib/data-store.ts`) merges raw `athlete.json` over
  `DEFAULT_PROFILE` before any downstream migration/overlay runs.
- **HR-44** — `GET /api/reschedule` returns `blockCreatedAt`; `RescheduleBanner.tsx` captures it at
  fetch time and sends that (not a click-time re-read) as `expectedBlockCreatedAt`. First component
  interaction test in the repo (added `@testing-library/react` + `jsdom`).
- **HR-45** — `doSync` (`SyncProvider.tsx`) now invalidates the sync query cache after its manual
  merge, matching `DayAction.tsx`'s existing idiom.
- **HR-46** — `RescheduleBanner.apply`'s post-apply refresh replaced a raw UTC-defaulting GET + full-
  state overwrite with a query-cache invalidate.
- **HR-47** — `DayAction`'s `onMoved` reports `{ mirrorFailed }`; `plan.tsx` only closes the popover on
  a real success.
- **HR-48** — `PlanView.tsx`'s `write()` now surfaces `rolledBack`/`rollbackFailed` per day in
  `PlanPreview` instead of showing "✓ written" on a rolled-back day.

**P3 — polish / smaller correctness**
- **HR-49** — Fixed incidentally by HR-43; `goals`/`weakpoints` on a fallback-derived profile now
  clone (`[...p.goals]`) instead of sharing `DEFAULT_PROFILE` references.
- **HR-50** — New locked `updateAthleteProfile`; `app/api/profile/route.ts` PUT validates before the
  lock, merges the raw shape inside it.
- **HR-51** — Sync's calibration re-derive now routes through `updateCalibration` instead of an
  unlocked read/write pair; removed the orphaned `writeCalibration`.
- **HR-52** — New locked `updateBlockSettings`/`updatePhysiology`; removed the orphaned unlocked
  writers.
- **HR-53** — Ledger-rebuild marker check now uses `Boolean(rebuildMarker.rebuiltAt)` instead of
  `!== null` (the AGENTS.md migration-flag anti-pattern).
- **HR-54** — 4 sub-fixes: removed 2 more zero-caller unlocked writers; `atomicWrite` throws on
  `undefined` instead of serializing `"undefined"`; disposition GET resolves via `resolveToday`;
  `autoSyncOnOpen`/`polarisedApproach` heal to their documented default instead of reading `undefined`
  as falsy.
- **HR-55** — Archive-the-old-block step now guards on `livedDays.length > 0`, matching DELETE's own
  check.
- **HR-56** — `deleteBlock` surfaces partial calendar-cleanup failures and refetches Plan history
  after every delete.
- **HR-57** — `/api/retrospective`'s live LLM call now has its own try/catch, returning a 502 instead
  of an uncaught rejection.
- **HR-58** — New CAS-guarded `updateSeasonPlan`; `/api/generate` defers season-plan persistence to
  after a successful generation instead of writing speculatively before the LLM call.
- **HR-59** — `RescheduleBanner.apply` separates the move-failure boundary (preserves the real thrown
  message, e.g. a 409) from the post-move cache-refresh boundary (best-effort, never surfaces a false
  error).

---

## First loop turnover — SUB-5 complete (confirmed 2026-07-22)

The event the SUB-5 runbook (`WORKFLOW.md`) was written for has happened: `data/block-history.json`
(gitignored, local-only — this is a filesystem observation, not a commit) now holds real entries
starting with the first in-app block (2026-06-15 → 2026-07-12), and `data/intervention-log.json` —
empty since inception — now holds 6 real directives (`outcome: null`, 28-day horizons, oldest fired
2026-07-15, most recent 2026-07-17). A second block has since generated and is active
(`current-block.json`, started 2026-07-20), so the retrospective → next-block-write cycle has
already turned over more than once. Nothing to verify further — the mechanism was already proven at
build time (SUB-5's build half, 2026-07-03); this just confirms the live event actually fired
cleanly. The 6 directives haven't matured yet (28-day horizon from the latest fire date) — first
verdicts land ~2026-08-12, at which point **#4**'s auto-down-weight loop has its first real data to
act on.

**#4 closed out — first verdicts matured 2026-08-12–14:** 4 validated, 2 inconclusive, 0 refuted
(100% hit-rate on decisive outcomes). `synthesis.ts`'s demotion path (≤34% hit-rate over ≥3 decisive
blocks) now has real verdicts to run on but hasn't fired — nothing has been this poor yet, so the
down-weighting behavior itself remains unexercised in practice. Mechanism confirmed working
end-to-end; removed from ROADMAP's Blocked/dormant table.

---

## Full-app UX/UI audit — 61 findings, all resolved (UXA-2026-07-22)

61 findings from 8 parallel reviews + a live browser walkthrough, athlete-confirmed valid, sorted
Critical→Nice-to-have and worked top to bottom across several sessions. All 61 resolved — either
fixed or, for the handful needing a real design call rather than a mechanical fix, explicitly
deferred with its own rationale below.

**Critical**
- `bug` **UXA-1** — **Fixed.** The Constitution's own named example of banned developer jargon shipped
  live through 5+ paths. Rewrote all offending strings to coach voice: the InfoDot tip
  (`components/dashboard/BlockGenerator.tsx`); the 3 API routes' thrown error strings
  (`app/api/generate/route.ts`, `app/api/write/route.ts`, `app/api/sync/route.ts`) now match
  `BlockGenerator`'s own visible-line tone instead of naming env vars; the backup-failure warning
  pushed into the global `SyncNotice` banner no longer interpolates the raw error reason (kept in the
  `logError` call for developers only). Also found and fixed on inspection: two deeper library-level
  throws carried the same jargon (`lib/anthropic-api.ts`, `lib/intervals-api.ts`). Deleted
  `components/SyncStatus.tsx` — dead code, unreferenced anywhere in the app, so it carried the jargon
  string in the bundle for no reason; this also resolves UXA-61. Updated the two existing tests that
  asserted the old jargon strings to assert the new coach-voice copy and regression-guard against
  env-var names ever reappearing. Did not build the `client()` allow-list structural hardening (the
  "prevent future recurrence" half of the original recommendation) — scoped out as a separate, larger
  change; the ~15-component raw-`err.message` pattern remains.
- `ux` **UXA-2** — **Fixed.** Today's readiness card — the first thing a new or misconfigured install
  sees — silently showed "Sync to compute today's readiness" with no button when Intervals.icu wasn't
  configured. `components/dashboard/TodayView.tsx` now branches on `state.configured`: unconfigured
  shows a plain-language explanation plus the one fix (no env-var names); configured keeps the
  existing "Sync now →" button unchanged.
- `bug` **UXA-3** — **Fixed.** Added a min≤max cross-field check for both weekly-hours pairs. Server
  (`app/api/settings/route.ts`) rejects with 400 before the calibration-override section runs; client
  (`components/BlockSettingsForm.tsx`) disables Save and shows an inline warning. 3 regression tests
  added.

**High**
- `ux` **UXA-4** — **Fixed.** Block generation could burn a paid LLM call before checking
  Intervals.icu is connected — now surfaces a non-blocking amber notice next to Generate as soon as
  `!intervalsConfigured`.
- `bug` **UXA-5** — **Fixed.** Added a `beforeunload` guard gated on an unwritten, already-generated
  plan — covers refresh/close-tab/new-URL.
- `bug` **UXA-6** — **Fixed.** Added the missing `disabled={analyzing}` plus a ref-based re-entrancy
  guard in `runAnalysis` itself (mirrors AskCoach's own self-guard).
- `bug` **UXA-7** — **Fixed.** Client now reads and displays the `skipped` array the route already
  returned (`components/BackupRestore.tsx`).
- `ux` **UXA-8** — **Fixed.** Added a consequence line next to Write ("Replaces your active block —
  remaining days archived, ridden history kept") when a block is active.
- `ux` **UXA-9** — **Fixed.** StateDriversCard/CalibrationPanel now distinguish loading (skeleton)
  from error (LoadFailed) from genuinely-empty, instead of collapsing the first two into the third.
- `ux` **UXA-10** — **Fixed.** SeasonRoadmap's palette reuses the sanctioned workout-type hexes
  instead of inventing near-duplicate shades; moved off inline `style=` onto Tailwind classes.
- `ux` **UXA-11** — **Fixed.** Every Settings/Profile/Knowledge Save button had independently drifted
  to an inverted solid-zinc style instead of Nav/BlockGenerator's documented pink-outline dark-mode
  treatment. Added `PrimaryButton` + `PRIMARY_BUTTON_CLASS` to `ui.tsx` and swept all 7 call sites.
- `ux` **UXA-12** — **Fixed.** `BlockTimeline` demoted to plain `Card` chrome, matching its DESIGN.md
  §8 drill-down tier.
- `bug` **UXA-13** — **Fixed.** All 10 sites with the systemic inverted contrast token swapped to the
  correct `text-zinc-500 dark:text-zinc-400` pairing.
- `ux` **UXA-14** — **Fixed, partially.** Added a data-summarizing `aria-label` to Sparkline and
  RideTrace. Full keyboard scrubbing remains open.
- `ux` **UXA-15** — **Fixed.** Nested `BlockSettingsForm`'s `Field` children inside `<label>` for
  implicit association (×7).
- `ux` **UXA-16** — **Fixed.** Added an `sr-only` `<h1>` to Today and Plan.
- `ux` **UXA-17** — **Fixed.** Added a visually-hidden-until-focused skip link targeting
  `#main-content`.
- `ux` **UXA-18** — **Fixed.** Settings' training-philosophy selected option and Knowledge's selected
  file both restyled to Nav.tsx's own active-link accent treatment.
- `bug` **UXA-19** — **Fixed.** `SeasonRoadmap` is now purely presentational — `PlanView` owns the one
  `/api/season` fetch and passes the result down as props, instead of two components independently
  fetching the same endpoint (3 requests → 1, confirmed via network trace).

**Medium**
- `ux` **UXA-20** — **Fixed.** Settings now diffs sent-vs-returned numeric fields after a save and
  explains any silent server-side clamp instead of just saying "Saved."
- `ux` **UXA-21** — **Fixed.** All 9 forms wrapped in `<form onSubmit>`; every non-submit button inside
  given explicit `type="button"` so wrapping didn't turn them into accidental submit triggers.
- `ux` **UXA-22** — **Fixed.** Raw `error.message`/`digest` moved behind a collapsed "Technical
  details" disclosure in both crash boundaries.
- `bug` **UXA-23** — **Fixed.** AskCoach now ties an `AbortController` to its streamed fetch via an
  unmount cleanup — navigating away mid-answer actually stops consuming (and billing) tokens.
- `bug` **UXA-24** — **Fixed.** Cross-tab optimistic-concurrency guard on destructive block actions
  (delete/write/reschedule). Reused `CurrentBlock.createdAt` (no new field) as the version token — the
  client sends the `createdAt` it believes is active as `expectedBlockCreatedAt`; the server 409s
  before any mutation (before any Intervals.icu event is even created, for `/api/write`) if it doesn't
  match. New `lib/block-version.ts` holds the one comparison, wired into `/api/write`, `/api/sync`
  DELETE, and `/api/reschedule`'s shared `loadRescheduleContext`. A request omitting the field skips
  the check, so no pre-existing test needed to change.
- `bug` **UXA-25** — **Fixed.** `/api/trends`, `/api/history`, `/api/export` now catch unexpected
  errors and return a structured `{error}` instead of a bare 500.
- `ux` **UXA-26** — **Fixed.** Trends' top-level fetch error is now `LoadFailed` + Retry, matching
  every sibling best-effort fetch in the app.
- `ux` **UXA-27** — **Fixed.** PowerCurveChart's y-axis labels now carry the correct `dark:` pairing.
- `ux` **UXA-28** — **Fixed.** Chart line colors no longer hue-swap across themes — same hue in both
  themes now (Sparkline → pink, Trends CTL/RideTrace power → cyan).
- `bug` **UXA-29** — **Fixed.** The remaining bare `text-zinc-500` sites with no `dark:` pairing
  (AiUsageCard, BackupRestore) fixed.
- `ux` **UXA-30** — **Fixed.** Corrected DESIGN.md's documented RaceSim hex to match what the code has
  always actually shipped.
- `ux` **UXA-31** — **Fixed.** "Good/positive" status color unified to emerald-600/emerald-400 across
  6 Trends sites.
- `ux` **UXA-32** — **Fixed.** Extracted `HeroSurface` from `Zone`'s own hero branch; `Zone` composes
  it internally and `CurrentBlockSection` uses it directly instead of a hand-copied shell.
- `ux` **UXA-33** — **Fixed.** The left rail is `fixed` (outside the content div's layout flow), so
  `mx-auto` centered content in the padded remainder instead of against the rail — ~680px of dead
  space on both sides at 2560px. Content now hugs the rail's edge, with a wider cap at `2xl`.
- `ux` **UXA-34** — **Fixed.** KnowledgeBaseEditor's textarea gets an `aria-label` tied to the selected
  file.
- `ux` **UXA-35** — **Fixed.** The calendar day-popover's Escape handler is now also wired on the
  popover container itself (a DOM sibling of the trigger, not its child).
- `ux` **UXA-36** — **Fixed.** The block-actions menu declared `role="menu"/"menuitem"` semantics it
  didn't implement — dropped to plain markup.
- `ux` **UXA-37** — **Fixed.** Transient success/error confirmations across 3 forms now use
  `role="status"/"alert"`.
- `ux` **UXA-38** — **Fixed.** Removed the extra `opacity-60` on InfoDot's own glyph, which sat on top
  of already-muted zinc, at/under the contrast floor.
- `ux` **UXA-39** — **Fixed.** Corrected ROADMAP.md's "no desktop page runs over the fold post-v2"
  claim against live 1440×900 measurements (Settings measured 1047px over).
- `bug` **UXA-40** — **Fixed.** `/api/trends` now slices the score ledger to the last 30 entries
  before sending.
- `ux` **UXA-41** — **Fixed.** Block history rendered fully unbounded in the DOM in two places — both
  now cap to the most recent 20.
- `ux` **UXA-42** — **Fixed.** Knowledge's file rail gets its own scroll region.
- `ux` **UXA-43** — **Fixed.** Trimmed Today's IF and TSB tooltips to the app's own 2-sentence tip
  limit.
- `ux` **UXA-44** — **Fixed.** Unified ~17 sites' save/write/load failure copy onto one "Couldn't X —
  try again." register.
- `ux` **UXA-45** — **Fixed.** Verdict score bar and driver bars now transition on value change.
- `ux` **UXA-46** — **Fixed.** Mobile disposition chips no longer wrap to 5 lines; meet touch-target
  guidance.
- `ux` **UXA-47** — **Fixed.** Mobile Plan's "Season" label no longer collides with its own goal
  sentence.

**Nice-to-have**
- `ux` **UXA-48** — **Fixed.** Global keyboard shortcuts in `Nav.tsx` — digit keys 1–7 jump to each
  rail link (generated from the same array the rail renders), `s` syncs, `?` opens a legend (also
  reachable via a small button). Ignored with any modifier held or while focus is in an editable
  field.
- `ux` **UXA-49** — **Fixed.** Added `app/not-found.tsx`, matching error.tsx's tone.
- `ux` **UXA-50** — **Fixed.** Profile and Model now link to each other.
- `ux` **UXA-51** — **Fixed.** Nutrition inputs get a visible range hint — buffer shows its real
  enforced band (now exported from `lib/nutrition.ts`); the other three fields get a defensible floor
  of 0.
- `ux` **UXA-52** — **Fixed.** SeasonSection now distinguishes "still loading" from "loaded, nothing
  set yet."
- `ux` **UXA-53** — **Fixed.** Season-event and block-generation start-date pickers reject a past date
  via `min`.
- `ux` **UXA-54** — **Fixed.** Widened `Card` (ui.tsx) to spread arbitrary HTML attributes onto its
  root `<section>`, then composed AthleteStateCard through it instead of hand-duplicating Card's chrome.
- `ux` **UXA-55** — **Fixed.** RescheduleBanner's (and MorningCheckIn's identical, found on inspection)
  amber CTA gets the same lightened `dark:` shade every other themed CTA uses.
- `ux` **UXA-56** — **Fixed.** AiUsageCard now composes Card's title/action slots instead of
  hand-rolling its own header row.
- `ux` **UXA-57** — **Fixed.** RideTrace's HR overlay was the inverse of the app's own muted-text
  convention, leaving light mode under the WCAG 1.4.11 3:1 floor. Flipped to match.
- `ux` **UXA-58** — **Fixed.** Delete-block's "Yes, delete" now awaits the actual DELETE call and
  shows "Deleting…" instead of closing the confirm bar instantly and discarding the promise.
- `ux` **UXA-59** — **Fixed.** The Power PRs caption claimed a drag interaction that isn't there when
  there's only 1 synced point.
- `ux` **UXA-60** — **Fixed.** Trends' CTL card was the one "Engine" card missing a trailing
  explanation its two siblings both have.
- `ux` **UXA-61** — **Fixed, as part of UXA-1.** `SyncStatus.tsx` was dead code shipping the
  env-var-jargon string live in the bundle — deleted rather than fixed and wired in.

See git log (`3ea28a2..465868d`) for exact commits and file-level detail per item.

---

## Season continuous-focus-selection + roadmap-preview outlook (2026-07-18 → 2026-07-21)

Replaces the fixed phase-sequence engine (`replanSeasonArc`'s Mode-C loop, `applyDeloadCadence`'s
cross-call counter, `needsBaseGate`/`weeksSinceBase`'s arc-cap machinery) with a stateless,
real-data-scored choice made fresh every `/api/generate` call — the architectural answer to the
season-architecture doubt raised earlier (does a fixed phase sequence honestly fit a rider's current
state?). Design: `docs/superpowers/specs/2026-07-17-season-architecture-redesign-design.md`. Plans:
`docs/superpowers/plans/2026-07-17-season-continuous-focus-selection.md` (the engine, commits
`9b63e13`..`d703dbd`, 2026-07-18) and `docs/superpowers/plans/2026-07-17-season-roadmap-preview-and-rollout.md`
(the UI, commits `4fd0856`..`8afbfec`, 2026-07-21).

- **The engine.** `chooseNextFocus` (`lib/season.ts`) scores the next block's focus fresh from real
  data every call, replacing the old rolling-mode drafting loop; `aerobic-base` is now a normal scored
  candidate instead of a special-cased gate. A real-data recovery hard cap
  (`realWeeksSinceLastRecovery` + `planRecoveryWeeks`) replaces the old deload-cadence counter.
  `replanSeasonArc` split into two narrower functions: `settleSeasonHistory` (rolling — freezes/prunes
  history, drafts nothing new) and `replanEventArc` (event mode — the existing three-bucket re-plan,
  behavior-unchanged). Event-anchored mode (a real upcoming A-priority race) keeps its existing
  persisted, backward-scheduled arc throughout. `app/api/generate/route.ts` branches on whether an
  A-event exists and wires the right path; the chosen focus/rationale ride through `GeneratedPlan` →
  `CurrentBlock` → `BlockHistoryEntry` as one un-recomputed value instead of being re-derived at each
  hop.
- **The roadmap-preview UI.** `projectSeasonOutlook` (`lib/season.ts`) re-runs `chooseNextFocus`
  forward a handful of hypothetical slots for display only — never persisted, never gates anything.
  `GET /api/season` computes it server-side (gated behind `SEASON_SHAPES_GENERATION`, rolling case
  only, so the flag-gating and mode-branching live in one place). `SeasonRoadmap.tsx` and
  `PlanView.tsx` now read the projected outlook for the rolling case, falling back to the untouched
  event-mode path when the server returns none.
- **`SEASON_SHAPES_GENERATION` stays `false`.** The engine and the roadmap-preview UI are both built
  and wired in, but the flag — which gates the phase-derived prompt text and validator warnings out of
  actual generation — hasn't been flipped back on yet. That flip (plus the live Anthropic smoke run it
  requires per AGENTS.md) is the one remaining task in the roadmap-preview-and-rollout plan; tracked in
  [ROADMAP.md](ROADMAP.md) Phase 8.
- **Hardened by a 2026-07-17 hostile review** (15 findings, all fixed) — see the next entry below. That
  review's fixes predate/underlie this redesign's own final shape (e.g. HR-22's deload-cadence
  persistence fix informed `realWeeksSinceLastRecovery`'s design).

---

## Hostile review — block-generation-fidelity commits, round 2 (HR-2026-07-17)

Requested after the athlete reported the shipped fixes from the 2026-07-16 round (below) didn't
actually resolve their symptoms. 15 findings from an xhigh multi-agent review (10 independent finder
angles, 32 raw candidates deduped). All 15 resolved: 7 P1s, 8 P2/P3s — 2 (HR-20, HR-22) had genuine
tradeoffs and were resolved via an explicit `AskUserQuestion` design call rather than a single
obviously-correct fix; 1 (HR-23) was re-verified before editing and found to be Won't-fix (the
finding's own premise was wrong).

- **HR-16** — Compound multi-effort workout lines (e.g. "Move 3: Seated climb 2m30s 108%, then
  standing attack 25s 140%") silently dropped the second effort — `parseStep` used a non-global regex
  match. Confirmed against the athlete's real already-written RaceSim day: 3 real reps were missing
  from `prescription`. Now global-matches every clause on a line.
- **HR-17** — Confirmed root cause of "only template A": `selectDurabilityTemplate`'s `LIMITER_TEMPLATE`
  mapped a systemic `Overall`/`alert` insight to the safest template unconditionally, with no way to
  tell genuine systemic fatigue apart from an environmental cause (`deriveInsights` already diagnoses
  this separately). `overallDeclineIsExplained` now skips the override only when that co-occurring
  insight is present.
- **HR-18** — The `goalText` built for `selectDurabilityTemplate` omitted `blockParams.weakpoints`/
  `profile.goals`/`profile.weakpoints`, unlike the richer, near-identical construction 35 lines later.
  Hoisted one `combinedGoalText` local, reused at both sites.
- **HR-19** — The duration-consistency check was warn-only. Added `reconcileDurationMin`
  (`lib/prescription.ts`): overwrites `durationMin` with the real step-sum, exempting Rest/Strength.
- **HR-20** — **User's explicit choice: prompt-only reinforcement, not deterministic auto-repair**
  (given `lib/schedule-validate.ts`'s own "never reorders the coach's plan" contract). Tightened the
  WEEKLY STRUCTURE prompt rule; known accepted residual gap — this is a probabilistic improvement, not
  a guarantee.
- **HR-21** — New regression from this same round's own season-disable Task 6: the flag only gated the
  backend, never reached `PlanView.tsx`/`SeasonRoadmap.tsx`. Both now import the same flag.
- **HR-22** — **User's explicit choice to fix now rather than defer.** `applyDeloadCadence`'s rolling
  count didn't actually persist across `/api/generate` calls since `replanSeasonArc` only redrafts the
  future tail. New `weeksSinceLastDeload` mirrors `weeksSinceSeasonBreak`'s pattern.
- **HR-23** — **Won't-fix** — a direct diagnostic proved `SEASON_CONSTANTS`'s deload-cadence comments
  were already correct; the finding's premise was wrong.
- **HR-24 + HR-29** — Duration-warning wording fix (self-contradictory "only sum to" on an overshoot)
  + a test-fixture dedup, one commit.
- **HR-25** — `GOAL_TEMPLATE_PATTERNS` gained negation-awareness via the shared `tagPresent` primitive
  — narrower than the originally suggested full reuse of `goalRelevanceForFocus`, which was checked
  first and would have broken VO2max goal-text detection.
- **HR-26** — Added `route.season-enabled.test.ts` covering the `SEASON_SHAPES_GENERATION=true` branch,
  left completely untested after the flag-off tests replaced (not supplemented) the original assertions.
- **HR-27** — A `"Warmup 2x"`-style repeat header double-counted an excluded section's minutes in
  `totalPrescribedMinutes` only.
- **HR-28** — Pure relocation: `carriesEmbeddedIntensity`'s doc comment moved back next to its own
  function.
- **HR-30** — Extracted the shared `toleranceBand` helper into `lib/stats.ts`.

A combined live `/api/generate` re-run after the P1s landed confirmed `durabilityTemplate: B` (was
`A`) and `protocolViolations: null` on the same real fixture. 1190/1190 tests, tsc/eslint clean
throughout.

---

## Block-generation fidelity fixes + temporary season-disable (2026-07-16)

Five concrete defects surfaced by the athlete's first real generation on the redesigned
season/coverage-selector engine (`docs/superpowers/plans/2026-07-16-block-generation-fidelity.md`),
executed via subagent-driven-development, each task reviewed independently. Mid-execution, the
athlete separately decided season should stop shaping/gating block generation entirely for now (the
fixed phase-sequence model itself is a deferred, separate question — see "Season architecture doubt"
below) — this amended the plan before any task was dispatched: Task 3 was skipped as moot, and a new
Task 6 added the disable itself.

- **Deload cadence — genuine rolling calendar-week count** (`applyDeloadCadence`, `lib/season.ts`).
  The threshold (`every - 1`) was smaller than any real KB period's own length (all ≥3wk), so it
  fired on almost every period (5 of 6 in the athlete's real season) instead of a genuine ~4-week
  cadence. Dropping the `-1` lets short periods correctly accumulate across boundaries. Live-verified:
  the redrafted tail now shows `[false, true, true, false, true]` (~4wk spacing) instead of near-
  universal `true`; the athlete's exact reported symptom (2 deloads inside one 6-week block) is now 1.
- **Workout-duration self-consistency** (`totalPrescribedMinutes` + `validateDurationConsistency`,
  `lib/prescription.ts`/`lib/workout-validate.ts`). Ride-category calendar events never carry an
  explicit Intervals.icu duration, so the platform derives real ride time by parsing the workout-text
  steps itself — while NodeVelo's own hours totals used the AI's stated `durationMin` verbatim, and the
  prompt hedged with "approximately." A live 6-week block had interval sessions off by up to 32
  minutes; live-verified the new check still catches real mismatches post-fix (7 flagged, hand-
  confirmed 2 by re-summing the actual workout text) — this is the intended, accepted outcome
  (measurability, not a hard prompt guarantee).
- **Goal-vs-season-phase precedence rule — SKIPPED.** Would have added a prompt rule reconciling the
  block goal against the season's phase emphasis; moot once phase text is no longer shown to the model
  at all (see the disable below). Left unexecuted in the plan file as the record of the original
  finding, in case season generation-shaping is ever re-enabled.
- **Goal-aware durability template selection** (`selectDurabilityTemplate`, `lib/durability.ts`). Was
  100% insight-driven; a stated goal (e.g. "move up TTE") had zero influence on template choice. Added
  an optional trailing `goalText` fallback, checked only when no insight-driven match fires — a real
  detected weakness always wins outright. Live-verified both branches on real data: the goal text
  ("FTP → 300W") matches the Threshold/B pattern, but the athlete's real athlete-model currently
  carries a genuine `Overall`/`alert` insight (execution trending down, sampleSize 24) — correctly and
  by design overriding goal text to the safer template A, exactly the "absent a stronger insight-driven
  override" precedence this task specified.
- **B/C-priority event surfacing** (`formatUpcomingEventsForBlock`, `lib/season.ts`). Only A-priority
  events triggered anything (full backward-scheduling); B/C events (a planned FTP test, a KOM attempt)
  were stored but never surfaced, so a generic session could land directly on a real test day.
  Live-verified emphatically: the athlete's real B-priority "Areh FTP Test" (2026-07-22) and
  "Prepih-Vahta KOM Attempt" (2026-08-02) events each produced a session explicitly named after the
  event itself, not generic filler.
- **Temporary season-disable** (new Task 6, `SEASON_SHAPES_GENERATION` in `lib/season.ts`, default
  `false`). One named, reversible flag gates `formatSeasonContext`'s phase text, `formatRetestNote`'s
  retest nudge, and the `validateSeasonFit`/`validateFocusMatch` warnings out of generation — while
  `replanSeasonArc`/`writeSeasonPlan` keep running unconditionally every call, so `season-plan.json`
  (periods, deload flags, events) keeps evolving in the background for whenever the model is revisited.
  B/C-event surfacing (above) was decoupled onto its own always-on prompt variable so it keeps working
  regardless of the flag. Live-verified: the redraft updated `season-plan.json` (tracking intact) while
  the generated plan carried zero `Season fit`/focus-match warnings and no phase-period text.

**Live-verified end-to-end**: one real `/api/generate` call (6wk, the athlete's real goal/weakpoint
text, `startDate` 2026-07-20) exercised all four shipped fixes plus the disable simultaneously — 200
response, `npm run check` clean (1166/1166 tests) before and unaffected after. Full task-by-task
verification detail (including the diagnostic confirming the real `Overall` insight) in
`.git/sdd/progress.md`.

**Tracked debt, not fixed here** (flagged during this plan's execution, see ROADMAP.md "Season
engine — known debt"): B/C-priority event surfacing and the season-replan's `formatSeasonContext`
call currently share one `try`/`catch` — if `replanSeasonArc` itself ever throws, both the (already-
disabled) phase text AND the always-on event line are silently dropped together. Pre-existing
fragility inherited from the original plan's own "best-effort" design, not introduced by this
session; worth unwinding if event-surfacing reliability ever matters more than it does today.

---

## Training-engine redesign: coverage selector, macro-structure, measurability slice (2026-07-16)

First-principles research review (`research.md`) of the season/block engine, followed by four
sequential implementation plans executed via subagent-driven-development
(`docs/superpowers/plans/2026-07-15-*.md`), each with per-task review and a final whole-branch
review. 24 commits, `lib/season.ts` the primary surface across three of the four plans.

- **Two critical bugs fixed** (`season-critical-fixes`). `assignLoadTargets`/`applyDeloadCadence` had
  a semantic collision — every 3–4wk period tripped the deload cadence and got dampened to 0.6x with
  the ramp frozen, flattening whole seasons to a plateau and making the one unflagged period spike
  ~76% above everything. `nextBuildFocus`'s fallback (`defaultBuildOrder().find(f => f !== last)`)
  made `vo2max`/`durability` structurally unreachable whenever the confident limiter was `anaerobic`,
  producing a permanent two-focus oscillation — the ROADMAP debt item calling this out is now resolved
  and removed.
- **Scored coverage selector** (`season-coverage-selector`). Replaced the fallback with
  `scoreFocusCandidates`/`selectBuildFocus` — a weighted sum over goal-relevance, decay-urgency (real
  generated-session exposure where it exists, KB-label estimate elsewhere), trainability, and
  execution quality, with the confident limiter demoted from an unconditional winner to a bounded
  bonus (max 0.20 of the total). Physiology grounding: Hickson et al. 1985 (intensity, not
  volume/frequency, is what must persist) and Odden et al. 2024 (threshold and VO2max work both raise
  VO2max comparably — a goal-driven athlete should be steered to the aerobic ceiling, not a
  deficit-greedy "weakest system" pick). Wired into `/api/generate` via `focusSignals` (goal text +
  `exposureFromSessions` + `execQualityByFocus`) and a new `validateFocusMatch` warning (a period's
  focus label vs. what was actually generated). A live-verification pass during this plan's own
  integration task caught a subtler bug of its own: real-exposure signals were computed once as of
  "today" and never grew as the draft loop hypothetically advanced through future periods (unlike the
  label-derived fallback, which correctly regrows) — fixed by extrapolating a not-yet-drafted focus's
  staleness forward by elapsed draft-weeks.
- **Macro-structure layer** (`season-macro-structure`). The event-anchored path
  (`backwardScheduleFromEvent`) now shares the scored selector via `pickBuildFocus`, instead of a
  fixed 3-focus index cycle that could never reach `anaerobic` or place a confident limiter
  race-specifically. Added bounded 8–12wk emphasis arcs (`weeksSinceBase`, an arc cap that re-touches
  aerobic base before consecutive loading crosses the ceiling — Foster 1998, illness risk tracks load
  × monotony) and a genuine 2wk reduced-load `phase: "transition"` period every ~20 loading weeks
  (~2 arcs), distinct from the existing per-period `deloadWeek` flag: 50% load cut vs. 60%, exempt
  from deload flagging, and its own season-fit warning. An 8-week FTP retest nudge
  (`formatRetestNote`) points at the next lighter slot. `/plan`'s season roadmap now explains the
  peak/taper countdown when an A-priority event is driving the plan.
- **Block-generation measurability** (`block-generation-measurability`, code-complete, live smoke
  run outstanding — see below). `computeSessionLevel` derives a comparable difficulty stamp
  (`{score, workMin, avgPctFtp, bandPosition}`) from a session's parsed prescription, frozen onto
  `CurrentBlockDay` at write time so block N's Threshold session can be compared to block N+2's even
  though the LLM wrote them independently. `splitPlanProtocol` replaces the flat
  `validatePlanProtocol`: quality-session (Threshold/VO2max/SIT/RaceSim) protocol breaches now land in
  a distinct `GeneratedPlan.protocolViolations` field, rendered as a red box above the ordinary amber
  warnings in `PlanPreview` — deliberately scoped short of single-day auto-regeneration (the generator
  is whole-block-only; a targeted retry would need a new day-level tool schema, prompt builder, and
  merge plumbing disproportionate to this slice).
- **A confirmed defect found by the final whole-branch review**, not any individual task review: the
  real-exposure extrapolation filter (above) checked membership against `recent` — an array seeded
  from the incoming period-label history and only ever growing — instead of tracking which foci this
  specific draft call had actually drafted. In practice this silently discarded real generated-session
  exposure data for any focus whose label already appeared in the last-4 kept periods (the common
  case on a mature season), defeating the real-data preference for exactly the foci most likely to
  have it. Fixed with a dedicated `draftedThisCall` set.

**Live-verified**: the rolling (non-event) path end-to-end via the real `/api/generate` pipeline —
correct rotation reaching every build focus, arc-cap resets, and goal-driven steering all confirmed
against real athlete data. The event-anchored path's pre-LLM redraft (backward scheduling, build
rotation reaching `anaerobic`, peak/taper landing exactly on the event date) and the new countdown UI
copy were both confirmed live via a temporary placeholder event (added and cleanly reverted
afterward). **Outstanding**: the full end-to-end live smoke run for both the event-driven path's
actual generated content and the measurability slice (Task 5) is blocked on an Anthropic account
billing issue ("credit balance too low"), not a code defect — required before either can be called
fully done per this repo's AGENTS.md rule. Full detail in `.git/sdd/progress.md`.

---

## 6-week block review: season multi-period, protocol false-positives, hours, press-lap (2026-07-14)

Reviewed a live 6-week block generated after the token-budget fix above and traced its four validator
warnings plus a volume complaint to root cause, then fixed all of them (three parallel subagents, one
each — file-disjoint by design so they could run concurrently with no merge risk — plus a fourth
research-only agent for the press-lap syntax question).

- **Season multi-period awareness** (`lib/season.ts`, `app/api/generate/route.ts`). The season context
  injected into the prompt, and `validateSeasonFit`'s check, were both a single static snapshot of
  whichever period was active at generation time — fine for a 2-4 week block, broken for 6-8 weeks,
  which routinely spans 2-3 periods. A live block spanning aerobic-base → anaerobic → threshold had its
  own overview call the whole thing "aerobic-base," and the fit-check blamed build-week quality work on
  the base period's 90/10 expectation. New `periodForDate`/`periodsInRange` + a multi-segment
  `formatSeasonContext` (byte-identical single-period output preserved, pinned by test) + per-day-scoped
  `validateSeasonFit` fix it. Also switched hard-share from session-count to duration-weighted, which
  independently fixes a structural false positive: `qualitySessionsPerLoadingWeek=2` on a 6-day week is
  already ~33% by count, guaranteeing the old 20%-ceiling warning fired on every base-period block
  regardless of what was generated.
- **Warmup/cooldown steps mis-validated as work** (`lib/prescription.ts`, `lib/workout-validate.ts`).
  `parsePrescription`'s own doc comment said warmups are ignored, but the implementation was blind to
  sections entirely — a warmup priming step at 80-85% FTP cleared the flat 80% work-threshold and got
  validated against the day's *main-set* protocol, producing warnings like "effort at 80% FTP is below
  the 130% floor" for what was actually a normal warmup, not a malformed SIT set. Steps under a
  Warmup/Cooldown label are now dropped outright; TDD confirmed 7 of 10 new tests were red for exactly
  the reported shape before the fix.
- **Weekly hours under-following their own stated floor** (`lib/anthropic-prompts.ts`). A live block's
  loading weeks landed at 8.5-10.8h against a stated "10-12h, at least 10h" instruction — two of four
  weeks below the floor, not a target-setting mismatch. The long ride was correctly sized every week;
  the shortfall was in easy Z2 sessions landing compact (60-90min, an explicit prompt cap) rather than
  filling the range. Rewrote the instruction to make hitting only the minimum count as a shortfall and
  named easy-session duration as the lever, removing the `(60-90 min each)` cap that was itself part of
  the problem.
- **Intervals.icu "press lap" step syntax** — researched (forum + official docs, not just the athlete's
  paraphrase) and added to `WORKOUT_SYNTAX_GUIDE` plus `knowledge-base/training_knowledge.md` §7. Verified
  mechanism: the literal phrase "press lap" in a step ends it on the device's lap button instead of a
  timer — Garmin/Suunto via Garmin Connect only, inert elsewhere — adoptable through the exact same
  plain-text calendar-description path this app already uses, no new integration. Scoped to
  positioning/readiness steps only; never the actual prescribed work interval.

**Live-verified together** (not just unit tests): a fresh 6-week generation, after all three fixes
landed, produced an overview that correctly narrates the phase shift ("Weeks 1-2 are a base deload...
Weeks 3-5 shift into an anaerobic build... Week 6 pivots to threshold"), a season-fit warning precisely
date-scoped to the base-period portion at a plausible 25% (vs. a blanket 33-71% before), no SIT/VO2max
false positives, and loading weeks in the 10.2-10.8h band for the weeks not affected by a season deload
flag.

---

## Goals/weakpoints: profile ↔ block-generator round-trip (2026-07-14)

Follow-up from the block-generation work below, prompted by the athlete asking for concrete goal/
weakpoint suggestions based on the just-finished block's retrospective and actual power-curve data
(FTP 288W, 1-min 507W, 5s 749W vs. reference ratios — confirmed neuromuscular/5s is the real
depressed system, not 5-min/VO2max as the stale weakpoint text implied). That surfaced a structural
gap: the block-generator's free-text goal/weakpoints boxes and the Profile page's structured editor
were two fully disconnected surfaces — edits in one never reached the other.

- **Weakpoints textarea silently dropped `detail`.** `PlanView.tsx`'s prefill joined only
  `w.weakpoint`, discarding every weakpoint's explanation on every page load. Now pre-fills as
  `"label: detail"`.
- **Opt-in "Save to profile" action** (`components/dashboard/BlockGenerator.tsx`,
  `lib/profile-goals.ts`) parses the edited free text back into the profile's structured shape and
  PUTs it — deliberately not automatic, so a one-off per-block wording tweak doesn't force a
  permanent profile change. Goals need a **scoped merge**, not a blind replace: the goal box is
  pre-filled from `filterGoalsByFocus` (only the current season period's goals + `general`), so a
  goal outside that shown subset is always preserved untouched; a shown goal still present in the
  text keeps its `focus` and takes the edited target; a shown goal removed from the text is treated
  as a deliberate deletion; a genuinely new label defaults to `focus: "general"` (the text has no way
  to express a focus). Weakpoints have no subset problem (the box always shows the full list), so
  parsing the text is the new array directly.
- **Verified live** against the real API and `data/athlete.json`: added a throwaway goal/weakpoint
  through the UI, confirmed the merge preserved all 8 existing goals' targets and all 9 weakpoints'
  `detail` text while adding the new entries, then removed them and re-saved to confirm deletion
  semantics and restore the original profile exactly.

_Deferred:_ focus-tag selection in the block-generator box itself. On inspection, `focus` only
controls whether a goal auto-populates into the box for the *current* season period — it's not a
scheduling constraint, doesn't change what the model generates, and (since a goal tagged to a
non-current focus can silently vanish from the box on the next profile refresh) risks being mistaken
for something it isn't. The athlete's goals are all `general` today (always shown) and no
phase-scoped goals were wanted, so this wasn't built.

---

## Reliable long-block generation + generator/season UI fixes (2026-07-14)

Debugged three athlete-reported issues that traced back to one unfinished plan
(`docs/superpowers/plans/2026-07-13-reliable-long-blocks-and-season-clarity.md`) an external agent
(Codex, branch `codex/reliable-long-blocks`) had started but only partially shipped — it committed
the (insufficient) grid-breakpoint change and left failing test scaffolding for the other two tasks.

- **6/8-week generation failures.** `generateTrainingBlock` (`lib/anthropic-api.ts`) used a fixed
  8,000-token ceiling regardless of block length; a 6-week block's 42 structured days routinely hit
  it mid tool-call, producing a generic "did not return a structured plan" error with no hint why.
  Added `generationMaxTokens(lengthWeeks)` (8k/8k/12k/16k for 2/4/6/8 weeks) and threaded the
  provider's `stop_reason` through `GenerationResult` so `/api/generate` can surface a precise,
  retryable "exceeded the response limit" error instead. **Live-tested against the real Anthropic
  API**: a 6-week block generated cleanly, 42/42 days, no truncation.
- **BlockGenerator field overlap.** Codex's committed fix (`lg:grid-cols-4` → `xl:grid-cols-4`)
  didn't actually resolve it — measured real ~44–60px overlap between the "8 weeks" button and the
  Start Date field at both 1280px and 1440px (MacBook-realistic widths) via live DOM measurement.
  Root cause was the length-buttons' fixed min-content width exceeding any single grid column at
  realistic widths, not the breakpoint. Fix: the four buttons render as a 2×2 grid
  (`components/dashboard/BlockGenerator.tsx`) instead of a shrinking single row, so they can't
  overflow their cell regardless of viewport width.
- **Unexplained season roadmap.** `SeasonRoadmap` showed the auto-derived roadmap with no
  explanation of where it came from. Traced construction: `replanSeasonArc` (`lib/season.ts`) runs
  inside every `/api/generate` call, freezing past periods, preserving the in-progress period and any
  athlete-edited overrides, and re-drafting future ("derived") periods from the saved objective/
  events/CTL/FTP/recent load/limiter. Added one line under the roadmap explaining this when any
  period has `source: "derived"`.
- **Side effect caught mid-verification**: `npm test`/`npm run lint` weren't excluding the gitignored
  top-level `.worktrees/` (only `.claude/worktrees/*` was covered) — a stray worktree's own copy of a
  test fired a real, bogus-key network call to Anthropic during the verification run. Fixed both
  `vitest.config.ts` and `eslint.config.mjs`.

**Cleanup**: removed the superseded `codex/reliable-long-blocks` branch + its `.worktrees/` checkout,
and two other stale branches (`ui-fixes`, `worktree-ui-research`) that had zero commits beyond what
`main` already contained.

---

## On-plan Z2/Recovery aerobic-baseline merge + diagnostic insight (2026-07-12)

Athlete-flagged discrepancy: the block retrospective's `complianceByType.Z2 = 107%` (pure duration
ratio) contradicted the coaching insight "Z2 is a weak point, 5.4/10" (the HR-ceiling execution-score
axis from the 2026-07-10/11 rework, above). Investigation confirmed both numbers were honest —
they measure different things — but also surfaced a real gap: planned Z2/Recovery rides were graded
against the single-ride HR-ceiling breach (`aerobicDisciplineRead`) only; they never got compared to
the athlete's own 90-day aerobic-efficiency baseline (`aerobicEffPct`, `lib/aerobic.ts`), which
already existed but was wired for off-plan rides and the Today athlete-state driver only. Plan:
`docs/superpowers/plans/2026-07-12-01-z2-aerobic-baseline-merge.md`, executed via
subagent-driven-development (6 code tasks, each independently reviewed).

- **Real-data diagnosis before any code changed.** Pulled the athlete's actual June block ledger:
  all 4 indoor (VirtualRide) Z2 sessions scored 9–10 at 0–1.5% HR time above the aerobic ceiling;
  outdoor rides split bimodally — controlled ones (1.3–8.7% above ceiling) scored 8–10, "ran hot"
  ones (17.7–34.1%) scored 1–6. Confirmed separately that fatigue-cost tracking (CTL/ATL/TSB/ACWR)
  was already correct — it reads Intervals.icu's real per-ride `trainingLoad`, not a planned figure —
  measured controlled Z2 rides at ~0.73–0.84 TSS/min vs. ~1.03–1.15 TSS/min for ran-hot ones, a real
  25–55% load premium already flowing into the fatigue model with no code change needed.
- **The merge (`lib/execution-score.ts`, `mergedEasyRead`).** The HR-ceiling read and the aerobic-
  efficiency-vs-baseline read share one physiological cause (HR up relative to power) observed at two
  granularities — resolved to one merged read, not two stacked penalties. HR-ceiling "hot" stays the
  primary judge (−4, unchanged, eff ignored — already the full guardrail). A new "corroborated drift"
  path (drift + `aerobicEffPct ≤ −6%`) adds **−2**, capping that ride at 7/10 — an intermediate step
  between plain drift (0) and hot (−4). A "hollow dialed" ride (HR-ceiling clean, but a bad baseline
  reading) withholds the +1 bonus rather than penalizing — Pw:HR is flaky (heat/hydration/caffeine),
  so it should never cost points when the HR-ceiling discipline itself held. No new bonus is ever
  granted from `aerobicEffPct` on-plan, preserving the existing zero-margin guardrail invariant.
- **Ledger provenance stamp.** `RideScoreEntry.easy?: { indoor, hrRead?, aerobicEffPct? }`
  (`lib/score-log.ts`, `easyStampFor`) freezes the inputs behind the merged read, planned Z2/Recovery
  + non-embeds-efforts only — mirrors the `fuel`/`intervals` provenance pattern so the athlete model
  can diagnose indoor/outdoor + ran-hot patterns without re-joining activities. The sync route's
  today-patch re-stamps from the same re-bucketed HR data the day's `executionScore` uses (not the
  raw synced zones), closing the exact drift-class gap the 2026-07-11 rework's own follow-up fix
  ("Coach-prompt aerobic-discipline gap closed") had already warned about for a different surface.
- **Diagnostic insight (`lib/athlete-model.ts`).** `deriveInsights` now recognises the bimodal
  indoor/outdoor pattern (≥2 hot outdoor rides among ≥3, with a genuinely healthy indoor/controlled-
  outdoor side) and replaces the generic "ease the prescription" suggestion with one naming the real
  pattern and its measured TSS/min premium, falling through unchanged to the old generic branches
  when the pattern isn't present (verified byte-identical against a no-stamp fixture). One deliberate
  judgment call: the "healthy side" check uses a new `outdoorControlledExecAvg` field (outdoor rides
  excluding the hot ones) rather than the mixed outdoor average, because the mixed figure would let
  hot rides pollute the very check meant to isolate from them — hand-verified with a worked example
  during review.
- **Narration.** The ride-note LLM prompt (`lib/anthropic-prompts.ts`) and the Ask-Coach SITUATION
  line (`lib/coach-snapshot.ts`) both surface the efficiency figure when it's notably below baseline
  (`AEROBIC_DEADBAND_PCT`, shared constant — not a re-typed literal), and the "ran hot" label now
  states explicitly that the ride's real training load (not the plan's) is what the fatigue model
  reads, so the extra cost is already counted against freshness.

**Live verification (2026-07-12).** `/api/analyze` re-run on the athlete's actual "ran hot" ride from
today: the real coach note said *"that cost is already sitting in your fatigue model"* — the new
narration confirmed against the live Anthropic API, not a mock. A live block-generation smoke run (to
confirm the new insight reaches `lib/synthesis.ts`'s directive block) was intentionally skipped this
session — the athlete was mid-generating their own next block in the UI at the time, and triggering
`/api/generate` myself would have crossed that boundary even though the endpoint alone is preview-only.
`lib/synthesis.ts` is a plain title/evidence/suggestion string passthrough (independently confirmed
during task review), so the risk of it silently breaking only in the live prompt is low; worth a real
check next time a block is actually generated.

**Ledger rebuild (2026-07-12, `rebuildLedger: true, force: true`).** Re-scored all 15 of the athlete's
real planned Z2 rides under the new logic. Every score matched hand-derived expectations exactly: hot/
dialed/indoor rides stayed byte-identical (the −4 guardrail predates this work); the two rides sitting
in the 10–25% "drift" band did **not** trip the new corroborated-drift penalty, because their real
`aerobicEffPct` was positive or unavailable, not corroborating — a legitimate real-data outcome, not a
bug (this athlete's drift-band rides and bad-baseline rides simply never coincided in this block). One
durability-template ride correctly received no `easy` stamp (the embeds-efforts gate held on real data).

---

## Trend detector was blind to a recovered tail (2026-07-12)

`trendOf` (`lib/athlete-model.ts`) classified a workout type as "trending down" off a blunt
first-half-vs-second-half mean split — so two hot rides sitting mid-window could outvote a real
recent recovery. Live case, post-rebuild (see the entry above): real Z2 history
`[8,10,3,9,10,9,6,6,9,10,3,3,10,8]` read "declining over 14 sessions, consider a recovery week"
despite the athlete's two most recent sessions scoring 10 and 8 — already recovered, contradicting
the insight's own suggestion.

- **Why re-weighting alone doesn't fix it.** `execEwma` (the level stat shown beside trend) is
  already recency-weighted; trend was the one stat in the model that wasn't. But hand-verified: EWMA
  and OLS slope both *still* classify this exact sequence "down" — any global weighting lets a
  two-ride dip buried mid-window outvote a genuine tail recovery. The fix has to explicitly ask "has
  the trajectory already turned?", not just weight recency harder.
- **The fix: a tail-turnaround guard**, symmetric for both directions (a stale "up" is equally
  dishonest — `athlete-state.ts` consumes both). A "down"/"up" verdict only stands if it still holds
  across the **last two** sessions (two, not one, so a single fluky ride can't flip the read either
  way) — reuses the existing `eps` tolerance, no new magic numbers.
- **Genuine declines still read as declines** — the existing monotonic-decline test case
  (`[8,7,6,5,4,3]`) is untouched by the guard (tail stays meaningfully below baseline).
- Designed and implemented by a Fable 5 subagent per the architecture/design-tradeoff escalation
  trigger — this changes trend semantics for every workout type plus the overall-execution insight,
  not a Z2-specific patch.

**Live verification:** `/api/trends` and the rendered `/trends` page no longer show "Z2 trending
down" against the real ledger. The "Execution trending down" (Overall, 22-ride window) insight still
fires — checked by hand: a genuine borderline case, its tail sits 0.08 below the recovery bar, not a
regression, and already carries the hedged "could be accumulated fatigue, a harder block, or more
outdoor riding" wording from the 2026-07-11 honesty fix.

---

## Morning-check live-use fixes + ride-note HR-discipline surface + the one-time ledger rebuild (2026-07-12)

Four fixes from one live-use report (the athlete skipped a 60-min Z2 for extreme fatigue and the app
fought them at every step), landing the day the block turns over — so the turnover reads honest data.

- **Morning check: verdict survives refresh.** The GET already returned today's stored flag, but the
  component only rendered the in-memory POST result — a reload silently fell back to the collapsed
  prompt (the athlete's flag "disappeared" every refresh; the write had in fact persisted). The card
  now re-derives from the stored entry: `MorningCheckEntry` gains sparse `reasons` (frozen at flag
  time — recomputing later drifts once an applied downgrade changes today's quality-day status) and
  `appliedAt` (stamped by PUT, so a refreshed UI shows "applied" instead of re-offering an Apply that
  would now 400). A "Change" affordance re-opens the prompt; one entry per day, re-submission replaces.
- **Morning check: ill/extreme-fatigue on easy days.** Previously gated to quality days ("nothing to
  downgrade"), leaving only "Injured" on a Z2 day — the athlete had to record a false injury to skip.
  All three flags now surface on any ride day; on an easy day ill/fatigue verdict **rest** (skip the
  volume day — it costs little; grinding through digs the hole deeper), preserving the quality-day
  downgrade machinery unchanged.
- **`formatCoachSnapshot` morning-check line mislabeled.** An injury flag rendered as "extreme fatigue
  → no change (not a quality day)" — both halves wrong (the label map only knew two flags, the decision
  map only knew downgrade). All three flags and decisions now render honestly, with rest framed as
  deliberate recovery, not a lapse.
- **Ride-note prompt: the third LLM surface with the terrain-confound bug.** `buildRideAnalysisPrompt`
  still said "Power is the primary lens" and handed the model a raw power-zone distribution with no HR
  context, so the debrief coach note re-derived the exact "zone creep" narrative the 2026-07-11 scoring
  rework eliminated (the real 07-10 note called a dialed-in hilly Z2 "significant zone creep", score 3,
  while the rebuilt ledger scores it 8). `RideAnalysisInput` gains `aerobicDiscipline` (wired from the
  stored `TodayAnalysis` in `addCoachNote` — first-generation and re-analyse both carry it); when
  present the prompt instructs judging "was it easy" ONLY on the HR-judged read. **Live smoke run:**
  force-regenerated the real 07-10 note — now *"discipline was genuinely dialed in: 91% of the ride in
  Z1–Z2 HR"*, credits the −3.5% Pw:HR drift as durability, and critiques only the honest deviation
  (92 min ridden vs 60 planned).

**One-time data operations (same session, not commits — `data/` is local):**
- **The sanctioned ledger rebuild ran** (`POST /api/sync {rebuildLedger: true}`, one-shot marker now
  written). All 124 entries re-scored from synced activity data under the current HR-judged
  methodology: Z2/Recovery average **5.6 → 7.4** (07-10: 3→8, 07-01: 6→9, 06-28: 1→6) while genuinely
  hot rides stayed low (07-04: 1→3, 07-05: 2→3). Athlete-state execution read 5.4 → 7.3; the false
  "struggling with Z2 (4.9/10)" insight pattern is gone from the block-turnover inputs. What remains
  ("Z2 trending down", watch severity) is derived from honest scores — driven by the two real hot rides.
- **The same sync pulled HRRc for the first time** — the cached `last-sync.json` predated the HRRc
  parser (0/191 activities had the field; the Trends card correctly hid). Now 91/190 carry a reading,
  52 qualify for the outdoor-only series, and the HRRc sparkline renders in Trends' Engine group.
- **Corrected the 2026-07-11 morning-check entry** from `injury` (the only button available at the
  time) to `extreme-fatigue`/rest — what the athlete actually reported.
- **Aligned the frozen 07-10 debrief** with the rebuilt ledger (score 3→8, compliance un-capped
  54→100, `aerobicDiscipline: "dialed"` added) before regenerating its note.

---

## HRRc — heart-rate-recovery Trends signal (2026-07-10, shipped 2026-07-11)

Adds HRRc (heart-rate recovery after a sustained hard effort) as a second HR-derived Engine signal on
Trends, alongside Pw:HR — Pw:HR only reads on easy Z2 rides, HRRc only reads on hard/interval rides, so
together they cover both ends of the intensity spectrum from the same HR strap. Plan:
`docs/superpowers/plans/2026-07-10-06-hrrc-trends-signal.md`.

- **Synced defensively.** `ActivitySummary.hrrc: number | null` — multi-keyed against the Intervals.icu
  payload the same way `decoupling` already hedges two possible keys, since the exact field name was
  unconfirmed going in.
- **`hrrcSeries()`** (`lib/trends.ts`) mirrors `efSeries()`'s shape exactly: outdoor rides only, sorted
  by date, `{date, value}[]`. Wired into `/api/trends`.
- **Rendered as a neutral, unscored sparkline** — deliberately no `trendDir` verdict badge (the
  green/red "improving"/"declining" treatment every other Engine card gets). **Why it stays out of the
  Today fatigue fusion, on purpose:** functional-overreaching research finds HRR *rises* (not falls)
  during a deliberate, well-tolerated overload block — the opposite of the "faster recovery = fresher"
  intuition. A metric whose "good" direction flips depending on training-phase intent can't safely cap
  a daily readiness score without knowing whether the athlete is intentionally mid-overload, and the
  app has no such disambiguation today (it would need to read Season phase — real scope, not a tweak).
  Same "read the trend, not the point" caveat Pw:HR already carries, stated explicitly in the caption.
- **Engine section gate extended** — the section now renders on `data.hrrc.length >= 3` alone, not just
  `ef`/`ctl`, so a rider with qualifying interval efforts but no steady Z2 rides still sees Engine.

**Live verification (2026-07-11):** checked against 42 real rides (~45 days) via the live Intervals.icu
API. The plan's original field-name guess (`numLoose(a.icu_hrr)`, a flat number) would have silently
read `null` forever — the real payload nests it (`icu_hrr: {start_bpm, end_bpm, hrr, ...}` or `null`),
so the actual bpm-drop value lives at `icu_hrr.hrr`. `icu_hrrc` doesn't exist in the real payload at all
(kept as a harmless dead fallback alongside a bare `hrrc` key, in case a future API revision adds it).

**Final-review fixes:** removed a dead unused `FOCUS_LABELS` import in `SeasonRoadmap.tsx` (left over
from the season-teaching-flow plan below); the new `hrrcSeries` test used untyped `{...} as any`
fixtures instead of the file's own typed `act()` helper — 4 real `@typescript-eslint/no-explicit-any`
lint errors, caught and fixed when this batch was finished and pushed after the session that built it
ran out of credits mid-review.

---

## Layout density — Plan calendar & Trends dead-space (2026-07-10, shipped 2026-07-11)

Two presentational fixes, each grounded in measured DOM geometry (1280×800 viewport,
`getBoundingClientRect`, re-measured after each change rather than trusted from a screenshot — the
capture pipeline scales the JPEG). Plan: `docs/superpowers/plans/2026-07-10-05-layout-density.md`.

- **Plan calendar hoisted + resized.** The Active-block card previously stacked header → overview →
  "This week" → calendar, burying the block's primary artifact and reschedule surface (28px cells)
  under 393px of text/stats. Calendar now sits directly under the header with a proper drag/tap cell
  height; the long overview moved to the bottom.
- **Trends "Weekly volume" card filled.** Force-stretched (`items-stretch`) to match its taller sibling
  card, its 56px bar chart left ~109px of dead air below the caption. Bars now sized to use the space
  (chart height ≈130px).
- Explicitly **not** touched: `RescheduleBanner` position (alerts stay high, per UX-CONSTITUTION §4);
  the Engine sparkline cards' padding (intentional thin-SVG look); a "Recent baselines stretched"
  concern that was measured and found to be a non-issue.

---

## Profile page density (2026-07-10, shipped 2026-07-11)

Cut Profile-page redundancy and bulk across two presentational components, no data/API changes. Plan:
`docs/superpowers/plans/2026-07-10-04-profile-density.md`.

- **Effort Bands collapsed** into a compact disclosure — reference data, not something read every
  visit.
- **Rider-profile watts de-duplicated against Power PRs** — Power PRs already owns the power-duration
  curve numbers; Rider-profile keeps the phenotype label + strong/weak read, drops the redundant watts.
- **Goals grouped by focus** (`lib/profile-goals.ts groupGoalsByFocus`) instead of a flat list with a
  chip per row — reads `goal → target` under focus headings; shares the `SeasonFocus | "general"`
  union and `FOCUS_LABELS` (below) with `lib/season.ts`, so "general" clusters honestly as "all phases"
  rather than reading as noise.
- **Scope correction made during planning, not after:** the Profile "Current performance" tiles and the
  Trends "Recent baselines" tiles mostly show *different* things (the only real overlap is
  w/kg@threshold) — no broad Current-Performance↔Recent-Baselines de-dup was needed; the actual
  intra-page duplication was Rider-profile↔Power-PRs, above.

---

## Season ↔ Block teaching flow (2026-07-10, shipped 2026-07-11)

Makes the Season → Block → goal relationship legible through UI structure instead of prose — the
pieces already existed and were wired in data (`SeasonRoadmap`, `currentPeriod`,
`filterGoalsByFocus`, `suggestedBlockWeeks`); the gap was purely presentational. No new engine logic.
Plan: `docs/superpowers/plans/2026-07-10-03-season-block-teaching-flow.md`.

- **Honest focus labels.** `FOCUS_LABELS` (`lib/season.ts`) maps `general` → **"all phases"** instead of
  a meaningless-looking default — `general` isn't a physiological system, it means "relevant in every
  phase" (`filterGoalsByFocus` already always includes it; this is display-only, stored values
  unchanged). Consumed by the Profile goals grouping above too.
- **No-season teaching stub** — the roadmap slot on `/plan` now teaches "what a season does" in three
  steps when no season exists yet, instead of sitting empty.
- **Objective field re-scoped, not replaced** — the existing season `objective` input's intro copy and
  label now state the relationship explicitly ("one line on what you're chasing... blocks are generated
  *against* it"), rather than reading as a vague freeform text box.
- **Generator shows what it's targeting** — a "Targeting `<phase>` · pulling N goals · edit profile →"
  line now renders above the block generator, sourced from `FOCUS_LABELS` + `filterGoalsByFocus`
  against the season's current period.

---

## NP-missing ledger honesty stamp + two UX v2 Wave 5 polish nits (2026-07-11)

Three small, independently-diagnosed items closed together from ROADMAP's UI-refinements and
scoring-core-gaps sections.

- **`RideScoreEntry.npUnverified` (ROADMAP #8).** The Today debrief already shows an "NP"/"avg" IF
  provenance badge for the live ride (`components/dashboard/today.tsx`), but the historical ledger
  had no equivalent — a ride whose `intensityFactor` fell back from normalized power to raw avg
  watts (NP absent) was indistinguishable from a true NP-based entry once frozen. `npStampFor`
  (`lib/score-log.ts`, mirroring the existing `calStampFor`/`fuelStampFor` provenance-stamp pattern)
  freezes `npUnverified: true` onto both planned and off-plan entries in `buildRideScores` when
  `normalizedPower` is null but `avgWatts` still let the IF compute — sparse-field convention, absent
  (not `false`) on every other entry, so the corpus's trainable data carries this honesty signal
  without a migration. Provenance only for now, same as `formState`/`fuel`/`preLoad` — no new UI
  consumer yet.
- **`VerdictStrip`'s "down" axis chip colored amber, not red** (`components/trends/verdict.tsx`) —
  every other declining Trends signal (`trendDir`, `driverEffectClass`, `ScoreBars`,
  `StateDriversCard`'s bars) uses red for a decline; this one didn't. One-line fix:
  `DIR_CLS.down` now reuses the same `text-red-600 dark:text-red-400` the file's own `WORD_CLS`
  already used for "Slipping". Live-verified: a real "delivery ↓" chip rendered red immediately.
- **`deriveTrendsVerdict`'s "Mixed" bucket fired on net score alone, not real disagreement**
  (`lib/trends-verdict.ts`) — e.g. steady engine + steady delivery + fueling-down netted a mildly
  negative score and bucketed "Mixed," even though no axis was actually in tension with another,
  while a genuine disagreement case (engine down, delivery up) landed on "Holding" instead — backwards
  from what the word should mean. Fixed by gating "Mixed" on an explicit engine-vs-delivery direction
  conflict (one up, one down) instead of a score range; everything else falls through to a
  magnitude-only Improving/Holding/Slipping read (fueling still only ever drags, never lifts). All 4
  pre-existing word tests — including the genuine-disagreement case — still pass unchanged; one new
  test pins the fixed steady+steady+fueling-down → Holding case.

---

## `formatFormFuelLine` mislabel bug closed — block-generation fuel line tracks fuelingState's real source (2026-07-11)

Closed the milder sibling of the `formatCoachSnapshot` fuel-line mislabel bug (fixed earlier the same
day, see the weekly energy-balance entry further down this file): `formatFormFuelLine`
(`lib/coach-snapshot.ts`, feeds the `/api/generate` block-generation prompt) unconditionally labeled
`fuelingState` "energy availability" even when the weekly intake-vs-need ratio, not the EA proxy, was
the actual source — no contradicting kcal/kg figure attached like the Ask-Coach line had, just the
wrong word ("energy availability low" when the athlete's own EA band would call the same kcal/kg
figure adequate).

- **Fix.** Same shape as the already-shipped fix: `label = weekBalance ? "fueling" : "energy
  availability"`, applied before the `fuelingState` value in the generation prompt line.
- **Coverage gap closed.** No existing test exercised the weekly-ratio-present path through this
  specific function (ROADMAP had flagged this) — added one using the same `weekBalance` fixture the
  sibling `formatCoachSnapshot` tests use.
- **No live block-generation smoke run.** `/api/generate` unconditionally re-plans and persists
  `data/season-plan.json` on every call (`replanSeasonArc` → `writeSeasonPlan`) before generating, and
  the generation call itself takes 1–2 minutes against the larger generation model — both a real
  mutation of shared live app state and a real cost, disproportionate to verifying a one-word label
  swap in one line of a much larger, otherwise-unchanged prompt. Verified instead via the new unit
  test against the real `weekBalance` fixture shape, plus typecheck + the full suite green
  (951 tests). The sibling label fix already got a live LLM verification on the equivalent text
  (formatCoachSnapshot → real `/api/ask` call, see below) confirming the LLM handles this label
  correctly when it appears in a prompt.

---

## Coach-prompt aerobic-discipline gap closed — `CoachSnapshot.today.execution` reads the HR-judged signal (2026-07-11)

Closed the gap the HR-judged easy-ride discipline rework surfaced but didn't fix (see "HR-judged
easy-ride discipline" further down this file): `formatCoachSnapshot`'s `today.execution` block
(`lib/coach-snapshot.ts`) independently recomputed `z2Frac` from the old, terrain-confounded
`timeAboveZ2Fraction(ride.powerZoneTimes)`, so the Ask-Coach prompt could still call a genuinely easy,
hilly outdoor ride "drifted hard above zone" on the same ride the HR-based score and Today debrief UI
had already correctly rewarded.

- **Fix.** Deleted the recomputation entirely — `CoachSnapshot.today.execution` now reads
  `ride?.aerobicDiscipline ?? null` straight off `TodayAnalysis`, the field `lib/ride-analysis.ts`
  already computes with the correct HR-based measure and the correct gating (on-plan, Z2/Recovery
  only, `!embedsEfforts`). No gating logic is duplicated in `coach-snapshot.ts` anymore, so it can't
  independently drift from the score's own gates again.
- **Type + prompt line.** `CoachSnapshot.today.execution.aboveZ2Pct: number | null` (a percentage)
  became `aerobicDiscipline: AerobicDiscipline | null` (`"dialed" | "drift" | "hot"`).
  `formatCoachSnapshot`'s SITUATION line changed from `"25% above Z2 cap (dialed in)"` to
  `"aerobic discipline: dialed in"` / `"some drift"` / `"ran hot"` — matching the Today debrief UI's
  own wording exactly, so the athlete and the coach prompt now say the same thing.

**Live verification (2026-07-11):** real `/api/ask` POST against the running app, using the actual
2026-07-10 synced Z2 ride (92 min, hilly outdoor route — HR only 9.6% above aerobic ceiling but power
zones 3+ totalled 20% of ride time). Before this fix that ride's old power-based measure would have
rendered `"20% above Z2 cap (drifted above zone)"` in the coach prompt; the correctly-gated HR read is
`"dialed"`. Patched the one missing field into a scratch copy of `data/today-analysis.json` (the
on-disk record predates this rework and was missing `aerobicDiscipline` — a genuine pre-existing-file
migration gap, not new; the field will backfill on the next real sync) with the exact value the real
`aerobicDisciplineRead(timeAboveAerobicHrFraction(...))` functions compute for that ride's real
HR-zone data, called the live endpoint, then restored the original file. The LLM's actual reply opened
with *"You nailed the aerobic discipline yesterday—that's your strength"* — the terrain-confound bug
is gone on this surface too.

---

## Weekly energy-balance surfacing — §6 part (a) / closes #1's last slot (2026-07-08, shipped 2026-07-11)

Computes the precise weekly intake-vs-need ratio (logged kcal vs. the app's own deterministic daily
targets + ride kJ out) and surfaces it on Trends and in `CoachSnapshot.fuel` — closing `#1`'s last
reserved slot. Plan: `docs/superpowers/plans/2026-07-08-energy-balance-surfacing.md`.

- **Day-matched need formula** — `weeklyEnergy` (`lib/trends.ts`) sums "need" using the app's own
  daily-target formula (`baseCalories + ride kJ + buffer` on ride days, `restDayTarget` otherwise)
  **only over days with logged intake**, so under-logging withholds the ratio instead of faking a
  deficit. `balanceLevel` (`lib/nutrition.ts`) bands the ratio low/adequate/ample (<0.9 / 0.9–1.05 /
  >1.05), reusing the existing `EaLevel` vocabulary rather than inventing a new one.
- **Withholding rules** — a week's ratio only computes with ≥4 logged-intake days
  (`MIN_LOGGED_DAYS_FOR_BALANCE`); `latestWeeklyBalance` fills the CoachSnapshot slot with the
  immediately-prior complete week **only** — a missing or under-logged prior week withholds (`null`)
  rather than substituting an older, stale week.
- **`fuelingState` precedence** — one verdict, never two disagreeing ones (UX-CONSTITUTION §4
  discipline): the precise weekly ratio owns `fuelingState` when present; the daily EA proxy
  (`eaLevel`) remains the fallback band when the weekly ratio is absent (thin data). Documented on
  `CoachSignals.weeklyBalance` and the `fuel` build site in `lib/coach-snapshot.ts`.
- **Two surfaces, deliberately different pickers** — the Trends readout (`components/Trends.tsx`,
  under the fueling & weight chart) shows the **latest available** ratio week (a trends surface:
  show whatever data exists); the CoachSnapshot prompt line shows specifically the week that **just
  closed** (a coaching-context slot: a stale week is worse than silence). Both read off the same
  `weeklyEnergy`/`balanceLevel` computation — never two separate formulas.

**Live verification (2026-07-11):** a real `/api/ask` POST ("How was my fueling last week?") against
the running app returned: *"Your fueling last week was **adequate but slightly short** — you
consumed 95% of your estimated need (21,851 vs 23,001 kcal), which is acceptable for a training
block but leaves minimal margin. Your weight held steady and energy availability sits at a healthy
~33 kcal/kg, so no immediate concern..."* The cited 21,851 / 23,001 / 95% figures were independently
confirmed to exactly match the real `/trends` page numbers for the same week — the LLM phrased the
pre-computed numbers verbatim; it did not invent them.

**Final-review fix:** `formatCoachSnapshot`'s fuel line unconditionally labeled `fuelingState` "energy
availability" and attached the EA kcal/kg figure — wrong once the weekly ratio owns the verdict (a
disagreement case reads self-contradictory, e.g. "energy availability low (~30 kcal/kg)" when the
app's own EA banding calls 30 kcal/kg adequate). Label now tracks the actual source: "fueling X" with
no EA figure when the weekly ratio owns it, unchanged "energy availability X (~Y kcal/kg)" otherwise.
A milder sibling (`formatFormFuelLine`, used by `/api/generate`) had the same label-only mismatch —
fixed same day, see "`formatFormFuelLine` mislabel bug closed" at the top of this file.

---

## Today Athlete-State de-noising — ACWR demoted + Pw:HR three-layer caution (2026-07-10, shipped 2026-07-11)

De-noised the two noisiest signals feeding the Today "Athlete State" verdict — one scientifically
weak, one genuinely flaky — so neither could manufacture a false-fatigue read on its own. Plan:
`docs/superpowers/plans/2026-07-10-02-today-daily-read-signals.md`. Depended on the execution-scoring
rework below landing first (the execution EWMA driving this fusion needed to be HR-honest before
tuning the fusion around it).

- **ACWR demoted, not removed.** `DEFAULT_ATHLETE_STATE_WEIGHTS.acwr` shrank from a dominant hammer
  (`optimal +4 / danger −20`) to a minor nudge (`optimal +2 / danger −8`) — TSB and the separate
  load-ramp readiness check already carry the "you ramped load fast" story, and ACWR is redundant
  with them and unreliable for endurance readiness specifically (Impellizzeri et al.). New defaults
  sit inside the pre-existing `ATHLETE_STATE_WEIGHT_BOUNDS`, so no bound change was needed and a
  coach can still re-weight it back up per-athlete.
- **Aerobic efficiency (Pw:HR-Z2) gets three independent caution layers**, since it's confounded by
  heat/hydration/caffeine/sleep and was previously read from a single latest ride:
  1. **Smoothing** — `athleteStateInputsFrom` now means the last ≤3 qualifying rides inside the
     14-day recency window, not just the latest one.
  2. **Minimum-sample floor** (`AEROBIC_MIN_RECENT_SAMPLES = 2`) — a lone qualifying ride in the
     window sits the signal out entirely (`null`) rather than reporting itself disguised as
     "smoothed."
  3. **A stricter, separate `livedAt` threshold** (new `AthleteStateWeights.aerobicEff.livedAt`
     leaf, default 6) — `deadband` (widened 2→3) still gates whether the signal has *any* score
     effect; `livedAt` is the larger, independent bar a dip must clear to count as a corroborating
     "lived negative" toward the hard fatigue-override score-cap. A modest dip still nudges the
     score a little; only a confidently large one can help cap it. `SignalContribution` gained one
     optional `livedNegative` field, set only by `evalAerobicEff`.
- **HRV explicitly deferred, not built** — the athlete has no wearable that syncs HRV consistently
  yet, so wiring an evaluator now would be dead code. The exact add-back (a new weight leaf, an
  `AthleteStateInputs.hrvSuppressionPct` field, an `evalHrv` mirroring `evalAerobicEff`) is documented
  as a pointer in the plan, not scaffolded.

**Live verification (2026-07-11):** reloaded `/today` before/after on real synced data and diffed the
"what moved it" breakdown. ACWR's contribution: `+4` → `+2` (matches the demoted default exactly).
Aerobic efficiency: `"2% above baseline +3"` → `"near baseline 0"` — the smoothing + widened deadband
correctly absorbed what had been a single noisy ride's signal. Overall score `59` → `54` (both
previously-generous signals correctly tempered, not just moved in one direction). Supporting Signals
panel shows ACWR as a small, non-dominant tile (`0.87 optimal`), not the dominant driver it was before.

**Final-review fix (docs only):** the spec doc (`docs/specs/athlete-state.md`) and one interface
comment still described `aerobicEffLatest` as "latest ride's Pw:HR" — updated to describe the
smoothing + minimum-sample-floor behavior actually shipped.

---

## HR-judged easy-ride discipline — execution scoring rework (2026-07-10, shipped 2026-07-11)

Outdoors you cannot hold Zone-2 *power* — descents, rollers, restarts, and corners spike watts even
on a genuinely easy ride — so the old power-based discipline penalty (`aboveZ2Frac`, see the
superseded entry below) and the pacing (VI) penalty were marking down physiologically-perfect
aerobic rides and only ever rewarding indoor ERG. This rework makes the heart, not the power meter,
the judge of "was this ride actually easy?" Plan:
`docs/superpowers/plans/2026-07-10-01-execution-scoring-hr-leniency.md`.

- **The measure.** `timeAboveAerobicHrFraction(hrZoneTimes)` (`lib/execution-score.ts`) — the
  terrain-immune counterpart to the old power-based helper — returns the share of measured HR-zone
  time spent above the aerobic ceiling (HR zones 3+), from already-synced `hrZoneTimes`. `null` when
  there's no usable HR data, so scoring falls back to duration + bonuses only (an older ride or one
  with no HR monitor scores exactly as before).
- **The read.** `aerobicDisciplineRead` bands the fraction into a lenient three-state read:
  dialed in (≤10% above aerobic — tolerates terrain-driven HR bumps) / some drift (≤25%) / ran hot
  (>25% — genuinely not an easy ride). Research-grounded: Friel's LTHR Zone-2 ceiling ≈89% LTHR, the
  80/20 polarized-training principle backs "a single easy ride should be ~100% aerobic."
- **Power and VI became reward-only for Z2/Recovery.** An in-band IF or a steady VI (≤1.06) still
  earns a bonus, but neither is ever penalized anymore for these ride types — outdoor NP/VI inflate
  on terrain, which isn't a discipline failure. The HR read is now the *sole* penalty axis: dialed
  +1 / drift 0 / ran hot **−4** (deepened from the plan's original −2 mid-implementation — see below).
- **The −4 guardrail deviation.** The plan's own guardrail test (a hot-reading ride should score
  ≤5, the overtraining safeguard) contradicted its own other numbers: with duration (+2) and
  in-band-IF (+1) now unconditional bonuses, a −2 hot penalty could only ever net a hot ride to 6,
  never below baseline. Escalated and resolved by deepening the penalty to −4 — sized so the
  guardrail holds under *every* bonus-stacking combination (duration +2, IF-band +1, VI +1, or the
  RPE-substitution path that reaches the same +4 max without the IF-band bonus), not just the one
  case the plan happened to test. Verified by hand for every combination; holds with exactly zero
  margin, pinned by two boundary tests added in final review.
- **Debrief UI.** `TodayAnalysis.aerobicDiscipline` (✓ dialed in / ~ some drift / ✗ ran hot) surfaces
  in the Today debrief drill-down — gated identically to the scorer (`!intrinsic`, `!embedsEfforts`,
  Z2/Recovery only), so the UI never shows a read the score didn't actually apply. Two gaps caught
  and fixed during review: an off-plan ride whose inferred type happened to be Z2/Recovery was
  showing a read the score's own `!intrinsic` gate never used; a durability template B–E day (where
  embedded efforts are the point, not a lapse) had the same problem for `!embedsEfforts`.
- **Honesty fix.** The athlete-model insight for "execution trending down" was reworded from a
  fatigue diagnosis to a hypothesis — plausible causes now include accumulated fatigue, a harder
  training block, *or* more outdoor riding (since this rework changes what a downtrend can mean).

**Live verification (2026-07-11):** ran the real shipped scoring function against real synced ride
data (not a mock). A well-ridden outdoor Z2 from 2026-07-01 (100% duration compliance, in-band IF,
HR only 2.2% above aerobic) went from an old ledger score of **6** to a new score of **9** — meeting
the plan's own acceptance bar ("a well-ridden outdoor Z2 now reads ≥7, not the old ~5/6"). The
historical ledger (`data/score-log.json`) was deliberately **not** rebuilt with the new methodology
as part of this work (that's a separate, one-time-migration-gated operation, too consequential to
trigger for a smoke check) — past scores stay frozen until a real sync or an explicit rebuild.

**Known gap surfaced by this work, closed 2026-07-11:** `CoachSnapshot.today.execution.aboveZ2Pct`
(the LLM-facing coach-prompt line, `lib/coach-snapshot.ts`) computed its own "% above Z2 cap" from the
old power-based `timeAboveZ2Fraction`, entirely independent of this rework — the coach's own prompt
could still call an outdoor ride "drifted hard above zone" on the same ride the HR-based score just
correctly rewarded. Fixed same-day — see "Coach-prompt aerobic-discipline gap closed" further up this
file.

---

## In-app rescheduling + bidirectional calendar mirror — §7 lean slice (2026-07-08, shipped 2026-07-10)

Lets the athlete move a planned session in-app and keeps the Intervals.icu calendar in step in
both directions, closing the "app serves the wrong workout on the wrong day" risk (the athlete's
head unit reads from the calendar, not the app). Plan:
`docs/superpowers/plans/2026-07-08-reschedule-calendar-mirror.md`.

- **Manual move** — a click-to-pin popover on any future Plan day cell (`components/MoveDay.tsx`)
  lets the athlete shift a planned session onto a clear rest day; `PUT /api/reschedule` validates
  server-side (future-only, rest-target-only, past days immutable).
- **Outbound mirror** — every app-initiated move — this manual move, the existing reactive make-up
  POST, and the morning-check proactive swap/downgrade (`app/api/morning-check/route.ts`) — now
  mirrors onto the athlete's real Intervals.icu calendar. `lib/calendar-mirror.ts`
  (`dayToEventPayload`, `buildMovePayloads`, `applyCalendarMirror`, `persistMirroredMove`) owns the
  decisions; `createEvent` does the write. The mirror was originally built on the pre-existing
  uid-upsert path (`?upsertOnUid=true` + a client-supplied `uid`) — since corrected to a real
  `external_id`-keyed upsert, a separate foundational bug fix documented in the next entry below. A
  moved day carries its **source event's description wholesale** to the destination — descriptions
  live only on the calendar (`CurrentBlockDay` has no description field), so a delete+recreate would
  silently drop the intent/nutrition text the athlete actually reads.
- **Inbound reconcile** — `POST /api/sync` (`app/api/sync/route.ts`) now fetches the block window's
  events once (`lib/intervals-api.ts` gained `fetchEvents`/`parseCalendarEvents`) and reconciles
  calendar-side moves (the athlete dragging a NodeVelo event on Intervals.icu itself) into the local
  block before scoring, via `reconcileInboundMoves`. Deliberately limited: future-only both sides;
  applies only onto rest/empty days; a calendar-side **swap** (two events trading dates) surfaces as
  two separate conflict warnings rather than being auto-paired (deferred, not a bug); a vanished
  future event warns rather than silently deleting the local prescription. Nothing ambiguous ever
  mutates silently.
- **Design invariant** — one NodeVelo-owned calendar event per block date; past dates are never
  mutated by either direction; a local move always persists even if the calendar mirror call fails
  (failure surfaces as a warning, never a rollback).
- **Known limitation (cosmetic, documented in code)** — an inbound-accepted move leaves the
  calendar event's `external_id` stamped with its OLD date; `CurrentBlockDay.eventId` (the numeric
  id) is the true key everywhere the app matches events, so this doesn't affect correctness, only
  the calendar's own bookkeeping field.
- **Fixed same slice:** a pre-existing UTC-vs-local-date bug in `/api/reschedule` — both GET and
  POST previously inlined `new Date().toISOString().slice(0,10)` (AGENTS.md's recurring bug class);
  now uses `resolveToday`/`localToday` like the rest of the app.

**Live verification (2026-07-10):** the current block had zero rest days left (ends 2026-07-12,
taper week), so a full "move a real session onto a real rest day" round trip wasn't possible this
session — flagged as a follow-up for the next block that has rest days. What *was* verified live:
(a) the calendar API round-trip itself — create → read-back with description intact → delete,
against the real Intervals.icu API; (b) the manual-move UI's full interaction chain end-to-end
through a real rejected move — clicking a future day cell pins an accessible popover
(`role="dialog"`), the date input is bounded correctly (tomorrow through block end), submitting
calls the real `PUT /api/reschedule`, the server correctly rejected an occupied-target attempt with
a clear message, and the UI surfaced that error via `role="alert"` without losing state or
persisting anything (the block was confirmed unchanged after).

---

## Fix: createEvent's upsert was broken (external_id, not uid) — discovered during §7 live verification (2026-07-10)

`createEvent` (`lib/intervals-api.ts`) POSTed to the singular `/athlete/{id}/events` endpoint with
`?upsertOnUid=true` and a client-supplied `uid`, intending an idempotent per-date upsert. It never
worked: Intervals.icu ignores a client-supplied `uid` (server-assigned, read-only) and silently
created a **new duplicate event on every call** instead of updating the existing one — confirmed
live by calling it twice with the same `uid` and getting two different event ids back. This
predates the §7 calendar-mirror plan entirely (traces to the app's first commit); every historical
block write, regeneration, or reschedule that touched an already-written date has likely been
leaving orphaned duplicate events on the athlete's real calendar since day one. It surfaced only now
because §7's live-verification step (above) was the first time a round-trip against the real
calendar API was actually watched closely.

**Fix** (commit `aa16797`, cosmetic-comment follow-up `ec9e591`): `createEvent` now calls
`POST /athlete/{id}/events/bulk?upsert=true` with the event wrapped in a single-element array,
using `external_id` (not `uid`) as the client idempotency key — confirmed against Intervals.icu's
own published integration cookbook. `IntervalsEventPayload.uid` was renamed to `external_id`
(snake_case, since this interface is serialized verbatim as the wire body); `IntervalsCalendarEvent`
kept its existing `uid` field (now documented as read-only/server-assigned) and gained a new
`externalId` field (what inbound matching actually uses). All call sites (`lib/calendar-mirror.ts`,
`lib/plan-parser.ts`) and test fixtures updated to match. Live-reconfirmed end-to-end through the
actual fixed application code: the same `external_id` sent twice now returns the identical numeric
id, content genuinely replaces, and the event count on the calendar stays at one.

Not part of the §7 plan's original scope — a foundational primitive fix that plan's
live-verification step happened to uncover, documented separately rather than folded silently into
the calendar-mirror feature entry above.

---

## Two-way session swap — §7 follow-on (2026-07-11)

Closes the gap the original §7 lean slice deliberately left open: Manual Move only moves a session
onto a *clear rest day*; this adds a genuine swap between two already-occupied future sessions (e.g.
today's ride with tomorrow's), reusing the swap-pair calendar-mirror path the morning-check proactive
swap already exercised and this session's final-review fixes already hardened (id-based
description-carry). `PATCH /api/reschedule` validates both days are in-block, future, distinct, and
both carry a real session; `components/SwapDay.tsx` mounts alongside the existing `MoveDay` in the
same pinned day-cell popover. Outbound only — calendar-side (inbound) swap-pairing stays deferred, per
`lib/calendar-mirror.ts`'s existing `reconcileInboundMoves` comment. Design:
`docs/superpowers/specs/2026-07-11-session-swap-design.md`. Plan:
`docs/superpowers/plans/2026-07-11-session-swap.md`.

---

## UX v2 — the zero-based redesign, Waves 1–5 (2026-07-08 → 2026-07-09)

A moment-first zero-based review of all seven surfaces (live-app walkthrough with real data, desktop
1440×900) that re-justified every card, metric, and nav slot from scratch — no page or component was
assumed to keep its place. Governed by [UX-CONSTITUTION.md](UX-CONSTITUTION.md); sequenced into 5
waves per [UX-MASTERPLAN.md](UX-MASTERPLAN.md) (the framework — moment map, moves ledger, per-page
target layouts — full detail lives there). Each wave closed with a whole-wave review (Fable 5, Opus
4.8 fallback); the final wave's review walked the entire UX-MASTERPLAN §8 success-measures list as a
program-closing gate. Distinct from, and shipped after, the v1 defect-audit UX program below —
v2 started from a blank page rather than fixing findings against the existing layout.

- **Wave 1 — nav tiering + relocations** (2026-07-08, commits `4fe638c`…`a8c29e9`; plan
  `docs/superpowers/plans/2026-07-08-ux-v2-wave-1-nav-and-relocations.md`). The flat 7-tab rail
  became a 3-tier rail (Today/Plan/Trends full-weight · Profile/Model under "YOU & THE COACH" ·
  Settings/Knowledge under "SYSTEM"). Every pure cross-page relocation from the moves ledger executed
  as a straight component move, no redesign yet: goals off Plan → Profile, effort bands Model →
  Profile, season Profile → Plan, delete-block → overflow menu. "Knowledge Base"/"Docs" unified to
  one name, "Knowledge," everywhere. Final review found one fix: season save now refreshes the
  roadmap + generator context co-located on `/plan`.
- **Wave 2 — Today auto-switch** (2026-07-08; plan
  `docs/superpowers/plans/2026-07-08-ux-v2-wave-2-today-auto-switch.md`). Today's mode is now
  data-derived, never a tab the athlete picks: a synced ride matching today's *local* date
  (`localToday()`, per AGENTS.md) puts the page in post-ride mode, otherwise pre-ride. Pre-ride is
  capped at ≤3 elements by construction (alert → verdict → session prescription); post-ride leads
  with the debrief. Cut entirely: `TrendPulse` (duplicated Trends' own question) and the
  viewport-lock + internal-scroll edge-fade machinery (pre-ride now fits without it; post-ride
  scrolls like every other page). Constitution §3/§4 amended same-commit (moment-aware layout
  clause; one-canonical-home-per-metric rule).
- **Wave 3 — Trends rebuild** (2026-07-09; plan
  `docs/superpowers/plans/2026-07-09-ux-v2-wave-3-trends-rebuild.md`). Nine equal-weight sections
  replaced by a verdict-first structure: a new pure `lib/trends-verdict.ts` derives a three-axis
  verdict (engine / delivery / fueling) client-side over the existing payload, rendered as one
  sentence in fold-1 with the ranked coach insights promoted alongside it (top 3 visible, rest
  disclosed). Below it, four named groups (ENGINE, DELIVERY, LOAD & FUEL, MILESTONES) replace the
  nine sections; the Delivery merge folds session-level execution bars and per-type
  planned-vs-actual into one card behind a toggle. Cut: the "Last 7 days" tile row, the
  not-a-duplicate-of-intervals.icu mission-statement intro.
- **Wave 4 — Model three-groups + Profile dossier** (2026-07-09; plan
  `docs/superpowers/plans/2026-07-09-ux-v2-wave-4-profile-model.md`). Model reorganized into NOW
  (fused score + ranked drivers as signed magnitude bars, largest first) / LEARNED (one calibration
  card per learned value — number, provenance, confidence tier, override) / STANDING GUIDANCE
  (directives rendered straight from their structured source, sharing the demote rule with the
  generator — `CoachDirectivesCard` retired). Profile became a read-first dossier: rider read
  (power curve, phenotype, current performance, weight, PR strip) → zones/effort bands → goals &
  weakpoints (compact read, edit behind inline "▸ edit") → nutrition formula, each editable on
  demand rather than a long scroll of always-open forms.
- **Wave 5 — Plan hero + Settings/Knowledge + density polish** (2026-07-09, commits
  `fe81520`…`56a9f1f`; plan
  `docs/superpowers/plans/2026-07-09-ux-v2-wave-5-plan-settings-knowledge-polish.md`). Plan's hero
  gained week orientation: "Active block — week N of M · `<week character>`" plus an in-hero week
  strip (hours vs. target · load · top session) — `<week character>` is explicitly disclosed as
  volume-derived, not a per-week periodization phase (the data model has none); `WeeklyDebrief`
  retired as the strip absorbs it. Settings split into GENERATION (volume targets, weekly structure,
  philosophy & equipment) and PLATFORM (platform behavior, AI usage & cost, backup & restore) —
  fixing a real bug where the platform-behavior card rendered under the wrong divider. Knowledge
  gained a one-line provenance header (which files feed generation vs. reference-only). Density
  polish cleared the whole Waves 3–4 backlog in the same wave: driver bars negative→red (matching
  `driverEffectClass`, DESIGN §2), touch-readable driver notes, calibration confidence adjacency,
  `DeliveryCard` toggle accessibility (`type=button` + `role=group`), `InsightsFold` empty-state
  hint honesty, Profile rider-read empty-state + weight-tile gating + double-label removal.

**Two small open items surfaced by the Wave 5 closing review, not actioned (out of that wave's
scope, tracked in [ROADMAP.md](ROADMAP.md) Phase 7):** `components/trends/verdict.tsx`'s
`VerdictStrip` still colors its "down" axis chip amber where every other declining signal in the app
uses red (the same fix already applied to `StateDriversCard`'s bars); `lib/trends-verdict.ts`'s
score-to-word mapping can label the verdict "Mixed" even when no two axes actually disagree (a
labeling nit in the score→word bucket, not a logic bug).

---

## Pre-ride loading loop — Track C (2026-07-08)

Deterministic day-before carb-loading prescription (7 g/kg, all templates A–E), one-tap loaded/skipped
attribution stored in `data/loading-log.json`, and `preLoad`/`durabilityDelivery` ledger stamps (provenance
only). A heuristic delivered-rate assessment via `assessLoadingEffect` learns whether loading improves
late-effort delivery and gates the prompt with a `no-effect` kill-switch that stops prescribing once
proven ineffective. Power-only outcome (decoupling deliberately excluded per the `deriveCarbsOptimum`
demotion rationale in `lib/calibration.ts`). Today chip surfaces the day-before target on durability
longs; `/api/loading` GET queries whether to show the prompt, POST attributes the athlete's loaded/skipped
choice. `lib/loading.ts`, `data/loading-log.json`.

**Known limits (deliberately kept, tracked):** late-synced durability rides get no delivery stamp (the
birth-fetch exclusion stands — extend if the corpus starves); template A rides are prescribed like B–E
but permanently excluded from the learner (no embedded efforts, so no honest delivery outcome to grade)
— separately, even among B–E the assessment stays `unproven` until ≥3 loaded AND ≥3 unloaded observations
exist; binary loaded/skipped attribution pending actual grams logged; `/model` verdict surfacing deferred;
a retro-ask response now back-stamps an already-born ledger entry at POST time (first answer wins). Plan:
`docs/superpowers/plans/2026-07-08-preride-loading-loop.md`.

---

## UX program v1 — full-product audit through implementation, Waves 1–4 (2026-07-03 → 2026-07-05)

A ground-up UX audit of all seven surfaces (Today, Plan, Trends, Profile, Model, Settings, Knowledge)
against timeless HCI/trust principles and red-team personas (first-time athlete, injured athlete,
ADHD, sleep-deprived, outdoors in sunlight, returning after months away) — then every finding
implemented, desktop-first per standing instruction. Full detail (every finding, file:line evidence,
what shipped vs. what was deliberately deferred) lives in [UX-MASTERPLAN.md](UX-MASTERPLAN.md),
governed by [UX-CONSTITUTION.md](UX-CONSTITUTION.md) (the decision rules — verdict hierarchy,
trust/provenance/contestability, disclosure limits, an explicit ban list). Summary by wave:

- **Wave 1 — system primitives.** The entire explanation layer (`MetricTip`/`InfoDot`) was
  hover-only — invisible to keyboard and screen readers, the single largest gap between the app's
  stated trust philosophy and its actual behaviour. Now opens on focus too. Best-effort fetches that
  used to fail silently (a `catch {}` making a broken feature indistinguishable from an absent one)
  now render a `LoadFailed` retry state. The canonical dark theme flashed light on every page load —
  fixed with a pre-hydration `<head>` script.
- **Wave 2 — Today's one verdict.** "Can I go hard?" was answered four times in three vocabularies
  (a fused 0–100 score, a separate Build/Hold/Recover badge, a narrative coach-read card, raw
  TSB/ACWR tiles) with no stated precedence. `AthleteStateCard` is now the sole fold-1 verdict;
  everything else became its supporting evidence, collapsed but not deleted.
  `components/CoachSnapshotCard.tsx` was deleted (content absorbed).
- **Wave 3 — page-level fixes.** Empty states became onboarding (links instead of dead ends); the
  block calendar's day-cell detail (previously 100% hover-locked) is now keyboard-focusable; every
  `window.confirm()` in the app — including the highest-stakes one, full-data restore — became an
  in-product confirmation that states the actual consequence.
- **Wave 4 — polish + a real coaching gap.** An "injured athlete" path that didn't exist before: the
  morning check-in previously didn't even *render* on a non-quality day, so an injured athlete facing
  an easy ride had zero way to report it. Injury now gets its own `rest` decision (not a reused
  downgrade — the reasoning is metabolic-vs-musculoskeletal, written into `lib/morning-check.ts`).
  Plus loading skeletons (five sites, sized to each page's real layout) and a scroll-position-aware
  fade so an internally-scrolling card never reads as a dead end.

**Deliberately not done:** S2-4 (swapping Model/Knowledge's mobile nav prominence) — evaluated and
skipped, since desktop's nav rail already shows both correctly labelled; there's no desktop-relevant
work to do until mobile polish resumes. S3-5 (a "what changed while you were away" re-entry summary)
stays a roadmap-tier idea, not attempted this pass.

Two implementation waves (2 and 4) were dispatched to subagents (Fable 5 for the mechanical passes,
Opus for S2-9's coaching-safety judgment call) and independently re-verified — code read line-by-line,
tsc/lint/test re-run, browser-checked — before commit, since the safety classifier that normally
reviews subagent work was unavailable both times.

---

## Post-ride fuel prompt — Track C accumulation flywheel (2026-07-04)

`carbsOptimum` (ARCHIVE "Carbs-optimum derivation — Track C first leg") sat dormant for lack of data —
only ~20% of ledger entries (23/117) carried a logged carb intake. Rather than add more derivation
machinery to a starved signal, this ships the nudge that fills the gap: a deterministic post-ride prompt
that gets `carbs_ingested` logged on the exact rides that teach the model.

Shipped: `deriveFuelPrompt()` (`lib/fuel-prompt.ts`) — a pure, unit-tested decision, no LLM/IO/side
effects, with two variants. `log-nudge` fires when a qualifying ride (`movingTimeSec ≥ 90 min` OR
`plannedType ∈ {Threshold, VO2max, SIT, RaceSim}`) has no logged `carbsIngestedG`; a logged `0` is kept
as a real "fasted" data point (the FUEL-1 distinction) and never nudges. `gap` fires only when logged
carbs resolve to `< optimum − 20 g/h` (`GAP_UNDER_G_PER_H`) *and* the resolved `carbsOptimum` confidence
is medium or high (`EXCLUDED_CONFIDENCE_FOR_GAP = "low"` gates it off) — under-fueling only in v1, since
over-fueling has no validated harm signal yet. Wired into the sync route's today-analysis path
(`app/api/sync/route.ts`, computed once per sync against today's ride only) via a new
`resolveCarbsOptimumForPrompt` helper that mirrors the generic calibration resolver's precedence (manual
override, else a trustworthy derived value) but — unlike that generic resolver — always falls back to
`null` rather than a population default, so a "gap" claim can never be built on a number that isn't
actually personalized. Persisted as `TodayAnalysis.fuelPrompt` (sparse-field convention: absent/null omits
the key entirely, so a pre-existing `today-analysis.json` written before this field existed renders
cleanly). Surfaced as a quiet chip on the Today card (`components/dashboard/today.tsx`, truthy-checked
per this project's migration-flag convention, neutral zinc/cyan tone — informational, not a celebration)
and threaded to the coach note as one context line (`RideAnalysisInput.fuelPromptContext` →
`buildRideAnalysisPrompt` in `lib/anthropic-prompts.ts`, formatted by `lib/sync-analysis.ts`'s
`formatFuelPromptContext`) with an instruction that the LLM may mention it in one sentence using the
pre-computed numbers verbatim — it never invents or recomputes a gram.

Closes the ROADMAP Track C "Contextual post-ride prompts" item (removed from ROADMAP.md; the Track C
"Pre-ride loading loop" item is separate and stays open). Plan:
`docs/superpowers/plans/2026-07-03-postride-fuel-prompt.md`. Success metric to watch over the next ~3
weeks: fuel-stamp fill-rate on qualifying rides (baseline ~20%, target ≥60%) and `carbsOptimum.dataPoints`
(1 → ≥8) — if fill-rate doesn't move, the nudge's placement failed and surfacing needs revisiting before
any more Track C machinery is added.

**Open item, not yet verified live:** this touches an LLM-backed path — the coach note may now mention
the fuel prompt. Per this project's `AGENTS.md` convention, a live smoke run against the real Anthropic
API (one real sync on a qualifying ride day, reading the actual generated coach note + Today card) is
still outstanding. Only unit-tested so far; the real model call has not been exercised.

---

## First-loop-turnover readiness — build half (SUB-5) (2026-07-03)

Everything buildable before the first-ever full loop turnover (retrospective → `block-history.json`
born → next block write → `intervention-log.json` born, ~2026-07-12) shipped ahead of the event:
route tests characterizing `/api/retrospective` (the destructive current-block-clearing path,
previously the only turnover-critical route untested — `b62a3aa`, `a233321`), the season-stamp fix
(`seasonFocus`/`seasonPhase` land on the new block at write time — `app/api/write/route.ts`), and an
attended runbook in [WORKFLOW.md](WORKFLOW.md) (backup → sync → retro → verify → generate → write →
verify, with an import-restore abort path). What remains is *executing* the runbook at block end —
an event, not build work — tracked as SUB-5 in [ROADMAP.md](ROADMAP.md).
Plan: `docs/superpowers/plans/2026-07-03-first-loop-turnover-readiness.md`.

---

## Ledger interval-adherence at birth (2026-07-03)

The root-cause fix for the gap the SIT execution-score fix (below) surfaced: the immutable ledger's
batch builder (`score-log.ts`) never computed or received interval-target adherence for *any* ride, so
every Threshold/VO2max/SIT/RaceSim day was permanently scored off whole-ride duration/IF the moment it
rolled past "today" — a coarser proxy than the reps actually ridden, and irreversible once frozen. That
gap is why the SIT 2/10 entry needed a manual one-off correction: even after the scoring formula was
fixed, the frozen entry had no adherence input to honestly re-derive from.

Shipped: `RideScoreEntry.intervals?: { adherencePct, structuralMismatch, completed, total }`
(`lib/types.ts`) — the same prescription-vs-executed comparison the "today" path already computed, now
frozen onto the ledger entry via a shared mapper, `intervalStampFrom()` (`lib/score-log.ts`). It feeds
`computeExecutionScore` as the primary signal on planned interval days (an
`adherencePct`/`structuralMismatch` pair, not a pass-through raw comparison). `buildRideScores` gained an
`adherenceForDate` lookup param to source it. On `POST /api/sync`, a bounded **birth-time fetch** picks
up rides that synced a day or more late: it finds planned interval days not yet in the ledger, fetches
each ride's executed intervals (capped at 6 dates per sync, newest first — logged + surfaced as a sync
warning past the cap), and stamps the comparison so the entry is born interval-aware instead of frozen
coarse forever. A fetch failure per date falls back silently to the coarse whole-ride score rather than
failing the sync. The same stamp lookup also serves the existing one-shot ledger rebuild path, letting a
corrected scoring formula re-score already-frozen entries from their stamped adherence data with no
re-fetch.

**Deliberate exclusion, not an oversight:** Z2/Recovery days and any day carrying a Track B durability
template are never looked up on this axis — they're graded by their own systems
(`gradeDurabilityDelivery` for durability; steady duration-compliance for Z2/Recovery) and this stamp
would be meaningless for them. Closes the former ROADMAP item "Ledger scoring lacks interval-level
adherence for non-durability interval types."
Plan: `docs/superpowers/plans/2026-07-03-ledger-interval-adherence.md`.

---

## SIT execution-score fix — sprint overshoot + unreachable IF band (2026-07-03)

A flawless 6/6, full-duration sprint day (131% of a 432W target) scored 2/10 "Poor". Two compounding
bugs in `computeExecutionScore`, both SIT-specific: (1) the generic `adherencePct` overshoot band
penalised clearing a sprint target hard the same as a bad Threshold/VO2max overshoot ("blew past it,
won't recover well") — the wrong lens for a 30s max effort, which has no sustainability risk within the
rep (the 4-minute recovery windows exist precisely so each rep can be maximal); (2) the whole-ride
NP/FTP band for SIT required IF ≥ 0.90, structurally unreachable given the workout's own shape (long
warmup/recovery diluting a few 30s efforts), silently capping every well-executed SIT day at −1
regardless of quality. Fix: SIT's adherence axis now only penalises undershoot (not clearing the bar);
the unreachable whole-ride-IF case was dropped, since `adherencePct` already grades sprint quality
directly and correctly. +3 tests (`lib/execution-score.test.ts`) lock the regression. The 2026-07-03
ledger entry (frozen at the buggy 2) needed a one-off manual correction — re-derived via the actual fixed
functions with the ride's real stored inputs, not hand math — because a normal sync never touches an
already-scored ledger date (`mergeScoreLog`: existing wins, immutable per date); this surfaced the
broader **ledger scoring lacks interval-level adherence for non-durability interval types** gap,
closed by the entry above.

Also fixed same session, unrelated: prescription **display** labels could show a stale duration
(`"6×1m"` for a `durationSec: 30` session) on blocks generated before an earlier label-rounding fix —
`formatPrescriptionLabel` now derives the label from structural fields at the point of use (Today card +
the ask-coach interval context) instead of trusting the stored `label` string, so a stale stored value
can never surface again.

---

## SUB-2 · Legacy backfill importer — investigated & paused (2026-07-02)

Investigation record (decision + stub live in [ROADMAP.md](ROADMAP.md) stable handles). The prior
~6 months (100 legacy rides) followed real structure but have no app prescription to grade against,
so they're excluded from execution learning. A live-API check against Intervals.icu's actual
`/events` endpoint falsified the "whole window recoverable" assumption: of the 100 legacy dates only
**28 have a same-date calendar event at all** (22 with machine-parseable `workout_doc.steps`); 72
have none — Jan/Feb (29 rides) has zero calendar events in the window. Athlete's read: legacy
structure was Z2 + 2 interval sessions/week, and only interval days tended to get a named calendar
entry. So the calendar recovers roughly the hard-day subset (~22–28%), not the window — not enough
to justify an importer. The athlete handles any legacy relabeling manually (renaming calendar
events) if specific rides should become gradable. Grading a ride against its own executed profile
(no independent prescription) is circular and was not pursued.

---

## Carbs-optimum derivation — Track C first leg (2026-07-02)

The optimum shape joins the shared correlation engine, and carbs g/h becomes the framework's third
calibrated parameter. `deriveOptimum` (`lib/correlation.ts`) mirrors `deriveExecutionEdge` with the roles
flipped — the median signal of the athlete's *successes*, credited only when failures exist to contrast
against AND sit ≥ a margin away on the expected side (successes alone are habit, not signal — same
"don't calibrate to where they train" refusal as the edge). First consumer: `deriveCarbsOptimum`
(`lib/calibration.ts`) classifies steady long endurance rides (the sync route's existing steady-endurance
candidate pool, ≥90 min, `carbs_ingested` logged) good/bad by `aerobicEffPct` — `lib/aerobic.ts`'s
Z2-isolated Pw:HR %Δ vs the athlete's own trailing baseline, the same non-circular signal the off-plan
execution-score driver already uses — outside its established `AEROBIC_DEADBAND_PCT` noise floor, with a
10 g/h discrimination margin, a [30, 120] clamp, `DEFAULT_CARBS_OPTIMUM = 75` (the literal
`inRideCarbTarget` >90-min endurance value), and the same quiet-window/`manualOverride` preservation
semantics as `deriveDecouplingGood`. **Not decoupling** (the first cut, swapped same-night before review):
this app already demoted whole-ride decoupling out of the athlete-state driver (ACC) and out of execution
scoring (ACC-2026-06-25) for being a noisy ride-structure artifact confounded by heat/course effects
unrelated to fueling — reusing it as carbs' outcome label would have repeated that mistake, and it would
have made `carbsOptimum` depend on `decouplingGood`'s own confidence for no real reason (`aerobicEffPct`
is already baseline-relative, so no second calibrated parameter is needed as a reference point). Wired:
`CalibrationStore.carbsOptimum` (optional — pre-existing stores parse back `undefined`, the migration-flag
gotcha), derived each sync, `/api/calibration` generalised to a param→bounds map, and a second
contest/correct row on the `/model` panel (config-driven `ParamRow` refactor; verified live — the on-disk
store predating the field renders the default row correctly). **Deliberate non-goal:** the fueling table
(`inRideCarbTarget`) is untouched — surfacing a learned optimum into prescriptions is §6.
Dormant until fueling data accrues, by design. Plan:
`docs/superpowers/plans/2026-07-02-carbs-optimum-derivation.md`. +20 tests (742 total, 66 files).

---

## Off-machine backup (2026-07-02, SUB-4 half)

`lib/backup.ts`: `buildBackupBundle()` (the same data/ + knowledge-base/ bundle GET /api/export already
produced — extracted so both share one implementation instead of two) and `snapshotBackup()`, wired into
`/api/sync`'s POST as a best-effort last step. Writes a timestamped snapshot to `NODEVELO_BACKUP_DIR`
(write-then-rename, same atomicity idiom as `json-store.ts`) and rotates to the newest 14. Deliberately
env-gated with no same-machine default: unset, it's a no-op rather than a same-disk "backup" that
wouldn't buy anything the existing `.bak`/manual-export coverage doesn't already give — "off-machine"
only happens once the directory actually points at something that leaves the machine (a synced
Dropbox/iCloud/Drive folder, a mounted NAS), which is the athlete's infrastructure to choose, not this
app's. A misconfigured-after-the-fact destination (e.g. an unmounted sync folder) surfaces through the
existing sync `warnings[]` → `SyncNotice` path rather than failing the sync. `export/route.ts` now calls
the shared bundle builder instead of carrying its own copy of the collect/walk logic.

**Branch discipline (SUB-4's other half) — resolved 2026-06-22, superseded 2026-08-03.** The original
convention used one shared checkout, direct commits to `main`, exact-path staging, and manual avoidance
of another agent's WIP. It proved insufficient once Claude and Codex shared implementation work: local
`main` drifted and an exact `codex` branch blocked namespaced task branches. The replacement is the
[isolated Claude + Codex integration workflow](#developer-workflow--isolated-claude--codex-integration-2026-08-03):
disposable worktrees, protected integration-only `main`, CI, and PR auto-merge. This paragraph remains
as the historical decision record, not current operating guidance.

---

## Route tests for the destructive write routes (2026-07-02, extends SUB-3)

SUB-3 covered `sync` + `generate`; this closes the same gap on the routes that can overwrite a store
outright with zero prior coverage: `app/api/import` (restores `data/` + `knowledge-base/` from an
uploaded bundle — the highest-risk route in the app), `profile`, `season`, `calibration`, `knowledge`.
43 new tests, same pattern as `settings`/`sync` (data layer mocked at the module boundary, route handler
called directly against a constructed `Request`). Each suite targets the write path's actual risk, not
just line coverage: `import` gets dedicated path-traversal coverage (relative and absolute `rel` keys
must never reach `writeJsonFile`/`fs.writeFile` — `fs` mocked too, since `KB_DIR` has no env override to
redirect to a throwaway dir); `season` guards engine-drafted `periods` surviving an athlete-owned PUT;
`profile` guards a partial nutrition/goals/weakpoints update not clobbering the other two; `calibration`
guards the manual-override clamp (the same "disable-the-safety-cap" shape SET-1 caught for
`BlockSettings`). `export` stayed out of scope — GET-only, never mutates.

---

## Structured logging — P8 half (2026-07-02)

Silent-catch observability gap closed: `lib/log.ts` (`logError`/`logWarn`, JSON lines shaped
`{t, route, step, status, message}` to `console.error`/`warn` — ROADMAP P8's shape) + `lib/log.test.ts`.
Routed through the 17 substrate-facing call sites that used to swallow real failures across `write`,
`note`, `ask`, `disposition`, `retrospective`, `knowledge`, `generate`, `import`, `sync`. Deliberately
skipped: client-input-validation catches (`400 Invalid JSON body` — already visible to the caller) and
benign no-body-fallback branches (`morning-check`, `analyze`, `sync`'s optional `?today` parse) — neither
is a substrate failure. AI-route cost guard (P8's other half) remains open.

---

## Edge-case sweep EC-2026-06-27 — closeout (2026-07-02)

The EA/baseline edge-case + off-plan-aerobic/durability scoring read-audit, fully resolved.

- **EC-1** — aerobic Pw:HR baseline outdoor-filtered (VirtualRide excluded); **EC-2** — durability effort
  timing made stream-sample-index based (immune to smart-recording / paused time). (Shipped earlier in the sweep.)
- **EC-3** — `computeExecutionScore` now gates `durabilityDelivery` on `gradedByDurability`, so a lone
  delivery grade (template A / none) can't double-count on top of the interval-adherence axis in the
  immutable ledger. +1 test.
- **EC-4** — energy-availability anchors a no-weigh-in day to the nearest weigh-in ON/BEFORE it (not the
  most-recent overall, which could post-date the day) — the `physiologyAsOf` convention. +1 test.
- **EC-7** — the Today "Power execution" drill-down titles itself "Aerobic drift" when only decoupling is
  present (no zones/trace/intervals), instead of mislabeling drift as power execution.
- **EC-8** — retired the computed-but-unused `avgCadence90d` from the rolling-baselines compute / type /
  default / fixtures.
- **`sharpen` Focus option** added to the `/profile` goals form (the API + season engine already accepted it).
- Consciously **accepted, no fix:** EC-5 (EA trend sensitive to rest-day composition — kept a soft arrow;
  a per-athlete band is Track C) and EC-6 (new baseline fields hide until the first post-deploy sync —
  inherent to the derive-on-sync model).

---

## Directive demote — the validation loop acts (#4, demote half) (2026-07-02)

ROADMAP #4's second half: `synthesizeCoachingDirectives` (`lib/synthesis.ts`) now DEMOTES a coaching
directive whose past nudges have a proven-poor track record, instead of only annotating the hit-rate.
Completes the loop end-to-end (the measurement half — planned-vs-actual + FTP-retest — shipped the same day).

- **Demote rule:** a directive is demoted only when its dimension has BOTH ≥3 decisive
  (validated|refuted) matured verdicts AND a hit-rate ≤34% — one noisy 28-day window can't bury a
  directive. Demoted directives are reframed ("past X nudges have a poor track record here — try a
  different lever, don't just repeat it") and sunk below the still-trusted ones; the measured *evidence*
  stays visible (a real weak point is never hidden — calibrated-honesty pillar), only the failed
  *suggestion* is de-emphasised. The block header flags how many are de-prioritised.
- **Thresholds** exported as `DIRECTIVE_DEMOTE_DEFAULTS` (taken as a defaulted param) — population
  defaults now, a #2 per-athlete calibration hook later (same shape as `FTP_RETEST_DEFAULTS`).
- **Feeds both LLM surfaces** unchanged: the generation prompt's directive block and the CoachSnapshot
  directives (Today card + Ask-Coach). Backward-compatible — the new config is an optional 3rd arg, so
  the two existing call sites (`coach-snapshot.ts`, `generate/route.ts`) needed no change.
- **Dormant until data:** `intervention-log.json` is empty, so nothing demotes on the real corpus yet —
  the demote path is proven by 6 new unit tests; the live `/api/ask` smoke confirmed the non-demote path
  renders directives identically to before ("Execution trending down", "Z2 trending down") and the coach
  answers coherently. #4 is now code-complete but won't visibly act until real verdicts mature.

---

## FTP-retest advisory + planned-vs-actual (#4, measurement half) (2026-07-02)

ROADMAP #4's measurement half — the validation loop starts ACTING on execution data. Spec:
[design](docs/superpowers/specs/2026-07-02-ftp-retest-planned-vs-actual-design.md) · plan:
[plan](docs/superpowers/plans/2026-07-02-ftp-retest-planned-vs-actual.md).

- **`lib/plan-vs-actual.ts` created** (pure, unit-tested): `aggregatePlanVsActual` — per-type n /
  mean IF / target band / completion / execution over the trailing 90d of planned, non-legacy,
  non-compromised ledger entries — and `detectFtpRetest` — the overdelivery→stale-low advisory
  (≥4 FTP-anchored sessions in 42d, ≥75% individually above their frozen band top at ≥85% completion,
  mean overshoot ≥2% FTP, all scored against the *current* FTP so a re-test resets the window).
  Underdelivery deliberately excluded (fatigue-confounded). Thresholds exported as
  `FTP_RETEST_DEFAULTS` — a #2 per-athlete calibration hook.
- **`FTP_ANCHORED_IF_BANDS` exported from `lib/execution-score.ts`** (behaviour-preserving refactor):
  scorer, detector and the Trends target-band column share one source and can't drift.
- **CoachSnapshot gains `ftpRetest`** via `CoachSignals`/`resolveCoachSignals` → the `/api/ask` prompt
  ("FTP check: …" in `formatCoachSnapshot`), the Today card (amber advisory on `CoachSnapshotCard`),
  and `/api/generate`'s resolution (not rendered in the generation prompt by design — the planner must
  not compensate for unvalidated physiology).
- **`/api/trends`** now resolves the client's local `?today=` (AGENTS.md local-today class) and ships
  `planVsActual` + `ftpRetest`; new "Planned vs actual" card beside Weekly volume
  (`components/trends/sections.tsx`). Complements — doesn't replace — the age-based >90d stale-FTP
  warnings (Profile banner, Trends w/kg tile): execution flag = threshold moved; age flag = the
  fallback when no anchored quality work exists to measure.
- Advisory ONLY: nothing writes FTP or `physiology.json` (locked design decision). Live-smoked against
  the real corpus (flag correctly null — mean IF Threshold 0.79 vs band 0.82–0.92, VO2max 0.82 vs
  0.90–1.10, nothing over; table renders 4 type rows on Trends) + a live `/api/ask` run (coherent,
  grounded in FTP 288W, no invented flag).

---

## Route tests (`sync` + `generate`) — SUB-3 (2026-07-02)

Closed the 2026-06-30 audit's "test coverage lopsided" finding: the two highest-stakes, least-tested
routes now have wiring-level characterization coverage. Executed via subagent-driven development, 10
tasks, every task approved on first review pass. Plan:
[plan](docs/superpowers/plans/2026-07-02-sub3-route-tests.md).

- **`app/api/sync/route.test.ts` created — 19 tests.** GET cache/filtering; POST config/empty-sync
  guards + 401/502 error mapping; POST happy-path + per-date ledger immutability + disposition
  stamping; ledger-rebuild one-shot gating (runs once / marker refuses repeats / force overrides);
  physiology reconcile wiring; best-effort failures (quirk/intervention/analysis) surfaced as warnings
  not hard-fails; today-ride deterministic-analysis path (write + ledger patch + pending flag); DELETE
  discard (lived-days archive, calendar cleanup, same-day noise guard).
- **`app/api/generate/route.test.ts` extended +9 → 11 tests.** Request validation (400
  not-configured/non-JSON/invalid-params); structured-payload failure paths (502 null / 502
  schema-invalid / thrown→502); truncation-first + day-count-shortfall warnings; provenance +
  audit-trail stamping; best-effort season-replan (a persistence failure never blocks generation).
- **Architecture: I/O mocked only at the module boundary** (`intervals-api` network, `data-store`/
  `physiology` fs, `anthropic-api` LLM); the pure pipeline (score-log, sync-ledger, disposition,
  readiness, coach-snapshot, validators, plan-schema) runs for real — so these prove the wiring, not
  the already-unit-tested internals. Handlers invoked directly as functions with a `Request`, no server.
- Full suite 647 tests (58 files), up from 619 pre-SUB-3.

---

## SUB-1 · Durable planned corpus (block-history) (2026-07-02)

Closed the 2026-06-30 audit's "planned corpus isn't durable across blocks" finding: `buildRideScores`
matched a ride only against the *live* current block, so a ride whose block had since rolled over,
finished, or been discarded was stuck `planned:false` forever — indistinguishable from a ride with no
plan at all, even though a plan genuinely existed. 5 tasks via subagent-driven development, every task
approved on first review pass, plus one final-review fix batch — 6 commits, 619 tests (up from 611).
Design/build records: [design](docs/superpowers/specs/2026-07-02-block-history-durable-corpus-design.md) ·
[plan](docs/superpowers/plans/2026-07-02-block-history-durable-corpus.md).

- **`BlockHistoryEntry` gained per-day prescriptions.** New optional `days?: CurrentBlockDay[]` field
  (verbatim reuse of the live-block day type), populated by a new pure helper `truncateBlockDays(days,
  asOfDate)` that keeps only the *lived* portion — a superseded or discarded block's un-lived future was
  never a real plan, so archiving it would just manufacture match ambiguity. `lib/types.ts`,
  `lib/score-log.ts`.
- **`buildRideScores` matches against historical blocks, not just the current one.** New optional
  `history?: BlockHistoryEntry[]` param, seeded oldest-first so the live current block always wins a
  date collision, else the most-recently-created historical block wins — with a guard so a block can't
  retroactively claim to have prescribed an already-past day (`createdAt` must be ≤ the day it prescribes).
  The one production call site (`app/api/sync/route.ts`) threads the already-in-scope `blockHistory`
  variable through — no new I/O. `lib/score-log.ts`.
- **All three block-death paths now archive `days`** — write-time supersede and retrospective completion
  already called `appendBlockHistory`, just gained the field; **discard** (`DELETE` on `/api/sync`)
  previously archived *nothing at all*, silently losing any days already ridden against a block the
  athlete threw away. Now archives the lived portion (skipped entirely when zero days were lived — a
  same-day discard has nothing worth preserving). `app/api/write/route.ts`,
  `app/api/retrospective/route.ts`, `app/api/sync/route.ts`.
- **Design choice: history-aware *first*-scoring, not a rebuild-trigger.** The ledger's existing rebuild
  merge (`mergeScoreLogRebuild`) already permitted an off-plan→planned upgrade with zero changes — the
  gap was only that `buildRideScores` never had a historical prescription to find. Making it history-aware
  on every normal sync (not just on the rare, deliberately-manual full rebuild) means a ride gets scored
  correctly the *first* time, so nothing is ever frozen wrong and nothing needs retroactive fixing. No new
  ledger mechanism; LEDGER-1/2/3 composed with, not modified.
- **Final whole-branch review (Fable 5) caught 3 real cross-task interactions no per-task review could
  see**, all fixed in one batch (commit `8c2d32e`): `appendBlockHistory`'s pre-existing 20-entry cap
  (`lib/data-store.ts`) would have evicted real history within a season once discard-archival raised churn
  — raised to 200; `app/api/generate/route.ts` read `blockHistory[0]?.structuredReflections` blindly,
  which could now be a reflections-less discard entry, silently dropping Track D context on a common
  reroll flow — fixed to search for the most recent entry that actually has reflections (matching the
  robust pattern already used by the retrospective GET); and archiving a same-day zero-lived-days discard
  was creating noise entries on athlete-visible surfaces (`PlanView`'s block-history list, the Trends block
  timeline) — guarded to skip archiving when nothing was lived. The design spec's claims about pruning,
  discard "costing nothing," and "nothing here is athlete-visible" were corrected in place as dated notes
  once the review falsified them.
- **Sibling item paused, not shipped:** SUB-2 (legacy backfill importer) → see ROADMAP.md stable handles
  for why (a live Intervals.icu API check found only 22–28% of the pre-app legacy corpus has calendar
  backing, not the whole window as originally assumed).

---

## Season/block goals-flow: Goals/Weakpoints centralization + Season/Block hierarchy + block-completion prompt (2026-07-01)

Three approved specs, built together in dependency order (Task 1–3 foundational, 4–5 depend on the new
goals shape, 6 independent) via subagent-driven development — 6 commits, each independently task-reviewed
and passed a final whole-branch review clean on first pass. Suite grew 597 → 611. Design/build records:
[goals-weakpoints-centralization](docs/superpowers/specs/2026-07-01-goals-weakpoints-centralization-design.md) ·
[season-block-hierarchy](docs/superpowers/specs/2026-07-01-season-block-hierarchy-design.md) ·
[block-completion-prompt](docs/superpowers/specs/2026-07-01-block-completion-prompt-design.md) ·
[plan](docs/superpowers/plans/2026-07-01-season-block-goals-flow.md).

- **Goals/Weakpoints off markdown, into a real form.** `AthleteProfile.goals`/`weakpoints` widened to
  `{goal, target, focus}` / `{weakpoint, detail}` (`focus` a `SeasonFocus` tag or `"general"`), replacing
  the old `string[]` shape read from hand-edited `athlete_profile.md` tables. A one-time migration
  (`applyGoalsMigration`, gated on `goalsMigratedAt`) seeds them from whatever was in the markdown file
  the first time this runs; never re-runs once set, never overwrites already-non-empty data. The
  read-only Goals/Weakpoints list on `/profile` is now a real add/edit/delete form with its own
  independent Save button/state (no cross-talk with Nutrition/Season saves). `athleteProfileToMarkdown`/
  `writeAthleteProfileMd` (confirmed zero remaining callers) deleted. `lib/types.ts`, `lib/data-store.ts`,
  `lib/kb-loader.ts`, `components/AthleteProfileForm.tsx`.
- **Generation prompt freshness.** The markdown GOALS/WEAKPOINTS tables are now stripped
  (`stripGoalsWeakpointsSections`) before `athlete_profile.md` is inlined into the generation prompt, so
  a stale copy can never sit alongside the live `goalsContext`/`weakpointsContext` injected straight from
  `AthleteProfile`. `/api/profile` GET/PUT extended to expose/accept `goals`/`weakpoints`.
  `lib/kb-loader.ts`, `app/api/generate/route.ts`, `app/api/profile/route.ts`.
- **Season informs Block.** Two pure helpers in `lib/season.ts` — `suggestedBlockWeeks` (ceiling-rounds
  the current season period's remaining weeks to the nearest of `[2,4,6,8]`, floor 2 / cap 8) and
  `filterGoalsByFocus` (keeps focus-matching + every `"general"`-tagged goal) — wired into the block
  generator's pre-fills, plus `SeasonPlan.objective` folded into the existing `formatSeasonContext` line.
  `components/dashboard/PlanView.tsx` fetches the season plan independently of the profile fetch (two
  effects; the season effect re-derives the goal pre-fill once both resolve, in either order) and passes
  a season-context readout + the widened 2/4/6/8 length buttons through to `BlockGenerator.tsx`. Nothing
  is ever locked — every pre-fill stays freely overridable before generating.
- **Block-completion prompt.** A pure `isBlockFinished(block, today)` predicate (`lib/date.ts`, strict
  `today > block.endDate`) hooked into `PlannedToday`'s existing empty-state branch: once the active
  block's dates have passed, `/today` proactively nudges the athlete to generate the next one instead of
  silently showing stale "no session planned" copy.
- **Post-ship bugfix (user-reported): real goals/weakpoints weren't migrating.** `readAthleteProfile`'s
  and `applyGoalsMigration`'s migration guards checked `goalsMigratedAt === null` / `!== null` strictly —
  a real, pre-existing `athlete.json` written before this field existed parses back with the key entirely
  *absent* (`undefined`, not `null`), which the strict guard misread as "already migrated," permanently
  skipping the athlete's real GOALS/WEAKPOINTS content. Fixed both guards to truthy checks; added a
  regression test that simulates the missing key by destructuring it away rather than only ever setting
  it explicitly (the gap every prior review layer missed, since in-memory fixtures always set the field).
  Ran the real migration and verified end to end in-browser (8 goals + 9 weakpoints now render on
  `/profile` and the `/plan` Goals card). `lib/data-store.ts`.
- **Known debt (accept-as-tracked)** → [ROADMAP.md](ROADMAP.md) stable handles:
  Focus dropdown omits `sharpen`; a narrow goal-textarea race between the profile/season fetches;
  `stripGoalsWeakpointsSections`'s case-sensitive regex doesn't match the *default* KB template's
  differently-worded headings (real KB unaffected — it already uses the matching uppercase form).

## Season event-entry UI (2026-07-01)

Closed the MACRO-1 gap left by macro-periodization below: `SeasonPlan.objective`/`events` were
athlete-owned intent already persisted by `PUT /api/season`, but nothing in the UI let the athlete set
them, so event-anchored mode could never activate for a real athlete. Added a "Season" card to
`/profile` (objective field + a controlled add/edit/delete event list — name/date/A-B-C priority),
reusing the already-shipped `/api/season` GET/PUT and `validateSeasonPlanInput` (client-side
pre-validation, zero new backend). `components/AthleteProfileForm.tsx`. Design:
[season-event-entry-ui](docs/superpowers/specs/2026-07-01-season-event-entry-ui-design.md).

## Macro periodization & season scope — MACRO-1/2/3 (2026-07-01)

Closed the 2026-06-30 audit's "no periodization above the block" finding — the planner previously
optimised each 2–4 wk block in isolation with no target event, no weeks-to-event, and no base→build→
peak→taper sequence. 10 tasks via subagent-driven development, 15 commits, final whole-branch review
clean. Design/build record:
[macro-periodization](docs/superpowers/specs/2026-07-01-macro-periodization-design.md) ·
[plan](docs/superpowers/plans/2026-07-01-macro-periodization.md).

- **New store `data/season-plan.json`** — `SeasonPlan { objective, events: SeasonEvent[], periods:
  FocusPeriod[], updatedAt }`. Each `FocusPeriod` picks one system to emphasise (`aerobic-base` /
  `threshold` / `vo2max` / `anaerobic` / `durability` / `sharpen`) with a phase (`base`/`build`/`peak`/
  `taper`), grounded in the KB's Annual Periodisation Framework constants (base 90/10 easy/mod, build
  80/20, deload 30–50% volume every 3–4 weeks, cadence 3:1 default / 2:1 under heavy fatigue) — not
  invented by the LLM. `lib/season.ts`, `lib/types.ts`.
- **Two macro-periodization modes.** **Mode C (the live default, no event on the calendar)** —
  `replanSeasonArc` runs a rolling base→build→realize cycle: limiter-driven focus rotation (reusing the
  power-profile "easy win" + durability-template machinery rather than a parallel phase system), forced
  deload cadence, and an ACWR-capped load ramp between periods. Re-planning preserves the in-progress
  ("current") period verbatim as a 3rd bucket distinct from frozen history/manual overrides, so a
  re-plan never yanks the rug from under a period the athlete is mid-way through. **Event-anchored mode
  (built, tested, dormant)** — schedules backward from a future A-priority event (taper→peak→build);
  activates automatically the moment `SeasonPlan.events` holds one (see "Season event-entry UI" above
  for how an event gets there).
- **Feeds generation.** `POST /api/generate` calls `replanSeasonArc` + `validateSeasonFit` and folds
  `formatSeasonContext`'s one-line `SEASON CONTEXT` (phase/focus/week-of/rationale) into the prompt;
  `lengthWeeks` widened to `2 | 4 | 6 | 8` end to end (type, route validator, UI). `app/api/generate/route.ts`.
- **`SeasonRoadmap` stepper UI on `/plan`.** Done/current/upcoming period cards + an event flag,
  visually verified end-to-end against a seeded season plan.
- **`GET`/`PUT /api/season`** — read the plan / update `objective`+`events` (periods are engine-managed,
  not directly editable); `validateSeasonPlanInput` guards the PUT.
- **Known debt** → [ROADMAP.md](ROADMAP.md) Phase 8: event-mode peak/taper
  share one `sharpen` focus value (cosmetic, same roadmap color); `CurrentBlock.seasonFocus`/
  `seasonPhase` stamped from "today" not the block's actual start date (no readers yet); `anaerobic` is
  a valid build focus but unreachable via the default rotation fallback (intentional per KB).

---

## Fueling-aware coach + Today/Profile feedback sweep (FB-2026-06-30)

- **#1 — energy availability now feeds the coach.** EA is a first-class `CoachSignal` (computed once in
  `resolveCoachSignals`, anchored to the resolved local day): it fills the previously-reserved
  `fuel.fuelingState` (low/adequate/ample band) + `fuel.intakeVsNeed` (kcal/kg) slots, renders on both LLM
  paths (`formatCoachSnapshot` + `formatFormFuelLine`, framed as a body-weight proxy) and the athlete-facing
  `CoachSnapshotCard`. Null until ≥3 complete logged days. The coach can finally reason about under-fueling.
  _[coach-snapshot.ts](lib/coach-snapshot.ts) · [nutrition.ts](lib/nutrition.ts) · [AthleteStateCard.tsx](components/AthleteStateCard.tsx)._
- **EA reads low/adequate/ample.** New pure `eaLevel()` — soft, non-clinical bands shifted to a body-weight
  basis (the FFM 30/45 cutoffs don't map), framed as a rough reference. _[nutrition.ts](lib/nutrition.ts) · [dashboard/today.tsx](components/dashboard/today.tsx)._
- **RPE dropped as an athlete-state driver (revisit later).** Over-swung the state against a ~0 baseline (no
  historical RPE logged). Removed `evalRpe` from the fusion + the ride-card tile; high-confidence gate relaxed
  ≥4→≥3 (5→4 core signals); calibration `rpe` weights left dormant. _[athlete-state.ts](lib/athlete-state.ts)._
- **Coach-note frame glitch fixed.** Unified the analysing/loaded/empty branches into one content-height Zone
  (the `fill` divergence had snapped the cyber-bracket frame mid-sync). _[dashboard/TodayView.tsx](components/dashboard/TodayView.tsx)._
- **Power curve: drag-scrub + half-size + side-by-side.** Interactive client chart (drag/hover to read off
  any duration's watts + W/kg); laid beside the rider profile in a two-column row. PR recognition now covers
  all 9 synced durations (adds 2m/30m/60m). _[PowerCurveChart.tsx](components/PowerCurveChart.tsx) · [AthleteProfileForm.tsx](components/AthleteProfileForm.tsx) · [pr.ts](lib/pr.ts)._

---

## Calibrated-honesty UX pass — Today / Trends / Profile

The UI now grades its own certainty the way the engine already does: provenance stamped, thin reads
flagged, flaky/off-vocabulary numbers pruned or relabelled. Display-only — no engine changes.

- **A — confidence tiers.** Athlete-State `low` confidence renders as an amber caution (thin read — few
  core signals or a tiny exec sample); thin aggregates the engine can't trust are withheld (`—`) rather
  than shown (ACWR already returns `null` below 14 days, RV2-2). _[AthleteStateCard.tsx](components/AthleteStateCard.tsx)._
- **B — provenance stamps.** The IF tile stamps its basis (`· NP` vs `· avg`, since `ride-analysis` reads
  `normalizedPower ?? avgWatts` and an avg-based IF understates variable efforts); decoupling carries a
  "context only — not in your execution score" note. _[dashboard/today.tsx](components/dashboard/today.tsx)._
- **C — prune to a trusted core.** Avg speed removed from the Today glance; decoupling relocated to the
  "Power execution" drill-down (it's not a scored signal). Profile makes the two-memory split visible —
  measured sections carry a cyan "synced" badge, owned intent keeps "Edit →". Metric name standardised to
  **"Load"** (Intervals.icu's term) across Today/Trends/Plan; the readiness tooltip stopped claiming HRV
  (it's gated off). _[today.tsx](components/dashboard/today.tsx) · [AthleteProfileForm.tsx](components/AthleteProfileForm.tsx)._
- **Recent Baselines curated.** The card now holds single numbers that aren't already a chart: **w/kg @
  threshold** (a current snapshot, FTP ÷ latest weight, resolved in the trends route) · weekly hours ·
  **rides/week** (new 90-day rolling metric) · avg load/ride. Dropped cadence (low value) + decoupling (the
  Pw:HR chart tells it). _[trends/sections.tsx](components/trends/sections.tsx) · [readiness.ts](lib/readiness.ts)._
- **Energy-availability tile** ⭐ — deterministic fuel proxy `(intake − ride burn)/kg`, trailing mean over
  complete days (today excluded), week-over-week trend, **no clinical band** (a body-weight proxy off
  self-logged intake can't claim the 30/45 kcal/kg·FFM cutoff; on real data the athlete straddles 30 day to
  day, so a band would flicker). Withheld below 3 logged days. `computeEnergyAvailability` + 3 tests.
  _[nutrition.ts](lib/nutrition.ts) · [dashboard/today.tsx](components/dashboard/today.tsx)._
- **Device-lap path reverted** (`f81f4dc` → `c439ba4`) — Intervals.icu's one-click "use laps" already folds
  laps into `icu_intervals`, so the app stays single-source; no second fetch path. _[intervals-api.ts](lib/intervals-api.ts)._

## Accuracy & hardening sweeps — Jun 24–25

Three senior-dev deep-reads of the deterministic core plus an athlete-requested accuracy pass, all shipped;
the suite grew to ~558. Only RV2-15 (data-gated) and a lap-field confirmation remain → [todo.md](todo.md).

- **RV2 — accuracy review (engine deep-read, 15 findings; 13 shipped).** Theme: *windows that include their
  own comparison point*, *divisors that assumed full history*, *open-top scoring bands*. Shipped: ACWR &
  weekly-hours divisors use the days of history that exist + an explicit ≥14-day gate (RV2-2/3); aerobic + RPE
  baselines exclude the recent window they're compared against, with min-sample floors (RV2-4/5); Theil–Sen
  weight trend (RV2-6); HR zones with no LTHR/maxHR anchor return `[]` (RV2-7); VO2max/RaceSim penalise an
  over-cooked effort (RV2-8); `today` threaded into athlete-state for replay (RV2-11); one shared heavy-fatigue
  predicate (RV2-9); `stats.median` reuse (RV2-10); power-curve match tolerance clamped [5s,120s] (RV2-13);
  post-ride meal recommendation deleted — athlete fuels pre/intra only (RV2-14). RV2-1 closed as not-a-bug
  (`bucketZones` already drops zero-fill); RV2-12 accepted limitation (an NP scalar can't yield time-in-zone).
  _`125fde9` · `f9d2510` · `15789ea`._
- **Interval-order misparse (BUG-2026-06-25).** `parsePrescription` expanded `3x{Over,Under}` as
  each-step-×3 instead of repeating the block in sequence, so the order-based matcher scored every rep against
  the wrong target; it now expands in execution order then collapses identical reps for the label, and written
  blocks self-heal on the next sync. (A device-lap preference for the executed side was tried in `f81f4dc` and
  **reverted** — Intervals.icu's one-click "use laps" already folds laps into `icu_intervals`, so the app stays
  single-path on `icu_intervals` as before; no second fetch path to maintain.)
  _[prescription.ts](lib/prescription.ts) · [intervals-api.ts](lib/intervals-api.ts)._
- **ACC — second-brain state accuracy (athlete request).** Aerobic driver moved off whole-ride decoupling (a
  ride-structure artifact) to Intervals' Z2-isolated `icu_power_hr_z2` (higher = fresher; ≥15 Z2-min, latest
  ≤14d, baseline ≥3 rides). Weight trend moved to a least-squares/Theil–Sen slope over the trailing 14 days.
  Decoupling stays in execution scoring + Trends. _[athlete-state.ts](lib/athlete-state.ts) · [nutrition.ts](lib/nutrition.ts) · [docs/specs/athlete-state.md](docs/specs/athlete-state.md)._
- **RV — general review (10 findings, all closed).** Local-date threading through the readiness windows (RV-1);
  idempotent block writes via a deterministic uid + auto-rollback of a partial write + block-discard cleanup
  (RV-2/RV-9); HRV gated off-by-default and hardened for re-enable (RV-3/4); ledger anchored to each ride's own
  `icu_ftp` (RV-5); physiology history capped at 24 snapshots (RV-5b); matcher tradeoffs documented (RV-6);
  three monoliths split behaviour-preserving (RV-8). RV-7 (AI spend cap) closed won't-do — spend is cents.
- **CR — xhigh review of the Jun-23 logic + a11y pass (15 findings, all shipped).** Rebuild never downgrades a
  frozen `planned` entry or drops `formState`/`morningCheck` provenance (LEDGER-1/2), and is guarded behind a
  one-shot marker (LEDGER-3); settings PUT preserves + clamps every band/weight override (SET-1/CAL-1);
  durability-envelope split-brain fixed (CAL-3); zero-power / string-decoupling parse guards (API-1/2); a fasted
  `0g` ride kept as a real fuel data-point (FUEL-1); shared `pick` helper (CAL-2); muted-contrast a11y sweep,
  shared `athlete-state-ui`, `DECOUPLING_GOOD_BOUNDS` reuse, calibration-range validation (A11Y-1/2, UI-1/2, CAL-4).

## Per-athlete calibration framework — first pass (ROADMAP #2)

The keystone framework + its first calibrated parameter. Three commits; tests grew to 333.

- **The framework (Phase 0).** `lib/calibration.ts` promoted beyond α/ACWR into a uniform
  `CalibratedParameter { value, source, confidence, dataPoints, lastUpdated, locked, manualOverride }`
  (`lib/types.ts`) + `CalibrationStore`. `resolveCalibratedValue` resolves the effective value
  (precedence: manual override > trusted-derived [locked or ≥ medium confidence] > population default;
  never returns NaN); `confidenceFromN` is the sample-size confidence/lock layer (the additive
  uncertainty model Track D deferred into #2 — built once here). `data/calibration.json` is a derived
  store (`readCalibration`/`writeCalibration`, no backup, like rolling-baselines).
- **Decoupling "good" cutoff (Phase 1).** `deriveDecouplingGood` turns `rolling-baselines.avgDecoupling90d`
  (clamped 2.5–8, sample-size confidence) into the band's "good" cutoff, preserving a manual override and
  freezing once locked. `computeExecutionScore` takes optional `calibration.decouplingGood` and scales the
  decoupling bands off it — at the default G=4 the cutoffs are exactly `[2,4,7,10]`, so an uncalibrated
  score is byte-identical (no silent ledger regime split).
- **Immutable-ledger stamping.** `RideScoreEntry.calibration` freezes the values each entry was scored
  against (like `ftpUsed`; absent on pre-calibration entries). `buildRideScores` + the sync POST's
  interval-aware re-score both stamp it; a calibration change only affects new entries.
- **Wiring + UI.** Sync POST derives → writes → resolves → scores+stamps; GET returns `calibration` on
  `AppState`; read-only `CalibrationPanel` on Settings shows the effective value + provenance
  (default / learning / calibrated). Until a sync derives a confident value, everything resolves to the
  population default — a fresh athlete scores exactly as before.
- **Per-type IF cutoffs (second parameter under the framework).** `deriveIfBandOffsets(powerZonePct)`
  (`lib/calibration.ts`) shifts the `computeExecutionScore` `switch (plannedType)` IF bands to the
  athlete's OWN power-zone %FTP edges — Recovery/Z2/Threshold/VO2max/SIT anchored to their zone top
  (Z1/Z2/Z4/Z5/Z6), RaceSim deliberately left on population constants (no single anchoring edge). The
  per-type shift is a bounded FTP-fraction offset (±0.08 clamp, 0.02 deadband) added to every band edge
  in the IF branch; `DEFAULT_POWER_ZONE_TOPS_PCT = [55,75,90,105,120,150]` (Coggan/Intervals defaults)
  yields `{}` → **byte-identical scoring for a default-zoned athlete** (the regression net: the existing
  execution-score suite stays green unchanged). Threaded through `resolvedCal.ifBandOffsets` in the sync
  route to **both** the ledger re-score and today scoring; `execution-score.ts` gained a
  `ScoringCalibration { decouplingGood?, ifBandOffsets? }` type, `o = calibration?.ifBandOffsets?.[type] ?? 0`.
  Pure + deterministic + tested (offset derivation + the IF-branch shift in isolation). _Slivers left
  in ROADMAP #2:_ surface on Settings (derived live from zones, not yet in `CalibrationStore`); anchor RaceSim.

- **IF offset frozen onto ledger entries (provenance, ROADMAP #2 sliver).** `buildRideScores` now stamps
  the per-type IF-band offset that actually scored an entry alongside the decoupling cutoff, via the new
  exported `calStampFor(calibration, scoringType, intrinsic)` helper — replacing the single global
  `calStamp`. Only **planned** entries carry an offset (off-plan rides skip the intensity-vs-type branch,
  so none applied); a zero/deadband offset or an irrelevant type is omitted, so uncalibrated/default-zoned
  entries stay key-free (byte-identical). `RideScoreEntry.calibration` widened to
  `{ decouplingGood?; ifBandOffset? }` (both independently optional — backward-compatible with stored
  entries). The sync route's live-today re-score reuses `calStampFor` so today's entry stamps the same
  shape. Tested (planned stamp, type-scoping, deadband, off-plan omission); full suite green.

- **TSB adaptation-window edges under the framework (ROADMAP #2, closes #1's `form.tsbModifier` sliver).**
  `resolveTsbModifier`'s literal band edges (`-25 / -10 / 5`) are now a calibrated parameter:
  `TsbModifierEdges` + `DEFAULT_TSB_MODIFIER_EDGES` + `resolveTsbModifierEdges(override)` /
  `isTsbModifierEdgesOverridden` in `lib/calibration.ts`, mirroring `resolveAcwrBands` (defensive merge:
  ignore non-finite, clamp to a sane TSB range, enforce strict ascending order). **Deliberately the
  ACWR-bands pattern, NOT auto-derived** — the honest per-athlete signal (where THIS athlete stops
  adapting under fatigue) is measured nowhere; recentering on their TSB *distribution* would calibrate to
  where they train, not where they adapt (the framework header's "don't pretend to derive what we lack
  data for" rule). So: population-validated defaults + a manual override (`BlockSettings.tsbModifierEdges`,
  persisted/clamped in `/api/settings` like `acwrBands`). `resolveTsbModifier` gained an
  `edges = DEFAULT_TSB_MODIFIER_EDGES` param; `buildCoachSnapshot` resolves from a new
  `tsbModifierEdgesOverride` input, threaded through `CoachSnapshotSources` + all four snapshot build
  sites (sync ×2, ask, generate). Absent override → byte-identical classification (the fresh-athlete
  guarantee, tested across a TSB sweep). Tested (resolver clamp/order, override band shift); full suite green.

- **Form-state context stamped onto the ledger (ROADMAP #2 — input side of the context-stamp data play).**
  The play that makes the override-only edges (e.g. the TSB adaptation window) eventually *learnable*:
  freeze the athlete-state context an entry was scored under, so a later state→subsequent-execution
  correlation has something to correlate against. First parameter stamped = **form** (CTL/ATL/TSB).
  `buildFormStateLookup(wellness)` (`lib/readiness.ts`) returns a per-date resolver over intervals.icu's
  OWN per-day CTL/ATL (authoritative, not reconstructed): the most recent **strictly-prior** day (the form
  carried IN — not same-day, whose end-of-day CTL/ATL already absorbed that day's ride, which would leak
  the session's own load into the signal; also matches the PMC "form = yesterday's CTL−ATL" convention),
  carried forward across gaps up to a 10-day staleness cap (CTL drifts over weeks), `tsb = round1(ctl −
  atl)`, null when nothing recent enough exists. _[review-hardened: strictly-prior + staleness cap.]_
  `buildRideScores` gained a 7th optional resolver and stamps `RideScoreEntry.formState = { tsb, ctl, atl }` on each entry
  (spread-ready — absent when no wellness covers the date or no resolver passed → byte-identical). The
  sync route builds the lookup from `lastSync.wellness`. **Provenance only — `formState` never feeds the
  entry's own `executionScore`** (it's the input for a *future* correlation, kept out of the score it
  describes to avoid circularity). Backfill + the live-today re-score preserve it via `...e`. Tested
  (same-day / carry-forward / missing / rounding + the stamp present-and-absent).

- **Morning-check context stamped + resolver generalized (ROADMAP #2 — input side completed).** The
  subjective half of the context stamp: `RideScoreEntry.morningCheck = { fatigue, sleep, soreness }`
  (1–5, same-day only — no carry-forward; the first-person signal not captured by objective load). The
  `buildRideScores` resolver was generalized from `formStateForDate` → `contextForDate: (date) =>
  RideEntryContext | null` (`{ formState?, morningCheck? }`), each field stamped independently and
  spread-ready (byte-identical when absent). The sync route builds the combined resolver from
  `lastSync.wellness` + a `readMorningChecks()` map. **Readiness deliberately NOT stamped** — it's a
  derived composite of form + HRV, reconstructable from what's already frozen, so storing it would
  duplicate derivable state. Tested (form + morning-check together, form-only, absent).

- **First auto-derivation off the stamped context: the TSB deep-fatigue edge (ROADMAP #2 — payoff of
  the data play).** `deriveTsbDeepFatigue(entries)` (`lib/calibration.ts`) recenters the deep-fatigue
  edge on the **median TSB of the athlete's under-executed quality sessions** — **prescribed** quality only
  (`planned && plannedType ∈ {Threshold,VO2max,SIT,RaceSim}`; off-plan rides are scored intrinsically, a
  different failure axis, so they're excluded), `executionScore ≤ 4`, legacy + compromised excluded.
  **Honesty guards**, all falling back to the population default: a confidence gate on the failure count
  (`confidenceFromN`, never applied below medium); a **contrast requirement** — needs ≥1 successful quality
  session, else there's nothing to discriminate against; and a **discrimination guard** — failures must sit
  ≥4 TSB points deeper than the successes' median, else fatigue isn't the driver. _[review-hardened:
  planned-only + required success contrast.]_ Derived value clamped to
  `[-45, -12]`. `resolveTsbEdgesOverride(entries, settingsOverride)` layers the derived edge as the new
  default **under** any manual override (precedence: manual > derived > population), returning a partial
  that flows through the existing `resolveTsbModifierEdges`. Wired at every snapshot site
  (`buildCoachSnapshotFromSources` + generate). No-signal/no-formState athletes resolve to the population
  edges → byte-identical classification. This is the first override-only edge to become *learned*, exactly
  the roadmap worked example — turning the 2b override-only TSB window into a derived one once the data
  earns it. Tested (derivation, both guards, exclusions, clamp, precedence, low-confidence fallback);
  full suite green (834).

- **TSB-derivation review follow-ups CS-5..CS-8 (after findings 1–4 fixed inline).**
  - **CS-5 — per-edge precedence.** `resolveTsbEdgesOverride` now resolves precedence per-edge: a manual
    `deepFatigue` short-circuits the derived value entirely, and a derived edge **yields** below a manually-set
    `productiveOverload` (`min(derived, manualPO − 1)`) so `resolveTsbModifierEdges`' ordering pass can no
    longer nudge a manual neighbour up. Manual > derived > population, for the *neighbour* edges too.
  - **CS-6 — single morning-check read.** The sync POST read `readMorningChecks()` twice (ledger stamp +
    snapshot); hoisted to one read reused by both.
  - **CS-7 — TSB-specific confidence gate.** Replaced `confidenceFromN(nUnder)` with
    `tsbDeepFatigueConfidence(nUnder, nGood)`: lower failure bar (quality failures are rare + informative)
    but now requires real **contrast** (≥3 successes) — effective take-effect gate is nUnder ≥ 5 ∧ nGood ≥ 3
    (was an ~unreachable ≥8 failures). The contrast requirement also blunts CS-8's tiny-N median concern,
    since the applied derivation now rests on ≥3 successes.
  - **CS-8 — shared `lib/stats.ts`.** Extracted `round1` / `round2` / `clamp` / `median` into one module;
    `calibration.ts`, `readiness.ts`, `score-log.ts` now import them instead of re-defining. Tested. Full
    suite green (839 + stats).

### Population-fallback fold-in — strain bands, durability envelope, fusion weights (ROADMAP #2/§5)

Three scattered groups of "magic numbers" brought under the same `resolve-with-fallback` machinery as the
ACWR/TSB-edge bands — population fallback, manually overridable via `BlockSettings`, **no** derivation
(no honest per-athlete signal exists yet). Each consumer takes the resolved value as an optional param
defaulting to the population default, so an absent override behaves byte-identically. Two commits; tests
grew to 462.

- **Morning-check strain bands + TSB-deep cutoff.** `StrainBands` (`high`=15/`med`=12) +
  `resolveStrainBands` in `calibration.ts`; `decideMorningCheck` takes the resolved bands. The TSB-deep
  cutoff dropped its duplicate `-25` literal and now routes through the existing
  `resolveTsbModifierEdges().deepFatigue` (one source for the edge). Wired via the morning-check route.
- **Durability-insert envelope.** `DurabilityInsertEnvelope` (88% floor, ≤122% / ≤20 min) +
  `resolveDurabilityInsertEnvelope`; dedups `EMBEDDED_HARD_PCT` (was defined twice — `prescription.ts`
  + `workout-validate.ts`). `validateWorkoutProtocol` / `validatePlanProtocol` / `carriesEmbeddedIntensity`
  take the resolved value; wired via the generate route.
- **Athlete-state fusion weights.** `athlete-state.ts`'s private `const C` promoted to
  `DEFAULT_ATHLETE_STATE_WEIGHTS` + `resolveAthleteStateWeights` (recursive finite-leaf deep-merge, never
  mutates the default) + a shared `DeepPartial` helper. `computeAthleteState(i, weights = DEFAULT)` —
  evaluators are now pure fns of `(inputs, weights)`. Threaded through `resolveCoachSignals` +
  `CoachSnapshotSources` and every snapshot site (sync GET + POST, `/api/ask`, generate).
- **Overrides** live on `BlockSettings` (`strainBands` / `durabilityInsertEnvelope` /
  `athleteStateWeights`), alongside the existing `acwrBands` / `tsbModifierEdges`. Per-athlete
  *derivation* of any of these stays future work (← #2's shared correlation engine).

### Shared correlation engine + carbs ledger stamp (ROADMAP #2 / Track C)

The reusable substrate the roadmap asked for ("build the derivation once, reuse it") plus the first new
signal stamped against it. Two commits; tests grew to 474.

- **The engine (`lib/correlation.ts`).** `deriveExecutionEdge(entries, spec)` generalises the guarded
  regression `deriveTsbDeepFatigue` hard-coded: population filter (planned · !legacy · !compromised ·
  in-scope type · present signal), under/good outcome partition, a discrimination guard with a
  `failureSide` direction (`lower`|`higher`), confidence gate + clamp → `CalibratedParameter`. Depends
  only on `./types` + `./stats` (no `./calibration`) so calibration consumes it cycle-free.
  `deriveTsbDeepFatigue` is now a thin `failureSide: "lower"` spec over it — behaviour byte-identical
  (every existing deep-fatigue test still green).
- **Carbs input stamped (`fuel.carbsGPerH`).** intervals-api maps `carbs_ingested` ("CHO In") into
  `ActivitySummary.carbsIngestedG`; `score-log.fuelStampFor` freezes it as g/h (grams over moving hours)
  onto each entry, alongside the calibration + context stamps. Only a positive logged intake is stamped
  (a blank/zero field is indistinguishable from "didn't fuel" — no fake zeros). Provenance only; never
  feeds `executionScore`. Sparse until athletes fill it in, accumulating like `formState` did.
- **Not yet built** (ROADMAP Track C): the *optimum*-derivation shape carbs needs (the engine finds a
  failure edge, not an optimum); consuming the derived optimal g/h (#1 fuel slots, §6 surfacing); the
  `productiveOverload`/`balanced` edges (no honest execution outcome) and the morning-check strain edge
  (needs `motivation` stamped — the ledger freezes only fatigue/sleep/soreness).
- **Subjective wellness now synced (Inc 1 of the form-retirement plan, `98464b9`).** Reframed: the morning
  read is sourced from the **Intervals.icu wellness sync** (the athlete already logs it there next to
  weight/kcal), not a NodeVelo form. `fetchWellness` now maps soreness/fatigue/stress/mood/motivation/injury
  into `WellnessEntry` (raw 1–4, higher = worse). The strain-edge derivation + form retirement (Inc 2–3) and
  the open strain-scale decision are tracked in [ROADMAP.md](ROADMAP.md)'s stable handles.

### One-time ledger rebuild after the mapping fix (SYNC-2, 2026-06-23 triage)

The field-mapping fix corrected future syncs, but `mergeScoreLog` freezes past dates (existing-wins),
so 108 historical entries kept execution scores + IF computed off the old null NP (IF fell back to raw
avg). Added an opt-in `rebuildLedger` flag to POST `/api/sync`: when set, the score-log step merges
**fresh-wins** (recomputed entries override existing) instead of the normal freeze, re-scoring every date
inside the 182-day activity window from corrected activities while preserving anything outside it. Off by
default (normal sync stays immutable per date); reuses the entire build pipeline (ftpForDate / resolvedCal
/ contextForDate / backfill / dispositions) so there's no divergence. Ran once + verified: entries with
IF<0.70 dropped 72→39, and e.g. the 2026-06-18 **SIT** session went IF 0.63→0.86 / exec 2→8 (it was
wrongly scored as failed purely from the understated IF). Backups: json-store `.bak` + an explicit
`score-log.json.pre-rebuild-*.bak`. (Entries that stayed low are genuinely NP-less rides.)

### Coach-note render collapse fix (SYNC-1, 2026-06-23 triage)

The Today coach note was generated, persisted, and returned by GET (correct `activityDate` + `coachNote`)
but rendered invisibly: its `fill` Zone (`flex-1 min-h-0 overflow-y-auto` body) collapsed to **0px**
(`clientHeight 0`, `scrollHeight 333`) whenever the Trend-pulse sibling consumed the viewport-locked
right column. Confirmed with a headless-Chromium measurement against the live app. Fix
([components/Dashboard.tsx](components/Dashboard.tsx)): drop `fill` from the coach-note Zone (size to
content) and make the right column itself scroll (`lg:overflow-y-auto`) — the note now has real height
(section 28px → 385px) and is reachable. Verified before/after via Playwright + screenshot. (Further
above-the-fold density tuning stays the UI lane's page-density item.)

### Activity power-field mapping fix (P1 data integrity, 2026-06-23 triage)

`fetchActivities` read NP/decoupling/max from keys intervals.icu never returns, so they were `null` on
every ride — silently dropping IF back to raw avg watts (a VO2 4×4 read as 0.62 / "recovery") and
zeroing decoupling + its rolling baseline. Verified against the raw activity API: NP is
`icu_weighted_avg_watts` (not `icu_normalized_power`), decoupling is a bare `decoupling` (not
`icu_power_hr_decoupling`), max power is `icu_pm_p_max` (not `max_watts`); `icu_efficiency_factor` was
present all along, which is what exposed the gap (EF needs NP). Fixed with the correct keys (old ones
kept as defensive fallbacks) + a mapping test. _Follow-up open in todo (SYNC-2):_ historical score-log
entries are frozen with the wrong IF/decoupling and need a one-time rebuild. (Triage also confirmed the
coach-note non-display is a client render bug — SYNC-1 — and that "no power PRs" was correct, not a bug.)

---

## Scoring-core — Z2 "dialed-in" discipline signal

**Superseded 2026-07-11** — the *scoring* mechanism below (`aboveZ2Frac`, the power-based ±2 band) was
replaced by an HR-based, terrain-immune read; see "HR-judged easy-ride discipline" further up this file.
The `CoachSnapshot.today.execution.aboveZ2Pct` *surfacing* described here initially survived that
rework untouched, then was itself replaced the same day by the HR-based `aerobicDiscipline` field — see
"Coach-prompt aerobic-discipline gap closed" at the top of this file. Kept below as the historical
record of what originally shipped.

Closed the ROADMAP scoring-core gap: easy aerobic rides were scored on *average* IF + decoupling, so a
Z2 ride that averaged a textbook 0.68 IF while repeatedly surging into Tempo+ read as disciplined — the
mean hid the spikes and the variability index only blurred them.

- **The measure.** `timeAboveZ2Fraction(powerZoneTimes)` (`lib/execution-score.ts`, pure + defensive)
  returns the share of measured in-zone time spent in **power zones 3+** (above the Z2 aerobic cap),
  from the already-synced `ActivitySummary.powerZoneTimes` — `null` when there's no usable zone data so
  scoring falls back to its other signals.
- **The score.** A bounded **±2** band in `computeExecutionScore` (`aboveZ2Frac` input): ≤5% above cap
  → +1 (genuinely dialed in), ≤15% → 0, ≤30% → −1, >30% → −2. Gated to **prescribed Z2/Recovery** and
  skipped for off-plan (intrinsic) rides — no plan to be disciplined against — and absent-safe, so every
  existing ride without zone data scores byte-identically (the execution-score suite stayed green
  unchanged). Threaded through both score call sites: `buildRideScores` (the ledger; past entries stay
  frozen via `mergeScoreLog`, so only new rides see it) and `buildTodayAnalysis` (today, re-scored live).
- **Surfaced.** `CoachSnapshot.today.execution.aboveZ2Pct` (% above cap, Z2/Recovery only) renders in
  `formatCoachSnapshot` with a qualitative tag (dialed in / drifted / drifted hard) so Ask-Coach reads
  the resolved discipline number instead of inferring it. 12 new tests (helper + band + surfacing); suite 394 → 406.

---

## Code-review hardening sweep (CR-A..H)

A "senior dev who hates this implementation" pass over the whole repo, 2026-06-22 — eight findings,
each shipped as its own atomic commit with tests. Suite grew 333 → 394. Deferred sub-items (real but
lower-leverage) are routed to ROADMAP; the design-judgment calls live there too.

- **CR-A — transactional ledger writes.** `json-store` serialized byte-*writes*, not read-modify-write,
  so a concurrent `/api/sync` + `/api/disposition` each doing `read→mutate→write` on `score-log.json`
  could lose an update. Added `updateJsonFile<T>(file, fallback, mutate)` (reads INSIDE the per-file
  lock via the generalized `withFileLock`) + `updateScoreLog`/`updateDispositions` helpers; wired both
  sync score-log writes and both disposition writes through them. (Other ledger touchers are read-only.)
  `lib/json-store.ts`, `lib/data-store.ts`, `app/api/disposition/route.ts`.
- **CR-B — external-fetch timeouts.** `AbortSignal.timeout(20s)` on `icuFetch` (abort/network → typed
  `IntervalsApiError`), `timeout:240s` + `maxRetries:2` on the Anthropic client, `maxDuration=120` on
  `/api/sync`. New `intervals-api.test.ts`. `lib/intervals-api.ts`, `lib/anthropic-api.ts`.
- **CR-C — refuse a destructive empty sync.** `isSuspectEmptySync(prev, fresh)` (pure, tested): a sync
  with no activities AND no wellness when the prior had data returns 502 instead of overwriting
  `last-sync.json` + resetting baselines from `[]`. _Deferred → ROADMAP P8:_ persistent sub-step
  failures deserve real observability, not a recurring toast. `lib/intervals-api.ts`, `app/api/sync/route.ts`.
- **CR-D — same-origin API guard.** Next 16 `proxy.ts` (the renamed middleware) matching `/api/:path*`,
  backed by unit-tested `lib/csrf.ts` `isForbiddenCrossSiteWrite` (state-changing methods need a
  same-origin `Origin`; safe methods + non-browser clients exempt). Verified live: cross-site POST →
  403 before the handler, same-origin POST passes. Closes the drive-by `/api/import` hole. NEW `proxy.ts`, `lib/csrf.ts`.
- **CR-E — immutability contradictions fixed.** `deriveDecouplingGood` no longer auto-locks at n≥20 —
  it re-derives from the 90-day rolling mean every sync (input is already recency-windowed; a season of
  getting fitter must move the cutoff), confidence gate still guards noise, last-known-good kept across
  an empty window. `mergeScoreLog` comment now states the real contract (past frozen, today re-derived
  live). `lib/calibration.ts`, `lib/score-log.ts`.
- **CR-F — enforce the AI's nutrition numbers.** `validateNutrition` recomputes each day's daily-intake
  kcal from the same deterministic formula the reference table is built from, parses the figure the
  model wrote, flags a material deviation (generous tolerance). Wired into `/api/generate`. _Deferred →
  ROADMAP Track C:_ per-carb (pre/in/post) checks — shared free-text line makes which-number-is-which
  parsing ambiguous. NEW `lib/nutrition-validate.ts`.
- **CR-G — decompose the sync god-route + first mutating-route test (worktree).** Extracted the
  today-ride pure logic into `lib/ride-analysis.ts` (`computeRideMetrics`, `computeAdvisedIntake`,
  `buildTodayAnalysis`) and the ledger schema migration into `lib/sync-ledger.ts` (`backfillLedgerEntries`);
  the route now does I/O + calls the tested pure builders (~130 lines lighter). Added
  `app/api/disposition/route.test.ts` — first coverage for a mutating route (the CR-A transactional path).
  _Deferred → ROADMAP:_ full step-by-step pipeline split + component tests. NEW `lib/ride-analysis.ts`, `lib/sync-ledger.ts`.
- **CR-H — edge cases (H1 shipped, rest triaged).** `resolveAllTimeCurve` merges fresh + prior all-time
  taking max-per-duration so the all-time power curve stays monotonic on a missing/partial/regressed
  fetch (84-day curve only as a first-sync last resort) — PR detection can't false-drop. The other three
  (physiologyAsOf re-sort cost, dual weight-trend display, HR bpm-vs-%LTHR heuristic) triaged as
  not-a-bug / not-worth-the-risk, documented. `lib/intervals-api.ts`.

---

## Code-review hardening pass (CR-1..16)

A self-review of the §5/#1/#3/Track B work, worked as a gated pre-feature pass. All 16 items resolved.

- **CR-1 — durability intensity made visible.** `carriesEmbeddedIntensity` (`lib/prescription.ts`): a
  ride carrying ≥5 min of ≥88%-FTP work counts as hard. `validateSchedule` (now takes `ftp`) treats
  such a Z2 ride as a hard day for back-to-back spacing; `validateWorkoutProtocol` checks the embedded
  inserts against a threshold∪VO2 envelope (≤122%, ≤20 min). Budget stays type-based.
- **CR-2 — guarded the proactive apply.** `proactiveApplyBlock`: `PUT /api/morning-check` refuses
  unless today's stored check recommended `downgrade` and no ride is logged.
- **CR-3 — client-local dates.** `/api/ask` + `/api/morning-check` resolve the client date
  (`resolveToday`); `AskCoach` + `MorningCheckIn` send `localToday()`. UTC-boundary disagreement gone.
- **CR-4 — KB resilience + skeleton.** `knowledge-base-defaults/` (committed schema + cited §-anchors);
  `kb-loader.ts` reads local-else-default and never `readdir`-throws on a fresh clone.
- **CR-5 — one ACWR.** `/api/ask` uses calibrated `resolveAcwrBands(settings)` like Today/generation.
- **CR-6 — carry-forward is real.** A no-make-up-slot downgrade records the dropped session on
  `CurrentBlock.deferredQuality`; generation re-prioritises it. No longer silently lost.
- **CR-7 — negation-aware goal matching.** "avoid hills" / "no racing" stop forcing a RaceSim.
- **CR-8 — route/integration tests.** vitest `@/` alias + IO/LLM-mocked tests for morning-check
  (incl. the CR-2 guard), ask (snapshot assembly), generate (Track-B requirement + durability stamp).
- **CR-9 — one signal resolver.** `resolveCoachSignals` removes the snapshot-assembly duplication
  across `/api/ask` + `/api/generate`.
- **CR-10 — honest deload.** Recovery downgrade capped at `min(45, original)`; docs corrected (only the
  easy-day swap preserves load; the rest-day path is a deload).
- **CR-11 — calibration debt catalogued.** ROADMAP #2 now lists the recent population magic-numbers to
  fold in.
- **CR-12 — per-loading-week RaceSim** enforcement (≥2 quality + no RaceSim flags the week).
- **CR-13 — mild-illness nuance** (sickness always downgrades; mild only with strain/objective).
- **CR-14/15/16** — accepted as designed / deferred to §7 / monitor (rotation cadence, calendar
  mutation, ask-coach cost). See todo history.

Tests grew to 281 across 37 files over the pass.

---

## Re-review hardening pass (RR-1..12)

A senior-dev re-review of `63a9263` (the CR-9..16 batch) caught 12 items; all resolved over 6 atomic commits. Tests grew from 281 → 289.

- **RR-1 — honest deload on the proactive path.** `suggestProactiveReschedule` is now easy-only (`findMakeUpSlot(..., ["easy"])`). A rest day is never raided when the athlete is compromised; with no easy slot, today deloads to a capped Recovery spin and the quality carries forward (CR-6). `toWasRest` removed from the interface, route response, and `MorningCheckIn`. "Only the easy-day swap preserves load" is now true by construction.
- **RR-2 — missing reschedule tests added.** Cases for `min(45, original)` Recovery cap, swap-skips-rest-day, and honest-deload-instead-of-raiding-rest.
- **RR-3 — loading-week detection is theme-aware.** `isLoadingWeek` = ≥2 quality AND `weekTheme` not recovery/deload/unload/taper. A recovery week that keeps 2 quality sessions is no longer flagged as needing a RaceSim.
- **RR-4 — negation is clause-scoped.** Replaced the 15-char back-scan in `tagPresent` with `clauseStart()`, which walks back only to the nearest clause break (punctuation, dashes, `but`/`however`/`yet`). A negation now flips a tag only within its own clause — `"no gym, hilly race"` correctly requires a RaceSim.
- **RR-5 — band resolution lives once.** `resolveCoachSignals` now takes the raw `acwrBands` override and calls `resolveAcwrBands` internally; both routes drop the duplicated call + calibration import.
- **RR-6 — `CoachSnapshotInput extends CoachSignals`.** The six form/fuel/state signal fields are inherited; the compiler now enforces what was a comment-only contract.
- **RR-7 — named ACWR band type.** Opaque `Parameters<typeof computeAcwr>[1]` replaced with `Partial<AcwrBands> | null`.
- **RR-8 — consolidated validator warnings.** One GOAL warning names all offending loading weeks (`"weeks 1, 3 …"`) instead of one per week. Bounded fan-out.
- **RR-9 — validator branch coverage.** Tests for multi-week consolidation, recovery-week exclusion, and the `!anyRaceSim && !flaggedAWeek` block-floor fallback.
- **RR-10 — `proceed-easy` intensity cap (neck-check rule).** Mild illness on fresh legs now produces a third decision state. `applyEasyCap` converts today's quality session to a same-duration Z2 ride (structured intervals dropped) in place — no relocation or deferral. `MorningCheckDecision` type, route, and `MorningCheckIn` all handle the new state.
- **RR-11 — `strainScore` input clamping.** Route is the real validation boundary (400 on non-1–5 ratings); `strainScore` also clamps each input so its 4–20 range holds for any direct caller.
- **RR-12 — week-sort cleanup.** `validateSessionRequirements` sorts the small offending-week array rather than the Map entries; no week-numbering assumptions.

- **RR-1 follow-up — explain the skipped rest day.** When the proactive path deloads because the only free slot is a rest day, `suggestProactiveReschedule` now returns `skippedRestDay` (the clear rest day it deliberately didn't raid). The morning-check preview and the apply note name it ("there's a rest day on X, but moving a hard session there would add load while you're compromised…") instead of implying nothing was available.

---

## Coaching depth — CoachSnapshot, proactive reschedule, session variety

A run of ROADMAP "Next up" + Track B items. Remaining slivers for each stay in [ROADMAP.md](ROADMAP.md).

### CoachSnapshot — resolved-numbers lens (ROADMAP #1)
- `lib/coach-snapshot.ts`: one deterministic snapshot (today execution · form + TSB-as-actionable-
  modifier · fuel · fused state · directives · disposition · morning check) read by Ask-Coach
  (`/api/ask`, fully wired) and generation (`/api/generate`, compact form+fuel line) so the LLM is
  handed resolved numbers instead of inventing them. `buildCoachSnapshot` + `formatCoachSnapshot` +
  `formatFormFuelLine` + `resolveTsbModifier`; the compromised-disposition guard rides in the snapshot.
- **Surfaced on Today (the remaining sliver).** `buildCoachSnapshotFromSources` is now the one shared
  assembler (model → signals → directives → snapshot) the sync GET and `/api/ask` both call, so the
  Today card shows the *identical* snapshot the LLM reads — `/api/ask`'s parallel assembly was removed.
  `coachSnapshot` rides on `AppState` (GET takes `?today=` for the client-local date; POST rebuilds it
  on fresh data so the card updates after a sync), and `components/CoachSnapshotCard.tsx` renders the
  resolved form (TSB-as-actionable-modifier) + fuel in the Today readiness zone, hiding when empty.

### Proactive reschedule — "not feeling it?" morning check-in (ROADMAP #3)
- `lib/morning-check.ts` + `app/api/morning-check` + `components/MorningCheckIn.tsx`: a pre-session
  check (fatigue/sleep/soreness/motivation + illness) → deterministic proceed/downgrade
  (`decideMorningCheck`: subjective strain + objective TSB/readiness/ACWR). Applying it downgrades today
  and moves the quality stimulus to the next rest day (a deload) — else a load-preserving swap with the
  next easy day (`suggestProactiveReschedule` / `applyProactiveReschedule` in `lib/reschedule.ts`). Stored in
  `morning-check.json`; feeds the CoachSnapshot. Also shipped the §3 "wider target slots" sliver.

### Session selection & prescription variety (Track B)
- **Goal-driven selection** — `lib/session-requirements.ts`: terrain/race goal tags → a RaceSim
  requirement injected into the prompt and enforced by `validateSessionRequirements` (warns if the block
  ships none); RaceSim already counts toward the quality budget + spacing.
- **Durability taxonomy** — KB §12 + `lib/durability.ts`: 5 rotating templates (A–E),
  `selectDurabilityTemplate` limiter-driven (Threshold→B, VO2max→C, SIT→D, systemic fatigue→A) else
  rotated; the long ride stays TYPE Z2 with intensity inside the duration. The chosen template is
  stamped on the block (`durabilityTemplate` through generate→write→history) for rotation + scoring.

### Structural debt paydown
- Split `components/Dashboard.tsx` (1453→516 LOC) into `components/dashboard/{shared,today,plan}.tsx`;
  cleared all 11 ESLint problems; deleted the legacy `parsePlan` regex text-parser fallback (structured
  tool-use is now the sole generation path) — `plan-parser.ts` keeps only `planDayToEvent`.

---

## Trends & Today card polish (TR batch)

From a real-use feedback pass on the Trends and Today pages.
- **TR-1 — Weekly-volume card compacted.** The Trends "Weekly volume" card is now half-width
  (paired in a `lg:grid-cols-2`, right column intentionally empty) to match the "Execution quality"
  card instead of spreading full-width. `components/Trends.tsx`
- **TR-2 — Weekly-volume colour-by-magnitude.** Bars are shaded across four blues relative to the
  window max (darker = bigger week), so volume reads by hue as well as height. `components/Trends.tsx`
- **TR-3 — Card ⓘ hovers.** `Card` gained a reusable `tip` prop rendering a `MetricTip` ⓘ next to
  the title; applied to the Weekly-volume + Execution-quality cards. `MetricTip` promoted from
  `components/dashboard/shared.tsx` to `components/ui.tsx` as a generic primitive. (Slice of ROADMAP
  "Popups where needed".)
- **TR-4 — Today metric strip.** Split the combined "NP / Avg" tile into distinct **NP** and **Avg
  power** tiles, kept **Avg speed**, and gave **IF** context (effort-band sublabel + ⓘ hover
  explaining NP÷FTP). Verified the tiles are correctly wired from sync (`app/api/sync/route.ts`) —
  a missing value means absent Intervals data, not a bug. `components/dashboard/today.tsx`

## Feedback sweep — all items cleared

A full pass over a feedback dump (bugs + UX + features), worked P1 → P3.

### Data integrity & interval detection
- **DI-1 — plan-vs-detection mismatch guard.** `matchPrescription` flags `structuralMismatch`
  (every rep ~half its prescribed length yet power nailed + rep count matched = a plan-definition
  vs detection mismatch, not a bail). Scoring drops the untrustworthy duration penalty; the coach
  note + Today card explain it. `lib/interval-match.ts`
- **DI-2 — interval power mis-read.** Adherence now reads `avgWatts` (what was actually held), not
  NP (which overstates short/variable efforts by 20%+). NP is kept only to filter warm-up/recovery
  laps out of the work band. `lib/interval-match.ts`
- **DI-3 — mid-ride added intervals.** Executed work efforts beyond the prescribed count are
  captured as `extras` and shown as dashed "+extra" chips instead of being silently dropped.
- **DI-4 / PW-10 — power-PR recognition.** New PRs surfaced to the coach note (called out first)
  and as a 🏆 trophy banner on Today with the gain over the prior best. `lib/pr.ts`

### Workout protocol & vocabulary
- **PW-2 — SIT consistency.** SIT progress marker moved from 1-min to 30-sec power to match the
  30s all-out protocol; all surfaces (KB, validator, prompt, Ask-Coach, marker) now agree.
- **PW-7 / PW-8 — KB-grounded protocols.** `lib/workout-validate.ts` flags generated workouts that
  violate KB interval protocols (SIT 4–6×20–30s @ 130–200%, VO2max 3–8min @ 106–120%, threshold
  88–105%); the same rules are stated in the generation prompt — guard on both ends.
- **PW-1 — standing-sprint technique.** KB distinguishes seated SIT (aerobic, consistent power)
  from standing sprints (neuromuscular/race skill) + technique cues; generation coaches standing
  only on dedicated sprint/RaceSim work.
- **PW-3 — RaceSim as a real workout type.** Added `RaceSim` to `WorkoutType` (+ styles, nutrition
  factor, execution band, reschedule quality list, generation TYPE list, KB protocol): variable
  race-moves, peaking/event-window use, scored on intensity not rep-match.
- **PW-9 — terrain-flexible sessions.** KB + generation rule to prescribe structured-but-flexible
  outdoor quality (target efforts as ranges + a placement rule + strict-Z2/HR-cap floor), scored
  on intrinsic quality. Keep one fixed ERG benchmark per week.
- **PW-4 / PW-5 — execution cues in descriptions.** Optional `Execution:` line in the DESCRIPTION
  format + KB-grounded cues (HR-ceiling on hilly Z2, sit-down sprints, descents as cornering
  practice). `lib/anthropic-api.ts`

### Coaching context
- **PW-6 — Ask-Coach sees the next session.** The coach now gets the nearest upcoming session's
  exact prescription ("do not invent durations") — kills the "4-min for a 30s SIT day"
  hallucination. `app/api/ask/route.ts`, `lib/anthropic-api.ts`
- **#9 — all-time power PRs.** `fetchPowerCurveAllTime()` pulls Intervals.icu's `curves=all` into
  `SyncData.powerCurveAllTime`; the Profile shows all-time bests and PR detection uses the all-time
  curve as a monotonic baseline (no window false-drops, true all-time deltas), with an 84-day
  fallback. `lib/intervals-api.ts`, `lib/pr.ts`
- **NUT-6 — nutrition formula audit (pass).** Verified: weight is live-synced, the buffer is
  weight-trend-adaptive + clamped (0–600) and skipped on rest days, carbs scale by mass (glycogen)
  while protein is flat (MPS saturates). Sound; the real enhancement (energy-availability signal)
  is ROADMAP §6.

### Today / Plan / Trends UX
- **TODAY-1 — ride-card de-dup.** Merged NP + Avg into one tile and dropped TSS (identical to
  Intervals' "Load"); 6 → 4 metric tiles.
- **TODAY-6 / TODAY-8 — ACWR & TSB tooltips.** What they are, calc basis, good/concerning bands.
- **TODAY-7 — session-state fix.** The calendar showed *compromised* rides as "Missed" (they're
  excluded from `scores`). Threaded `compromisedDates`/`partialDates` through sync → state →
  calendar; compromised now reads "Compromised — ridden, excluded from scoring", partial reads
  "Partial". `missed` confirmed correctly auto-derived.
- **TODAY-2 / TODAY-3 / TODAY-5** — power-zone bar labels → hover tooltip; Trend-Pulse per-week
  hover + "this wk" label; ride-card energy unit kJ → kcal.
- **PLAN-3** — audited; "This week" Hours/TSS aren't duplicated on the Plan page itself, left as-is.
- **TRENDS-1** — Pw:HR excludes indoor rides (distorted power:HR); ≥45-min + endurance-band +
  Intervals' efficiency-factor method. `lib/trends.ts`
- **TRENDS-2** — fueling/weight graph shows complete weeks only (drops the partial current week).
- **TRENDS-3** — replaced trivial 7-day avg RPE with an actionable 7-day training-load total.
- **UI-5 — ride-card power trace.** 30s rolling-mean smoothing tames the jumpy line; short
  work-interval bands get a minimum width + stronger fill so 30s reps are visible; band-alignment
  fixed (bands sit exactly under the line). `lib/trace.ts`, `components/RideTrace.tsx`

---

## Platform & performance (P-series)

The local-first cost / robustness / observability hardening, in order. Forward items live under
ROADMAP "Platform & performance"; P4 is partially done (1 of 4 items shipped).

- **P1 — Prompt caching + singleton Anthropic client.** One lazily-constructed `Anthropic`
  client reused across all calls (was `new Anthropic()` per call ×4) for connection pooling.
  Generation's system prompt is split into a cached prefix (persona + workout-syntax guide +
  reference KB, marked `cache_control: ephemeral`) and a dynamic tail (carry-forward seeds +
  directives + athlete data + block params), so a repeat generation within the cache TTL re-reads
  the bulk at ~0.1× input cost. A test locks the invariant that per-block dynamic content never
  leaks into the cached prefix (which would defeat the cache). `lib/anthropic-api.ts`,
  `app/api/generate/route.ts`.
- **P2 — Structured generation via tool-use.** Generation no longer regex-parses Claude's
  markdown — it forces a `submit_training_block` tool whose `input_schema` is derived (via
  `z.toJSONSchema`) from one shared zod schema (`lib/plan-schema.ts`), which also validates the
  response. The route maps the typed output → `PlannedDay[]` and falls back to the regex parser
  (`plan-parser.ts`, retained) only if the tool payload is absent/malformed. `workout-validate`
  stays as the coaching-validity guard (tool-use is only *schema*-valid). Added `zod` v4. New
  schema/mapping tests. `lib/plan-schema.ts`, `lib/anthropic-api.ts`, `app/api/generate/route.ts`.
- **P3 — Decoupled sync + surfaced warnings.** `/api/sync` now returns fast with the
  deterministic analysis (metrics, zones, intervals, PRs, execution score) and defers only the slow
  LLM coach note to a follow-up `/api/analyze` (extracted `lib/sync-analysis.ts addCoachNote`,
  idempotent — preserves a note across re-syncs, auto-posts once). PR detection stays in the fast
  path (it needs the pre-sync curve). Non-fatal step failures (intervention validation, ride
  analysis, coach note) now collect into a `warnings[]` array surfaced in the nav rail instead of
  being swallowed by best-effort catches; the Today card shows "Analysing today's ride…" while the
  note lands. `app/api/sync/route.ts`, `app/api/analyze/route.ts`, `lib/sync-analysis.ts`,
  `components/SyncProvider.tsx`, `components/Nav.tsx`, `components/Dashboard.tsx`.
- **P4 (item 4 of 4 — section COMPLETE) — Generation dedupe.** Decision: a **short dedupe-only
  window**, not a long reuse cache (generation runs at temperature 0.3, so a considered regenerate is
  partly *for* the variation). `lib/generate-cache.ts dedupeGeneration(key, compute)` keys on a sha256
  of the three assembled prompt parts and runs `compute` at most once per key while it's in flight +
  ~60 s after it completes — so a double-click or a second request landing mid-generation shares the
  one Claude call, a failure evicts immediately so retries re-run, and a deliberate regenerate
  outside the window re-calls. In-memory + single-process (same assumption as the singleton client; a
  restart just forgets the window). Wired into `app/api/generate/route.ts`. 6 new tests
  (in-flight dedupe, per-key, failure-evict, fake-timer window expiry). `lib/generate-cache.ts`.
- **P4 (item 3 of 4) — Stream `/api/ask`.** `streamAskCoach` (async generator) yields Anthropic text
  deltas as they arrive and records usage from the final message; `/api/ask` wraps it in a plain-text
  `ReadableStream` (validation still returns JSON errors *before* the 200 stream; a mid-stream failure
  surfaces as the stream erroring); `AskCoach` reads `res.body` incrementally and renders the reply as
  it streams ("thinking…" only until the first token). `lib/anthropic-api.ts`, `app/api/ask/route.ts`,
  `components/AskCoach.tsx`. Type-checked + build-verified; live token path needs a real Anthropic key
  to exercise. _P4 now has only generation caching left — blocked on the regenerate-vs-cache product
  question (ROADMAP)._
- **P4 (item 2 of 4) — Coach-accuracy % on the dashboard.** `overallCoachAccuracy(log)` rolls the
  intervention validation loop into one headline hit-rate (validated / decisive across all
  dimensions; null until the 28-day horizon produces a decisive outcome). Computed in the `/api/sync`
  GET handler, carried on `AppState.coachAccuracy`, surfaced as a compact line in the Today
  Trend-pulse zone — hidden entirely until there's a decisive % *or* pending interventions, so it
  never shows an empty tile on a fresh install. `lib/intervention.ts`, `app/api/sync/route.ts`,
  `components/SyncProvider.tsx`, `components/Dashboard.tsx`. 2 new tests.
- **P4 (item 1 of 4) — Token/cost tracker.** `lib/ai-usage.ts` folds every Anthropic call's
  `usage` into `data/ai-usage.json` (best-effort, fire-and-forget — never blocks the request; a
  serialized read-modify-write chain prevents lost increments under concurrency). Cost is estimated
  from a per-model price table (sonnet-4-6 $3/$15, haiku-4-5 $1/$5 per 1M) with the cache-write
  premium (1.25×) and cache-read discount (0.1×) applied to the input rate. `recordUsage` wired into
  all four call sites (generate, ride analysis, retrospective, ask-coach); `AiUsageCard` shows total
  + per-model spend on the (now dynamic) Settings page. Pure `estimateCostUsd` unit-tested.
  `lib/ai-usage.ts`, `lib/anthropic-api.ts`, `components/AiUsageCard.tsx`, `app/settings/page.tsx`.
  (P4 is now complete — items 2/3/4 above.)
- **P5 — Deterministic schedule validator.** Generation was *instructed* to space quality
  sessions ("avoid back-to-back hard days") and cap them at the weekly budget, but nothing enforced
  placement — `workout-validate.ts` checks each session's protocol bands in isolation. New
  `lib/schedule-validate.ts validateSchedule(days, settings)` does a post-generation pass over the
  block's day sequence and flags (a) two hard/quality days on consecutive calendar dates (by date
  adjacency, so it spans the week boundary and never false-pairs across a gap) and (b) any week over
  the `qualitySessionsPerLoadingWeek` budget. Quality set = Threshold/VO2max/SIT/**RaceSim** (RaceSim
  counts toward the budget + spacing). Folded into the generate route's `warnings[]` next to the
  protocol checks — warns only, never reorders. 11 new tests. `lib/schedule-validate.ts`,
  `app/api/generate/route.ts`.
- **P6 — Reliability & resilience quick-wins.** Five independent hardening wins:
  - **Error boundaries** — `app/error.tsx` (route-segment fallback; the nav rail above it stays
    mounted) + `app/global-error.tsx` (root-shell fallback). Use Next 16's `unstable_retry` prop
    (not `reset` — verified against `node_modules/next/dist/docs`).
  - **Provenance stamping** — `PROMPT_VERSION` constant + `model`/`promptVersion` (optional) on
    `GeneratedPlan`, `TodayAnalysis`, `BlockHistoryEntry`, `CurrentBlock`, stamped at generation /
    coach-note time and carried through block archive → history; makes past AI outputs auditable
    when the model or prompt later changes. `lib/anthropic-api.ts`, `lib/types.ts`, generate/write/
    retrospective routes, `lib/sync-analysis.ts`.
  - **Export / import backup** — `GET /api/export` bundles `data/*.json` + `knowledge-base/**/*.md`
    into one downloadable JSON (no zip dep); `POST /api/import` restores it, guarded (must self-id as
    a NodeVelo backup, path-traversal-confined, data files go through `writeJsonFile` so critical
    stores keep their pre-import `.bak`). Settings "Backup & restore" card. `components/BackupRestore.tsx`.
  - **json-store per-file write mutex** — concurrent writes to the same store chain one-at-a-time
    (last-write-wins) so a sync + disposition POST can't clobber the shared temp file; different
    files stay parallel. Data dir made env-overridable (`NODEVELO_DATA_DIR`) for test isolation.
    `lib/json-store.ts` + new mutex/round-trip tests.
  - **Manual re-analyse** — `addCoachNote(today, warnings, force)` regenerates today's coach note on
    demand (force bypasses the idempotency guard); `/api/analyze` reads `force`; `SyncProvider`
    exposes `reAnalyse`; the Today coach-note card shows a re-analyse / "generate note" button so an
    Anthropic hiccup is recoverable without a full re-sync. The sync route already preserves a good
    note + its stamp across a re-sync (never overwrites with empty).

- **P7 — TanStack Query data layer.** Replaced the hand-rolled cache (`SyncProvider`'s
  fetch-on-mount `useEffect` + a separate `useEffect` fetch in Trends) with `@tanstack/react-query`
  v5. New `QueryProvider` (one `QueryClient`, `staleTime` 30 s, `refetchOnWindowFocus` +
  `refetchOnReconnect` + retry) wraps the app above `SyncProvider`. The `['sync']` GET is now a
  `useQuery`; Trends uses `useQuery(['trends', syncedAt])` (re-fetches when a sync completes, plus
  focus/reconnect/dedup/retry). Crucially the **`useSync()` context API is unchanged** — `state`
  comes from the query, and `setState` writes through to the query cache via `setQueryData`, so
  every existing `setState(...)` call in `doSync`/`runAnalysis`/`RescheduleBanner` keeps working and
  Nav/Dashboard/RescheduleBanner needed no changes. `doSync` (the POST that hits Intervals.icu) and
  the deferred `/api/analyze` step stay explicit actions that write results back into the cache.
  Fixes the "stale after an overnight tab" UX. Verified: tsc/build/lint clean, 211 tests, dev server
  boots and Today/Trends render with the new provider wiring. `components/QueryProvider.tsx`,
  `components/SyncProvider.tsx`, `components/Trends.tsx`, `app/layout.tsx`, `package.json`
  (`@tanstack/react-query`). _Deferred:_ `doSync`→`useMutation` + optimistic updates (not needed for
  the win).

## Signal fusion — Athlete State v1 (ROADMAP §5)

- **`computeAthleteState` (the fused glance).** `lib/athlete-state.ts` collapses the parallel signals
  the brain otherwise surfaces (and lets contradict) — TSB, ACWR, execution-trend (EWMA), decoupling
  vs the 90d baseline, RPE recent-vs-baseline, off-plan behaviour — into one **0–100 score** + band
  (`primed/ready/steady/strained/depleted`) + recommendation + `drivers[]` + confidence. Built as a
  **list of signal evaluators** (add energy-availability later = one evaluator); score = base + Σ
  effects, clamped, then a **lived-signal override** (≥2 of execution-down / decoupling-up / RPE-up
  cap the score even when TSB looks fresh — corroborated fatigue beats a fresh load model). All
  weights/thresholds are named constants in one block (foundations — built to be tuned). Deterministic;
  the AI only phrases the headline. 8 directional tests (not pinned to exact numbers). Design spec:
  `docs/specs/athlete-state.md`.
- **Surfaced + consumed (all three).** `AthleteStateCard` on Today — the 0–100 score is the glance,
  band + drivers reveal on hover (above the individual signals, not replacing them). Computed in the
  `/api/sync` GET **and** POST (so it refreshes after a sync), carried on `AppState.athleteState`.
  Folded into **generation** (a fused-state directive line) and **Ask-Coach** (context), both via the
  pure `athleteStateInputsFrom` adapter. `lib/athlete-state.ts`, `app/api/sync/route.ts`,
  `app/api/generate/route.ts`, `app/api/ask/route.ts`, `lib/anthropic-api.ts`,
  `components/AthleteStateCard.tsx`, `components/SyncProvider.tsx`, `components/Dashboard.tsx`,
  `lib/types.ts`. (v1 foundations; tuning + energy-availability + per-athlete weights remain — ROADMAP §5.)

## Metric-consistency + Today/Trends UX (feedback batch)

A batch of real-use feedback, routed through todo.md (MR/UX/RC) and cleared:
- **MR-1 — IF basis consistency.** The coach-note prompt (`analyseRide`) computed IF from *avg*
  watts while the Today card + `score-log` use NP (`normalizedPower ?? avgWatts`). Made the note
  NP-based too (and ftp>0-guarded), so the note's IF can't disagree with the card; fixed the stale
  `// avg watts / FTP` comment on `TodayAnalysis.intensityFactor`. (NP was already synced from
  `icu_normalized_power`.) `lib/anthropic-api.ts`, `lib/types.ts`.
- **MR-2 — Weekly-hours window.** Recent-Baselines "Weekly hours" was an all-logged-window mean
  while its sibling tiles are 90-day rolling. Added `avgWeeklyHours90d` to `RollingBaselines`
  (computed in `computeRollingBaselines` as total hours ÷ 90/7 over the same 90d window); the card
  now reads it, so all four tiles share one horizon. Populates on the next sync. `lib/readiness.ts`,
  `lib/types.ts`, `lib/data-store.ts`, `components/Trends.tsx`.
- **RC-1 — Avg speed on the Today ride card.** Threaded `activityDistanceMeters` onto `TodayAnalysis`
  (sync route) and added an "Avg speed" tile (distance ÷ moving time). Populates on the next sync.
  `lib/types.ts`, `app/api/sync/route.ts`, `components/Dashboard.tsx`.
- **UX-1 — Power bar horizontal overflow.** `ZoneBars` segments had `shrink-0` + `gap-px`, so widths
  summed past 100% and the bar overflowed on narrow cards. Switched to `min-w-0` (let flex absorb the
  gap). `components/Dashboard.tsx`.
- **UX-2 — Trend-pulse "Weekly volume" tile dead-end.** The tile pushed to /trends, which had no
  weekly-volume view. Added a "Weekly volume" card (`WeeklyVolumeBars` over the existing
  `data.weeklyHours`) so the click lands somewhere. `components/Trends.tsx`.
- **UX-3 — Execution-quality card compression + hover.** `ScoreBars` (capped at 24) used
  `min-w-[4px]` + `gap-[3px]` (~165px min → overflowed narrow cards); reduced to `min-w-[2px]` +
  `gap-px` (~71px) and added a `hover:opacity` affordance on top of the existing per-bar title.
  `components/Trends.tsx`.

## Foundations & earlier milestones

- **Timezone-correct "today" (code-audit fix).** The server matched today's ride on a UTC date
  while activities carry their *local* date, so an evening ride could be missed entirely (no
  analysis/PR). `lib/date.ts` now makes the client's local date the single source of "today"
  (client sends it; server prefers it, UTC fallback). No date-fns dep.
- **Disposition flag + learning gate.** Athlete marks Completed / Partial / Compromised(reason);
  compromised rides stay as history but are excluded from the execution EWMA + metric and surfaced
  to Ask-Coach, so a fluke can't be misread as under-recovery. `data/dispositions.json`
- **Auto-reschedule engine.** `lib/reschedule.ts` + `/api/reschedule` + RescheduleBanner detects a
  not-delivered quality session and suggests/applies a make-up on the next clear rest day in the
  local block (no back-to-back hard days), athlete-confirmed.
- **UI refinements (audit images 1–5).** Readiness card trimmed to TSB/ACWR/Polarization; Trend
  Pulse reworked to CTL + weekly-volume + time-in-zone bars; Trends compacted to a 2-col pair;
  Profile modernized to match the other pages.
- **Calibration v1.** Auto-tuned EWMA α + ACWR bands with a manual override (`lib/calibration.ts`).
- **Synthesis.** One ranked coaching-directive block fed to generation; dropped redundant
  `compliance-memory`.
- **Closed learning loop.** All rides scored into the immutable ledger; interventions snapshotted
  at block-write and later validated/refuted.
- **Atomic writes + ledger backup/recovery** (`lib/json-store.ts`).
- **Compliance unified** into the execution/completion index; duration-aware interval scoring;
  time-in-zone polarization; physiology single-source-of-truth; Ask-Coach (block + form context).
