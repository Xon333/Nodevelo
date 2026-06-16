import { describe, expect, it } from "vitest";
import { buildAskCoachPrompt, type AskCoachContext } from "./anthropic-api";

const ctx: AskCoachContext = {
  block: { goal: "Build threshold", weekOfBlock: 2, totalWeeks: 4, overview: "Sweet-spot progression." },
  session: { name: "Threshold 2x20", type: "Threshold", durationMin: 75, intervals: ["2×20m @ 274W"] },
  form: "TSB +3, ACWR optimal, readiness Build",
  ftp: 274,
  rideLogged: null,
  disposition: null,
};

describe("buildAskCoachPrompt", () => {
  it("injects block, session, form + the question — but not the full ledger", () => {
    const p = buildAskCoachPrompt(ctx, "wet & cold — hill or trainer?");
    expect(p).toContain("Build threshold");
    expect(p).toContain("week 2 of 4");
    expect(p).toContain("2×20m @ 274W");
    expect(p).toContain("TSB +3, ACWR optimal, readiness Build");
    expect(p).toContain("FTP: 274 W");
    expect(p).toContain("wet & cold — hill or trainer?");
    // no historical ledger dump
    expect(p).not.toMatch(/CTL|EWMA|last 8 weeks|execution averaging/i);
    expect(p.length).toBeLessThan(900);
  });

  it("handles a rest / unplanned day and missing context cleanly", () => {
    const p = buildAskCoachPrompt({ block: null, session: null, form: null, ftp: null, rideLogged: null, disposition: null }, "should I ride easy?");
    expect(p).toContain("No structured session is planned today");
    expect(p).toContain("should I ride easy?");
  });

  it("surfaces a compromised disposition so the coach can't misread a fluke as fatigue", () => {
    const p = buildAskCoachPrompt(
      { ...ctx, rideLogged: "Today's ride is already logged — execution 1/10.", disposition: "IMPORTANT: the athlete marked today's session COMPROMISED (equipment). A low execution score reflects that, NOT under-recovery." },
      "should I stay on plan tomorrow?"
    );
    expect(p).toContain("COMPROMISED");
    expect(p).toContain("NOT under-recovery");
  });
});
