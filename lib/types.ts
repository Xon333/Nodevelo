// Shared types used across server modules and client components.

export type WorkoutType =
  | "Z2"
  | "Threshold"
  | "VO2max"
  | "SIT"
  | "Recovery"
  | "Strength"
  | "Rest";

export const WORKOUT_TYPES: WorkoutType[] = [
  "Z2",
  "Threshold",
  "VO2max",
  "SIT",
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
  avgHr: number | null;
  maxHr: number | null;
  kj: number | null; // total work in kJ
  trainingLoad: number | null;
  rpe: number | null; // icu_rpe, 1-10
  decoupling: number | null; // aerobic decoupling %
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
}

export interface PowerCurvePoint {
  durationSec: number;
  watts: number;
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
  powerCurve: PowerCurvePoint[];
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
}

// ---------- Active block (data/current-block.json) ----------

export interface CurrentBlockDay {
  date: string;
  name: string;
  type: WorkoutType;
  durationMin: number;
}

export interface CurrentBlock {
  goal: string;
  lengthWeeks: number;
  startDate: string;
  endDate: string;
  overview: string;
  createdAt: string;
  days: CurrentBlockDay[];
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
  updatedAt: new Date(0).toISOString(),
};

// ---------- Block history (data/block-history.json) ----------

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

// ---------- Compliance memory (data/compliance-memory.json) ----------

export interface ComplianceEntry {
  sessions: number;
  avgCompliancePct: number;
  recentCompliancePct: number | null; // last 28 days
  highComplianceWorkouts: Array<{ date: string; name: string; workoutText: string }>;
}

export interface ComplianceMemory {
  byType: Partial<Record<WorkoutType, ComplianceEntry>>;
  updatedAt: string;
}

// ---------- Per-ride execution score log (data/score-log.json) ----------
// Accumulates over time so the trends view can chart execution quality across
// blocks, even after a block is cleared from current-block.json.

export interface RideScoreEntry {
  date: string;
  executionScore: number;
  plannedType: WorkoutType;
  compliancePct: number | null;
  intensityFactor: number | null;
}

export interface ScoreLog {
  entries: RideScoreEntry[];
  updatedAt: string;
}

// ---------- Rolling baselines (data/rolling-baselines.json) ----------

export interface RollingBaselines {
  avgCtl90d: number | null;
  avgDecoupling90d: number | null;
  avgCadence90d: number | null;
  avgTss90d: number | null;
  updatedAt: string;
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
  plannedName: string | null;
  plannedType: string | null;
  plannedDurationMin: number | null;
  // Computed metrics
  compliancePct: number | null; // actual / planned duration %
  intensityFactor: number | null; // avg watts / FTP
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
}

// ---------- Write-back ----------

export interface IntervalsEventPayload {
  category: "WORKOUT" | "NOTE";
  start_date_local: string; // YYYY-MM-DDT00:00:00
  name: string;
  description: string;
  type?: string; // Ride, WeightTraining — omitted for NOTE events
  moving_time?: number; // seconds
}

export interface WriteResult {
  date: string;
  name: string;
  ok: boolean;
  eventId: number | null;
  error?: string;
}
