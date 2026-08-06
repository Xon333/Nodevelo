// CR-F: enforce the "the AI never invents nutrition numbers" guarantee. Generation hands the model a
// deterministic reference table and instructs it to COPY the values into each day's description — but
// nothing checked that it actually did. The plan protocol + schedule are validated post-generation;
// the kcal/carb prose was trusted on the model's word alone.
//
// This recomputes the ground-truth daily intake, pre-ride carbs, and in-ride carbs/hr for each day's
// exact type+duration with the SAME pure formulas the reference table is built from, parses the figures
// the model wrote, and flags a material deviation. It's a warning (consistent with
// validatePlanProtocol/validateSchedule), not a hard fail, and the tolerance is deliberately generous so
// rounding or picking the closest-duration table row never false-flags — only an invented number trips it.

import {
  calculateDailyTarget,
  estimateWorkoutBurnKcal,
  inRideCarbTarget,
  preRideCarbTarget,
  type ModelOrResolver,
  type NutritionModel,
} from "./nutrition";
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

// Pull the "Pre-ride: 75g" figure (see the generator prompt's DESCRIPTION FORMAT, lib/anthropic-prompts.ts).
// Same tolerance philosophy as parseDailyIntakeKcal: tolerant of a colon, a leading "~", commas, the
// reference table's own "Pre-ride carbs" column header wording, and any trailing unit ("g", "grams") —
// only the label and the number matter. Null when absent (e.g. a Rest/Strength day has no pre-ride line
// at all) so a missing line is simply not checked, never flagged.
export function parsePreRideCarbsG(description: string): number | null {
  const m = description.match(/pre-ride(?:\s+carbs?)?[^\d]*([\d,]{1,6})/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Pull the "In-ride: 75g/hr" figure. Only present at all for rides > 60 min (see DESCRIPTION FORMAT's
// own bracket note) — a day with no In-ride line is correct, not an error, when inRideCarbTarget itself
// says 0 (short ride, Rest, or Strength). Same tolerance philosophy as the other two parsers.
export function parseInRideCarbsGPerHour(description: string): number | null {
  const m = description.match(/in-ride(?:\s+carbs?)?[^\d]*([\d,]{1,6})/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Carb figures are an order of magnitude smaller than kcal, so the kcal check's own band
// (toleranceBand(expected, 0.18, 300)) would either be far too tight (the 300 kcal floor dwarfs a ~75g
// figure) or, scaled down naively, too loose. preRideCarbTarget rounds to the nearest 5g (see `roundTo`
// in lib/nutrition.ts) — the floor here covers double that rounding step. NOT sized to bridge a full
// step-bucket jump: both carb formulas have a hard/duration threshold at 90 min, and the generator
// prompt's own "pick the row matching the session's type and closest duration" instruction means a day
// whose exact duration sits just past that boundary but whose closest table row sits just before it can
// legitimately land one bucket off. That is a known edge of the reference table's discretization, not
// something this check is asked to paper over (mirrors the KB-vs-formula edge noted for hard sub-90min
// sessions) — a mismatch that large is unusual enough to be worth flagging, not silently swallowed.
const CARB_TOLERANCE_FLOOR_G = 10;
const CARB_TOLERANCE_PCT = 0.15;
function carbTolerance(expected: number): number {
  return toleranceBand(expected, CARB_TOLERANCE_PCT, CARB_TOLERANCE_FLOOR_G);
}

// Shared by validateNutrition and repairNutrition (P3a, 2026-07-24 block-generation redesign) — ONE
// computation of "what should this day's figure say, and does the stated figure disagree" so the check
// and the fix can never quietly drift apart. Null when the description has no parseable line for that
// figure. Reused for daily intake (kcal), pre-ride carbs (g), and in-ride carbs (g/hr) alike.
interface DailyIntakeCheck {
  stated: number;
  expected: number;
  withinTolerance: boolean;
}

// A day-type-aware caller (day-type NEAT calibration) passes a resolver so a rest day is checked
// against `k_rest` and a training day against `k_train` — the reference table already resolves a model
// per row (`buildNutritionReferenceRows`), and this must match it exactly or a correctly-copied rest-day
// figure gets "corrected" against the wrong multiplier. A bare `NutritionModel` (every existing caller)
// still works unchanged: it's normalized into a resolver that ignores the day type.
function resolveModelFor(modelOrResolver: ModelOrResolver, isRestDay: boolean): NutritionModel {
  return typeof modelOrResolver === "function" ? modelOrResolver(isRestDay) : modelOrResolver;
}

function checkDailyIntake(
  d: PlannedDay,
  modelOrResolver: ModelOrResolver,
  ftp: number,
  bufferApplied: number
): DailyIntakeCheck | null {
  const stated = parseDailyIntakeKcal(d.description);
  if (stated === null) return null;
  const model = resolveModelFor(modelOrResolver, d.type === "Rest");
  const expected = calculateDailyTarget(
    estimateWorkoutBurnKcal(d.type, d.durationMin, ftp),
    model,
    bufferApplied,
    d.type === "Rest",
    { type: d.type, durationMin: d.durationMin }
  ).dailyTarget;
  // Generous band: rounding + the model copying the closest-duration row must never trip this.
  const tolerance = toleranceBand(expected, 0.18, 300);
  return { stated, expected, withinTolerance: Math.abs(stated - expected) <= tolerance };
}

// Mirrors checkDailyIntake, for the "Pre-ride: Xg" line. Needs model.weightKg (present on both
// NutritionModel branches), so it threads the same ModelOrResolver a day-type-aware caller passes for
// the kcal check — a correctly-copied rest-day figure must never get "corrected" against the training
// model's weight (weightKg is athlete bodyweight either way, but keeping the same resolver plumbing here
// means the two checks can never independently diverge on which model is in force for a given day).
function checkPreRideCarbs(d: PlannedDay, modelOrResolver: ModelOrResolver): DailyIntakeCheck | null {
  const stated = parsePreRideCarbsG(d.description);
  if (stated === null) return null;
  const model = resolveModelFor(modelOrResolver, d.type === "Rest");
  const expected = preRideCarbTarget(d.durationMin, d.type, model.weightKg);
  const tolerance = carbTolerance(expected);
  return { stated, expected, withinTolerance: Math.abs(stated - expected) <= tolerance };
}

// Mirrors checkDailyIntake, for the "In-ride: Xg/hr" line. inRideCarbTarget takes no weight input, so
// unlike the pre-ride check this needs no model at all.
function checkInRideCarbs(d: PlannedDay): DailyIntakeCheck | null {
  const stated = parseInRideCarbsGPerHour(d.description);
  if (stated === null) return null;
  const expected = inRideCarbTarget(d.durationMin, d.type);
  const tolerance = carbTolerance(expected);
  return { stated, expected, withinTolerance: Math.abs(stated - expected) <= tolerance };
}

export function validateNutrition(
  days: PlannedDay[],
  modelOrResolver: ModelOrResolver,
  ftp: number,
  bufferApplied: number
): string[] {
  const warnings: string[] = [];
  for (const d of days) {
    const check = checkDailyIntake(d, modelOrResolver, ftp, bufferApplied);
    if (check && !check.withinTolerance) {
      const tolerance = toleranceBand(check.expected, 0.18, 300);
      warnings.push(
        `${d.date} (${d.type}): stated daily intake ${check.stated} kcal differs from the computed ${check.expected} kcal (tolerance ±${Math.round(tolerance)}) — verify it was copied from the reference table, not invented.`
      );
    }
    const preRide = checkPreRideCarbs(d, modelOrResolver);
    if (preRide && !preRide.withinTolerance) {
      const tolerance = carbTolerance(preRide.expected);
      warnings.push(
        `${d.date} (${d.type}): stated pre-ride carbs ${preRide.stated}g differs from the computed ${preRide.expected}g (tolerance ±${Math.round(tolerance)}) — verify it was copied from the reference table, not invented.`
      );
    }
    const inRide = checkInRideCarbs(d);
    if (inRide && !inRide.withinTolerance) {
      const tolerance = carbTolerance(inRide.expected);
      warnings.push(
        `${d.date} (${d.type}): stated in-ride carbs ${inRide.stated}g/hr differs from the computed ${inRide.expected}g/hr (tolerance ±${Math.round(tolerance)}) — verify it was copied from the reference table, not invented.`
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

// Replace just the numeric figure in a "Pre-ride: Xg" (or "Pre-ride carbs: X") line, keeping the
// surrounding text verbatim.
function replacePreRideCarbsG(description: string, newValue: number): string {
  return description.replace(/(pre-ride(?:\s+carbs?)?[^\d]*)([\d,]{1,6})/i, (_m, prefix: string) => `${prefix}${Math.round(newValue)}`);
}

// Replace just the numeric figure in an "In-ride: Xg/hr" (or "In-ride carbs: X") line, keeping the
// surrounding text verbatim.
function replaceInRideCarbsGPerHour(description: string, newValue: number): string {
  return description.replace(/(in-ride(?:\s+carbs?)?[^\d]*)([\d,]{1,6})/i, (_m, prefix: string) => `${prefix}${Math.round(newValue)}`);
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
//
// Extended to pre-ride/in-ride carbs on the same terms: each of the three figures is checked and
// repaired independently and sequentially against the SAME description string, so a day that got both
// its kcal and its carbs invented has all of it corrected in one pass rather than only the first match
// winning.
export function repairNutrition(
  days: PlannedDay[],
  modelOrResolver: ModelOrResolver,
  ftp: number,
  bufferApplied: number
): NutritionRepairResult {
  const repairs: string[] = [];
  const repairedDays = days.map((d) => {
    let description = d.description;
    let changed = false;

    const kcalCheck = checkDailyIntake(d, modelOrResolver, ftp, bufferApplied);
    if (kcalCheck && !kcalCheck.withinTolerance) {
      repairs.push(`${d.date} (${d.type}): auto-corrected daily intake ${kcalCheck.stated} kcal → ${kcalCheck.expected} kcal (didn't match the reference table).`);
      description = replaceDailyIntakeKcal(description, kcalCheck.expected);
      changed = true;
    }

    const preRideCheck = checkPreRideCarbs(d, modelOrResolver);
    if (preRideCheck && !preRideCheck.withinTolerance) {
      repairs.push(`${d.date} (${d.type}): auto-corrected pre-ride carbs ${preRideCheck.stated}g → ${preRideCheck.expected}g (didn't match the reference table).`);
      description = replacePreRideCarbsG(description, preRideCheck.expected);
      changed = true;
    }

    const inRideCheck = checkInRideCarbs(d);
    if (inRideCheck && !inRideCheck.withinTolerance) {
      repairs.push(`${d.date} (${d.type}): auto-corrected in-ride carbs ${inRideCheck.stated}g/hr → ${inRideCheck.expected}g/hr (didn't match the reference table).`);
      description = replaceInRideCarbsGPerHour(description, inRideCheck.expected);
      changed = true;
    }

    return changed ? { ...d, description } : d;
  });
  return { days: repairedDays, repairs };
}
