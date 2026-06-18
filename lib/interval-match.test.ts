import { describe, expect, it } from "vitest";
import { matchPrescription } from "./interval-match";
import type { ExecutedInterval, PrescribedInterval } from "./types";

const presc = (reps: number, targetWatts: number): PrescribedInterval => ({
  reps,
  durationSec: 1200,
  targetPctFtp: 100,
  targetWatts,
  label: `${reps}×20m @ ${targetWatts}W`,
});
const ex = (type: string, np: number, durationSec = 1200): ExecutedInterval => ({
  type,
  durationSec,
  avgWatts: np - 3,
  npWatts: np,
  avgHr: 165,
  startIndex: null,
  endIndex: null,
});

describe("matchPrescription", () => {
  it("matches WORK efforts rep-by-rep and rolls up adherence", () => {
    const c = matchPrescription([presc(2, 288)], [ex("WORK", 287), ex("WORK", 291)]);
    expect(c).not.toBeNull();
    expect(c!.completed).toBe(2);
    expect(c!.total).toBe(2);
    expect(c!.reps.map((r) => r.adherencePct)).toEqual([99, 100]);
    expect(c!.avgAdherencePct).toBe(100);
  });

  it("ignores warmup/recovery when intervals are untyped (power-band fallback)", () => {
    const executed = [ex("", 150), ex("", 286), ex("", 120), ex("", 290)];
    const c = matchPrescription([presc(2, 288)], executed);
    expect(c!.reps.map((r) => r.actualWatts)).toEqual([283, 287]);
  });

  it("reports partial completion when fewer efforts executed", () => {
    const c = matchPrescription([presc(3, 300)], [ex("WORK", 298)]);
    expect(c!.completed).toBe(1);
    expect(c!.total).toBe(3);
  });

  it("accounts for duration: reps nailed on watts but cut short aren't 'completed'", () => {
    // 2×20m @ 274W, but rep 1 held only 14:00 and rep 2 only 10:00.
    const c = matchPrescription([presc(2, 274)], [ex("WORK", 275, 840), ex("WORK", 258, 600)]);
    expect(c!.reps.map((r) => r.durationPct)).toEqual([70, 50]);
    expect(c!.avgAdherencePct).toBe(96); // power adherence alone still looks strong…
    expect(c!.completed).toBe(0); // …but neither rep held ≥90% of the prescribed duration
    expect(c!.avgDurationPct).toBe(60);
    expect(c!.effectiveAdherencePct).toBeLessThan(c!.avgAdherencePct); // duration drags execution down
  });

  it("returns null with no prescription", () => {
    expect(matchPrescription([], [ex("WORK", 290)])).toBeNull();
  });

  describe("structuralMismatch (plan-vs-detection, DI-1)", () => {
    const sit = (reps: number): PrescribedInterval => ({
      reps,
      durationSec: 60, // plan stored as 1-min reps…
      targetPctFtp: 150,
      targetWatts: 432,
      label: `${reps}×1m @ 432W`,
    });

    it("flags a plan stored as 1-min reps but ridden as 30s at full power", () => {
      // 5×30s all-out (power nailed), every rep ~50% of the plan's 1-min definition.
      const executed = Array.from({ length: 5 }, () => ex("WORK", 435, 30));
      const c = matchPrescription([sit(5)], executed)!;
      expect(c.reps.every((r) => r.durationPct < 55)).toBe(true);
      expect(c.structuralMismatch).toBe(true);
    });

    it("does NOT flag a genuine bail — short reps with weak power", () => {
      const executed = Array.from({ length: 5 }, () => ex("WORK", 300, 30)); // 30s but only ~69% power
      const c = matchPrescription([sit(5)], executed)!;
      expect(c.structuralMismatch).toBe(false);
    });

    it("does NOT flag an on-spec session (full duration, full power)", () => {
      const c = matchPrescription([presc(3, 288)], [ex("WORK", 288), ex("WORK", 290), ex("WORK", 287)])!;
      expect(c.structuralMismatch).toBe(false);
    });

    it("does NOT flag a partial-completion session (rep count short)", () => {
      const c = matchPrescription([sit(5)], [ex("WORK", 435, 30)])!; // only 1 of 5 reps
      expect(c.structuralMismatch).toBe(false);
    });

    it("does NOT flag a mixed/fading session (not all reps halved)", () => {
      // durations 54s, 30s, 30s, 30s, 30s — first rep is ~90%, so not a uniform mismatch.
      const executed = [ex("WORK", 435, 54), ex("WORK", 435, 30), ex("WORK", 435, 30), ex("WORK", 435, 30), ex("WORK", 435, 30)];
      const c = matchPrescription([sit(5)], executed)!;
      expect(c.reps[0].durationPct).toBeGreaterThanOrEqual(55);
      expect(c.structuralMismatch).toBe(false);
    });
  });
});
