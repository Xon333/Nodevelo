import {
  buildRetrospectivePrompt,
  buildRideAnalysisPrompt,
  buildStructuredRetrospectivePrompt,
  type ReflectionInterventionInput,
  type RetrospectiveInput,
  type RideAnalysisInput,
} from "../lib/anthropic-prompts";
import { RetrospectiveToolSchema } from "../lib/retrospective-schema";
import type {
  IndependentGroundingFacts,
  LanguageCallCategory,
} from "./fr6-language-experiment";

export const FR6_STRUCTURED_SCHEMA = RetrospectiveToolSchema;

type StructuredRetrospectiveInput = RetrospectiveInput & {
  interventions: ReflectionInterventionInput[];
};

interface Fr6CaseBase {
  id: string;
  category: LanguageCallCategory;
  prompt: string;
  maxOutputTokens: 450 | 380 | 700;
  grounding: IndependentGroundingFacts;
}

export type Fr6ExperimentCase =
  | (Fr6CaseBase & {
      category: "ride-analysis";
      input: RideAnalysisInput;
      maxOutputTokens: 450;
      schema: null;
    })
  | (Fr6CaseBase & {
      category: "prose-retrospective";
      input: RetrospectiveInput;
      maxOutputTokens: 380;
      schema: null;
    })
  | (Fr6CaseBase & {
      category: "structured-retrospective";
      input: StructuredRetrospectiveInput;
      maxOutputTokens: 700;
      schema: typeof RetrospectiveToolSchema;
    });

function rideCase(
  id: string,
  input: RideAnalysisInput,
  grounding: IndependentGroundingFacts,
): Fr6ExperimentCase {
  return {
    id,
    category: "ride-analysis",
    input,
    prompt: buildRideAnalysisPrompt(input),
    maxOutputTokens: 450,
    schema: null,
    grounding,
  };
}

function proseRetroCase(
  id: string,
  input: RetrospectiveInput,
  grounding: IndependentGroundingFacts,
): Fr6ExperimentCase {
  return {
    id,
    category: "prose-retrospective",
    input,
    prompt: buildRetrospectivePrompt(input),
    maxOutputTokens: 380,
    schema: null,
    grounding,
  };
}

function structuredRetroCase(
  id: string,
  input: StructuredRetrospectiveInput,
  grounding: IndependentGroundingFacts,
): Fr6ExperimentCase {
  return {
    id,
    category: "structured-retrospective",
    input,
    prompt: buildStructuredRetrospectivePrompt(input),
    maxOutputTokens: 700,
    schema: RetrospectiveToolSchema,
    grounding,
  };
}

const goodPrescribedRide: RideAnalysisInput = {
  activityDate: "2030-01-08",
  activityName: "Fictional Steady Tempo",
  activityType: "Ride",
  activityDurationMin: 90,
  activityMovingTimeSec: 5_400,
  activityAvgWatts: 210,
  activityNormalizedPower: 225,
  activityMaxWatts: null,
  activityAvgHr: 145,
  activityMaxHr: null,
  activityKj: null,
  activityTrainingLoad: 45,
  activityRpe: 8,
  activityDecoupling: null,
  activityDescription: "The fictional session felt controlled throughout.",
  intentContext: null,
  avgCadence: null,
  distanceMeters: null,
  elevationGain: null,
  powerZoneTimes: null,
  hrZoneTimes: null,
  intervalComparison: null,
  powerPRs: [],
  plannedName: "Fictional Tempo Session",
  plannedType: "Tempo",
  plannedDurationMin: 90,
  plannedWorkoutText: null,
  athleteFtp: 250,
  athleteThresholdHr: 170,
  fuelPromptContext: null,
  aerobicDiscipline: null,
  aerobicEffPct: null,
};

const poorPrescribedRide: RideAnalysisInput = {
  activityDate: "2030-01-10",
  activityName: "Fictional Shortened Threshold",
  activityType: "Ride",
  activityDurationMin: 40,
  activityMovingTimeSec: 2_400,
  activityAvgWatts: 180,
  activityNormalizedPower: 205,
  activityMaxWatts: null,
  activityAvgHr: 150,
  activityMaxHr: null,
  activityKj: null,
  activityTrainingLoad: 38,
  activityRpe: 3,
  activityDecoupling: null,
  activityDescription: "The fictional rider stopped early after fading in the work intervals.",
  intentContext: null,
  avgCadence: null,
  distanceMeters: null,
  elevationGain: null,
  powerZoneTimes: null,
  hrZoneTimes: null,
  intervalComparison: {
    prescribedLabels: ["3 x 10 min"],
    reps: [
      {
        targetWatts: 250,
        actualWatts: 205,
        durationSec: 300,
        targetDurationSec: 600,
        adherencePct: 82,
        durationPct: 50,
      },
    ],
    completed: 0,
    total: 3,
    avgAdherencePct: 82,
    avgDurationPct: 50,
    effectiveAdherencePct: 41,
    structuralMismatch: false,
    extras: [],
  },
  powerPRs: [],
  plannedName: "Fictional Threshold Session",
  plannedType: "Threshold",
  plannedDurationMin: 60,
  plannedWorkoutText: null,
  athleteFtp: 250,
  athleteThresholdHr: 170,
  fuelPromptContext: null,
  aerobicDiscipline: null,
  aerobicEffPct: null,
};

const selfDirectedRide: RideAnalysisInput = {
  activityDate: "2030-01-12",
  activityName: "Fictional Self-Directed Endurance",
  activityType: "Ride",
  activityDurationMin: 75,
  activityMovingTimeSec: 4_500,
  activityAvgWatts: 195,
  activityNormalizedPower: 210,
  activityMaxWatts: null,
  activityAvgHr: 142,
  activityMaxHr: null,
  activityKj: null,
  activityTrainingLoad: 52,
  activityRpe: 7,
  activityDecoupling: null,
  activityDescription: "A fictional unplanned endurance ride with a steady effort target.",
  intentContext:
    "DETERMINISTIC INTENT: self-directed; execution score 7/10; steady endurance target was supported by whole-ride evidence.",
  avgCadence: null,
  distanceMeters: null,
  elevationGain: null,
  powerZoneTimes: null,
  hrZoneTimes: null,
  intervalComparison: null,
  powerPRs: [],
  plannedName: null,
  plannedType: null,
  plannedDurationMin: null,
  plannedWorkoutText: null,
  athleteFtp: 250,
  athleteThresholdHr: 170,
  fuelPromptContext: null,
  aerobicDiscipline: null,
  aerobicEffPct: null,
};

const normalRetrospective: RetrospectiveInput = {
  goal: "Fictional Aerobic Foundation",
  lengthWeeks: 2,
  startDate: "2030-01-01",
  endDate: "2030-01-14",
  effectiveCloseoutDate: "2030-01-14",
  endedEarly: false,
  plannedHours: 12,
  actualHours: 11,
  overallCompliancePct: 92,
  ctlStart: 50,
  ctlEnd: 53,
  complianceByType: { Endurance: 95, Tempo: 88 },
  topSessions: [
    { date: "2030-01-08", name: "Fictional Steady Tempo", tss: 85 },
  ],
  avgDecoupling: 4.5,
  powerProfile: "",
};

const earlyRetrospective: RetrospectiveInput = {
  goal: "Fictional Interrupted Foundation",
  lengthWeeks: 2,
  startDate: "2030-02-01",
  endDate: "2030-02-14",
  effectiveCloseoutDate: "2030-02-03",
  endedEarly: true,
  plannedHours: 2,
  actualHours: 1.5,
  overallCompliancePct: 75,
  ctlStart: 50,
  ctlEnd: 50,
  complianceByType: { Endurance: 50 },
  topSessions: [],
  avgDecoupling: null,
  powerProfile: "",
};

const structuredRetrospective: StructuredRetrospectiveInput = {
  goal: "Fictional Mixed Hypotheses",
  lengthWeeks: 2,
  startDate: "2030-03-01",
  endDate: "2030-03-14",
  effectiveCloseoutDate: "2030-03-14",
  endedEarly: false,
  plannedHours: 10,
  actualHours: 9,
  overallCompliancePct: 90,
  ctlStart: 50,
  ctlEnd: 52,
  complianceByType: { Endurance: 90 },
  topSessions: [],
  avgDecoupling: null,
  powerProfile: "",
  interventions: [
    {
      dimension: "Threshold",
      severity: "watch",
      title: "Fictional threshold execution hypothesis",
      physMetric: "threshold power",
      baselineExecEwma: 5,
      baselinePhys: 250,
      outcome: {
        execNow: 6,
        physNow: 255,
        execDelta: 1,
        physDelta: 5,
        verdict: "validated",
      },
    },
    {
      dimension: "VO2max",
      severity: "alert",
      title: "Fictional high-intensity tolerance hypothesis",
      physMetric: "repeat completion",
      baselineExecEwma: 6,
      baselinePhys: 10,
      outcome: {
        execNow: 5,
        physNow: 9,
        execDelta: -1,
        physDelta: -1,
        verdict: "refuted",
      },
    },
    {
      dimension: "Endurance",
      severity: "good",
      title: "Fictional durability hypothesis",
      physMetric: "aerobic drift",
      baselineExecEwma: 5,
      baselinePhys: null,
      outcome: {
        execNow: 5,
        physNow: null,
        execDelta: 0,
        physDelta: null,
        verdict: "inconclusive",
      },
    },
  ],
};

export const FR6_CASES: Fr6ExperimentCase[] = [
  rideCase("ride-prescribed-good", goodPrescribedRide, {
    allowedDates: ["2030-01-08"],
    allowedNumericTokens: [
      "250W",
      "225W",
      "210W",
      "90 min",
      "45 TSS",
      "8/10",
      "145 bpm",
      "170 bpm",
      "90%",
    ],
    forbiddenClaims: [
      "FTP increased",
      "adaptation confirmed",
      "missed interval",
    ],
  }),
  rideCase("ride-prescribed-poor", poorPrescribedRide, {
    allowedDates: ["2030-01-10"],
    allowedNumericTokens: [
      "250W",
      "205W",
      "180W",
      "60 min",
      "40 min",
      "5 min",
      "10 min",
      "38 TSS",
      "3/10",
      "82%",
      "50%",
      "150 bpm",
      "170 bpm",
    ],
    forbiddenClaims: ["textbook", "fully completed", "fitness increased"],
  }),
  rideCase("ride-self-directed", selfDirectedRide, {
    allowedDates: ["2030-01-12"],
    allowedNumericTokens: [
      "250W",
      "210W",
      "195W",
      "75 min",
      "52 TSS",
      "7/10",
      "142 bpm",
      "170 bpm",
      "84%",
    ],
    forbiddenClaims: [
      "prescribed session",
      "100% compliance",
      "technique confirmed",
    ],
  }),
  proseRetroCase("retro-normal", normalRetrospective, {
    allowedDates: ["2030-01-01", "2030-01-08", "2030-01-14"],
    allowedNumericTokens: [
      "12h",
      "11h",
      "92%",
      "95%",
      "88%",
      "50 CTL",
      "53 CTL",
      "85 TSS",
      "4.5%",
    ],
    forbiddenClaims: ["ended early", "future session", "FTP increased"],
  }),
  proseRetroCase("retro-early", earlyRetrospective, {
    allowedDates: ["2030-02-01", "2030-02-03", "2030-02-14"],
    allowedNumericTokens: [
      "2h",
      "1.5h",
      "75%",
      "50%",
      "50 CTL",
    ],
    forbiddenClaims: [
      "two-week failure",
      "missed after 2030-02-03",
      "FTP increased",
    ],
  }),
  structuredRetroCase("structured-mixed-verdicts", structuredRetrospective, {
    allowedDates: ["2030-03-01", "2030-03-14"],
    allowedNumericTokens: [
      "10h",
      "9h",
      "90%",
      "execution 5",
      "execution 6",
      "baseline 5",
      "baseline 6",
      "baseline 10",
      "baseline 250",
      "250W",
      "255W",
    ],
    forbiddenClaims: ["injury", "FTP increased", "medication"],
  }),
];
