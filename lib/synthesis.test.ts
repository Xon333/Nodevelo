import { describe, expect, it } from "vitest";
import { DIRECTIVE_DEMOTE_DEFAULTS, synthesizeCoachingDirectives } from "./synthesis";
import type { Insight, ValidationSummary } from "./types";

const insight = (dimension: string, title: string): Insight => ({
  dimension,
  severity: "alert",
  title,
  evidence: "ev",
  suggestion: "do x",
});

const validation = (over: Partial<ValidationSummary> = {}): ValidationSummary => ({
  byDimension: [],
  evaluated: 0,
  pending: 0,
  ...over,
});

describe("synthesizeCoachingDirectives", () => {
  it("is empty with no insights", () => {
    expect(synthesizeCoachingDirectives([], validation())).toBe("");
  });

  it("emits one ranked block from the insights", () => {
    const out = synthesizeCoachingDirectives([insight("VO2max", "VO2max weak")], validation());
    expect(out).toContain("COACHING DIRECTIVES");
    expect(out).toContain("VO2max weak: ev → do x");
    expect(out).not.toContain("worked"); // no track record yet
  });

  it("annotates an insight with its validation track record", () => {
    const out = synthesizeCoachingDirectives(
      [insight("VO2max", "VO2max weak")],
      validation({ evaluated: 4, byDimension: [{ dimension: "VO2max", validated: 3, refuted: 1, inconclusive: 0, hitRate: 0.75 }] })
    );
    expect(out).toContain("past VO2max nudges worked 75% of the time");
  });
});

describe("synthesizeCoachingDirectives — demote on a proven-poor track record (#4)", () => {
  // VO2max nudges: 1 validated / 4 refuted → 5 decisive, hit-rate 0.2 — well-evidenced and poor.
  const poorTrack = (over: Partial<ValidationSummary["byDimension"][number]> = {}) =>
    validation({ evaluated: 5, byDimension: [{ dimension: "VO2max", validated: 1, refuted: 4, inconclusive: 0, hitRate: 0.2, ...over }] });

  it("demotes a well-evidenced low-hit-rate directive: reframes it and flags the block header", () => {
    const out = synthesizeCoachingDirectives([insight("VO2max", "VO2max weak")], poorTrack());
    expect(out).toContain("poor track record");
    expect(out).toContain("worked only 20% across 5 blocks");
    expect(out).toContain("try a different lever");
    expect(out).toContain("de-prioritised");
    expect(out).not.toContain("weight accordingly"); // the confident annotation is replaced, not appended
  });

  it("keeps the measured evidence visible when demoting (calibrated honesty)", () => {
    const weak = { ...insight("VO2max", "VO2max weak"), evidence: "Execution 4/10 across 6 sessions." };
    const out = synthesizeCoachingDirectives([weak], poorTrack());
    expect(out).toContain("Execution 4/10 across 6 sessions."); // a real weak point is not hidden
  });

  it("does NOT demote below the decisive-evidence gate (one noisy window can't bury a directive)", () => {
    // hit-rate 0 but only 2 decisive — under the default minDecisive of 3.
    const out = synthesizeCoachingDirectives(
      [insight("VO2max", "VO2max weak")],
      validation({ evaluated: 2, byDimension: [{ dimension: "VO2max", validated: 0, refuted: 2, inconclusive: 0, hitRate: 0 }] })
    );
    expect(out).not.toContain("poor track record");
    expect(out).not.toContain("de-prioritised");
    expect(out).toContain("past VO2max nudges worked 0% of the time"); // still annotated, not demoted
  });

  it("never demotes a strong track record", () => {
    const out = synthesizeCoachingDirectives(
      [insight("VO2max", "VO2max weak")],
      validation({ evaluated: 5, byDimension: [{ dimension: "VO2max", validated: 5, refuted: 0, inconclusive: 0, hitRate: 1 }] })
    );
    expect(out).not.toContain("poor track record");
    expect(out).toContain("worked 100% of the time");
  });

  it("sinks demoted directives below still-trusted ones regardless of severity", () => {
    const demotedAlert = insight("VO2max", "VO2max weak"); // alert
    const keptWatch: Insight = { dimension: "Threshold", severity: "watch", title: "Threshold under-delivered", evidence: "ev", suggestion: "do y" };
    const out = synthesizeCoachingDirectives([demotedAlert, keptWatch], poorTrack());
    expect(out.indexOf("Threshold under-delivered")).toBeLessThan(out.indexOf("VO2max weak"));
  });

  it("takes overridden thresholds — the ROADMAP #2 calibration hook", () => {
    const out = synthesizeCoachingDirectives(
      [insight("VO2max", "VO2max weak")],
      validation({ evaluated: 2, byDimension: [{ dimension: "VO2max", validated: 0, refuted: 2, inconclusive: 0, hitRate: 0 }] }),
      { ...DIRECTIVE_DEMOTE_DEFAULTS, minDecisive: 2 }
    );
    expect(out).toContain("poor track record"); // now demoted at the lowered gate
  });
});
