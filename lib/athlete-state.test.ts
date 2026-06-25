import { describe, expect, it } from "vitest";
import { athleteStateInputsFrom, computeAthleteState, type AthleteStateInputs } from "./athlete-state";
import { DEFAULT_ATHLETE_STATE_WEIGHTS, resolveAthleteStateWeights } from "./calibration";
import type { ActivitySummary, AthleteModel, SyncData } from "./types";

// Neutral baseline: no news → a mid "steady" read. Tests tweak one axis at a time.
const base: AthleteStateInputs = {
  tsb: 0,
  acwrLevel: "optimal",
  execEwma: 6,
  execTrend: "flat",
  execSampleSize: 10,
  decouplingLatest: 5,
  decouplingBaseline: 5,
  rpeRecent: 5,
  rpeBaseline: 5,
  offPlanPct: 10,
};

describe("computeAthleteState — directional logic (not exact numbers)", () => {
  it("neutral inputs land in the mid 'steady' range", () => {
    const s = computeAthleteState(base)!;
    expect(s.band).toBe("steady");
    expect(s.score).toBeGreaterThanOrEqual(45);
    expect(s.score).toBeLessThan(80);
  });

  it("all-good inputs → high band", () => {
    const s = computeAthleteState({
      ...base,
      tsb: 20,
      execEwma: 9,
      execTrend: "up",
      decouplingLatest: 2,
      decouplingBaseline: 6,
      rpeRecent: 4,
      rpeBaseline: 6,
    })!;
    expect(["primed", "ready"]).toContain(s.band);
    expect(s.recommendation === "push" || s.recommendation === "proceed").toBe(true);
  });

  it("corroborated fatigue caps a fresh-TSB athlete down (the lived-signal override)", () => {
    // TSB very fresh (+30) + optimal ACWR would read 'steady'/high, but execution-down +
    // decoupling-up + rpe-up (3 lived negatives) must pull it to ≤ strained.
    const fatigued = computeAthleteState({
      ...base,
      tsb: 30,
      execEwma: 6,
      execTrend: "down",
      decouplingLatest: 8,
      decouplingBaseline: 5,
      rpeRecent: 6,
      rpeBaseline: 5,
    })!;
    expect(["strained", "depleted"]).toContain(fatigued.band);
    expect(["soften", "recover"]).toContain(fatigued.recommendation);
  });

  it("a single bad lived signal does NOT flip a fresh athlete (override needs ≥2)", () => {
    const s = computeAthleteState({
      ...base,
      tsb: 25,
      execEwma: 8,
      execTrend: "up",
      decouplingLatest: 12, // only this one is bad
      decouplingBaseline: 5,
      rpeRecent: 5,
      rpeBaseline: 5,
    })!;
    expect(["primed", "ready", "steady"]).toContain(s.band);
    expect(s.recommendation).not.toBe("recover");
  });

  it("decoupling rising vs baseline registers as a 'up' (worse) driver", () => {
    const s = computeAthleteState({ ...base, decouplingLatest: 11, decouplingBaseline: 5 })!;
    const dec = s.drivers.find((d) => d.key === "decoupling")!;
    expect(dec.dir).toBe("up");
    expect(dec.effect).toBeLessThan(0);
  });

  it("drivers are sorted by |effect| desc and name the contributing signals", () => {
    const s = computeAthleteState({
      ...base,
      tsb: 30,
      execTrend: "down",
      execEwma: 3,
      decouplingLatest: 12,
      decouplingBaseline: 5,
      rpeRecent: 8,
      rpeBaseline: 5,
    })!;
    const mags = s.drivers.map((d) => Math.abs(d.effect));
    expect([...mags]).toEqual([...mags].sort((a, b) => b - a));
    expect(s.drivers.map((d) => d.key)).toEqual(expect.arrayContaining(["tsb", "acwr", "execution", "decoupling", "rpe"]));
  });
});

describe("computeAthleteState — confidence + availability", () => {
  it("few signals + thin sample → low confidence, still returns a value", () => {
    const s = computeAthleteState({
      ...base,
      acwrLevel: null,
      execEwma: null,
      execTrend: null,
      execSampleSize: 0,
      decouplingLatest: null,
      decouplingBaseline: null,
      rpeRecent: null,
      rpeBaseline: null,
      offPlanPct: null,
    })!;
    expect(s).not.toBeNull();
    expect(s.confidence).toBe("low");
  });

  it("returns null when no signal is available at all", () => {
    expect(
      computeAthleteState({
        tsb: null,
        acwrLevel: null,
        execEwma: null,
        execTrend: null,
        execSampleSize: 0,
        decouplingLatest: null,
        decouplingBaseline: null,
        rpeRecent: null,
        rpeBaseline: null,
        offPlanPct: null,
      })
    ).toBeNull();
  });
});

describe("computeAthleteState — fusion-weight overrides (ROADMAP §5 / #2 fold-in)", () => {
  it("omitting the weights arg scores identically to the explicit population default", () => {
    expect(computeAthleteState(base)).toEqual(computeAthleteState(base, DEFAULT_ATHLETE_STATE_WEIGHTS));
    expect(computeAthleteState(base)).toEqual(computeAthleteState(base, resolveAthleteStateWeights()));
  });

  it("a lower BASE weight shifts the whole score down", () => {
    const def = computeAthleteState(base)!;
    const lowered = computeAthleteState(base, resolveAthleteStateWeights({ BASE: 40 }))!;
    expect(lowered.score).toBe(def.score - 20);
  });

  it("a stronger TSB scale amplifies the form contribution", () => {
    const fresh = { ...base, tsb: 20 };
    const def = computeAthleteState(fresh)!;
    const amplified = computeAthleteState(fresh, resolveAthleteStateWeights({ tsb: { scale: 1.0 } }))!;
    const tsbOf = (s: typeof def) => s.drivers.find((d) => d.key === "tsb")!.effect;
    expect(tsbOf(amplified)).toBeGreaterThan(tsbOf(def));
  });
});

describe("athleteStateInputsFrom — Z2-gated decoupling", () => {
  const iso = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const act = (over: Partial<ActivitySummary> & { date: string }): ActivitySummary => ({
    id: over.date, type: "Ride", name: "r", movingTimeSec: 4000, avgWatts: 165, normalizedPower: 165,
    maxWatts: 300, icuFtp: null, avgHr: 140, maxHr: 160, kj: 500, trainingLoad: 50, rpe: null,
    carbsIngestedG: null, decoupling: 4, efficiencyFactor: null, description: null, avgCadence: null,
    distanceMeters: null, elevationGain: null, powerZoneTimes: null, hrZoneTimes: null, ...over,
  });
  const model = { sampleSize: 0, overallExecEwma: 0, overallTrend: "flat", behaviour: { offPlanPct: 0 } } as unknown as AthleteModel;
  const sync = (activities: ActivitySummary[]): SyncData =>
    ({ syncedAt: "", activities, wellness: [], powerCurve: [], powerCurveAllTime: [], fitness: { ctl: null, atl: null, tsb: null } });

  it("ignores an interval ride's decoupling, using the latest qualifying Z2 ride + a Z2 baseline", () => {
    const activities = [
      act({ date: iso(0), normalizedPower: 240, avgWatts: 235, decoupling: 8 }), // interval (0.96 FTP) → excluded
      act({ date: iso(1), normalizedPower: 165, decoupling: 4 }), // Z2 → latest qualifying
      act({ date: iso(4), normalizedPower: 160, decoupling: 5 }), // Z2
      act({ date: iso(8), normalizedPower: 168, decoupling: 3 }), // Z2
    ];
    const inputs = athleteStateInputsFrom(sync(activities), model, null, 250);
    expect(inputs.decouplingLatest).toBe(4); // the recent Z2 ride, NOT the interval ride's 8
    expect(inputs.decouplingBaseline).toBe(4); // mean(4, 5, 3) over qualifying rides
  });

  it("sits the signal out (null) when there's no qualifying steady ride", () => {
    const inputs = athleteStateInputsFrom(
      sync([act({ date: iso(0), normalizedPower: 240, avgWatts: 235, decoupling: 8 })]), // only an interval ride
      model,
      null,
      250
    );
    expect(inputs.decouplingLatest).toBeNull();
    expect(inputs.decouplingBaseline).toBeNull();
  });
});
