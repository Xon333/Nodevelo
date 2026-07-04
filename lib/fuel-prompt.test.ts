import { describe, it, expect } from 'vitest';
import { deriveFuelPrompt } from './fuel-prompt';
import type { ActivitySummary } from './types';

describe('deriveFuelPrompt', () => {
  // Helper to build an ActivitySummary with minimal required fields
  const makeActivity = (overrides: Partial<ActivitySummary> = {}): ActivitySummary => ({
    id: 'ride-1',
    date: '2026-07-04',
    type: 'Ride',
    name: 'Test Ride',
    movingTimeSec: 3600, // 1 hour default
    avgWatts: 200,
    normalizedPower: null,
    maxWatts: null,
    icuFtp: null,
    avgHr: null,
    maxHr: null,
    kj: null,
    trainingLoad: null,
    rpe: null,
    carbsIngestedG: null, // unlogged by default
    decoupling: null,
    efficiencyFactor: null,
    powerHrZ2: null,
    powerHrZ2Mins: null,
    description: null,
    avgCadence: null,
    distanceMeters: null,
    elevationGain: null,
    powerZoneTimes: null,
    hrZoneTimes: null,
    ...overrides,
  });

  describe('Qualification rules', () => {
    it('does not qualify: short ride, off-plan', () => {
      const activity = makeActivity({
        movingTimeSec: 30 * 60, // 30 minutes
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: null,
      });

      expect(result).toBeNull();
    });

    it('does not qualify: at boundary 89 min, off-plan', () => {
      const activity = makeActivity({
        movingTimeSec: 89 * 60, // 89 minutes
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: null,
      });

      expect(result).toBeNull();
    });

    it('qualifies via duration: exactly 90 minutes', () => {
      const activity = makeActivity({
        movingTimeSec: 90 * 60, // 90 minutes
        carbsIngestedG: null,
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: null,
      });

      expect(result).toEqual({
        kind: 'log-nudge',
        reason: 'long-ride',
        durationMin: 90,
      });
    });

    it('qualifies via duration: 120 minutes', () => {
      const activity = makeActivity({
        movingTimeSec: 120 * 60, // 120 minutes
        carbsIngestedG: null,
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: null,
      });

      expect(result).toEqual({
        kind: 'log-nudge',
        reason: 'long-ride',
        durationMin: 120,
      });
    });

    it('qualifies via plannedType: Threshold, short duration', () => {
      const activity = makeActivity({
        movingTimeSec: 45 * 60, // 45 minutes
        carbsIngestedG: null,
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: 'Threshold',
        carbsOptimum: null,
      });

      expect(result).toEqual({
        kind: 'log-nudge',
        reason: 'interval-day',
        durationMin: 45,
      });
    });

    it('qualifies via plannedType: VO2max, short duration', () => {
      const activity = makeActivity({
        movingTimeSec: 60 * 60, // 60 minutes
        carbsIngestedG: null,
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: 'VO2max',
        carbsOptimum: null,
      });

      expect(result).toEqual({
        kind: 'log-nudge',
        reason: 'interval-day',
        durationMin: 60,
      });
    });

    it('qualifies via plannedType: SIT, short duration', () => {
      const activity = makeActivity({
        movingTimeSec: 30 * 60, // 30 minutes
        carbsIngestedG: null,
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: 'SIT',
        carbsOptimum: null,
      });

      expect(result).toEqual({
        kind: 'log-nudge',
        reason: 'interval-day',
        durationMin: 30,
      });
    });

    it('qualifies via plannedType: RaceSim, short duration', () => {
      const activity = makeActivity({
        movingTimeSec: 75 * 60, // 75 minutes
        carbsIngestedG: null,
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: 'RaceSim',
        carbsOptimum: null,
      });

      expect(result).toEqual({
        kind: 'log-nudge',
        reason: 'interval-day',
        durationMin: 75,
      });
    });

    it('does not qualify: non-interval plannedType, short duration', () => {
      const activity = makeActivity({
        movingTimeSec: 45 * 60, // 45 minutes
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: 'Z2',
        carbsOptimum: null,
      });

      expect(result).toBeNull();
    });

    it('does not qualify: Recovery type, short duration', () => {
      const activity = makeActivity({
        movingTimeSec: 45 * 60, // 45 minutes
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: 'Recovery',
        carbsOptimum: null,
      });

      expect(result).toBeNull();
    });
  });

  describe('Log-nudge rules', () => {
    it('returns log-nudge when qualifying and carbsIngestedG is null', () => {
      const activity = makeActivity({
        movingTimeSec: 90 * 60, // 90 minutes
        carbsIngestedG: null,
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: null,
      });

      expect(result).toEqual({
        kind: 'log-nudge',
        reason: 'long-ride',
        durationMin: 90,
      });
    });

    it('does NOT return nudge when carbsIngestedG is 0 (fasted, real data)', () => {
      const activity = makeActivity({
        movingTimeSec: 90 * 60, // 90 minutes, qualifies
        carbsIngestedG: 0, // logged as fasted - FUEL-1 distinction
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: null,
      });

      expect(result).toBeNull();
    });

    it('reason is long-ride when both duration and type could qualify (long-ride wins tie)', () => {
      const activity = makeActivity({
        movingTimeSec: 120 * 60, // 120 minutes, qualifies via duration
        carbsIngestedG: null,
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: 'Threshold', // also qualifies via type
        carbsOptimum: null,
      });

      expect(result).toEqual({
        kind: 'log-nudge',
        reason: 'long-ride', // long-ride wins the tie
        durationMin: 120,
      });
    });

    it('off-plan long ride qualifies via duration (does not require plannedType)', () => {
      const activity = makeActivity({
        movingTimeSec: 90 * 60, // 90 minutes
        carbsIngestedG: null,
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null, // explicitly off-plan
        carbsOptimum: null,
      });

      expect(result).toEqual({
        kind: 'log-nudge',
        reason: 'long-ride',
        durationMin: 90,
      });
    });
  });

  describe('Garbage carbsIngestedG (negative/non-finite) — mirrors fuelStampFor\'s "not a real reading"', () => {
    // A corrupt/negative carbs_ingested from Intervals.icu is exactly as informative as no reading at
    // all — fuelStampFor (lib/score-log.ts) already treats it that way for the ledger stamp. Without an
    // equivalent guard here, deriveFuelPrompt would compute a nonsense negative g/h and could produce a
    // "gap" claim from garbage, while the ledger for the SAME ride correctly has no fuel stamp.

    it('treats a negative carbsIngestedG as unlogged (same log-nudge as the null case)', () => {
      const activity = makeActivity({
        movingTimeSec: 90 * 60, // qualifies via duration
        carbsIngestedG: -5, // corrupt/negative reading
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: { value: 70, confidence: 'high' }, // present, to prove we never reach the gap branch
      });

      // Must match the null-case result exactly (same shape as the "qualifies via duration" null test above).
      expect(result).toEqual({
        kind: 'log-nudge',
        reason: 'long-ride',
        durationMin: 90,
      });
    });

    it('treats a NaN carbsIngestedG as unlogged (same log-nudge as the null case)', () => {
      const activity = makeActivity({
        movingTimeSec: 45 * 60, // doesn't qualify via duration
        carbsIngestedG: Number.NaN,
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: 'Threshold', // qualifies via interval type
        carbsOptimum: { value: 70, confidence: 'high' },
      });

      expect(result).toEqual({
        kind: 'log-nudge',
        reason: 'interval-day',
        durationMin: 45,
      });
    });

    it('never produces a gap with a nonsense negative loggedGPerH', () => {
      const activity = makeActivity({
        movingTimeSec: 180 * 60, // 3 hours, qualifies
        carbsIngestedG: -30,
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: { value: 70, confidence: 'medium' },
      });

      expect(result?.kind).not.toBe('gap');
      expect(result).toEqual({
        kind: 'log-nudge',
        reason: 'long-ride',
        durationMin: 180,
      });
    });
  });

  describe('Gap detection rules', () => {
    it('returns null when qualifying + logged but carbsOptimum is null', () => {
      const activity = makeActivity({
        movingTimeSec: 90 * 60, // qualifies via duration
        carbsIngestedG: 50, // logged
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: null, // no optimum to compare against
      });

      expect(result).toBeNull();
    });

    it('returns null when carbsOptimum confidence is "low"', () => {
      const activity = makeActivity({
        movingTimeSec: 90 * 60, // qualifies
        carbsIngestedG: 50, // logged
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: { value: 80, confidence: 'low' },
      });

      expect(result).toBeNull();
    });

    it('returns gap when carbsOptimum confidence is "medium" and logged < optimum - 20', () => {
      const activity = makeActivity({
        movingTimeSec: 180 * 60, // 3 hours
        carbsIngestedG: 100, // 100g / 3h = 33.33 g/h
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: { value: 70, confidence: 'medium' }, // 70 is optimum g/h
      });

      expect(result).toEqual({
        kind: 'gap',
        loggedGPerH: expect.any(Number),
        optimumGPerH: 70,
        deltaGPerH: expect.any(Number),
      });

      if (result?.kind === 'gap') {
        // 100g / 3h = 33.33 g/h, rounded to 33.3
        expect(result.loggedGPerH).toBeCloseTo(33.3, 1);
        // delta = 33.3 - 70 = -36.7
        expect(result.deltaGPerH).toBeCloseTo(-36.7, 1);
      }
    });

    it('returns gap when carbsOptimum confidence is "high" and logged < optimum - 20', () => {
      const activity = makeActivity({
        movingTimeSec: 180 * 60, // 3 hours
        carbsIngestedG: 100, // 33.3 g/h
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: { value: 70, confidence: 'high' },
      });

      expect(result).toEqual({
        kind: 'gap',
        loggedGPerH: expect.any(Number),
        optimumGPerH: 70,
        deltaGPerH: expect.any(Number),
      });
    });

    it('returns null when delta is exactly -20 (boundary: < optimum - 20 is strict, not <=)', () => {
      const activity = makeActivity({
        movingTimeSec: 60 * 60, // 1 hour
        carbsIngestedG: 50, // 50 g/h
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: { value: 70, confidence: 'medium' }, // 70 - 50 = 20 delta
      });

      expect(result).toBeNull();
    });

    it('returns null when logged > optimum (over-fueling has no harm signal in v1)', () => {
      const activity = makeActivity({
        movingTimeSec: 120 * 60, // 2 hours
        carbsIngestedG: 150, // 75 g/h
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: { value: 60, confidence: 'medium' }, // over-fueled: 75 > 60
      });

      expect(result).toBeNull();
    });

    it('returns gap for meaningful under-fueling (delta < -20)', () => {
      const activity = makeActivity({
        movingTimeSec: 120 * 60, // 2 hours
        carbsIngestedG: 80, // 40 g/h
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: { value: 70, confidence: 'medium' },
      });

      // 80g / 2h = 40 g/h
      // delta = 40 - 70 = -30 (well under -20 threshold)
      expect(result).toEqual({
        kind: 'gap',
        loggedGPerH: 40,
        optimumGPerH: 70,
        deltaGPerH: -30,
      });
    });

    it('calculates loggedGPerH using round1 (matching fuelStampFor)', () => {
      // Test case chosen to verify rounding: 100g / 3.5h = 28.571... → rounds to 28.6
      const activity = makeActivity({
        movingTimeSec: 3.5 * 3600, // 3.5 hours
        carbsIngestedG: 100,
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: { value: 65, confidence: 'medium' },
      });

      if (result?.kind === 'gap') {
        // 100 / 3.5 = 28.571... rounded to 1 decimal = 28.6
        expect(result.loggedGPerH).toBe(28.6);
        expect(result.deltaGPerH).toBeCloseTo(28.6 - 65, 1);
      }
    });
  });

  describe('Integration: complex scenarios', () => {
    it('interval type + long ride + medium confidence + under-fueled → gap', () => {
      const activity = makeActivity({
        movingTimeSec: 150 * 60, // 150 minutes, qualifies both ways
        carbsIngestedG: 90, // 36 g/h
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: 'VO2max',
        carbsOptimum: { value: 70, confidence: 'medium' },
      });

      // Under-fueled: 36 < 70 - 20 = 50
      expect(result).toEqual({
        kind: 'gap',
        loggedGPerH: 36,
        optimumGPerH: 70,
        deltaGPerH: -34,
      });
    });

    it('short interval ride, unlogged carbs → interval-day nudge', () => {
      const activity = makeActivity({
        movingTimeSec: 45 * 60, // doesn't qualify via duration
        carbsIngestedG: null,
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: 'Threshold',
        carbsOptimum: { value: 70, confidence: 'high' },
      });

      expect(result).toEqual({
        kind: 'log-nudge',
        reason: 'interval-day',
        durationMin: 45,
      });
    });

    it('short easy ride off-plan → no nudge, no gap', () => {
      const activity = makeActivity({
        movingTimeSec: 45 * 60,
        carbsIngestedG: 30, // even though logged
      });

      const result = deriveFuelPrompt({
        activity,
        plannedType: null,
        carbsOptimum: { value: 70, confidence: 'high' },
      });

      expect(result).toBeNull();
    });
  });
});
