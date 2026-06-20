import { describe, expect, it } from "vitest";
import { buildCoachSnapshot, formatCoachSnapshot, formatFormFuelLine, resolveTsbModifier, type CoachSnapshotInput } from "./coach-snapshot";
import type { AthleteState, CurrentBlock, DispositionEntry, TodayAnalysis } from "./types";

const TODAY = "2026-06-20";

const intervalComparison = {
  prescribedLabels: ["4×8m @ 300W"],
  reps: [],
  completed: 2,
  total: 5,
  avgAdherencePct: 95, // power %
  avgDurationPct: 41, // duration %
  effectiveAdherencePct: 39, // power × duration
  structuralMismatch: false,
  extras: [],
};

const todayAnalysis = {
  activityDate: TODAY,
  executionScore: 4,
  intervalComparison,
  advisedIntakeKcal: 2800,
  activityKj: 950,
} as unknown as TodayAnalysis;

const athleteState: AthleteState = {
  score: 38,
  band: "strained",
  recommendation: "soften",
  confidence: "medium",
  drivers: [],
  headline: "Strained — RPE drifting up",
};

const block = {
  goal: "Raise threshold",
  lengthWeeks: 4,
  startDate: "2026-06-15",
  endDate: "2026-07-12",
  overview: "Progressive threshold work.",
  days: [],
} as unknown as CurrentBlock;

function baseInput(overrides: Partial<CoachSnapshotInput> = {}): CoachSnapshotInput {
  return {
    date: TODAY,
    ftp: 280,
    block,
    todaySessionType: "Threshold",
    fitness: { ctl: 60, atl: 75, tsb: -15 },
    readiness: { level: "Hold", reason: "moderate fatigue" },
    acwr: { acute: 80, chronic: 70, ratio: 1.14, level: "optimal" },
    loadRamp: { triggered: true, level: "caution", thisWeekTss: 500, lastWeekTss: 380, changePct: 31, reason: "load up 31%" },
    athleteState,
    todayAnalysis,
    weightTrend7dKg: -0.4,
    directives: "Prioritise threshold durability; under-delivering on VO2max.",
    disposition: null,
    ...overrides,
  };
}

describe("resolveTsbModifier", () => {
  it("returns null when TSB is unknown", () => {
    expect(resolveTsbModifier(null, "VO2max")).toBeNull();
  });

  it("bands quality days with prescription-aware guidance", () => {
    expect(resolveTsbModifier(-30, "VO2max")).toMatchObject({ band: "deep fatigue" });
    expect(resolveTsbModifier(-30, "VO2max")!.guidance).toContain("may not fully adapt");
    expect(resolveTsbModifier(-15, "Threshold")).toMatchObject({ band: "productive overload" });
    expect(resolveTsbModifier(-15, "Threshold")!.guidance).toContain("drop a rep");
    expect(resolveTsbModifier(0, "Threshold")).toMatchObject({ band: "balanced" });
    expect(resolveTsbModifier(12, "SIT")).toMatchObject({ band: "fresh" });
  });

  it("gives easy/unplanned days lighter guidance at the same TSB", () => {
    const easy = resolveTsbModifier(-15, "Z2");
    expect(easy).toMatchObject({ band: "productive overload" });
    expect(easy!.guidance).toContain("easy volume");
    expect(easy!.guidance).not.toContain("drop a rep");
  });
});

describe("buildCoachSnapshot", () => {
  it("maps today's execution off the interval comparison", () => {
    const s = buildCoachSnapshot(baseInput());
    expect(s.today.rideLogged).toBe(true);
    expect(s.today.execution).toMatchObject({
      score: 4,
      completed: 2,
      total: 5,
      effectivePct: 39,
      powerPct: 95,
      durationPct: 41,
      structuralMismatch: false,
    });
  });

  it("resolves form (TSB modifier, ACWR, readiness, load ramp) and block week", () => {
    const s = buildCoachSnapshot(baseInput());
    expect(s.form).toMatchObject({ tsb: -15, acwr: "optimal", readiness: "Hold", loadRamp: "caution" });
    expect(s.form.tsbModifier).toMatchObject({ band: "productive overload" });
    expect(s.block).toMatchObject({ weekOfBlock: 1, totalWeeks: 4 });
  });

  it("populates available fuel and leaves the WIP slots null", () => {
    const s = buildCoachSnapshot(baseInput());
    expect(s.fuel).toMatchObject({ todayTargetKcal: 2800, rideBurnKj: 950, weightTrend7dKg: -0.4 });
    expect(s.fuel.intakeVsNeed).toBeNull();
    expect(s.fuel.fuelingState).toBeNull();
  });

  it("treats a stale today-analysis (different date) as no ride logged", () => {
    const s = buildCoachSnapshot(baseInput({ todayAnalysis: { ...todayAnalysis, activityDate: "2026-06-19" } as TodayAnalysis }));
    expect(s.today.rideLogged).toBe(false);
    expect(s.today.execution).toBeNull();
    expect(s.fuel.todayTargetKcal).toBeNull();
  });

  it("does not drop the load-ramp level when no alert is triggered", () => {
    const s = buildCoachSnapshot(baseInput({ loadRamp: { triggered: false, level: "none", thisWeekTss: 0, lastWeekTss: 0, changePct: null, reason: null } }));
    expect(s.form.loadRamp).toBeNull();
  });
});

describe("formatCoachSnapshot", () => {
  it("renders the resolved execution + form + fuel lines", () => {
    const out = formatCoachSnapshot(buildCoachSnapshot(baseInput()));
    expect(out).toContain("SITUATION");
    expect(out).toContain("execution 4/10");
    expect(out).toContain("2/5 reps");
    expect(out).toContain("effective 39% (power 95% × duration 41%)");
    expect(out).toContain("TSB -15 (productive overload");
    expect(out).toContain("target 2,800 kcal");
  });

  it("never renders the reserved (WIP) fuel slots", () => {
    const out = formatCoachSnapshot(buildCoachSnapshot(baseInput()));
    expect(out).not.toContain("fuelingState");
    expect(out).not.toContain("intakeVsNeed");
  });

  it("emits the strong compromised-disposition guard last", () => {
    const disposition: DispositionEntry = { date: TODAY, disposition: "compromised", reason: "equipment", setAt: "" };
    const out = formatCoachSnapshot(buildCoachSnapshot(baseInput({ disposition })));
    expect(out).toContain("COMPROMISED (equipment)");
    expect(out).toContain("do not infer recovery debt");
    expect(out.trim().endsWith("on the basis of it.")).toBe(true);
  });

  it("flags a plan/detection mismatch so duration is judged with care", () => {
    const ta = { ...todayAnalysis, intervalComparison: { ...intervalComparison, structuralMismatch: true } } as TodayAnalysis;
    const out = formatCoachSnapshot(buildCoachSnapshot(baseInput({ todayAnalysis: ta })));
    expect(out).toContain("plan/detection mismatch");
  });
});

describe("formatFormFuelLine", () => {
  it("produces a compact resolved form+fuel line for generation", () => {
    const line = formatFormFuelLine(buildCoachSnapshot(baseInput()));
    expect(line).toContain("CURRENT FORM & FUEL");
    expect(line).toContain("TSB -15 (productive overload)");
    expect(line).toContain("ACWR optimal");
    expect(line).toContain("fuel target 2,800 kcal");
    // today.execution is not part of the generation line
    expect(line).not.toContain("execution");
  });

  it("returns null when there's no form/fuel data", () => {
    const empty = buildCoachSnapshot(baseInput({ fitness: null, acwr: null, readiness: null, todayAnalysis: null, weightTrend7dKg: null }));
    expect(formatFormFuelLine(empty)).toBeNull();
  });
});
