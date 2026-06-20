import { describe, expect, it } from "vitest";
import { buildAskCoachPrompt, type AskCoachContext } from "./anthropic-api";
import type { CoachSnapshot } from "./coach-snapshot";

function snapshot(overrides: Partial<CoachSnapshot> = {}): CoachSnapshot {
  return {
    date: "2026-06-20",
    ftp: 274,
    block: { goal: "Build threshold", weekOfBlock: 2, totalWeeks: 4, overview: "Sweet-spot progression." },
    today: { sessionType: "Threshold", rideLogged: false, execution: null },
    form: { tsb: 3, acwr: "optimal", readiness: "Build", loadRamp: null, tsbModifier: { band: "balanced", guidance: "balanced form." } },
    fuel: { todayTargetKcal: null, rideBurnKj: null, weightTrend7dKg: null, intakeVsNeed: null, fuelingState: null },
    state: null,
    directives: null,
    disposition: null,
    ...overrides,
  };
}

const ctx: AskCoachContext = {
  snapshot: snapshot(),
  session: { name: "Threshold 2x20", type: "Threshold", durationMin: 75, intervals: ["2×20m @ 274W"] },
  upcoming: null,
};

describe("buildAskCoachPrompt", () => {
  it("injects the snapshot (block, form), session + the question — but not the full ledger", () => {
    const p = buildAskCoachPrompt(ctx, "wet & cold — hill or trainer?");
    expect(p).toContain("Build threshold");
    expect(p).toContain("week 2 of 4");
    expect(p).toContain("2×20m @ 274W");
    expect(p).toContain("TSB +3");
    expect(p).toContain("ACWR optimal");
    expect(p).toContain("readiness Build");
    expect(p).toContain("FTP: 274 W");
    expect(p).toContain("wet & cold — hill or trainer?");
    // no historical ledger dump
    expect(p).not.toMatch(/CTL|EWMA|last 8 weeks|execution averaging/i);
    expect(p.length).toBeLessThan(1200);
  });

  it("handles a rest / unplanned day and missing context cleanly", () => {
    const p = buildAskCoachPrompt(
      {
        snapshot: snapshot({
          block: null,
          ftp: null,
          today: { sessionType: null, rideLogged: false, execution: null },
          form: { tsb: null, acwr: null, readiness: null, loadRamp: null, tsbModifier: null },
        }),
        session: null,
        upcoming: null,
      },
      "should I ride easy?"
    );
    expect(p).toContain("No structured session is planned today");
    expect(p).toContain("should I ride easy?");
  });

  it("surfaces tomorrow's SIT prescription so the coach can't invent rep durations (PW-6)", () => {
    const p = buildAskCoachPrompt(
      {
        ...ctx,
        session: null,
        upcoming: { inDays: 1, name: "SIT 5x30s", type: "SIT", durationMin: 50, intervals: ["5×30s all-out @ 432W"] },
      },
      "how should I pace tomorrow's sprint session?"
    );
    expect(p).toContain("Tomorrow's session: SIT");
    expect(p).toContain("5×30s all-out @ 432W");
    expect(p).toContain("do not invent durations");
  });

  it("labels a multi-day-out session by its distance", () => {
    const p = buildAskCoachPrompt(
      { ...ctx, upcoming: { inDays: 3, name: "VO2 6x3", type: "VO2max", durationMin: 70, intervals: ["6×3m @ 320W"] } },
      "what's coming up?"
    );
    expect(p).toContain("Next session (in 3 days): VO2max");
    expect(p).toContain("6×3m @ 320W");
  });

  it("surfaces a compromised disposition so the coach can't misread a fluke as fatigue", () => {
    const p = buildAskCoachPrompt(
      {
        ...ctx,
        snapshot: snapshot({
          disposition: { kind: "compromised", reason: "equipment" },
          today: {
            sessionType: "Threshold",
            rideLogged: true,
            execution: { score: 1, completed: 0, total: 5, effectivePct: 10, powerPct: 20, durationPct: 50, structuralMismatch: false },
          },
        }),
      },
      "should I stay on plan tomorrow?"
    );
    expect(p).toContain("COMPROMISED (equipment)");
    expect(p).toContain("do not infer recovery debt");
    expect(p).toContain("execution 1/10");
  });
});
