import { describe, expect, it } from "vitest";
import { blockEventIds, staleEventIds } from "./block-events";
import type { CurrentBlock, CurrentBlockDay } from "./types";

const day = (date: string, eventId?: number | null): CurrentBlockDay => ({
  date,
  name: "S",
  type: "Z2",
  durationMin: 60,
  ...(eventId !== undefined ? { eventId } : {}),
});

const block = (days: CurrentBlockDay[]): CurrentBlock => ({
  goal: "g",
  lengthWeeks: 2,
  startDate: days[0]?.date ?? "2026-06-01",
  endDate: days[days.length - 1]?.date ?? "2026-06-14",
  overview: "",
  createdAt: "2026-06-01T00:00:00Z",
  days,
});

describe("blockEventIds", () => {
  it("collects the stored ids and skips days without one", () => {
    const b = block([day("2026-06-01", 11), day("2026-06-02"), day("2026-06-03", 13), day("2026-06-04", null)]);
    expect(blockEventIds(b)).toEqual([11, 13]);
  });
  it("returns [] for a null block", () => {
    expect(blockEventIds(null)).toEqual([]);
  });
});

describe("staleEventIds (prune on replace)", () => {
  const prev = block([
    day("2026-06-10", 1), // past, dropped → kept (don't delete history)
    day("2026-06-20", 2), // future, re-covered by new block → kept (upserted in place)
    day("2026-06-21", 3), // future, dropped → PRUNE
    day("2026-06-22", 4), // future, dropped, but no... has id → PRUNE
    day("2026-06-23"),    // future, dropped, no id → nothing to delete
  ]);
  const today = "2026-06-15";
  const newDates = ["2026-06-20", "2026-06-28"]; // new block re-covers 06-20

  it("prunes only future, dropped days that carry an id", () => {
    expect(staleEventIds(prev, newDates, today)).toEqual([3, 4]);
  });

  it("keeps a re-covered date (same uid is upserted, not orphaned)", () => {
    expect(staleEventIds(prev, newDates, today)).not.toContain(2);
  });

  it("keeps past days even when dropped (their calendar marker stays)", () => {
    expect(staleEventIds(prev, newDates, today)).not.toContain(1);
  });

  it("returns [] for a null previous block", () => {
    expect(staleEventIds(null, newDates, today)).toEqual([]);
  });
});
