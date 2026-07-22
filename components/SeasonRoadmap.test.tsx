import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { SeasonPlan } from "@/lib/types";
import type { SeasonOutlookSlot } from "@/lib/season";
import SeasonRoadmap from "./SeasonRoadmap";

// UXA-19: SeasonRoadmap is now purely presentational (PlanView owns the one /api/season fetch and
// passes the result down) — no fetch/useState mocking needed, just plain props.
const noop = () => {};

test("explains that derived roadmap periods refresh when a block is generated", () => {
  const plan: SeasonPlan = {
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
  };

  const html = renderToStaticMarkup(<SeasonRoadmap plan={plan} outlook={null} failed={false} onRetry={noop} />);

  expect(html).toContain(
    "Auto-drafted from your objective, events, fitness/load, and current limiter. It refreshes when you generate a block.",
  );
  expect(html).not.toContain("projected");
});

test("explains the countdown when a future A-priority event drives the roadmap", () => {
  // Far-future dates so the test never rots as the real clock advances (the component uses localToday()).
  const plan: SeasonPlan = {
    objective: "KOM hunting",
    events: [{ name: "Alpe KOM", date: "2099-09-01", priority: "A" }],
    periods: [
      { focus: "threshold", phase: "build", startDate: "2099-07-01", plannedWeeks: 4, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium" },
      { focus: "sharpen", phase: "peak", startDate: "2099-07-29", plannedWeeks: 4, intensitySplit: "75/25", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium" },
      { focus: "sharpen", phase: "taper", startDate: "2099-08-26", plannedWeeks: 1, intensitySplit: "75/25", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium" },
    ],
    updatedAt: "2099-07-01T00:00:00.000Z",
  };

  const html = renderToStaticMarkup(<SeasonRoadmap plan={plan} outlook={null} failed={false} onRetry={noop} />);

  expect(html).toContain("Counting down to");
  expect(html).toContain("Alpe KOM");
  expect(html).toContain("race-specific sharpening");
});

test("renders dashed projected cards from the outlook when there's no settled history yet", () => {
  const plan: SeasonPlan = { objective: "", events: [], periods: [], updatedAt: "2026-07-13T00:00:00.000Z" };
  const outlook: SeasonOutlookSlot[] = [
    { focus: "vo2max", rationale: "rotate the quality focus", startDate: "2026-08-03", weeks: 4 },
  ];

  const html = renderToStaticMarkup(<SeasonRoadmap plan={plan} outlook={outlook} failed={false} onRetry={noop} />);

  expect(html).toContain("projected");
  expect(html).toContain("VO2max");
  expect(html).toContain("4 wk");
  expect(html).toContain("If you kept going from today, roughly this");
  expect(html).not.toContain("How planning works");
});

test("falls back to the teaching stub when there's neither settled history nor an outlook", () => {
  const plan: SeasonPlan = { objective: "", events: [], periods: [], updatedAt: "2026-07-13T00:00:00.000Z" };

  const html = renderToStaticMarkup(<SeasonRoadmap plan={plan} outlook={null} failed={false} onRetry={noop} />);

  expect(html).toContain("How planning works");
  expect(html).not.toContain("projected");
});

test("shows a visible retry when the fetch failed, instead of silently rendering nothing", () => {
  const html = renderToStaticMarkup(<SeasonRoadmap plan={null} outlook={null} failed={true} onRetry={noop} />);

  expect(html).toContain("Couldn&#x27;t load the season roadmap");
});
