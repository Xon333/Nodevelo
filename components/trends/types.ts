// Shape of the /api/trends payload, shared by the Trends page and its extracted section components.
// Lifted out of the old 508-line Trends.tsx (RV-8).
import type { Insight, RollingBaselines, WorkoutType } from "@/lib/types";
import type { SparkPoint } from "../Sparkline";

export type Point = SparkPoint;

export interface TrendBlock {
  goal: string;
  startDate: string;
  endDate: string;
  lengthWeeks: number;
  complianceByType: Partial<Record<WorkoutType, number>> | null;
  ctlGain: number | null;
  actualHours: number | null;
  plannedHours: number | null;
  nextBlockSeeds: string[] | null;
}

export interface ScoreEntry {
  date: string;
  executionScore: number;
  plannedType: WorkoutType | null;
  inferredType: WorkoutType;
  planned: boolean;
}

export interface EnergyRow {
  date: string;
  burnKcal: number | null;
  intakeKcal: number | null;
  weightKg: number | null;
}

export interface RecentSnapshot {
  latestWeightKg: number | null;
  weightTrend7Day: number | null;
  load7Day: number | null;
  lastKcalConsumed: number | null;
  wkgAtThreshold: number | null; // current FTP ÷ latest weight — the cyclist's headline fitness number
}

export interface ValidationData {
  byDimension: Array<{ dimension: string; validated: number; refuted: number; inconclusive: number; hitRate: number | null }>;
  evaluated: number;
  pending: number;
}

export interface InterventionRow {
  dimension: string;
  title: string;
  firedAt: string;
  verdict: "validated" | "refuted" | "inconclusive";
  execDelta: number | null;
  physDelta: number | null;
  physMetric: string;
}

export interface TrendsData {
  ef: Point[];
  ctl: Point[];
  energy: EnergyRow[];
  blocks: TrendBlock[];
  baselines: RollingBaselines;
  scores: ScoreEntry[];
  insights: Insight[];
  recent: RecentSnapshot | null;
  validation: ValidationData | null;
  recentInterventions: InterventionRow[];
  weeklyHours: Array<{ date: string; hours: number }>;
  zones: number[];
  behaviour: { avgWeeklyHours: number | null; offPlanPct: number } | null;
  syncedAt: string | null;
}
