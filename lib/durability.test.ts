import { describe, expect, it } from "vitest";
import { DURABILITY_RECIPES, selectDurabilityTemplate } from "./durability";
import type { Insight } from "./types";

const insight = (dimension: string, severity: Insight["severity"]): Insight => ({
  dimension,
  severity,
  title: `${dimension} ${severity}`,
  evidence: "",
  suggestion: "",
});

it("defines the fixed deterministic durability mechanisms", () => {
  expect(DURABILITY_RECIPES).toEqual({
    A: { kind: "steady" },
    B: { kind: "late-repeats", reps: 2, workSec: 600, workPct: 90, recoverySec: 300 },
    C: { kind: "late-repeats", reps: 4, workSec: 180, workPct: 110, recoverySec: 180 },
    D: { kind: "late-repeats", reps: 8, workSec: 15, workPct: 150, recoverySec: 225 },
    E: { kind: "distributed", reps: 6, workSec: 60, workPct: 105, recoverySec: 840 },
  });
});

describe("selectDurabilityTemplate — limiter-driven", () => {
  it("maps a weak Threshold to B, VO2max to C, SIT to D", () => {
    expect(selectDurabilityTemplate([insight("Threshold", "alert")], null).id).toBe("B");
    expect(selectDurabilityTemplate([insight("VO2max", "watch")], null).id).toBe("C");
    expect(selectDurabilityTemplate([insight("SIT", "alert")], null).id).toBe("D");
  });

  it("maps systemic Overall fatigue to A (pure accumulation, the safe choice)", () => {
    expect(selectDurabilityTemplate([insight("Overall", "alert")], "B").id).toBe("A");
  });

  it("lets an alert outrank a watch on a different dimension", () => {
    // Overall alert (→A) beats a VO2max watch (→C): don't stack hard late efforts on systemic fatigue.
    const t = selectDurabilityTemplate([insight("VO2max", "watch"), insight("Overall", "alert")], null);
    expect(t.id).toBe("A");
  });

  it("ignores 'good' insights (not a limiter)", () => {
    expect(selectDurabilityTemplate([insight("Threshold", "good")], null).id).toBe("A"); // falls through to rotation (lastId null → A)
  });
});

describe("selectDurabilityTemplate — HR-17: an EXPLAINED Overall decline no longer forces template A", () => {
  // deriveInsights' "{type} splits indoor vs outdoor" branch (lib/athlete-model.ts) already
  // diagnoses an execution decline as an environmental artifact (hot outdoor rides), not systemic
  // fatigue. Confirmed live: the real athlete's Overall/alert co-occurs with exactly this Z2
  // insight, and every long ride still defaulted to the safest template regardless of their
  // stated FTP/TTE goal -- goal text was structurally unreachable for as long as the pattern held.
  const explainedOverall: Insight[] = [
    { dimension: "Overall", severity: "alert", title: "Execution trending down", evidence: "", suggestion: "" },
    { dimension: "Z2", severity: "watch", title: "Z2 splits indoor vs outdoor", evidence: "", suggestion: "" },
  ];

  it("falls through to goal text when the Overall decline is explained by an indoor/outdoor split", () => {
    const t = selectDurabilityTemplate(explainedOverall, null, "Raise FTP to 300w and move up TTE");
    expect(t.id).toBe("B"); // goal text reached — not forced to A
  });

  it("falls through to rotation (not goal text) when goal text also names nothing", () => {
    const t = selectDurabilityTemplate(explainedOverall, "A", "Have fun and stay consistent");
    expect(t.id).toBe("B"); // nextAfter("A") — the pre-existing rotation, unaffected
  });

  it("an UNEXPLAINED Overall alert (no co-occurring split insight) still forces the safe template A", () => {
    // Same severity, no environmental explanation present — the safety behaviour must hold.
    const t = selectDurabilityTemplate([insight("Overall", "alert")], null, "Raise FTP to 300w and move up TTE");
    expect(t.id).toBe("A");
  });

  it("a specific measured limiter (Threshold/VO2max/SIT) still wins outright even when Overall is explained", () => {
    // The carve-out is scoped to the generic "Overall" dimension only — a real, specific limiter
    // must never be silently deprioritised just because an unrelated Overall alert happens to be
    // environmentally explained.
    const t = selectDurabilityTemplate([...explainedOverall, insight("SIT", "alert")], null, "Raise my VO2max");
    expect(t.id).toBe("D");
  });
});

describe("selectDurabilityTemplate — rotation (no limiter)", () => {
  it("rotates to the next template after the last one", () => {
    expect(selectDurabilityTemplate([], "A").id).toBe("B");
    expect(selectDurabilityTemplate([], "D").id).toBe("E");
  });

  it("wraps E → A and starts at A with no history", () => {
    expect(selectDurabilityTemplate([], "E").id).toBe("A");
    expect(selectDurabilityTemplate([], null).id).toBe("A");
    expect(selectDurabilityTemplate([], "bogus").id).toBe("A"); // unknown id → safe wrap
  });
});

describe("selectDurabilityTemplate — goal text as a fallback signal (2026-07-16)", () => {
  it("still lets a detected weakness insight win outright, even when goal text points elsewhere", () => {
    const insights: Insight[] = [{ dimension: "SIT", severity: "alert" } as Insight];
    const t = selectDurabilityTemplate(insights, null, "I want to raise my FTP and TTE");
    expect(t.id).toBe("D"); // the measured limiter (SIT/neuromuscular) still wins, not goal text
  });
  it("falls back to goal-text matching when no insight fires", () => {
    const t = selectDurabilityTemplate([], null, "Raise FTP to 300w and move up TTE (time to exhaustion)");
    expect(t.id).toBe("B"); // threshold/TTE language -> Fatigue-then-threshold
  });
  it("matches VO2max-flavoured goal text to template C", () => {
    const t = selectDurabilityTemplate([], null, "Raise my VO2max and high-end repeatability");
    expect(t.id).toBe("C");
  });
  it("HR-25: a negated mention doesn't match — 'no interest in threshold work' must not route to B", () => {
    // Same clause negation: "no" sits before "threshold" with no clause break between them.
    const t = selectDurabilityTemplate([], null, "No interest in threshold work, want VO2max gains");
    expect(t.id).toBe("C"); // the un-negated VO2max clause still matches — not the negated threshold one
  });
  it("falls through to the existing rotation when goal text names nothing recognisable", () => {
    const t = selectDurabilityTemplate([], "A", "Have fun and stay consistent");
    expect(t.id).toBe("B"); // nextAfter("A") — unchanged rotation behaviour
  });
  it("falls through to the existing rotation when goalText is omitted entirely (pre-existing call sites)", () => {
    const t = selectDurabilityTemplate([], "A");
    expect(t.id).toBe("B");
  });
});
