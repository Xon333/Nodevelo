import { describe, expect, it } from "vitest";
import { buildRideScores, fuelStampFor, intervalStampFrom, mergeScoreLog, mergeScoreLogRebuild, npStampFor, summariseBehaviour, truncateBlockDays } from "./score-log";
import type { ActivitySummary, BlockHistoryEntry, CurrentBlock, IntervalComparison, RideScoreEntry, WorkoutType } from "./types";

function activity(over: Partial<ActivitySummary> & { date: string }): ActivitySummary {
  return {
    id: over.date,
    type: "Ride",
    name: "Ride",
    movingTimeSec: 3600,
    avgWatts: 180,
    normalizedPower: 185,
    maxWatts: 400,
    icuFtp: null,
    powerHrZ2: null,
    powerHrZ2Mins: null,
    avgHr: 140,
    maxHr: 165,
    kj: 600,
    trainingLoad: 60,
    rpe: 5,
    carbsIngestedG: null,
    decoupling: 3,
    efficiencyFactor: 1.3,
    description: null,
    avgCadence: 88,
    distanceMeters: 30000,
    elevationGain: 300,
    powerZoneTimes: null,
    hrZoneTimes: null,
    ...over,
  };
}

function block(days: Array<{ date: string; type: WorkoutType; durationMin: number }>): CurrentBlock {
  return {
    goal: "Test",
    lengthWeeks: 2,
    startDate: days[0]?.date ?? "2026-01-01",
    endDate: days[days.length - 1]?.date ?? "2026-01-14",
    overview: "",
    createdAt: new Date().toISOString(),
    days: days.map((d) => ({ date: d.date, name: `${d.type} day`, type: d.type, durationMin: d.durationMin })),
  };
}

function historyEntry(
  createdAt: string,
  days: Array<{ date: string; type: WorkoutType; durationMin: number }>
): BlockHistoryEntry {
  return {
    id: createdAt,
    goal: "Test",
    startDate: days[0]?.date ?? "2026-01-01",
    endDate: days[days.length - 1]?.date ?? "2026-01-14",
    lengthWeeks: 2,
    overview: "",
    createdAt,
    days: days.map((d) => ({ date: d.date, name: `${d.type} day`, type: d.type, durationMin: d.durationMin })),
  };
}

describe("buildRideScores", () => {
  const ftp200 = () => 200;

  it("scores planned days that have a matching ride and stamps the FTP used", () => {
    const b = block([{ date: "2026-01-01", type: "Z2", durationMin: 60 }]);
    const acts = [activity({ date: "2026-01-01", avgWatts: 135, normalizedPower: 138 })]; // IF ~0.69 @ ftp200
    const scores = buildRideScores(b, acts, ftp200, "2026-01-10");
    expect(scores).toHaveLength(1);
    expect(scores[0].plannedType).toBe("Z2");
    expect(scores[0].ftpUsed).toBe(200);
    expect(scores[0].executionScore).toBeGreaterThanOrEqual(1);
    expect(scores[0].executionScore).toBeLessThanOrEqual(10);
  });

  it("resolves FTP per ride date (as-of), not a single current FTP", () => {
    const b = block([
      { date: "2026-01-01", type: "Z2", durationMin: 60 },
      { date: "2026-02-01", type: "Z2", durationMin: 60 },
    ]);
    const acts = [
      activity({ date: "2026-01-01", avgWatts: 135, normalizedPower: 138 }),
      activity({ date: "2026-02-01", avgWatts: 135, normalizedPower: 138 }),
    ];
    const ftpForDate = (date: string) => (date < "2026-01-15" ? 200 : 300);
    const scores = buildRideScores(b, acts, ftpForDate, "2026-03-01");
    expect(scores.find((s) => s.date === "2026-01-01")?.ftpUsed).toBe(200);
    expect(scores.find((s) => s.date === "2026-02-01")?.ftpUsed).toBe(300);
  });

  it("prefers the ride's own icu_ftp over the effective-dated store, and falls back when absent (RV-5)", () => {
    const b = block([
      { date: "2026-01-01", type: "Z2", durationMin: 60 },
      { date: "2026-01-02", type: "Z2", durationMin: 60 },
    ]);
    // ftpForDate would return the stale 200 for both (e.g. an FTP test not yet synced). The 01-01 ride
    // carries its own icu_ftp=260 from intervals.icu and must anchor to it; 01-02 has none → fallback.
    const acts = [
      activity({ date: "2026-01-01", icuFtp: 260, avgWatts: 135, normalizedPower: 138 }),
      activity({ date: "2026-01-02", icuFtp: null, avgWatts: 135, normalizedPower: 138 }),
    ];
    const scores = buildRideScores(b, acts, ftp200, "2026-01-10");
    expect(scores.find((s) => s.date === "2026-01-01")?.ftpUsed).toBe(260); // per-ride anchor wins
    expect(scores.find((s) => s.date === "2026-01-02")?.ftpUsed).toBe(200); // fallback to as-of store
  });

  it("skips rest days, future days, and days without a ride", () => {
    const b = block([
      { date: "2026-01-01", type: "Rest", durationMin: 0 },
      { date: "2026-01-02", type: "Z2", durationMin: 60 }, // no matching activity
      { date: "2026-01-20", type: "Z2", durationMin: 60 }, // future vs the "today" below
    ]);
    const acts = [activity({ date: "2026-01-20", avgWatts: 140 })];
    const scores = buildRideScores(b, acts, ftp200, "2026-01-10");
    expect(scores).toHaveLength(0);
  });

  it("freezes the per-type IF-band offset that scored a planned entry, absent when uncalibrated (ROADMAP #2)", () => {
    const b = block([{ date: "2026-01-01", type: "Z2", durationMin: 60 }]);
    const acts = [activity({ date: "2026-01-01", avgWatts: 135, normalizedPower: 138 })];
    // The offset for THIS entry's type is frozen onto it (decoupling left execution scoring — ACC-2026-06-25).
    expect(
      buildRideScores(b, acts, ftp200, "2026-01-10", null, { ifBandOffsets: { Z2: 0.05 } })[0].calibration
    ).toEqual({ ifBandOffset: 0.05 });
    // Uncalibrated → no calibration key at all.
    expect(buildRideScores(b, acts, ftp200, "2026-01-10")[0].calibration).toBeUndefined();
    // Only the offset for the entry's own type is stamped — irrelevant types are dropped.
    expect(
      buildRideScores(b, acts, ftp200, "2026-01-10", null, { ifBandOffsets: { Threshold: 0.04 } })[0].calibration
    ).toBeUndefined();
    // A zero offset (within the deadband) is not stamped.
    expect(
      buildRideScores(b, acts, ftp200, "2026-01-10", null, { ifBandOffsets: { Z2: 0 } })[0].calibration
    ).toBeUndefined();
  });

  it("does not stamp an IF offset on off-plan rides (intensity-vs-type is skipped there)", () => {
    // No planned day for this date → off-plan, scored intrinsically, so no IF offset applies → nothing stamped.
    const acts = [activity({ date: "2026-01-05", avgWatts: 135, normalizedPower: 138 })];
    const entry = buildRideScores(null, acts, ftp200, "2026-01-10", "2026-01-01", {
      ifBandOffsets: { Z2: 0.05 },
    })[0];
    expect(entry.calibration).toBeUndefined(); // off-plan skips the IF branch, so nothing is stamped
  });

  it("freezes the athlete-state form context as of the ride date (ROADMAP #2)", () => {
    const b = block([{ date: "2026-01-03", type: "Z2", durationMin: 60 }]);
    const acts = [activity({ date: "2026-01-03", avgWatts: 135, normalizedPower: 138 })];
    const contextForDate = (date: string) =>
      date === "2026-01-03" ? { formState: { tsb: -12, ctl: 50, atl: 62 } } : null;
    const entry = buildRideScores(b, acts, ftp200, "2026-01-10", null, null, contextForDate)[0];
    expect(entry.formState).toEqual({ tsb: -12, ctl: 50, atl: 62 });
    // Absent when no resolver, or when the resolver has nothing for that date (byte-identical to before).
    expect(buildRideScores(b, acts, ftp200, "2026-01-10")[0].formState).toBeUndefined();
    expect(buildRideScores(b, acts, ftp200, "2026-01-10", null, null, () => null)[0].formState).toBeUndefined();
  });

  it("stamps logged carb intake as g/h (ROADMAP Track C fueling context)", () => {
    const b = block([{ date: "2026-01-03", type: "Z2", durationMin: 120 }]);
    // 180 g over a 2 h ride → 90 g/h.
    const acts = [activity({ date: "2026-01-03", avgWatts: 135, normalizedPower: 138, movingTimeSec: 7200, carbsIngestedG: 180 })];
    expect(buildRideScores(b, acts, ftp200, "2026-01-10")[0].fuel).toEqual({ carbsGPerH: 90 });
    // Absent when nothing was logged (null) — most rides, byte-identical to before.
    const none = [activity({ date: "2026-01-03", avgWatts: 135, normalizedPower: 138, carbsIngestedG: null })];
    expect(buildRideScores(b, none, ftp200, "2026-01-10")[0].fuel).toBeUndefined();
  });

  it("matches a ride against a historical block's day when no current block covers that date", () => {
    const hist = [historyEntry("2026-01-01T00:00:00.000Z", [{ date: "2026-01-05", type: "Threshold", durationMin: 60 }])];
    const acts = [activity({ date: "2026-01-05", avgWatts: 180, normalizedPower: 185 })];
    const scores = buildRideScores(null, acts, ftp200, "2026-01-10", null, undefined, undefined, hist);
    expect(scores[0].planned).toBe(true);
    expect(scores[0].plannedType).toBe("Threshold");
  });

  it("prefers the current block over a historical block covering the same date", () => {
    const b = block([{ date: "2026-01-05", type: "Z2", durationMin: 90 }]);
    const hist = [historyEntry("2026-01-01T00:00:00.000Z", [{ date: "2026-01-05", type: "Threshold", durationMin: 60 }])];
    const acts = [activity({ date: "2026-01-05", avgWatts: 180, normalizedPower: 185 })];
    const scores = buildRideScores(b, acts, ftp200, "2026-01-10", null, undefined, undefined, hist);
    expect(scores[0].plannedType).toBe("Z2");
  });

  it("does not match a historical day whose block was created after the ride's date", () => {
    // Created 2026-01-06, but claims to prescribe 2026-01-05 — a block can't retroactively plan a past day.
    const hist = [historyEntry("2026-01-06T00:00:00.000Z", [{ date: "2026-01-05", type: "Threshold", durationMin: 60 }])];
    const acts = [activity({ date: "2026-01-05", avgWatts: 180, normalizedPower: 185 })];
    const scores = buildRideScores(null, acts, ftp200, "2026-01-10", "2025-01-01", undefined, undefined, hist);
    expect(scores[0].planned).toBe(false);
  });

  it("prefers the most-recently-created historical block when two both cover the same date", () => {
    const older = historyEntry("2026-01-01T00:00:00.000Z", [{ date: "2026-01-05", type: "Z2", durationMin: 90 }]);
    const newer = historyEntry("2026-01-03T00:00:00.000Z", [{ date: "2026-01-05", type: "Threshold", durationMin: 60 }]);
    const acts = [activity({ date: "2026-01-05", avgWatts: 180, normalizedPower: 185 })];
    const scores = buildRideScores(null, acts, ftp200, "2026-01-10", null, undefined, undefined, [older, newer]);
    expect(scores[0].plannedType).toBe("Threshold");
  });

  it("ignores a history entry with no days without crashing", () => {
    const noD: BlockHistoryEntry = { ...historyEntry("2026-01-01T00:00:00.000Z", []), days: undefined };
    const acts = [activity({ date: "2026-01-05", avgWatts: 180, normalizedPower: 185 })];
    expect(() => buildRideScores(null, acts, ftp200, "2026-01-10", null, undefined, undefined, [noD])).not.toThrow();
  });

  describe("adherenceForDate (scoring-core gap: interval-target adherence in the ledger)", () => {
    // Threshold day, planned 60min, ridden exactly 60min → clean 100% duration compliance (+2 in the
    // duration branch) when no adherence stamp is supplied. A lookup returning a well-under-target
    // adherencePct (50 — deep in the `else score -= 2` bucket, nowhere near a rounding boundary) must
    // swap the scoring axis from duration to interval adherence and pull the score down.
    const thresholdBlock = block([{ date: "2026-01-05", type: "Threshold", durationMin: 60 }]);
    const thresholdActs = [activity({ date: "2026-01-05", movingTimeSec: 3600, avgWatts: 180, normalizedPower: 182 })];

    it("engages the adherence axis when the lookup returns a stamp, and stamps `intervals` on the entry", () => {
      const control = buildRideScores(thresholdBlock, thresholdActs, ftp200, "2026-01-10")[0];
      const stamp = { adherencePct: 50, structuralMismatch: false, completed: 3, total: 4 };
      const withAdherence = buildRideScores(
        thresholdBlock,
        thresholdActs,
        ftp200,
        "2026-01-10",
        null,
        undefined,
        undefined,
        undefined,
        (date: string) => (date === "2026-01-05" ? stamp : null)
      )[0];
      expect(withAdherence.executionScore).not.toBe(control.executionScore);
      expect(withAdherence.intervals).toEqual(stamp);
    });

    it("treats a structurally-mismatched stamp as null input to scoring, but still persists it as provenance", () => {
      const control = buildRideScores(thresholdBlock, thresholdActs, ftp200, "2026-01-10")[0];
      const stamp = { adherencePct: 50, structuralMismatch: true, completed: 4, total: 4 };
      const withMismatch = buildRideScores(
        thresholdBlock,
        thresholdActs,
        ftp200,
        "2026-01-10",
        null,
        undefined,
        undefined,
        undefined,
        (date: string) => (date === "2026-01-05" ? stamp : null)
      )[0];
      expect(withMismatch.executionScore).toBe(control.executionScore); // score unaffected — same as no lookup
      expect(withMismatch.intervals).toEqual(stamp); // but the stamp still lands on the entry
    });

    it("never consults the lookup for a Z2 day, a Recovery day, or a day with a durabilityTemplate", () => {
      const throwingLookup = (): RideScoreEntry["intervals"] => {
        throw new Error("adherenceForDate must not be called for this day");
      };
      const z2Block = block([{ date: "2026-01-05", type: "Z2", durationMin: 60 }]);
      const recoveryBlock = block([{ date: "2026-01-05", type: "Recovery", durationMin: 60 }]);
      const durabilityBlock: CurrentBlock = {
        ...block([{ date: "2026-01-05", type: "Z2", durationMin: 180 }]),
        days: [{ date: "2026-01-05", name: "Durability day", type: "Z2", durationMin: 180, durabilityTemplate: "B" }],
      };
      const acts = [activity({ date: "2026-01-05", avgWatts: 135, normalizedPower: 138 })];

      expect(() =>
        buildRideScores(z2Block, acts, ftp200, "2026-01-10", null, undefined, undefined, undefined, throwingLookup)
      ).not.toThrow();
      expect(() =>
        buildRideScores(recoveryBlock, acts, ftp200, "2026-01-10", null, undefined, undefined, undefined, throwingLookup)
      ).not.toThrow();
      expect(() =>
        buildRideScores(durabilityBlock, acts, ftp200, "2026-01-10", null, undefined, undefined, undefined, throwingLookup)
      ).not.toThrow();
    });

    it("never stamps `intervals` on an off-plan ride, regardless of what the lookup would return", () => {
      // No planned day for this date at all → off-plan branch, which must not even consider adherence.
      const acts = [activity({ date: "2026-01-05", avgWatts: 180, normalizedPower: 185 })];
      const stamp = { adherencePct: 90, structuralMismatch: false, completed: 4, total: 4 };
      const entry = buildRideScores(
        null,
        acts,
        ftp200,
        "2026-01-10",
        "2026-01-01",
        undefined,
        undefined,
        undefined,
        () => stamp
      )[0];
      expect(entry.planned).toBe(false);
      expect(entry.intervals).toBeUndefined();
    });
  });

  describe("preLoadForDate (Track C: loading-loop provenance stamp)", () => {
    const DURABILITY_DATE = "2026-01-05";
    const durabilityBlock: CurrentBlock = {
      ...block([{ date: DURABILITY_DATE, type: "Z2", durationMin: 180 }]),
      days: [{ date: DURABILITY_DATE, name: "Durability day", type: "Z2", durationMin: 180, durabilityTemplate: "C" }],
    };
    const durabilityActs = [activity({ date: DURABILITY_DATE, avgWatts: 135, normalizedPower: 138 })];

    it("stamps preLoad on a durability-template day when the lookup has a response, and nothing otherwise", () => {
      const preLoadForDate = (date: string) => (date === DURABILITY_DATE ? { loaded: true, targetG: 490 } : null);
      const withStamp = buildRideScores(
        durabilityBlock,
        durabilityActs,
        ftp200,
        "2026-01-10",
        null,
        undefined,
        undefined,
        undefined,
        undefined,
        preLoadForDate
      );
      const entry = withStamp.find((e) => e.date === DURABILITY_DATE);
      expect(entry?.preLoad).toEqual({ loaded: true, targetG: 490 });

      // Fresh athlete / no lookup → identical entries, no stamp key at all (sparse-field convention).
      const without = buildRideScores(durabilityBlock, durabilityActs, ftp200, "2026-01-10", null);
      expect(without.find((e) => e.date === DURABILITY_DATE)?.preLoad).toBeUndefined();
      expect(JSON.stringify(without.find((e) => e.date === DURABILITY_DATE)?.executionScore)).toBe(
        JSON.stringify(withStamp.find((e) => e.date === DURABILITY_DATE)?.executionScore)
      ); // provenance only — never moves the score
    });
  });
});

describe("intervalStampFrom", () => {
  const cmp = (over: Partial<IntervalComparison> = {}): IntervalComparison => ({
    prescribedLabels: ["1", "2", "3", "4"],
    reps: [],
    completed: 4,
    total: 4,
    avgAdherencePct: 98,
    avgDurationPct: 100,
    effectiveAdherencePct: 97,
    structuralMismatch: false,
    extras: [],
    ...over,
  });

  it("maps effectiveAdherencePct to adherencePct, plus structuralMismatch/completed/total verbatim", () => {
    expect(intervalStampFrom(cmp())).toEqual({
      adherencePct: 97,
      structuralMismatch: false,
      completed: 4,
      total: 4,
    });
  });

  it("carries a true structuralMismatch through unchanged", () => {
    expect(intervalStampFrom(cmp({ structuralMismatch: true, effectiveAdherencePct: 45, completed: 4, total: 4 }))).toEqual({
      adherencePct: 45,
      structuralMismatch: true,
      completed: 4,
      total: 4,
    });
  });
});

describe("fuelStampFor", () => {
  const base = activity({ date: "2026-01-01", movingTimeSec: 3600 });

  it("normalises logged grams to g/h over the ride's moving time", () => {
    expect(fuelStampFor({ ...base, movingTimeSec: 5400, carbsIngestedG: 90 })).toEqual({ fuel: { carbsGPerH: 60 } });
    expect(fuelStampFor({ ...base, movingTimeSec: 3600, carbsIngestedG: 75 })).toEqual({ fuel: { carbsGPerH: 75 } });
  });

  it("stamps nothing for unlogged (null) or non-finite intake, but keeps an explicitly logged 0 (FUEL-1)", () => {
    expect(fuelStampFor({ ...base, carbsIngestedG: null })).toEqual({}); // unlogged (num(undefined)→null) stays absent
    expect(fuelStampFor({ ...base, carbsIngestedG: Number.NaN })).toEqual({});
    expect(fuelStampFor({ ...base, carbsIngestedG: -5 })).toEqual({}); // negative is garbage
    expect(fuelStampFor({ ...base, carbsIngestedG: 0 })).toEqual({ fuel: { carbsGPerH: 0 } }); // a logged fasted ride is a real data point
  });

  it("stamps nothing when moving time is zero (avoids divide-by-zero)", () => {
    expect(fuelStampFor({ ...base, movingTimeSec: 0, carbsIngestedG: 50 })).toEqual({});
  });
});

describe("npStampFor", () => {
  const base = activity({ date: "2026-01-01" }); // default fixture: normalizedPower 185, avgWatts 180

  it("stamps npUnverified when NP is absent but avg power let intensityFactor still compute", () => {
    expect(npStampFor({ ...base, normalizedPower: null, avgWatts: 180 })).toEqual({ npUnverified: true });
  });

  it("stamps nothing when NP is present (the real signal)", () => {
    expect(npStampFor({ ...base, normalizedPower: 185, avgWatts: 180 })).toEqual({});
  });

  it("stamps nothing when both NP and avg power are absent — nothing was scored off avg power either", () => {
    expect(npStampFor({ ...base, normalizedPower: null, avgWatts: null })).toEqual({});
  });
});

describe("buildRideScores — NP-unverified provenance", () => {
  const ftpFor = () => 200;

  it("flags a planned ride's entry npUnverified when it scored off avg power, not NP", () => {
    const z2Block = block([{ date: "2026-01-01", type: "Z2", durationMin: 60 }]);
    const acts = [activity({ date: "2026-01-01", normalizedPower: null, avgWatts: 135 })]; // IF 0.675 @ ftp200
    const [entry] = buildRideScores(z2Block, acts, ftpFor, "2026-01-02");
    expect(entry.npUnverified).toBe(true);
  });

  it("flags an off-plan ride's entry the same way", () => {
    const acts = [activity({ date: "2026-01-01", normalizedPower: null, avgWatts: 135 })];
    const [entry] = buildRideScores(null, acts, ftpFor, "2026-01-02");
    expect(entry.npUnverified).toBe(true);
  });

  it("leaves the field absent when NP is present (byte-identical to before this change)", () => {
    const acts = [activity({ date: "2026-01-01", normalizedPower: 138, avgWatts: 135 })];
    const [entry] = buildRideScores(null, acts, ftpFor, "2026-01-02");
    expect(entry.npUnverified).toBeUndefined();
  });
});

describe("mergeScoreLog", () => {
  const mk = (date: string, score: number): RideScoreEntry => ({
    date,
    executionScore: score,
    plannedType: "Z2",
    inferredType: "Z2",
    planned: true,
    legacy: false,
    compliancePct: 100,
    intensityFactor: 0.68,
    ftpUsed: 288,
    durationMin: 60,
    tss: 60,
  });

  it("is immutable: existing entries are frozen and fresh only fills new dates", () => {
    const existing = [mk("2026-01-01", 5), mk("2026-01-03", 6)];
    const fresh = [mk("2026-01-03", 9), mk("2026-01-02", 7)];
    const merged = mergeScoreLog(existing, fresh);
    expect(merged.map((e) => e.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    // 2026-01-03 already existed → kept at 6, not overwritten by the fresh 9.
    expect(merged.find((e) => e.date === "2026-01-03")?.executionScore).toBe(6);
    // 2026-01-02 is new → added.
    expect(merged.find((e) => e.date === "2026-01-02")?.executionScore).toBe(7);
  });

  it("caps the log length", () => {
    const many = Array.from({ length: 300 }, (_, i) => mk(`2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, 5));
    const merged = mergeScoreLog(many, []);
    expect(merged.length).toBeLessThanOrEqual(400);
  });

  it("fresh-wins direction (SYNC-2 rebuild): recomputed entries override existing, existing fills gaps", () => {
    // The ledger rebuild calls mergeScoreLog(fresh, existing) so corrected re-scores take effect on
    // overlapping dates, while an existing entry outside the activity window is preserved.
    const existing = [mk("2026-01-01", 5), mk("2026-01-03", 6)]; // 01-01 has no fresh counterpart
    const fresh = [mk("2026-01-03", 9), mk("2026-01-02", 7)];
    const merged = mergeScoreLog(fresh, existing);
    expect(merged.find((e) => e.date === "2026-01-03")?.executionScore).toBe(9); // fresh wins
    expect(merged.find((e) => e.date === "2026-01-01")?.executionScore).toBe(5); // kept (outside window)
    expect(merged.find((e) => e.date === "2026-01-02")?.executionScore).toBe(7);
  });
});

describe("mergeScoreLogRebuild (SYNC-2, LEDGER-1)", () => {
  const mk = (date: string, over: Partial<RideScoreEntry> = {}): RideScoreEntry => ({
    date,
    executionScore: 5,
    plannedType: "Z2",
    inferredType: "Z2",
    planned: true,
    legacy: false,
    compliancePct: 100,
    intensityFactor: 0.68,
    ftpUsed: 200,
    durationMin: 60,
    tss: 60,
    ...over,
  });

  it("re-scored fresh entries win on overlapping dates (corrected NP/decoupling re-flows)", () => {
    const merged = mergeScoreLogRebuild([mk("2026-01-03", { executionScore: 9 })], [mk("2026-01-03", { executionScore: 6 })]);
    expect(merged.find((e) => e.date === "2026-01-03")?.executionScore).toBe(9);
  });

  it("preserves an existing entry outside the activity window (no fresh counterpart)", () => {
    const merged = mergeScoreLogRebuild([mk("2026-01-03", { executionScore: 9 })], [mk("2026-01-01", { executionScore: 5 }), mk("2026-01-03", { executionScore: 6 })]);
    expect(merged.find((e) => e.date === "2026-01-01")?.executionScore).toBe(5);
  });

  it("never downgrades a frozen planned ride to off-plan when its block has rolled off (LEDGER-1)", () => {
    // buildRideScores only knows the CURRENT block, so a historical planned ride is re-derived as
    // off-plan. The rebuild must keep the frozen planned classification, not corrupt the planned axis.
    const existing = [mk("2026-01-03", { planned: true, plannedType: "VO2max", executionScore: 7, compliancePct: 95 })];
    const fresh = [mk("2026-01-03", { planned: false, plannedType: null, inferredType: "Z2", executionScore: 4, compliancePct: null })];
    const e = mergeScoreLogRebuild(fresh, existing).find((x) => x.date === "2026-01-03");
    expect(e?.planned).toBe(true);
    expect(e?.plannedType).toBe("VO2max");
    expect(e?.executionScore).toBe(7);
    expect(e?.compliancePct).toBe(95);
  });

  it("still re-scores off-plan rides (fresh wins where it is not un-planning a frozen entry)", () => {
    const existing = [mk("2026-01-05", { planned: false, plannedType: null, executionScore: 3 })];
    const fresh = [mk("2026-01-05", { planned: false, plannedType: null, executionScore: 8 })];
    expect(mergeScoreLogRebuild(fresh, existing).find((e) => e.date === "2026-01-05")?.executionScore).toBe(8);
  });

  it("lets the current block re-plan a date that used to be off-plan (planned wins, not a downgrade)", () => {
    const existing = [mk("2026-01-06", { planned: false, plannedType: null, executionScore: 3 })];
    const fresh = [mk("2026-01-06", { planned: true, plannedType: "Threshold", executionScore: 8 })];
    const e = mergeScoreLogRebuild(fresh, existing).find((x) => x.date === "2026-01-06");
    expect(e?.planned).toBe(true);
    expect(e?.plannedType).toBe("Threshold");
  });

  it("carries forward frozen form context the re-score can't reconstruct (LEDGER-2)", () => {
    // The wellness window is shorter than the activity window, so a rebuilt fresh entry for an old date has
    // no context. The original form stamp must survive — it's the correlation engine's input.
    const existing = [mk("2026-01-03", { planned: false, plannedType: null, formState: { tsb: -12, ctl: 50, atl: 62 } })];
    const fresh = [mk("2026-01-03", { planned: false, plannedType: null, executionScore: 8 })]; // re-scored, no context
    const e = mergeScoreLogRebuild(fresh, existing).find((x) => x.date === "2026-01-03");
    expect(e?.executionScore).toBe(8); // fresh re-score still wins
    expect(e?.formState).toEqual({ tsb: -12, ctl: 50, atl: 62 }); // provenance preserved
  });

  it("does not overwrite a fresh context stamp with the old one", () => {
    const existing = [mk("2026-01-03", { formState: { tsb: -12, ctl: 50, atl: 62 } })];
    const fresh = [mk("2026-01-03", { formState: { tsb: -5, ctl: 55, atl: 60 } })];
    const e = mergeScoreLogRebuild(fresh, existing).find((x) => x.date === "2026-01-03");
    expect(e?.formState).toEqual({ tsb: -5, ctl: 55, atl: 60 }); // fresh wins when it has its own
  });

  it("leaves a context-free entry context-free (no undefined keys introduced)", () => {
    const e = mergeScoreLogRebuild([mk("2026-01-03")], [mk("2026-01-03")]).find((x) => x.date === "2026-01-03")!;
    expect("formState" in e).toBe(false);
    expect("morningCheck" in e).toBe(false);
  });

  it("carries forward a frozen interval-adherence stamp the re-score lacks (LEDGER-2)", () => {
    const stamp = { adherencePct: 92, structuralMismatch: false, completed: 4, total: 4 };
    const existing = [mk("2026-01-03", { intervals: stamp })];
    const fresh = [mk("2026-01-03", { executionScore: 8 })]; // re-scored, no adherence stamp this time
    const e = mergeScoreLogRebuild(fresh, existing).find((x) => x.date === "2026-01-03");
    expect(e?.executionScore).toBe(8); // fresh re-score still wins
    expect(e?.intervals).toEqual(stamp); // provenance preserved
  });

  it("does not overwrite a fresh interval-adherence stamp with the old one", () => {
    const oldStamp = { adherencePct: 60, structuralMismatch: false, completed: 2, total: 4 };
    const newStamp = { adherencePct: 95, structuralMismatch: false, completed: 4, total: 4 };
    const existing = [mk("2026-01-03", { intervals: oldStamp })];
    const fresh = [mk("2026-01-03", { intervals: newStamp })];
    const e = mergeScoreLogRebuild(fresh, existing).find((x) => x.date === "2026-01-03");
    expect(e?.intervals).toEqual(newStamp); // fresh wins when it has its own
  });

  it("adds brand-new dates from fresh and keeps the log date-sorted", () => {
    const merged = mergeScoreLogRebuild([mk("2026-01-03"), mk("2026-01-02")], [mk("2026-01-01")]);
    expect(merged.map((e) => e.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });
});

const ftp200 = () => 200;

describe("buildRideScores — all rides (planned + off-plan)", () => {
  it("scores off-plan rides (on/after the floor) intrinsically and tags them not-legacy", () => {
    const b = block([{ date: "2026-01-01", type: "Z2", durationMin: 60 }]);
    const acts = [
      activity({ date: "2026-01-01", avgWatts: 135, normalizedPower: 138 }), // matches the plan
      activity({ date: "2026-01-03", avgWatts: 150, normalizedPower: 155, decoupling: 2 }), // off-plan
    ];
    const scores = buildRideScores(b, acts, ftp200, "2026-01-10", "2026-01-01");
    const planned = scores.find((s) => s.date === "2026-01-01");
    const offplan = scores.find((s) => s.date === "2026-01-03");
    expect(planned?.planned).toBe(true);
    expect(offplan?.planned).toBe(false);
    expect(offplan?.legacy).toBe(false);
    expect(offplan?.plannedType).toBeNull();
    expect(offplan?.inferredType).toBeTruthy();
    expect(offplan?.compliancePct).toBeNull();
  });

  it("keeps off-plan rides before the floor as history but flags them legacy", () => {
    const acts = [
      activity({ date: "2025-11-20", avgWatts: 140 }), // pre-app legacy, before the first block
      activity({ date: "2026-01-05", avgWatts: 140 }), // off-plan during structured training
    ];
    const scores = buildRideScores(null, acts, ftp200, "2026-01-10", "2026-01-01");
    expect(scores.map((s) => s.date)).toEqual(["2025-11-20", "2026-01-05"]); // both stored
    expect(scores.find((s) => s.date === "2025-11-20")?.legacy).toBe(true);
    expect(scores.find((s) => s.date === "2026-01-05")?.legacy).toBe(false);
  });

  it("flags every off-plan ride legacy when no block has ever existed (floor null)", () => {
    const acts = [activity({ date: "2026-01-02", avgWatts: 140 })];
    const scores = buildRideScores(null, acts, ftp200, "2026-01-10", null);
    expect(scores).toHaveLength(1);
    expect(scores[0].legacy).toBe(true);
  });

  it("keeps the longer ride when two land on one date", () => {
    const acts = [
      activity({ date: "2026-01-02", movingTimeSec: 1800 }),
      activity({ date: "2026-01-02", movingTimeSec: 5400 }),
    ];
    const scores = buildRideScores(null, acts, ftp200, "2026-01-10", "2026-01-01");
    expect(scores).toHaveLength(1);
    expect(scores[0].durationMin).toBe(90);
  });
});

describe("summariseBehaviour", () => {
  const entry = (over: Partial<RideScoreEntry> & { date: string }): RideScoreEntry => ({
    executionScore: 7,
    plannedType: "Z2",
    inferredType: "Z2",
    planned: true,
    legacy: false,
    compliancePct: 100,
    intensityFactor: 0.68,
    ftpUsed: 200,
    durationMin: 60,
    tss: 60,
    ...over,
  });

  it("computes off-plan frequency and unplanned quality", () => {
    const b = summariseBehaviour([
      entry({ date: "2026-01-01" }),
      entry({ date: "2026-01-03", planned: false, plannedType: null, executionScore: 6 }),
    ]);
    expect(b.totalRides).toBe(2);
    expect(b.plannedRides).toBe(1);
    expect(b.unplannedRides).toBe(1);
    expect(b.offPlanPct).toBe(50);
    expect(b.unplannedAvgQuality).toBe(6);
  });
});

describe("truncateBlockDays", () => {
  const days = [
    { date: "2026-06-15", name: "Z2 day", type: "Z2" as const, durationMin: 90 },
    { date: "2026-06-16", name: "Threshold day", type: "Threshold" as const, durationMin: 60 },
    { date: "2026-06-17", name: "Recovery day", type: "Recovery" as const, durationMin: 45 },
  ];

  it("keeps days on or before the cutoff, inclusive", () => {
    expect(truncateBlockDays(days, "2026-06-16").map((d) => d.date)).toEqual(["2026-06-15", "2026-06-16"]);
  });

  it("drops all days when the cutoff is before the block started", () => {
    expect(truncateBlockDays(days, "2026-06-01")).toEqual([]);
  });

  it("keeps every day when the cutoff is on/after the block's last day", () => {
    expect(truncateBlockDays(days, "2026-06-17")).toHaveLength(3);
    expect(truncateBlockDays(days, "2026-07-01")).toHaveLength(3);
  });
});
