import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { SeasonPlan } from "@/lib/types";

const state = vi.hoisted(() => ({
  calls: 0,
  plan: {
    objective: "Finish a gran fondo strongly",
    events: [],
    periods: [{
      focus: "aerobic-base",
      phase: "base",
      startDate: "2026-07-13",
      plannedWeeks: 3,
      intensitySplit: "90/10",
      targetWeeklyTss: null,
      deloadWeek: false,
      rationale: "Build the aerobic ceiling.",
      source: "derived",
      confidence: "high",
    }],
    updatedAt: "2026-07-13T00:00:00.000Z",
  } as SeasonPlan,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      state.calls += 1;
      return [state.calls === 1 ? state.plan : initial, vi.fn()];
    },
  };
});

import SeasonRoadmap from "./SeasonRoadmap";

test("explains that derived roadmap periods refresh when a block is generated", () => {
  state.calls = 0;

  const html = renderToStaticMarkup(<SeasonRoadmap />);

  expect(html).toContain(
    "Auto-drafted from your objective, events, fitness/load, and current limiter. It refreshes when you generate a block.",
  );
});

test("explains the countdown when a future A-priority event drives the roadmap", () => {
  state.calls = 0;
  // Far-future dates so the test never rots as the real clock advances (the component uses localToday()).
  state.plan = {
    objective: "KOM hunting",
    events: [{ name: "Alpe KOM", date: "2099-09-01", priority: "A" }],
    periods: [
      { focus: "threshold", phase: "build", startDate: "2099-07-01", plannedWeeks: 4, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium" },
      { focus: "sharpen", phase: "peak", startDate: "2099-07-29", plannedWeeks: 4, intensitySplit: "75/25", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium" },
      { focus: "sharpen", phase: "taper", startDate: "2099-08-26", plannedWeeks: 1, intensitySplit: "75/25", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium" },
    ],
    updatedAt: "2099-07-01T00:00:00.000Z",
  } as SeasonPlan;

  const html = renderToStaticMarkup(<SeasonRoadmap />);

  expect(html).toContain("Counting down to");
  expect(html).toContain("Alpe KOM");
  expect(html).toContain("race-specific sharpening");
});
