// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EnergyAvailabilityTile, NutritionTrendWarningBanner } from "./today";
import type { NeatImbalanceContext, NutritionTrendWarning } from "@/lib/nutrition";
import type { SyncData } from "@/lib/types";

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
