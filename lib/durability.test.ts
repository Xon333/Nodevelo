import { describe, expect, it } from "vitest";
import { DURABILITY_TEMPLATES, formatDurabilityForPrompt, selectDurabilityTemplate } from "./durability";
import type { Insight } from "./types";

const insight = (dimension: string, severity: Insight["severity"]): Insight => ({
  dimension,
  severity,
  title: `${dimension} ${severity}`,
  evidence: "",
  suggestion: "",
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

describe("formatDurabilityForPrompt", () => {
  it("names the template and keeps the long ride TYPE Z2", () => {
    const out = formatDurabilityForPrompt(DURABILITY_TEMPLATES[1]); // B
    expect(out).toContain("template B");
    expect(out).toContain("TYPE Z2");
    expect(out).toContain("INSIDE the duration target");
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
  it("falls through to the existing rotation when goal text names nothing recognisable", () => {
    const t = selectDurabilityTemplate([], "A", "Have fun and stay consistent");
    expect(t.id).toBe("B"); // nextAfter("A") — unchanged rotation behaviour
  });
  it("falls through to the existing rotation when goalText is omitted entirely (pre-existing call sites)", () => {
    const t = selectDurabilityTemplate([], "A");
    expect(t.id).toBe("B");
  });
});
