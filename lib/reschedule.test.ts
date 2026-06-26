import { describe, expect, it } from "vitest";
import { applyProactiveReschedule, suggestProactiveReschedule, suggestReschedule, type DispositionByDate } from "./reschedule";
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

describe("suggestProactiveReschedule / applyProactiveReschedule", () => {
  it("returns null when today isn't a quality day", () => {
    const b = block([day("2026-06-17", "Z2", 90), day("2026-06-18", "Rest", 0)]);
    expect(suggestProactiveReschedule(b, TODAY)).toBeNull();
    expect(suggestProactiveReschedule(null, TODAY)).toBeNull();
  });

  it("swaps onto the next easy day (load-preserving), skipping an earlier rest day (RR-1)", () => {
    const todayQuality: CurrentBlockDay = { date: "2026-06-17", name: "VO2 6x3", type: "VO2max", durationMin: 70, workoutText: "6x3m @ 320W" };
    const b = block([
      todayQuality, // today, quality
      day("2026-06-18", "Rest", 0), // a rest day — NOT a valid proactive target (raiding it adds load)
      day("2026-06-19", "Z2", 120), // the next easy day → the load-neutral swap target
    ]);
    const s = suggestProactiveReschedule(b, TODAY)!;
    expect(s).toMatchObject({ from: TODAY, fromType: "VO2max", to: "2026-06-19" }); // skipped the rest day

    const applied = applyProactiveReschedule(b, TODAY)!;
    expect(applied.deferred).toBeNull(); // a swap was found — nothing dropped
    const byDate = Object.fromEntries(applied.days.map((d) => [d.date, d]));
    // The quality work (with its workout) lands on the easy day…
    expect(byDate["2026-06-19"]).toMatchObject({ type: "VO2max", durationMin: 70, workoutText: "6x3m @ 320W" });
    // …today takes the easy ride that was there (a true swap — weekly load preserved)…
    expect(byDate[TODAY]).toMatchObject({ type: "Z2", durationMin: 120 });
    // …and the rest day is left alone.
    expect(byDate["2026-06-18"]).toMatchObject({ type: "Rest", durationMin: 0 });
  });

  it("does an honest deload (carry forward) instead of raiding a clear rest day (RR-1)", () => {
    const b = block([
      day("2026-06-17", "VO2max", 70), // today, quality
      day("2026-06-18", "Rest", 0), // a *clear* rest day (next day isn't quality) — deliberately NOT consumed
      day("2026-06-19", "Strength", 45), // not easy/quality → no swap slot, and keeps the 18th clear
    ]);
    const s = suggestProactiveReschedule(b, TODAY)!;
    expect(s.to).toBeNull(); // no easy slot → deload, don't add load to the rest day
    expect(s.skippedRestDay).toBe("2026-06-18"); // surfaced so the UI can explain we skipped it on purpose (RR-1)

    const applied = applyProactiveReschedule(b, TODAY)!;
    expect(applied.to).toBeNull();
    expect(applied.skippedRestDay).toBe("2026-06-18");
    expect(applied.deferred).toContain("VO2max"); // CR-6: the stimulus is carried forward, not lost
    const byDate = Object.fromEntries(applied.days.map((d) => [d.date, d]));
    expect(byDate[TODAY]).toMatchObject({ type: "Recovery" });
    expect(byDate[TODAY].name).toContain("downgraded from VO2max");
    expect(byDate["2026-06-18"]).toMatchObject({ type: "Rest", durationMin: 0 }); // rest day preserved
    expect(byDate["2026-06-19"]).toMatchObject({ type: "Strength", durationMin: 45 }); // untouched
  });

  it("caps the recovery downgrade at min(45, original) so it's never longer than the session it replaces (RR-2/CR-10)", () => {
    // Long quality day → recovery capped at 45. No rest day either → skippedRestDay stays null.
    const long = block([day("2026-06-17", "VO2max", 70), day("2026-06-18", "Threshold", 75)]);
    expect(suggestProactiveReschedule(long, TODAY)!.skippedRestDay).toBeNull();
    expect(applyProactiveReschedule(long, TODAY)!.days.find((d) => d.date === TODAY)).toMatchObject({ type: "Recovery", durationMin: 45 });

    // Short quality day → recovery never exceeds the original duration.
    const short = block([day("2026-06-17", "SIT", 30), day("2026-06-18", "Threshold", 75)]);
    expect(applyProactiveReschedule(short, TODAY)!.days.find((d) => d.date === TODAY)).toMatchObject({ type: "Recovery", durationMin: 30 });
  });
});
