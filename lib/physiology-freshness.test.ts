import { describe, expect, it } from "vitest";
import { assessPhysiologyFreshness, validateSnapshotConsistency } from "./physiology-freshness";
import type { PhysiologySnapshot, PhysiologyStatus, PhysiologyStore } from "./types";

const snap = (over: Partial<PhysiologySnapshot> = {}): PhysiologySnapshot => ({
  effectiveFrom: "2026-08-01",
  capturedAt: "2026-08-01T00:00:00.000Z",
  source: "intervals",
  ftp: 280,
  lthr: 155,
  maxHr: 190,
  powerZonePct: [55, 75, 90, 105, 120, 150],
  hrZones: [130, 150, 165, 180],
  hrZonesAreBpm: true,
  powerZoneNames: [],
  hrZoneNames: [],
  ...over,
});

const store = (over: Partial<PhysiologySnapshot> = {}): PhysiologyStore => ({
  current: snap(over),
  history: [],
});

const iso = (daysAgo: number, from: string) =>
  new Date(Date.parse(from) - daysAgo * 86_400_000).toISOString();

const TODAY = "2026-08-23";

const baseInput = (
  over: Partial<Parameters<typeof assessPhysiologyFreshness>[0]> = {}
): Parameters<typeof assessPhysiologyFreshness>[0] => ({
  store: store(),
  corruptFallback: false,
  fileExisted: true,
  statusCorrupt: false,
  status: {
    lastAttemptAt: iso(0, TODAY),
    lastOutcome: "confirmed",
    lastConfirmedAt: iso(0, TODAY),
  } satisfies PhysiologyStatus,
  today: TODAY,
  ...over,
});

describe("validateSnapshotConsistency", () => {
  it("accepts a coherent intervals snapshot", () => {
    expect(validateSnapshotConsistency(snap())).toEqual({ ok: true });
  });

  it("accepts a manual-source snapshot identically", () => {
    expect(validateSnapshotConsistency(snap({ source: "manual" }))).toEqual({ ok: true });
  });

  it("rejects non-positive or non-finite FTP", () => {
    expect(validateSnapshotConsistency(snap({ ftp: 0 })).ok).toBe(false);
    expect(validateSnapshotConsistency(snap({ ftp: Number.NaN })).ok).toBe(false);
  });

  it("rejects non-ascending power-zone bounds", () => {
    expect(validateSnapshotConsistency(snap({ powerZonePct: [75, 75, 90] })).ok).toBe(false);
    expect(validateSnapshotConsistency(snap({ powerZonePct: [90, 75] })).ok).toBe(false);
  });

  it("rejects non-ascending HR-zone bounds", () => {
    expect(validateSnapshotConsistency(snap({ hrZones: [180, 150] })).ok).toBe(false);
  });

  it("rejects percent HR zones with neither lthr nor maxHr to anchor them", () => {
    expect(
      validateSnapshotConsistency(snap({ hrZonesAreBpm: false, lthr: null, maxHr: null })).ok
    ).toBe(false);
  });

  it("accepts percent HR zones when an anchor exists", () => {
    expect(
      validateSnapshotConsistency(snap({ hrZonesAreBpm: false, lthr: null, maxHr: 190 })).ok
    ).toBe(true);
  });

  it("rejects lthr above maxHr when both are present", () => {
    expect(validateSnapshotConsistency(snap({ lthr: 195, maxHr: 190 })).ok).toBe(false);
  });
});

describe("assessPhysiologyFreshness", () => {
  it("is fresh after a recent confirmation", () => {
    expect(assessPhysiologyFreshness(baseInput())).toEqual({
      state: "fresh",
      confirmedAt: iso(0, TODAY),
      effectiveFrom: "2026-08-01",
    });
  });

  it("is stale when the last confirmation exceeds 90 days", () => {
    const status: PhysiologyStatus = {
      lastAttemptAt: iso(120, TODAY),
      lastOutcome: "confirmed",
      lastConfirmedAt: iso(120, TODAY),
    };
    const freshness = assessPhysiologyFreshness(baseInput({ status }));
    expect(freshness.state).toBe("stale");
    if (freshness.state === "stale") {
      expect(freshness.ageDays).toBe(120);
    }
  });

  it("is stale with null clock for a legacy store that predates freshness tracking", () => {
    expect(assessPhysiologyFreshness(baseInput({ status: undefined }))).toEqual({
      state: "stale",
      lastConfirmedAt: null,
      ageDays: null,
    });
  });

  it("warns sync-failed when the latest check failed but the store was recently confirmed", () => {
    expect(
      assessPhysiologyFreshness(
        baseInput({
          status: {
            lastAttemptAt: iso(0, TODAY),
            lastOutcome: "unavailable",
            lastDetail: "Intervals.icu request failed: network timeout",
            lastConfirmedAt: iso(2, TODAY),
          },
        })
      )
    ).toEqual({
      state: "sync-failed",
      lastAttemptAt: iso(0, TODAY),
      lastDetail: "Intervals.icu request failed: network timeout",
      lastConfirmedAt: iso(2, TODAY),
    });
  });

  it("degrades an ancient failed attempt to stale instead of sync-failed", () => {
    const freshness = assessPhysiologyFreshness(
      baseInput({
        status: {
          lastAttemptAt: iso(200, TODAY),
          lastOutcome: "unavailable",
          lastDetail: "old outage",
          lastConfirmedAt: iso(200, TODAY),
        },
      })
    );
    expect(freshness.state).toBe("stale");
  });

  it("is missing when no store file ever existed", () => {
    expect(
      assessPhysiologyFreshness(baseInput({ store: null, fileExisted: false })).state
    ).toBe("missing");
  });

  it("is malformed for a corrupt file", () => {
    expect(assessPhysiologyFreshness(baseInput({ corruptFallback: true }))).toEqual({
      state: "malformed",
      reason: "physiology.json does not parse",
    });
  });

  it("is malformed for a parsed but shapeless store", () => {
    expect(assessPhysiologyFreshness(baseInput({ store: null, fileExisted: true }))).toEqual({
      state: "malformed",
      reason: "physiology.json parsed but has no usable current snapshot",
    });
  });

  it("is inconsistent when the current snapshot contradicts itself", () => {
    const freshness = assessPhysiologyFreshness(baseInput({ store: store({ ftp: -5 }) }));
    expect(freshness.state).toBe("inconsistent");
    if (freshness.state === "inconsistent") {
      expect(freshness.reason).toContain("FTP");
    }
  });

  it("is obsolete when the athlete marked it so", () => {
    expect(
      assessPhysiologyFreshness(
        baseInput({
          status: {
            ...baseInput().status,
            markedObsoleteAt: iso(1, TODAY),
            lastOutcome: "unavailable",
          },
        })
      )
    ).toEqual({
      state: "obsolete",
      markedObsoleteAt: iso(1, TODAY),
    });
  });

  it("applies malformed, missing, and inconsistent precedence ahead of obsolete", () => {
    const assess = (over: Partial<Parameters<typeof assessPhysiologyFreshness>[0]>) =>
      assessPhysiologyFreshness(baseInput(over)).state;

    expect(
      assess({
        store: store({ ftp: -1 }),
        status: { ...baseInput().status, markedObsoleteAt: iso(1, TODAY) },
      })
    ).toBe("inconsistent");
    expect(
      assess({
        store: null,
        fileExisted: false,
        status: {
          ...baseInput().status,
          markedObsoleteAt: iso(1, TODAY),
          lastOutcome: "unavailable",
        },
      })
    ).toBe("missing");
    expect(assess({ corruptFallback: true, fileExisted: false })).toBe("malformed");
  });

  it("treats a corrupt status file as malformed to fail closed", () => {
    const freshness = assessPhysiologyFreshness(baseInput({ statusCorrupt: true }));
    expect(freshness.state).toBe("malformed");
    if (freshness.state === "malformed") {
      expect(freshness.reason).toContain("freshness records");
    }
  });

  it("ignores history contents for the freshness verdict", () => {
    const withHistory = store();
    withHistory.history = [snap({ effectiveFrom: "2020-01-01", ftp: 999 })];
    expect(assessPhysiologyFreshness(baseInput({ store: withHistory }))).toEqual(
      assessPhysiologyFreshness(baseInput())
    );
  });

  it("treats manual-source snapshots the same as intervals snapshots", () => {
    expect(assessPhysiologyFreshness(baseInput({ store: store({ source: "manual" }) })).state).toBe(
      "fresh"
    );
  });

  it("uses only the supplied dates for deterministic UTC day math", () => {
    const input = baseInput();
    expect(assessPhysiologyFreshness(input)).toEqual(assessPhysiologyFreshness(input));
  });
});
