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

---

## Data integrity & interval detection
| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| DI-3 | ☐ | P2 | bug | Mid-ride added interval detected but not shown as an extra in UI |
| DI-4 | ☐ | P2 | feat | No breakthrough recognition — coach misses PRs set during intervals (→ PW-10) |

## Plan & workout structure
| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| PW-2 | ☐ | P2 | bug | SIT listed as 30s in places but conflicts elsewhere (resolve via PW-7) |
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

## Today page
| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| TODAY-1 | ☐ | P2 | audit | Metric duplication: IF + TSS vs Intervals "Load" — keep only what moves the needle; cut data fatigue |
| TODAY-7 | ☐ | P2 | audit | Verify completed/partial/compromised state logic + UI updates (→ ROADMAP §3) |
| TODAY-6 | ☐ | P3 | edu | ACWR: add what it is, why it matters, good/concerning bands |
| TODAY-8 | ☐ | P3 | edu | TSB (Form): add definition, calc basis, readiness meaning |

## Plan page
| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| PLAN-3 | ☐ | P2 | audit | "This week" card: Hours dup (Trend Pulse), TSS dup — keep utilitarian only / add something genuinely useful |

## Trends page
| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| TRENDS-1 | ☐ | P2 | audit | Pw:HR — decide Intervals.icu method vs current; exclude indoor rides; apply only to rides >45 min |
| TRENDS-2 | ☐ | P2 | ux | Fueling/weight graph: display complete weeks only (keep day-level granularity in backend/second-brain) |
| TRENDS-3 | ☐ | P2 | ux | Last-7d avg RPE is trivial — replace with an actionable metric (→ ROADMAP Recent-Baselines rework) |

---

### Suggested order
1. **P1 data-integrity cluster** (DI-1, DI-2, PW-7, PW-8) — scoring is only as trustworthy as detection; fix before anything that consumes scores.
2. **PW-6 / ROADMAP §2** — Ask-Coach session context (also kills the "4m vs 30s" class of error).
3. **Metric audits** (TODAY-1, PLAN-3, TRENDS-3) — cheap, reduce duplication/fatigue.
4. Feature work (race-sim, fluid rides, PR detection) and edu tooltips last.
