# Nodevelo roadmap

A living backlog of unfinished / deferred work, so it's never lost between sessions. Ordered
roughly by leverage. The main goal everything is measured against: **be a coaching *layer* that
fuses signals into one coherent, self-correcting athlete model — not a re-skin of Intervals.icu.**

---

## Next up (prioritized)

### 1. Per-athlete execution-score bands  ⭐ (the remaining calibration frontier)
The execution score (`lib/execution-score.ts`) still uses **population magic numbers**:
- Per-type intensity-appropriateness IF bands (e.g. Z2 rewards IF 0.60–0.74, Threshold 0.82–0.92).
- Decoupling bands (`< 2%` great … `> 10%` poor).
- The ± weightings.

Make them personal, reusing the existing `lib/calibration.ts` (the hybrid auto + manual pattern
already used for α and ACWR):
- **IF bands → derive from `physiology.json` power zones.** The athlete's actual %FTP zone
  boundaries *are* their personal IF cutoffs (Z2 ride should sit in their Z2 zone, etc.), so
  feed resolved zone edges into the intensity-vs-type branch instead of hardcoded ranges.
- **Decoupling "good" threshold → from the personal baseline** (`rolling-baselines.avgDecoupling90d`)
  rather than a fixed 4%.
- Extend `AthleteCalibration` with `decouplingGood` + per-type IF bands; thread into
  `computeExecutionScore` (currently pure with hardcoded bands).
- **Caution:** touches the frozen scoring core. The immutable ledger means changes only affect
  *new* entries (good). Needs careful tests + a manual-override hook like ACWR. Hybrid: auto-derive
  with population fallback + min-sample floors.

### 2. Let the validation loop accrue, then auto-down-weight
`intervention-log.json` records each block's driving insights and verdicts after a 28-day horizon,
but has **no verdicts yet** — needs real blocks over ~4 weeks. Once data exists:
- Auto-**down-weight refuted dimensions** in `lib/synthesis.ts` (currently it only annotates with
  hit-rate; make a low hit-rate actually demote/soften that directive).
- Revisit ~4 weeks after the next block is written.

### 3. Signal fusion → one coherent athlete state  ⭐ (biggest gap to a "true" second brain)
Today the brain *surfaces* parallel signals (execution, behaviour, validation, readiness, RPE).
It doesn't *fuse* them. e.g. RPE-high + execution-down + decoupling-up should collapse into one
"systemic fatigue → recover" conclusion, not three separate lines. Design a single
`athleteState` synthesis that reasons across objective + subjective + validated history before
generation/readiness, rather than emitting separate heuristics. This is the heart of the goal.

### 4. UI progressive disclosure
Today's right column (trend pulse + coach note + ask-coach) and Trends (~8 cards) are getting
dense — against the "show only what earns its space" mandate. Make secondary widgets
disclosable (ask-coach behind a tap, collapsible Trends cards) to restore glance-value.

---

## Larger / scoped features (when wanted)

### 5. Expanded fueling engine (2D)
Deterministic fluid + sodium + carb-gram prescriptions pre/intra/post, scaled by target IF and
duration (extends `lib/nutrition.ts`). Note: the digestive-feedback tuning loop is **gone** (the
post-ride survey was removed — see below), so this would be IF/duration-driven only unless RPE is
used as a proxy.

### 6. Calendar drag-drop + bidirectional Intervals.icu sync (2C)
Drag/swap planned workouts; mutate the Intervals.icu calendar upstream + poll for external date
shifts. **Large + API-risk:** the Intervals client only has `createEvent` today — needs new
move/update/delete event methods, verification that the Intervals API supports event mutation,
and a polling hook. Scope as its own session.

---

## Done recently (context)
- Atomic writes + ledger backup/recovery (`lib/json-store.ts`).
- Synthesis: one coaching-directive block; dropped redundant `compliance-memory`.
- Calibration v1: auto-α + ACWR bands (manual override).
- Closed the learning loop: score all rides + intervention validation.
- Compliance unified into the execution/completion index.
- Duration-aware interval scoring; time-in-zone polarization; physiology single-source-of-truth.

## Decided against (don't re-propose without a real reason)
- **RxDB / better-sqlite3 reactive-DB rewrite** — contradicts the deliberate local-first JSON
  design; the desync it targeted is already fixed with refetch-on-sync.
- **Cytoscape / Obsidian-style knowledge graph** — heavyweight dep that re-presents existing
  data; against the zero-bloat mandate.
- **Post-ride structured survey** — RPE/feel already sync from Intervals.icu (`icu_rpe`); it
  duplicated upstream data.
