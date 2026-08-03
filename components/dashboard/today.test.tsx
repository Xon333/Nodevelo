// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NutritionTrendWarningBanner } from "./today";
import type { NutritionTrendWarning } from "@/lib/nutrition";

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
