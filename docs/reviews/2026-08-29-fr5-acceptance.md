# FR-5 acceptance evidence

**Date:** 2026-08-31  
**Implementation commit:** `96d5371123747c64b900ee6436c9af3bc9c98105`

## Automated verification

- `npm run check`: pass at 2026-08-31 18:10 CEST — TypeScript, ESLint, 118 test files / 2,504 tests, agent-workflow guards, sync tests, and the 143-file link check all passed.
- Anthropic-unset generation: pass. The ten requests ran against an isolated copy of the current
  implementation and athlete data. Controlled synthetic recent-exposure fixtures were added only to
  the isolated copies to select the five named focuses; live data and the published block were untouched.
- Retained evidence: `.git/worktrees/codex-fr5-deterministic-authority-design/sdd/task-7-final-evidence/` (outside the repository worktree).

## Varied deterministic generations

Each case was generated twice through the local `/api/generate` route with `ANTHROPIC_API_KEY` unset.
`plan.raw`, `plan.days`, and preferences were identical between repeats. No response contained `model`
or `promptVersion`.

| Case | Input summary | Stable repeat | Days | Weekly sums | Blockers | Notes |
|---|---|---:|---:|---|---:|---|
| 1 | Threshold; 14 days | Yes | 14 | 360, 600 min | 0 | No preferences. |
| 2 | VO2max; 28 days | Yes | 28 | 360, 540, 540, 540 min | 0 | No preferences. |
| 3 | Anaerobic; 42 days | Yes | 42 | 396, 660, 660, 660, 396, 660 min | 0 | Eight stable spacing preferences. |
| 4 | Durability terrain/race; 28 days | Yes | 28 | 360, 600, 600, 600 min | 0 | RaceSim present. |
| 5 | Threshold constrained event; 56 days | Yes | 56 | 300, 480, 480, 480, 300, 480, 480, 480 min | 0 | RaceSim on the event day. |

## Intervals.icu inspection

- Owner approval recorded: 2026-08-31 at approximately 17:22 CEST, immediately before publication through the existing preview UI.
- Publication result: all 14 entries written; all 14 `nodevelo-*` events were returned by the Intervals API with `push_errors: null`.
- Power-led target and repeat order: the 45-minute Threshold workout parsed as a 5-minute 50–75% FTP ramp, lap-ended 9-minute Z2 readiness, 2×8 minutes at 90% FTP with 5 minutes Z1 between, and 10 minutes Z1 cooldown. The 55-minute SIT workout parsed as three repeated seated 30-second efforts at 150% FTP with 4 minutes Z1, followed by one standing 30-second effort and a 10-minute Z1 cooldown.
- Power-led Z1–Z2 target with HR ceiling cue: the 108-minute steady Z2 workout parsed as power Z2 for 93 minutes with `HR cap 154bpm` retained as step text, not as a second device target; its cooldown parsed as power Z1.
- Ramp graph interpretation: Intervals parsed the warmup as a true 5-minute ramp from 50% to 75% FTP.
- Duration/load and role classification: Threshold 45 min / 41 load; SIT 55 min / 44 load; steady Z2 108 min / 73 load; durability 180 min / 142 load. Parsed roles were warmup, active, recovery, and cooldown as prescribed.
- Explicit rest days: three Rest entries were published as `NOTE` events rather than workouts.

## Wahoo execution

The owner was explicitly asked to report the final Threshold/SIT behavior, the power-led Z2 HR-cap
cue, and the warmup ramp, and replied `wahoo works`. This records those final workouts as
owner-confirmed acceptable, with no problematic degradation reported; it does not claim whether the
ramp executed linearly or as a band. Earlier, the owner separately confirmed that `Press lap`
advances into the next interval on Wahoo.

## Verdict

`PASS` — the deterministic, Intervals.icu, and owner-observed Wahoo boundaries all passed.
