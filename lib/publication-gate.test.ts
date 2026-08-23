import { describe, expect, it } from "vitest";
import { canonical, evaluatePublicationGate, verdictHash, type PublicationGateArgs } from "./publication-gate";
import { DEFAULT_BLOCK_SETTINGS, type BlockSettings, type PlannedDay, type SeasonPlan, type WorkoutType } from "./types";
import { computeBlockSkeleton, computeWeekTargets } from "./block-skeleton";
import { deriveSessionRequirements } from "./session-requirements";

// One clean 7-day block fixture (contiguous 2026-06-01..07, exactly 210 min against a 3.5h target,
// every validator silent) that the structural and bucketing tests mutate one dimension at a time.
function day(date: string, type: WorkoutType, over: Partial<PlannedDay> = {}): PlannedDay {
  return {
    date,
    weekNumber: 1,
    weekTheme: "test",
    name: `${type} session`,
    type,
    durationMin: 60,
    workoutText: "",
    description: "x",
    ...over,
  };
}

const CLEAN_DAYS: PlannedDay[] = [
  day("2026-06-01", "Rest", { durationMin: 0 }),
  // Freshness-priority quality BEFORE the fatigue-tolerant Threshold — correct sequencing.
  day("2026-06-02", "VO2max", { durationMin: 32, workoutText: "Main Set 4x\n- 4m 110%\n- 4m 50%" }),
  day("2026-06-03", "Z2", { durationMin: 30, workoutText: "- 30m 65%" }),
  day("2026-06-04", "Recovery", { durationMin: 20, workoutText: "- 20m 55%" }),
  day("2026-06-05", "Z2", { durationMin: 38, workoutText: "- 38m 65%" }),
  day("2026-06-06", "Threshold", { durationMin: 60, workoutText: "- 60m 95%" }),
  day("2026-06-07", "Z2", { durationMin: 30, workoutText: "- 30m 60%" }), // 210 total
];

// A deliberately permissive skeleton (wide envelopes, everything allowed everywhere): lets each
// test isolate ONE validator's finding instead of fighting conformance noise from a real skeleton.
const LOOSE_SKELETON = {
  focus: "threshold" as const,
  weeks: [
    {
      weekNumber: 1,
      isRecovery: false,
      targetHours: 3.5,
      qualityBudget: 2,
      days: CLEAN_DAYS.map((d) => ({
        date: d.date,
        kind: "easy" as const,
        allowedTypes: ["Rest", "Z2", "Recovery", "Threshold", "VO2max", "SIT", "RaceSim"] as WorkoutType[],
        duration: { nominalMin: d.durationMin, minMin: 0, maxMin: 24 * 60 },
        maxIntensityPct: null,
        locked: false,
        reason: "test slot",
      })),
    },
  ],
};

function baseArgs(over: Partial<PublicationGateArgs> = {}): PublicationGateArgs {
  return {
    days: CLEAN_DAYS.map((d) => ({ ...d })),
    truncated: false,
    expectedDayCount: CLEAN_DAYS.length,
    ftp: 250,
    envelope: { embeddedHardPct: 88, maxIntensityPct: 122, maxEffortMin: 20 },
    blockSettings: DEFAULT_BLOCK_SETTINGS,
    weekTargets: [{ weekNumber: 1, isRecovery: false, targetHours: 3.5 }],
    blockSkeleton: LOOSE_SKELETON,
    events: [],
    requirements: deriveSessionRequirements("general aerobic fitness", []),
    seasonContext: null,
    ...over,
  };
}

describe("evaluatePublicationGate — structural checks", () => {
  it("passes a contiguous, correct-length, untruncated fixture with zero findings anywhere", () => {
    expect(evaluatePublicationGate(baseArgs())).toEqual({ blockers: [], preferences: [], advisories: [] });
  });

  it("blocks on a day-count mismatch", () => {
    const { blockers } = evaluatePublicationGate(baseArgs({ expectedDayCount: CLEAN_DAYS.length - 1 }));
    expect(blockers.some((m) => /STRUCTURE/.test(m) && /Expected 6 days.*7\b/.test(m))).toBe(true);
  });

  it("blocks a truncated response", () => {
    const { blockers } = evaluatePublicationGate(baseArgs({ truncated: true }));
    expect(blockers.some((m) => /STRUCTURE/.test(m) && /token limit/.test(m))).toBe(true);
  });

  it("blocks duplicate dates", () => {
    const days = CLEAN_DAYS.map((d) => ({ ...d }));
    days[1].date = days[0].date;
    const { blockers } = evaluatePublicationGate(baseArgs({ days }));
    expect(blockers.some((m) => /STRUCTURE/.test(m) && /[Dd]uplicate/.test(m) && m.includes("2026-06-01"))).toBe(true);
  });

  it("blocks a non-contiguous date sequence (gap)", () => {
    const days = CLEAN_DAYS.map((d) => ({ ...d }));
    days[3].date = "2026-06-09"; // removes 06-04..06-08 → sorted step of 5 days somewhere
    const { blockers } = evaluatePublicationGate(baseArgs({ days }));
    expect(blockers.some((m) => /STRUCTURE/.test(m) && /not contiguous/.test(m))).toBe(true);
  });
});

describe("evaluatePublicationGate — validator bucketing (each emitter's sample lands in its bucket)", () => {
  it("buckets validateSchedule.spacing as a BLOCKER at the default budget (<=2)", () => {
    const days = [
      day("2026-06-01", "Threshold", { workoutText: "- 60m 95%" }),
      day("2026-06-02", "VO2max", { workoutText: "- 32m 110%", durationMin: 32 }),
    ];
    const { blockers, preferences } = evaluatePublicationGate(
      baseArgs({ days, expectedDayCount: 2, blockSkeleton: { focus: "threshold", weeks: [] }, weekTargets: [] })
    );
    expect(blockers.some((m) => /back-to-back hard days/.test(m))).toBe(true);
    expect(preferences.some((m) => /back-to-back hard days/.test(m))).toBe(false);
  });

  it("flips the back-to-back finding to a PREFERENCE exactly at qualitySessionsPerLoadingWeek >= 3", () => {
    const args = (): PublicationGateArgs =>
      baseArgs({
        days: [
          day("2026-06-01", "Threshold", { workoutText: "- 60m 95%" }),
          day("2026-06-02", "VO2max", { workoutText: "- 32m 110%", durationMin: 32 }),
        ],
        expectedDayCount: 2,
        blockSkeleton: { focus: "threshold", weeks: [] },
        weekTargets: [],
      });
    const atThree = evaluatePublicationGate({ ...args(), blockSettings: { ...DEFAULT_BLOCK_SETTINGS, qualitySessionsPerLoadingWeek: 3 } });
    expect(atThree.preferences.some((m) => /back-to-back hard days/.test(m))).toBe(true);
    expect(atThree.blockers.some((m) => /back-to-back hard days/.test(m))).toBe(false);

    // Not below 3: budget 2 keeps the finding a hard blocker (covered above), and budget 4 stays
    // on the preference side — the flip is a one-way degradation at >=3, never a re-escalation.
    const atFour = evaluatePublicationGate({ ...args(), blockSettings: { ...DEFAULT_BLOCK_SETTINGS, qualitySessionsPerLoadingWeek: 4 } });
    expect(atFour.preferences.some((m) => /back-to-back hard days/.test(m))).toBe(true);
    expect(atFour.blockers.some((m) => /back-to-back hard days/.test(m))).toBe(false);
  });

  it("buckets the loading-week quality BUDGET finding as a blocker (even at budget >= 3)", () => {
    // Four non-adjacent quality days in one loading week, budget raised to 3: spacing silent,
    // budget tripped — proving the >=3 adjacency exception degrades SPACING only, never budget.
    const days = [
      day("2026-06-01", "Threshold", { workoutText: "- 60m 95%" }),
      day("2026-06-03", "VO2max", { workoutText: "- 32m 110%", durationMin: 32 }),
      day("2026-06-05", "SIT", { workoutText: "Main Set 5x\n- 30s 150%\n- 4m 40%", durationMin: 22 }),
      day("2026-06-07", "RaceSim", { workoutText: "- 60m 85%" }),
    ];
    const { blockers } = evaluatePublicationGate(
      baseArgs({
        days,
        expectedDayCount: 4,
        blockSettings: { ...DEFAULT_BLOCK_SETTINGS, qualitySessionsPerLoadingWeek: 3 },
        weekTargets: [{ weekNumber: 1, isRecovery: false, targetHours: 12 }],
        blockSkeleton: { focus: "threshold", weeks: [] },
      })
    );
    expect(blockers.some((m) => /over the 3\/week budget for a loading week/.test(m))).toBe(true);
    expect(blockers.some((m) => /back-to-back hard days/.test(m))).toBe(false);
  });

  it("buckets validateEventTaper findings as blockers", () => {
    const days = [
      day("2026-06-03", "RaceSim", { workoutText: "- 60m 85%" }),
      day("2026-06-04", "Rest", { durationMin: 0 }),
    ];
    const { blockers } = evaluatePublicationGate(
      baseArgs({
        days,
        expectedDayCount: 2,
        events: [{ name: "KOM attempt", date: "2026-06-04", priority: "B" }],
        blockSkeleton: { focus: "threshold", weeks: [] },
        weekTargets: [],
      })
    );
    expect(blockers.some((m) => /EVENT TAPER/.test(m))).toBe(true);
  });

  it("buckets validateWeekHours findings as blockers", () => {
    const days = [day("2026-06-01", "Z2", { workoutText: "- 60m 65%" })];
    const { blockers } = evaluatePublicationGate(
      baseArgs({
        days,
        expectedDayCount: 1,
        weekTargets: [{ weekNumber: 1, isRecovery: false, targetHours: 12 }],
        blockSkeleton: { focus: "threshold", weeks: [] },
      })
    );
    expect(blockers.some((m) => /HOURS: week 1/.test(m))).toBe(true);
  });

  it("buckets validateSkeletonConformance findings as blockers", () => {
    // A REAL skeleton, one day dropped: the missing-day branch must land in blockers.
    const skel = () =>
      computeBlockSkeleton("2026-08-03", computeWeekTargets(1, DEFAULT_BLOCK_SETTINGS, []), DEFAULT_BLOCK_SETTINGS, "anaerobic", []);
    const fromSkeleton = skel().weeks[0].days.map((s) =>
      day(s.date, s.allowedTypes[0], { durationMin: s.duration.nominalMin, workoutText: "- 10m 60%" })
    );
    const days = fromSkeleton.filter((d) => d.date !== "2026-08-06");
    const { blockers } = evaluatePublicationGate(baseArgs({ days, expectedDayCount: days.length, blockSkeleton: skel() }));
    expect(blockers.some((m) => /SKELETON/.test(m) && m.includes("2026-08-06"))).toBe(true);
  });

  it("buckets validateRecoveryWeekDensity findings as blockers", () => {
    const days = [
      day("2026-06-05", "Z2", { workoutText: "- 105m 65%\nMain Set 2x\n- 10m 95%\n- 5m 55%", durationMin: 125 }),
    ];
    const { blockers } = evaluatePublicationGate(
      baseArgs({
        days,
        expectedDayCount: 1,
        weekTargets: [{ weekNumber: 1, isRecovery: true, targetHours: 7.2 }],
        blockSkeleton: { focus: "threshold", weeks: [] },
      })
    );
    expect(blockers.some((m) => /RECOVERY DENSITY/.test(m) && /embedded/i.test(m))).toBe(true);
  });

  it("buckets validateWeekSequencing findings as blockers", () => {
    const days = [
      day("2026-06-01", "Threshold", { workoutText: "- 60m 95%" }),
      day("2026-06-03", "SIT", { workoutText: "Main Set 5x\n- 30s 150%\n- 4m 40%", durationMin: 22 }),
    ];
    const { blockers } = evaluatePublicationGate(baseArgs({ days, expectedDayCount: 2, blockSkeleton: { focus: "threshold", weeks: [] } }));
    expect(blockers.some((m) => /SEQUENCING: week 1/.test(m))).toBe(true);
  });

  it("buckets protocol VIOLATIONS as blockers", () => {
    const days = [day("2026-06-01", "SIT", { workoutText: "Main Set 5x\n- 1m 150%\n- 4m 40%", durationMin: 25 })];
    const { blockers, advisories } = evaluatePublicationGate(baseArgs({ days, expectedDayCount: 1, blockSkeleton: { focus: "threshold", weeks: [] } }));
    expect(blockers.some((m) => /longer than protocol/.test(m))).toBe(true);
    expect(advisories).toEqual([]);
  });

  it("buckets embedded-intensity HAZARDS as blockers", () => {
    const days = [day("2026-06-01", "Z2", { workoutText: "- 5m 140%", durationMin: 5 })];
    const { blockers } = evaluatePublicationGate(baseArgs({ days, expectedDayCount: 1, blockSkeleton: { focus: "threshold", weeks: [] } }));
    expect(blockers.some((m) => /exceeds the 122% ceiling/.test(m))).toBe(true);
  });

  it("returns protocol ADVISORIES (duration consistency) as informational — never blockers/preferences", () => {
    const days = [day("2026-06-01", "Z2", { workoutText: "- 5m 140%", durationMin: 90 })];
    const { blockers, preferences, advisories } = evaluatePublicationGate(
      baseArgs({ days, expectedDayCount: 1, blockSkeleton: { focus: "threshold", weeks: [] } })
    );
    expect(advisories.some((m) => /stated 90min/.test(m))).toBe(true);
    expect(blockers.some((m) => /stated 90min/.test(m))).toBe(false);
    expect(preferences.some((m) => /stated 90min/.test(m))).toBe(false);
  });

  it("buckets validateSessionRequirements findings as preferences", () => {
    const { preferences, blockers } = evaluatePublicationGate(
      baseArgs({
        days: [day("2026-06-01", "Threshold", { workoutText: "- 60m 95%" })],
        expectedDayCount: 1,
        weekTargets: [], // keep the hours validator out of this bucketing test
        requirements: deriveSessionRequirements("hilly road race prep", []),
        blockSkeleton: { focus: "threshold", weeks: [] },
      })
    );
    expect(preferences.some((m) => /GOAL:.*no RaceSim/.test(m))).toBe(true);
    expect(blockers).toEqual([]);
  });
});

describe("evaluatePublicationGate — season branches respect the mode flag", () => {
  // An 8-day window inside a vo2max/base season period, hard days separated by rest so nothing
  // else fires: enough to trip BOTH event-anchored validators (hard-share fit + focus-label match).
  const hardSpaced = (): PlannedDay[] =>
    ["01", "03", "05", "07"].map((d) => day(`2026-06-${d}`, "Threshold", { workoutText: "- 60m 95%" }));

  const seasonPlan: SeasonPlan = {
    objective: "test",
    events: [],
    updatedAt: new Date(0).toISOString(),
    periods: [
      {
        focus: "vo2max",
        phase: "base",
        startDate: "2026-05-25",
        plannedWeeks: 4,
        intensitySplit: "80/20",
        targetWeeklyTss: null,
        deloadWeek: false,
        rationale: "r",
        source: "derived",
        confidence: "high",
      },
    ],
  };

  const seasonArgs = (over: Partial<PublicationGateArgs>): PublicationGateArgs =>
    baseArgs({
      days: hardSpaced(),
      expectedDayCount: hardSpaced().length,
      blockSkeleton: { focus: "threshold", weeks: [] },
      weekTargets: [],
      ...over,
    });

  it("event-anchored mode runs validateSeasonFit/validateFocusMatch into preferences", () => {
    const { preferences, blockers } = evaluatePublicationGate(seasonArgs({ seasonContext: { mode: "event-anchored", plan: seasonPlan } }));
    expect(preferences.some((m) => /sits in a .* period \(80\/20\)/.test(m) && /expected mostly Z2/.test(m))).toBe(true);
    expect(preferences.some((m) => /sits in a vo2max period but carries zero VO2max sessions/.test(m))).toBe(true);
    expect(blockers.some((m) => /^Season fit:/.test(m))).toBe(false);
    // The rolling validators did NOT run in event-anchored mode.
    expect(preferences.some((m) => /PRIMARY QUALITY|this block's focus is/.test(m))).toBe(false);
  });

  it("rolling mode runs validateBlockFocus/validatePrimaryQualityCadence into preferences", () => {
    const { preferences, blockers } = evaluatePublicationGate(
      seasonArgs({
        seasonContext: { mode: "rolling", focus: "vo2max" },
        weekTargets: [{ weekNumber: 1, isRecovery: false, targetHours: 12 }],
      })
    );
    // Rolling validators also use the "Season fit:" prefix — distinguished by their OWN wording.
    expect(preferences.some((m) => /this block's focus is vo2max but carries zero VO2max sessions/.test(m))).toBe(true);
    expect(preferences.some((m) => /PRIMARY QUALITY: week 1/.test(m))).toBe(true);
    expect(blockers.some((m) => /PRIMARY QUALITY|zero VO2max/.test(m))).toBe(false);
    // The event-anchored validators (period-bucketed wording) did NOT run in rolling mode.
    expect(preferences.some((m) => /sits in a .* period/.test(m))).toBe(false);
  });

  it("null seasonContext skips the season family entirely", () => {
    const { preferences } = evaluatePublicationGate(seasonArgs({ seasonContext: null }));
    expect(preferences).toEqual([]);
  });
});

describe("canonical + verdictHash", () => {
  function reverseKeyOrder(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reverseKeyOrder);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .reverse()
          .map(([k, v]) => [k, reverseKeyOrder(v)])
      );
    }
    return value;
  }

  it("sorts object keys recursively so key order cannot change the string", () => {
    const a = { b: 1, a: [{ y: 2, x: 3 }], c: { z: null, w: "s" } };
    expect(canonical(a)).toBe(canonical(reverseKeyOrder(a)));
    // Arrays keep their order — order is meaningful for days.
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });

  it("verdictHash is stable across client-style key reordering and sensitive to content drift", () => {
    const days = CLEAN_DAYS;
    const blockParams = { lengthWeeks: 2, goal: "fitness", weakpoints: [], startDate: "2026-06-01" };
    expect(verdictHash(days, blockParams)).toBe(verdictHash(reverseKeyOrder(days) as PlannedDay[], reverseKeyOrder(blockParams)));
    const tampered = days.map((d, i) => (i === 2 ? { ...d, durationMin: d.durationMin + 10 } : d));
    expect(verdictHash(tampered, blockParams)).not.toBe(verdictHash(days, blockParams));
  });

  it("accepts arbitrary BlockSettings-shaped input too (typed convenience only)", () => {
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS };
    expect(typeof canonical(settings)).toBe("string");
  });
});
