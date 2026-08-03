import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NutritionTrendWarningBanner } from "./today";
import type { NutritionTrendWarning } from "@/lib/nutrition";

describe("NutritionTrendWarningBanner", () => {
  const warning: NutritionTrendWarning = {
    observedKgPerWeek: 0.3,
    intendedKgPerWeek: 0.15,
    adherenceRatio: 1,
    weighIns: 21,
    loggedDays: 21,
  };

  it("renders its evidence and withholds absent evidence", () => {
    const html = renderToStaticMarkup(<NutritionTrendWarningBanner warning={warning} />);
    expect(html).toContain("Weight trend needs attention");
    expect(html).toContain("Calories are unchanged");
    expect(html).toContain("estimated prescription adherence");
    expect(renderToStaticMarkup(<NutritionTrendWarningBanner warning={null} />)).toBe("");
  });
});
