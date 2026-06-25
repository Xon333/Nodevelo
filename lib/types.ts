// Shared types used across server modules and client components.

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

// ---------- Athlete profile (data/athlete.json) ----------

export interface PerformanceData {
  ftp: number; // watts
  maxHr: number; // bpm
  thresholdHr: number; // bpm
  weightKg: number; // manual entry; live weight comes from wellness sync
  weeklyHoursMin: number;
  weeklyHoursMax: number;
}

export interface NutritionSettings {
  baseCalories: number; // default 2000
  restDayTarget: number; // default 2600
  buffer: number; // kcal added on training days, default 300
  targetWeightKg: number;
}

export interface AthleteProfile {
  performance: PerformanceData;
  goals: string[];
  weakpoints: string[];
  nutrition: NutritionSettings;
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
  trainingLoad: number | null;
  rpe: number | null; // icu_rpe, 1-10
  carbsIngestedG: number | null; // intervals.icu carbs_ingested ("CHO In") — grams the athlete logged consuming
  decoupling: number | null; // aerobic decoupling %
  efficiencyFactor: number | null; // icu_efficiency_factor — Pw:HR pulled from Intervals.icu
  description: string | null; // athlete's free-text note written in Intervals.icu
  avgCadence: number | null; // rpm
  distanceMeters: number | null;
  elevationGain: number | null; // metres
  powerZoneTimes: number[] | null; // seconds in each power zone [z1, z2, ..., z7]
  hrZoneTimes: number[] | null; // seconds in each HR zone
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
  // Subjective self-report, synced straight from Intervals.icu's wellness screen so it's logged once
  // (where the athlete already logs weight + kcal) rather than in a separate NodeVelo form. Raw 1–4
  // ordinals as Intervals returns them — same order as its UI, where for ALL of these a HIGHER number is
  // the WORSE state: soreness 1=low…4=extreme, fatigue 1=low…4=extreme, stress 1=low…4=extreme,
  // mood 1=great…4=grumpy, motivation 1=highly motivated…4=unmotivated, injury 1=none…4=injured.
  // null when the athlete hasn't logged that field. (Direction is interpreted by consumers, not here.)
  soreness: number | null;
  fatigue: number | null;
  stress: number | null;
  mood: number | null;
  motivation: number | null;
  injury: number | null;
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
  lengthWeeks: 2 | 4;
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
  workoutText?: string; // Intervals.icu step syntax — the coach's prescription
  prescription?: PrescribedInterval[]; // structured work intervals parsed from workoutText
  // The Intervals.icu event id this day was written as. Stored so the block's planned-workout events
  // can be removed from the calendar when the block is discarded or replaced (RV-9). Absent on blocks
  // written before id-tracking, or when a day's write returned no id.
  eventId?: number | null;
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
  // Optional manual override for the morning-check subjective-strain bands (ROADMAP #2). Absent =
  // population defaults; set to personalise where reported strain downgrades a quality day.
  strainBands?: { high: number; med: number };
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
  recoveryWeekHoursMax: 7,
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
  ftpUsed: number; // FTP this entry was scored against — frozen so history never re-shifts
  durationMin: number; // feeds the behaviour/volume signal
  tss: number | null;
  // The per-athlete calibration this entry was scored against (ROADMAP #2) — frozen alongside ftpUsed
  // so the immutable ledger stays reproducible. Absent on entries scored before calibration shipped
  // (those used population defaults). `decouplingGood` is the global drift cutoff; `ifBandOffset` is
  // the per-type IF-band shift that scored THIS entry (planned rides only — off-plan rides skip the
  // intensity-vs-type branch). Each field is independently optional — only what actually applied is stamped.
  calibration?: { decouplingGood?: number; ifBandOffset?: number };
  // Athlete-state CONTEXT frozen at scoring time (ROADMAP #2 — context-stamp the ledger): the state the
  // athlete carried into this session, so a later state→subsequent-execution correlation can derive the
  // override-only edges honestly (e.g. auto-derive the TSB adaptation window). Both are provenance only —
  // they never feed the entry's own executionScore.
  // `formState`: objective load (intervals.icu's own per-day CTL/ATL, authoritative). `morningCheck`: the
  // day's subjective self-report. Each absent on pre-feature entries or when no data covers the date.
  formState?: RideFormState;
  morningCheck?: RideMorningContext;
  // Fueling CONTEXT frozen at scoring time (ROADMAP Track C): the carbohydrate intake the athlete logged
  // for this ride, normalised to g/h, so a later carbs→execution/decoupling correlation can derive their
  // optimal intake. Provenance only — never feeds executionScore. Stamped only when a real (>0) intake was
  // logged in intervals.icu (carbs_ingested); absent otherwise (most rides, until the athlete fills it in).
  fuel?: { carbsGPerH: number };
}

// Form (fitness/fatigue/balance) as of a ride's date — the slow-moving load state from the synced
// wellness stream. TSB = CTL − ATL (the app's convention). Stamped on each ledger entry as context.
export interface RideFormState {
  tsb: number;
  ctl: number;
  atl: number;
}

// The subjective morning self-report on a ride's date (1–5; fatigue/soreness higher = worse, sleep
// higher = better). The first-person signal not captured by objective load. Stamped as context.
export interface RideMorningContext {
  fatigue: number;
  sleep: number;
  soreness: number;
}

// Everything stamped onto a ledger entry as athlete-state context for a given date (ROADMAP #2). Resolved
// per-date and frozen onto the entry; any field absent when no data covers that date.
export interface RideEntryContext {
  formState?: RideFormState;
  morningCheck?: RideMorningContext;
}

// ---------- Athlete model (the learning "second brain") ----------

// Recency-weighted (EWMA) performance per workout type, derived from the score log.
export interface AthleteTypeStat {
  type: WorkoutType;
  n: number;
  execEwma: number; // EWMA of execution score (1-10)
  complianceEwma: number; // EWMA of duration compliance %
  trend: "up" | "down" | "flat";
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
  avgCadence90d: number | null;
  avgTss90d: number | null;
  avgWeeklyHours90d: number | null; // rolling 90-day mean weekly ride hours (window-consistent with the others)
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
// parameters are brought under the framework (Phase 1 ships `decouplingGood`).
export interface CalibrationStore {
  decouplingGood: CalibratedParameter;
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
  executionScore: number | null; // 1-10 deterministic quality score
  coachNote: string; // Claude 2-3 sentence narrative
  intervalComparison: IntervalComparison | null; // prescription vs execution
  trace: RideTrace | null; // downsampled streams + interval bands for the power chart
  powerPRs?: PowerPR[]; // new power bests set during this ride (vs the prior 84-day curve)
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
  // Stable external id. When present, createEvent posts with upsertOnUid=true so a re-written block
  // updates the same event instead of creating a duplicate (idempotent writes). Block days set
  // `nodevelo-<date>`; ad-hoc events (notes) omit it and keep create semantics.
  uid?: string;
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
export type CompromiseReason = "equipment" | "sickness" | "weather" | "other";

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

// ---------- Morning check-in (data/morning-check.json) ----------
// The proactive counterpart to dispositions: a pre-session subjective read (the fatigue/sleep/
// soreness signals the deliberately-absent HRV feed would give) that drives a deterministic
// proceed-vs-downgrade decision. Editable per day, like dispositions (not an immutable ledger).

export type IllnessLevel = "none" | "mild" | "sick";
// "proceed-easy" = train today but cap intensity (mild illness, neck-check rule) — between an
// unchanged proceed and a full downgrade that moves/defers the stimulus.
export type MorningCheckDecision = "proceed" | "proceed-easy" | "downgrade";

export interface MorningCheckEntry {
  date: string; // YYYY-MM-DD
  // All 1–5; higher = more of that thing (fatigue/soreness 5 = bad, sleep/motivation 5 = good).
  fatigue: number;
  sleep: number;
  soreness: number;
  motivation: number;
  illness: IllnessLevel;
  strain: number; // derived: fatigue + soreness + (6−sleep) + (6−motivation)
  decision: MorningCheckDecision;
  setAt: string;
}

export interface MorningCheckLog {
  entries: MorningCheckEntry[];
  updatedAt: string;
}
