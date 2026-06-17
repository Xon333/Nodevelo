import { describe, expect, it } from "vitest";
import { suggestReschedule, type DispositionByDate } from "./reschedule";
import type { CurrentBlock, CurrentBlockDay, WorkoutType } from "./types";

const day = (date: string, type: WorkoutType, durationMin: number): CurrentBlockDay => ({
  date,
  name: `${type} session`,
  type,
  durationMin,
});

// today = 2026-06-17 for these fixtures
const TODAY = "2026-06-17";
const block = (days: CurrentBlockDay[]): CurrentBlock => ({
  goal: "g",
  lengthWeeks: 2,
  startDate: days[0].date,
  endDate: days[days.length - 1].date,
  overview: "",
  createdAt: "2026-06-15T00:00:00.000Z",
  days,
});

describe("suggestReschedule", () => {
  it("returns null with no block", () => {
    expect(suggestReschedule(null, new Set(), {}, TODAY)).toBeNull();
  });

  it("flags a missed (no-ride) quality day and offers the next clear rest day", () => {
    const b = block([
      day("2026-06-16", "Threshold", 75), // yesterday, no ride logged → missed
      day("2026-06-17", "Z2", 90), // today
      day("2026-06-18", "Rest", 0), // future rest, neighbours are Z2/Z2 → valid slot
      day("2026-06-19", "Z2", 60),
    ]);
    const s = suggestReschedule(b, new Set([]), {}, TODAY)!;
    expect(s.from).toBe("2026-06-16");
    expect(s.fromType).toBe("Threshold");
    expect(s.reason).toBe("missed");
    expect(s.to).toBe("2026-06-18");
  });

  it("treats a compromised day as not-delivered even if a ride exists", () => {
    const b = block([day("2026-06-16", "VO2max", 70), day("2026-06-18", "Rest", 0)]);
    const disp: DispositionByDate = { "2026-06-16": "compromised" };
    const s = suggestReschedule(b, new Set(["2026-06-16"]), disp, TODAY)!;
    expect(s.reason).toBe("compromised");
    expect(s.to).toBe("2026-06-18");
  });

  it("does not flag a delivered quality day", () => {
    const b = block([day("2026-06-16", "Threshold", 75), day("2026-06-18", "Rest", 0)]);
    expect(suggestReschedule(b, new Set(["2026-06-16"]), {}, TODAY)).toBeNull();
  });

  it("won't put the make-up next to another quality day; to=null if no clear rest slot", () => {
    const b = block([
      day("2026-06-16", "Threshold", 75), // missed
      day("2026-06-18", "VO2max", 70), // future quality
      day("2026-06-19", "Rest", 0), // rest but flanked by the VO2max on the 18th
    ]);
    const s = suggestReschedule(b, new Set([]), {}, TODAY)!;
    expect(s.from).toBe("2026-06-16");
    expect(s.to).toBeNull(); // no rest day clear of adjacent quality → carry forward
  });
});
