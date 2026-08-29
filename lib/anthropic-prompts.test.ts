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
import { computeBlockSkeleton, computeWeekTargets } from "./block-skeleton";
import { ACTIVITY_NOTE_MAX_CHARS } from "./intent-note-parser";
import { DEFAULT_BLOCK_SETTINGS, type BlockParams, type IntervalComparison } from "./types";

// These prompt builders were inlined in the SDK call functions before the RV-8 split, so they couldn't
// be tested without mocking the network. Now pure, they're asserted directly.

const rideInput = (over: Partial<RideAnalysisInput> = {}): RideAnalysisInput => ({
  activityDate: "2026-06-24",
  activityName: "Threshold 3x12",
  activityType: "Ride",
  activityDurationMin: 75,
  activityMovingTimeSec: 75 * 60,
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

  // NV-7/NV-5/NV-6 (2026-08-15): evidence-bound prose + descending safety, unconditional on every
  // ride. Live-confirmed defect — with no per-segment evidence, the coach still called an
  // athlete-reported technique ("the aero position discipline") "clearly working", the same rigor
  // failure as asserting an inferred cause (terrain, a specific effort) as settled fact.
  it("instructs the model to distinguish measured facts from inferred causes and athlete-reported technique", () => {
    const p = buildRideAnalysisPrompt(rideInput());
    expect(p).toMatch(/measured fact/i);
    expect(p).toMatch(/inferring.*hedged.*likely.*probably/i);
    expect(p).toMatch(/athlete-reported, not measured/i);
    expect(p).toMatch(/never call the technique itself.*working.*confirmed/i);
  });

  it("instructs the model that a single decoupling reading is not proof of a durable adaptation", () => {
    const p = buildRideAnalysisPrompt(rideInput());
    expect(p).toMatch(/never proof of a lasting physiological adaptation/i);
  });

  it("instructs the model never to turn a low coasting share into blanket no-coasting advice", () => {
    const p = buildRideAnalysisPrompt(rideInput());
    expect(p).toMatch(/never turn a low coasting share into blanket/i);
    expect(p).toMatch(/corners, traffic, on poor surfaces and technical descents/i);
  });

  // NV-11 (2026-08-15): live-confirmed shape — classified power-zone seconds (5510) fall short of
  // moving time (5689) by 179s of coasting/no-power. The old label ("Power zones: ... Z3 42%") let 42%
  // read as 42% of the whole ride when it was actually ~40.5% — hiding the exact behaviour ("limit
  // coasting") the objective was about. The line must now surface the gap explicitly.
  it("surfaces coasting/no-power time explicitly rather than folding it into the zone denominator", () => {
    const p = buildRideAnalysisPrompt(
      rideInput({ activityMovingTimeSec: 5689, powerZoneTimes: [350, 1444, 2303, 1037, 269, 85, 22] }) // sums to 5510
    );
    expect(p).toContain("Coasting/no-power 3% of ride time (179s)");
    // Z3 = 2303/5510 = 41.8% -> 42%, unchanged math — the fix is the added coasting clause, not a
    // different per-zone percentage.
    expect(p).toContain("Z3 42%");
  });

  it("omits the coasting clause when classified time already accounts for the full ride", () => {
    const p = buildRideAnalysisPrompt(rideInput({ activityMovingTimeSec: 4500, powerZoneTimes: [900, 1800, 1350, 450] }));
    expect(p).not.toContain("Coasting");
  });

  it("omits the coasting clause when the gap would round to 0% of ride time", () => {
    // 20s of 4500s rounds to 0%.
    const p = buildRideAnalysisPrompt(rideInput({ activityMovingTimeSec: 4520, powerZoneTimes: [900, 1800, 1350, 450] }));
    expect(p).not.toContain("Coasting");
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

  // Real 849-char note from a live self-directed ride (2026-08-11, activity i174624272). The old 400-char
  // cap cut it off mid-clause — "...I planned to think" — before the note ever reached the second effort
  // block ("2nd part roughly km 23 to km 29"), so the model judged the ride on half the athlete's stated
  // intent without knowing anything was missing.
  const realSelfDirectedNote =
    "Intent of the self planned ride\n\n2 main effort parts\n1st km 4 to km 14\n-mix of high gradient " +
    "shorter climbs and technical descents where the goal is to shift efficently, keep up speed and " +
    "alternate between seated and standing efforts while trying to control HR and not lose power when " +
    "switching between seated and standing. Doing standing efforts efficently was also a big goal and I " +
    "planned to think about my breathing when standing up to not raise my HR just because I stand up. " +
    "\n\n2nd part roughly  km 23 to km 29\n-Steady upper z4 effort on an 8% climb with some double digit " +
    "parts and very short flatter portions\n-The goal was to not overcook myself on the double digit " +
    "gradient parts and to try to keep power mostly the same on lower than average gradients so very much " +
    "practicing pacing on a not so steady climb.\n\nThen descent and z2 back home";

  it("does not truncate the real self-directed note — the second effort block must reach the model", () => {
    expect(realSelfDirectedNote.length).toBeGreaterThan(400); // would have been cut by the old cap
    expect(realSelfDirectedNote.length).toBeLessThan(ACTIVITY_NOTE_MAX_CHARS); // passes through whole
    const p = buildRideAnalysisPrompt(rideInput({ activityDescription: realSelfDirectedNote }));
    expect(p).toContain("2nd part roughly  km 23 to km 29");
    expect(p).toContain("Then descent and z2 back home");
    expect(p).not.toContain("[note truncated]");
  });

  it("truncates a note past ACTIVITY_NOTE_MAX_CHARS with an explicit marker, not a silent cut", () => {
    const long = "x".repeat(ACTIVITY_NOTE_MAX_CHARS + 200);
    const p = buildRideAnalysisPrompt(rideInput({ activityDescription: long }));
    expect(p).toContain("… [note truncated]");
    expect(p).not.toContain("x".repeat(ACTIVITY_NOTE_MAX_CHARS + 1)); // never emits the untruncated tail
  });

  it("leaves a short note untouched, with no marker", () => {
    const p = buildRideAnalysisPrompt(rideInput({ activityDescription: "Easy spin, legs felt flat." }));
    expect(p).toContain('Athlete note: "Easy spin, legs felt flat."');
    expect(p).not.toContain("[note truncated]");
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

  const userMessage = (weekTargets?: ReturnType<typeof computeWeekTargets>) =>
    buildUserMessage(blockParams, blockDates("2026-07-20", 4), "| table |", DEFAULT_BLOCK_SETTINGS, weekTargets);

  // P2b (2026-07-24 block-generation redesign): a live block undershot its own stated 10-12h range in
  // every non-recovery week — a range the model could satisfy anywhere inside. Replaced with one exact
  // figure per week from the deterministic skeleton (lib/block-skeleton.ts), computed from real
  // recovery-week placement, not a min-max prose rule.
  it("renders one exact hour figure per week from the computed skeleton, not a range", () => {
    const targets = computeWeekTargets(4, DEFAULT_BLOCK_SETTINGS, [3]); // week 4 (0-indexed 3) is recovery
    const p = userMessage(targets);
    expect(p).toContain("WEEK-BY-WEEK HOUR TARGETS");
    expect(p).toContain("Week 1 (LOADING): target 12h total");
    expect(p).toContain("Week 4 (RECOVERY): target 7.2h total"); // 60% of the 12h loading target
    expect(p).toMatch(/LENGTHEN the easy Z2 sessions/);
    expect(p).not.toMatch(/must total \d+–\d+ hours/); // no more min-max ranges for volume
  });

  it("falls back to the exact target and hard ceiling when no skeleton is supplied", () => {
    const p = userMessage(); // no weekTargets — e.g. a caller that hasn't computed one yet
    expect(p).toContain("no per-week targets supplied");
    expect(p).toContain("must total exactly 12 hours within the 12-hour hard ceiling");
  });

  it("sizes easy Z2 sessions to the per-week hour target instead of capping them at 60–90 min", () => {
    const targets = computeWeekTargets(4, DEFAULT_BLOCK_SETTINGS, []);
    const p = userMessage(targets);
    expect(p).not.toContain("(60–90 min each)"); // the old fixed cap that produced compact weeks
    expect(p).toContain("size them UP, typically 90–120 min, until the week's total hits its WEEK-BY-WEEK HOUR TARGET");
    // The rest-day clause still renders correctly after the structure-line rewrite.
    expect(p).toContain("+ 1 rest day per week");
  });

  // Phase B task 4: the per-day skeleton table supersedes the single weekly hour figure entirely —
  // when a skeleton is supplied it replaces WEEK-BY-WEEK HOUR TARGETS rather than sitting alongside it.
  it("renders the per-day skeleton table when a skeleton is supplied", () => {
    const targets = computeWeekTargets(2, DEFAULT_BLOCK_SETTINGS, [0]);
    const sk = computeBlockSkeleton("2026-08-03", targets, DEFAULT_BLOCK_SETTINGS, "anaerobic", []);
    const p = buildUserMessage(
      { lengthWeeks: 2, goal: "g", startDate: "2026-08-03", weakpoints: [] },
      [["2026-08-03"], ["2026-08-10"]],
      "",
      DEFAULT_BLOCK_SETTINGS,
      targets,
      sk
    );
    expect(p).toContain("WEEK SKELETON (FIXED");
    expect(p).toContain("2026-08-04");
    expect(p).not.toContain("WEEK-BY-WEEK HOUR TARGETS"); // superseded by the table
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
