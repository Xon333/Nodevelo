// AI: read docs/systems/09-nutrition.md before changing anything here — it carries the WHY for the
// non-obvious choices (why there is no rest-day branch, why the buffer is feed-forward rather than a
// servo, why active burn is consumed verbatim, and the two different denominators the streak alert and
// weekly-balance signals use). Several of those encode defects that were live in production.
//
// Deterministic nutrition formula. Pure TypeScript — no AI involvement.
// The AI receives this module's output as pre-computed values and only
// rephrases them in natural language inside workout descriptions.
import { ageYearsFrom } from "./date";
import type { ActivitySummary, AthleteProfile, DayTypeNeat, EnergyImbalanceFinding, NeatCalibration, WellnessEntry, WorkoutType } from "./types";
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
  floored: boolean; // true when the daily target was raised to meet the RMR floor
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

// The feed-forward result — a single entry point covering both the direct goal-rate calculation and
// the trend-servo fallback, so a caller never has to choose between adjustBuffer and a manual
// goalSurplusKcalPerDay call (see docs/superpowers/specs/2026-07-31-buffer-redesign-feedforward.md).
export interface ResolvedBuffer {
  bufferApplied: number;
  mode: "goal-rate" | "trend-servo";
  goalSurplusKcal: number; // the feed-forward component, always present
  servoDeltaKcal: number; // 0 in goal-rate mode
  reason: string;
  capped: boolean; // hit BUFFER_MIN/MAX
  stepClipped: boolean; // servo only; false in goal-rate mode
}

// The energy a goal rate thermodynamically requires, per day. This is the whole feed-forward idea:
// once calibrateNeat makes maintenance honest, the goal needs no servo — it needs arithmetic.
export function goalSurplusKcalPerDay(desiredRateKgPerWeek: number): number {
  return Math.round((desiredRateKgPerWeek * KCAL_PER_KG_TISSUE) / 7 / 10) * 10;
}

// Calibration is trustworthy when it came from the athlete's own data with enough of it. A "default",
// a "low" tier, or a stale record all mean maintenance is a population guess — there the trend servo,
// steady-state offset and all, still beats no correction at all.
//
// Truthy check on `neat` itself, never a bare `.source` read: readAthleteProfile's shapeMergeProfile
// backfills a missing `neat` for any real on-disk profile.json predating Phase 2, but a caller handed
// a raw/partial profile (an older test fixture, a future direct caller) must degrade to "not
// trustworthy" rather than throw — same class of gap AGENTS.md's migration-flag note warns about.
function calibrationIsTrustworthy(neat: NeatCalibration | null | undefined): boolean {
  return !!neat && neat.source === "derived" && (neat.confidence === "medium" || neat.confidence === "high");
}

/**
 * ONE entry point for the buffer, replacing the trend-servo-only adjustBuffer as the primary path.
 *
 * When calibration is trustworthy (derived, medium/high confidence), the buffer is a direct
 * thermodynamic statement of the goal: `desiredWeightTrend × 7700 ÷ 7`, clamped to the existing rails.
 * `legacyBuffer` (NutritionSettings.buffer) is NOT read on this path — the retired setting has no
 * effect, which is what makes the sign defect (D-B) structurally unrepresentable rather than merely
 * patched: there is no longer a standing configured surplus that can point opposite to the goal.
 *
 * When calibration is not trustworthy (population default, an override with no solve behind it, low
 * confidence, or stale), maintenance itself is a guess, so the trend servo — steady-state offset and
 * all — is still the best available correction. It runs via the existing adjustBuffer, but seeded with
 * the GOAL surplus as its base instead of the legacy configured buffer, so both modes share the same
 * base and the sign defect cannot recur through this path either.
 */
export function resolveBuffer(
  neat: NeatCalibration,
  currentKg: number,
  targetKg: number,
  configuredRate: number | null,
  trendShort: number | null,
  trendLong: number | null,
  legacyBuffer: number
): ResolvedBuffer {
  const desiredRate = desiredWeightTrend(currentKg, targetKg, configuredRate);
  const goalSurplusKcal = goalSurplusKcalPerDay(desiredRate);

  if (calibrationIsTrustworthy(neat)) {
    const bufferApplied = Math.min(BUFFER_MAX_KCAL, Math.max(BUFFER_MIN_KCAL, goalSurplusKcal));
    const capped = bufferApplied !== goalSurplusKcal;
    const rateNote =
      desiredRate === 0
        ? "at target (within the deadband), so maintenance is the surplus this calls for"
        : `aiming for ${fmtKg(desiredRate)} kg/week → ${fmtKg(goalSurplusKcal)} kcal/day (your calibrated maintenance is trusted, so this is the surplus that rate requires)`;
    const reason = capped
      ? `${rateNote} Capped at ${bufferApplied} kcal (allowed range ${BUFFER_MIN_KCAL}–${BUFFER_MAX_KCAL}) — a pinned rail means the goal, not the buffer, needs revisiting.`
      : rateNote;
    return {
      bufferApplied,
      mode: "goal-rate",
      goalSurplusKcal,
      servoDeltaKcal: 0,
      reason,
      capped,
      stepClipped: false,
    };
  }

  const servo = adjustBuffer(goalSurplusKcal, trendShort, trendLong, currentKg, targetKg, configuredRate);
  return {
    bufferApplied: servo.bufferApplied,
    mode: "trend-servo",
    goalSurplusKcal,
    servoDeltaKcal: servo.delta,
    reason: `Maintenance is still a population estimate, so the buffer is also correcting against your weight trend. ${servo.reason}`,
    capped: servo.capped,
    stepClipped: servo.stepClipped,
  };
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
    let dailyTarget = roundTo(maintenance + bufferApplied, 10);
    // Safety floor: never prescribe below resting metabolic rate. This is a guard against the formula
    // producing an invalid output (a target below RMR is never a legitimate prescription), not a formula
    // term. An athlete presenting with chronic underfuelling must never receive a deficit from RMR.
    let floored = false;
    if (dailyTarget < model.rmr) {
      dailyTarget = model.rmr;
      floored = true;
    }
    return {
      dailyTarget,
      maintenanceKcal: Math.round(maintenance),
      ...carbs,
      bufferApplied,
      floored,
    };
  }

  // Legacy. The rest-day figure is honoured exactly; a training day is floored AT it rather than the
  // rest day being lowered to meet the training day — the inversion goes away and nobody loses food.
  // Legacy has no RMR field and already floors training days at restDayTarget, so floored is always false.
  if (isRestDay) {
    return {
      dailyTarget: Math.round(model.restDayTarget),
      maintenanceKcal: Math.round(model.restDayTarget),
      ...carbs,
      bufferApplied,
      floored: false,
    };
  }
  const raw = roundTo(model.baseCalories + activeBurnKcal + bufferApplied, 10);
  return {
    dailyTarget: Math.max(raw, Math.round(model.restDayTarget)),
    maintenanceKcal: Math.round(model.baseCalories + activeBurnKcal),
    ...carbs,
    bufferApplied,
    floored: false,
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
        // Optional chaining AND `??`, not just one: a profile JSON written before `neat` existed
        // parses it back as `undefined`, the same class of gap AGENTS.md's migration-flag gotcha
        // warns about — this must fall through to the population prior, not produce NaN.
        neatMultiplier: profile.nutrition.neat?.multiplier ?? DEFAULT_NEAT_MULTIPLIER,
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

// Days the athlete COULD have logged in this window: window start → the last day they actually
// logged. Coverage measured against the full window punishes a transfer gap as if it were a logging
// gap, and this athlete logs ~99% of days in MyFitnessPal and only transfers into Intervals.icu in
// batches. But good-but-old data must not be adopted as current either — if the last logged day is
// further back than this from `today`, calibration is withheld as STALE regardless of how good the
// coverage looked inside the loggable range.
export const CALIBRATION_MAX_STALENESS_DAYS = 14;

// Weigh-in recency floor — distinct from the weigh-in COUNT gates above (CALIBRATION_MIN_WEIGH_INS /
// CALIBRATION_HIGH_MIN_WEIGH_INS) and from CALIBRATION_MAX_STALENESS_DAYS (which guards INTAKE
// staleness only). Count and coverage alone don't guarantee the weight-trend regression is reading
// anything current: 20-23 weigh-ins clustered in the window's FIRST half still clear the HIGH bar on
// count/coverage with nothing else requiring the trend they feed to be recent. theilSenKgPerWeek
// anchors its x-axis at whichever weigh-in is last in the array it's handed, with no awareness of
// `cutoff`/`today` on its own — so once weigh-ins lapse by D days, the trend window silently shifts
// back by D: D days of PRE-window data (e.g. a gaining block that ended weeks ago) get a vote, and the
// most recent D days of the actual calibration window get none.
//
// Measured on real data shapes: a flat-in-window athlete (true k = 1.2584) with an unrelated
// pre-window trend and a lapsed weigh-in cadence derived k ≈ 1.15-1.16 at HIGH confidence — a
// fabricated ~165-177 kcal/day deficit — for 20-21 day lapses. Error is ~zero out to ~10 days and
// turns on somewhere between 14 and 20. 14 sits after the measured-safe range and before both measured
// failures; combined with the [cutoff, lastLoggedDate] window filter on the trend input (see
// calibrateNeat), this is what closes the failure rather than just narrowing it.
export const CALIBRATION_MAX_WEIGHIN_LAPSE_DAYS = 14;

// High-confidence thresholds sit above the medium/floor exports above — kept as local literals because
// the brief names only the floor tier as reusable constants.
const CALIBRATION_HIGH_MIN_WEIGH_INS = 20;
const CALIBRATION_HIGH_MIN_LOGGED_FRACTION = 0.8;

/**
 * The ONE constructor for a `"default"` or `"override"` NeatCalibration — neither describes a solve, so
 * neither may carry one. Writing `{ ...previousNeat, multiplier, source }` (the pre-fix pattern) kept
 * whatever `imbalance`/`windowDays`/`loggedDays`/`weighIns`/`confidence` the PREVIOUS solve happened to
 * have, producing records like "population default, high confidence, 39 logged days, clamped for a
 * ~180 kcal/day imbalance" for a solve that no longer exists — which the UI then rendered as fact.
 * Every write of a non-derived record funnels through here so that drift can't reappear.
 *
 * `confidence: "low"` is deliberate: neither a population prior nor an athlete-typed number is
 * empirically calibrated, so "low" is the honest label. This is NOT the same claim as calibrateNeat's
 * own contract — calibrateNeat still never returns `"low"` itself (its below-the-floor case is a bare
 * `null`, never a low-confidence object; see the NeatCalibration doc in lib/types.ts). This is the one
 * place in the app that legitimately produces `"low"`, and it's outside calibrateNeat entirely.
 */
export function nonDerivedNeatCalibration(
  source: "default" | "override",
  multiplier: number,
  solvedAt: string | null = null
): NeatCalibration {
  return {
    multiplier,
    confidence: "low",
    source,
    windowDays: null,
    loggedDays: null,
    weighIns: null,
    solvedAt,
    imbalance: null,
    stale: false,
  };
}

/**
 * Shared solve/clamp/imbalance core for the energy-balance identity:
 *
 *   k = ( sumIntake − sumBurn − deltaMassKg·ρ ) / ( n · rmr )
 *
 * Extracted so `calibrateNeat` and `calibrateNeatByDayType` cannot silently diverge on how an
 * out-of-band solve is clamped and reported. Only the PRODUCT k × RMR is identifiable from this
 * identity — a derived k also absorbs any constant error in the RMR equation itself (Mifflin
 * under-predicts trained endurance athletes by 5-10%). An out-of-band solve is therefore genuinely
 * ambiguous between the food log and the RMR equation, and is clamped + reported as such
 * (`imbalance`), never adopted verbatim and never asserted as a single cause.
 */
function solveAndClampK(
  sumIntake: number,
  sumBurn: number,
  deltaMassKg: number,
  n: number,
  rmr: number
): { multiplier: number; imbalance: EnergyImbalanceFinding | null } {
  const solvedK = (sumIntake - sumBurn - deltaMassKg * KCAL_PER_KG_TISSUE) / (n * rmr);

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

  return { multiplier, imbalance };
}

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
 * Missing days are imputed at the LOGGABLE range's own logged mean, never summed as zero: this athlete's
 * MFP logging is ~99% complete, so a gap almost always means "not yet transferred into Intervals.icu,"
 * not "didn't eat" — summing logged days alone would fabricate a deficit sized by how lazy the transfer was.
 *
 * Coverage is measured over the LOGGABLE range (window start → the last day the athlete actually logged
 * intake inside the window), not the full `[cutoff, today)` window — anchoring at `today` would punish a
 * batch-transfer gap exactly like a genuine logging gap, which is what caused the pre-Step-3b flicker
 * (available right after a transfer, withheld nine days later). `N` in the identity is this same loggable
 * span, further decremented for any day inside it whose activity burn couldn't be resolved — the sums it
 * multiplies against (`sumIntake`, `sumBurn`) already exclude those days, so `N` must too or the identity
 * is imbalanced (this fixes the ~1.5% imbalance the Task 3 implementer flagged).
 *
 * "Patchy" (below the confidence floor) and "stale" (good data, just too old) are different states and
 * are reported differently: patchy still returns null (a population default must never masquerade as
 * personalised); stale returns a `NeatCalibration` with `source: "default"` and `stale: true` so the
 * reason survives even though nothing was adopted — good-but-old data must never read as current.
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

  // The end of the loggable range: the last day inside the window the athlete actually logged intake.
  // Days after this and before `today` are a transfer gap, not a logging gap, and must not count against
  // coverage at all — they're excluded from the whole calculation below, not imputed.
  let lastLoggedDate: string | null = null;
  for (const w of wellness) {
    if (w.date < cutoff || w.date >= today) continue;
    if (w.kcalConsumed !== null && w.kcalConsumed > 0 && (lastLoggedDate === null || w.date > lastLoggedDate)) {
      lastLoggedDate = w.date;
    }
  }
  if (lastLoggedDate === null) return null; // nothing logged in this window at all — genuinely patchy

  // Staleness guard, independent of coverage: good-but-old data must not be adopted as current. Reported
  // via a non-null `NeatCalibration` (source "default", stale true) rather than a bare null, because the
  // reason ("your last transfer was N days ago") must survive for the caller to render.
  const daysSinceLastLog = Math.round((Date.parse(today) - Date.parse(lastLoggedDate)) / 86_400_000);
  if (daysSinceLastLog > CALIBRATION_MAX_STALENESS_DAYS) {
    return {
      multiplier: DEFAULT_NEAT_MULTIPLIER,
      confidence: "low",
      source: "default",
      windowDays: null,
      loggedDays: null,
      weighIns: null,
      solvedAt: null,
      imbalance: null,
      stale: true,
    };
  }

  // loggableDays: window start → lastLoggedDate inclusive — the span coverage is measured against.
  const loggableDays = Math.max(1, Math.round((Date.parse(lastLoggedDate) - Date.parse(cutoff)) / 86_400_000) + 1);

  let loggedSum = 0;
  let loggedDays = 0;
  let weighIns = 0;
  // Most recent weigh-in inside [cutoff, today) — feeds the CALIBRATION_MAX_WEIGHIN_LAPSE_DAYS gate
  // below. Tracked alongside the count in the same loop rather than a second pass.
  let mostRecentWeighInDate: string | null = null;
  for (const w of wellness) {
    if (w.date < cutoff || w.date >= today) continue; // outside [cutoff, today)
    // Weigh-in count feeds the weight-trend regression and confidence gate independent of activity data —
    // it must not be gated on burn resolvability, which is about a different signal entirely. Counted over
    // the FULL window, not just the loggable range: weigh-ins sync separately from MFP-batched intake and
    // aren't subject to the same transfer gap (this athlete's real data has weigh-ins after its last
    // logged-kcal day).
    if (w.weightKg !== null) {
      weighIns++;
      if (mostRecentWeighInDate === null || w.date > mostRecentWeighInDate) mostRecentWeighInDate = w.date;
    }
    if (w.date > lastLoggedDate) continue; // transfer-gap tail — excluded from intake accounting entirely
    if (unresolvedBurnDates.has(w.date)) continue; // burn unknown this day — exclude, don't zero it
    if (w.kcalConsumed !== null && w.kcalConsumed > 0) {
      loggedSum += w.kcalConsumed;
      loggedDays++;
    }
  }
  const daysSinceLastWeighIn =
    mostRecentWeighInDate === null
      ? Infinity
      : Math.round((Date.parse(today) - Date.parse(mostRecentWeighInDate)) / 86_400_000);

  let sumBurn = 0;
  for (const [date, kcal] of burnByDate) {
    if (date < cutoff || date > lastLoggedDate) continue;
    if (unresolvedBurnDates.has(date)) continue; // a same-day activity elsewhere failed to resolve
    sumBurn += kcal;
  }

  // N: the loggable span further decremented for any day inside it excluded for an unresolvable burn —
  // the same days sumIntake's imputation and sumBurn already exclude, so the per-day k·RMR term must
  // exclude them too (this is the ~1.5% imbalance fix).
  let unresolvedInRange = 0;
  for (const date of unresolvedBurnDates) {
    if (date >= cutoff && date <= lastLoggedDate) unresolvedInRange++;
  }
  const n = Math.max(1, loggableDays - unresolvedInRange);

  // Coverage is measured over the loggable range, not the full window — a transfer gap already dropped
  // out of `loggableDays` itself, so it can't drag this fraction down a second time.
  const loggedFraction = loggedDays / loggableDays;
  let confidence: "medium" | "high";
  if (
    windowDays >= CALIBRATION_PREFERRED_WINDOW_DAYS &&
    weighIns >= CALIBRATION_HIGH_MIN_WEIGH_INS &&
    loggedFraction >= CALIBRATION_HIGH_MIN_LOGGED_FRACTION &&
    daysSinceLastWeighIn <= CALIBRATION_MAX_WEIGHIN_LAPSE_DAYS
  ) {
    confidence = "high";
  } else if (
    windowDays >= CALIBRATION_MIN_WINDOW_DAYS &&
    weighIns >= CALIBRATION_MIN_WEIGH_INS &&
    loggedFraction >= CALIBRATION_MIN_LOGGED_FRACTION &&
    daysSinceLastWeighIn <= CALIBRATION_MAX_WEIGHIN_LAPSE_DAYS
  ) {
    confidence = "medium";
  } else {
    // Below the floor: withhold entirely rather than adopt a flaky number. A population default must
    // never masquerade as personalised, so a "low"-confidence NeatCalibration is never returned here.
    // Weigh-in count and logged coverage alone don't guarantee the trend is CURRENT — weigh-ins
    // clustered in the window's first half can clear both bars with a stale trend — so a lapse past
    // CALIBRATION_MAX_WEIGHIN_LAPSE_DAYS withholds here too, same as any other insufficient-data case.
    return null;
  }

  // mean(logged) × N — the imputation the confidence gate above exists to protect: every day counted (N),
  // not only the logged ones, is assumed to have eaten at the loggable range's own observed rate.
  const meanIntake = loggedSum / loggedDays;
  const sumIntake = meanIntake * n;

  // Bound the trend input to the SAME [cutoff, lastLoggedDate] span the intake/burn sums already run
  // over. theilSenKgPerWeek (unchanged) anchors its x-axis at whichever weigh-in is LAST in the array
  // it's handed and has no notion of `cutoff`/`today` on its own — pass it the raw `wellness` and a
  // lapsed weigh-in cadence silently drags that anchor (and the whole trend window) back by the lapse,
  // letting pre-window data vote and starving the real window of coverage. See
  // CALIBRATION_MAX_WEIGHIN_LAPSE_DAYS for the companion recency gate and the measured failure this closes.
  const trendWellness = wellness.filter((w) => w.date >= cutoff && w.date <= lastLoggedDate);
  const trendPrecise = weightTrendPreciseFromWellness(trendWellness, windowDays); // unrounded kg/7d
  const deltaMassKg = trendPrecise === null ? 0 : (trendPrecise / 7) * n;

  const { multiplier, imbalance } = solveAndClampK(sumIntake, sumBurn, deltaMassKg, n, rmr);

  return {
    multiplier,
    confidence,
    source: "derived",
    windowDays,
    loggedDays,
    weighIns,
    solvedAt: new Date(`${today}T00:00:00.000Z`).toISOString(),
    imbalance,
    stale: false,
  };
}

// ---------- Day-type NEAT calibration (rest vs training days) ----------

// Rest days are sparse for a training cyclist; needs more calendar time than the 42-day pooled window
// to gather enough of them to solve independently.
export const DAY_TYPE_WINDOW_DAYS = 90;

// Reused, not invented: the same "how much of the athlete's own signal before it should dominate the
// population/pooled prior" constant the pooled calibration's own confidence floor uses.
export const DAY_TYPE_SHRINKAGE_K = CALIBRATION_MIN_WEIGH_INS;

// Below this, shrinkageWeight is forced to 0 — avoids a near-divide-by-zero mean from 1-2 points
// dominating a subset's own solve before it's blended away anyway.
export const DAY_TYPE_MIN_LOGGED_DAYS = 3;

// Confidence tier for a day-type subset, reusing the pooled tiers' exact threshold VALUES — but
// checked against `loggedDays`/`coverage` rather than `weighIns`/`loggedFraction`/weigh-in recency. A
// subset has no weigh-in count or recency signal of its own (weighIns is reused verbatim from the
// pooled window in calibrateNeatByDayType, and recency is already gated by pooled itself returning
// null), so the only axis a subset has an independent read on is how much of ITS OWN calendar span
// actually got logged.
function dayTypeConfidence(windowDays: number, loggedDays: number, coverage: number): "low" | "medium" | "high" {
  if (
    windowDays >= CALIBRATION_PREFERRED_WINDOW_DAYS &&
    loggedDays >= CALIBRATION_HIGH_MIN_WEIGH_INS &&
    coverage >= CALIBRATION_HIGH_MIN_LOGGED_FRACTION
  ) {
    return "high";
  }
  if (
    windowDays >= CALIBRATION_MIN_WINDOW_DAYS &&
    loggedDays >= CALIBRATION_MIN_WEIGH_INS &&
    coverage >= CALIBRATION_MIN_LOGGED_FRACTION
  ) {
    return "medium";
  }
  return "low";
}

/**
 * Rest-day / training-day split of calibrateNeat's pooled solve, shrunk toward the pooled multiplier
 * via empirical-Bayes weighting (`weight = n / (n + DAY_TYPE_SHRINKAGE_K)`) so a thin subset sample
 * stays conservative instead of swinging on a handful of days. See docs/systems/09-nutrition.md.
 *
 * `pooled` is the SAME `calibrateNeat` call unchanged (its own default, CALIBRATION_PREFERRED_WINDOW_DAYS
 * = 42) — this function never widens or narrows that call's window. If pooled is null, this returns
 * null immediately: a day-type split cannot be more confident than the base calibration it shrinks
 * toward.
 *
 * The day-type split itself runs over a WIDER trailing window (`windowDays`, default
 * DAY_TYPE_WINDOW_DAYS = 90) than the pooled call, because rest days are sparse for a training
 * cyclist and need more calendar time to accumulate a usable sample. `cutoff`/`lastLoggedDate` for
 * this wider window are computed with the same convention calibrateNeat uses for its own (shorter)
 * window — ONE shared boundary for both subsets, not a per-subset one, because a transfer gap affects
 * both day types equally.
 */
export function calibrateNeatByDayType(
  wellness: WellnessEntry[],
  activities: Array<Pick<ActivitySummary, "date" | "activeBurnKcal" | "kj">>,
  rmr: number,
  today: string,
  windowDays: number = DAY_TYPE_WINDOW_DAYS
): DayTypeNeat | null {
  const pooled = calibrateNeat(wellness, activities, rmr, today);
  if (pooled === null) return null;

  // Same convention as calibrateNeat: a date lands here when SOME activity on it has a burn that
  // can't be resolved. Excluded from both the day-type map and any subset's day count entirely.
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

  let lastLoggedDate: string | null = null;
  for (const w of wellness) {
    if (w.date < cutoff || w.date >= today) continue;
    if (w.kcalConsumed !== null && w.kcalConsumed > 0 && (lastLoggedDate === null || w.date > lastLoggedDate)) {
      lastLoggedDate = w.date;
    }
  }
  // Nothing logged inside THIS (wider) window — shouldn't happen given pooled already cleared its own
  // shorter window's floor, but guarded rather than assumed.
  if (lastLoggedDate === null) return null;

  // perDayDriftKg is computed ONCE, from the trend over [cutoff, lastLoggedDate], and shared by both
  // subsets — the model's existing uniform-daily-rate assumption is exactly what licenses this. A
  // scattered handful of rest days doesn't have enough temporal spread on its own to fit a trend.
  const trendWellness = wellness.filter((w) => w.date >= cutoff && w.date <= lastLoggedDate!);
  const trendPrecise = weightTrendPreciseFromWellness(trendWellness, windowDays);
  const perDayDriftKg = trendPrecise === null ? 0 : trendPrecise / 7;

  interface Subset {
    loggableDays: number;
    loggedDays: number;
    loggedSum: number;
    burnSum: number;
  }
  const rest: Subset = { loggableDays: 0, loggedDays: 0, loggedSum: 0, burnSum: 0 };
  const train: Subset = { loggableDays: 0, loggedDays: 0, loggedSum: 0, burnSum: 0 };

  const wellnessByDate = new Map<string, WellnessEntry>();
  for (const w of wellness) {
    if (w.date >= cutoff && w.date <= lastLoggedDate) wellnessByDate.set(w.date, w);
  }

  // Walk every calendar date in [cutoff, lastLoggedDate] — including dates with no wellness/activity
  // record at all — classifying each as rest or training from the resolved activeBurn sum alone.
  const cutoffMs = Date.parse(cutoff);
  const lastLoggedMs = Date.parse(lastLoggedDate);
  for (let ms = cutoffMs; ms <= lastLoggedMs; ms += 86_400_000) {
    const date = new Date(ms).toISOString().slice(0, 10);
    if (unresolvedBurnDates.has(date)) continue; // burn unknown this day — excluded from both subsets
    const burn = burnByDate.get(date) ?? 0;
    const subset = burn > 0 ? train : rest;
    subset.loggableDays++;
    subset.burnSum += burn; // 0 for every rest-classified date by construction
    const w = wellnessByDate.get(date);
    if (w && w.kcalConsumed !== null && w.kcalConsumed > 0) {
      subset.loggedDays++;
      subset.loggedSum += w.kcalConsumed;
    }
  }

  const buildSubset = (s: Subset): { neat: NeatCalibration; weight: number } => {
    const coverage = s.loggableDays > 0 ? s.loggedDays / s.loggableDays : 0;
    // Imputed at THIS SUBSET'S OWN logged mean — never the pooled mean, never zero. Blanking every
    // third rest day must not collapse k_rest toward the training-heavy pooled average.
    const meanLoggedIntake = s.loggedDays > 0 ? s.loggedSum / s.loggedDays : 0;
    const sumIntakeImputed = meanLoggedIntake * s.loggableDays;
    const deltaMass = perDayDriftKg * s.loggableDays;
    const n = Math.max(1, s.loggableDays);
    const { multiplier: clampedSubsetK, imbalance } = solveAndClampK(sumIntakeImputed, s.burnSum, deltaMass, n, rmr);
    const weight =
      s.loggedDays < DAY_TYPE_MIN_LOGGED_DAYS ? 0 : s.loggedDays / (s.loggedDays + DAY_TYPE_SHRINKAGE_K);
    const finalMultiplier = weight * clampedSubsetK + (1 - weight) * pooled.multiplier;
    const neat: NeatCalibration = {
      multiplier: finalMultiplier,
      confidence: dayTypeConfidence(windowDays, s.loggedDays, coverage),
      source: "derived",
      // The actual window used for THIS solve, not a hardcoded constant — mirrors calibrateNeat's own
      // `windowDays` field, which reports its real parameter too, so an override by a future caller
      // can't silently misreport itself here.
      windowDays,
      loggedDays: s.loggedDays,
      weighIns: pooled.weighIns, // not day-type-specific in any meaningful sense — reuse verbatim
      solvedAt: new Date(`${today}T00:00:00.000Z`).toISOString(),
      imbalance, // from the PRE-shrink clamp — shrinkage never recomputes it
      stale: false, // staleness already gated via pooled returning null
    };
    return { neat, weight };
  };

  const restResult = buildSubset(rest);
  const trainResult = buildSubset(train);

  return {
    rest: restResult.neat,
    train: trainResult.neat,
    pooled,
    shrinkageWeight: { rest: restResult.weight, train: trainResult.weight },
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

// ---------- Under-fueling streak alert (spec §10) ----------
//
// Deliberately a SEPARATE denominator from BALANCE_LOW_BELOW above. BALANCE_LOW_BELOW answers "did I
// follow the plan" — it is measured against the BUFFERED prescription, so an athlete deliberately and
// appropriately cutting would trip it. This alert answers a health question — "am I under-fuelling my
// actual physiological need" — so the buffer must be excluded from the denominator: k·RMR + activeBurn,
// never the full dailyTarget. Two genuinely distinct facts; do not "unify" these constants later.
export const UNDERFUEL_RATIO_BELOW = 0.95; // vs UNBUFFERED maintenance — NOT BALANCE_LOW_BELOW
export const STREAK_ALERT_THRESHOLD = 3;
export const STREAK_WINDOW_LOGGED_DAYS = 7;
export const STREAK_MAX_LOOKBACK_DAYS = 14;
export const STREAK_MIN_LOGGED_DAYS = 4;

export interface UnderfuelStreak {
  loggedDays: number; // days actually evaluated (>= STREAK_MIN_LOGGED_DAYS, <= STREAK_WINDOW_LOGGED_DAYS)
  daysBelowThreshold: number; // of loggedDays, how many landed below UNDERFUEL_RATIO_BELOW
  alert: boolean; // daysBelowThreshold >= STREAK_ALERT_THRESHOLD
}

// The day's unbuffered physiological need — the denominator this alert (and ONLY this alert) uses.
// Derived: k·RMR + activeBurnKcal, per §10. Legacy (pre-migration, no RMR inputs yet): baseCalories +
// activeBurnKcal — deliberately uniform across rest/training days rather than switching to the flat
// restDayTarget on rest days, because that asymmetric branch is exactly the D1 defect the unified
// formula (calculateDailyTarget) fixed; a health alert must not resurrect it via the legacy fallback.
function unbufferedMaintenance(model: NutritionModel, activeBurnKcal: number): number {
  if (model.kind === "derived") return model.neatMultiplier * model.rmr + activeBurnKcal;
  return model.baseCalories + activeBurnKcal;
}

// Candidate days for the streak window, most-recent-first: intake-logged (kcal > 0 — a logged 0 or
// negative reads as NOT logged, same convention as computeEnergyAvailability/calibrateNeat), inside
// [today − STREAK_MAX_LOOKBACK_DAYS, today) — today excluded because it's still being logged — and
// with a resolvable activity burn for that date (a day whose only activity can't resolve a burn figure
// is excluded rather than zeroed, same convention as computeEnergyAvailability/calibrateNeat; this
// function treats it like "not usable" and keeps looking further back, same as a genuinely unlogged
// day would be skipped).
function streakCandidates(
  wellness: WellnessEntry[],
  activities: Array<Pick<ActivitySummary, "date" | "activeBurnKcal" | "kj">>,
  today: string
): Array<{ date: string; kcalConsumed: number; activeBurnKcal: number }> {
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
  const cutoff = new Date(Date.parse(today) - STREAK_MAX_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  return wellness
    .filter((w) => w.date >= cutoff && w.date < today)
    .filter((w) => w.kcalConsumed !== null && w.kcalConsumed > 0)
    .filter((w) => !unresolvedBurnDates.has(w.date))
    .map((w) => ({ date: w.date, kcalConsumed: w.kcalConsumed as number, activeBurnKcal: burnByDate.get(w.date) ?? 0 }))
    .sort((a, b) => b.date.localeCompare(a.date)); // most recent first
}

// The logged-day count for the "not enough transferred yet (n of N days)" message — usable even when
// computeUnderfuelStreak itself returns null below the floor, since that function's contract is
// specifically "does the alert fire", not "how many days do we have so far". Capped at
// STREAK_WINDOW_LOGGED_DAYS: once the floor clears this number stops being interesting to the UI.
export function loggedDaysForStreak(
  wellness: WellnessEntry[],
  activities: Array<Pick<ActivitySummary, "date" | "activeBurnKcal" | "kj">>,
  today: string
): number {
  return Math.min(streakCandidates(wellness, activities, today).length, STREAK_WINDOW_LOGGED_DAYS);
}

/**
 * Under-fuelling streak alert (spec §10). The window is the most recent UP TO STREAK_WINDOW_LOGGED_DAYS
 * *logged* days, none older than STREAK_MAX_LOOKBACK_DAYS calendar days — NOT "the last 7 calendar
 * days". This athlete transfers MyFitnessPal intake into Intervals.icu in batches, so a calendar window
 * can hold 2 logged days now and 7 a week later; sizing the window on calendar days would make the
 * alert fire and un-fire on transfer timing rather than on eating (the same bug Phase 2's "loggable
 * range" fix closed for calibrateNeat).
 *
 * Below STREAK_MIN_LOGGED_DAYS logged days in the lookback, returns null — genuinely different from
 * "you're fine" (use loggedDaysForStreak to render "not enough transferred yet (n of N days)").
 */
export function computeUnderfuelStreak(
  wellness: WellnessEntry[],
  activities: Array<Pick<ActivitySummary, "date" | "activeBurnKcal" | "kj">>,
  model: NutritionModel,
  today: string
): UnderfuelStreak | null {
  const candidates = streakCandidates(wellness, activities, today);
  if (candidates.length < STREAK_MIN_LOGGED_DAYS) return null;
  const window = candidates.slice(0, STREAK_WINDOW_LOGGED_DAYS);
  const daysBelowThreshold = window.reduce((count, day) => {
    const need = unbufferedMaintenance(model, day.activeBurnKcal);
    return count + (need > 0 && day.kcalConsumed / need < UNDERFUEL_RATIO_BELOW ? 1 : 0);
  }, 0);
  return {
    loggedDays: window.length,
    daysBelowThreshold,
    alert: daysBelowThreshold >= STREAK_ALERT_THRESHOLD,
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
