import { describe, expect, it } from "vitest";
import {
  buildCloseoutEvidence,
  deriveCloseoutSeeds,
} from "./block-closeout";
import type { ActivitySummary, CloseoutEvidence, CurrentBlock, RideScoreEntry, WorkoutType } from "./types";

// ---- fixtures -------------------------------------------------------------
const block = (days: Array<{ date: string; type: WorkoutType; durationMin: number }>): CurrentBlock =>
  ({
    goal: "Build FTP",
    lengthWeeks: 2,
    startDate: days[0]?.date ?? "2026-06-01",
    endDate: "2026-06-14",
    overview: "",
    createdAt: "2026-06-01T00:00:00.000Z",
    days,
  }) as CurrentBlock;

const entry = (over: Partial<RideScoreEntry> & { date: string }): RideScoreEntry =>
  ({ planned: true, executionScore: 7, compliancePct: 100, plannedType: "Z2", ...over }) as RideScoreEntry;

const act = (id: string, date: string, minutes: number): ActivitySummary =>
  ({ id, date, type: "VirtualRide", movingTimeSec: minutes * 60 }) as ActivitySummary;

const day = (date: string, type: WorkoutType, durationMin: number) => ({ date, type, durationMin });

// ---- buildCloseoutEvidence ------------------------------------------------

describe("buildCloseoutEvidence", () => {
  it("takes compliance from the frozen ledger, never the raw duration ratio", () => {
    const ev = buildCloseoutEvidence(
      block([day("2026-06-02", "Threshold", 60)]),
      [entry({ date: "2026-06-02", plannedType: "Threshold", executionScore: 8, compliancePct: 100 })],
      [act("a1", "2026-06-02", 96)], // ridden 160% of prescription
      "2026-06-14"
    );
    expect(ev.overallMeanCompliancePct).toBe(100); // capped ledger value, NOT 160
    expect(ev.overallMeanExecution).toBe(8);
    expect(ev.scoredSessions).toBe(1);
    expect(ev.overshootSessions).toBe(1);
  });

  it("attributes overshoot to the ride the LEDGER scored, not the first same-date ride", () => {
    const ev = buildCloseoutEvidence(
      block([day("2026-06-02", "Threshold", 60)]),
      // ledger row names the 96-minute ride by id…
      [entry({ date: "2026-06-02", plannedType: "Threshold", executionScore: 8, compliancePct: 100, activityId: "long" })],
      // …but a SHORT ride sorts first on that date.
      [act("short", "2026-06-02", 20), act("long", "2026-06-02", 96)],
      "2026-06-14"
    );
    expect(ev.perType[0].overshootDays).toEqual(["2026-06-02"]);
  });

  it("does NOT flag overshoot when the scored ride stayed within prescription", () => {
    const ev = buildCloseoutEvidence(
      block([day("2026-06-02", "Threshold", 60)]),
      [entry({ date: "2026-06-02", plannedType: "Threshold", executionScore: 8, compliancePct: 100, activityId: "short" })],
      [act("short", "2026-06-02", 20), act("long", "2026-06-02", 96)], // someone ELSE rode long that day
      "2026-06-14"
    );
    expect(ev.overshootSessions).toBe(0);
  });

  it("binds legacy rows without activityId to the date's primary (longest) ride", () => {
    const ev = buildCloseoutEvidence(
      block([day("2026-06-02", "Z2", 60)]),
      [entry({ date: "2026-06-02", plannedType: "Z2", executionScore: 6, compliancePct: 95 })], // no activityId
      [act("short", "2026-06-02", 30), act("long", "2026-06-02", 130)], // 130 > 60*1.25
      "2026-06-14"
    );
    expect(ev.overshootSessions).toBe(1);
  });

  it("excludes days AFTER the closeout date entirely — an early end never counts future workouts as missed", () => {
    const ev = buildCloseoutEvidence(
      block([day("2026-06-02", "Z2", 60), day("2026-06-20", "SIT", 45)]), // second day is "future"
      [], // nothing scored
      [],
      "2026-06-08" // early-ended on the 8th
    );
    expect(ev.plannedSessions).toBe(1);
    expect(ev.missedSessions).toBe(1); // only the lived, unscored day
  });

  it("reports zero scored sessions honestly (null means, thin counts)", () => {
    const ev = buildCloseoutEvidence(
      block([day("2026-06-02", "Z2", 60), day("2026-06-05", "Z2", 60)]),
      [],
      [],
      "2026-06-14"
    );
    expect(ev.overallMeanExecution).toBeNull();
    expect(ev.overallMeanCompliancePct).toBeNull();
    expect(ev.missedSessions).toBe(2);
  });

  it("counts a pre-field ledger row (undefined score/compliance) as missed — no NaN leaks", () => {
    const ev = buildCloseoutEvidence(
      block([day("2026-06-02", "Z2", 60)]),
      [{ date: "2026-06-02", planned: true }] as unknown as RideScoreEntry[],
      [],
      "2026-06-14"
    );
    expect(ev.missedSessions).toBe(1);
    expect(ev.overallMeanExecution).toBeNull();
    expect(ev.overallMeanCompliancePct).toBeNull();
  });
});

// ---- deriveCloseoutSeeds --------------------------------------------------

describe("deriveCloseoutSeeds", () => {
  const base: CloseoutEvidence = {
    perType: [
      { type: "Z2", planned: 4, scored: 4, missed: 0, meanExecution: 7, meanCompliancePct: 95, overshootDays: [] },
    ],
    plannedSessions: 4, scoredSessions: 4, missedSessions: 0, overshootSessions: 0,
    overallMeanExecution: 7, overallMeanCompliancePct: 95,
  };

  it("proposes progression ONLY for a clean executed type (exec ≥ 6, compliance ≥ 85, no misses, no overshoot)", () => {
    const seeds = deriveCloseoutSeeds(base, null, null, null);
    expect(seeds.some((s) => s.includes("evidence supports progressing"))).toBe(true);
  });

  it("never proposes progression for a type with overshoot days, even with strong capped numbers", () => {
    const ev: CloseoutEvidence = {
      ...base,
      perType: [{ ...base.perType[0], overshootDays: ["2026-06-09"] }],
      overshootSessions: 1,
    };
    const seeds = deriveCloseoutSeeds(ev, null, null, null);
    expect(seeds.some((s) => s.toLowerCase().includes("progressing"))).toBe(false);
    expect(seeds.some((s) => s.includes("data signal"))).toBe(true);
    expect(seeds.some((s) => s.includes("2026-06-09"))).toBe(true);
  });

  it("bars progression when execution ran low even if completion looks high", () => {
    const ev: CloseoutEvidence = {
      ...base,
      perType: [{ ...base.perType[0], meanExecution: 3 }],
      overallMeanExecution: 3,
    };
    const seeds = deriveCloseoutSeeds(ev, null, null, null);
    expect(seeds.some((s) => s.toLowerCase().includes("progressing"))).toBe(false);
    expect(seeds.some((s) => s.includes("review session quality"))).toBe(true);
  });

  it("bars progression and reports honestly when scheduled sessions went unrecorded", () => {
    const ev: CloseoutEvidence = {
      ...base,
      perType: [{ ...base.perType[0], planned: 4, scored: 3, missed: 1 }],
      scoredSessions: 3, missedSessions: 1,
    };
    const seeds = deriveCloseoutSeeds(ev, null, null, null);
    expect(seeds.some((s) => s.includes("no recorded ride"))).toBe(true);
    expect(seeds.some((s) => s.toLowerCase().includes("progressing"))).toBe(false);
  });

  it("emits the thin-evidence seed and NO progression language when nothing scored", () => {
    const empty: CloseoutEvidence = {
      perType: [{ type: "Z2", planned: 2, scored: 0, missed: 2, meanExecution: null, meanCompliancePct: null, overshootDays: [] }],
      plannedSessions: 2, scoredSessions: 0, missedSessions: 2, overshootSessions: 0,
      overallMeanExecution: null, overallMeanCompliancePct: null,
    };
    const seeds = deriveCloseoutSeeds(empty, null, null, null);
    expect(seeds.some((s) => s.startsWith("Insufficient scored sessions"))).toBe(true);
    expect(seeds.some((s) => s.toLowerCase().includes("progressing"))).toBe(false);
  });

  it("keeps CTL observation branches and appends the curve seed verbatim last", () => {
    const high = deriveCloseoutSeeds(base, 50, 62, "Rider type: puncheur");
    expect(high.some((s) => s.includes("Strong CTL gain (+12)"))).toBe(true);
    expect(high[high.length - 1]).toBe("Rider type: puncheur");
    const low = deriveCloseoutSeeds(base, 50, 51, null);
    expect(low.some((s) => s.includes("Minimal CTL gain (+1)"))).toBe(true);
  });
});
