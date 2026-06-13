// Deterministic nutrition formula. Pure TypeScript — no AI involvement.
// The AI receives this module's output as pre-computed values and only
// rephrases them in natural language inside workout descriptions.
import type { WellnessEntry, WorkoutType } from "./types";

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
  postRideCarbs: number; // grams
  postRideProtein: number; // grams
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

const HARD_TYPES: ReadonlySet<WorkoutType> = new Set(["Threshold", "VO2max", "SIT"]);
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
  VO2max: 0.75,
  SIT: 0.68,
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
      postRideCarbs: 0,
      postRideProtein: 0,
      bufferApplied: 0,
    };
  }
  const { bufferApplied } = adjustBuffer(config.buffer, weightTrend7Day);
  return {
    dailyTarget: roundTo(config.baseCalories + activityBurnKcal + bufferApplied, 10),
    preRideCarbs: workout ? preRideCarbTarget(workout.durationMin, workout.type, config.weight) : 0,
    inRideCarbsPerHour: workout ? inRideCarbTarget(workout.durationMin, workout.type) : 0,
    postRideCarbs: roundTo(1.1 * config.weight, 5), // 1.0–1.2 g/kg midpoint
    postRideProtein: 30, // 25–35 g midpoint
    bufferApplied,
  };
}

// 7-day weight trend from synced wellness data: latest weigh-in minus the
// weigh-in closest to 7 days earlier (accepted window 4–10 days back).
export function weightTrendFromWellness(wellness: WellnessEntry[]): number | null {
  const weighIns = wellness
    .filter((w): w is WellnessEntry & { weightKg: number } => w.weightKg !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weighIns.length < 2) return null;
  const latest = weighIns[weighIns.length - 1];
  const latestMs = Date.parse(latest.date);
  let reference: (typeof weighIns)[number] | null = null;
  let bestDistance = Infinity;
  for (const entry of weighIns.slice(0, -1)) {
    const daysBack = (latestMs - Date.parse(entry.date)) / 86_400_000;
    if (daysBack < 4 || daysBack > 10) continue;
    const distance = Math.abs(daysBack - 7);
    if (distance < bestDistance) {
      bestDistance = distance;
      reference = entry;
    }
  }
  if (!reference) return null;
  return Math.round((latest.weightKg - reference.weightKg) * 10) / 10;
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
    "| Session type | Duration (min) | Est. burn (kcal) | Daily target (kcal) | Pre-ride carbs (g) | In-ride carbs (g/hr) | Post-ride carbs (g) | Post-ride protein (g) |\n" +
    "|---|---|---|---|---|---|---|---|";
  const lines = rows.map(
    (r) =>
      `| ${r.type} | ${r.durationMin} | ${r.estBurnKcal} | ${r.plan.dailyTarget} | ${r.plan.preRideCarbs} | ${r.plan.inRideCarbsPerHour} | ${r.plan.postRideCarbs} | ${r.plan.postRideProtein} |`
  );
  return [header, ...lines].join("\n");
}
