import { describe, expect, it } from "vitest";
import { buildAthleteModel, deriveInsights } from "./athlete-model";
import type { RideScoreEntry, WorkoutType } from "./types";
import type { AerobicDiscipline } from "./execution-score";

let day = 0;
const entry = (type: WorkoutType, executionScore: number, compliancePct: number | null = 100): RideScoreEntry => ({
  date: `2026-01-${String(++day).padStart(2, "0")}`,
  executionScore,
  plannedType: type,
  inferredType: type,
  planned: true,
  legacy: false,
  compliancePct,
  intensityFactor: null,
  ftpUsed: 288,
  durationMin: 60,
  tss: null,
});

// A Z2/Recovery entry carrying the Task 2 `easy` ledger stamp, with real tss/durationMin so the
// TSS-premium figure is computable — mirrors what buildRideScores actually writes.
const easyEntry = (
  type: WorkoutType,
  executionScore: number,
  easy: { indoor: boolean; hrRead?: AerobicDiscipline },
  opts: { tss?: number | null; durationMin?: number } = {}
): RideScoreEntry => ({
  ...entry(type, executionScore),
  easy,
  tss: opts.tss ?? null,
  durationMin: opts.durationMin ?? 60,
});

describe("buildAthleteModel", () => {
  it("aggregates per type and overall with recency weighting", () => {
    day = 0;
    const scores = [entry("VO2max", 4), entry("VO2max", 5), entry("VO2max", 4), entry("Z2", 9), entry("Z2", 9)];
    const m = buildAthleteModel(scores);
    const vo2 = m.byType.find((t) => t.type === "VO2max")!;
    const z2 = m.byType.find((t) => t.type === "Z2")!;
    expect(vo2.n).toBe(3);
    expect(vo2.execEwma).toBeLessThan(z2.execEwma);
    expect(m.sampleSize).toBe(5);
  });

  it("windows recent behaviour to ~8 weeks but keeps the full ledger in behaviourAllTime", () => {
    // Old off-plan block (>8 weeks before the latest ride) + a recent on-plan block.
    const old = (date: string): RideScoreEntry => ({ ...entry("Z2", 6), date, planned: false, plannedType: null });
    const recent = (date: string): RideScoreEntry => ({ ...entry("Z2", 8), date, planned: true });
    const scores = [
      old("2026-01-05"), old("2026-01-08"), old("2026-01-12"),
      recent("2026-05-01"), recent("2026-05-08"), recent("2026-05-15"),
    ];
    const m = buildAthleteModel(scores);
    // Recent window (anchored to 2026-05-15) excludes January → 0% off-plan now…
    expect(m.behaviour.offPlanPct).toBe(0);
    expect(m.behaviour.totalRides).toBe(3);
    // …but the 6-month view still sees the old off-plan riding.
    expect(m.behaviourAllTime.offPlanPct).toBe(50);
    expect(m.behaviourAllTime.totalRides).toBe(6);
  });

  it("does not read a mid-window dip as 'down' when the most recent sessions have recovered", () => {
    // Real athlete data: two hot rides (the 3s at positions 11-12) sit mid-window, but the
    // two most recent sessions recovered to 10 and 8 — there is no ONGOING decline.
    day = 0;
    const scores = [8, 10, 3, 9, 10, 9, 6, 6, 9, 10, 3, 3, 10, 8].map((s) => entry("Z2", s));
    const m = buildAthleteModel(scores);
    expect(m.byType.find((t) => t.type === "Z2")!.trend).toBe("flat");
    expect(m.overallTrend).toBe("flat");
    const insights = deriveInsights(m);
    expect(insights.find((i) => i.title === "Z2 trending down")).toBeUndefined();
    expect(insights.find((i) => i.title === "Execution trending down")).toBeUndefined();
  });

  it("still classifies a genuine ongoing decline (no recovery at the tail) as 'down'", () => {
    day = 0;
    const scores = [8, 7, 6, 5, 4, 3].map((s) => entry("Z2", s));
    const m = buildAthleteModel(scores);
    expect(m.byType.find((t) => t.type === "Z2")!.trend).toBe("down");
    expect(m.overallTrend).toBe("down");
  });

  it("does not read a faded improvement as 'up' when the most recent sessions fell back", () => {
    day = 0;
    const scores = [5, 5, 5, 5, 9, 9, 5, 5].map((s) => entry("Z2", s));
    const m = buildAthleteModel(scores);
    expect(m.byType.find((t) => t.type === "Z2")!.trend).toBe("flat");
  });

  it("excludes legacy (pre-first-block) rides from behaviour", () => {
    const legacyRide = (date: string): RideScoreEntry => ({ ...entry("Z2", 6), date, planned: false, plannedType: null, legacy: true });
    const live = (date: string): RideScoreEntry => ({ ...entry("Z2", 8), date, planned: true });
    const m = buildAthleteModel([
      legacyRide("2026-02-01"), legacyRide("2026-02-03"), // stored, but not counted
      live("2026-02-10"), live("2026-02-12"),
    ]);
    expect(m.behaviourAllTime.totalRides).toBe(2); // only the non-legacy rides
    expect(m.behaviourAllTime.offPlanPct).toBe(0);
  });
});

describe("deriveInsights", () => {
  it("flags a weak interval type as an alert", () => {
    day = 0;
    const scores = [entry("VO2max", 4), entry("VO2max", 5), entry("VO2max", 4), entry("VO2max", 5)];
    const insights = deriveInsights(buildAthleteModel(scores));
    const vo2 = insights.find((i) => i.dimension === "VO2max")!;
    expect(vo2.severity).toBe("alert");
  });

  it("flags consistent under-delivery as a watch", () => {
    day = 0;
    const scores = [entry("Threshold", 7, 70), entry("Threshold", 7, 65), entry("Threshold", 7, 72)];
    const insights = deriveInsights(buildAthleteModel(scores));
    const t = insights.find((i) => i.dimension === "Threshold")!;
    expect(t.severity).toBe("watch");
  });

  it("celebrates a strong, stable type and stays silent below the observation floor", () => {
    day = 0;
    const strong = deriveInsights(buildAthleteModel([entry("Z2", 9), entry("Z2", 8), entry("Z2", 9), entry("Z2", 9)]));
    expect(strong.find((i) => i.dimension === "Z2")?.severity).toBe("good");

    day = 0;
    const tooFew = deriveInsights(buildAthleteModel([entry("SIT", 3), entry("SIT", 3)]));
    expect(tooFew.find((i) => i.dimension === "SIT")).toBeUndefined();
  });

  it("flags a downtrending overall execution as a hypothesis, not a diagnosis", () => {
    day = 0;
    const scores = [entry("Z2", 8), entry("Z2", 7), entry("Z2", 6), entry("Z2", 5), entry("Z2", 4), entry("Z2", 3)];
    const insights = deriveInsights(buildAthleteModel(scores));
    const downtrend = insights.find((i) => i.title === "Execution trending down")!;
    expect(downtrend.suggestion).toBe(
      "Execution is drifting down — could be accumulated fatigue, a harder block, or more outdoor riding. Check recovery signals before adding load."
    );
  });
});

// Task 6 — indoor/outdoor diagnostic split. Fixtures mirror the real shape: several indoor rides
// executing well, a mix of controlled and hot outdoor rides. Fixed tss/durationMin (60 min each)
// isolate the TSS-per-minute premium: controlled group (4 indoor + 1 outdoor-controlled) all run
// 36 tss / 60 min = 0.6/min; hot group runs 54 tss / 60 min = 0.9/min → a clean 50% premium.
describe("deriveInsights — indoor/outdoor split diagnostic (Task 6)", () => {
  const indoorRide = (score: number) => easyEntry("Z2", score, { indoor: true }, { tss: 36, durationMin: 60 });
  const controlledRide = (score: number) =>
    easyEntry("Z2", score, { indoor: false, hrRead: "dialed" }, { tss: 36, durationMin: 60 });
  const hotRide = (score: number, tss: number | null = 54) =>
    easyEntry("Z2", score, { indoor: false, hrRead: "hot" }, { tss, durationMin: 60 });

  it("builds the easy diagnostics onto AthleteTypeStat for Z2", () => {
    day = 0;
    const scores = [indoorRide(9), indoorRide(9), indoorRide(9), indoorRide(9), controlledRide(8), hotRide(5), hotRide(5)];
    const m = buildAthleteModel(scores);
    const z2 = m.byType.find((t) => t.type === "Z2")!;
    expect(z2.easy).toEqual({
      reads: 7,
      indoorN: 4,
      outdoorN: 3,
      indoorExecAvg: 9,
      outdoorExecAvg: 6, // round1 mean of 8,5,5 (all outdoor, hot+controlled mixed)
      outdoorControlledExecAvg: null, // only 1 outdoor-controlled ride — below the 2-sample floor
      outdoorHotN: 2,
      hotTssPerMin: 0.9,
      controlledTssPerMin: 0.6,
    });
  });

  it("computes outdoorControlledExecAvg once there are ≥2 controlled-outdoor samples", () => {
    day = 0;
    const scores = [controlledRide(8), controlledRide(9), hotRide(5), hotRide(5)];
    const m = buildAthleteModel(scores);
    const z2 = m.byType.find((t) => t.type === "Z2")!;
    expect(z2.easy!.outdoorControlledExecAvg).toBe(8.5);
    expect(z2.easy!.indoorExecAvg).toBeNull(); // no indoor rides at all — below the 2-sample floor (0 samples)
  });

  it("fires the split insight at 'watch' when overall execution stays healthy", () => {
    day = 0;
    const scores = [indoorRide(9), indoorRide(9), indoorRide(9), indoorRide(9), controlledRide(8), hotRide(5), hotRide(5)];
    const insights = deriveInsights(buildAthleteModel(scores));
    const split = insights.find((i) => i.dimension === "Z2")!;
    expect(split.title).toBe("Z2 splits indoor vs outdoor");
    expect(split.severity).toBe("watch");
    expect(split.evidence).toContain("indoor 9/10 (4 rides)");
    expect(split.evidence).toContain("2 of 3 outdoor rides ran hot");
    expect(split.suggestion).toContain("~50% more training load per minute");
  });

  it("fires the split insight at 'alert' when overall execution drops below 5.5 despite the healthy side", () => {
    day = 0;
    const scores = [indoorRide(9), indoorRide(9), indoorRide(9), indoorRide(9), controlledRide(8), hotRide(2), hotRide(2)];
    const m = buildAthleteModel(scores);
    const z2 = m.byType.find((t) => t.type === "Z2")!;
    expect(z2.execEwma).toBeLessThan(5.5); // confirms the fixture actually exercises the alert branch
    const insights = deriveInsights(m);
    const split = insights.find((i) => i.dimension === "Z2")!;
    expect(split.title).toBe("Z2 splits indoor vs outdoor");
    expect(split.severity).toBe("alert");
  });

  it("omits the TSS-premium clause when hot-side tss data is missing", () => {
    day = 0;
    const scores = [
      indoorRide(9), indoorRide(9), indoorRide(9), indoorRide(9),
      controlledRide(8),
      hotRide(5, null), hotRide(5, null), // no tss on the hot rides → hotTssPerMin stays null
    ];
    const m = buildAthleteModel(scores);
    const z2 = m.byType.find((t) => t.type === "Z2")!;
    expect(z2.easy!.hotTssPerMin).toBeNull();
    const insights = deriveInsights(m);
    const split = insights.find((i) => i.dimension === "Z2")!;
    expect(split.title).toBe("Z2 splits indoor vs outdoor");
    expect(split.suggestion).not.toContain("training load per minute");
    expect(split.suggestion).toBe(
      "Not a case for easing the Z2 target — the hot outdoor days are the problem: flatter routes or capped effort on climbs."
    );
  });

  it("falls through to the existing generic insight, byte-identical, when the ledger has no easy stamps", () => {
    // Pre-rebuild ledger / pre-Task-2 entries: same exec-score shape as the 'alert' fixture above,
    // but built with the plain entry() helper (no `easy` field at all).
    day = 0;
    const scores = [entry("Z2", 9), entry("Z2", 9), entry("Z2", 9), entry("Z2", 9), entry("Z2", 8), entry("Z2", 2), entry("Z2", 2)];
    const m = buildAthleteModel(scores);
    const z2 = m.byType.find((t) => t.type === "Z2")!;
    expect(z2.easy).toBeUndefined();
    const insights = deriveInsights(m);
    const generic = insights.find((i) => i.dimension === "Z2")!;
    expect(generic).toEqual({
      dimension: "Z2",
      severity: "alert",
      title: "Z2 is a weak point",
      evidence: `Execution averaging ${z2.execEwma}/10 across ${z2.n} sessions.`,
      suggestion: "Ease the Z2 prescription (shorter reps or lower target) and progress gradually.",
    });
  });

  it("does not fire the split when only 1 outdoor ride ran hot (outdoorHotN gate)", () => {
    day = 0;
    const scores = [indoorRide(9), indoorRide(9), indoorRide(9), indoorRide(9), controlledRide(8), controlledRide(8), hotRide(5)];
    const m = buildAthleteModel(scores);
    expect(m.byType.find((t) => t.type === "Z2")!.easy!.outdoorHotN).toBe(1);
    const insights = deriveInsights(m);
    expect(insights.find((i) => i.dimension === "Z2")?.title).not.toBe("Z2 splits indoor vs outdoor");
  });

  it("does not fire the split when there is no healthy side (indoor + outdoor-controlled both thin/low)", () => {
    day = 0;
    // No indoor rides at all; only 1 outdoor-controlled ride (below the 2-sample floor) alongside 2 hot.
    const scores = [controlledRide(8), hotRide(4), hotRide(4)];
    const m = buildAthleteModel(scores);
    const z2 = m.byType.find((t) => t.type === "Z2")!;
    expect(z2.easy!.indoorExecAvg).toBeNull();
    expect(z2.easy!.outdoorControlledExecAvg).toBeNull();
    const insights = deriveInsights(m);
    expect(insights.find((i) => i.dimension === "Z2")?.title).not.toBe("Z2 splits indoor vs outdoor");
  });

  it("does not fire the split when outdoorN is below 3 (only 2 outdoor rides total)", () => {
    day = 0;
    const scores = [indoorRide(9), indoorRide(9), indoorRide(9), indoorRide(9), hotRide(5), hotRide(5)];
    const m = buildAthleteModel(scores);
    const z2 = m.byType.find((t) => t.type === "Z2")!;
    expect(z2.easy!.outdoorN).toBe(2);
    expect(z2.easy!.outdoorHotN).toBe(2);
    const insights = deriveInsights(m);
    expect(insights.find((i) => i.dimension === "Z2")?.title).not.toBe("Z2 splits indoor vs outdoor");
  });

  it("still respects the MIN_OBSERVATIONS floor even with a bimodal-looking shape (n < 3)", () => {
    day = 0;
    const scores = [indoorRide(9), hotRide(2)];
    const m = buildAthleteModel(scores);
    const insights = deriveInsights(m);
    expect(insights.find((i) => i.dimension === "Z2")).toBeUndefined();
  });

  it("leaves non-Z2/Recovery types without an easy field entirely", () => {
    day = 0;
    const scores = [entry("Threshold", 8), entry("Threshold", 8), entry("Threshold", 8)];
    const m = buildAthleteModel(scores);
    expect(m.byType.find((t) => t.type === "Threshold")!.easy).toBeUndefined();
  });
});
