// CR-F: enforce the "the AI never invents nutrition numbers" guarantee. Generation hands the model a
// deterministic reference table and instructs it to COPY the values into each day's description — but
// nothing checked that it actually did. The plan protocol + schedule are validated post-generation;
// the kcal/carb prose was trusted on the model's word alone.
//
// This recomputes the ground-truth daily intake for each day's exact type+duration with the SAME pure
// formula the reference table is built from, parses the figure the model wrote, and flags a material
// deviation. It's a warning (consistent with validatePlanProtocol/validateSchedule), not a hard fail,
// and the tolerance is deliberately generous so rounding or picking the closest-duration table row
// never false-flags — only an invented number trips it.

import { calculateDailyTarget, estimateWorkoutBurnKcal, type AthleteNutritionConfig } from "./nutrition";
import { toleranceBand } from "./stats";
import type { PlannedDay } from "./types";

// Pull the "Daily intake: 2600 kcal" figure (the value the generator is told to copy). Tolerant of
// formatting: "Daily intake: ~2,600 kcal", "Daily target 2600", trailing units. Null when absent
// (e.g. a terse rest-day description) so a missing line is simply not checked, never flagged.
export function parseDailyIntakeKcal(description: string): number | null {
  const m = description.match(/daily\s+(?:intake|target)[^\d]*([\d,]{2,6})/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Shared by validateNutrition and repairNutrition (P3a, 2026-07-24 block-generation redesign) — ONE
// computation of "what should this day's kcal say, and does the stated figure disagree" so the check
// and the fix can never quietly drift apart. Null when the description has no parseable kcal line.
interface DailyIntakeCheck {
  stated: number;
  expected: number;
  withinTolerance: boolean;
}

function checkDailyIntake(
  d: PlannedDay,
  config: AthleteNutritionConfig,
  ftp: number,
  weightTrend7Day: number
): DailyIntakeCheck | null {
  const stated = parseDailyIntakeKcal(d.description);
  if (stated === null) return null;
  const expected = calculateDailyTarget(
    estimateWorkoutBurnKcal(d.type, d.durationMin, ftp),
    d.type === "Rest",
    config,
    weightTrend7Day,
    { type: d.type, durationMin: d.durationMin }
  ).dailyTarget;
  // Generous band: rounding + the model copying the closest-duration row must never trip this.
  const tolerance = toleranceBand(expected, 0.18, 300);
  return { stated, expected, withinTolerance: Math.abs(stated - expected) <= tolerance };
}

export function validateNutrition(
  days: PlannedDay[],
  config: AthleteNutritionConfig,
  ftp: number,
  weightTrend7Day: number
): string[] {
  const warnings: string[] = [];
  for (const d of days) {
    const check = checkDailyIntake(d, config, ftp, weightTrend7Day);
    if (check && !check.withinTolerance) {
      const tolerance = toleranceBand(check.expected, 0.18, 300);
      warnings.push(
        `${d.date} (${d.type}): stated daily intake ${check.stated} kcal differs from the computed ${check.expected} kcal (tolerance ±${Math.round(tolerance)}) — verify it was copied from the reference table, not invented.`
      );
    }
  }
  return warnings;
}

// Replace just the numeric figure in a "Daily intake: X kcal" (or "Daily target X") line, keeping the
// surrounding text verbatim.
function replaceDailyIntakeKcal(description: string, newValue: number): string {
  return description.replace(/(daily\s+(?:intake|target)[^\d]*)([\d,]{2,6})/i, (_m, prefix: string) => `${prefix}${Math.round(newValue)}`);
}

export interface NutritionRepairResult {
  days: PlannedDay[];
  repairs: string[];
}

// P3a (2026-07-24 block-generation redesign): the reference table's whole guarantee is that the
// model never invents a kcal figure — but nothing enforced that beyond warning. The correct number is
// always known (the same deterministic formula the reference table itself is built from), so a
// mismatch has no ambiguity to preserve: auto-correct it, and say so (calibrated honesty — the fix
// stays visible as a `repairs` note, never a silent rewrite).
export function repairNutrition(
  days: PlannedDay[],
  config: AthleteNutritionConfig,
  ftp: number,
  weightTrend7Day: number
): NutritionRepairResult {
  const repairs: string[] = [];
  const repairedDays = days.map((d) => {
    const check = checkDailyIntake(d, config, ftp, weightTrend7Day);
    if (!check || check.withinTolerance) return d;
    repairs.push(`${d.date} (${d.type}): auto-corrected daily intake ${check.stated} kcal → ${check.expected} kcal (didn't match the reference table).`);
    return { ...d, description: replaceDailyIntakeKcal(d.description, check.expected) };
  });
  return { days: repairedDays, repairs };
}
