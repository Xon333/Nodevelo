import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

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
  },
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
