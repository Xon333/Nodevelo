import { describe, expect, it } from "vitest";
import {
  blockDates,
  buildRideAnalysisPrompt,
  buildRetrospectivePrompt,
  buildStructuredRetrospectivePrompt,
  buildSystemPrompt,
  buildUserMessage,
  type ReflectionInterventionInput,
  type RetrospectiveInput,
  type RideAnalysisInput,
} from "./anthropic-prompts";
import type { BlockParams, IntervalComparison } from "./types";

// These prompt builders were inlined in the SDK call functions before the RV-8 split, so they couldn't
// be tested without mocking the network. Now pure, they're asserted directly.

const rideInput = (over: Partial<RideAnalysisInput> = {}): RideAnalysisInput => ({
  activityDate: "2026-06-24",
  activityName: "Threshold 3x12",
  activityType: "Ride",
  activityDurationMin: 75,
  activityAvgWatts: 240,
  activityNormalizedPower: 250,
  activityMaxWatts: 600,
  activityAvgHr: 150,
  activityMaxHr: 175,
  activityKj: 900,
  activityTrainingLoad: 90,
  activityRpe: 6,
  activityDecoupling: 4.2,
  activityDescription: null,
  avgCadence: 90,
  distanceMeters: 40000,
  elevationGain: 500,
  powerZoneTimes: null,
  hrZoneTimes: null,
  intervalComparison: null,
  plannedName: "Threshold 3x12",
  plannedType: "Threshold",
  plannedDurationMin: 75,
  plannedWorkoutText: null,
  athleteFtp: 250,
  athleteThresholdHr: 165,
  ...over,
});

describe("buildRideAnalysisPrompt", () => {
  it("renders the planned line, an IF off NP/FTP, and decoupling", () => {
    const p = buildRideAnalysisPrompt(rideInput());
    expect(p).toContain('Planned: Threshold — "Threshold 3x12" (75 min)');
    expect(p).toContain("IF 1.00"); // NP 250 / FTP 250
    expect(p).toContain("Pw:HR drift 4.2%"); // durability framing (decoupling demoted from execution)
  });

  it("calls out a new power PR as a breakthrough", () => {
    const p = buildRideAnalysisPrompt(rideInput({ powerPRs: [{ durationSec: 300, watts: 330, prevWatts: 320 }] }));
    expect(p).toContain("New power PRs");
    expect(p).toContain("330W (was 320W)");
  });

  // The HR-judged easy-ride rework's LLM surface: on a prescribed Z2/Recovery day the note must judge
  // "was it easy" by the HR read, not power-zone spread — otherwise the model re-derives the exact
  // terrain-confounded "zone creep" narrative the scoring rework eliminated.
  it("renders the HR-judged discipline read + power-caveat instruction on an easy day", () => {
    const p = buildRideAnalysisPrompt(
      rideInput({ plannedType: "Z2", plannedName: "Easy Z2", aerobicDiscipline: "dialed", powerZoneTimes: [781, 2005, 1274, 528, 340] })
    );
    expect(p).toContain("Easy-ride discipline (HR-judged): dialed in");
    expect(p).toMatch(/do not.*power-zone/i);
    expect(p).toMatch(/descents|rollers|terrain/i);
  });

  it("renders the ran-hot read honestly, with the fatigue-cost clause", () => {
    const p = buildRideAnalysisPrompt(rideInput({ plannedType: "Recovery", aerobicDiscipline: "hot" }));
    expect(p).toContain("ran hot");
    expect(p).toMatch(/real training load.*fatigue model/i);
  });

  it("omits the discipline line on interval days and when the read is absent", () => {
    expect(buildRideAnalysisPrompt(rideInput())).not.toContain("Easy-ride discipline");
    expect(buildRideAnalysisPrompt(rideInput({ plannedType: "Z2", aerobicDiscipline: null }))).not.toContain("Easy-ride discipline");
  });

  // Task 4 added TodayAnalysis.aerobicEffPct — the figure behind the HR-judged discipline read.
  // Appended to the discipline line only when it clears the AEROBIC_DEADBAND_PCT weak-band threshold.
  it("appends the aerobic-efficiency clause, rounded to 1dp, when notably below baseline (<= -3%)", () => {
    // Raw computed %Δ is an unrounded float (lib/aerobic.ts) — the narration rounds for readability.
    const p = buildRideAnalysisPrompt(
      rideInput({ plannedType: "Z2", aerobicDiscipline: "drift", aerobicEffPct: -5.234567 })
    );
    expect(p).toContain("Easy-ride discipline (HR-judged): some drift");
    expect(p).toContain("aerobic efficiency -5.2% below your 90-day baseline");
  });

  it("omits the aerobic-efficiency clause when within the deadband or absent", () => {
    const withinDeadband = buildRideAnalysisPrompt(
      rideInput({ plannedType: "Z2", aerobicDiscipline: "dialed", aerobicEffPct: -1.5 })
    );
    expect(withinDeadband).not.toContain("below your 90-day baseline");

    const absent = buildRideAnalysisPrompt(rideInput({ plannedType: "Z2", aerobicDiscipline: "dialed", aerobicEffPct: null }));
    expect(absent).not.toContain("below your 90-day baseline");
  });

  it("flags the plan/detection mismatch note when set", () => {
    const comparison: IntervalComparison = {
      prescribedLabels: ["3x12m @ 95%"],
      reps: [{ targetWatts: 238, actualWatts: 240, durationSec: 360, targetDurationSec: 720, adherencePct: 101, durationPct: 50 }],
      completed: 0,
      total: 3,
      avgAdherencePct: 101,
      avgDurationPct: 50,
      effectiveAdherencePct: 50,
      structuralMismatch: true,
      extras: [],
    };
    expect(buildRideAnalysisPrompt(rideInput({ intervalComparison: comparison }))).toContain("plan/detection mismatch");
  });

  it("includes the FUEL PROMPT line verbatim, with an instruction to use its numbers as-is, when fuelPromptContext is present", () => {
    const p = buildRideAnalysisPrompt(
      rideInput({ fuelPromptContext: "FUEL PROMPT: logged 35 g/h vs derived optimum 69 g/h" })
    );
    expect(p).toContain("FUEL PROMPT: logged 35 g/h vs derived optimum 69 g/h");
    expect(p).toContain("never invent or recompute them"); // the model must not compute its own figures
  });

  it("omits the FUEL PROMPT data line when fuelPromptContext is absent or null (the instruction sentence itself always mentions FUEL PROMPT by name)", () => {
    // The always-present instruction sentence legitimately contains the substring "FUEL PROMPT" (telling
    // the model how to handle the line WHEN present) — so assert on the concrete data-line shape
    // (`FUEL PROMPT: ...`) rather than the bare substring, which would false-fail against that sentence.
    expect(buildRideAnalysisPrompt(rideInput())).not.toMatch(/FUEL PROMPT: /);
    expect(buildRideAnalysisPrompt(rideInput({ fuelPromptContext: null }))).not.toMatch(/FUEL PROMPT: /);
  });
});

const blockParams: BlockParams = {
  lengthWeeks: 4,
  goal: "Hilly KOM build",
  weakpoints: ["VO2max"],
  startDate: "2026-07-20",
};

describe("buildSystemPrompt / buildUserMessage (block generation)", () => {
  // The Intervals.icu "press lap" convention: the phrase makes a step open-ended (lap-button end)
  // on Garmin/Suunto via Garmin Connect. The guide must teach it WITH its guardrails — positioning/
  // readiness steps only, never the prescribed work interval, never indoor/ERG.
  it("teaches the press-lap open-ended step syntax with its misuse guardrails", () => {
    const { cached } = buildSystemPrompt("KB", "", "ATHLETE CURRENT DATA", blockParams);
    expect(cached).toContain('the phrase "Press lap"');
    expect(cached).toContain("- Press lap when ready 20m 50%"); // the concrete example step
    expect(cached).toMatch(/Garmin\/Suunto/); // device-scoped, not universal
    expect(cached).toMatch(/NEVER on a prescribed work interval/);
    expect(cached).toMatch(/NEVER\s+in indoor\/ERG sessions/);
    expect(cached).toContain("realistic duration"); // duration still required for time/load estimates
  });

  const userMessage = () =>
    buildUserMessage(blockParams, blockDates("2026-07-20", 4), "| table |");

  // A live block came in with 2 of 4 loading weeks BELOW the stated 10h floor: the old wording
  // ("must reach at least 10h") read as a floor to clear, and easy sessions landed compact. The
  // rewrite targets the top of the range and names easy-Z2 duration as the volume lever.
  it("targets the top of the weekly-hours range and names easy-Z2 duration as the lever", () => {
    const p = userMessage();
    expect(p).toContain("must total 10–12 hours"); // DEFAULT_BLOCK_SETTINGS interpolated
    expect(p).toContain("plan toward the TOP of that range (~12h)");
    expect(p).toContain("Landing at exactly 10h is a shortfall, not a pass");
    expect(p).toMatch(/LENGTHEN the easy Z2 sessions/);
    expect(p).not.toContain("must reach at least"); // the old floor-clearing wording is gone
  });

  it("sizes easy Z2 sessions to the volume target instead of capping them at 60–90 min", () => {
    const p = userMessage();
    expect(p).not.toContain("(60–90 min each)"); // the old fixed cap that produced compact weeks
    expect(p).toContain("size them UP, typically 90–120 min, until the week's total hits the WEEKLY VOLUME target");
    // The rest-day clause still renders correctly after the structure-line rewrite.
    expect(p).toContain("+ 1 rest day per week");
  });
});

const retroInput = (over: Partial<RetrospectiveInput> = {}): RetrospectiveInput => ({
  goal: "Hilly KOM build",
  lengthWeeks: 4,
  startDate: "2026-05-01",
  endDate: "2026-05-28",
  plannedHours: 40,
  actualHours: 36,
  overallCompliancePct: 90,
  ctlStart: 60,
  ctlEnd: 68,
  complianceByType: { Threshold: 95, VO2max: 80 },
  topSessions: [{ date: "2026-05-10", name: "Big day", tss: 180 }],
  avgDecoupling: 5.1,
  ...over,
});

describe("buildRetrospectivePrompt / buildStructuredRetrospectivePrompt", () => {
  it("includes the CTL delta and compliance figures", () => {
    const p = buildRetrospectivePrompt(retroInput());
    expect(p).toContain("CTL: 60 → 68 (+8.0)");
    expect(p).toContain("90% compliance");
    expect(p).toContain("Threshold: 95%");
  });

  it("injects the rider power profile when present, and omits the section when absent (Track A)", () => {
    const withProfile = buildRetrospectivePrompt(retroInput({ powerProfile: "- Rider type: puncheur — strong surges." }));
    expect(withProfile).toContain("RIDER POWER PROFILE");
    expect(withProfile).toContain("puncheur");
    expect(withProfile).toContain("curve SHAPE"); // the instruction to weigh shape, not just compliance
    expect(buildRetrospectivePrompt(retroInput())).not.toContain("RIDER POWER PROFILE"); // no profile → no section
  });

  it("numbers each intervention for the structured reflection", () => {
    const interventions: ReflectionInterventionInput[] = [
      {
        dimension: "VO2max",
        severity: "alert",
        title: "Ease VO2 prescription",
        physMetric: "5-min power",
        baselineExecEwma: 4.8,
        baselinePhys: 320,
        outcome: { execNow: 6.5, physNow: 335, execDelta: 1.7, physDelta: 15, verdict: "validated" },
      },
    ];
    const p = buildStructuredRetrospectivePrompt({ ...retroInput(), interventions });
    expect(p).toContain("1. [VO2max] (alert) Ease VO2 prescription");
    expect(p).toContain("verdict validated");
  });
});
