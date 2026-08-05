// Shared types used across server modules and client components.

import type { FuelPrompt } from "./fuel-prompt";
import type { AerobicDiscipline } from "./execution-score";

export type WorkoutType =
  | "Z2"
  | "Threshold"
  | "VO2max"
  | "SIT"
  | "RaceSim"
  | "Recovery"
  | "Strength"
  | "Rest";

export const WORKOUT_TYPES: WorkoutType[] = [
  "Z2",
  "Threshold",
  "VO2max",
  "SIT",
  "RaceSim",
  "Recovery",
  "Strength",
  "Rest",
];

export type QualityLibraryType = Extract<WorkoutType, "Threshold" | "VO2max" | "SIT" | "RaceSim">;
export type WorkoutSource = `library:${string}` | `template:${string}` | `ai:${string}/${number}`;
export interface WorkoutLibraryEvidence { date: string; executionScore: number }
export interface WorkoutLibraryEntry {
  id: string; workoutType: QualityLibraryType; durationMin: number; workoutText: string;
  status: "candidate" | "active" | "retired"; promotedBy?: "automatic" | "manual";
  evidence: WorkoutLibraryEvidence[]; useCount: number; recentUses: string[];
  createdAt: string; promotedAt?: string;
  intervalsExport?: { status: "pending" | "synced" | "failed"; workoutId?: string; error?: string };
}
export interface WorkoutLibraryStore { entries: WorkoutLibraryEntry[]; bootstrappedAt?: string }

// ---------- Athlete profile (data/athlete.json) ----------

export interface PerformanceData {
  ftp: number; // watts
  maxHr: number; // bpm
  thresholdHr: number; // bpm
  weightKg: number; // manual entry; live weight comes from wellness sync
  weeklyHoursMin: number;
  weeklyHoursMax: number;
  // RMR inputs (Mifflin-St Jeor). All three null until the athlete supplies them; their presence is the
  // migration gate that switches the nutrition formula from the legacy hand-set numbers to the derived
  // one. Guard with truthy checks, NEVER `=== null` — a profile JSON written before these fields existed
  // parses them back as `undefined`.
  dateOfBirth: string | null; // YYYY-MM-DD; age is derived at use via ageYearsFrom, never stored
  heightCm: number | null;
  sex: "male" | "female" | null; // a formula input (the equation's constant term is binary), not identity
}

// Out-of-band calibrateNeat solve. `direction`/`estimatedKcalPerDay` describe the SIZE and SIGN of the
// overshoot only — never a cause. Only the product k × RMR is identifiable from the energy-balance
// identity, so a high or low solve is ambiguous between food-log bias and RMR-equation error; `candidates`
// must always name more than one so this can never read as a diagnosis of the athlete's log.
export interface EnergyImbalanceFinding {
  direction: "intake-below-model" | "intake-above-model";
  estimatedKcalPerDay: number; // magnitude, NOT a cause
  candidates: string[];        // ordered most→least likely; ALWAYS names more than one
  note: string;
}

// Result of solving the energy-balance identity for the athlete's own RMR multiplier (calibrateNeat).
// `source: "default"` is the pre-calibration population prior (or a revert that couldn't re-derive);
// `"derived"` is a solve that cleared the confidence floor; `"override"` is an athlete-typed value
// (app/api/profile/route.ts's PUT `neatMultiplier`). Below the confidence floor calibrateNeat returns
// null rather than emitting a `"low"`-confidence NeatCalibration — a population default must never
// masquerade as personalised, so `"low"` is never produced BY CALIBRATENEAT ITSELF. It IS produced
// elsewhere: every `"default"`/`"override"` record is built by nutrition.ts's
// `nonDerivedNeatCalibration`, which uses `"low"` deliberately (neither state is empirically
// calibrated) and nulls `windowDays`/`loggedDays`/`weighIns`/`imbalance` so a record describing a
// non-solve can never carry fields that only make sense for a real one.
export interface NeatCalibration {
  multiplier: number;
  confidence: "low" | "medium" | "high";
  source: "default" | "derived" | "override";
  windowDays: number | null;
  loggedDays: number | null;
  weighIns: number | null;
  solvedAt: string | null; // ISO
  imbalance: EnergyImbalanceFinding | null;
  // True when calibration was withheld because the athlete's last LOGGED day (not synced day) is
  // more than CALIBRATION_MAX_STALENESS_DAYS before today — good-but-old data must not be adopted
  // as current. Distinct from a merely "patchy" (below the confidence floor) withholding: this
  // athlete transfers MyFitnessPal intake into Intervals.icu in batches, so a `stale` result means
  // "your last transfer was N days ago" rather than "you haven't logged enough." Conveyed via a
  // `source: "default"` NeatCalibration rather than a bare null so Task 5 can render the distinction
  // (see calibrateNeat's staleness guard).
  stale: boolean;
  // Which activity-burn basis this solve was fit against. `"net"` means the burn summed into the
  // identity had each activity's resting-equivalent cost (`durationHours × RMR/24`) removed first;
  // absent/`"gross"` means it was fit against the source figure verbatim, which double-counts resting
  // metabolism for the ride's duration (see lib/nutrition.ts's `exerciseBurn`).
  //
  // MIGRATION-CRITICAL, and read with a truthy `=== "net"` check, never `!== "gross"`: a profile.json
  // written before this field existed parses it back as `undefined`. A `k` fit against gross burn is
  // only self-consistent when the daily target ALSO adds gross burn — mixing a gross-basis `k` with
  // net burn silently under-feeds by the netted amount (~130 kcal on a 2 h ride). `resolveNutritionModel`
  // therefore derives `restingKcalPerHour` from this field and every prescription-side burn sum nets by
  // that figure, so a pre-migration record keeps its own consistent (gross) pairing until the next sync
  // re-solves and writes `"net"`. The two never mix.
  basis?: "gross" | "net";
}

// Rest-day / training-day split of the pooled calibrateNeat solve (lib/nutrition.ts's
// calibrateNeatByDayType), each shrunk toward `pooled.multiplier` via empirical-Bayes weighting so a
// thin day-type sample stays conservative instead of swinging on a handful of days. `pooled` is the
// SAME unmodified 42-day calibrateNeat call used elsewhere — carried here too so a consumer never has
// to make a second call just to render the shrinkage anchor. `shrinkageWeight` is 0..1 per subset,
// surfaced purely for derivation-panel transparency (0 = fully pooled, 1 = fully the subset's own solve).
export interface DayTypeNeat {
  rest: NeatCalibration;
  train: NeatCalibration;
  pooled: NeatCalibration;
  shrinkageWeight: { rest: number; train: number };
}

export interface NutritionSettings {
  // DEPRECATED (2026-07-31 buffer-redesign-feedforward) — retired as an athlete-facing setting.
  // targetRateKgPerWeek now owns "how fast do you want to move"; resolveBuffer (lib/nutrition.ts)
  // never reads this value in EITHER of its modes — goal-rate mode computes the buffer directly from
  // targetRateKgPerWeek/targetWeightKg, and the trend-servo fallback seeds adjustBuffer with the GOAL
  // SURPLUS as its base, not this field. That shared base is what makes the sign defect (a configured
  // surplus standing against a cutting goal) structurally unrepresentable rather than merely patched.
  // Kept on disk (never deleted — that would break existing profile JSON and the PUT validator) and
  // still accepted without erroring in a PUT payload from an older client, but no longer written by
  // any code path as an athlete edit. `adjustBuffer` itself still takes a `buffer` PARAMETER (the
  // reusable primitive, tested independently) — that is a different thing from this persisted field.
  buffer: number; // SIGNED goal-directed surplus/deficit, kcal/day; range BUFFER_MIN_KCAL..BUFFER_MAX_KCAL
  targetWeightKg: number;
  // Signed kg/week the athlete WANTS to move, e.g. +0.15 to gain slowly. null → derive from the gap and
  // the protective caps, which is Phase 1's behaviour. The sign is advisory only: direction always comes
  // from which side of target the athlete is on, so a stale value cannot invert the goal.
  targetRateKgPerWeek: number | null;
  // DEPRECATED — read only by resolveNutritionModel's legacy branch, for profiles that predate the
  // dateOfBirth/heightCm/sex RMR inputs. Never written by new code; delete once no profile needs them.
  baseCalories: number;
  restDayTarget: number;
  // Per-athlete RMR multiplier, calibrated from the athlete's own logs (calibrateNeat) once enough data
  // exists; defaults to DEFAULT_NEAT_MULTIPLIER (source: "default") until then. Adopting the derived value
  // into resolveNutritionModel is Task 4 — this field is populated but not yet read there.
  neat: NeatCalibration;
  // Rest/training split of `neat` (lib/nutrition.ts's calibrateNeatByDayType), adopted on sync under the
  // same override guard as `neat` itself. Null until the pooled gate clears AND at least one subset clears
  // DAY_TYPE_MIN_LOGGED_DAYS (persisted even at shrinkageWeight 0 — Task 3's derivation panel renders that
  // state, it isn't withheld like a bare null). resolveNutritionModel reads this to pick the rest- or
  // training-day multiplier; falls back to the flat `neat.multiplier` above when this is null.
  dayTypeNeat: DayTypeNeat | null;
}

export interface AthleteProfile {
  performance: PerformanceData;
  goals: Array<{ goal: string; target: string; focus: SeasonFocus | "general" }>;
  weakpoints: Array<{ weakpoint: string; detail: string }>;
  nutrition: NutritionSettings;
  goalsMigratedAt: string | null; // ISO timestamp once the one-time markdown migration has run
  updatedAt: string; // ISO timestamp
}

// ---------- Synced Intervals.icu data (data/last-sync.json) ----------

export interface ActivitySummary {
  id: string;
  date: string; // YYYY-MM-DD (local)
  type: string; // Ride, VirtualRide, WeightTraining, ...
  name: string;
  movingTimeSec: number;
  avgWatts: number | null;
  normalizedPower: number | null;
  maxWatts: number | null;
  // The FTP Intervals.icu APPLIED to THIS activity (icu_ftp) — its own record of the FTP that was live
  // when the ride happened, which can differ from the current settings FTP. The truest per-ride anchor
  // for ledger scoring (RV-5): it beats the effective-dated store, whose change-date is only as precise
  // as when we synced. null when absent (older rides / no power) → scoring falls back to physiologyAsOf.
  // This is the actual set FTP, NOT icu_eftp (the per-ride *estimated* FTP) — eFTP is not the athlete's
  // real FTP and must never feed scoring.
  icuFtp: number | null;
  avgHr: number | null;
  maxHr: number | null;
  kj: number | null; // total work in kJ
  // Intervals.icu's reported ACTIVE CALORIE BURN for the activity, in kcal. Present for every activity
  // type — including runs, hikes and gym work with no power meter — which is what makes off-bike energy
  // count at all. This figure is GROSS metabolic cost — it is derived from mechanical work via GROSS
  // efficiency (~23.9%), which by its literature definition puts resting metabolic rate inside the
  // denominator, so the resting cost of the activity's own duration is already baked in. `activeBurn()`
  // returns it verbatim (never scaled, never re-derived from kj); `exerciseBurn()` is the accessor that
  // nets the resting share out, and is what the daily-target identity uses — see lib/nutrition.ts.
  // `kj` remains alongside it as what it actually is (mechanical work), and is no longer an energy proxy
  // except in activeBurn()'s flagged legacy branch.
  activeBurnKcal: number | null;
  trainingLoad: number | null;
  rpe: number | null; // icu_rpe, 1-10
  carbsIngestedG: number | null; // intervals.icu carbs_ingested ("CHO In") — grams the athlete logged consuming
  decoupling: number | null; // aerobic decoupling %
  efficiencyFactor: number | null; // icu_efficiency_factor — whole-ride Pw:HR pulled from Intervals.icu
  // Pw:HR over the ride's Z2 SAMPLES only (icu_power_hr_z2) + how many Z2 minutes it was computed over
  // (icu_power_hr_z2_mins). intervals.icu isolates the aerobic portions, so this is a clean, like-for-like
  // aerobic-efficiency reading present even on interval days — the athlete-state aerobic signal (higher =
  // fresher), trusted only above a Z2-minutes floor. null when the ride had no Z2.
  powerHrZ2: number | null;
  powerHrZ2Mins: number | null;
  description: string | null; // athlete's free-text note written in Intervals.icu
  avgCadence: number | null; // rpm
  distanceMeters: number | null;
  elevationGain: number | null; // metres
  powerZoneTimes: number[] | null; // seconds in each power zone [z1, z2, ..., z7]
  hrZoneTimes: number[] | null; // seconds in each HR zone
  // Anaerobic work capacity, athlete-level. intervals.icu's ROLLING W′ estimate (icu_rolling_w_prime) —
  // the same value on every activity in a window, drifting slowly as the power curve moves. Live-verified
  // over 76 rides / 3 months: 22.0–24.8 kJ, 30 distinct values — a smooth athlete signal, safe to read as
  // "the athlete's W′ right now".
  //
  // TRAP — do NOT swap this for `icu_pm_w_prime` or `icu_pm_cp`. Those are PER-RIDE power-model fits: over
  // the same 76 rides, icu_pm_cp ranged 145–282 W and icu_pm_w_prime 11.0–24.8 kJ, with a fresh value on
  // nearly every ride. They describe what the athlete did that day, not what they're capable of — the exact
  // eFTP failure mode already documented on `icuFtp` above. There is no trustworthy per-ride or rolling CP
  // here either: `icu_rolling_cp` is null on every activity for this athlete, so FTP (icuFtp / the
  // effective-dated physiology store) remains the only threshold anchor.
  wPrimeRollingJ: number | null;
  // How deep THIS ride went into the anaerobic reserve — peak W′-balance depletion in joules
  // (icu_max_wbal_depletion). Genuinely per-ride and genuinely useful: 0 J on a steady virtual ride,
  // 24.0 kJ on the hardest ride in the window. Read against wPrimeRollingJ it gives the fraction of
  // capacity a session actually consumed. Unlike the pm_* fields this is a measurement of the ride,
  // not a re-estimate of the athlete, so per-ride volatility is the signal rather than noise.
  wBalDepletionJ: number | null;
  // Heart-rate recovery: bpm dropped in 60s after a qualifying sustained hard/threshold effort.
  // null on rides with no qualifying effort (e.g. pure Z2 days) or when intervals.icu didn't compute one.
  // Live-verified against a real sync (42 rides, ~45 days): the value sits NESTED at `icu_hrr.hrr` —
  // `icu_hrr` itself is an object ({ start_index, end_index, start_bpm, end_bpm, hrr, ... }) or null, not
  // a flat number. `icu_hrrc` does not exist in the real payload. See fetchActivities for the parse.
  hrrc: number | null;
}

export interface WellnessEntry {
  date: string; // YYYY-MM-DD
  weightKg: number | null;
  hrv: number | null;
  sleepHours: number | null;
  sleepQuality: number | null;
  kcalConsumed: number | null;
  ctl: number | null;
  atl: number | null;
  // Note: subjective self-report (soreness/fatigue/stress/mood/motivation/injury) was synced briefly but
  // removed — it was latent/dead and un-utilitarian. The morning read is now a manual "feeling ill /
  // extreme fatigue" flag (see MorningCheckEntry); objective wellness above is what the load model uses.
}

export interface PowerCurvePoint {
  durationSec: number;
  watts: number;
}

// A power best set during a single ride, vs the 84-day curve as it stood before that ride.
export interface PowerPR {
  durationSec: number;
  watts: number; // this ride's mean-max for the duration
  prevWatts: number; // the previous best it beat
}

// ---------- Power profile (Track A — rider-type + weak-point, derived on demand) ----------
// The shape of the power curve, classified deterministically. Computed on the fly from the synced
// curve + physiology FTP (no persisted store — it's a trivial pure transform of already-loaded data,
// so a derived file would only add staleness). The LLM phrases it; it never computes the type.

export type RiderType = "sprinter" | "puncheur" | "time-trialist" | "all-rounder";

// The four physiological systems the anchor durations map onto. Threshold (20 min ≈ FTP) is the
// baseline the others are measured against, so it's never itself a strength or a weak point.
export type PowerSystem = "neuromuscular" | "anaerobic" | "vo2max" | "threshold";

export interface PowerSystemStrength {
  system: PowerSystem;
  durationSec: number;
  watts: number;
  wattsPerKg: number | null; // null when bodyweight is unknown — display only; classification ignores it
  // The anchor's power as a multiple of FTP, divided by the population reference multiple for that
  // duration. 1.0 = exactly as expected for this engine; >1 stronger, <1 a relative dip.
  relativeStrength: number;
}

export interface PowerProfile {
  riderType: RiderType;
  systems: PowerSystemStrength[]; // neuromuscular / anaerobic / vo2max, ordered short→long (threshold omitted: it's the baseline)
  // The single most-depressed system vs this rider's own engine — the "easy win" micro-target.
  // null when nothing is meaningfully below expectation (a balanced curve).
  easyWin: { system: PowerSystem; durationSec: number; relativeStrength: number } | null;
  confident: boolean; // false when too few anchor durations are present to trust the read
  ftp: number; // the FTP the ratios were normalised against (provenance)
  basis: "all-time" | "84-day"; // which curve was analysed
}

export interface FitnessMetrics {
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
}

export interface SyncData {
  syncedAt: string; // ISO timestamp
  activities: ActivitySummary[];
  wellness: WellnessEntry[];
  powerCurve: PowerCurvePoint[]; // 84-day best efforts — recent form
  powerCurveAllTime?: PowerCurvePoint[]; // all-time best efforts — true PRs + PR-detection baseline
  fitness: FitnessMetrics;
}

// ---------- Generated plan ----------

export interface BlockParams {
  lengthWeeks: 2 | 4 | 6 | 8;
  goal: string;
  weakpoints: string[];
  startDate: string; // YYYY-MM-DD
}

export interface PlannedDay {
  date: string; // YYYY-MM-DD
  weekNumber: number;
  weekTheme: string;
  name: string;
  type: WorkoutType;
  durationMin: number;
  workoutText: string; // Intervals.icu workout step syntax ("" for Rest)
  description: string; // Intent + nutrition text
}

export interface GeneratedPlan {
  overview: string;
  days: PlannedDay[];
  warnings: string[];
  raw: string;
  blockParams: BlockParams;
  // Provenance: the model + prompt version that produced this output (audit/reproducibility).
  // Optional so plans persisted before stamping landed still parse.
  model?: string;
  promptVersion?: number;
  // Track B: the durability template (A–E) the long ride was built around — drives rotation across
  // blocks and lets the future per-template scoring loop attribute outcomes.
  durabilityTemplate?: string;
  // Season-architecture-redesign §4: the rolling-mode focus chosen at generation time (chooseNextFocus),
  // carried through so /api/write can stamp CurrentBlock.seasonFocus without recomputing it against
  // different "as of" data. Absent for an event-anchored block (that path keeps its own persisted
  // period lookup) and for plans generated before this shipped — truthy-check, never `=== null`.
  seasonFocus?: SeasonFocus;
  seasonFocusRationale?: string;
  // Protocol violations on quality sessions (Threshold/VO2max/SIT/RaceSim) — a distinct,
  // higher-severity category than `warnings`: the session contradicts its own KB protocol, so
  // writing it means the plan and the lived session describe different things. Kept out of
  // `warnings` so the UI renders it as its own red category. Optional: plans generated before this
  // field parse back as undefined — truthy-check on read.
  protocolViolations?: string[];
}

// ---------- Active block (data/current-block.json) ----------

// Acute:chronic workload ratio (7-day vs 28-day average daily TSS) — the standard
// injury-risk load signal. Sweet spot ~0.8–1.3; >1.5 is danger.
export interface AcwrResult {
  acute: number; // avg daily TSS, last 7d
  chronic: number; // avg daily TSS, last 28d
  ratio: number;
  level: "low" | "optimal" | "high" | "danger";
}

// Training-time intensity split (polarization check; ~80/20 easy/hard is the target).
export interface IntensityDistribution {
  easyPct: number; // < 0.75 IF
  moderatePct: number; // 0.75–0.90
  hardPct: number; // > 0.90
}

// A prescribed work effort parsed from a planned day's workout — the coach's intent,
// captured structurally so execution can be compared against it (e.g. "2×20 @ 288W").
export interface PrescribedInterval {
  reps: number;
  durationSec: number;
  targetPctFtp: number;
  targetWatts: number; // resolved via FTP at generation time
  label: string; // "2×20m @ 288W"
}

// Measurability: a stable, comparable difficulty stamp for a generated session, derived at write time
// from the parsed prescription (lib/session-level.ts) and frozen onto the block day — so block N's
// Threshold session can be compared to block N+2's even though the LLM wrote them independently.
export interface SessionLevel {
  score: number; // work minutes × (avg %FTP / 100) — the intensity-weighted work dose
  workMin: number; // total prescribed work-effort minutes (warmup/cooldown/recovery excluded)
  avgPctFtp: number; // duration-weighted mean %FTP across the work efforts
  bandPosition: number | null; // 0–1 position inside the type's KB protocol intensity band; null when the type has no band
}

// One executed effort from Intervals.icu (where the athlete curates interval detection).
export interface ExecutedInterval {
  type: string; // "WORK" | "RECOVERY" | ...
  durationSec: number;
  avgWatts: number | null;
  npWatts: number | null;
  avgHr: number | null;
  startIndex: number | null; // index into the activity's sample stream
  endIndex: number | null;
}

// Prescription vs execution, rep-by-rep, with a roll-up — the "second brain" comparison.
export interface IntervalAdherence {
  targetWatts: number;
  actualWatts: number;
  durationSec: number; // executed duration
  targetDurationSec: number; // prescribed duration
  adherencePct: number; // actualWatts / targetWatts * 100 (power only)
  durationPct: number; // executed / prescribed duration * 100
}
export interface IntervalComparison {
  prescribedLabels: string[];
  reps: IntervalAdherence[];
  completed: number; // reps that hit ≥90% of the prescribed duration (truly finished)
  total: number; // prescribed reps
  avgAdherencePct: number; // avg power adherence across reps
  avgDurationPct: number; // avg duration completion across reps
  effectiveAdherencePct: number; // power × duration completion — what execution scoring uses
  // The plan's per-rep duration definition disagrees with what was actually ridden/detected
  // (every rep ran ~half-or-less the prescribed length, yet power was nailed and the rep count
  // matched). That signature is a plan-vs-detection mismatch — NOT a failed session — so
  // duration-based adherence is untrustworthy and execution scoring should fall back to the
  // intent-independent signals. Distinct from a genuine bail (short reps with weak power).
  structuralMismatch: boolean;
  // Executed work efforts beyond the prescribed rep count — e.g. a mid-ride interval the athlete
  // added on top of the plan. Surfaced as bonus context; they don't count toward completed/total.
  extras: { actualWatts: number; durationSec: number }[];
}

export interface CurrentBlockDay {
  date: string;
  name: string;
  type: WorkoutType;
  durationMin: number;
  // Track B: the block's durability template (A–E), stamped on the week's long Z2 ride at write time so
  // scoring can grade that ride against its template's expected signal. Absent on non-long-ride days and
  // on blocks written before stamping landed.
  durabilityTemplate?: string;
  // Measurability: the session's difficulty stamp (see SessionLevel), computed from `prescription`
  // at write time and frozen so retrospectives can compare like sessions across blocks. Absent on
  // days with no parsed work efforts (Rest / pure endurance / Strength) and on blocks written
  // before this shipped — read sites must truthy-check, never `=== null`.
  sessionLevel?: SessionLevel;
  workoutText?: string; // Intervals.icu step syntax — the coach's prescription
  prescription?: PrescribedInterval[]; // structured work intervals parsed from workoutText
  // The Intervals.icu event id this day was written as. Stored so the block's planned-workout events
  // can be removed from the calendar when the block is discarded or replaced (RV-9). Absent on blocks
  // written before id-tracking, or when a day's write returned no id.
  eventId?: number | null;
  // Block history enrichment (ROADMAP season-architecture-redesign §8): the real execution outcome
  // for this day, joined from the score log once the session is actually ridden and scored.
  // `compromised: true` mirrors RideScoreEntry.compromised (sickness/equipment/etc., athlete-
  // attributed) — present only when true, so a future consumer reading this field alone doesn't
  // mistake a compromised low score for a genuine one. Absent until scored, and on blocks/history
  // written before this field existed — truthy-check, never `=== null`.
  execution?: { score: number; compliancePct: number | null; compromised?: true };
  // Deterministic protocol/duration findings for this day, re-run and frozen at WRITE time (the same
  // checks generation already ran — see lib/workout-validate.ts). Lets a later "written despite a
  // known violation" correlation exist without re-running validators against a since-changed FTP/
  // calibration. Absent when the day carries no findings, or on days written before this shipped.
  protocolFindings?: string[];
}

export interface CurrentBlock {
  goal: string;
  lengthWeeks: number;
  startDate: string;
  endDate: string;
  overview: string;
  createdAt: string;
  days: CurrentBlockDay[];
  // Provenance carried from the GeneratedPlan that produced this block (see GeneratedPlan).
  model?: string;
  promptVersion?: number;
  durabilityTemplate?: string; // Track B: the durability template (A–E) this block's long ride uses
  // Quality sessions dropped mid-block (a proactive downgrade with no make-up slot) — surfaced to the
  // next generation as a carry-forward priority so the stimulus isn't silently lost (CR-6).
  deferredQuality?: string[];
  seasonFocus?: string; // MACRO: the focus period this block was generated under
  seasonPhase?: string;
}

// ---------- Season plan (data/season-plan.json) — macro periodization (MACRO-1..3) ----------

export type SeasonFocus = "aerobic-base" | "threshold" | "vo2max" | "anaerobic" | "durability" | "sharpen";
export type SeasonPhase = "base" | "build" | "peak" | "taper" | "transition";

export interface SeasonEvent {
  name: string;
  date: string; // ISO YYYY-MM-DD
  priority: "A" | "B" | "C";
}

export interface FocusPeriod {
  focus: SeasonFocus;
  phase: SeasonPhase;
  startDate: string; // ISO
  plannedWeeks: number; // 1–8 (taper can be a single week)
  intensitySplit: string; // KB, e.g. "80/20"
  targetWeeklyTss: number | null; // null when FTP/CTL unavailable
  deloadWeek: boolean; // trailing recovery week
  rationale: string; // KB-grounded; the only LLM-phrased field
  source: "derived" | "override";
  confidence: "low" | "medium" | "high"; // limiter-pick confidence
  achievedTss?: number; // stamped when the period rolls into the past (frozen)
}

export interface SeasonPlan {
  objective: string;
  events: SeasonEvent[];
  periods: FocusPeriod[];
  updatedAt: string;
}

// ---------- Block generation settings (data/block-settings.json) ----------

export interface BlockSettings {
  weeklyHoursMin: number; // loading weeks minimum
  weeklyHoursMax: number; // loading weeks maximum
  recoveryWeekHoursMin: number;
  recoveryWeekHoursMax: number;
  qualitySessionsPerLoadingWeek: number; // threshold / VO2max / SIT sessions
  longRideDurationMinutes: number; // minimum long ride duration
  restDaysPerWeek: number;
  polarisedApproach: boolean; // true = polarised (80/20), false = sweet spot
  // Platform behaviour
  autoSyncOnOpen: boolean; // auto-sync the Today view when cached data is stale
  autoPostCoachNote: boolean; // auto-post the coach note to Intervals.icu on each sync
  // Optional manual calibration override for the ACWR injury-risk bands. Absent = population
  // defaults; set to personalise the optimal/danger thresholds (the hybrid calibration hook).
  acwrBands?: { optimalLow: number; optimalHigh: number; dangerHigh: number };
  // Optional manual override for the TSB adaptation-window edges resolveTsbModifier classifies form
  // against (ROADMAP #2). Absent = population defaults; set to personalise the fatigue-tolerance bands.
  tsbModifierEdges?: { deepFatigue: number; productiveOverload: number; balanced: number };
  // Optional manual override for the durability-insert envelope (ROADMAP #2): the %FTP floor above
  // which an embedded effort counts as a hard insert, and the %FTP / duration ceiling it must fall
  // within. Absent = population defaults (88% floor, ≤122% / ≤20 min).
  durabilityInsertEnvelope?: { embeddedHardPct: number; maxIntensityPct: number; maxEffortMin: number };
  // Optional manual override for the athlete-state fusion weights (ROADMAP §5 / #2). A deep-partial:
  // any subset of the BASE / per-signal scales-caps-thresholds; absent or missing leaves fall back to
  // the population default (DEFAULT_ATHLETE_STATE_WEIGHTS). Shape mirrors AthleteStateWeights.
  athleteStateWeights?: {
    BASE?: number;
    tsb?: { scale?: number; cap?: number; freshAbove?: number; deepBelow?: number };
    acwr?: { optimal?: number; low?: number; high?: number; danger?: number };
    exec?: { mid?: number; perPoint?: number; trend?: number; cap?: number };
    decoupling?: { perPct?: number; cap?: number; deadband?: number };
    rpe?: { perPoint?: number; cap?: number; deadband?: number };
    behaviour?: { highOffPlan?: number; effect?: number };
    override?: { livedThreshold?: number; scoreCap?: number };
  };
  updatedAt: string;
}

export const DEFAULT_BLOCK_SETTINGS: BlockSettings = {
  weeklyHoursMin: 10,
  weeklyHoursMax: 12,
  recoveryWeekHoursMin: 6,
  // P2b (2026-07-24 block-generation redesign): widened from 7 to 8 so the derived recovery target
  // (60% of a 12h loading target = 7.2h, lib/block-skeleton.ts) governs instead of being immediately
  // clamped back to the old fixed ceiling — the exact interaction that made the old 6-7h band retain
  // ~72% of loading (a shallower cut than the KB's own 30-50%-reduction rule) once loading itself
  // undershot its own target.
  recoveryWeekHoursMax: 8,
  qualitySessionsPerLoadingWeek: 2,
  longRideDurationMinutes: 180,
  restDaysPerWeek: 1,
  polarisedApproach: true,
  autoSyncOnOpen: true,
  autoPostCoachNote: false,
  updatedAt: new Date(0).toISOString(),
};

// ---------- Block history (data/block-history.json) ----------

// Track D: one structured clinical reflection tying a prior-block hypothesis to its matured outcome.
// AI-authored language (the model phrases it); the underlying hypothesis/outcome data is deterministic.
// Shape mirrors retrospective-schema.ts's ReflectionSchema (keep the two aligned).
export interface StructuredReflection {
  dimension: string; // a WorkoutType or "Overall"
  hypothesis: string;
  observation: string;
  root_cause: string;
  adjusted_strategy: string;
}

export interface BlockHistoryEntry {
  id: string;
  goal: string;
  startDate: string;
  endDate: string;
  lengthWeeks: number;
  overview: string;
  createdAt: string;
  // Retrospective fields — populated when block is completed
  complianceByType?: Partial<Record<WorkoutType, number>>;
  actualHours?: number;
  plannedHours?: number;
  ctlGain?: number | null;
  nextBlockSeeds?: string[];
  retrospective?: string; // Claude narrative
  structuredReflections?: StructuredReflection[]; // Track D: hypothesis→outcome notes, fed into the next block's prompt
  // Provenance of the block this entry archives (see GeneratedPlan).
  model?: string;
  promptVersion?: number;
  durabilityTemplate?: string; // Track B: durability template (A–E) used — for rotation + scoring
  // Season-architecture-redesign §8: carries forward whatever focus the archived block itself was
  // stamped with (CurrentBlock.seasonFocus) — a self-contained record for the selector's exposure
  // signal and future scorer weighting, without a separate cross-reference. Absent on entries archived
  // before this field existed, or when the block predates season-focus stamping entirely.
  seasonFocus?: SeasonFocus;
  // SUB-1: the block's per-day prescriptions, truncated to dates on/before the archive date (its "lived"
  // portion — a superseded/discarded block's un-lived future was never a real plan). Verbatim CurrentBlockDay
  // reuse — buildRideScores applies the same durationMin > 0 filter it already applies to the live block.
  // Absent on entries archived before this field existed; they contribute nothing to historical matching.
  days?: CurrentBlockDay[];
}

// ---------- Readiness / fatigue signals (computed at sync time) ----------

export interface ReadinessSignal {
  level: "Build" | "Hold" | "Recover";
  reason: string;
}

export interface FatigueAlert {
  triggered: boolean;
  type: "atl_ctl_ratio" | "tsb" | "none";
  reason: string | null;
}

export interface LoadRampAlert {
  triggered: boolean;
  level: "none" | "caution" | "high";
  thisWeekTss: number;
  lastWeekTss: number;
  changePct: number | null;
  reason: string | null;
}


// ---------- Per-ride execution score log (data/score-log.json) ----------
// Accumulates over time so the trends view can chart execution quality across
// blocks, even after a block is cleared from current-block.json.

export interface RideScoreEntry {
  date: string;
  executionScore: number;
  // The prescribed type when this date had a planned session; null for off-plan rides.
  plannedType: WorkoutType | null;
  // The effort type used for grouping: plannedType when planned, otherwise inferred from
  // intensity/duration. Always present so every ride can join the model.
  inferredType: WorkoutType;
  planned: boolean; // false = ridden off-plan (scored on intrinsic quality, not adherence)
  // Pre-structure ride (before the first block): stored as history but excluded from the
  // execution-quality metric and the drift signal — there was no plan for it to be "off."
  legacy: boolean;
  // Athlete-attributed: the session was compromised by something outside their control
  // (equipment, sickness…). Kept as history but excluded from the execution metric + model —
  // the raw score stays honest, but it must not *teach* the model. Derived from DispositionLog.
  compromised?: boolean;
  compliancePct: number | null; // null for off-plan rides (no prescription to compare against)
  intensityFactor: number | null;
  // Provenance stamp (ROADMAP #8): true when normalizedPower was absent and intensityFactor fell back to
  // avg power instead (score-log.ts's `ifBasis = normalizedPower ?? avgWatts`) — an avg-based IF
  // understates variable/surgy efforts vs a true NP read. Mirrors the "NP"/"avg" badge the Today debrief
  // already shows for the live ride; this freezes the same distinction onto the historical ledger.
  // Absent (not `false`) when NP was present, or when there was no power data to fall back to at all.
  npUnverified?: boolean;
  ftpUsed: number; // FTP this entry was scored against — frozen so history never re-shifts
  durationMin: number; // feeds the behaviour/volume signal
  tss: number | null;
  // The per-athlete calibration this entry was scored against (ROADMAP #2) — frozen alongside ftpUsed
  // so the immutable ledger stays reproducible. Absent on entries scored before calibration shipped
  // (those used population defaults). `ifBandOffset` is the per-type IF-band shift that scored THIS entry
  // (planned rides only — off-plan rides skip the intensity-vs-type branch). (Decoupling was demoted out
  // of execution scoring — ACC-2026-06-25 — so it's no longer stamped here.)
  calibration?: { ifBandOffset?: number };
  // Athlete-state CONTEXT frozen at scoring time (ROADMAP #2 — context-stamp the ledger): the objective
  // load (intervals.icu's own per-day CTL/ATL, authoritative) the athlete carried into this session, so a
  // later state→subsequent-execution correlation can derive the override-only edges honestly (e.g. the TSB
  // adaptation window). Provenance only — never feeds the entry's own executionScore. Absent on pre-feature
  // entries or when no wellness covers the date.
  formState?: RideFormState;
  // Fueling CONTEXT frozen at scoring time (ROADMAP Track C): the carbohydrate intake the athlete logged
  // for this ride, normalised to g/h, so a later carbs→execution/decoupling correlation can derive their
  // optimal intake. Provenance only — never feeds executionScore. Stamped only when a real (>0) intake was
  // logged in intervals.icu (carbs_ingested); absent otherwise (most rides, until the athlete fills it in).
  fuel?: { carbsGPerH: number };
  // Interval-adherence signal frozen at scoring time (ROADMAP scoring-core gap): the prescription-vs-
  // executed comparison that scored THIS entry, persisted so (a) the frozen score is reproducible and
  // (b) a one-shot rebuild can re-score a corrected formula without re-fetching per-ride intervals
  // (the SIT 2/10 lesson). Unlike formState/fuel this DOES feed executionScore — it is the primary
  // signal on planned interval days. adherencePct is effectiveAdherencePct (power × duration);
  // structuralMismatch true means duration was untrustworthy and scoring fell back (input treated null).
  // Absent on: off-plan rides, steady/durability days, entries born before this shipped, fetch failures.
  intervals?: {
    adherencePct: number;
    structuralMismatch: boolean;
    completed: number;
    total: number;
  };
  // Track B / Track C: durability-template ride outcomes + inputs, frozen as provenance.
  // durabilityDelivery = the gradeDurabilityDelivery signal that judged THIS ride (+2 delivered ·
  // 0 mis-placed · -2 absent). Stamped by the sync today-patch (the only path that fetches the ride's
  // executed intervals). preLoad = the athlete's day-before carb-loading attribution (loading-log.json)
  // + the target prescribed. Neither feeds executionScore here; they are the loading loop's corpus.
  // ponytail: a durability ride synced ≥1 day late gets no delivery stamp (the birth-time fetch
  // deliberately excludes template days) — extend that fetch if the loading corpus starves.
  durabilityTemplate?: string;
  durabilityDelivery?: { signal: number };
  preLoad?: { loaded: boolean; targetG: number };
  // Easy-ride merged-read provenance (planned Z2/Recovery, non-embeds-efforts only): the inputs
  // behind the merged aerobic execution read, frozen so the score is re-derivable and the athlete
  // model can diagnose indoor/outdoor + ran-hot patterns without re-joining activities. Absent on
  // other types, off-plan rides, durability templates B–E, and pre-feature entries.
  easy?: { indoor: boolean; hrRead?: AerobicDiscipline; aerobicEffPct?: number };
}

// Form (fitness/fatigue/balance) as of a ride's date — the slow-moving load state from the synced
// wellness stream. TSB = CTL − ATL (the app's convention). Stamped on each ledger entry as context.
export interface RideFormState {
  tsb: number;
  ctl: number;
  atl: number;
}

// Everything stamped onto a ledger entry as athlete-state context for a given date (ROADMAP #2). Resolved
// per-date and frozen onto the entry; absent when no wellness covers that date.
export interface RideEntryContext {
  formState?: RideFormState;
}

// ---------- Athlete model (the learning "second brain") ----------

// Recency-weighted (EWMA) performance per workout type, derived from the score log.
export interface AthleteTypeStat {
  type: WorkoutType;
  n: number;
  execEwma: number; // EWMA of execution score (1-10)
  complianceEwma: number; // EWMA of duration compliance %
  trend: "up" | "down" | "flat";
  // Indoor/outdoor diagnostic breakdown (Z2/Recovery only), built from each entry's `easy` ledger
  // stamp (RideScoreEntry.easy — the merged aerobic-discipline read's provenance). Computed over
  // the same planned/non-compromised entries execEwma uses, restricted further to the subset that
  // actually carries a stamp (pre-rebuild-ledger entries won't). Absent when the type isn't
  // Z2/Recovery, or when `reads` would be 0 (nothing to diagnose) — follows the sparse-field
  // convention, never an empty object.
  easy?: {
    reads: number; // entries in this type's population that carry an `easy` stamp
    indoorN: number;
    outdoorN: number;
    indoorExecAvg: number | null; // round1 mean executionScore, indoor subset; null under 2 samples
    outdoorExecAvg: number | null; // round1 mean executionScore, ALL outdoor (hot+controlled mixed); null under 2 samples
    // Mean executionScore over outdoor entries whose hrRead !== "hot" only (dialed/drift/no-read) —
    // isolates "how good are the outdoor rides that DIDN'T blow up HR" from outdoorExecAvg, which hot
    // rides would otherwise drag down. round1; null under 2 samples. Not in the task brief's literal
    // shape — added so deriveInsights' "healthy side" gate isn't polluted by the very hot rides the
    // bimodal-pattern insight is trying to isolate from (see athlete-model.ts deriveInsights).
    outdoorControlledExecAvg: number | null;
    outdoorHotN: number; // outdoor entries where hrRead === "hot"
    // Training-load premium of hot vs controlled easy rides: mean(tss/durationMin) per group, using
    // each entry's real intervals.icu tss + durationMin. round2; null under 2 qualifying samples.
    hotTssPerMin: number | null; // hrRead === "hot" (any indoor/outdoor)
    controlledTssPerMin: number | null; // hrRead !== "hot" (indoor + dialed/drift outdoor)
  };
}
// Complete-riding-behaviour signal — derived from ALL logged rides (planned + off-plan),
// so the model sees how the athlete actually trains, not just plan adherence.
export interface BehaviourSummary {
  totalRides: number;
  plannedRides: number;
  unplannedRides: number;
  offPlanPct: number; // unplanned / total, 0-100
  unplannedAvgQuality: number | null; // mean intrinsic execution score of off-plan rides
  weeklyHours: number | null; // mean weekly ride hours across the logged window
}

export interface AthleteModel {
  byType: AthleteTypeStat[]; // execution EWMA from PLANNED rides only (adherence semantics)
  overallExecEwma: number;
  overallTrend: "up" | "down" | "flat";
  sampleSize: number; // planned-ride sample size
  behaviour: BehaviourSummary; // recent ~8 weeks — reflects CURRENT habits, drives the drift signal
  behaviourAllTime: BehaviourSummary; // full ledger (~6 months) — retained for longer-range context
}
// A derived coaching observation, surfaced to the athlete and fed into generation.
export interface Insight {
  dimension: string; // "VO2max", "Overall", ...
  severity: "good" | "watch" | "alert";
  title: string;
  evidence: string;
  suggestion: string;
}

export interface ScoreLog {
  entries: RideScoreEntry[];
  updatedAt: string;
}

// One-shot marker for the SYNC-2 ledger rebuild (LEDGER-3). Persisted so the destructive re-score runs
// at most once; null = never rebuilt. See shouldRebuildLedger.
export interface LedgerRebuildMarker {
  rebuiltAt: string | null;
}

// ---------- Intervention / validation ledger (data/intervention-log.json) ----------
// Closes the learning loop: when an insight drives a generated block it is recorded here
// with a baseline snapshot, then re-evaluated after a horizon to mark whether acting on it
// actually moved the needle — so insights become measured rather than merely asserted.

export type InterventionVerdict = "validated" | "refuted" | "inconclusive";

export interface InterventionOutcome {
  evaluatedAt: string;
  execNow: number | null;
  physNow: number | null;
  execDelta: number | null; // execNow - baselineExecEwma
  physDelta: number | null; // physNow - baselinePhys (direction-normalised: + = improvement)
  verdict: InterventionVerdict;
}

export interface InterventionRecord {
  id: string;
  firedAt: string; // YYYY-MM-DD the driving block was written
  blockStartDate: string;
  dimension: string; // a WorkoutType or "Overall"
  severity: "alert" | "watch" | "good";
  title: string;
  horizonDays: number; // evaluate once this many days have elapsed
  baselineExecEwma: number | null; // per-dimension execution EWMA at fire time
  baselinePhys: number | null; // physiological marker at fire time
  physMetric: string; // which marker (e.g. "5-min power", "Pw:HR")
  outcome: InterventionOutcome | null; // null until matured + evaluated
}

export interface InterventionLog {
  records: InterventionRecord[];
  updatedAt: string;
}

// Per-dimension hit-rate roll-up, fed back into generation as insight confidence.
export interface ValidationSummary {
  byDimension: Array<{
    dimension: string;
    validated: number;
    refuted: number;
    inconclusive: number;
    hitRate: number | null; // validated / (validated + refuted)
  }>;
  evaluated: number;
  pending: number;
}

// ---------- Physiology store (data/physiology.json) ----------
// The single source of truth for time-varying physiology (FTP, zones, threshold/max HR).
// Pulled from Intervals.icu on sync; effective-dated so every historical analysis can be
// anchored to the FTP/zones that were live when the ride happened. Zones are stored as
// Intervals stores them — power as % of FTP, HR as raw bounds — and resolved on demand.

export interface PhysiologySnapshot {
  effectiveFrom: string; // YYYY-MM-DD this FTP/zone set became active
  capturedAt: string; // ISO timestamp it was first observed
  source: "intervals" | "manual";
  ftp: number; // watts
  lthr: number | null; // lactate-threshold HR (bpm)
  maxHr: number | null; // bpm
  powerZonePct: number[]; // ascending upper bounds as % of FTP (top zone open above the last)
  hrZones: number[]; // ascending upper bounds (bpm if hrZonesAreBpm, else % of LTHR)
  hrZonesAreBpm: boolean; // how to interpret hrZones
  powerZoneNames: string[]; // optional names; synthesized Z1..Zn if absent
  hrZoneNames: string[];
}

export interface PhysiologyStore {
  current: PhysiologySnapshot;
  history: PhysiologySnapshot[]; // superseded snapshots, oldest→newest (current excluded)
}

// ---------- Rolling baselines (data/rolling-baselines.json) ----------

export interface RollingBaselines {
  avgCtl90d: number | null;
  avgDecoupling90d: number | null;
  avgTss90d: number | null;
  avgWeeklyHours90d: number | null; // rolling 90-day mean weekly ride hours (window-consistent with the others)
  ridesPerWeek90d: number | null; // rolling 90-day mean rides/week — training consistency (same window as hours)
  updatedAt: string;
}

// ---------- Per-athlete calibration (data/calibration.json — ROADMAP #2) ----------

// One learned parameter with its provenance + a guard against chasing noise. Auto-derived from the
// athlete's own data once there's enough of it, then locked; a manual override always wins. The
// effective value is resolved (not read raw) — see resolveCalibratedValue in lib/calibration.ts.
export interface CalibratedParameter {
  value: number; // the auto-derived value (a population default lives at the call site as fallback)
  source: "default" | "derived" | "manual";
  confidence: "low" | "medium" | "high"; // from sample size (and later variance)
  dataPoints: number; // how many observations the derivation rests on
  lastUpdated: string; // ISO
  locked: boolean; // once high-confidence, stop chasing new data unless manually overridden
  manualOverride: number | null; // athlete/coach pin; takes precedence over any derived value
}

// The calibration store. Derived (regenerated on sync), one field per calibrated parameter; grows as
// parameters are brought under the framework (Phase 1 shipped `decouplingGood`; Track C added
// `carbsOptimum`).
export interface CalibrationStore {
  decouplingGood: CalibratedParameter;
  // Track C: in-ride carbs optimum (g/h) on steady long endurance rides. OPTIONAL — a calibration.json
  // written before this field existed parses back as undefined (not null); read sites must tolerate it.
  carbsOptimum?: CalibratedParameter;
  updatedAt: string;
}

// ---------- Athlete quirks (data/athlete-quirks.json — Track D) ----------
// A DERIVED store, not owned intent: recurring patterns mined deterministically from the athlete's
// own ride notes (activityDescription). Kept separate from athlete_profile.md (which stays
// authoritative). Tags are HINTS injected into generation, not facts — pattern-matching is noisy.
// Regenerated in full on every sync, so no backup/ledger semantics (like rolling-baselines).

export type QuirkCategory = "symptom" | "equipment" | "psyche" | "condition";

export interface QuirkEntry {
  pattern: string; // canonical tag, e.g. "cramp", "ghost resistance", "indoor aversion"
  category: QuirkCategory;
  frequency: number; // how many distinct rides mentioned it (only ≥2 are kept)
  firstSeen: string; // YYYY-MM-DD of the earliest mention
  lastSeen: string; // YYYY-MM-DD of the most recent mention
  evidence: string; // a short snippet from the most recent mention (for transparency)
}

export interface AthleteQuirkStore {
  entries: QuirkEntry[]; // sorted by frequency desc
  extractedAt: string;
  engine: string; // extractor provenance, e.g. "compromise@<version>+lexicon"
}

// ---------- Athlete state (ROADMAP §5 signal fusion — see docs/specs/athlete-state.md) ----------

// One signal's contribution to the fused score; also the hover detail ("what moved it").
export interface SignalContribution {
  key: string; // "tsb" | "acwr" | "execution" | "decoupling" | "rpe" | "behaviour" | …
  label: string;
  dir: "up" | "down" | "flat"; // the signal's own movement (e.g. decoupling "up" = worse)
  effect: number; // signed points added to the score (− = worse state)
  note: string; // one-line plain-English reason
  // Stricter-than-`dir` flag: true only when this signal is confidently real enough to corroborate the
  // fatigue override (isLivedNegative), not merely outside its deadband. Currently only set by
  // evalAerobicEff — Pw:HR is a flaky metric (heat/hydration/caffeine/sleep), so a modest dip should nudge
  // the score without alone helping trigger the hard score-cap. Undefined for every other signal (their
  // `dir === "down"` IS their strict bar).
  livedNegative?: boolean;
}

// The glanceable "what the second brain thinks of you right now" metric — a 0–100 score that fuses
// the parallel signals into one reconciled read. Deterministic; the AI only phrases the headline.
export interface AthleteState {
  score: number; // 0–100
  band: "primed" | "ready" | "steady" | "strained" | "depleted";
  recommendation: "push" | "proceed" | "soften" | "recover";
  confidence: "low" | "medium" | "high";
  drivers: SignalContribution[]; // sorted by |effect| desc
  headline: string;
}

// ---------- Today's ride analysis (data/today-analysis.json) ----------

export interface TodayAnalysis {
  analysedAt: string;
  activityDate: string;
  activityName: string;
  activityDurationMin: number;
  activityAvgWatts: number | null;
  activityNormalizedPower: number | null;
  activityMaxWatts: number | null;
  activityAvgHr: number | null;
  activityMaxHr: number | null;
  activityKj: number | null;
  activityTrainingLoad: number | null;
  activityRpe: number | null;
  activityDecoupling: number | null;
  // Easy-ride effort read (Z2/Recovery only): "dialed" | "drift" | "hot" from HR-zone time above aerobic,
  // or null for interval/off-plan days. Surfaced in the debrief; mirrors the HR execution signal.
  aerobicDiscipline: import("./execution-score").AerobicDiscipline | null;
  // Easy-ride aerobic efficiency vs baseline (signed %Δ, Z2/Recovery only), or null for interval/off-plan days.
  aerobicEffPct: number | null;
  activityDistanceMeters: number | null; // for avg-speed on the Today ride card
  plannedName: string | null;
  plannedType: string | null;
  plannedDurationMin: number | null;
  // Computed metrics
  compliancePct: number | null; // actual / planned duration %
  intensityFactor: number | null; // NP / FTP (falls back to avg watts when NP is absent)
  // Advised daily intake (deterministic, same formula as block generation)
  advisedIntakeKcal: number | null;
  advisedBaseKcal: number | null;
  advisedBufferKcal: number | null;
  advisedRideFuelKcal: number | null;
  activityDescription: string | null; // athlete's note from Intervals.icu, fed to coach
  powerZoneTimes: number[] | null;
  hrZoneTimes: number[] | null;
  powerZoneTopsPct: number[] | null; // athlete's zone tops as %FTP (as-of the ride) — boundaries for the IF band label
  executionScore: number | null; // 1-10 deterministic quality score
  coachNote: string; // Claude 2-3 sentence narrative
  intervalComparison: IntervalComparison | null; // prescription vs execution
  trace: RideTrace | null; // downsampled streams + interval bands for the power chart
  powerPRs?: PowerPR[]; // new power bests set during this ride (vs the prior 84-day curve)
  // Deterministic post-ride fuel prompt (lib/fuel-prompt.ts) — log-nudge or gap vs the derived carb
  // optimum. OPTIONAL: a today-analysis.json written before this field existed parses back as
  // undefined, not null — read sites must truthy-check (`if (analysis.fuelPrompt)`), never `=== null`.
  fuelPrompt?: FuelPrompt | null;
  // Provenance of the coach note (the only AI-produced field here); set when the note is written.
  model?: string;
  promptVersion?: number;
}

// Downsampled streams + executed-interval bands powering the ride power-trace chart.
export interface RideTrace {
  power: number[]; // downsampled watts
  hr: number[]; // downsampled bpm (same length as power)
  bands: Array<{ start: number; end: number }>; // work-interval spans as 0..1 fractions
  targetWatts: number | null; // dominant prescribed target, for the dashed line
}

// ---------- Write-back ----------

export interface IntervalsEventPayload {
  category: "WORKOUT" | "NOTE";
  start_date_local: string; // YYYY-MM-DDT00:00:00
  name: string;
  description: string;
  type?: string; // Ride, WeightTraining — omitted for NOTE events
  moving_time?: number; // seconds
  // Client-chosen idempotency key. When present, createEvent posts to /events/bulk?upsert=true so a
  // re-written block updates the same event instead of creating a duplicate (idempotent writes). Block
  // days set `nodevelo-<date>`; ad-hoc events (notes) omit it and keep create semantics. NOT the same
  // concept as IntervalsCalendarEvent.uid — that's a server-assigned id Intervals.icu ignores on write.
  external_id?: string;
}

// A calendar event as READ from Intervals.icu (GET /athlete/{id}/events) — the mirror's inbound shape.
// `date` is the YYYY-MM-DD part of start_date_local; description is carried wholesale on moves because
// CurrentBlockDay stores no description (it lives only on the calendar event).
export interface IntervalsCalendarEvent {
  id: number | null;
  // Server-assigned, read-only UUID. Intervals.icu regenerates this on every write and ignores any
  // client-supplied value — do NOT match on this for upsert/reconcile purposes; use externalId instead.
  uid: string | null;
  // The client's idempotency key (external_id on the wire) — what inbound matching/reconcile logic
  // actually uses to find "the event NodeVelo wrote for this date."
  externalId: string | null;
  date: string;
  name: string;
  description: string;
  category: string; // WORKOUT | NOTE (loosely typed — upstream may add values)
  type: string | null; // Ride, WeightTraining, …
}

export interface WriteResult {
  date: string;
  name: string;
  ok: boolean;
  eventId: number | null;
  error?: string;
}

// ---------- Session disposition (data/dispositions.json) ----------
// The one coaching fact telemetry can't infer: *why* a session went how it did. Athlete-set,
// editable, and the objective gate for whether a ride teaches the model. Not in the immutable
// ledger (it's mutable attribution); the `compromised` flag on RideScoreEntry is derived from it.

export type SessionDisposition = "completed" | "partial" | "missed" | "compromised";
export type CompromiseReason = "equipment" | "sickness" | "weather" | "injury" | "other";

export interface DispositionEntry {
  date: string; // YYYY-MM-DD
  disposition: SessionDisposition;
  reason: CompromiseReason | null; // only meaningful when disposition = "compromised"
  setAt: string;
}

export interface DispositionLog {
  entries: DispositionEntry[];
  updatedAt: string;
}

// ---------- Morning override (data/morning-check.json) ----------
// The proactive counterpart to dispositions: a one-tap manual flag — feeling ill or extremely fatigued —
// that downgrades today's quality session. Editable per day, like dispositions (not an immutable ledger).
// Objective fatigue is surfaced separately by computeReadiness/computeFatigueAlert; this is the athlete's
// override for "I feel worse than the load model can see."

export type MorningCheckFlag = "ill" | "extreme-fatigue" | "injury";
// "proceed" = ride as planned · "downgrade" = swap/deload the quality stimulus (metabolic compromise) ·
// "rest" = skip today entirely, no swap or make-up (musculoskeletal — see decideMorningCheck for why
// an injury doesn't get the swap treatment).
export type MorningCheckDecision = "proceed" | "downgrade" | "rest";

export interface MorningCheckEntry {
  date: string; // YYYY-MM-DD
  flag: MorningCheckFlag;
  decision: MorningCheckDecision;
  setAt: string;
  // Verdict reasons frozen at flag time, so the UI re-renders the same card after a refresh (the
  // decision inputs — is today still a quality day? — can change once a downgrade is applied, so
  // recomputing them later would drift). Sparse: entries written before this field simply lack it.
  reasons?: string[];
  // Stamped by the PUT apply — a refreshed UI shows "applied" instead of re-offering an Apply
  // button that would now 400 (today is no longer a quality day post-swap). Sparse.
  appliedAt?: string;
}

export interface MorningCheckLog {
  entries: MorningCheckEntry[];
  updatedAt: string;
}

// ---------- Pre-ride loading log (data/loading-log.json, Track C) ----------
// Athlete attribution: did they actually carb-load the day before a durability long ride? Only the
// athlete knows — same owned-input philosophy as dispositions/morning-check. An absent entry means
// UNKNOWN (never assumed unloaded); only explicit responses feed the learning loop.
export interface LoadingEntry {
  rideDate: string; // YYYY-MM-DD of the durability RIDE (the loading day is the day before)
  targetG: number; // the target prescribed when asked — frozen for provenance
  response: "loaded" | "skipped";
  respondedAt: string; // ISO timestamp
}
export interface LoadingLogStore {
  entries: LoadingEntry[];
}
