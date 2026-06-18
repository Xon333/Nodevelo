# NodeVelo — Feedback TODO

Actionable tracker for the feedback dump. Strategic/forward backlog stays in [ROADMAP.md](ROADMAP.md); this file is the live punch-list. Overlaps are cross-referenced (→ ROADMAP §x).

**Status:** ☐ todo · ◑ partial · ☑ done
**Priority:** P1 correctness/data-integrity · P2 high-value UX/feature · P3 polish/education
**Type:** `bug` `ux` `feat` `audit` `edu`

---

## ☑ Done
| ID | Item |
|----|------|
| TODAY-2 | Power-zone bar: removed % text labels, hover tooltip shows `Z· %` (39fbdf7) |
| TODAY-3 | Trend Pulse volume: per-week hover (`Week of … : h`); removed misleading down-arrow → "this wk" (39fbdf7) |
| TODAY-5 | Energy unit kJ → kcal on ride card (39fbdf7; audit other surfaces still open) |
| PW-7 | SIT duration: `lib/workout-validate.ts` flags efforts >45s against KB §4 (4–6×30s); wired into generate-route warnings |
| PW-8 | KB intensity enforced two ways: workout-validate %FTP bands + generation prompt rule (SIT all-out 130–200%, VO2max 106–120%, threshold 88–105%) |
| DI-1 | Matcher now flags `structuralMismatch` (plan rep-def ≠ ridden, power nailed) → scoring drops the bad duration penalty, coach note + Today-card caption explain it; bail vs mismatch separated by power. `lib/interval-match.ts` |
| DI-2 | Interval power mis-read (540W vs 445W): split `filterPower` (NP-first, for work-band filtering) from `adherePower` (avgWatts-first, for adherence calc) in `lib/interval-match.ts` — NP overstates adherence on short/variable efforts |
| PW-6 | Ask-Coach now sees the next planned session (`upcoming` in `AskCoachContext`): route finds the nearest future day with a prescription; prompt surfaces its exact reps + "do not invent durations" — kills the "4m for a 30s SIT day" hallucination |
| PW-2 | SIT consistency: `physMarkerFor` tracked SIT progress via 1-min power; now 30-sec power to match the 30s all-out protocol (KB §4). All surfaces (KB, validator, prompt, Ask-Coach, marker) now agree on 30s. `lib/intervention.ts` |
| TODAY-6 | ACWR tooltip completed: added the <0.8 detraining band to the existing what/why/safe-band/spike explanation (`components/Dashboard.tsx`) |
| TODAY-8 | TSB (Form) tooltip added: definition (CTL−ATL), calc basis, and readiness bands (−10/−30 overload, ~0 balanced, +5/+25 race-fresh). `components/Dashboard.tsx` |
| TODAY-1 | Ride-card de-dup: merged NP + Avg power into one "NP / Avg" tile and dropped TSS (identical to Intervals' "Load"; execution score is the app's load-completion read). 6 → 4 metric tiles. `components/Dashboard.tsx` |
| PLAN-3 | Audited — "This week" card Hours/TSS are NOT duplicated on the Plan page itself (Trend Pulse lives on Today, not Plan), so removing Hours would strip the page's only weekly-hours number. Left as-is. |
| TRENDS-3 | Replaced trivial 7-day avg RPE with **7-day load** (sum of TSS, last 7d) on the Trends "Last 7 days" card — an actionable "trained enough this week?" signal. `app/api/trends/route.ts`, `components/Trends.tsx` |
| DI-3 | Mid-ride added intervals now surfaced: `matchPrescription` captures executed work efforts beyond the prescribed count as `extras` (not scored against a target); rendered as dashed "+extra" chips on the ride card. `lib/interval-match.ts`, `components/Dashboard.tsx` |
| TODAY-7 | Session-state audit: fixed the calendar showing **compromised** rides as "Missed" (they're excluded from `scores`, so the calendar misread them) — threaded `compromisedDates`/`partialDates` through sync → state → calendar; compromised now shows "~" + "Compromised — ridden, excluded from scoring", partial shows "Partial · execution X/10". `missed` confirmed auto-derived (no athlete-set path needed). `app/api/sync/route.ts`, `components/SyncProvider.tsx`, `components/Dashboard.tsx` |
| TRENDS-1 | Pw:HR now **excludes indoor rides** (outdoor `Ride` only — VirtualRide has distorted Pw:HR from cardiac drift / ERG-flat power); ≥45-min + endurance-band + Intervals.icu `efficiencyFactor` method confirmed. Extracted to tested `lib/trends.ts` (`efSeries`). |
| TRENDS-2 | Fueling/weight graph now shows **complete weeks only** — the in-progress week (always partial, misleadingly low totals) is dropped; day-level data untouched in the sync. Extracted to tested `lib/trends.ts` (`weeklyEnergy`). |
| PW-4 | Long-Z2-on-hills execution guidance added to generation prompt: govern by HR ceiling (top of Z2) not just watts, let power drift on climbs but cap HR, ease descents instead of surging — grounded in KB grey-zone-drift weakpoint. `lib/anthropic-api.ts` |
| PW-5 | Contextual technique cues in ride descriptions: new optional `Execution:` line in DESCRIPTION format + grounded rule (sit-down sprints, descents as descending/cornering practice — the athlete's weakpoints). Parser passes it through as free-text. `lib/anthropic-api.ts` |
| UI-5 | Ride-card power trace: 30s rolling-mean smoothing (`lib/trace.ts`) tames the jumpy line; short work-interval bands now have a min width + stronger amber/cyan fill+edge so 30s reps are visible (`components/RideTrace.tsx`); caption notes "30s smoothed". Clutter already cut via TODAY-1 (6→4 tiles). Smoothing applies on next sync (trace is computed at sync time). Open-ended full hierarchy redesign left as a future judgment call. |
| DI-4 / PW-10 | Power-PR recognition: `lib/pr.ts` (now curve-to-curve, all-time baseline via ROADMAP #9). Coach note calls out breakthroughs first (DI-4); Today card shows a 🏆 trophy banner with each PR + delta (PW-10). `lib/pr.ts`, `app/api/sync/route.ts`, `lib/anthropic-api.ts`, `components/Dashboard.tsx` |
| NUT-6 | Audit (pass, no change): weight is **live-synced** (`generate/route.ts` uses latest `wellness.weightKg`, profile fallback); buffer self-adjusts ±150 kcal vs the 7-day weight trend, clamped 0–600, deliberately not applied on rest days; carbs scale by body mass (glycogen), protein flat ~30g (MPS saturates — per-kg scaling isn't an improvement). The real enhancement (energy-availability / under-fuel signal) is already ROADMAP §6 + the Today nutrition-availability metric. |
| PW-1 | Standing-sprint technique: KB §4 now distinguishes seated SIT (aerobic, consistent power) from standing sprints (neuromuscular/race skill) + technique cues; generation execution-cue updated to coach standing only on dedicated sprint/RaceSim work (the athlete's flagged weakpoint). `knowledge-base/training_knowledge.md`, `lib/anthropic-api.ts` |
| PW-3 | Race-sim is a real workout type: added `RaceSim` to `WorkoutType` + styles, nutrition (factor 0.82, durations, hard-type), execution-score IF band, reschedule quality list, generation TYPE list + KB §10 protocol (variable race-moves, peaking/event-window use, scored on intensity not rep-match). |
| PW-9 | Athlete-directed / terrain-flexible sessions: KB §11 + generation rule — prescribe target efforts as ranges + a terrain placement rule + strict-Z2/HR-cap floor; scored on intrinsic quality, not rep-match. Keep one fixed ERG benchmark session/week. `knowledge-base/training_knowledge.md`, `lib/anthropic-api.ts` |

---

🎉 **All feedback items cleared.** Forward/strategic backlog continues in [ROADMAP.md](ROADMAP.md).

### Order completed
1. ~~P1 cluster (DI-1, DI-2, PW-7, PW-8)~~ ✓ · ~~PW-6 Ask-Coach context~~ ✓ · ~~SIT + tooltips (PW-2, TODAY-6, TODAY-8)~~ ✓ · ~~Metric audits (TODAY-1, PLAN-3, TRENDS-3)~~ ✓ · ~~State-logic (TODAY-7, DI-3)~~ ✓ · ~~Trends data-quality (TRENDS-1, TRENDS-2)~~ ✓ · ~~Edu cues (PW-4, PW-5)~~ ✓ · ~~UI-5 ride-card trace~~ ✓ · ~~PR recognition (DI-4, PW-10)~~ ✓
2. ~~NUT-6 nutrition-formula audit~~ ✓
3. ~~Workout features: PW-1 standing sprints, PW-3 race-sim, PW-9 flexible sessions~~ ✓
