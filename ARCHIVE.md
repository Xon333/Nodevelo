# NodeVelo — archive (completed work)

A record of shipped work, kept out of the lean live trackers so they stay readable.

- **Live punch-list** (incoming bugs / feedback): [todo.md](todo.md)
- **Forward backlog** (what's next): [ROADMAP.md](ROADMAP.md)
- **Research spikes** (not committed): [research.md](research.md)
- **This file**: everything already done.

Entries are grouped by theme. Most reference the module(s) touched; see git history for the
exact commits.

---

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

## Foundations & earlier milestones

- **Decoupled sync + surfaced warnings (ROADMAP P3).** `/api/sync` now returns fast with the
  deterministic analysis (metrics, zones, intervals, PRs, execution score) and defers only the slow
  LLM coach note to a follow-up `/api/analyze` (extracted `lib/sync-analysis.ts addCoachNote`,
  idempotent — preserves a note across re-syncs, auto-posts once). PR detection stays in the fast
  path (it needs the pre-sync curve). Non-fatal step failures (intervention validation, ride
  analysis, coach note) now collect into a `warnings[]` array surfaced in the nav rail instead of
  being swallowed by best-effort catches; the Today card shows "Analysing today's ride…" while the
  note lands. `app/api/sync/route.ts`, `app/api/analyze/route.ts`, `lib/sync-analysis.ts`,
  `components/SyncProvider.tsx`, `components/Nav.tsx`, `components/Dashboard.tsx`.
- **Structured generation via tool-use (ROADMAP P2).** Generation no longer regex-parses Claude's
  markdown — it forces a `submit_training_block` tool whose `input_schema` is derived (via
  `z.toJSONSchema`) from one shared zod schema (`lib/plan-schema.ts`), which also validates the
  response. The route maps the typed output → `PlannedDay[]` and falls back to the regex parser
  (`plan-parser.ts`, retained) only if the tool payload is absent/malformed. `workout-validate`
  stays as the coaching-validity guard (tool-use is only *schema*-valid). Added `zod` v4. New
  schema/mapping tests. `lib/plan-schema.ts`, `lib/anthropic-api.ts`, `app/api/generate/route.ts`.
- **Prompt caching + singleton Anthropic client (ROADMAP P1).** One lazily-constructed `Anthropic`
  client reused across all calls (was `new Anthropic()` per call ×4) for connection pooling.
  Generation's system prompt is split into a cached prefix (persona + workout-syntax guide +
  reference KB, marked `cache_control: ephemeral`) and a dynamic tail (carry-forward seeds +
  directives + athlete data + block params), so a repeat generation within the cache TTL re-reads
  the bulk at ~0.1× input cost. A test locks the invariant that per-block dynamic content never
  leaks into the cached prefix (which would defeat the cache). `lib/anthropic-api.ts`,
  `app/api/generate/route.ts`.
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
