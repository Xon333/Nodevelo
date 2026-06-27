// Deterministic nutrition formula. Pure TypeScript — no AI involvement.
// The AI receives this module's output as pre-computed values and only
// rephrases them in natural language inside workout descriptions.
import type { WellnessEntry, WorkoutType } from "./types";
import { median } from "./stats";

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
}

export interface WorkoutContext {
  type: WorkoutType;
  durationMin: number;
}

const BUFFER_STEP_KCAL = 150;
const BUFFER_MIN_KCAL = 0;
const BUFFER_MAX_KCAL = 600;
const WEIGHT_TREND_THRESHOLD_KG = 0.3;

const HARD_TYPES: ReadonlySet<WorkoutType> = new Set(["Threshold", "VO2max", "SIT", "RaceSim"]);
const NON_RIDE_TYPES: ReadonlySet<WorkoutType> = new Set(["Rest", "Strength"]);

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

export function adjustBuffer(buffer: number, weightTrend7Day: number): BufferAdjustment {
  let delta = 0;
  let reason = `Weight stable over last 7 days (${formatTrend(weightTrend7Day)} kg, within ±${WEIGHT_TREND_THRESHOLD_KG} kg) — buffer unchanged.`;
  if (weightTrend7Day < -WEIGHT_TREND_THRESHOLD_KG) {
    delta = BUFFER_STEP_KCAL;
    reason = `Weight down ${formatTrend(weightTrend7Day)} kg over last 7 days (losing too fast) — buffer increased by ${BUFFER_STEP_KCAL} kcal.`;
  } else if (weightTrend7Day > WEIGHT_TREND_THRESHOLD_KG) {
    delta = -BUFFER_STEP_KCAL;
    reason = `Weight up ${formatTrend(weightTrend7Day)} kg over last 7 days (gaining too fast) — buffer decreased by ${BUFFER_STEP_KCAL} kcal.`;
  }
  const unclamped = buffer + delta;
  const bufferApplied = Math.min(BUFFER_MAX_KCAL, Math.max(BUFFER_MIN_KCAL, unclamped));
  if (bufferApplied !== unclamped) {
    reason += ` Capped at ${bufferApplied} kcal (allowed range ${BUFFER_MIN_KCAL}–${BUFFER_MAX_KCAL}).`;
  }
  return { bufferApplied, delta, reason };
}

function formatTrend(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
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

const WEIGHT_TREND_WINDOW_DAYS = 14; // regress over the trailing fortnight
const WEIGHT_TREND_MIN_POINTS = 3; // need ≥3 weigh-ins before a slope is meaningful (and outlier-resistant)

// 7-day weight trend (kg/7d, + = gaining) from synced wellness. A Theil–Sen slope — the median of every
// pair's slope — over every weigh-in in the trailing ~14 days. Daily body weight swings ±0.5–1 kg
// (water/glycogen/food), so a single noisy reading must not steer the trend. Theil–Sen is genuinely robust
// to that: unlike OLS it isn't dragged by a high-leverage outlier at the window EDGE (the oldest weigh-in,
// or the latest), which is exactly where OLS leverage is highest (RV2-6). Handles sparse logging (e.g.
// 5×/week) natively via slopes over irregular dates. Null below the sample floor or when every weigh-in
// shares one day (no pair spans time).
export function weightTrendFromWellness(wellness: WellnessEntry[]): number | null {
  const weighIns = wellness
    .filter((w): w is WellnessEntry & { weightKg: number } => w.weightKg !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weighIns.length < WEIGHT_TREND_MIN_POINTS) return null;
  const latestMs = Date.parse(weighIns[weighIns.length - 1].date);
  // x = days relative to the latest weigh-in (≤ 0); y = kg. Keep only the trailing window.
  const pts = weighIns
    .map((w) => ({ x: (Date.parse(w.date) - latestMs) / 86_400_000, y: w.weightKg }))
    .filter((p) => p.x >= -WEIGHT_TREND_WINDOW_DAYS);
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
// days. Deliberately simple ((intake − ride burn)/kg, kJ≈kcal as elsewhere) and honest about its limits:
//   - TODAY is excluded — its intake is still being logged, so a partial day would read falsely low.
//   - it uses body weight, not fat-free mass, so it is NOT the clinical 30/45 kcal/kg·FFM threshold — it's
//     a trend signal ("am I fuelling more or less than usual?"), which is why this returns a delta, not a band.
//   - under-logged intake reads low (the UI says so). Needs ≥ EA_MIN_DAYS complete logged days, else null
//     (withheld, not a flaky single-day number). A personalised "adequate" line is Track C / §6 calibration.
export function computeEnergyAvailability(
  wellness: WellnessEntry[],
  activities: Array<{ date: string; kj: number | null }>,
  today: string,
  windowDays = 7,
): EnergyAvailability | null {
  const burnByDate = new Map<string, number>();
  for (const a of activities) {
    if (a.kj == null) continue;
    burnByDate.set(a.date, (burnByDate.get(a.date) ?? 0) + a.kj);
  }
  // Most recent weigh-in as the fallback for a day with logged intake but no weight that day.
  const fallbackWeight = wellness
    .filter((w) => w.weightKg !== null)
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg ?? null;
  if (fallbackWeight === null) return null;

  const dayBefore = (n: number) => new Date(Date.parse(today) - n * 86_400_000).toISOString().slice(0, 10);
  const cutCur = dayBefore(windowDays); // [cutCur, today)
  const cutPrev = dayBefore(windowDays * 2); // [cutPrev, cutCur)

  const cur: number[] = [];
  const prev: number[] = [];
  for (const w of wellness) {
    if (w.date >= today || w.kcalConsumed === null) continue; // complete logged days only
    const weight = w.weightKg ?? fallbackWeight;
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
