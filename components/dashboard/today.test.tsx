// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EatToday, EnergyAvailabilityTile, NutritionTrendWarningBanner, PlanEaWarningBanner, PlannedToday, TodayRideCard } from "./today";
import type { NeatImbalanceContext, NutritionTrendWarning } from "@/lib/nutrition";
import type { CurrentBlock, NoBlockSummary, SyncData, TodayAnalysis } from "@/lib/types";

afterEach(() => {
  cleanup();
});

describe("NutritionTrendWarningBanner", () => {
  const warning: NutritionTrendWarning = {
    observedKgPerWeek: 0.3,
    intendedKgPerWeek: 0.15,
    adherenceRatio: 1,
    weighIns: 21,
    loggedDays: 21,
  };

  it("renders the accessible evidence panel", () => {
    render(<NutritionTrendWarningBanner warning={warning} />);

    const heading = screen.getByRole("heading", { name: "Weight trend needs attention" });
    expect(screen.getByRole("region", { name: heading.textContent! })).toBeTruthy();
    expect(screen.getByText("Observed +0.30 kg/week vs intended +0.15 kg/week", { exact: false })).toBeTruthy();
    expect(screen.getByText("estimated prescription adherence 100%", { exact: false })).toBeTruthy();
    expect(screen.getByText("21 logged days, 21 weigh-ins", { exact: false })).toBeTruthy();
    expect(screen.getByText("Calories are unchanged while maintenance calibration gathers stronger evidence.")).toBeTruthy();
  });

  it("withholds absent evidence", () => {
    const { container } = render(<NutritionTrendWarningBanner warning={null} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("PlanEaWarningBanner", () => {
  it("renders when the level is low", () => {
    render(<PlanEaWarningBanner level="low" kcalPerKg={27.2} />);

    const heading = screen.getByRole("heading", { name: "Today's target is low-energy-availability" });
    expect(screen.getByRole("region", { name: heading.textContent! })).toBeTruthy();
    expect(screen.getByText("27 kcal/kg", { exact: false })).toBeTruthy();
    expect(screen.getByText("informational only, calories are unchanged", { exact: false })).toBeTruthy();
  });

  it("withholds when the level is adequate or ample", () => {
    const { container: c1 } = render(<PlanEaWarningBanner level="adequate" kcalPerKg={32} />);
    expect(c1.firstChild).toBeNull();
    cleanup();
    const { container: c2 } = render(<PlanEaWarningBanner level="ample" kcalPerKg={45} />);
    expect(c2.firstChild).toBeNull();
  });

  it("withholds when level is null (legacy model, no RMR to compute from)", () => {
    const { container } = render(<PlanEaWarningBanner level={null} kcalPerKg={null} />);
    expect(container.firstChild).toBeNull();
  });
});

// Review task 2.1: the sync route now tags neatImbalance with which day-type split it came from
// (resolveNeatImbalance, lib/nutrition.ts) so the Today card's copy is never ambiguous about which
// number it's showing once a rest/train split exists — this is the render half of that fix.
describe("EnergyAvailabilityTile — neatImbalance day-type labelling", () => {
  const sync: SyncData = {
    syncedAt: "2026-06-22T00:00:00.000Z",
    activities: [],
    wellness: [],
    powerCurve: [],
    fitness: { ctl: 0, atl: 0, tsb: 0 },
  };
  // A truthy nutritionModel is enough to clear the tile's own early-return guard regardless of
  // whether ea/streak resolve from the (empty) sync fixture above — irrelevant to what's under test.
  const nutritionModel = {
    kind: "legacy" as const,
    baseCalories: 2000,
    restDayTarget: 2600,
    weightKg: 75,
    targetWeightKg: 75,
    buffer: 0,
  };
  const mkImbalance = (dayType: NeatImbalanceContext["dayType"]): NeatImbalanceContext => ({
    dayType,
    finding: {
      direction: "intake-above-model",
      estimatedKcalPerDay: 60,
      candidates: ["food-log under-reporting", "RMR-equation error"],
      note: "test finding",
    },
  });

  it("labels a rest-split finding as rest-day-specific", () => {
    render(<EnergyAvailabilityTile sync={sync} nutritionModel={nutritionModel} neatImbalance={mkImbalance("rest")} />);
    expect(screen.getByText("Rest-day", { exact: false })).toBeTruthy();
    expect(screen.getByText(/60 kcal\/day/)).toBeTruthy();
  });

  it("labels a train-split finding as training-day-specific", () => {
    render(<EnergyAvailabilityTile sync={sync} nutritionModel={nutritionModel} neatImbalance={mkImbalance("train")} />);
    expect(screen.getByText("Training-day", { exact: false })).toBeTruthy();
  });

  it("shows no day-type label for the pooled (pre-split) fallback — unchanged prior copy", () => {
    render(<EnergyAvailabilityTile sync={sync} nutritionModel={nutritionModel} neatImbalance={mkImbalance(null)} />);
    expect(screen.queryByText("Rest-day", { exact: false })).toBeNull();
    expect(screen.queryByText("Training-day", { exact: false })).toBeNull();
    expect(screen.getByText(/60 kcal\/day/)).toBeTruthy();
  });
});

describe("EatToday breakdown", () => {
  // A today-analysis.json written before advisedIntakeParts existed is still on disk and still read
  // back all day, so the render has to normalise rather than trust the stored figures. These are this
  // athlete's real persisted values from 2026-08-06.
  const stored = {
    advisedIntakeKcal: 3550,
    advisedBaseKcal: 2202.5119212962964,
    advisedBufferKcal: 60,
    advisedRideFuelKcal: 1283.4880787037036,
    fuelPrompt: null,
  } as unknown as TodayAnalysis;

  it("renders a legacy fractional record as whole kcal that sum to the headline", () => {
    render(<EatToday analysis={stored} />);
    expect(screen.getByText("3,550 kcal")).toBeTruthy();
    // 2,207 + 1,283 + 60 = 3,550. Base carries the ≤5 kcal residual of dailyTarget's round-to-10.
    expect(screen.getByText("2,207 base + 1,283 ride + 60 buffer")).toBeTruthy();
    expect(screen.queryByText(/\d\.\d/)).toBeNull(); // no decimals anywhere in the card
  });

  it("omits a zero ride/buffer term rather than printing '+ 0'", () => {
    render(
      <EatToday
        analysis={{ ...stored, advisedRideFuelKcal: 0, advisedBufferKcal: 0 } as unknown as TodayAnalysis}
      />
    );
    expect(screen.getByText("3,550 base")).toBeTruthy();
  });
});

// The Today page prints a ride's energy cost twice on two different bases (gross in the debrief
// header, net in Eat today). Unlabelled, that reads as the app contradicting itself — and as it
// contradicting Wahoo/Strava/Intervals, which all report gross. Both need the explanation attached.
describe("net-vs-gross ride burn tooltips", () => {
  const withRide = {
    advisedIntakeKcal: 3550,
    advisedBaseKcal: 2207,
    advisedBufferKcal: 60,
    advisedRideFuelKcal: 1283,
    fuelPrompt: null,
  } as unknown as TodayAnalysis;

  it("explains the net ride figure, and wires the tip to its trigger for assistive tech", () => {
    render(<EatToday analysis={withRide} />);
    const trigger = screen.getByLabelText("Explain this metric");
    const tip = screen.getByRole("tooltip");
    expect(trigger.getAttribute("aria-describedby")).toBe(tip.id);
    expect(tip.textContent).toContain("above resting metabolism");
    expect(tip.textContent).toContain("Strava");
  });

  // A rest day has no ride term in the breakdown, so there is nothing to reconcile against the
  // other apps — the tip would be explaining a number that isn't on screen.
  it("omits the tip when there is no ride term", () => {
    render(<EatToday analysis={{ ...withRide, advisedRideFuelKcal: 0 } as unknown as TodayAnalysis} />);
    expect(screen.queryByLabelText("Explain this metric")).toBeNull();
  });
});

// The header used to print activityKj (mechanical work, kJ) under a "kcal" label. It now prints the
// resolved gross burn — with a fallback for today-analysis.json records written before that field.
describe("TodayRideCard gross-burn header", () => {
  const analysis = (over: Record<string, unknown>) =>
    ({
      activityDate: "2026-08-06",
      activityName: "Cycling",
      activityDurationMin: 118,
      activityAvgHr: 147,
      executionScore: null,
      powerPRs: [],
      ...over,
    }) as unknown as TodayAnalysis;

  it("shows the resolved kcal figure, not the kJ one", () => {
    render(<TodayRideCard analysis={analysis({ activityKj: 1421, activityBurnKcal: 1417 })} />);
    expect(screen.getByText("1,417 kcal", { exact: false })).toBeTruthy();
    expect(screen.queryByText("1421 kcal", { exact: false })).toBeNull();
  });

  // A record written before activityBurnKcal existed parses the key back as absent. Falling back to
  // activityKj mirrors activeBurn's own legacy branch, so old records read exactly as they did.
  it("falls back to activityKj on a pre-migration record", () => {
    render(<TodayRideCard analysis={analysis({ activityKj: 1421 })} />);
    expect(screen.getByText("1,421 kcal", { exact: false })).toBeTruthy();
  });

  // `??`, not `||` — a genuine zero-cost activity must render "0 kcal", not fall through to kj.
  it("renders a real zero burn rather than falling through", () => {
    render(<TodayRideCard analysis={analysis({ activityKj: 1421, activityBurnKcal: 0 })} />);
    expect(screen.getByText("0 kcal", { exact: false })).toBeTruthy();
  });
});

describe("TodayRideCard overlay-resolved score", () => {
  const baseAnalysis = {
    activityDate: "2026-08-11",
    activityName: "Ride",
    activityDurationMin: 90,
    activityDecoupling: null,
    executionScore: 2,
    coachNote: null,
    powerPRs: [],
  } as unknown as TodayAnalysis;

  const activeOverlay = {
    id: "ov-1", activityId: "a1", date: baseAnalysis.activityDate, noteFingerprint: "fp",
    status: "active" as const, origin: "self-directed" as const, effectiveExecutionScore: 8,
    notScoredReason: null,
    interpretation: { intent: { primaryPurpose: "endurance", phases: [] }, confidence: "high" as const, objectives: [], model: "m", promptVersion: 1 },
    scoringVersion: 1, schemaVersion: 1, createdAt: "2026-08-11T00:00:00.000Z",
    approvedAt: null, supersededBy: null,
  };

  it("shows the effective (overlay) score instead of the analysis's own score once an overlay applies", () => {
    render(
      <TodayRideCard
        analysis={{ ...baseAnalysis, executionScore: 2 }}
        outcome={{ effectiveExecutionScore: 8, origin: "self-directed", source: "overlay", overlay: activeOverlay }}
      />
    );
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.queryByText("2")).toBeNull();
  });

  it("suppresses the score entirely when the overlay says Not scored", () => {
    render(
      <TodayRideCard
        analysis={{ ...baseAnalysis, executionScore: 2 }}
        outcome={{
          effectiveExecutionScore: null,
          origin: "unspecified",
          source: "overlay",
          overlay: {
            ...activeOverlay,
            origin: "unspecified",
            effectiveExecutionScore: null,
            notScoredReason: "intent-unreliable",
            interpretation: { ...activeOverlay.interpretation, confidence: "low" },
            scoringVersion: null,
          },
        }}
      />
    );
    expect(screen.queryByText("2")).toBeNull();
    expect(screen.getByText("Not scored — intent could not be determined reliably")).toBeTruthy();
  });

  it("renders exactly as before when outcome is null (backward compatible)", () => {
    render(<TodayRideCard analysis={{ ...baseAnalysis, executionScore: 5 }} outcome={null} />);
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("keeps the analysis's own score when a ledger outcome resolved but NO overlay applies — the actual bug this guards", () => {
    render(
      <TodayRideCard
        analysis={{ ...baseAnalysis, executionScore: 7 }}
        outcome={{ effectiveExecutionScore: 3, origin: "prescribed", source: "ledger", overlay: null }}
      />
    );
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.queryByText("3")).toBeNull();
  });

  it("keeps the Post-to-Intervals.icu button visible for a Not-scored ride", () => {
    render(
      <TodayRideCard
        analysis={{ ...baseAnalysis, executionScore: 2, coachNote: "Good effort out there." }}
        outcome={{
          effectiveExecutionScore: null,
          origin: "unspecified",
          source: "overlay",
          overlay: {
            ...activeOverlay,
            origin: "unspecified",
            effectiveExecutionScore: null,
            notScoredReason: "intent-unreliable",
            interpretation: { ...activeOverlay.interpretation, confidence: "low" },
            scoringVersion: null,
          },
        }}
        onPostNote={() => {}}
      />
    );
    expect(screen.queryByText("2")).toBeNull();
    expect(screen.getByTitle("Post coach note to Intervals.icu")).toBeTruthy();
  });
});

describe("PlannedToday — Phase 3a no-block summary", () => {
  const mkBlock = (over: Partial<CurrentBlock> = {}): CurrentBlock => ({
    goal: "g",
    lengthWeeks: 1,
    startDate: "2026-06-01",
    endDate: "2026-06-07",
    overview: "",
    createdAt: "2026-06-01T00:00:00.000Z",
    days: [],
    ...over,
  });

  const summary: NoBlockSummary = {
    headline: "Productive training · mild fatigue",
    body: "Weekly load is within your normal build range.",
    weeklyRange: { min: 600, max: 700, thisWeekTss: 450 },
    suggestion: {
      purpose: "aerobic base",
      structure: "mostly Z2, controlled climbing optional",
      durationRangeMin: [90, 120],
      expectedTssRange: [85, 115],
      reason: "recent high-intensity exposure means another threshold session adds little value today.",
    },
  };

  it("never-had-a-block: renders the summary alongside the existing 'Plan your next block' link, not instead of it", () => {
    render(<PlannedToday block={null} noBlockSummary={summary} />);
    expect(screen.getByText("No active training block yet.")).toBeTruthy();
    expect(screen.getByText("Plan your next block →")).toBeTruthy();
    expect(screen.getByText("Productive training · mild fatigue")).toBeTruthy();
    expect(screen.getByText(/Suggested: aerobic base/)).toBeTruthy();
  });

  it("finished block: renders the summary alongside the existing 'Generate the next block' link", () => {
    render(<PlannedToday block={mkBlock({ endDate: "2020-01-01" })} noBlockSummary={summary} />);
    expect(screen.getByText("Generate the next block →")).toBeTruthy();
    expect(screen.getByText("Productive training · mild fatigue")).toBeTruthy();
  });

  it("active, unfinished block: renders neither the summary nor either CTA — no regression", () => {
    render(
      <PlannedToday
        block={mkBlock({ endDate: "2099-01-01", days: [{ date: "2099-01-01", name: "Rest", type: "Rest", durationMin: 0, workoutText: "" }] })}
        noBlockSummary={summary}
      />
    );
    expect(screen.queryByText("Productive training · mild fatigue")).toBeNull();
    expect(screen.queryByText("Plan your next block →")).toBeNull();
    expect(screen.queryByText("Generate the next block →")).toBeNull();
  });

  it("null summary renders no section at all", () => {
    render(<PlannedToday block={null} noBlockSummary={null} />);
    expect(screen.queryByText(/Suggested:/)).toBeNull();
  });
});
