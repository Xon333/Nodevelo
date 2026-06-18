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

---

## Data integrity & interval detection
| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| DI-4 | ☐ | P2 | feat | No breakthrough recognition — coach misses PRs set during intervals (→ PW-10) |

## Plan & workout structure
| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| PW-1 | ☐ | P2 | feat | Sprints: seated-only — add standing technique option + when/how guidance |
| PW-3 | ☐ | P2 | feat | Race-sim rides as a real workout type (hill attacks, KOM hunts, block-fit logic) — today only a goal string |
| PW-9 | ☐ | P2 | feat | Fluid/athlete-directed sessions (e.g. "find 2×20m climbs, push; Z2 else") — needs DB rules so AI treats them as structured-but-flexible |
| PW-10 | ☐ | P2 | feat | PR highlighting: profile flag + trophy popup on Today when a new PR detected (→ DI-4) |
| PW-4 | ☐ | P3 | edu | Long Z2 on hilly routes — execution guidance (strict Z2 vs climbing) |
| PW-5 | ☐ | P3 | edu | Contextual links/notes in ride descriptions (descending, standing-sprint technique, etc.) |

## Ride card / UI
| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| UI-5 | ☐ | P2 | ux | Ride card overcrowded: power trace jumpy (show 30s/1m smoothed avg), 30s interval bands barely visible — consider redesign for hierarchy |

## Nutrition
| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| NUT-6 | ☐ | P2 | audit | Verify & explain daily-intake logic (weight live? buffer removed?), then propose formula improvements (→ ROADMAP §6) |

## Trends page
| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| TRENDS-1 | ☐ | P2 | audit | Pw:HR — decide Intervals.icu method vs current; exclude indoor rides; apply only to rides >45 min |
| TRENDS-2 | ☐ | P2 | ux | Fueling/weight graph: display complete weeks only (keep day-level granularity in backend/second-brain) |

---

### Suggested order
1. ~~P1 data-integrity cluster (DI-1, DI-2, PW-7, PW-8)~~ ✓ · ~~PW-6 Ask-Coach context~~ ✓ · ~~SIT cleanup + edu tooltips (PW-2, TODAY-6, TODAY-8)~~ ✓ · ~~Metric audits (TODAY-1, PLAN-3, TRENDS-3)~~ ✓ · ~~State-logic audit (TODAY-7, DI-3)~~ ✓
2. **PR recognition** (DI-4 + PW-10) — detect PRs set during intervals → trophy on Today.
3. **Trends data-quality** (TRENDS-1 Pw:HR, TRENDS-2 complete-weeks) · **NUT-6** nutrition audit.
4. Feature work (PW-1 standing sprints, PW-3 race-sim, PW-9 fluid rides) + edu (PW-4, PW-5) + UI-5 ride-card redesign last.
