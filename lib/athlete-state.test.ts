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
  aerobicEffLatest: 1.5,
  aerobicEffBaseline: 1.5,
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
      aerobicEffLatest: 1.7,
      aerobicEffBaseline: 1.5,
    })!;
    expect(["primed", "ready"]).toContain(s.band);
    expect(s.recommendation === "push" || s.recommendation === "proceed").toBe(true);
  });

  it("corroborated fatigue caps a fresh-TSB athlete down (the lived-signal override)", () => {
    // TSB very fresh (+30) + optimal ACWR would read 'steady'/high, but execution-down +
    // aerobic-efficiency-down (2 lived negatives, the override threshold) must pull it to ≤ strained.
    const fatigued = computeAthleteState({
      ...base,
      tsb: 30,
      execEwma: 6,
      execTrend: "down",
      aerobicEffLatest: 1.3,
      aerobicEffBaseline: 1.5,
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
      aerobicEffLatest: 1.3, // only this one is bad (below baseline)
      aerobicEffBaseline: 1.5,
    })!;
    expect(["primed", "ready", "steady"]).toContain(s.band);
    expect(s.recommendation).not.toBe("recover");
  });

  it("aerobic efficiency below baseline registers as a 'down' (worse) driver", () => {
    const s = computeAthleteState({ ...base, aerobicEffLatest: 1.3, aerobicEffBaseline: 1.5 })!;
    const ae = s.drivers.find((d) => d.key === "aerobicEff")!;
    expect(ae.dir).toBe("down");
    expect(ae.effect).toBeLessThan(0);
  });

  it("drivers are sorted by |effect| desc and name the contributing signals", () => {
    const s = computeAthleteState({
      ...base,
      tsb: 30,
      execTrend: "down",
      execEwma: 3,
      aerobicEffLatest: 1.3,
      aerobicEffBaseline: 1.5,
    })!;
    const mags = s.drivers.map((d) => Math.abs(d.effect));
    expect([...mags]).toEqual([...mags].sort((a, b) => b - a));
    expect(s.drivers.map((d) => d.key)).toEqual(expect.arrayContaining(["tsb", "acwr", "execution", "aerobicEff"]));
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
      aerobicEffLatest: null,
      aerobicEffBaseline: null,
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
        aerobicEffLatest: null,
        aerobicEffBaseline: null,
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

describe("athleteStateInputsFrom — Z2 Pw:HR aerobic signal", () => {
  const iso = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const act = (over: Partial<ActivitySummary> & { date: string }): ActivitySummary => ({
    id: over.date, type: "Ride", name: "r", movingTimeSec: 4000, avgWatts: 165, normalizedPower: 165,
    maxWatts: 300, icuFtp: null, avgHr: 140, maxHr: 160, kj: 500, activeBurnKcal: null, trainingLoad: 50, rpe: null,
    carbsIngestedG: null, decoupling: 4, efficiencyFactor: null, powerHrZ2: 1.5, powerHrZ2Mins: 60,
    description: null, avgCadence: null, distanceMeters: null, elevationGain: null,
    powerZoneTimes: null, hrZoneTimes: null, hrrc: null,
    wPrimeRollingJ: null, wBalDepletionJ: null, ...over,
  });
  const model = { sampleSize: 0, overallExecEwma: 0, overallTrend: "flat", behaviour: { offPlanPct: 0 } } as unknown as AthleteModel;
  const sync = (activities: ActivitySummary[]): SyncData =>
    ({ syncedAt: "", activities, wellness: [], powerCurve: [], powerCurveAllTime: [], fitness: { ctl: null, atl: null, tsb: null } });

  it("sits the baseline out when every qualifying ride is recent (can't self-compare — RV2-4)", () => {
    const activities = [
      act({ date: iso(1), powerHrZ2: 1.55, powerHrZ2Mins: 60 }),
      act({ date: iso(4), powerHrZ2: 1.5, powerHrZ2Mins: 50 }),
      act({ date: iso(8), powerHrZ2: 1.6, powerHrZ2Mins: 70 }),
    ];
    const inputs = athleteStateInputsFrom(sync(activities), model, null);
    expect(inputs.aerobicEffLatest).toBe(1.55); // latest still reads
    expect(inputs.aerobicEffBaseline).toBeNull(); // nothing outside the recency window to baseline against
  });

  it("sits the signal out (null) when no ride clears the Z2-minutes floor", () => {
    const inputs = athleteStateInputsFrom(
      sync([act({ date: iso(0), powerHrZ2: 1.31, powerHrZ2Mins: 8 })]), // only a thin-Z2 interval day
      model,
      null
    );
    expect(inputs.aerobicEffLatest).toBeNull();
    expect(inputs.aerobicEffBaseline).toBeNull();
  });

  // Pre-existing test (RV2-4) recomputed for the min-sample floor (Task 2): a lone recent ride no longer
  // reports as "the" aerobicEffLatest, so the fixture now carries two recent qualifying rides — the
  // baseline-exclusion property under test is otherwise unchanged.
  it("uses the smoothed recent rides, and excludes the recency window from its own baseline (RV2-4)", () => {
    const activities = [
      act({ date: iso(0), powerHrZ2: 1.31, powerHrZ2Mins: 8 }), // interval day, only 8 Z2 min → excluded
      act({ date: iso(1), powerHrZ2: 1.55, powerHrZ2Mins: 60 }), // recent → qualifying
      act({ date: iso(3), powerHrZ2: 1.65, powerHrZ2Mins: 55 }), // recent → qualifying, 2nd recent ride
      act({ date: iso(20), powerHrZ2: 1.4, powerHrZ2Mins: 50 }), // older than the 14d recency window → baseline
      act({ date: iso(30), powerHrZ2: 1.4, powerHrZ2Mins: 70 }),
      act({ date: iso(45), powerHrZ2: 1.4, powerHrZ2Mins: 70 }),
    ];
    const inputs = athleteStateInputsFrom(sync(activities), model, null);
    expect(inputs.aerobicEffLatest).toBe(1.6); // mean(1.55, 1.65) — the two recent qualifying rides
    expect(inputs.aerobicEffBaseline).toBe(1.4); // mean of the OLDER rides only — the recent window isn't averaged in
  });

  describe("aerobic efficiency: smoothing + minimum-sample floor", () => {
    it("smooths aerobic efficiency over the last few rides, not one noisy latest", () => {
      // Two normal rides then one outlier-low latest (a hot/caffeinated day), all inside the recency window.
      const activities = [
        act({ date: iso(1), powerHrZ2: 2.0, powerHrZ2Mins: 60 }),
        act({ date: iso(3), powerHrZ2: 2.0, powerHrZ2Mins: 60 }),
        act({ date: iso(8), powerHrZ2: 1.2, powerHrZ2Mins: 60 }), // outlier
      ];
      const inputs = athleteStateInputsFrom(sync(activities), model, null);
      // Smoothed latest = mean(2.0, 2.0, 1.2) ≈ 1.73, NOT the raw 1.2 — one hot day can't cap the state alone.
      expect(inputs.aerobicEffLatest).toBeGreaterThan(1.5);
    });

    it("does NOT trust a single ride even disguised as 'smoothed' — needs ≥2 in the window", () => {
      const activities = [
        act({ date: iso(1), powerHrZ2: 1.2, powerHrZ2Mins: 60 }), // only one qualifying ride in the window
      ];
      const inputs = athleteStateInputsFrom(sync(activities), model, null);
      expect(inputs.aerobicEffLatest).toBeNull(); // sits out entirely rather than reporting a lone ride
    });
  });

  it("excludes a high-VI ride from the aerobic-efficiency baseline (2026-08-06 tightening)", () => {
    // Dates sit in the BASELINE window (>14d recency, <90d window), not the recency window — same
    // shape as the RV2-4 test above (iso(20)/iso(30)/iso(45)) — so this actually exercises baseVals,
    // not recentQual.
    const s = sync([
      act({ date: iso(20), powerHrZ2: 1.55, powerHrZ2Mins: 60 }), // steady, VI 1.0 (default)
      act({ date: iso(25), powerHrZ2: 1.5, powerHrZ2Mins: 50 }),
      act({ date: iso(30), powerHrZ2: 1.6, powerHrZ2Mins: 70 }),
      // A high-VI ride with an outlier Z2 reading — must NOT enter the baseline despite clearing the
      // Z2-minutes floor and the outdoor-only gate.
      act({ date: iso(28), powerHrZ2: 9.9, powerHrZ2Mins: 60, avgWatts: 200, normalizedPower: 241 }),
    ]);
    const inputs = athleteStateInputsFrom(s, model, null, iso(0));
    expect(inputs.aerobicEffBaseline).not.toBeNull();
    expect(inputs.aerobicEffBaseline!).toBeLessThan(2); // would be skewed far above 2 if the outlier leaked in
  });
});

describe("aerobic efficiency: a modest dip nudges but doesn't alone corroborate fatigue", () => {
  const dipBase: AthleteStateInputs = {
    tsb: 20, acwrLevel: "optimal", execEwma: 4.5, execTrend: "down", execSampleSize: 10,
    aerobicEffLatest: 2.0, aerobicEffBaseline: 2.0, offPlanPct: 0,
  };

  it("a modest ~5% dip (past deadband, short of livedAt) nudges the score but does not cap it", () => {
    // relPct = (1.9-2.0)/2.0*100 = -5%. deadband=3 (past it → real effect), livedAt=6 (short → not "lived").
    const result = computeAthleteState({ ...dipBase, aerobicEffLatest: 1.9 })!;
    expect(result.drivers.find((d) => d.key === "aerobicEff")?.livedNegative).not.toBe(true);
    expect(result.score).toBeGreaterThan(40); // only 1 confirmed lived negative (execution) — no cap
  });

  it("a severe ~10% dip (past livedAt) DOES corroborate — now 2 lived negatives cap the score", () => {
    // relPct = (1.8-2.0)/2.0*100 = -10%, past livedAt=6 → counts as a lived negative.
    const result = computeAthleteState({ ...dipBase, aerobicEffLatest: 1.8 })!;
    expect(result.drivers.find((d) => d.key === "aerobicEff")?.livedNegative).toBe(true);
    expect(result.score).toBeLessThanOrEqual(40); // override.scoreCap — execution + aerobicEff both lived
  });
});
