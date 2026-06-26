import { describe, expect, it } from "vitest";
import { deriveExecutionEdge, type ExecutionEdgeSpec } from "./correlation";
import type { RideScoreEntry, WorkoutType } from "./types";

// Minimal entry whose stamped signal lives in formState.tsb (the deep-fatigue case) by default.
function entry(signal: number, executionScore: number, over: Partial<RideScoreEntry> = {}): RideScoreEntry {
  return {
    date: "2026-01-01",
    executionScore,
    plannedType: "VO2max",
    inferredType: "VO2max",
    planned: true,
    legacy: false,
    compliancePct: 100,
    intensityFactor: 1.0,
    ftpUsed: 250,
    durationMin: 60,
    tss: 80,
    formState: { tsb: signal, ctl: 50, atl: 50 - signal },
    ...over,
  };
}

// A "lower = failure" spec (deep-fatigue shape): failures sit at low signal values.
const lowerSpec: ExecutionEdgeSpec = {
  types: new Set<WorkoutType>(["VO2max", "Threshold"]),
  signal: (e) => e.formState?.tsb ?? null,
  underBar: 4,
  goodBar: 6,
  failureSide: "lower",
  discriminationMargin: 4,
  clampTo: [-45, -12],
  confidence: (nUnder, nGood) => (nUnder < 5 || nGood < 3 ? "low" : nUnder < 10 ? "medium" : "high"),
};

describe("deriveExecutionEdge — guards", () => {
  it("returns a default-source blank with no entries", () => {
    const p = deriveExecutionEdge([], lowerSpec);
    expect(p.source).toBe("default");
    expect(Number.isNaN(p.value)).toBe(true);
    expect(p.dataPoints).toBe(0);
  });

  it("returns blank when there are failures but no successes to contrast against", () => {
    const entries = [entry(-30, 2), entry(-28, 3), entry(-35, 1)]; // all under, no good
    const p = deriveExecutionEdge(entries, lowerSpec);
    expect(p.source).toBe("default");
    expect(p.dataPoints).toBe(3); // honest about how many failures were seen
  });

  it("returns blank when the signal does not discriminate (failures not separated from successes)", () => {
    // unders at ~ -5, goods at ~ -4 → under-median is NOT < good-median - margin(4)
    const entries = [entry(-5, 2), entry(-6, 3), entry(-4, 8), entry(-3, 9)];
    const p = deriveExecutionEdge(entries, lowerSpec);
    expect(p.source).toBe("default");
  });
});

describe("deriveExecutionEdge — derivation", () => {
  it("derives the failures' median signal when fatigue discriminates (lower side)", () => {
    // failures deep (~ -30), successes fresh (~ +5) → discriminates; edge = median(under) = -30.
    const entries = [
      entry(-32, 2), entry(-30, 3), entry(-28, 4),
      entry(5, 8), entry(8, 9), entry(2, 7),
    ];
    const p = deriveExecutionEdge(entries, lowerSpec);
    expect(p.source).toBe("derived");
    expect(p.value).toBe(-30);
    expect(p.dataPoints).toBe(3);
  });

  it("clamps the derived edge to the spec range", () => {
    // failures absurdly deep (-80) → clamped to the -45 floor.
    const entries = [entry(-80, 1), entry(-82, 2), entry(-78, 3), entry(10, 8), entry(12, 9), entry(8, 7)];
    const p = deriveExecutionEdge(entries, lowerSpec);
    expect(p.value).toBe(-45);
  });

  it("handles the 'higher = failure' side (e.g. a high-value stamped signal)", () => {
    const higherSpec: ExecutionEdgeSpec = {
      ...lowerSpec,
      failureSide: "higher",
      clampTo: [4, 20],
      signal: (e) => e.tss ?? null, // any stamped numeric signal exercises the generic engine
    };
    // failures at high signal (~16), successes at low signal (~6) → edge = median(under) = 16.
    const hi = (s: number, score: number) => entry(0, score, { tss: s });
    const entries = [hi(16, 2), hi(17, 3), hi(15, 4), hi(6, 8), hi(5, 9), hi(7, 7)];
    const p = deriveExecutionEdge(entries, higherSpec);
    expect(p.source).toBe("derived");
    expect(p.value).toBe(16);
  });
});

describe("deriveExecutionEdge — population filter", () => {
  const goods = [entry(5, 8), entry(8, 9), entry(2, 7)]; // contrast successes shared across cases

  it("excludes off-plan, legacy, compromised, wrong-type, and missing-signal entries", () => {
    const tainted: RideScoreEntry[] = [
      entry(-30, 2, { planned: false }), // off-plan
      entry(-31, 2, { legacy: true }), // legacy
      entry(-32, 2, { compromised: true }), // compromised
      entry(-33, 2, { plannedType: "Z2", inferredType: "Z2" }), // out-of-scope type
      entry(0, 2, { formState: undefined }), // no signal
    ];
    // None of the tainted failures should count → no failures → blank.
    const p = deriveExecutionEdge([...tainted, ...goods], lowerSpec);
    expect(p.source).toBe("default");
    expect(p.dataPoints).toBe(0);
  });

  it("counts only the in-scope failures", () => {
    const entries = [entry(-30, 2), entry(-30, 2, { planned: false }), ...goods];
    const p = deriveExecutionEdge(entries, lowerSpec);
    expect(p.dataPoints).toBe(1); // the off-plan one was dropped
  });
});
