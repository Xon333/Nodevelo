import { describe, expect, it } from "vitest";
import { describeFreshnessForAthlete, freshnessToneClasses } from "./physiology-freshness-display";
import type { PhysiologyFreshness } from "./types";

describe("describeFreshnessForAthlete", () => {
  it("uses the persisted athlete-local confirmation date", () => {
    const freshness = {
      state: "fresh",
      confirmedAt: "2026-08-23T23:30:00.000Z",
      confirmedDate: "2026-08-24",
      effectiveFrom: "2026-08-01",
    } as PhysiologyFreshness;

    expect(describeFreshnessForAthlete(freshness).text).toBe(
      "Physiology confirmed 2026-08-24 — current."
    );
  });

  it("owns the confirmed-today copy", () => {
    const freshness = {
      state: "fresh",
      confirmedAt: "2026-08-23T23:30:00.000Z",
      confirmedDate: "2026-08-24",
      effectiveFrom: "2026-08-01",
    } satisfies PhysiologyFreshness;

    expect(describeFreshnessForAthlete(freshness, "2026-08-24").text).toBe(
      "Physiology confirmed today — current."
    );
  });

  it("does not render a null age for legacy freshness metadata", () => {
    expect(describeFreshnessForAthlete({
      state: "stale",
      lastConfirmedAt: "2026-08-23T23:30:00.000Z",
      ageDays: null,
    }).text).toBe("Physiology confirmation date is unavailable — re-sync to confirm freshness.");
  });

  it("maps every freshness state to athlete-facing tone and copy", () => {
    expect(describeFreshnessForAthlete({
      state: "sync-failed",
      lastAttemptAt: "2026-08-24T00:00:00.000Z",
      lastDetail: "timeout",
      lastConfirmedAt: "2026-08-23T23:30:00.000Z",
      lastConfirmedDate: "2026-08-24",
    })).toEqual({ tone: "warn", text: "Physiology check failed (timeout); using values confirmed 2026-08-24." });
    expect(describeFreshnessForAthlete({ state: "stale", lastConfirmedAt: null, ageDays: null }).tone).toBe("warn");
    expect(describeFreshnessForAthlete({ state: "obsolete", markedObsoleteAt: "2026-08-24T00:00:00.000Z" }).text).not.toContain("2026-08-24");
    expect(describeFreshnessForAthlete({ state: "inconsistent", reason: "bad zones" }).tone).toBe("block");
    expect(describeFreshnessForAthlete({ state: "malformed", reason: "bad JSON" }).tone).toBe("block");
    expect(describeFreshnessForAthlete({ state: "missing" }).tone).toBe("block");
  });

  it("owns the shared panel, text, and banner classes for every tone", () => {
    for (const tone of ["ok", "warn", "block"] as const) {
      expect(freshnessToneClasses[tone].panel).toBeTruthy();
      expect(freshnessToneClasses[tone].text).toBeTruthy();
      expect(freshnessToneClasses[tone].banner).toBeTruthy();
    }
  });
});
