import { describe, expect, it } from "vitest";
import { splitLeadSentences } from "./text";

describe("splitLeadSentences", () => {
  it("returns short text whole, rest null", () => {
    expect(splitLeadSentences("One. Two. Three.")).toEqual({ lead: "One. Two. Three.", rest: null });
  });
  it("splits the lead after n sentences (., !, ? boundaries)", () => {
    expect(splitLeadSentences("A. B! C? D. E.", 3)).toEqual({ lead: "A. B! C?", rest: "D. E." });
  });
  it("does not split on decimals", () => {
    const r = splitLeadSentences("IF was 0.85 today. Solid ride. Keep it steady. Rest tomorrow.");
    expect(r.lead).toBe("IF was 0.85 today. Solid ride. Keep it steady.");
    expect(r.rest).toBe("Rest tomorrow.");
  });
  it("treats newlines as sentence whitespace", () => {
    expect(splitLeadSentences("A.\nB.\nC.\nD.", 3)).toEqual({ lead: "A. B. C.", rest: "D." });
  });
  it("handles empty / whitespace-only input", () => {
    expect(splitLeadSentences("  ")).toEqual({ lead: "", rest: null });
  });
});
