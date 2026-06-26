import { describe, expect, it } from "vitest";
import {
  buildRideAnalysisPrompt,
  buildRetrospectivePrompt,
  buildStructuredRetrospectivePrompt,
  type ReflectionInterventionInput,
  type RetrospectiveInput,
  type RideAnalysisInput,
} from "./anthropic-prompts";
import type { IntervalComparison } from "./types";

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
