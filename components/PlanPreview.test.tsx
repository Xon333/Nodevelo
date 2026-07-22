import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import PlanPreview from "./PlanPreview";
import type { GeneratedPlan } from "@/lib/types";

const base: GeneratedPlan = {
  overview: "Test block.",
  days: [{
    date: "2026-06-15", weekNumber: 1, weekTheme: "Build", name: "SIT 5x1min", type: "SIT",
    durationMin: 45, workoutText: "Main Set 5x\n- 1m 150%\n- 4m 40%", description: "d",
  }],
  warnings: ["Expected 14 days, got 1."],
  raw: "",
  blockParams: { lengthWeeks: 2, goal: "g", startDate: "2026-06-15", weakpoints: [] },
};

const render = (plan: GeneratedPlan) =>
  renderToStaticMarkup(
    <PlanPreview plan={plan} writing={false} results={null} intervalsConfigured={true} hasActiveBlock={false} onWrite={() => {}} onDismiss={() => {}} />
  );

test("renders protocol violations as a distinct red category above the amber warnings", () => {
  const html = render({
    ...base,
    protocolViolations: ["DAY 2026-06-15 (SIT): effort 5×1m @ 432W runs 1m — longer than protocol."],
  });
  expect(html).toContain("Protocol violations");
  expect(html).toContain("border-red-300"); // its own severity styling…
  expect(html).toContain("border-amber-200"); // …without replacing the ordinary warnings box
  expect(html.indexOf("Protocol violations")).toBeLessThan(html.indexOf("Warnings — review before writing"));
});

test("renders no violations box when the plan carries none (pre-field plans included)", () => {
  const html = render(base);
  expect(html).not.toContain("Protocol violations");
  expect(html).toContain("Warnings — review before writing");
});
