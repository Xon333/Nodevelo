import { describe, expect, it } from "vitest";
import { localToday, resolveToday, utcToday, isBlockFinished, addDaysIso, ageYearsFrom } from "./date";
import type { CurrentBlock } from "./types";

describe("localToday", () => {
  it("formats a date's LOCAL components as YYYY-MM-DD (no UTC shift)", () => {
    // June (month index 5) → "06"; uses local getters, so no toISOString UTC drift.
    expect(localToday(new Date(2026, 5, 8))).toBe("2026-06-08");
    expect(localToday(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
  it("returns a valid ISO date for now", () => {
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("resolveToday", () => {
  it("uses a valid client-supplied local date", () => {
    expect(resolveToday("2026-06-18")).toBe("2026-06-18");
  });
  it("falls back to UTC for missing or malformed input", () => {
    expect(resolveToday(undefined)).toBe(utcToday());
    expect(resolveToday("")).toBe(utcToday());
    expect(resolveToday("garbage")).toBe(utcToday());
    expect(resolveToday("2026-6-1")).toBe(utcToday()); // wrong format → fallback
    expect(resolveToday(20260618)).toBe(utcToday()); // not a string → fallback
  });
});

describe("isBlockFinished", () => {
  const block = (endDate: string): CurrentBlock => ({
    goal: "g", lengthWeeks: 4, startDate: "2026-06-01", endDate, overview: "", createdAt: "", days: [],
  });
  it("is true once today is after the block's endDate", () => {
    expect(isBlockFinished(block("2026-06-28"), "2026-06-29")).toBe(true);
  });
  it("is false when today is on or before the block's endDate", () => {
    expect(isBlockFinished(block("2026-06-28"), "2026-06-28")).toBe(false);
    expect(isBlockFinished(block("2026-06-28"), "2026-06-20")).toBe(false);
  });
  it("is false when there is no block", () => {
    expect(isBlockFinished(null, "2026-06-29")).toBe(false);
  });
});

describe("addDaysIso", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDaysIso("2026-07-08", 1)).toBe("2026-07-09");
    expect(addDaysIso("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("subtracts with negative n and handles leap days", () => {
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("ageYearsFrom", () => {
  it("derives whole years", () => {
    expect(ageYearsFrom("1996-03-14", "2026-07-30")).toBe(30);
  });

  it("has not counted a birthday that has not happened yet this year", () => {
    expect(ageYearsFrom("1996-12-14", "2026-07-30")).toBe(29);
  });

  it("counts the birthday itself", () => {
    expect(ageYearsFrom("1996-07-30", "2026-07-30")).toBe(30);
  });

  it("does not count the day before the birthday", () => {
    expect(ageYearsFrom("1996-07-31", "2026-07-30")).toBe(29);
  });

  it("rejects malformed or implausible input rather than returning a wrong number", () => {
    expect(ageYearsFrom("not-a-date", "2026-07-30")).toBeNull();
    expect(ageYearsFrom("2027-01-01", "2026-07-30")).toBeNull(); // future DOB
  });
});
