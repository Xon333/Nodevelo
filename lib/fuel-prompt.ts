// Deterministic post-ride fuel prompt logic: nudge to log carbs on qualifying rides,
// and surface gaps between logged intake and the derived carb optimum once it's trustworthy.
// Pure TypeScript — no LLM, no I/O, no side effects. Deterministic thresholds; LLM phrasing
// is a separate (later) concern.

import { round1 } from './stats';
import type { ActivitySummary, WorkoutType } from './types';

// Decision rules: thresholds as named constants (not magic numbers)

/** Long-ride duration threshold: 90 minutes in seconds */
const LONG_RIDE_DURATION_SEC = 90 * 60;

/** Interval workout types that qualify regardless of duration */
const INTERVAL_TYPES: WorkoutType[] = ['Threshold', 'VO2max', 'SIT', 'RaceSim'];

/** Under-fueling gap threshold: g/h */
const GAP_UNDER_G_PER_H = 20;


export type FuelPrompt =
  | { kind: 'log-nudge'; reason: 'long-ride' | 'interval-day'; durationMin: number }
  | { kind: 'gap'; loggedGPerH: number; optimumGPerH: number; deltaGPerH: number };

/**
 * Derive a post-ride fuel prompt based on ride duration, planned type, logged carbs, and
 * the derived carb optimum.
 *
 * Decision rules:
 * 1. Ride qualifies iff movingTimeSec ≥ 90 min OR plannedType ∈ {Threshold, VO2max, SIT, RaceSim}.
 *    Not qualifying → null.
 * 2. Qualifying + carbsIngestedG == null → log-nudge (reason picks whichever qualified it;
 *    long-ride wins ties). A logged 0 is a real data point (fasted — FUEL-1), not a nudge case.
 * 3. Qualifying + logged + carbsOptimum at confidence ≥ medium + loggedGPerH < optimum − 20
 *    → gap (under-fueling only in v1 — over-fueling has no validated harm signal).
 * 4. Everything else → null.
 */
export function deriveFuelPrompt(input: {
  activity: ActivitySummary;
  plannedType: WorkoutType | null;
  carbsOptimum: { value: number; confidence: 'low' | 'medium' | 'high' } | null;
}): FuelPrompt | null {
  const { activity, plannedType, carbsOptimum } = input;

  // Rule: Does the ride qualify?
  const durationQualifies = activity.movingTimeSec >= LONG_RIDE_DURATION_SEC;
  const typeQualifies = plannedType != null && INTERVAL_TYPES.includes(plannedType);

  if (!durationQualifies && !typeQualifies) {
    return null; // Not qualifying
  }

  // Rule: If carbsIngestedG is null, return log-nudge
  if (activity.carbsIngestedG == null) {
    // Long-ride wins the tie if both qualify
    const reason = durationQualifies ? 'long-ride' : 'interval-day';
    const durationMin = Math.round(activity.movingTimeSec / 60);
    return {
      kind: 'log-nudge',
      reason,
      durationMin,
    };
  }

  // Rule: Logged 0 (fasted) is a real data point (FUEL-1), not a nudge case
  if (activity.carbsIngestedG === 0) {
    return null;
  }

  // Rule: Qualifying + logged carbs, check for gap if carbsOptimum is present
  if (carbsOptimum == null) {
    return null; // No optimum to compare against
  }

  // Rule: Ignore low confidence — need medium or high
  if (carbsOptimum.confidence === 'low') {
    return null;
  }

  // Compute loggedGPerH using the same formula as fuelStampFor
  const loggedGPerH = round1(activity.carbsIngestedG / (activity.movingTimeSec / 3600));
  const optimumGPerH = carbsOptimum.value;

  // Rule: Under-fueling only in v1 (loggedGPerH < optimum - 20)
  // Delta = logged - optimum (negative when under-fueled)
  const deltaGPerH = loggedGPerH - optimumGPerH;

  // Strict inequality: < optimum - 20 (not <=)
  if (loggedGPerH < optimumGPerH - GAP_UNDER_G_PER_H) {
    return {
      kind: 'gap',
      loggedGPerH,
      optimumGPerH,
      deltaGPerH: round1(deltaGPerH),
    };
  }

  // Everything else (logged sufficient, or over-fueled)
  return null;
}
