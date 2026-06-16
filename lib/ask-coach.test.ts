import { describe, expect, it } from "vitest";
import { buildAskCoachPrompt, type AskCoachSession } from "./anthropic-api";

const session: AskCoachSession = {
  name: "Threshold 2x20",
  type: "Threshold",
  durationMin: 75,
  intervals: ["2×20m @ 274W"],
};

describe("buildAskCoachPrompt", () => {
  it("injects today's session + the question and nothing else", () => {
    const p = buildAskCoachPrompt(session, "wet & cold — hill or trainer?");
    expect(p).toContain("Threshold");
    expect(p).toContain("2×20m @ 274W");
    expect(p).toContain("wet & cold — hill or trainer?");
    // stays tiny — no historical ledger leaks in
    expect(p).not.toMatch(/CTL|ATL|EWMA|execution score|last 8 weeks/i);
    expect(p.length).toBeLessThan(600);
  });

  it("handles a rest / unplanned day cleanly", () => {
    const p = buildAskCoachPrompt(null, "should I ride easy?");
    expect(p).toContain("No structured session is planned today");
    expect(p).toContain("should I ride easy?");
  });
});
