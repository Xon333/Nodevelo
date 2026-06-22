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

export function validateNutrition(
  days: PlannedDay[],
  config: AthleteNutritionConfig,
  ftp: number,
  weightTrend7Day: number
): string[] {
  const warnings: string[] = [];
  for (const d of days) {
    const stated = parseDailyIntakeKcal(d.description);
    if (stated === null) continue;
    const expected = calculateDailyTarget(
      estimateWorkoutBurnKcal(d.type, d.durationMin, ftp),
      d.type === "Rest",
      config,
      weightTrend7Day,
      { type: d.type, durationMin: d.durationMin }
    ).dailyTarget;
    // Generous band: rounding + the model copying the closest-duration row must never trip this.
    const tolerance = Math.max(300, expected * 0.18);
    if (Math.abs(stated - expected) > tolerance) {
      warnings.push(
        `${d.date} (${d.type}): stated daily intake ${stated} kcal differs from the computed ${expected} kcal (tolerance ±${Math.round(tolerance)}) — verify it was copied from the reference table, not invented.`
      );
    }
  }
  return warnings;
}
