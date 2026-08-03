import { describe, expect, it, vi } from "vitest";
import { buildCoachSnapshot, buildCoachSnapshotFromSources, formatCoachSnapshot, formatFormFuelLine, resolveCoachSignals, resolveTsbModifier, type CoachSnapshotInput } from "./coach-snapshot";
import { resolveTsbModifierEdges } from "./calibration";
import { buildAthleteModel } from "./athlete-model";
import { localToday } from "./date";
import type { AthleteState, CurrentBlock, DispositionEntry, InterventionLog, MorningCheckEntry, RideScoreEntry, RollingBaselines, SyncData, TodayAnalysis } from "./types";

const TODAY = "2026-06-20";

vi.mock("./date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./date")>();
  return { ...actual, localToday: vi.fn(actual.localToday) };
});

describe("resolveCoachSignals local-date fallback", () => {
  it("matches an explicitly supplied local day across the UTC-midnight boundary", () => {
    vi.mocked(localToday).mockReturnValueOnce("2026-06-21");
    const sync = {
      syncedAt: "", fitness: { ctl: 50, atl: 50, tsb: 0 }, activities: [], powerCurve: [],
      wellness: [
        { date: "2026-06-18", weightKg: 70, kcalConsumed: 2100 },
        { date: "2026-06-19", weightKg: 70, kcalConsumed: 2100 },
        { date: "2026-06-20", weightKg: 70, kcalConsumed: 2100 },
      ],
    } as unknown as SyncData;
    const baselines = { avgTss90d: null, avgDecoupling90d: null, avgCtl90d: null, avgWeeklyHours90d: null, ridesPerWeek90d: null, updatedAt: "" };

    const fallback = resolveCoachSignals(sync, buildAthleteModel([]), baselines);
    const explicit = resolveCoachSignals(sync, buildAthleteModel([]), baselines, null, null, "2026-06-21");

    expect(fallback.energyAvailability).toEqual(explicit.energyAvailability);
    expect(fallback.energyAvailability).not.toBeNull();
  });
});

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
    energyAvailability: null,
    weeklyBalance: null,
    directives: "Prioritise threshold durability; under-delivering on VO2max.",
    disposition: null,
    morningCheck: null,
    ftpRetest: null,
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

  it("surfaces the HR-judged aerobic discipline read on a Z2 day", () => {
    // Lifted straight from TodayAnalysis.aerobicDiscipline — already gated by ride-analysis.ts.
    const z2Ride = {
      ...todayAnalysis,
      plannedType: "Z2",
      intervalComparison: null,
      aerobicDiscipline: "drift",
    } as unknown as TodayAnalysis;
    const s = buildCoachSnapshot(baseInput({ todayAnalysis: z2Ride, todaySessionType: "Z2" }));
    expect(s.today.execution?.aerobicDiscipline).toBe("drift");
    expect(formatCoachSnapshot(s)).toContain("aerobic discipline: some drift");
  });

  it("leaves aerobicDiscipline null on a non-easy day", () => {
    // The base fixture is a Threshold interval session — discipline read doesn't apply.
    expect(buildCoachSnapshot(baseInput()).today.execution?.aerobicDiscipline).toBeNull();
  });

  // Task 5: the aerobic-efficiency figure behind the discipline read, surfaced in the SITUATION line
  // so a "some drift" read isn't left without detail.
  it("surfaces the aerobic-efficiency figure alongside discipline, rounded to 1dp, when notably below baseline", () => {
    // Raw computed %Δ is an unrounded float (lib/aerobic.ts) — the snapshot preserves it raw, the
    // narration line rounds for readability.
    const z2Ride = {
      ...todayAnalysis,
      plannedType: "Z2",
      intervalComparison: null,
      aerobicDiscipline: "drift",
      aerobicEffPct: -4.6789,
    } as unknown as TodayAnalysis;
    const s = buildCoachSnapshot(baseInput({ todayAnalysis: z2Ride, todaySessionType: "Z2" }));
    expect(s.today.execution?.aerobicEffPct).toBe(-4.6789);
    expect(formatCoachSnapshot(s)).toContain("aerobic discipline: some drift (efficiency -4.7% below baseline)");
  });

  it("omits the efficiency detail when within the deadband", () => {
    const z2Ride = {
      ...todayAnalysis,
      plannedType: "Z2",
      intervalComparison: null,
      aerobicDiscipline: "dialed",
      aerobicEffPct: -1.2,
    } as unknown as TodayAnalysis;
    const s = buildCoachSnapshot(baseInput({ todayAnalysis: z2Ride, todaySessionType: "Z2" }));
    const line = formatCoachSnapshot(s);
    expect(line).toContain("aerobic discipline: dialed in");
    expect(line).not.toContain("efficiency");
  });

  it("resolves form (TSB modifier, ACWR, readiness, load ramp) and block week", () => {
    const s = buildCoachSnapshot(baseInput());
    expect(s.form).toMatchObject({ tsb: -15, acwr: "optimal", readiness: "Hold", loadRamp: "caution" });
    expect(s.form.tsbModifier).toMatchObject({ band: "productive overload" });
    expect(s.block).toMatchObject({ weekOfBlock: 1, totalWeeks: 4 });
  });

  it("populates available fuel and leaves the EA slots null when no EA is resolved", () => {
    const s = buildCoachSnapshot(baseInput());
    expect(s.fuel).toMatchObject({ todayTargetKcal: 2800, rideBurnKj: 950, weightTrend7dKg: -0.4 });
    expect(s.fuel.intakeVsNeed).toBeNull();
    expect(s.fuel.fuelingState).toBeNull();
  });

  it("maps the energy-availability read into the fuel slots (Track C / #1)", () => {
    const s = buildCoachSnapshot(baseInput({ energyAvailability: { eaKcalPerKg: 32, daysUsed: 7, trend: -3 } }));
    expect(s.fuel.intakeVsNeed).toBe(32); // the kcal/kg figure
    expect(s.fuel.fuelingState).toBe("adequate"); // its band (25–39)
  });

  it("bands a low EA as 'low' and a high one as 'ample'", () => {
    expect(buildCoachSnapshot(baseInput({ energyAvailability: { eaKcalPerKg: 18, daysUsed: 5, trend: null } })).fuel.fuelingState).toBe("low");
    expect(buildCoachSnapshot(baseInput({ energyAvailability: { eaKcalPerKg: 46, daysUsed: 9, trend: 2 } })).fuel.fuelingState).toBe("ample");
  });

  it("carries today's morning flag into the snapshot", () => {
    const morningCheck: MorningCheckEntry = { date: TODAY, flag: "ill", decision: "downgrade", setAt: "" };
    const s = buildCoachSnapshot(baseInput({ morningCheck }));
    expect(s.today.morningCheck).toMatchObject({ flag: "ill", decision: "downgrade" });
  });

  // The prompt line must name all three flags and all three decisions honestly — an injury/rest was
  // previously rendered as "extreme fatigue → no change (not a quality day)", both halves wrong.
  it("renders an injury → rest morning check honestly in the prompt", () => {
    const morningCheck: MorningCheckEntry = { date: TODAY, flag: "injury", decision: "rest", setAt: "" };
    const out = formatCoachSnapshot(buildCoachSnapshot(baseInput({ morningCheck })));
    expect(out).toContain("injured");
    expect(out).toMatch(/resting today/i);
    expect(out).not.toContain("extreme fatigue");
  });

  it("renders an extreme-fatigue → rest (easy-day skip) morning check honestly in the prompt", () => {
    const morningCheck: MorningCheckEntry = { date: TODAY, flag: "extreme-fatigue", decision: "rest", setAt: "" };
    const out = formatCoachSnapshot(buildCoachSnapshot(baseInput({ morningCheck })));
    expect(out).toContain("extreme fatigue");
    expect(out).toMatch(/resting today/i);
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

describe("weekly energy balance in the fuel slot (§6 / #1)", () => {
  const wb = { weekOf: "2026-06-22", intakeKcal: 12500, needKcal: 14900, ratio: 0.84, loggedDays: 5 };

  it("weekBalance fills and the weekly ratio owns fuelingState over the EA band", () => {
    // Build an input where energyAvailability would band "adequate" (eaKcalPerKg 30) but the
    // weekly ratio is low (0.84) — the precise signal must win.
    const snap = buildCoachSnapshot(baseInput({ weeklyBalance: wb, energyAvailability: { eaKcalPerKg: 30, daysUsed: 5, trend: null } }));
    expect(snap.fuel.weekBalance).toEqual({ weekOf: "2026-06-22", intakeKcal: 12500, needKcal: 14900, ratio: 0.84 });
    expect(snap.fuel.fuelingState).toBe("low");
  });

  it("falls back to the EA band when no weekly balance exists", () => {
    const snap = buildCoachSnapshot(baseInput({ weeklyBalance: null, energyAvailability: { eaKcalPerKg: 30, daysUsed: 5, trend: null } }));
    expect(snap.fuel.weekBalance).toBeNull();
    expect(snap.fuel.fuelingState).toBe("adequate");
  });

  it("labels the fuel line 'fueling', not 'energy availability', when the weekly ratio overrules a disagreeing EA band", () => {
    const out = formatCoachSnapshot(
      buildCoachSnapshot(baseInput({ weeklyBalance: wb, energyAvailability: { eaKcalPerKg: 30, daysUsed: 5, trend: null } }))
    );
    expect(out).toContain("fueling low");
    expect(out).not.toContain("energy availability low");
    expect(out).not.toContain("~30 kcal/kg");
  });

  it("renders the week line in the prompt only when present", () => {
    const withLine = formatCoachSnapshot(buildCoachSnapshot(baseInput({ weeklyBalance: wb })));
    expect(withLine).toContain("last week 12,500 kcal vs 14,900 needed (ratio 0.84 — low)");
    const without = formatCoachSnapshot(buildCoachSnapshot(baseInput({ weeklyBalance: null, energyAvailability: null })));
    expect(without).not.toContain("last week");
  });
});

describe("buildCoachSnapshotFromSources", () => {
  const baselines: RollingBaselines = { avgTss90d: null, avgDecoupling90d: null, avgCtl90d: null, avgWeeklyHours90d: null, ridesPerWeek90d: null, updatedAt: "" };
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
    weeklyBalance: null,
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

  it("threads energy availability from the synced wellness into the fuel slots (Track C / #1)", () => {
    const wellness = [
      { date: "2026-06-17", weightKg: 70, kcalConsumed: 2240 },
      { date: "2026-06-18", weightKg: 70, kcalConsumed: 2240 },
      { date: "2026-06-19", weightKg: 70, kcalConsumed: 2240 },
    ];
    const syncWithEA = { ...sync, wellness } as unknown as SyncData;
    const s = buildCoachSnapshotFromSources(sources({ sync: syncWithEA }));
    expect(s.fuel.intakeVsNeed).toBe(32); // (2240 intake − 0 burn) / 70 kg
    expect(s.fuel.fuelingState).toBe("adequate");
  });

  // #4: the FTP-retest advisory rides CoachSignals so every snapshot consumer resolves it identically.
  // Fixture: 4 in-window Threshold rides at IF 0.96 (band top 0.92), full completion, scored against
  // the sources() FTP of 280 → n=4, all over, mean overshoot +0.04 → fires.
  const overRide = (date: string): RideScoreEntry => ({
    date,
    executionScore: 8,
    plannedType: "Threshold",
    inferredType: "Threshold",
    planned: true,
    legacy: false,
    compliancePct: 100,
    intensityFactor: 0.96,
    ftpUsed: 280,
    durationMin: 75,
    tss: 90,
  });

  it("resolves the FTP-retest advisory from the ledger and formats it end-to-end (#4)", () => {
    const scoreEntries = [overRide("2026-06-13"), overRide("2026-06-15"), overRide("2026-06-17"), overRide("2026-06-19")];
    const s = buildCoachSnapshotFromSources(sources({ scoreEntries }));
    expect(s.ftpRetest).toMatchObject({ n: 4, overCount: 4 });
    const out = formatCoachSnapshot(s);
    expect(out).toContain("- FTP check:");
    expect(out).toContain("re-test in Intervals.icu");
  });

  it("stays null on a thin ledger and renders no FTP-check line (#4)", () => {
    const s = buildCoachSnapshotFromSources(sources({ scoreEntries: [overRide("2026-06-13")] }));
    expect(s.ftpRetest).toBeNull();
    expect(formatCoachSnapshot(s)).not.toContain("FTP check");
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

  it("never leaks the raw fuel slot field names", () => {
    const out = formatCoachSnapshot(buildCoachSnapshot(baseInput({ energyAvailability: { eaKcalPerKg: 32, daysUsed: 7, trend: -3 } })));
    expect(out).not.toContain("fuelingState");
    expect(out).not.toContain("intakeVsNeed");
  });

  it("renders the energy-availability read on the fuel line when resolved", () => {
    const out = formatCoachSnapshot(buildCoachSnapshot(baseInput({ energyAvailability: { eaKcalPerKg: 32, daysUsed: 7, trend: -3 } })));
    expect(out).toContain("energy availability adequate (~32 kcal/kg, body-weight proxy)");
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

  it("labels 'fueling', not 'energy availability', when the weekly ratio owns fuelingState", () => {
    // Same mislabel bug formatCoachSnapshot's fuel line had (fixed 2026-07-11) — this is the milder
    // sibling in the /api/generate block-generation line, which had no test on this path.
    const wb = { weekOf: "2026-06-22", intakeKcal: 12500, needKcal: 14900, ratio: 0.84, loggedDays: 5 };
    const line = formatFormFuelLine(
      buildCoachSnapshot(baseInput({ weeklyBalance: wb, energyAvailability: { eaKcalPerKg: 30, daysUsed: 5, trend: null } }))
    );
    expect(line).toContain("fueling low");
    expect(line).not.toContain("energy availability low");
  });
});
