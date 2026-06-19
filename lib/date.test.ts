import { describe, expect, it } from "vitest";
import { localToday, resolveToday, utcToday } from "./date";

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
