// Deterministic nutrition formula. Pure TypeScript — no AI involvement.
// The AI receives this module's output as pre-computed values and only
// rephrases them in natural language inside workout descriptions.
import type { ActivitySummary, WellnessEntry, WorkoutType } from "./types";
import { median } from "./stats";

export interface ActiveBurn {
  kcal: number;
  legacy: boolean; // true when derived from kj because the activity predates activeBurnKcal
}

/**
 * The ONE energy-expended accessor, so "use the source's active-burn figure verbatim" has a single
 * implementation nothing can drift from. Intervals.icu already reports the activity's active calorie
 * burn; NodeVelo consumes that number unmodified.
 *
 * The legacy branch exists only for activities synced before `activeBurnKcal` did — they carry just `kj`
 * (mechanical work), and treating it as kcal was the app's previous behaviour app-wide. It is flagged so
 * callers can surface the approximation rather than silently mixing bases, and it shrinks on its own as
 * the sync window rolls forward.
 *
 * Returns null — never 0 — when neither figure exists: a day whose burn is unknown must not read as a
 * rest day.
 */
export function activeBurn(a: Pick<ActivitySummary, "activeBurnKcal" | "kj">): ActiveBurn | null {
  if (a.activeBurnKcal !== null) return { kcal: a.activeBurnKcal, legacy: false };
  if (a.kj !== null) return { kcal: a.kj, legacy: true };
  return null;
}

/**
 * Mifflin-St Jeor. Predicts RESTING metabolic rate (RMR/REE) — not BMR, which requires stricter
 * measurement conditions and runs ~10% lower; the naming matters because the two are not interchangeable.
 *
 * `sex` is a formula input: the equation's constant term is binary. It is not a statement about identity.
 *
 * Deliberately isolated in one function so the equation can be swapped without touching a single caller.
 * Mifflin under-predicts RMR in trained endurance athletes by ~5-10%, but a calibrated NEAT multiplier
 * (spec §7, Phase 3) absorbs a constant under-prediction by construction, so swapping equations is
 * deferred rather than done here.
 */
export function restingMetabolicRate(
  weightKg: number,
  heightCm: number,
  ageYears: number,
  sex: "male" | "female"
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return Math.round(sex === "male" ? base + 5 : base - 161);
}

// Prior for the NEAT multiplier before per-athlete calibration (Phase 3) has enough data. Covers
// RMR-multiplier territory ONLY: non-exercise activity plus the thermic effect of food. Structured
// exercise is never in here — it arrives separately as activeBurnKcal, and double-counting it would
// inflate every training day.
export const DEFAULT_NEAT_MULTIPLIER = 1.2;

export interface AthleteNutritionConfig {
  baseCalories: number; // default: 2000
  restDayTarget: number; // default: 2600
  buffer: number; // configurable; adjusts based on weight trend
  weight: number; // kg, from last sync
  targetWeight: number; // kg, from athlete profile
}

export interface WorkoutNutritionPlan {
  dailyTarget: number; // total kcal for the day
  preRideCarbs: number; // grams
  inRideCarbsPerHour: number; // grams/hr (0 if < 60 min ride)
  bufferApplied: number; // actual buffer used (may differ from config if weight-adjusted)
}

export interface BufferAdjustment {
  bufferApplied: number;
  delta: number; // kcal added to / removed from the configured buffer
  reason: string; // human-readable, shown in the profile UI
  capped: boolean; // true when a rail was hit — surfaced, never swallowed
}

export interface WorkoutContext {
  type: WorkoutType;
  durationMin: number;
}

// The buffer is SIGNED. A floor of 0 (the previous value) meant dailyTarget could never fall below
// base + burn ≈ maintenance, so the formula was structurally incapable of prescribing a deficit — which
// is why targetWeight was never wired into it: there was nowhere to put it.
export const BUFFER_MIN_KCAL = -500;
export const BUFFER_MAX_KCAL = 600;

// Inside the deadband the desired trend is 0, so the athlete is not nudged forever over rounding noise.
export const GOAL_DEADBAND_KG = 0.7;
// Protective rate caps: loss faster than ~0.5 kg/week costs lean mass and performance; gain is capped to
// limit fat accrual.
export const MAX_LOSS_KG_PER_WEEK = 0.5;
export const MAX_GAIN_KG_PER_WEEK = 0.35;

// Proportional response: a trend error of e kg/week is e × 7700 ÷ 7 kcal/day of imbalance. Damped to
// avoid oscillating against a noisy trend, and clamped per adjustment. The previous mechanism applied a
// flat ±150 kcal to a 0.3 kg/7d threshold worth ≈330 kcal/day — a ~2× under-correction.
export const KCAL_PER_KG_TISSUE = 7700;
export const CORRECTION_DAMPING = 0.5;
export const MAX_ADJUSTMENT_STEP_KCAL = 250;

// ASYMMETRY, the deliberate clinical choice. Losing faster than intended is the failure mode that hurts
// an underfuelled athlete, so it is corrected promptly off the responsive short trend. Gaining faster is
// very often glycogen + bound water from finally eating enough (~3 g water per g glycogen, so 1.5-2 kg
// within days at zero fat gain), so a cut is damped harder AND requires the long trend to confirm it.
// Never respond to the first week of successful refuelling by taking food away.
export const GAIN_SIDE_EXTRA_DAMPING = 0.5;

const HARD_TYPES: ReadonlySet<WorkoutType> = new Set(["Threshold", "VO2max", "SIT", "RaceSim"]);
const NON_RIDE_TYPES: ReadonlySet<WorkoutType> = new Set(["Rest", "Strength"]);

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

// The trend the athlete SHOULD be on, in kg/7d, derived from the gap to target weight. This is the
// wiring that was missing: the previous mechanism compared the observed trend against zero, so it drove
// toward weight stability regardless of which way the athlete wanted to go.
export function desiredWeightTrend(currentKg: number, targetKg: number): number {
  // Rounded before comparison: `75.7 - 75` is 0.7000000000000028 in IEEE arithmetic, so an exact-boundary
  // gap would otherwise fall outside the deadband it is supposed to sit on.
  const gap = Math.round((targetKg - currentKg) * 100) / 100; // positive → needs to gain
  if (Math.abs(gap) <= GOAL_DEADBAND_KG) return 0;
  return gap > 0 ? Math.min(MAX_GAIN_KG_PER_WEEK, gap) : Math.max(-MAX_LOSS_KG_PER_WEEK, gap);
}

/**
 * Correct the buffer toward the athlete's INTENDED trend.
 *
 * `trendShort` (~14-day regression window) is the responsive signal and drives the loss side.
 * `trendLong` (~28-day window) is the conservative signal and must confirm before any cut — a stateless
 * substitute for a persisted confirmation counter, which adjustBuffer cannot carry because it is a pure
 * function called on-demand from GET handlers with no write path.
 */
export function adjustBuffer(
  buffer: number,
  trendShort: number | null,
  trendLong: number | null,
  currentKg: number,
  targetKg: number
): BufferAdjustment {
  const settle = (delta: number, reason: string): BufferAdjustment => {
    const unclamped = buffer + delta;
    const bufferApplied = Math.min(BUFFER_MAX_KCAL, Math.max(BUFFER_MIN_KCAL, unclamped));
    const capped = bufferApplied !== unclamped;
    return {
      bufferApplied,
      delta: bufferApplied - buffer,
      capped,
      reason: capped
        ? `${reason} Capped at ${bufferApplied} kcal (allowed range ${BUFFER_MIN_KCAL}–${BUFFER_MAX_KCAL}) — a pinned rail means the model, not the athlete, needs revisiting.`
        : reason,
    };
  };

  if (trendShort === null) {
    return settle(0, "Not enough weigh-ins yet to read a weight trend — buffer left as configured.");
  }

  const desired = desiredWeightTrend(currentKg, targetKg);
  const errShort = trendShort - desired; // positive → gaining faster than intended
  const goalNote = desired === 0 ? "holding weight" : `aiming for ${fmtKg(desired)} kg/week`;

  let err: number;
  let damping: number;
  let reportedTrend: number;
  if (errShort > 0) {
    if (trendLong === null) {
      return settle(
        0,
        `Weight up ${fmtKg(trendShort)} kg/week short-term while ${goalNote}, but not confirmed over the longer window (early gain after refuelling is largely glycogen and water) — no cut.`
      );
    }
    const errLong = trendLong - desired;
    if (errLong <= 0) {
      return settle(
        0,
        `Short-term weight up ${fmtKg(trendShort)} kg/week but the longer trend (${fmtKg(trendLong)} kg/week) does not confirm it while ${goalNote} — not confirmed, no cut.`
      );
    }
    // The magnitude comes from the MORE CONSERVATIVE of the two errors, not from errLong alone. The long
    // window is backward-looking: an athlete who gained fast and has since settled to the intended rate
    // would otherwise keep taking a full cut driven by stale data — which is precisely the trajectory of
    // someone recovering from underfuelling. The long window's job is to CONFIRM the gain is real rather
    // than glycogen, not to size the response.
    err = Math.min(errShort, errLong);
    reportedTrend = err === errShort ? trendShort : trendLong;
    damping = CORRECTION_DAMPING * GAIN_SIDE_EXTRA_DAMPING;
  } else {
    err = errShort;
    reportedTrend = trendShort;
    damping = CORRECTION_DAMPING;
  }

  const imbalanceKcalPerDay = (err * KCAL_PER_KG_TISSUE) / 7;
  const raw = -imbalanceKcalPerDay * damping;
  const stepped = Math.max(-MAX_ADJUSTMENT_STEP_KCAL, Math.min(MAX_ADJUSTMENT_STEP_KCAL, raw));
  const delta = Math.round(stepped / 10) * 10;
  const direction = delta > 0 ? "increased" : delta < 0 ? "decreased" : "unchanged";
  return settle(
    delta,
    `Weight trending ${fmtKg(reportedTrend)} kg/week while ${goalNote} — buffer ${direction}${delta === 0 ? "" : ` by ${Math.abs(delta)} kcal`}.`
  );
}

function fmtKg(kg: number): string {
  const rounded = Math.round(kg * 100) / 100;
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

// In-ride carb targets per the spec's table, collapsed to single values
// (midpoint of each range) because the plan interface carries one number.
export function inRideCarbTarget(durationMin: number, type: WorkoutType): number {
  if (NON_RIDE_TYPES.has(type) || durationMin < 60) return 0;
  const hard = HARD_TYPES.has(type);
  if (durationMin <= 90) return hard ? 75 : 38; // 60–90 g/hr vs 30–45 g/hr
  return hard ? 105 : 75; // >90 min: 90–120 g/hr vs 60–90 g/hr
}

// Pre-ride carbs: 1.0 g/kg for easy sessions, 1.5 g/kg for hard or long ones.
export function preRideCarbTarget(durationMin: number, type: WorkoutType, weightKg: number): number {
  if (NON_RIDE_TYPES.has(type)) return 0;
  const gramsPerKg = HARD_TYPES.has(type) || durationMin > 90 ? 1.5 : 1.0;
  return roundTo(gramsPerKg * weightKg, 5);
}

// Estimated session burn for *planned* workouts (no kJ exists yet).
// kJ ≈ kcal for cycling (1:1). Average power = session intensity factor × FTP,
// where the factor reflects the whole session including recoveries.
const SESSION_INTENSITY_FACTOR: Record<Exclude<WorkoutType, "Rest" | "Strength">, number> = {
  Recovery: 0.5,
  Z2: 0.65,
  Threshold: 0.78,
  // VO2max sits BELOW Threshold deliberately (not a typo): VO2 work is short hard reps with long
  // recoveries, so the WHOLE-session average power is lower than a sustained threshold block.
  VO2max: 0.75,
  SIT: 0.68,
  RaceSim: 0.82, // hard + surgy; whole-session average sits above threshold work
};

const STRENGTH_KCAL_PER_MIN = 5;

export function estimateWorkoutBurnKcal(type: WorkoutType, durationMin: number, ftp: number): number {
  if (type === "Rest") return 0;
  if (type === "Strength") return Math.round(STRENGTH_KCAL_PER_MIN * durationMin);
  const avgWatts = ftp * SESSION_INTENSITY_FACTOR[type];
  return Math.round((avgWatts * durationMin * 60) / 1000); // joules→kJ≈kcal
}

/**
 * Core formula. Training day: baseCalories + activityBurnKcal + adjusted buffer.
 * Rest day: restDayTarget flat, no buffer.
 * The optional workout context fills the pre/in-ride carb targets, which need
 * duration and intensity; without it they are 0.
 */
export function calculateDailyTarget(
  activityBurnKcal: number, // kJ from Intervals.icu ≈ kcal (1:1 for cyclists)
  isRestDay: boolean,
  config: AthleteNutritionConfig,
  weightTrend7Day: number, // kg change over last 7 days; negative = losing weight
  workout?: WorkoutContext
): WorkoutNutritionPlan {
  if (isRestDay) {
    return {
      dailyTarget: Math.round(config.restDayTarget),
      preRideCarbs: 0,
      inRideCarbsPerHour: 0,
      bufferApplied: 0,
    };
  }
  const { bufferApplied } = adjustBuffer(config.buffer, weightTrend7Day);
  return {
    dailyTarget: roundTo(config.baseCalories + activityBurnKcal + bufferApplied, 10),
    preRideCarbs: workout ? preRideCarbTarget(workout.durationMin, workout.type, config.weight) : 0,
    inRideCarbsPerHour: workout ? inRideCarbTarget(workout.durationMin, workout.type) : 0,
    bufferApplied,
  };
}

export const WEIGHT_TREND_WINDOW_DAYS = 14; // default regression window; the gain side asks for 28
export const WEIGHT_TREND_LONG_WINDOW_DAYS = 28;
const WEIGHT_TREND_MIN_POINTS = 3; // need ≥3 weigh-ins before a slope is meaningful (and outlier-resistant)

// 7-day weight trend (kg/7d, + = gaining) from synced wellness. A Theil–Sen slope — the median of every
// pair's slope — over every weigh-in in the trailing ~14 days. Daily body weight swings ±0.5–1 kg
// (water/glycogen/food), so a single noisy reading must not steer the trend. Theil–Sen is genuinely robust
// to that: unlike OLS it isn't dragged by a high-leverage outlier at the window EDGE (the oldest weigh-in,
// or the latest), which is exactly where OLS leverage is highest (RV2-6). Handles sparse logging (e.g.
// 5×/week) natively via slopes over irregular dates. Null below the sample floor or when every weigh-in
// shares one day (no pair spans time).
export function weightTrendFromWellness(
  wellness: WellnessEntry[],
  windowDays: number = WEIGHT_TREND_WINDOW_DAYS
): number | null {
  const weighIns = wellness
    .filter((w): w is WellnessEntry & { weightKg: number } => w.weightKg !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weighIns.length < WEIGHT_TREND_MIN_POINTS) return null;
  const latestMs = Date.parse(weighIns[weighIns.length - 1].date);
  // x = days relative to the latest weigh-in (≤ 0); y = kg. Keep only the trailing window.
  const pts = weighIns
    .map((w) => ({ x: (Date.parse(w.date) - latestMs) / 86_400_000, y: w.weightKg }))
    .filter((p) => p.x >= -windowDays);
  if (pts.length < WEIGHT_TREND_MIN_POINTS) return null;
  const slopes: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[j].x !== pts[i].x) slopes.push((pts[j].y - pts[i].y) / (pts[j].x - pts[i].x));
    }
  }
  if (slopes.length === 0) return null; // all weigh-ins on one day → no slope
  return Math.round(median(slopes) * 7 * 10) / 10; // express as kg/7d, 1 decimal
}

// ---------- Energy availability (deterministic proxy) ----------

export interface EnergyAvailability {
  eaKcalPerKg: number; // trailing-window mean of (logged intake − exercise burn) ÷ body mass, kcal/kg/day
  daysUsed: number; // complete logged days backing the mean
  trend: number | null; // kcal/kg vs the prior equal window (null if the prior window is too sparse)
}

const EA_MIN_DAYS = 3; // a few logged days before a trailing EA means anything (mirrors the other baselines)

// Energy-availability PROXY: per-kg-body-mass energy left after exercise, averaged over recent COMPLETE
// days. Deliberately simple ((intake − exercise burn)/kg, kJ≈kcal as elsewhere — burn sums ALL activities
// carrying an active-burn figure, not only rides; activities with no energy data contribute 0) and honest about limits:
//   - TODAY is excluded — its intake is still being logged, so a partial day would read falsely low.
//   - it uses body weight, not fat-free mass, so it is NOT the clinical 30/45 kcal/kg·FFM threshold — it's
//     a trend signal ("am I fuelling more or less than usual?"), which is why this returns a delta, not a band.
//   - under-logged intake reads low (the UI says so). Needs ≥ EA_MIN_DAYS complete logged days, else null
//     (withheld, not a flaky single-day number). A personalised "adequate" line is Track C / §6 calibration.
export function computeEnergyAvailability(
  wellness: WellnessEntry[],
  activities: Array<{ date: string; activeBurnKcal: number | null; kj: number | null }>,
  today: string,
  windowDays = 7,
): EnergyAvailability | null {
  const burnByDate = new Map<string, number>();
  for (const a of activities) {
    const burn = activeBurn(a);
    if (burn === null) continue; // unknown, not zero
    burnByDate.set(a.date, (burnByDate.get(a.date) ?? 0) + burn.kcal);
  }
  // Weigh-ins ascending; a day with intake but no weight anchors to the nearest weigh-in ON OR BEFORE it
  // (never a future weight — EC-4), falling back to the earliest when the day predates them all (the
  // physiologyAsOf convention). Weight moves slowly, so this only nudges edge days, but it keeps a past
  // day's EA from being divided by a weight logged after it.
  const weighIns = wellness
    .filter((w) => w.weightKg !== null)
    .map((w) => ({ date: w.date, kg: w.weightKg as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weighIns.length === 0) return null;
  const weightAsOf = (date: string): number => {
    let kg = weighIns[0].kg; // before the first weigh-in → anchor to the earliest
    for (const wi of weighIns) {
      if (wi.date <= date) kg = wi.kg;
      else break;
    }
    return kg;
  };

  const dayBefore = (n: number) => new Date(Date.parse(today) - n * 86_400_000).toISOString().slice(0, 10);
  const cutCur = dayBefore(windowDays); // [cutCur, today)
  const cutPrev = dayBefore(windowDays * 2); // [cutPrev, cutCur)

  const cur: number[] = [];
  const prev: number[] = [];
  for (const w of wellness) {
    // Complete logged days only. A 0 (or negative) daily intake is treated as NOT logged, not a real fasted
    // DAY: Intervals sends null when absent, a daily total is never genuinely zero (you eat off the bike), and
    // counting it would give a misleading negative EA that drags the mean. (Differs from FUEL-1, which keeps a
    // logged 0 g of *per-ride* carbs — you can ride fasted, but you can't have a 0-kcal day.)
    if (w.date >= today || w.kcalConsumed === null || w.kcalConsumed <= 0) continue;
    const weight = w.weightKg ?? weightAsOf(w.date);
    if (weight <= 0) continue;
    const ea = (w.kcalConsumed - (burnByDate.get(w.date) ?? 0)) / weight;
    if (w.date >= cutCur) cur.push(ea);
    else if (w.date >= cutPrev) prev.push(ea);
  }
  if (cur.length < EA_MIN_DAYS) return null;
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const curMean = mean(cur);
  return {
    eaKcalPerKg: Math.round(curMean),
    daysUsed: cur.length,
    trend: prev.length >= EA_MIN_DAYS ? Math.round(curMean - mean(prev)) : null,
  };
}

// Soft, NON-CLINICAL read of an EA number, so the tile says what a value MEANS instead of a bare figure
// (FB-2026-06-30). The clinical 30/45 kcal/kg cutoffs are defined on FAT-FREE mass; this proxy divides by
// TOTAL body weight (a larger denominator → a structurally lower number), so the bands are shifted down to
// a body-weight basis and kept deliberately coarse — a rough "is there much spare energy?" reference, NOT a
// diagnosis. Under-logged intake reads low. A personalised line is still Track C / §6 calibration.
export type EaLevel = "low" | "adequate" | "ample";
export function eaLevel(eaKcalPerKg: number): EaLevel {
  if (eaKcalPerKg < 25) return "low";
  if (eaKcalPerKg < 40) return "adequate";
  return "ample";
}

// Weekly energy-balance band (§6): intake ÷ the app's OWN prescribed need for the same logged days.
// Unlike eaLevel (a kcal/kg body-weight proxy), this is a precise ratio against the deterministic
// daily-target formula — so 1.0 means "ate what the coach's formula advised" (which already embeds the
// weight-goal buffer), not raw thermodynamic balance. Bands deliberately coarse; the personalised
// adequate line is Track C calibration.
export const BALANCE_LOW_BELOW = 0.9;
export const BALANCE_AMPLE_ABOVE = 1.05;
export function balanceLevel(ratio: number): EaLevel {
  if (ratio < BALANCE_LOW_BELOW) return "low";
  if (ratio > BALANCE_AMPLE_ABOVE) return "ample";
  return "adequate";
}

// ---------- Reference table injected into the AI prompt ----------

export interface NutritionReferenceRow {
  type: WorkoutType;
  durationMin: number;
  estBurnKcal: number;
  plan: WorkoutNutritionPlan;
}

const REFERENCE_DURATIONS: Record<WorkoutType, number[]> = {
  Rest: [0],
  Recovery: [45, 60, 90],
  Z2: [60, 90, 120, 150, 180, 240],
  Threshold: [60, 75, 90, 120],
  VO2max: [60, 75, 90],
  SIT: [45, 60, 75, 90],
  RaceSim: [60, 90, 120],
  Strength: [45, 60],
};

export function buildNutritionReferenceRows(
  config: AthleteNutritionConfig,
  ftp: number,
  weightTrend7Day: number
): NutritionReferenceRow[] {
  const rows: NutritionReferenceRow[] = [];
  for (const [type, durations] of Object.entries(REFERENCE_DURATIONS) as [WorkoutType, number[]][]) {
    for (const durationMin of durations) {
      const estBurnKcal = estimateWorkoutBurnKcal(type, durationMin, ftp);
      rows.push({
        type,
        durationMin,
        estBurnKcal,
        plan: calculateDailyTarget(estBurnKcal, type === "Rest", config, weightTrend7Day, {
          type,
          durationMin,
        }),
      });
    }
  }
  return rows;
}

export function nutritionTableMarkdown(rows: NutritionReferenceRow[]): string {
  const header =
    "| Session type | Duration (min) | Est. burn (kcal) | Daily target (kcal) | Pre-ride carbs (g) | In-ride carbs (g/hr) |\n" +
    "|---|---|---|---|---|---|";
  const lines = rows.map(
    (r) =>
      `| ${r.type} | ${r.durationMin} | ${r.estBurnKcal} | ${r.plan.dailyTarget} | ${r.plan.preRideCarbs} | ${r.plan.inRideCarbsPerHour} |`
  );
  return [header, ...lines].join("\n");
}
