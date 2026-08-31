# FR-5 acceptance evidence

**Date:** 2026-08-31  
**Implementation commit:** `5d346685a89653ad8dfdabe510577441d239b690`

## Automated verification

- `npm run check`: pass at 2026-08-31 17:36 CEST — TypeScript, ESLint, 118 test files / 2,504 tests, agent-workflow guards, sync tests, and 143-file link check all passed.
- Anthropic-unset generation: pass at 2026-08-31 17:32 CEST. The ten requests ran against an isolated copy of the current implementation and athlete data; the live app data and published block were not changed.
- Retained evidence: `.git/worktrees/codex-fr5-deterministic-authority-design/sdd/task-7-current-head-evidence/` (outside the repository worktree).

## Varied deterministic generations

Each case was generated twice through the local `/api/generate` route with `ANTHROPIC_API_KEY` unset. `plan.raw`, `plan.days`, preferences, every date, and weekly duration sums matched between repeats. No response contained `model` or `promptVersion`.

| Case | Input summary | Stable repeat | Days | Weekly sums | Blockers | Notes |
|---|---|---:|---:|---|---:|---|
| 1 | Two-week Threshold; 10h target equals 10h ceiling | Yes | 14 | 360, 600 min | 0 | Recovery placement reduced week 1; the loading week reached the ceiling. |
| 2 | Four-week VO2max; 9h target below 12h ceiling | Yes | 28 | 360, 540, 540, 540 min | 0 | Recovery week retained. |
| 3 | Six-week anaerobic; three quality slots | Yes | 42 | 396, 660, 660, 660, 396, 660 min | 0 | Eight stable spacing preferences; all quality slots remained deterministic. |
| 4 | Four-week hilly-race/terrain goal | Yes | 28 | 360, 600, 600, 600 min | 0 | RaceSim placed deterministically in each loading week. |
| 5 | Eight-week constrained block with a 2026-09-12 event | Yes | 56 | 300, 480, 480, 480, 300, 480, 480, 480 min | 0 | Event day preserved as RaceSim; constrained 8h ceiling and recovery weeks retained. |

## Intervals.icu inspection

- Owner approval recorded: 2026-08-31 at approximately 17:22 CEST, immediately before publication through the existing preview UI.
- Publication result: all 14 entries written; all 14 `nodevelo-*` events were returned by the Intervals API with `push_errors: null`.
- Power-led target and repeat order: the 45-minute Threshold workout parsed as a 5-minute 50–75% FTP ramp, lap-ended 9-minute Z2 readiness, 2×8 minutes at 90% FTP with 5 minutes Z1 between, and 10 minutes Z1 cooldown. The 55-minute SIT workout parsed as three repeated seated 30-second efforts at 150% FTP with 4 minutes Z1, followed by one standing 30-second effort and a 10-minute Z1 cooldown.
- Power-led Z1–Z2 target with HR ceiling cue: the 108-minute steady Z2 workout parsed as power Z2 for 93 minutes with `HR cap 154bpm` retained as step text, not as a second device target; its cooldown parsed as power Z1.
- Ramp graph interpretation: Intervals parsed the warmup as a true 5-minute ramp from 50% to 75% FTP.
- Duration/load and role classification: Threshold 45 min / 41 load; SIT 55 min / 44 load; steady Z2 108 min / 73 load; durability 180 min / 142 load. Parsed roles were warmup, active, recovery, and cooldown as prescribed.
- Explicit rest days: three Rest entries were published as `NOTE` events rather than workouts.

## Wahoo execution

- Representative power workout: owner confirmed on 2026-08-31 that the final published workouts work on Wahoo.
- Power-led Z2 with HR ceiling cue: owner confirmed the final published workouts work; no target-family conflict was reported.
- Ramp degradation: no problematic degradation was reported for the final published workouts.
- Press lap: the owner separately verified during FR-5 acceptance that `Press lap` advances from the Z2 readiness step into the prescribed work interval on Wahoo, and confirmed the final publication works.

## Verdict

`PASS` — the deterministic, Intervals.icu, and owner-observed Wahoo boundaries all passed.
