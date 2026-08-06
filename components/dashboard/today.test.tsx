// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EatToday, EnergyAvailabilityTile, NutritionTrendWarningBanner, PlanEaWarningBanner } from "./today";
import type { NeatImbalanceContext, NutritionTrendWarning } from "@/lib/nutrition";
import type { SyncData, TodayAnalysis } from "@/lib/types";

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
