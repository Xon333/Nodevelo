# 09 · Nutrition — what to eat, and why that number

The athlete's presenting problem is **chronic underfuelling hindering recovery**. Everything here exists
to answer one question honestly: *how much should I eat today, and can I see why?*

**Nutrition is code, not AI** ([DECISIONS](../DECISIONS.md) ADR-0002). Every figure on this page is
computed in TypeScript. The LLM is handed the finished numbers and phrases them; it never computes one.
`lib/nutrition-validate.ts` enforces that — it recomputes each day's kcal from the same pure formula and
**auto-corrects** any figure the model invented.

## The formula

```
dailyTarget = (k_dayType × RMR)  +  activeBurnKcal  +  buffer
               ↑ estimated   ↑ measured        ↑ chosen
```

Exactly one term is an estimate. That is the whole design.

| Term | What it is | Where from |
|---|---|---|
| `RMR` | Resting metabolic rate | Mifflin-St Jeor over weight/height/age/sex |
| `k_dayType` | Non-exercise multiplier — NEAT **plus** the thermic effect of food, **never exercise**; calibrated separately for zero-activity and training days | Derived from the athlete's own logs (§ Calibration) |
| `activeBurnKcal` | The activity's active calorie burn | Intervals.icu, **used verbatim** |
| `buffer` | The energy the weight goal requires | `rate × 7700 ÷ 7` (§ The buffer) |

**Every day with zero resolved activity burn counts as a rest day.** This does not depend on whether a
generated block labels it `Rest`, so the system works when no block is active or the block feature is not
being used. For future generated plans, `type === "Rest"` is the proxy because no actual activity exists
yet. A day containing activity whose burn is unresolved is **unknown, not rest**, and is excluded from
historical balance calculations. Rest and training days use the same formula; only the calibrated
`k_dayType` input differs.

### `k` covers NEAT and TEF, never exercise

Exercise arrives separately as `activeBurnKcal`. Putting any of it inside `k` would double-count every
training day. The plausibility band (`NEAT_PLAUSIBLE_MIN` 1.15 – `NEAT_PLAUSIBLE_MAX` 1.55) is tighter
than the familiar PAL figures (1.2 sedentary … 1.9 very active) precisely because those *include*
exercise and are the wrong reference here.

Those edges are stated **against Mifflin-St Jeor specifically**. Mifflin under-predicts trained endurance
athletes by ~5–10%, so a derived `k` for such an athlete lands correspondingly high — the upper edge
carries that bias. It is not a claim about human physiology.

## Active burn is consumed verbatim

`ActivitySummary.kj` is **mechanical work** at the crank. Intervals.icu separately reports the activity's
**active calorie burn**, derived from that same power data by the head unit. NodeVelo consumes the latter,
unmodified.

`activeBurn()` in `lib/nutrition.ts` is the single accessor. No efficiency factor, no resting-cost
subtraction, no scaling, no re-derivation from `kj`. Its only branch is a flagged `legacy: true` fallback
to `kj` for activities synced before the field existed, so old and new data never silently mix bases.

**A missing figure returns `null`, never `0`.** Coercing it would make a day of unknown burn read as a rest
day and silently lower that day's target — the exact class of defect this module is built to avoid.

## Calibration — deriving `k` from the athlete's own data

Rather than shipping a population guess, `calibrateNeat` solves the energy-balance identity over a
trailing window:

```
Σ intake − ( N·k·RMR + Σ activeBurn ) = Δmass · ρ          ρ = KCAL_PER_KG_TISSUE = 7700
  ⇒  k = ( Σ intake − Σ activeBurn − Δmass·ρ ) / ( N · RMR )
```

Four rules make this correct rather than merely plausible:

1. **Only the product `k × RMR` is identifiable.** A derived `k` also absorbs RMR-equation error. Never
   present it as a measurement of the athlete's metabolism.
2. **Missing intake days are imputed at the window's logged mean, never summed as zero.** This athlete logs
   ~99% of days in MyFitnessPal and only the *transfer* into Intervals.icu is intermittent — a missing day
   means "not transferred yet", not "fasted". Summing logged days only would fabricate a deficit
   proportional to how lazy the transfer was.
3. **An out-of-band solve is ambiguous and is never reported as a diagnosis.** `k` is clamped and an
   `EnergyImbalanceFinding` names **at least two** candidate causes — food-log bias first (20–30%
   under-reporting is well documented in athletes), RMR-equation error second. Telling an athlete their log
   is wrong when it may not be is the failure mode this guards against.
4. **Below the confidence floor it withholds entirely** (`null`). A population default must never
   masquerade as personalised.

### Coverage is measured over the *loggable* range, not the window

The window ends at `today`, but **coverage is measured from the window start to the last day actually
logged**. Measured on real data with a 9-day transfer gap: window-anchored coverage read 50% where the
loggable range read 82%, so calibration flickered — available right after a transfer, gone nine days later.

"Patchy" and "stale" are therefore **different states**. A last-logged date more than
`CALIBRATION_MAX_STALENESS_DAYS` (14) before today returns a sentinel with `stale: true`, distinct from
ordinary insufficient data. `N` in the identity is `loggableDays`, so the intake sum, burn sum and `N`
always count exactly the same days.

### Weigh-in recency is required (a Critical, once)

`theilSenKgPerWeek` anchors its x-axis at the athlete's **last weigh-in**, not at `today`. Left unbounded,
a weigh-in lapse slid the trend window *outside* the calibration window: with a pre-window trend of
+0.30 kg/week and a 21-day lapse, `k` solved to **1.157 at high confidence** — a 165 kcal/day cut, and at
a steeper trend it also fired a food-log accusation against a correct log.

Two guards: `calibrateNeat` filters the wellness series to the calibration window before estimating, and
`CALIBRATION_MAX_WEIGHIN_LAPSE_DAYS` (14) blocks adoption when weigh-ins are stale. The confidence tiers
alone could not catch it — they counted weigh-ins *over* the window, so 23 clustered in its first half
still cleared the high bar.

### Two weight-trend variants, deliberately

`weightTrendFromWellness` rounds to 1 decimal — right for display and for the buffer's coarse steering
bands. `weightTrendPreciseFromWellness` does not, because calibration multiplies the trend by 7700 kcal/kg
and a discarded 0.04 kg/week is ~44 kcal/day of fabricated imbalance. Both share one estimator.

### Day-type calibration: why rest maintenance can be higher

The longitudinal falsification test found that one pooled `k` was not exchangeable across days: implied
rest-day `k` was about **0.31 higher** than training-day `k` (`t ≈ 6.2`), while previous-day load did not
reliably predict rest-day intake (`r = 0.25`, `n = 10`). NodeVelo therefore does **not** add a speculative
"recovery calories" term. It solves the existing energy-balance identity separately:

```
k_dayType = k_rest   when today's resolved active burn is 0
            k_train  when today's resolved active burn is > 0
```

Sparse rest-day data is shrunk toward the pooled result with `weight = n / (n + 12)`. At five logged
rest days, only 29% of the raw rest-specific solve is used; 71% remains the pooled estimate. This is why
the live rest target moved conservatively from 2080 to 2230 kcal rather than jumping to the raw solve.
As more rest days accrue, the split changes smoothly instead of jumping at a hard sample threshold.

This is an empirical allocation of the already-observed energy budget, not proof that recovery itself
costs exactly that amount. Adding EPOC, glycogen replacement or a lagged recovery surcharge on top would
risk double-counting. Such a term is only justified if future data shows a reproducible previous-workout
effect after day type is already accounted for.

## The buffer — feed-forward from the goal, not feedback on the trend

The buffer is **not a servo**. It is the energy the athlete's chosen rate thermodynamically requires:

```
buffer = goalSurplusKcalPerDay(desiredRate) = rate × 7700 ÷ 7
         +0.35 kg/week → +390 kcal/day
         −0.50 kg/week → −550 kcal/day
```

`resolveBuffer` picks the mode. When calibration is **trustworthy** (`source: "derived"` **and**
confidence `medium`/`high`), maintenance is honest, so the goal needs arithmetic rather than feedback.
Otherwise it falls back to `adjustBuffer`, the trend servo — with the **goal surplus as its base**, so both
modes share one base.

### Why it stopped being a servo

The servo had two measured defects, both found by simulating a year of the athlete eating exactly the
prescription (which this athlete does ~99% of the time):

- **Steady-state offset.** Damped proportional control with no integral term converges to non-zero error.
  Starting at 62 kg targeting 63, it parked at **64.32 kg** — 0 of the last 65 days inside the deadband.
- **The sign defect, which was worse.** The servo read only *trend error*, never whether the buffer's
  **sign** agreed with the goal. An athlete at 66 kg targeting 63, losing at exactly their intended rate,
  had zero trend error — so it did nothing and left their configured **+150 kcal/day surplus standing while
  they cut**, reporting it as on plan. Over the simulated year: **66.94 kg**, the wrong direction.

Feed-forward removes both. Same simulation: **63.05 kg** and **63.20 kg**, 65/65 days in the deadband, and
identical results whether the retired `buffer` setting held 0, 150 or 600.

`NutritionSettings.buffer` is therefore **deprecated** — read only by the servo fallback, no longer
athlete-facing. `targetRateKgPerWeek` is the single owned input. Keeping both was the sign defect.

### Direction always comes from the gap

`desiredWeightTrend` takes its **magnitude** from `targetRateKgPerWeek` but its **direction** always from
which side of target the athlete is on. A rate left over from an earlier goal cannot invert the steering.

### Two guards on the output

- **`GOAL_DEADBAND_KG` (0.7)** — inside it the desired rate is 0, so the buffer is 0 and the athlete eats
  maintenance. "Target 63" operationally means **62.3–63.7**; the UI says so rather than implying the
  number is hit exactly.
- **An absolute floor at RMR.** `calculateDailyTarget` clamps the derived path to `≥ rmr` and reports
  `floored`. Before it, a −500 buffer produced **1460 kcal against an RMR of 1631** — and since
  `1.2 × RMR − 500 < RMR` for any RMR below 2500, it always did.

## Why there is no separate rest-day formula

`calculateDailyTarget` once ran two independent formulas: `baseCalories + burn + buffer` on training days,
a flat `restDayTarget` with **no buffer** on rest days. A training day only overtook a rest day once burn
cleared ~300 kcal — so **every Strength session (225 kcal at 45 min) and every short recovery ride
prescribed less food than doing nothing.**

One formula, with a rest day being resolved burn `= 0`, keeps exercise additive and physically readable.
The day-type calibration can make rest-side background maintenance higher than training-side background
maintenance, but it never replaces or subtracts measured exercise burn. The old asymmetric formula is
unrepresentable now, not merely tuned away — pinned by a regression matrix and swept across 15,750
configurations with zero violations.

The same defect had a second head: `weeklyEnergy` decided rest-vs-training by `dayBurn > 0`, a *different*
definition, so logging a 150 kcal walk **reduced** that day's computed need by ~210 kcal. That branch is
gone too.

**Legacy profiles** (no `dateOfBirth`/`heightCm`/`sex`) keep their hand-set numbers, with one strictly
food-increasing correction: a training day is floored **at** the rest-day figure rather than rest days
being lowered to meet it. Nobody loses food on migration.

## Signals surfaced to the athlete

| Signal | Question it answers | Denominator |
|---|---|---|
| `computeUnderfuelStreak` | *Am I repeatedly short of what my body needs?* | **Unbuffered** maintenance + burn |
| `weeklyEnergy` / `balanceLevel` | *Did I follow the plan?* | The **buffered** prescription |
| `computeEnergyAvailability` | *How much energy is left for recovery?* | Per kg body mass |

**`UNDERFUEL_RATIO_BELOW` (0.95) and `BALANCE_LOW_BELOW` (0.9) are two different facts and must not be
unified.** The streak alert is a *health* signal, so it excludes the goal buffer — otherwise an athlete
deliberately and appropriately in a deficit would trip it. Weekly balance is a *plan-adherence* signal, so
it includes the buffer.

The streak window is **the most recent up to 7 _logged_ days, none older than 14 calendar days, requiring
≥4** — not the last 7 calendar days, for the same batch-transfer reason as calibration coverage. Below the
floor it returns `null`, and the UI says *"not enough transferred yet"*, which is explicitly different from
*"you're fine."* Back-fill is normal, so the alert legitimately appears retroactively; the logged-day count
is always shown so a change is explicable.

Both the streak and weekly energy balance resolve `k_rest` or `k_train` for **each historical day**.
They never apply whichever model happens to be active today across a mixed multi-day window.

When an `imbalance` finding exists it renders **alongside** the deficit, with **both** candidates. That
pairing is deliberate: acting on an apparent deficit while body weight is actually stable would drive
unintended gain.

## Early goal-trend warning

Today shows an informational warning only after a 21-day evidence gate: at least 7 weigh-ins, 14 usable
intake days, estimated prescription adherence within 95–105%, and an observed trend at least 0.15 kg/week
above the intended trend. Historical final prescriptions are not persisted, so the adherence calculation
uses today's calibrated models and buffer and is explicitly approximate. The warning never adjusts
calories, calibration, or the goal buffer; maintenance calibration remains the only slower adjustment path.

## The derivation panel

The Profile page renders the whole chain — RMR → NEAT (with the evidence behind its confidence) →
maintenance → smoothed weight → goal → observed trends → buffer → today's target. Showing the derivation
*is* the feature, not decoration: it is [DECISIONS](../DECISIONS.md)'s calibrated-honesty principle applied
to the one system whose output the athlete acts on every day.

The target row renders `calculateDailyTarget`'s result directly. When a deficit would push the arithmetic
below RMR, it shows both the lower calculated value and the final RMR-floored prescription; when the guard
is inactive, the extra explanation stays hidden.

Body mass for **goal** comparisons is `smoothedCurrentWeightKg` (14-day median), not the latest single
reading. A raw reading swings ±0.5–1 kg, which was flipping the target ~190 kcal/day across the deadband
boundary depending on which weigh-in happened to be last. RMR still tracks current mass.

## Known rough edges

- **Day-type-conditioned `k` — shipped 2026-08-01**, closing the gap
  [the review](../superpowers/specs/2026-08-01-rest-day-energy-model-review.md) found (rest-day implied
  `k` ~0.31 higher than training-day, t≈6.2). `calibrateNeatByDayType` solves `k_rest`/`k_train`
  independently over a 90-day window and shrinks each toward the existing pooled `k` via empirical-Bayes
  weighting (`n/(n+12)`, reusing `CALIBRATION_MIN_WEIGH_INS`) rather than the review's originally-proposed
  hard confidence gate — conservative from day one, no discontinuity as data accrues. Live at n=5 logged
  rest days: weight 0.29, rest-day target 2230 (vs 2080 flat-`k` before this shipped). The raw (unshrunk)
  rest-day solve landed at 1.55 — within rounding of the review's original 1.53 finding from a completely
  different data window, good convergent evidence the signal is real and stable, not an artifact of one
  window choice. Plan: [day-type-neat-calibration.md](../superpowers/plans/2026-08-01-day-type-neat-calibration.md).
  **A real cross-file bug was caught and fixed during this work, not deferred:** `buildNutritionReferenceRows`
  resolves a model per row (rest vs. training), but `repairNutrition`/`validateNutrition` originally
  validated a whole multi-day block against one shared model — once `k_rest` ≠ `k_train`, a correctly-copied
  rest-day figure would get falsely "corrected." Both now accept a day-type resolver; a live generated
  block confirmed zero false corrections on rest days.
- **Sustained non-energy weight offsets fool the identity.** Sensitivity is ~183 kcal/day per kg of
  mis-estimated mass over a 42-day window. Transients are rejected cleanly (±3 kg parked on the last 5 days
  moved `k` by *literally zero*), but a **+1.0 kg step held across half the window** — heat acclimation,
  carb loading, creatine — clamps `k` to the floor and fires a spurious imbalance finding. Not fixable
  without body composition.
- **Mean imputation has two known biases, both pointing the safe (over-feeding) direction.** A trending
  intake with the unlogged gap at the old end reads ~+83 kcal/day; logging training days but skipping rest
  days reads ~+115 kcal/day at a 400 kcal gap. Inherent to imputation — documented, not chased.
- **`weeklyEnergy` cannot yet measure adherence against the historically displayed prescription.** The
  app has no complete day-keyed prescription history, and ride-ledger stamps would omit rest days. It
  therefore retains the documented approximation rather than reconstructing old buffers from today's
  settings. Upgrade only when every usable intake-logged day can carry an immutable final target; never
  mix exact and reconstructed days inside one weekly ratio.
- **Off-bike activity depends on Intervals.icu carrying a calorie figure.** Every `WeightTraining` and
  `Unknown` activity in real data carries *neither* `calories` nor `icu_joules`, so the athlete enters an
  estimate manually — which lands in the same field `activeBurn()` reads.
- **Body composition is unavailable.** Katch-McArdle/Cunningham track lean mass and drop the sex term, but
  need body fat %, which is not logged and which `lib/intervals-api.ts` does not parse. Moot while `k` is
  calibrated: only the product `k × RMR` is identifiable, so the equation choice is worth ~5 kcal/day
  (measured). Revisit only if body composition starts being tracked.

## Common modifications

| Change | Where |
|---|---|
| The daily-target formula | `lib/nutrition.ts` — `calculateDailyTarget` |
| How `k` is derived, or its gates | `lib/nutrition.ts` — `calibrateNeat`, `CALIBRATION_*` constants |
| Buffer behaviour / goal steering | `lib/nutrition.ts` — `resolveBuffer`, `desiredWeightTrend` |
| The trend-servo fallback | `lib/nutrition.ts` — `adjustBuffer` |
| RMR equation | `lib/nutrition.ts` — `restingMetabolicRate` (isolated so it is swappable) |
| Pre/in-ride carbs | `lib/nutrition.ts` — `preRideCarbTarget`, `inRideCarbTarget` |
| Post-ride fuel prompt | `lib/fuel-prompt.ts` |
| Where calibration is adopted | `app/api/sync/route.ts` (never when `source: "override"`) |
| The derivation panel | `components/AthleteProfileForm.tsx` |
| The streak / EA tile | `components/dashboard/today.tsx` — `EnergyAvailabilityTile` |
| Guarding the AI's kcal figures | `lib/nutrition-validate.ts` |

## Design history

Specs and plans, in order: the [accuracy design](../superpowers/specs/2026-07-30-day-to-day-nutrition-accuracy-design.md)
(defects D1–D7, phases 1–4), the [buffer redesign](../superpowers/specs/2026-07-31-buffer-redesign-feedforward.md)
(why the servo was retired, with the simulation numbers), and the
[rest-day energy model review](../superpowers/specs/2026-08-01-rest-day-energy-model-review.md), followed
by the shipped [day-type calibration plan](../superpowers/plans/2026-08-01-day-type-neat-calibration.md).
