import { describe, expect, it } from "vitest";
import { countsAsDrift, findLedgerEntry, originOf } from "./ride-origin";
import type { RideScoreEntry } from "./types";

describe("originOf — derived from `planned`, never stored", () => {
  it("is prescribed when a block covered the date", () => {
    expect(originOf({ planned: true })).toBe("prescribed");
  });

  it("is unspecified when no block covered the date", () => {
    expect(originOf({ planned: false })).toBe("unspecified");
    expect(originOf({ planned: false })).not.toBe("self-directed");
  });
});

describe("countsAsDrift", () => {
  it("counts an unspecified ride during structured training", () => {
    expect(countsAsDrift("unspecified", false)).toBe(true);
  });

  it("never counts a self-directed ride", () => {
    expect(countsAsDrift("self-directed", false)).toBe(false);
  });

  it("never counts a prescribed ride", () => {
    expect(countsAsDrift("prescribed", false)).toBe(false);
  });

  it("never counts a legacy ride, whatever its origin", () => {
    for (const origin of ["prescribed", "self-directed", "unspecified"] as const) {
      expect(countsAsDrift(origin, true)).toBe(false);
    }
  });
});

describe("findLedgerEntry", () => {
  const entry = (over: Partial<RideScoreEntry> = {}): RideScoreEntry => ({
    date: "2026-06-15",
    executionScore: 5,
    plannedType: null,
    inferredType: "Z2",
    planned: false,
    legacy: false,
    compliancePct: null,
    intensityFactor: 0.7,
    ftpUsed: 288,
    durationMin: 90,
    tss: 80,
    ...over,
  });

  it("matches by activityId first", () => {
    const a = entry({ activityId: "a1", date: "2026-06-14" });
    const b = entry({ activityId: "a2", date: "2026-06-15" });
    expect(findLedgerEntry([a, b], "a2", "2026-06-15")).toBe(b);
  });

  it("falls back to date when activityId is undefined (legacy TodayAnalysis record)", () => {
    const a = entry({ activityId: undefined, date: "2026-06-15" });
    expect(findLedgerEntry([a], undefined, "2026-06-15")).toBe(a);
  });

  it("returns null — NEVER falls back to date — when activityId is present but matches no entry", () => {
    // A same-day SECONDARY ride's ledger row must not be silently substituted for the primary ride
    // TodayAnalysis actually analysed. Mirrors resolveEffectiveOutcome's own id-present-never-date-
    // falls-back rule (lib/intent-overlay.ts) — this function must not diverge from that contract.
    const primary = entry({ activityId: "primary-ride", date: "2026-06-15" });
    const secondary = entry({ activityId: "secondary-ride", date: "2026-06-15", durationMin: 20 });
    expect(findLedgerEntry([primary, secondary], "missing-id", "2026-06-15")).toBeNull();
  });

  it("returns null when nothing matches either key", () => {
    const a = entry({ activityId: "a1", date: "2026-06-15" });
    expect(findLedgerEntry([a], "missing", "2026-06-16")).toBeNull();
  });
});
