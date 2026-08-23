import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import PlanPreview from "./PlanPreview";
import type { GeneratedPlan, PlanFindings } from "@/lib/types";

const base: GeneratedPlan = {
  overview: "Test block.",
  days: [{
    date: "2026-06-15", weekNumber: 1, weekTheme: "Build", name: "SIT 5x1min", type: "SIT",
    durationMin: 45, workoutText: "Main Set 5x\n- 1m 150%\n- 4m 40%", description: "d",
  }],
  warnings: ["Season context degraded — goals used as-is."],
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

// renderToStaticMarkup runs in the node environment (no jsdom), so the disabled/enabled matrix is
// asserted against the Write button's own opening tag rather than via fireEvent. The attribute
// check must be `disabled=""` — the className carries Tailwind `disabled:` variants.
function writeButtonTag(html: string): string {
  const i = html.indexOf("Write to Intervals.icu");
  expect(i).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf("<button", i), i);
}

const writeDisabled = (html: string) => writeButtonTag(html).includes('disabled=""');

const render = (
  plan: GeneratedPlan,
  overrideAcknowledged = false
) =>
  renderToStaticMarkup(
    <PlanPreview plan={plan} writing={false} results={null} writeError={null} rollback={null} intervalsConfigured={true} hasActiveBlock={false} overrideAcknowledged={overrideAcknowledged} onOverrideAcknowledgedChange={() => {}} onWrite={() => {}} onDismiss={() => {}} />
  );

test("renders blockers as a distinct red panel that cannot be overridden, above the notes", () => {
  const html = render({
    ...base,
    findings: {
      blockers: ["DAY 2026-06-15 (SIT): effort 5×1m @ 432W runs 1m — longer than protocol."],
      preferences: [],
    },
  });
  expect(html).toContain("Publication blocked");
  expect(html).toContain("these defects make this plan unsafe to publish. Regenerate.");
  expect(html).toContain("cannot be overridden");
  expect(html).toContain("longer than protocol");
  expect(html).toContain("border-red-300"); // its own severity styling…
  expect(html).toContain("border-amber-200"); // …without replacing the informational notes box
  expect(html.indexOf("Publication blocked")).toBeLessThan(html.indexOf("Notes — for your awareness"));
});

test("publication-gate matrix: clean → enabled; preferences unchecked → disabled; checked → enabled; blockers → disabled regardless", () => {
  const clean = render(base);
  expect(writeDisabled(clean)).toBe(false);

  const preferences: PlanFindings = { blockers: [], preferences: ["GOAL: terrain-driven goal but no RaceSim session."] };
  const unchecked = render({ ...base, findings: preferences }, false);
  expect(writeDisabled(unchecked)).toBe(true);
  expect(unchecked).toContain("I have read the concerns above — publish anyway.");
  expect(unchecked).not.toContain("checked"); // checkbox starts unchecked

  const checked = render({ ...base, findings: preferences }, true);
  expect(writeDisabled(checked)).toBe(false);
  expect(checked).toMatch(/type="checkbox"[^>]*checked=""/);

  const blockedRegardless = render({
    ...base,
    findings: { blockers: ["STRUCTURE: Expected 14 days but the plan carries 1."], preferences: ["GOAL: …"] },
  }, true); // even with the acknowledgment held, a blocker refuses
  expect(writeDisabled(blockedRegardless)).toBe(true);
  expect(blockedRegardless).toContain("cannot be overridden");
});

test("a plan without findings renders no blocker/preference panels — informational notes only (pre-gate plans included)", () => {
  const html = render(base);
  expect(html).not.toContain("Publication blocked");
  expect(html).not.toContain("Coaching concerns");
  expect(html).not.toContain("I have read the concerns above");
  expect(html).toContain("Notes — for your awareness");
  expect(html).toContain("Season context degraded");
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
      overrideAcknowledged={false}
      onOverrideAcknowledgedChange={() => {}}
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
      overrideAcknowledged={false}
      onOverrideAcknowledgedChange={() => {}}
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
      overrideAcknowledged={false}
      onOverrideAcknowledgedChange={() => {}}
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
      overrideAcknowledged={false}
      onOverrideAcknowledgedChange={() => {}}
      onWrite={() => {}}
      onDismiss={() => {}}
    />
  );
  expect(html).toContain("1/2 events failed — see cards above.");
  expect(html).not.toContain("rolled back");
});
