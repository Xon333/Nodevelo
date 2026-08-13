import { describe, expect, it } from "vitest";
import { classifyWeekTolerance } from "./weekly-envelope";
import type { RideScoreEntry, WellnessEntry } from "./types";

const entry = (over: Partial<RideScoreEntry> = {}): RideScoreEntry => ({
  date: "2026-07-06",
  executionScore: 6,
  plannedType: "Z2",
  inferredType: "Z2",
  planned: true,
  legacy: false,
  compliancePct: 95,
  intensityFactor: 0.65,
  ftpUsed: 280,
  durationMin: 90,
  tss: 60,
  ...over,
});

const wellness = (date: string, ctl: number | null, atl: number | null): WellnessEntry => ({
  date,
  weightKg: null,
  hrv: null,
  sleepHours: null,
  sleepQuality: null,
  kcalConsumed: null,
  ctl,
  atl,
});

describe("classifyWeekTolerance", () => {
  it("tolerated: no compromised rides, no deep-fatigue read in the days after", () => {
    const entries = [entry({ date: "2026-07-06" }), entry({ date: "2026-07-08" })];
    // TSB = ctl - atl = 60 - 50 = 10, comfortably above deep-fatigue territory
    const w = [wellness("2026-07-13", 60, 50), wellness("2026-07-14", 61, 49)];
    expect(
      classifyWeekTolerance({ weekStart: "2026-07-06", weekEnd: "2026-07-12", entries, wellness: w })
    ).toBe("tolerated");
  });

  it("not-tolerated: a compromised ride inside the week", () => {
    // Two rides so the week clears MIN_RIDES_TO_CLASSIFY — the compromised flag on just one of them
    // still flags the whole week, it isn't diluted by the other ride being fine.
    const entries = [entry({ date: "2026-07-06", compromised: true }), entry({ date: "2026-07-08" })];
    const w = [wellness("2026-07-13", 60, 50)];
    expect(
      classifyWeekTolerance({ weekStart: "2026-07-06", weekEnd: "2026-07-12", entries, wellness: w })
    ).toBe("not-tolerated");
  });

  it("not-tolerated: deep fatigue in the days immediately after the week", () => {
    const entries = [entry({ date: "2026-07-06" }), entry({ date: "2026-07-08" })];
    // TSB = 40 - 70 = -30, deep-fatigue territory (computeReadiness's Recover band)
    const w = [wellness("2026-07-13", 40, 70)];
    expect(
      classifyWeekTolerance({ weekStart: "2026-07-06", weekEnd: "2026-07-12", entries, wellness: w })
    ).toBe("not-tolerated");
  });

  it("unknown: no rides synced for the week at all — never guessed tolerated", () => {
    expect(
      classifyWeekTolerance({
        weekStart: "2026-07-06",
        weekEnd: "2026-07-12",
        entries: [],
        wellness: [wellness("2026-07-13", 60, 50)],
      })
    ).toBe("unknown");
  });

  it("unknown: no post-week wellness data to read recovery from", () => {
    const entries = [entry({ date: "2026-07-06" }), entry({ date: "2026-07-08" })];
    expect(
      classifyWeekTolerance({ weekStart: "2026-07-06", weekEnd: "2026-07-12", entries, wellness: [] })
    ).toBe("unknown");
  });
});
