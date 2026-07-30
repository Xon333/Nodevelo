# Day-to-Day Nutrition Accuracy — Design

**Date:** 2026-07-30 (revised same day after a pro-nutritionist-lens review)
**Status:** Draft — pending user review
**todo.md:** "Scope a real day-to-day nutrition system" (added 2026-07-30)
**Ties:** ROADMAP #2 (per-athlete calibration) — §7 below is a first concrete client for it.

---

## 1. Problem & context

Flagged as the biggest current training hurdle: off-bike underfuelling is hindering recovery. The first
draft of this spec attributed that to three gaps; a review pass found the real defects are worse and
mostly **already live in the code**, not things this feature would introduce. Verified findings:

**D1 — Training days can prescribe less food than rest days.** `calculateDailyTarget`
([lib/nutrition.ts:112](../../../lib/nutrition.ts)) uses two independent formulas: training days get
`baseCalories + burn + buffer`, rest days get a flat `restDayTarget` with **no buffer**. With today's
defaults (2000 / 2600 / 300) a training day only overtakes a rest day once `burn ≥ 300 kcal`. So every
Strength session (`5 kcal/min` → 225 kcal at 45 min) and every short recovery spin currently prescribes
**less food than doing nothing**. For an athlete recovering from underfuelling this is backwards.

**D2 — The formula cannot express a deficit.** `BUFFER_MIN_KCAL = 0` and `dailyTarget = base + burn +
buffer`, where `base + burn` already approximates maintenance. The prescription is therefore always
≥ maintenance. This is why `targetWeight` was never wired in — there is nowhere in the formula to put it.

**D3 — `targetWeight` is decorative, and the buffer fights recovery.** `AthleteNutritionConfig.targetWeight`
is passed in at [app/api/generate/route.ts:125](../../../app/api/generate/route.ts) and **never read by
any calculation** — it appears only in prompt prose ([lib/anthropic-prompts.ts:123](../../../lib/anthropic-prompts.ts)).
`adjustBuffer` sees only `weightTrend7Day`, so it drives toward *weight stability* regardless of which way
the athlete wants to go. The failure mode this creates is specific and serious: repleting muscle glycogen
binds ~3 g water per gram of glycogen, so restoring ~400–500 g of glycogen adds **1.5–2 kg of body mass
within days with zero fat gain**. The 7-day Theil–Sen trend reads "gaining too fast" and **cuts 150 kcal** —
the mechanism actively suppresses recovery from low energy availability, which is the entire reason this
work exists.

**D4 — the kJ→kcal conversion constant is a population assumption, and §7 misattributes its error.**
Power-meter `kj` is a direct measurement of mechanical work — the most trustworthy input this app has,
alongside body mass and logged intake, and the reason it stays primary in §6. But the kcal figure derived
from it is `kj × an assumed gross-efficiency constant` (~22–24%, which is what makes the familiar 1:1 rule
work). Individual gross efficiency genuinely varies ~20–25% between trained cyclists, so that constant
carries a per-athlete error of up to ~10%.

An earlier draft of this spec instead claimed resting metabolism was double-counted inside the ride figure
(gross vs. net efficiency) and proposed subtracting `RMR/24` per exercise-hour. **Dropped:** the gross/net
gap is ~8%, smaller than the ±10% spread in the efficiency constant itself, so the correction sits below
the noise floor of the quantity it corrects.

What survives is the consequence for §7. This athlete's exercise energy is comparable in magnitude to RMR
inside the energy-balance identity (~10,000 kcal/week riding vs ~12,600 kcal/week RMR at RMR 1800), so a
10% conversion error displaces the solved NEAT multiplier by ~0.08 — **20% of the plausibility band's
width**. The identity cannot tell that apart from food-log bias, so §7 must not assert one cause.

**D5 — Off-bike activity is invisible, but it is not where the gap lives.**
[lib/intervals-api.ts:214-237](../../../lib/intervals-api.ts) captures only `icu_joules`, so a logged run
or hike contributes zero. Real, worth fixing — but Freddy shows 168 activities carrying `calories` vs 159
carrying `icu_joules` over ~6 months, so this recovers **9 activities, ~1.5/month**. The dominant
unmodelled term is **NEAT**, at 15–30% of TDEE (≈450–900 kcal at TDEE 3000) against the 360 kcal a fixed
`×1.2` multiplier assigns it.

**D6 — Self-correction has a hard ceiling that is narrower than the error it must absorb.** The buffer
clamps to 0–600 around a 300 default, so it can absorb **±300 kcal**; plausible NEAT error exceeds that.
`adjustBuffer` clamps silently (it appends "Capped at…" to its reason string, but nothing escalates).
It also under-corrects ~2×: a 0.3 kg/7d trend implies ≈330 kcal/day of imbalance
(`0.3 × 7700 ÷ 7`) and draws a flat 150 kcal response. And 0.3 kg/7d sits **inside** the noise floor —
day-to-day body mass swings ±0.5–1 kg, against ~47% weigh-in coverage (80 records / ~172 days).

**D7 — Two disagreeing definitions of "rest day."** `type === "Rest"`
([lib/nutrition.ts:300](../../../lib/nutrition.ts)) vs `dayBurn > 0`
([lib/trends.ts:136](../../../lib/trends.ts)). Combined with D1, once off-bike burn is captured, logging a
150 kcal walk flips a rest day to a training day and **reduces** that day's computed need by ~210 kcal.

**Athlete context.** No wearable (Freddy: Intervals.icu only; `wellness_steps` has 2 records ever). Intake
is tracked in MyFitnessPal ~99% of days and copied as a single end-of-day total into Intervals.icu's
`wellness_kcalConsumed` — transfer is batchy and sometimes back-filled days later, so **a missing day means
"not transferred yet," not "not eaten" and not "not tracked."** Structured off-bike sport gets logged as its
own Intervals.icu activity; ordinary daily-living NEAT is logged nowhere. Protein is already handled
independently (bodybuilding background) and is out of scope. Body composition (FFM) is unavailable.

## 2. Goals / non-goals

**Goals**
- One daily-target formula that can never prescribe less for training than for rest (fixes D1, D7).
- Wire `targetWeight` into the calculation, with a goal-directed and *asymmetric* correction that cannot
  read glycogen rebound as fat gain (fixes D2, D3).
- Make the NEAT multiplier a **calibrated per-athlete parameter** derived from the energy-balance identity
  rather than a fixed constant patched by a capped buffer (fixes D6).
- **Reconcile logged intake against observed weight change**, reporting the magnitude of any imbalance and
  **both** candidate causes rather than diagnosing one (fixes D4's consequence).
- Capture off-bike activity burn (fixes D5).
- Add a **daily carbohydrate target** alongside the existing pre/in-ride ones.
- Surface chronic underfuelling as a streak alert measured against *physiological* need, not goal adherence.

**Non-goals / deferred, with rationale**
- **Protein targets — out.** Athlete already hits protein daily from a bodybuilding background; a second
  prescription would add noise, not accuracy.
- **Within-day / hour-by-hour energy distribution — out.** Real phenomenon (athletes can hit daily totals
  while spending hours in deficit), but it requires meal-level logging; the athlete has explicitly chosen a
  single whole-day log for time reasons. Recorded here as a **known blind spot**: if targets are met and
  recovery still lags, timing is the leading untested hypothesis.
- **Swapping Mifflin-St Jeor for an athlete-specific RMR equation — deferred.** Mifflin under-predicts RMR
  in trained endurance athletes by ~5–10%, which would compound underfuelling. But §7's calibrated
  multiplier **absorbs any constant under-prediction by construction**, so changing equations buys little.
  Kept behind a single swappable function; revisit only if calibration lands persistently at its ceiling.
- **Pw:HR / decoupling as an LEA corroborating signal — deferred.** Attractive because it doesn't depend on
  the food log, but noisy (heat, hydration, sleep, caffeine, position). Weight trend + on-bike expenditure
  trend are the cleaner corroborators and are already used. Revisit if a less flaky candidate appears.
- **RED-S professional-referral signposting — deferred** at the athlete's request (cost). Revisit if the §10
  streak alert sustains across months rather than weeks.
- **No new dashboard tile.** Intake is logged once at end of day, so a live "logged so far" comparison is
  meaningless; pre-ride carb guidance and the post-ride number already land where they're needed.
- **No native food-logging UI, no wearable integration, no manual "log a walk" entry.**

## 3. Approach

Five changes, all inside the existing deterministic-code architecture (ADR-0002 — nutrition is code, not
AI; the LLM only phrases numbers this module computes):

1. **One unified formula** (§5) — `restDayTarget` is deleted, not repaired. Rest days are simply days where
   exercise burn is 0, which makes D1 and D7 unrepresentable rather than merely fixed.
2. **Cross-sport exercise energy** (§6) — `kj` primary (the athlete's own power meter — a direct measurement,
   and the app's most trustworthy input), `calories` fallback for activities without power. Used as-is.
3. **Calibration + reconciliation** (§7) — solve the energy-balance identity for the NEAT multiplier over a
   long window; a solution outside the physiologically plausible band is an *ambiguous* imbalance signal,
   reported with both candidate causes (food-log bias, or the kJ→kcal constant being off for this athlete).
4. **Goal-directed asymmetric buffer** (§8) — measured against a *desired* trend derived from `targetWeight`,
   proportional rather than a flat step, and deliberately quicker to feed than to cut.
5. **Daily carbohydrate target** (§9) and a **revised streak alert** (§10).

## 4. Data model changes

**`PerformanceData`** ([lib/types.ts:27](../../../lib/types.ts)) — RMR inputs. Date of birth, not age, so it
cannot silently drift a year:

```ts
dateOfBirth: string | null;      // ISO YYYY-MM-DD; age derived at use, never stored
heightCm: number | null;
sex: "male" | "female" | null;   // Mifflin-St Jeor's constant term is binary; a formula input, not identity
```

**`NutritionSettings`** ([lib/types.ts:38](../../../lib/types.ts)) — `baseCalories` and `restDayTarget` stop
being prescriptive inputs. Both are **retained but deprecated**, read only by the pre-migration fallback
(§11), never written:

```ts
export interface NutritionSettings {
  buffer: number;               // now SIGNED: goal-directed surplus/deficit (see §8)
  targetWeightKg: number;
  neat: NeatCalibration;        // derived-but-persisted, athlete-overridable (§7)
  baseCalories: number;         // DEPRECATED — pre-migration fallback only
  restDayTarget: number;        // DEPRECATED — pre-migration fallback only
}

export interface NeatCalibration {
  multiplier: number;                          // k in §5
  confidence: "low" | "medium" | "high";
  source: "default" | "derived" | "override";  // mirrors FocusPeriod.source (two-memory split)
  windowDays: number | null;                   // what it was solved over
  solvedAt: string | null;                     // ISO
  imbalance: EnergyImbalanceFinding | null;    // §7
}
```

**`ActivitySummary`** ([lib/types.ts:56](../../../lib/types.ts)) gains one field:

```ts
calories: number | null; // Intervals.icu's own cross-sport kcal estimate; fallback when kj is absent (§6)
```

**`ResolvedNutritionConfig`** replaces today's `AthleteNutritionConfig`. That interface carried
`baseCalories`/`restDayTarget` as prescriptive inputs and a `targetWeight` nothing read (D3); the resolved
shape carries what the formula actually consumes, assembled once per request:

```ts
export interface ResolvedNutritionConfig {
  rmr: number;             // from §5, using current synced weight
  neatMultiplier: number;  // k — calibrated (§7) or the default prior
  weightKg: number;        // current synced weight; also the g/kg basis for §9
  targetWeightKg: number;  // now genuinely read, by §8
  buffer: number;          // signed configured buffer, before §8's trend correction
}
```

**Buffer confirmation state.** §8's gain-side rule needs to remember that it already saw one qualifying
week, so `NeatCalibration` is joined in `NutritionSettings` by a small derived record. It is engine-owned
(never hand-edited) and resets whenever the trend leaves the gain-side band:

```ts
export interface BufferCorrectionState {
  pendingCutConfirmations: number; // 0..GAIN_SIDE_CONFIRMATIONS; reset on any non-gain evaluation
  lastEvaluatedDate: string | null; // ISO; guards against double-counting two syncs on one day
}
```

## 5. The unified daily-target formula — `lib/nutrition.ts`

```ts
// Mifflin-St Jeor. `sex` is a formula input (the equation's constant term is binary), not identity.
// Deliberately isolated in one function so the equation can be swapped without touching callers — see
// §2 on why an athlete-specific equation is deferred rather than adopted.
function restingMetabolicRate(weightKg: number, heightCm: number, ageYears: number, sex: "male" | "female"): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === "male" ? base + 5 : base - 161;
}

// Prior for k before calibration has enough data. Covers RMR-multiplier territory only: non-exercise
// activity + the thermic effect of food. Structured exercise is NEVER in here — it arrives via
// exerciseKcal, so this must not double-count it.
export const DEFAULT_NEAT_MULTIPLIER = 1.2;

export function calculateDailyTarget(
  exerciseKcal: number,        // §6; 0 on a rest day — there is no separate rest-day branch (fixes D1/D7)
  config: ResolvedNutritionConfig,
  bufferApplied: number,       // signed; resolved by §8 before the call
  workout?: WorkoutContext
): WorkoutNutritionPlan {
  const maintenance = config.neatMultiplier * config.rmr + exerciseKcal;
  return {
    dailyTarget: roundTo(maintenance + bufferApplied, 10),
    maintenanceKcal: Math.round(maintenance),   // surfaced so the buffer's effect is auditable
    preRideCarbs: workout ? preRideCarbTarget(...) : 0,
    inRideCarbsPerHour: workout ? inRideCarbTarget(...) : 0,
    dailyCarbG: dailyCarbTarget(workout, config.weightKg),  // §9
    bufferApplied,
  };
}
```

Because `exerciseKcal ≥ 0` and every other term is shared, **a training day can never fall below the
same athlete's rest day.** D1 and D7 are eliminated structurally rather than by tuning two multipliers into
agreement. The docblock's old "Rest day: restDayTarget flat, no buffer" line is deleted with the branch.

If rest days should be *deliberately* generous beyond maintenance, that becomes one explicit named
allowance applied on rest days following a hard session — not a second inflated multiplier that cannot be
audited. Not in v1; recorded here so the option stays visible.

## 6. Exercise energy — `kj` primary, `calories` fallback

```ts
// kj is MECHANICAL work from the athlete's own power meter — the precise instrument, so it stays primary.
// intervals.icu's `calories` is an HR/pace-derived METABOLIC estimate; it is the only option for
// activities with no power (a run, a hike, the gym) and the fallback for nothing else. Preferring `kj`
// also avoids rebasing every historical figure and avoids a planned-vs-synced basis discontinuity, since
// estimateWorkoutBurnKcal produces a kJ-basis number for planned days.
export function activityKcal(a: { kj: number | null; calories: number | null }): number | null {
  return a.kj ?? a.calories ?? null;   // null propagates as "unknown", never as 0
}
```

**No resting-cost subtraction.** The figure is used as-is. See D4: the gross/net-efficiency correction an
earlier draft proposed (~75 kcal per exercise-hour) is smaller than the ±10% per-athlete spread in the
efficiency constant that produced the number, so subtracting it would add precision theatre, not accuracy.
The residual assumption is instead handled where it belongs — §7 treats the conversion constant as a
candidate explanation when the books don't balance, rather than silently trusting it.

The exact Intervals.icu payload field backing `calories` is confirmed against one real sync before this is
called done — an external-API assumption, not guessed from docs. The check also records the observed
`calories ÷ kj` ratio on power rides: expected ~1.05–1.15, and a materially different value means the
fallback is not interchangeable with `kj` and needs its own scaling note.

## 7. NEAT calibration + intake-log reconciliation

The centrepiece. The energy-balance identity over a window has **three** unknowns — the athlete's true NEAT,
the food log's bias, and the per-athlete accuracy of the kJ→kcal conversion constant (D4) — against **one
equation**. They cannot be separated by arithmetic. The resolution: solve for the *least-known* term (the
multiplier), then use **physiological plausibility as a tripwire** — but report a solution outside human
range as an ambiguous finding with named candidates, never as a diagnosis.

```
Σ intake − ( N·k·RMR + Σ exercise ) = Δmass · ρ

  N        window days
  k        NEAT multiplier (solve for this)
  RMR      from window-median body mass
  exercise §6's per-activity figure, summed
  Δmass    Theil–Sen slope × N, kg (reuses weightTrendFromWellness's estimator)
  ρ        7700 kcal/kg

  ⇒ k = ( Σ intake − Σ exercise − Δmass·ρ ) / ( N · RMR )
```

```ts
// Plausible band for an RMR multiplier covering NEAT + thermic effect of food and NOTHING else
// (structured exercise is already subtracted). Standard PAL figures (1.2 sedentary … 1.9 extra-active)
// INCLUDE exercise and are therefore the wrong reference — these edges are deliberately tighter.
// TEF alone is ~10% of intake ≈ 0.17×RMR at 3000 kcal, which sets the floor's shape.
export const NEAT_PLAUSIBLE_MIN = 1.15;
export const NEAT_PLAUSIBLE_MAX = 1.55;

// ρ. Mixed-tissue figure. Only defensible over LONG windows: over days, glycogen+water dominate
// (~3 g water per g glycogen), which is exactly the artifact that makes a 7-day window useless here.
export const KCAL_PER_KG_TISSUE = 7700;

export const CALIBRATION_MIN_WINDOW_DAYS = 28;
export const CALIBRATION_PREFERRED_WINDOW_DAYS = 42;
```

**Missing intake days are imputed at the window's logged mean, not summed as zero.** The athlete logs ~99%
of days in MyFitnessPal and only the *transfer* is intermittent, so absence is missing-at-random with
respect to how much was eaten — summing logged days only would fabricate a deficit proportional to
transfer laziness. The imputation is stated in the UI alongside the coverage figure.

**Decision rule:**

| Solved `k` | Interpretation | Action |
|---|---|---|
| within `[1.15, 1.55]` | NEAT explains the books | Adopt as `source: "derived"`; `imbalance: null` |
| `> 1.55` | Balance needs implausible NEAT ⇒ intake under-logged **or** true kcal/kJ cost above the assumed constant | Clamp `k` to max; report magnitude `(k − 1.55)·RMR` kcal/day with **both** candidates |
| `< 1.15` | ⇒ intake over-logged **or** true kcal/kJ cost below the assumed constant | Clamp `k` to min; report the converse |

**The two candidates are not separable, and the spec must not pretend otherwise.** At this athlete's volume
(~10,000 kcal/week riding vs ~12,600 kcal/week RMR) a 10% error in the conversion constant moves `k` by
~0.08 — 20% of the band's width — so an out-of-band solve is genuinely ambiguous between "your log
under-counts" and "your gross efficiency differs from the population constant." Reporting only the first
would send the athlete to fix a food log that may be fine.

```ts
export interface EnergyImbalanceFinding {
  direction: "intake-below-model" | "intake-above-model";
  estimatedKcalPerDay: number;   // signed, rounded to 10 — the magnitude, not a cause
  candidates: string[];          // ordered most→least likely, both named; shown in the profile UI
  note: string;                  // human-readable
}
```

Ordering heuristic for `candidates`: log bias is listed first, because self-reported intake under-reports by
20–30% in athletes — a far larger and better-documented effect than individual efficiency spread. But the
efficiency candidate is always shown, never suppressed.

**Upgrade path — fitting both parameters.** With enough weeks of *varying* training volume the two are
separable by regression: over multi-week blocks, `y = Σintake − Δmass·ρ` against `x = Σexercise` gives
`y = a + ε·x`, where slope `ε` fits **this athlete's** kJ→kcal conversion and intercept `a = N·k·RMR` fits
NEAT. Robust (Theil–Sen) rather than OLS, consistent with `weightTrendFromWellness`'s existing rationale
about edge leverage.

Not viable yet, and the blocker is quantified: weekly mass change carries ±0.5 kg of water/glycogen noise
≈ **±3,850 kcal**, which swamps a week's real imbalance (~2,000 kcal), so blocks must be ≥4 weeks to damp
it — and intake history currently spans ~3.5 months (62 `kcalConsumed` entries from 2026-04-10), giving
only 3–4 blocks against 2 parameters. Revisit at **≥8 usable blocks (~8 months of logged intake) with
genuine volume variation**; the season engine's enforced deload cadence supplies that variation. If block
volume is near-constant, `ε` is unidentifiable — detect via low variance in `x` and fall back to the
one-parameter solve above.

**Confidence gates** (mirroring the app's existing calibrated-honesty tiers — a population default must
never masquerade as personalised):

| Tier | Window | Weigh-ins | Intake coverage |
|---|---|---|---|
| `high` | ≥42 d | ≥20 | ≥80% |
| `medium` | ≥28 d | ≥12 | ≥65% |
| `low` | anything less | | |

`low` **does not adopt** — `k` stays at `DEFAULT_NEAT_MULTIPLIER` (or the last adopted value) and the UI says
so. Recalculated on sync; `source: "override"` is never overwritten by a re-solve.

**Why this is the answer to "will the trend correct the multiplier?"** — it replaces a flat ±150 kcal patch
inside a ±300 kcal ceiling (D6) with a solved parameter that has no ceiling of that kind, and it reports the
one case the old mechanism silently swallowed: the books not balancing at all.

## 8. Goal-directed, asymmetric buffer

`adjustBuffer` is rewritten to correct toward a *desired* trend instead of toward zero:

```ts
// Desired trend from the targetWeight gap — the wiring D3 found missing. Rate caps are protective:
// loss faster than ~0.5-0.7% body mass/week costs lean mass and performance; gain is capped to limit
// fat accrual. Inside DEADBAND_KG the desired trend is 0 (maintain) so the athlete isn't nudged forever
// over rounding.
export const GOAL_DEADBAND_KG = 0.7;
export const MAX_LOSS_KG_PER_WEEK = 0.5;
export const MAX_GAIN_KG_PER_WEEK = 0.35;

// Proportional response, not a flat step: a trend error of e kg/week is e·7700/7 kcal/day of imbalance.
// Damped to avoid oscillation against a noisy trend, and clamped per adjustment.
export const CORRECTION_DAMPING = 0.5;
export const MAX_ADJUSTMENT_STEP_KCAL = 250;

// ASYMMETRY — the deliberate clinical choice. Losing faster than intended is the failure mode that
// hurts this athlete (LEA, blunted recovery), so it is corrected promptly. Gaining faster than intended
// is very often glycogen+water rebound from finally eating enough, so cutting is DAMPED HARDER and
// requires the trend to hold across two consecutive evaluations before it bites. Never let the app
// respond to the first week of successful refuelling by taking food away.
export const GAIN_SIDE_EXTRA_DAMPING = 0.5;
export const GAIN_SIDE_CONFIRMATIONS = 2;
```

`buffer` becomes **signed** — `BUFFER_MIN_KCAL` moves from `0` to `-500`, with the max held at `+600`. This
is what makes a deficit representable at all (fixes D2). Reaching either rail is surfaced rather than
silently swallowed (D6): the profile UI shows a "correction capped" state, because a pinned rail means the
model, not the athlete, is wrong.

## 9. Daily carbohydrate target

Pre-ride and in-ride carbs already exist; the daily total does not — and total kcal can be adequate while
carbohydrate is not, which is a direct route to poor glycogen restoration and the "recovery lags" symptom.
Standard load-scaled g/kg/day guidance, collapsed to single values the same way `inRideCarbTarget`
collapses its ranges:

| Day | g/kg/day |
|---|---|
| Rest | 4 |
| Recovery, or any ride < 60 min | 5 |
| Strength | 5 |
| Z2 60–120 min | 6 |
| Z2 > 120 min | 8 |
| Z2 ≥ 240 min | 10 |
| Threshold / VO2max / SIT ≤ 90 min | 7 |
| Threshold / VO2max / SIT > 90 min | 8 |
| RaceSim ≤ 120 min | 8 |
| RaceSim > 120 min | 10 |

**New consistency validator**, mirroring the non-blocking `validateNutrition` pattern: warn when
`dailyCarbG < preRideCarbs + inRideCarbsPerHour × rideHours` (plus the post-ride figure from
[lib/fuel-prompt.ts](../../../lib/fuel-prompt.ts)) — a daily total that can't cover its own session
prescription is a contradiction the athlete should see, not silently absorb.

No protein or fat targets, per §2. Protein is handled independently, and a fat number derived as a
remainder would be a fabricated prescription.

## 10. Under-fueling streak alert

Measured against **physiological need with the goal buffer excluded** — `k·RMR + exerciseKcal`. The existing
`BALANCE_LOW_BELOW` (0.9) is defined against the *buffered prescription*
([lib/nutrition.ts:254-265](../../../lib/nutrition.ts)), which answers "did I follow the plan," a different
question: an athlete deliberately and appropriately in a deficit would trip a health alert built on it.
Two genuinely distinct facts, so two named constants, each documented with its denominator:

```ts
export const UNDERFUEL_RATIO_BELOW = 0.95;   // vs. unbuffered maintenance — NOT BALANCE_LOW_BELOW
export const STREAK_ALERT_THRESHOLD = 3;
export const STREAK_WINDOW_LOGGED_DAYS = 7;
export const STREAK_MAX_LOOKBACK_DAYS = 14;
export const STREAK_MIN_LOGGED_DAYS = 4;
```

**Window definition — the most recent up to 7 *logged* days, none older than 14 calendar days, requiring
≥4.** Not "the last 7 calendar days": transfer from MyFitnessPal is batchy, so a calendar window can hold
2 logged days now and 7 a week later, making the alert fire and un-fire on transfer timing rather than on
eating. The 14-day lookback bounds staleness. `today` is excluded (still being logged), and a logged `0` is
treated as not-logged (no genuine zero-kcal day exists) — both conventions already established in this
module.

Below the floor it returns `null` and the tile says **"not enough transferred yet (n of 4 days)"** —
explicitly distinct from "you're fine." Because back-fill is normal, the alert legitimately appears
retroactively; the tile always shows the logged-day count so a change is explicable.

`today` comes from `localToday()` / `resolveToday()` per AGENTS.md. Note that
[lib/coach-snapshot.ts:173](../../../lib/coach-snapshot.ts) currently defaults to `utcToday()` for
`computeEnergyAvailability` while the tile passes `localToday()` — the new function must not copy the UTC
default, and that inconsistency is worth a follow-up of its own.

**UI:** `EnergyAvailabilityTile` gains the streak line plus, when `imbalance` is set, the reconciliation line
(e.g. *"your log implies ~600 kcal/day more deficit than your weight shows — likely under-counted"*). No new
tile. This pairing is deliberate: acting on an unreconciled deficit while weight is stable would drive
unintended gain, so the bias finding must be visible wherever the deficit is.

## 11. Migration & rollout

Existing profiles have hand-set `baseCalories`/`restDayTarget` and none of the RMR inputs. The new formula
activates only once all three are present — **truthy checks, never `=== null`**, since a JSON file written
before the fields existed parses them back as `undefined`:

```ts
const p = profile.performance;
if (p.dateOfBirth && p.heightCm && p.sex) { /* §5 unified formula */ }
else { /* legacy: baseCalories + burn + buffer, and the old flat restDayTarget branch */ }
```

The presence of the three fields is the gate; no separate migration-timestamp flag.

**The athlete's existing numbers are treated as data, not noise.** On first migration the UI shows both the
stored `baseCalories`/`restDayTarget` and the computed maintenance side by side, and asks before switching.
A hand-tuned value that demonstrably worked is evidence about this athlete's NEAT — the largest disagreement
between the two is itself a calibration hint, and silently overwriting it discards lived experience.

**Profile UI after migration:** `dateOfBirth`/`heightCm`/`sex` are the new editable fields; RMR, `k` (with
its confidence, source, and any `imbalance` finding), and today's maintenance are read-only computed displays showing
their breakdown; `buffer` (now signed) and `targetWeightKg` stay editable; `k` is overridable, which pins
`source: "override"`.

## 12. Affected call sites

Complete list — the first draft missed two:

- [lib/nutrition.ts](../../../lib/nutrition.ts) — §5–§10.
- [lib/nutrition-validate.ts](../../../lib/nutrition-validate.ts) — **missed in draft 1.** Calls
  `calculateDailyTarget` and, via `repairNutrition` ([app/api/generate/route.ts:448](../../../app/api/generate/route.ts)),
  **auto-rewrites kcal figures in generated plan text**. It is the enforcement layer for "the AI never
  invents nutrition numbers" and must move in lockstep with the signature change.
- [lib/trends.ts:103-141](../../../lib/trends.ts) — `needBurnByDate` gains the `calories` fallback and the
  net-of-resting subtraction; the `dayBurn > 0` rest-day branch at line 136 **disappears entirely** with the
  unified formula (D7). Its separate rides-only chart `burn` series is deliberately left alone.
- [lib/coach-snapshot.ts](../../../lib/coach-snapshot.ts) — `computeEnergyAvailability` inputs; new
  calibration/bias signals for the snapshot.
- [app/api/profile/route.ts:128-140](../../../app/api/profile/route.ts) — validation for the new fields; a
  now-signed `buffer` must stop being rejected by the positive-number guard.
- [components/AthleteProfileForm.tsx](../../../components/AthleteProfileForm.tsx),
  [components/dashboard/today.tsx](../../../components/dashboard/today.tsx) — §11 and §10 UI.
- [app/api/generate/route.ts:125](../../../app/api/generate/route.ts) — config assembly; `targetWeight` is
  now genuinely read.

**Historical figures shift.** Weekly need/ratio are recomputed from sync data on demand (not frozen), so
there is no ledger-immutability violation — but the same past week will report a different `need` after this
ships, and the `eaLevel` 25/40 bands plus `BALANCE_LOW_BELOW` were calibrated against gross, kJ-only burn.
Net-of-resting raises EA slightly (smaller subtrahend), making those bands marginally lenient. Re-examine
them once real numbers are in hand rather than pre-emptively retuning.

## 13. Edge cases & degradation

- Missing/zero/negative `weightKg`, `heightCm`, or derived age → "not migrated" (§11), never `NaN` or a
  negative target.
- Activity with neither `kj` nor `calories` → contributes `null`, not 0. Freddy shows **5 of 173** such
  activities; the day is marked burn-incomplete rather than silently reading as a rest day.
- An activity whose `kj` is present but zero (a trainer dropout, a paused recording) → treated as unknown,
  not as a genuine zero-energy session, so it cannot silently pull a day's target down.
- Calibration with `Δmass` from <3 weigh-ins, or a window where every weigh-in shares one day → `low`
  confidence, no adoption (reuses `weightTrendFromWellness`'s existing guards).
- Calibration when `Σ exercise` includes burn-incomplete days → those days are excluded from both sums so
  the identity stays balanced.
- Streak below the logged-day floor → `null` and an explicit "not enough transferred yet."
- `targetWeightKg` equal to current weight → desired trend 0, buffer converges to maintenance.
- Both buffer rails: surfaced as "correction capped," never silent.

## 14. Testing — `lib/nutrition.test.ts`, `lib/trends.test.ts`, `lib/nutrition-validate.test.ts`

- `restingMetabolicRate` against published reference values, both sexes; age derived from `dateOfBirth`
  (including a birthday-boundary case, so drift can't reappear).
- **D1 regression, the highest-value test:** for a matrix of session types and durations, assert
  `trainingDayTarget ≥ restDayTarget` for the same athlete — including Strength 45 min and Recovery 45 min,
  the two cases that fail today.
- **D7 regression:** adding a small off-bike activity to a rest day must never *lower* that day's target.
- Burn source: `kj` wins when both present; `calories` used when `kj` is null; neither → `null` (not 0).
- Calibration: a synthetic athlete with known `k` is recovered from constructed intake/weight/exercise
  series; `k` above/below the plausible band yields the correct `imbalance` direction and magnitude with `k`
  clamped, and **names both candidate causes** (log bias and conversion constant), never just one
  clamped; each confidence tier's gates; missing intake days imputed at the logged mean (not zero);
  `source: "override"` survives a re-solve.
- Buffer: proportional response to trend error; asymmetry (gain side damped harder and requiring
  `GAIN_SIDE_CONFIRMATIONS`); **glycogen-rebound scenario — a +1.5 kg/7d spike after an intake increase
  must not cut the buffer**; signed range including negative; rail-capped state reported.
- Streak: exactly `STREAK_ALERT_THRESHOLD` fires and one fewer does not; batchy transfer (2 logged days in
  the last 7, 7 within 14) still evaluates; nothing older than `STREAK_MAX_LOOKBACK_DAYS` counts; below the
  floor → `null`; today never counted; a logged `0` treated as not-logged.
- Migration gate: a profile object with the three fields `undefined` (simulating a pre-existing on-disk
  file) takes the legacy path — the specific gotcha this project has hit before.
- Daily carb target per the §9 table; the new consistency validator fires when the daily total can't cover
  its own session prescription.

## 15. Sequencing — this is four plans, not one

Scoped honestly, this spec is too large for a single implementation plan. Suggested split, ordered so each
phase is independently shippable and testable:

- **Phase 1 — the live defects.** Unified formula (§5), migration gate + side-by-side reconciliation (§11),
  and every call site in §12. Fixes D1, D2, D7 and deletes `restDayTarget`. Highest value per unit of risk:
  these are wrong *today*, independent of anything else here.
- **Phase 2 — off-bike expenditure.** §6 (`kj` primary, `calories` fallback) plus the
  live sync verification of the `calories` field and the `calories ÷ kj` ratio. Fixes D4, D5. Prerequisite
  for Phase 3 — calibration on biased expenditure would be worse than no calibration.
- **Phase 3 — calibration + reconciliation (§7) and the goal-directed buffer (§8).** Fixes D3, D6. The
  largest and most novel piece; deserves its own plan and its own live-data verification pass.
- **Phase 4 — daily carbs (§9) and the streak alert (§10).** Independent of Phases 2–3 except that the
  streak's denominator wants a calibrated `k` to be meaningful, so it lands last.

Phases 1 and 2 together already remove every confirmed defect. Phases 3 and 4 are the new capability.

## 16. Out of scope (this round)

Protein and fat targets; within-day energy timing; an athlete-specific RMR equation; Pw:HR-based LEA
corroboration; RED-S referral signposting; native intake logging; a live "today's target" tile;
wearable-sourced expenditure; automating the MyFitnessPal → Intervals.icu transfer (which would remove the
gap §10 is designed to tolerate); retuning `eaLevel`'s bands or `BALANCE_LOW_BELOW` — all named constants,
revisited once there are real numbers to look at.
