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

// Two days: 06-15 "succeeded" (per its own raw result) then got rolled back; 06-16 genuinely failed.
const twoDayPlan: GeneratedPlan = {
  ...base,
  days: [
    base.days[0],
    { date: "2026-06-16", weekNumber: 1, weekTheme: "Build", name: "Z2", type: "Z2", durationMin: 60, workoutText: "- 60m 65%", description: "d" },
  ],
};

const render = (plan: GeneratedPlan) =>
  renderToStaticMarkup(
    <PlanPreview plan={plan} writing={false} results={null} writeError={null} rollback={null} intervalsConfigured={true} hasActiveBlock={false} onWrite={() => {}} onDismiss={() => {}} />
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

test("HR-34: shows writeError next to the Write button instead of nowhere", () => {
  const html = renderToStaticMarkup(
    <PlanPreview
      plan={base}
      writing={false}
      results={null}
      writeError="This plan changed in another tab — reload to see the latest before continuing."
      rollback={null}
      intervalsConfigured={true}
      hasActiveBlock={false}
      onWrite={() => {}}
      onDismiss={() => {}}
    />
  );
  expect(html).toContain("This plan changed in another tab");
});

test("HR-48: a rolled-back day never shows '✓ written' even though its raw result was ok:true", () => {
  const html = renderToStaticMarkup(
    <PlanPreview
      plan={twoDayPlan}
      writing={false}
      results={[
        { date: "2026-06-15", name: "SIT 5x1min", ok: true, eventId: 101 }, // succeeded, then rolled back
        { date: "2026-06-16", name: "Z2", ok: false, eventId: null, error: "502 upstream" },
      ]}
      writeError={null}
      rollback={{ rolledBack: 1, rollbackFailed: [] }}
      intervalsConfigured={true}
      hasActiveBlock={false}
      onWrite={() => {}}
      onDismiss={() => {}}
    />
  );
  expect(html).not.toContain("✓ written");
  expect(html).toContain("rolled back");
  expect(html).toContain("Partial write rolled back — nothing was saved.");
  // The overall Write button must not read as successful either.
  expect(html).not.toContain("✓ Written to Intervals.icu");
});

test("HR-48: flags a day whose own rollback failed distinctly from a cleanly rolled-back one", () => {
  const html = renderToStaticMarkup(
    <PlanPreview
      plan={twoDayPlan}
      writing={false}
      results={[
        { date: "2026-06-15", name: "SIT 5x1min", ok: true, eventId: 101 },
        { date: "2026-06-16", name: "Z2", ok: false, eventId: null, error: "502 upstream" },
      ]}
      writeError={null}
      rollback={{ rolledBack: 0, rollbackFailed: [101] }}
      intervalsConfigured={true}
      hasActiveBlock={false}
      onWrite={() => {}}
      onDismiss={() => {}}
    />
  );
  expect(html).toContain("rollback failed");
  expect(html).toContain("be cleaned up"); // "...couldn't be cleaned up..." (renderToStaticMarkup HTML-escapes the apostrophe)
  expect(html).not.toContain("✓ written");
});

test("no rollback → the ordinary partial-failure summary still renders as before", () => {
  const html = renderToStaticMarkup(
    <PlanPreview
      plan={twoDayPlan}
      writing={false}
      results={[
        { date: "2026-06-15", name: "SIT 5x1min", ok: true, eventId: 101 },
        { date: "2026-06-16", name: "Z2", ok: false, eventId: null, error: "502 upstream" },
      ]}
      writeError={null}
      rollback={null}
      intervalsConfigured={true}
      hasActiveBlock={false}
      onWrite={() => {}}
      onDismiss={() => {}}
    />
  );
  expect(html).toContain("1/2 events failed — see cards above.");
  expect(html).not.toContain("rolled back");
});
