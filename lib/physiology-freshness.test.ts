import { describe, expect, it } from "vitest";
import { validateSnapshotConsistency } from "./physiology-freshness";
import type { PhysiologySnapshot } from "./types";

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
