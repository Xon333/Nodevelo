import { describe, expect, it } from "vitest";
import { computeAthleteState, type AthleteStateInputs } from "./athlete-state";

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
