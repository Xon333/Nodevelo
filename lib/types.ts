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
  avgHr: number | null;
  kj: number | null; // total work in kJ
  trainingLoad: number | null;
  rpe: number | null; // icu_rpe, 1-10
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
