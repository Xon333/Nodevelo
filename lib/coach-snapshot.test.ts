import { describe, expect, it } from "vitest";
import { buildCoachSnapshot, buildCoachSnapshotFromSources, formatCoachSnapshot, formatFormFuelLine, resolveTsbModifier, type CoachSnapshotInput } from "./coach-snapshot";
import { resolveTsbModifierEdges } from "./calibration";
import type { AthleteState, CurrentBlock, DispositionEntry, InterventionLog, MorningCheckEntry, RollingBaselines, SyncData, TodayAnalysis } from "./types";

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
    morningCheck: null,
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

  // ROADMAP #2 — the band edges are now a calibrated parameter (population default + manual override).
  it("classifies identically with the default edges passed explicitly (fresh-athlete guarantee)", () => {
    for (const tsb of [-40, -25, -24, -11, -10, -9, 0, 5, 6, 20]) {
      for (const type of ["VO2max", "Z2", null] as const) {
        expect(resolveTsbModifier(tsb, type, resolveTsbModifierEdges())).toEqual(resolveTsbModifier(tsb, type));
      }
    }
  });

  it("shifts the bands when the athlete's adaptation window is overridden", () => {
    // A rider who tolerates deeper fatigue: −27 reads "productive overload", not "deep fatigue".
    const edges = resolveTsbModifierEdges({ deepFatigue: -30, productiveOverload: -12 });
    expect(resolveTsbModifier(-27, "VO2max", edges)).toMatchObject({ band: "productive overload" });
    expect(resolveTsbModifier(-27, "VO2max")).toMatchObject({ band: "deep fatigue" }); // default edges
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

  it("surfaces easy-ride discipline (% above the Z2 cap) on a Z2 day", () => {
    // total 3600s, 900s in zones 3+ (above the cap) → 25%.
    const z2Ride = {
      ...todayAnalysis,
      plannedType: "Z2",
      intervalComparison: null,
      powerZoneTimes: [1800, 900, 600, 300, 0, 0, 0],
    } as unknown as TodayAnalysis;
    const s = buildCoachSnapshot(baseInput({ todayAnalysis: z2Ride, todaySessionType: "Z2" }));
    expect(s.today.execution?.aboveZ2Pct).toBe(25);
    expect(formatCoachSnapshot(s)).toContain("25% above Z2 cap");
  });

  it("leaves aboveZ2Pct null on a non-easy day", () => {
    // The base fixture is a Threshold interval session — discipline-% doesn't apply.
    expect(buildCoachSnapshot(baseInput()).today.execution?.aboveZ2Pct).toBeNull();
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

  it("carries today's morning flag into the snapshot", () => {
    const morningCheck: MorningCheckEntry = { date: TODAY, flag: "ill", decision: "downgrade", setAt: "" };
    const s = buildCoachSnapshot(baseInput({ morningCheck }));
    expect(s.today.morningCheck).toMatchObject({ flag: "ill", decision: "downgrade" });
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

describe("buildCoachSnapshotFromSources", () => {
  const baselines: RollingBaselines = { avgTss90d: null, avgDecoupling90d: null, avgCadence90d: null, avgCtl90d: null, avgWeeklyHours90d: null, ridesPerWeek90d: null, updatedAt: "" };
  const sync = { syncedAt: "", fitness: { ctl: 60, atl: 70, tsb: -10 }, activities: [], wellness: [], powerCurve: [] } as unknown as SyncData;
  const interventionLog = { records: [], updatedAt: "" } as unknown as InterventionLog;
  const blockWith = (durationMin: number) =>
    ({ goal: "g", lengthWeeks: 4, startDate: "2026-06-15", endDate: "2026-07-12", overview: "", createdAt: "", days: [{ date: TODAY, name: "Threshold", type: "Threshold", durationMin }] }) as unknown as CurrentBlock;

  const sources = (overrides: Record<string, unknown> = {}) => ({
    date: TODAY,
    ftp: 280,
    block: blockWith(75),
    sync,
    todayAnalysis: null,
    scoreEntries: [],
    baselines,
    dispositions: [] as DispositionEntry[],
    interventionLog,
    morningChecks: [] as MorningCheckEntry[],
    acwrBandsOverride: null,
    ...overrides,
  });

  it("resolves form from the sync and picks today's session type, disposition and morning check", () => {
    const dispositions: DispositionEntry[] = [
      { date: TODAY, disposition: "compromised", reason: "equipment", setAt: "" },
      { date: "2026-06-19", disposition: "missed", reason: null, setAt: "" }, // a different day — must be ignored
    ];
    const morningChecks: MorningCheckEntry[] = [
      { date: TODAY, flag: "extreme-fatigue", decision: "proceed", setAt: "" },
    ];
    const s = buildCoachSnapshotFromSources(sources({ dispositions, morningChecks }));
    expect(s.date).toBe(TODAY);
    expect(s.ftp).toBe(280);
    expect(s.form.tsb).toBe(-10); // off sync.fitness
    expect(s.today.sessionType).toBe("Threshold");
    expect(s.today.morningCheck).toMatchObject({ decision: "proceed" });
    expect(s.disposition).toMatchObject({ kind: "compromised", reason: "equipment" }); // today's, not the 19th's
  });

  it("treats a rest day (durationMin 0) as no session type", () => {
    expect(buildCoachSnapshotFromSources(sources({ block: blockWith(0) })).today.sessionType).toBeNull();
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

  it("renders the morning flag when present", () => {
    const morningCheck: MorningCheckEntry = { date: TODAY, flag: "ill", decision: "downgrade", setAt: "" };
    const out = formatCoachSnapshot(buildCoachSnapshot(baseInput({ morningCheck })));
    expect(out).toContain("Flagged this morning: feeling ill");
    expect(out).toContain("downgraded today's quality session");
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
