// Deterministic nutrition formula. Pure TypeScript — no AI involvement.
// The AI receives this module's output as pre-computed values and only
// rephrases them in natural language inside workout descriptions.
import { ageYearsFrom } from "./date";
import type { ActivitySummary, AthleteProfile, EnergyImbalanceFinding, NeatCalibration, WellnessEntry, WorkoutType } from "./types";
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
  // `!= null`, never `!== null`: a synced activity written before activeBurnKcal existed parses the
  // field back as `undefined`, not `null` — an equality check against null alone would miss it and
  // fall through with `{ kcal: undefined }`, producing NaN downstream instead of the legacy branch.
  if (a.activeBurnKcal != null) return { kcal: a.activeBurnKcal, legacy: false };
  if (a.kj != null) return { kcal: a.kj, legacy: true };
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

/**
 * `derived` is the real model: dailyTarget = (neatMultiplier × rmr) + activeBurnKcal + buffer. Exactly one
 * term is estimated; the burn is measured and the buffer is an explicit goal choice.
 *
 * `legacy` preserves a pre-migration profile's hand-set baseCalories/restDayTarget until the athlete
 * supplies date of birth, height and sex. Guessing an equivalence between the two shapes would be worse
 * than keeping current behaviour, so the old numbers are honoured verbatim — with one cheap, strictly
 * food-increasing correction for D1 (see calculateDailyTarget).
 */
export type NutritionModel =
  | {
      kind: "derived";
      rmr: number;
      neatMultiplier: number;
      weightKg: number;
      targetWeightKg: number;
      buffer: number;
    }
  | {
      kind: "legacy";
      baseCalories: number;
      restDayTarget: number;
      weightKg: number;
      targetWeightKg: number;
      buffer: number;
    };

export interface WorkoutNutritionPlan {
  dailyTarget: number; // total kcal for the day
  maintenanceKcal: number; // the pre-buffer figure, surfaced so the buffer's effect is auditable
  preRideCarbs: number; // grams
  inRideCarbsPerHour: number; // grams/hr (0 if < 60 min ride)
  bufferApplied: number; // signed
}

export interface BufferAdjustment {
  bufferApplied: number;
  delta: number; // kcal added to / removed from the configured buffer
  reason: string; // human-readable, shown in the profile UI
  capped: boolean; // true when a rail was hit — surfaced, never swallowed
  // true when MAX_ADJUSTMENT_STEP_KCAL bound the per-adjustment correction. Distinct from `capped`
  // (the outer BUFFER_MIN/MAX_KCAL rails): this fires on the SIZE of a single correction, regardless of
  // where the resulting buffer lands, so a large shortfall reads identically to a small one unless this
  // is checked separately.
  stepClipped: boolean;
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
export function desiredWeightTrend(
  currentKg: number,
  targetKg: number,
  configuredRate: number | null = null
): number {
  // Rounded before comparison: `75.7 - 75` is 0.7000000000000028 in IEEE arithmetic, so an exact-boundary
  // gap would otherwise fall outside the deadband it is supposed to sit on.
  const gap = Math.round((targetKg - currentKg) * 100) / 100; // positive → needs to gain
  if (Math.abs(gap) <= GOAL_DEADBAND_KG) return 0;
  const cap = gap > 0 ? MAX_GAIN_KG_PER_WEEK : MAX_LOSS_KG_PER_WEEK;
  // Direction is never taken from the stored rate — only its magnitude. A rate left over from a previous
  // goal must not be able to invert which way the athlete is being steered.
  const magnitude =
    configuredRate != null && Number.isFinite(configuredRate) && configuredRate !== 0
      ? Math.min(Math.abs(configuredRate), cap)
      : Math.min(Math.abs(gap), cap);
  return gap > 0 ? magnitude : -magnitude;
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
  targetKg: number,
  configuredRate: number | null = null
): BufferAdjustment {
  const settle = (delta: number, reason: string, stepClipped = false): BufferAdjustment => {
    const unclamped = buffer + delta;
    const bufferApplied = Math.min(BUFFER_MAX_KCAL, Math.max(BUFFER_MIN_KCAL, unclamped));
    const capped = bufferApplied !== unclamped;
    // Two independent facts, never merged: stepClipped fires on the SIZE of this one correction
    // (MAX_ADJUSTMENT_STEP_KCAL), capped fires on where the resulting buffer LANDS (the outer
    // BUFFER_MIN/MAX_KCAL rails). Either, both, or neither can be true for a given call.
    let reasonWithNotes = stepClipped
      ? `${reason} Clipped to the ±${MAX_ADJUSTMENT_STEP_KCAL} kcal per-adjustment limit — a persistent shortfall this large needs the model revisited, not the buffer.`
      : reason;
    if (capped) {
      reasonWithNotes = `${reasonWithNotes} Capped at ${bufferApplied} kcal (allowed range ${BUFFER_MIN_KCAL}–${BUFFER_MAX_KCAL}) — a pinned rail means the model, not the athlete, needs revisiting.`;
    }
    return {
      bufferApplied,
      delta: bufferApplied - buffer,
      capped,
      stepClipped,
      reason: reasonWithNotes,
    };
  };

  if (trendShort === null) {
    return settle(0, "Not enough weigh-ins yet to read a weight trend — buffer left as configured.");
  }

  const desired = desiredWeightTrend(currentKg, targetKg, configuredRate);
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
  const stepClipped = stepped !== raw;
  const delta = Math.round(stepped / 10) * 10;
  const direction = delta > 0 ? "increased" : delta < 0 ? "decreased" : "unchanged";
  return settle(
    delta,
    `Weight trending ${fmtKg(reportedTrend)} kg/week while ${goalNote} — buffer ${direction}${delta === 0 ? "" : ` by ${Math.abs(delta)} kcal`}.`,
    stepClipped
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
 * ONE formula. There is deliberately no rest-day branch on the derived path: a rest day is a day whose
 * activeBurnKcal is 0, so `training ≥ rest` holds by construction for the same athlete.
 *
 * That inversion was live. Two independent formulas (base + burn + buffer vs a flat restDayTarget with no
 * buffer) meant a training day only overtook a rest day once burn cleared ~300 kcal, so every Strength
 * session and short recovery spin prescribed less food than doing nothing.
 *
 * `isRestDay` is consumed by the LEGACY path only — the derived path has no use for it, which is the fix.
 */
export function calculateDailyTarget(
  activeBurnKcal: number,
  model: NutritionModel,
  bufferApplied: number,
  isRestDay: boolean,
  workout?: WorkoutContext
): WorkoutNutritionPlan {
  const carbs = {
    preRideCarbs: workout ? preRideCarbTarget(workout.durationMin, workout.type, model.weightKg) : 0,
    inRideCarbsPerHour: workout ? inRideCarbTarget(workout.durationMin, workout.type) : 0,
  };

  if (model.kind === "derived") {
    const maintenance = model.neatMultiplier * model.rmr + activeBurnKcal;
    return {
      dailyTarget: roundTo(maintenance + bufferApplied, 10),
      maintenanceKcal: Math.round(maintenance),
      ...carbs,
      bufferApplied,
    };
  }

  // Legacy. The rest-day figure is honoured exactly; a training day is floored AT it rather than the
  // rest day being lowered to meet the training day — the inversion goes away and nobody loses food.
  if (isRestDay) {
    return {
      dailyTarget: Math.round(model.restDayTarget),
      maintenanceKcal: Math.round(model.restDayTarget),
      ...carbs,
      bufferApplied,
    };
  }
  const raw = roundTo(model.baseCalories + activeBurnKcal + bufferApplied, 10);
  return {
    dailyTarget: Math.max(raw, Math.round(model.restDayTarget)),
    maintenanceKcal: Math.round(model.baseCalories + activeBurnKcal),
    ...carbs,
    bufferApplied,
  };
}

/**
 * Pick the model for this athlete. The presence of all three RMR inputs IS the migration gate — there is
 * no separate timestamp flag to keep in sync.
 *
 * Truthy checks, never `=== null`: a profile JSON written before these fields existed parses them back as
 * `undefined`, and an equality check against null misses it, so the migration silently never runs. This
 * project has shipped that bug before.
 */
export function resolveNutritionModel(
  profile: AthleteProfile,
  latestWeightKg: number,
  today: string
): NutritionModel {
  const p = profile.performance;
  const shared = {
    weightKg: latestWeightKg,
    targetWeightKg: profile.nutrition.targetWeightKg,
    buffer: profile.nutrition.buffer,
  };
  if (p.dateOfBirth && p.heightCm && p.sex) {
    const ageYears = ageYearsFrom(p.dateOfBirth, today);
    if (ageYears !== null) {
      return {
        kind: "derived",
        rmr: restingMetabolicRate(latestWeightKg, p.heightCm, ageYears, p.sex),
        neatMultiplier: DEFAULT_NEAT_MULTIPLIER, // per-athlete calibration is Phase 3
        ...shared,
      };
    }
  }
  return {
    kind: "legacy",
    baseCalories: profile.nutrition.baseCalories,
    restDayTarget: profile.nutrition.restDayTarget,
    ...shared,
  };
}

export const WEIGHT_TREND_WINDOW_DAYS = 14; // default regression window; the gain side asks for 28
export const WEIGHT_TREND_LONG_WINDOW_DAYS = 28;
const WEIGHT_TREND_MIN_POINTS = 3; // need ≥3 weigh-ins before a slope is meaningful (and outlier-resistant)

// Unrounded Theil–Sen slope, kg/7d. weightTrendFromWellness rounds to 1 decimal for display and for the
// buffer's steering decisions — fine there, useless here: calibration multiplies this by 7700 kcal/kg, so
// a discarded 0.04 kg/7d is ~44 kcal/day of fabricated imbalance.
function theilSenKgPerWeek(
  wellness: WellnessEntry[],
  windowDays: number
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
  return median(slopes) * 7; // express as kg/7d, unrounded
}

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
  const s = theilSenKgPerWeek(wellness, windowDays);
  return s === null ? null : Math.round(s * 10) / 10;
}

// Unrounded Theil–Sen slope, kg/7d. weightTrendFromWellness rounds to 1 decimal for display and for the
// buffer's steering decisions — fine there, useless here: calibration multiplies this by 7700 kcal/kg, so
// a discarded 0.04 kg/7d is ~44 kcal/day of fabricated imbalance.
export function weightTrendPreciseFromWellness(
  wellness: WellnessEntry[],
  windowDays: number = WEIGHT_TREND_WINDOW_DAYS
): number | null {
  return theilSenKgPerWeek(wellness, windowDays);
}

export const SMOOTHED_WEIGHT_WINDOW_DAYS = 14;

/**
 * Body mass for GOAL comparisons, smoothed. A single weigh-in swings ±0.5–1 kg on water and glycogen —
 * the same reason weightTrendFromWellness uses a robust estimator — so sizing the goal gap from one
 * reading made the daily target jump across the deadband boundary depending on which weigh-in happened
 * to be last. Median of the trailing window; falls back to the latest single reading when the window is
 * empty, and null when there are no weigh-ins at all.
 */
export function smoothedCurrentWeightKg(
  wellness: WellnessEntry[],
  today: string,
  windowDays: number = SMOOTHED_WEIGHT_WINDOW_DAYS
): number | null {
  const weighIns = wellness
    .filter((w): w is WellnessEntry & { weightKg: number } => w.weightKg !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weighIns.length === 0) return null;
  const cutoff = new Date(Date.parse(today) - windowDays * 86_400_000).toISOString().slice(0, 10);
  const windowed = weighIns.filter((w) => w.date >= cutoff && w.date <= today);
  if (windowed.length === 0) return weighIns[weighIns.length - 1].weightKg; // fallback: latest single reading
  return median(windowed.map((w) => w.weightKg));
}

// ---------- NEAT multiplier calibration ----------

// Band for an RMR multiplier covering NEAT + the thermic effect of food and NOTHING else — structured
// exercise arrives separately as activeBurnKcal. Standard PAL figures (1.2 sedentary … 1.9 very active)
// INCLUDE exercise and are the wrong reference, so these edges are deliberately tighter.
//
// READ THESE AGAINST MIFFLIN-ST JEOR SPECIFICALLY. Mifflin under-predicts trained endurance athletes by
// 5–10%, so a derived k for such an athlete lands correspondingly high — the upper edge carries that
// bias, it is not a claim about human physiology.
export const NEAT_PLAUSIBLE_MIN = 1.15;
export const NEAT_PLAUSIBLE_MAX = 1.55;

export const CALIBRATION_MIN_WINDOW_DAYS = 28;
export const CALIBRATION_PREFERRED_WINDOW_DAYS = 42;
export const CALIBRATION_MIN_LOGGED_FRACTION = 0.65;
export const CALIBRATION_MIN_WEIGH_INS = 12;

// High-confidence thresholds sit above the medium/floor exports above — kept as local literals because
// the brief names only the floor tier as reusable constants.
const CALIBRATION_HIGH_MIN_WEIGH_INS = 20;
const CALIBRATION_HIGH_MIN_LOGGED_FRACTION = 0.8;

/**
 * Solve the energy-balance identity for the athlete's own RMR multiplier over a trailing window:
 *
 *   Σ intake − ( N·k·RMR + Σ activeBurn ) = Δmass · ρ
 *     ⇒ k = ( Σ intake − Σ activeBurn − Δmass·ρ ) / ( N · RMR )
 *
 * Pure: takes `rmr` as an input rather than deriving it, and reads only `wellness`/`activities`. Persisting
 * the result and reading it back into the daily-target formula belongs to the caller, not here.
 *
 * Only the PRODUCT k × RMR is identifiable from this identity — a derived k also absorbs any constant
 * error in the RMR equation itself (Mifflin under-predicts trained endurance athletes by 5-10%). An
 * out-of-band solve is therefore genuinely ambiguous between the food log and the RMR equation, and is
 * clamped + reported as such (`imbalance`), never adopted verbatim and never asserted as a single cause.
 *
 * Window is `[today − windowDays, today)` — today is excluded because its intake is still being logged
 * (mirrors computeEnergyAvailability). A logged 0 or negative kcalConsumed reads as NOT logged, not a
 * genuine fasted day (same convention as computeEnergyAvailability — no daily total is really zero).
 * Missing days are imputed at the window's own logged mean, never summed as zero: this athlete's MFP
 * logging is ~99% complete, so a gap almost always means "not yet transferred into Intervals.icu," not
 * "didn't eat" — summing logged days alone would fabricate a deficit sized by how lazy the transfer was.
 */
export function calibrateNeat(
  wellness: WellnessEntry[],
  activities: Array<Pick<ActivitySummary, "date" | "activeBurnKcal" | "kj">>,
  rmr: number,
  today: string,
  windowDays: number = CALIBRATION_PREFERRED_WINDOW_DAYS
): NeatCalibration | null {
  // Same convention as computeEnergyAvailability: a date lands here when SOME activity on it has a burn
  // that can't be resolved. That date is dropped from BOTH sums entirely (not folded in at 0), so the
  // identity never counts a day's real intake against a burn we don't actually know.
  const unresolvedBurnDates = new Set<string>();
  const burnByDate = new Map<string, number>();
  for (const a of activities) {
    const burn = activeBurn(a);
    if (burn === null) {
      unresolvedBurnDates.add(a.date);
      continue;
    }
    burnByDate.set(a.date, (burnByDate.get(a.date) ?? 0) + burn.kcal);
  }

  const cutoff = new Date(Date.parse(today) - windowDays * 86_400_000).toISOString().slice(0, 10);

  let loggedSum = 0;
  let loggedDays = 0;
  let weighIns = 0;
  for (const w of wellness) {
    if (w.date < cutoff || w.date >= today) continue; // outside [cutoff, today)
    // Weigh-in count feeds the weight-trend regression and confidence gate independent of activity data —
    // it must not be gated on burn resolvability, which is about a different signal entirely.
    if (w.weightKg !== null) weighIns++;
    if (unresolvedBurnDates.has(w.date)) continue; // burn unknown this day — exclude, don't zero it
    if (w.kcalConsumed !== null && w.kcalConsumed > 0) {
      loggedSum += w.kcalConsumed;
      loggedDays++;
    }
  }

  let sumBurn = 0;
  for (const [date, kcal] of burnByDate) {
    if (date < cutoff || date >= today) continue;
    if (unresolvedBurnDates.has(date)) continue; // a same-day activity elsewhere failed to resolve
    sumBurn += kcal;
  }

  const loggedFraction = loggedDays / windowDays;
  let confidence: "medium" | "high";
  if (
    windowDays >= CALIBRATION_PREFERRED_WINDOW_DAYS &&
    weighIns >= CALIBRATION_HIGH_MIN_WEIGH_INS &&
    loggedFraction >= CALIBRATION_HIGH_MIN_LOGGED_FRACTION
  ) {
    confidence = "high";
  } else if (
    windowDays >= CALIBRATION_MIN_WINDOW_DAYS &&
    weighIns >= CALIBRATION_MIN_WEIGH_INS &&
    loggedFraction >= CALIBRATION_MIN_LOGGED_FRACTION
  ) {
    confidence = "medium";
  } else {
    // Below the floor: withhold entirely rather than adopt a flaky number. A population default must
    // never masquerade as personalised, so a "low"-confidence NeatCalibration is never returned here.
    return null;
  }

  // mean(logged) × windowDays — the imputation the confidence gate above exists to protect: every day in
  // the window, not only the logged ones, is assumed to have eaten at the window's own observed rate.
  const meanIntake = loggedSum / loggedDays;
  const sumIntake = meanIntake * windowDays;

  const trendPrecise = weightTrendPreciseFromWellness(wellness, windowDays); // unrounded kg/7d
  const deltaMassKg = trendPrecise === null ? 0 : (trendPrecise / 7) * windowDays;

  const solvedK = (sumIntake - sumBurn - deltaMassKg * KCAL_PER_KG_TISSUE) / (windowDays * rmr);

  let multiplier = solvedK;
  let imbalance: EnergyImbalanceFinding | null = null;
  if (solvedK > NEAT_PLAUSIBLE_MAX || solvedK < NEAT_PLAUSIBLE_MIN) {
    multiplier = solvedK > NEAT_PLAUSIBLE_MAX ? NEAT_PLAUSIBLE_MAX : NEAT_PLAUSIBLE_MIN;
    const direction: EnergyImbalanceFinding["direction"] =
      solvedK > NEAT_PLAUSIBLE_MAX ? "intake-above-model" : "intake-below-model";
    // Signed, not just magnitude: positive means the solve ran hotter than the clamp, negative means it
    // ran colder — the sign alone carries `direction`, so a caller reading only this field still knows
    // which way the overshoot goes.
    const estimatedKcalPerDay = roundTo((solvedK - multiplier) * rmr, 10);
    imbalance = {
      direction,
      estimatedKcalPerDay,
      // Never a single cause: only k × RMR is identifiable, so an out-of-band solve is genuinely
      // ambiguous between the food log and the RMR equation. Log bias listed first — 20-30%
      // under/over-reporting in athletes is larger and better documented than typical equation error.
      candidates:
        direction === "intake-above-model"
          ? [
              "Logged intake running higher than actual (missed or under-counted portions on days that ARE logged) — the larger, better-documented effect at this end.",
              "The RMR equation under- or over-predicting for this athlete, which a derived multiplier cannot separate from true intake.",
            ]
          : [
              "Under-reported intake (20-30% under-logging is well documented in athletes) — the larger, better-documented effect at this end.",
              "The RMR equation over- or under-predicting for this athlete, which a derived multiplier cannot separate from true intake.",
            ],
      note: "Only k × RMR is identifiable from this window's data — this clamp is not a diagnosis of the food log.",
    };
  }

  return {
    multiplier,
    confidence,
    source: "derived",
    windowDays,
    loggedDays,
    weighIns,
    solvedAt: new Date(`${today}T00:00:00.000Z`).toISOString(),
    imbalance,
  };
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
// carrying a resolvable active-burn figure, not only rides; a day whose activity has NO resolvable burn
// is excluded from the mean entirely, never folded in at 0 — 0 reads identically to a genuine rest day
// and would silently inflate EA, hiding underfuelling) and honest about limits:
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
  // A date lands here when SOME activity on it has a burn that can't be resolved (activeBurn → null).
  // That day must be excluded from the mean entirely, not folded in at burn 0 — 0 is indistinguishable
  // from a genuine rest day and silently INFLATES the EA reading (hides underfuelling), which is the
  // wrong error direction for an athlete whose presenting problem is chronic underfuelling.
  const unresolvedBurnDates = new Set<string>();
  for (const a of activities) {
    const burn = activeBurn(a);
    if (burn === null) {
      unresolvedBurnDates.add(a.date);
      continue;
    }
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
    if (unresolvedBurnDates.has(w.date)) continue; // burn unknown for this day — exclude, don't zero it
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
  model: NutritionModel,
  ftp: number,
  bufferApplied: number
): NutritionReferenceRow[] {
  const rows: NutritionReferenceRow[] = [];
  for (const [type, durations] of Object.entries(REFERENCE_DURATIONS) as [WorkoutType, number[]][]) {
    for (const durationMin of durations) {
      const estBurnKcal = estimateWorkoutBurnKcal(type, durationMin, ftp);
      rows.push({
        type,
        durationMin,
        estBurnKcal,
        plan: calculateDailyTarget(estBurnKcal, model, bufferApplied, type === "Rest", {
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
