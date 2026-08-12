# Buffer redesign — feed-forward from the goal, not feedback on the trend

**Date:** 2026-07-31
**Status:** Shipped 2026-07-31.
**Context:** Nutrition Phases 1 + 2 shipped (`docs/superpowers/specs/2026-07-30-day-to-day-nutrition-accuracy-design.md`).
Written after simulating the shipped controller and finding two defects.

---

## 1. What the buffer is, today

`dailyTarget = (k × RMR) + activeBurnKcal + buffer`.

`adjustBuffer` is a pure, stateless proportional controller. It compares the observed weight trend against
a desired trend derived from the gap to target, and returns `configured buffer + damped delta`, where the
delta is clamped to ±250 kcal per adjustment.

It was designed in Phase 1, when `k` was a fixed population prior of 1.20. At that time the buffer was
doing **two jobs at once**:

1. absorbing error in the model's maintenance estimate (a wrong `k`), and
2. driving the athlete's weight goal.

**Phase 2 changed the premise.** `k` is now derived from the athlete's own logged data over a 28–42 day
window, at a stated confidence. Job 1 has a proper owner. The buffer is still doing both.

## 2. Two defects, both measured

Simulation: the athlete eats exactly what the app prescribes, every day for a year. True `k` = 1.28,
RMR 1631, 1000 kcal/day of training, target 63 kg, deadband ±0.7 kg, calibration re-run every 14 days.

### D-A — Steady-state offset (proportional control, no integral term)

Starting at 62 kg and needing to gain, the shipped controller lands at **64.32 kg and stays there** —
1.3 kg past target, **0 of the last 65 days inside the deadband**. True maintenance is 3088 kcal; the app
settles on 3100. A standing **+12 kcal/day** it cannot remove.

The mechanism is structural, not a coding error. At 1.3 kg above target with a flat trend the delta is
−140 regardless of the configured value (150 → 10, 0 → −140, −200 → −340). A *damped proportional*
response converges to a fixed point with non-zero error by construction. There is no integral term, so
the residual is never accumulated away.

### D-B — The configured buffer can oppose the goal, invisibly

**This is the more serious one, and it is not a tuning problem.**

The controller looks only at trend **error**. It never asks whether the buffer's **sign** agrees with the
direction the athlete is trying to move. So:

```
athlete at 66 kg, target 63 kg, losing at exactly the desired −0.5 kg/week
configured buffer 150
  → trend error = 0
  → delta 0
  → applied buffer 150
  → reason: "Weight trending -0.5 kg/week while aiming for -0.5 kg/week — buffer unchanged."
```

A **+150 kcal/day surplus, left standing on an athlete who is cutting**, and the app reports it as
everything being on plan.

In the year-long simulation this is decisive. Starting at 66 kg needing to lose 3 kg, the shipped
controller ends at **66.94 kg** — it moved the athlete *away* from target, in the wrong direction, and
finished 3.9 kg off. Early on a low `k` under-estimates maintenance and they do lose; once calibration
corrects `k`, the configured surplus takes over and reverses them.

For the current athlete this is dormant — they are gaining and their buffer is positive, so the signs
agree. It is a trap waiting for the first weight-loss goal.

## 3. The redesign: feed-forward

Once maintenance is honest, **the goal does not need feedback at all.** The required surplus is a direct
thermodynamic calculation:

```
buffer = desiredRateKgPerWeek × 7700 ÷ 7        (clamped to the existing rails)
       = +0.35 kg/week → +385 kcal/day
       = −0.50 kg/week → −550 kcal/day
```

The buffer stops being a servo and becomes a statement of intent. The two mechanisms get clean,
non-overlapping jobs:

| Mechanism | Job | Timescale |
|---|---|---|
| `calibrateNeat` | keep maintenance honest | slow — 28–42 day window, re-solved per sync |
| buffer | deliver the surplus the goal requires | immediate — a direct calculation |

D-B disappears by construction: the buffer *is* the goal, so it cannot contradict it. D-A disappears
because there is no servo to have a steady-state error — when the athlete enters the deadband the desired
rate becomes 0, so the buffer becomes 0, so they eat maintenance and hold.

### Measured, same simulation

| Start | Goal | Shipped (feedback) | Feed-forward |
|---|---|---|---|
| 62 kg | gain to 63 | **64.32 kg**, 0/65 days in deadband | **63.05 kg**, 65/65 days in deadband |
| 66 kg | lose to 63 | **66.94 kg** (wrong direction), 0/65 | **63.22 kg**, 65/65 |

Both directions converge and hold. `k` still recovers to 1.2814 against a true 1.28, so calibration is
unaffected.

## 4. What feed-forward gives up, and the mitigation

Feed-forward **trusts maintenance**. If `k` is wrong, the athlete gets `wrong maintenance + correct
surplus`, and nothing servos the error away between calibrations.

That is an acceptable trade *only when calibration is trustworthy*. So:

- **Calibration at `medium`/`high` confidence** → feed-forward. Maintenance is derived from the athlete's
  own data; trust it and state the intent.
- **Calibration withheld, `low`, or `stale`** → fall back to the current trend-feedback controller. It is
  the only correction available when maintenance is a population guess, and its steady-state offset is a
  far smaller problem than an uncorrected 163 kcal/day model error.

The fallback keeps Phase 1's asymmetry (quick to add food, slow and confirmation-gated to remove it),
which exists to avoid reading glycogen rebound as fat gain.

## 5. Consequences for the configured buffer

Under feed-forward the athlete's `buffer` setting is **redundant with `targetRateKgPerWeek`** — both
express "how fast do you want to move", one in kcal and one in kg/week, and D-B is exactly what happens
when the two disagree.

Recommended: `targetRateKgPerWeek` becomes the single owned input, and `buffer` is retired as a primary
setting — kept, if at all, as an explicit manual nudge *on top of* the computed value, clearly labelled,
and **sign-checked against the goal** so D-B cannot recur.

This is a user-facing change and needs the athlete's agreement before implementation.

## 6. Deadband note

With a ±0.7 kg deadband, "target 63" operationally means "62.3–63.7". Feed-forward stops as soon as the
athlete enters that band, so they may settle up to 0.7 kg short of the stated number. That is a
reasonable design (nobody should chase the last kilogram), but the UI should say so rather than implying
the target is hit exactly. The simulations above land at 63.05 and 63.22, comfortably inside.

## 7. What this does not change

`calibrateNeat`, the RMR floor, the derivation panel, the rate goal, and the smoothed-weight fix all stand
as shipped. This proposal replaces one function's control law and re-scopes one setting. Everything
Phase 2 measured — `k` = 1.2584 at high confidence, rest day 2300 → 2450 — is unaffected.

## 8. Caveat on the evidence

The simulations assume the athlete eats exactly the prescription every day, which no one does. Real
adherence noise would blur both curves. But D-B is **structural, not statistical**: a configured surplus
standing against a cutting goal is wrong on every single day regardless of adherence, and the controller
has no mechanism that could ever notice it. That finding does not depend on the idealisation.
