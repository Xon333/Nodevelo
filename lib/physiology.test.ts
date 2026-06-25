import { describe, expect, it } from "vitest";
import {
  parseSportSettings,
  physiologyAsOf,
  reconcile,
  resolveHrZones,
  resolvePowerZones,
} from "./physiology";
import type { PhysiologySnapshot, PhysiologyStore } from "./types";

const snap = (over: Partial<PhysiologySnapshot> = {}): PhysiologySnapshot => ({
  effectiveFrom: "2026-01-01",
  capturedAt: "2026-01-01T00:00:00.000Z",
  source: "intervals",
  ftp: 288,
  lthr: 179,
  maxHr: 200,
  powerZonePct: [59, 75, 90, 105, 120, 150],
  hrZones: [120, 152, 170, 182, 194],
  hrZonesAreBpm: true,
  powerZoneNames: [],
  hrZoneNames: [],
  ...over,
});

describe("parseSportSettings", () => {
  it("picks the Ride sport setting and reads % power zones + scalars", () => {
    const raw = [
      { types: ["Run"], ftp: 250, power_zones: [60, 80, 100] },
      { types: ["Ride", "VirtualRide"], ftp: 300, lthr: 165, max_hr: 195, power_zones: [55, 75, 90, 105, 120, 150], hr_zones: [123, 142, 160, 178, 197, 220] },
    ];
    const s = parseSportSettings(raw, "2026-06-15");
    expect(s).not.toBeNull();
    expect(s!.ftp).toBe(300);
    expect(s!.lthr).toBe(165);
    expect(s!.maxHr).toBe(195);
    expect(s!.powerZonePct).toEqual([55, 75, 90, 105, 120, 150]);
    expect(s!.source).toBe("intervals");
    expect(s!.effectiveFrom).toBe("2026-06-15");
  });

  it("drops a leading zero bound and detects absolute-bpm HR zones", () => {
    const s = parseSportSettings([{ types: ["Ride"], ftp: 300, hr_zones: [0, 123, 142, 160, 178, 197, 220] }], "2026-06-15");
    expect(s!.hrZones).toEqual([123, 142, 160, 178, 197, 220]);
    expect(s!.hrZonesAreBpm).toBe(true);
  });

  it("treats small HR bounds as % of LTHR", () => {
    const s = parseSportSettings([{ types: ["Ride"], ftp: 300, lthr: 165, hr_zones: [75, 86, 97, 108, 119] }], "2026-06-15");
    expect(s!.hrZonesAreBpm).toBe(false);
  });

  it("returns null when no FTP is present", () => {
    expect(parseSportSettings([{ types: ["Ride"] }], "2026-06-15")).toBeNull();
    expect(parseSportSettings([], "2026-06-15")).toBeNull();
  });

  it("accepts a wrapped { sportSettings: [...] } shape", () => {
    const s = parseSportSettings({ sportSettings: [{ types: ["Ride"], ftp: 280, power_zones: [55, 75] }] }, "2026-06-15");
    expect(s!.ftp).toBe(280);
  });
});

describe("resolvePowerZones / resolveHrZones", () => {
  it("resolves % power bounds to contiguous watt zones with an open top", () => {
    const zones = resolvePowerZones(snap());
    expect(zones).toHaveLength(7); // 6 bounds → 7 zones
    expect(zones[0]).toEqual({ name: "Z1", lo: 0, hi: 170 }); // 59% of 288
    expect(zones[1]).toEqual({ name: "Z2", lo: 170, hi: 216 });
    expect(zones[6]).toEqual({ name: "Z7", lo: 432, hi: null });
  });

  it("uses bpm bounds directly when hrZonesAreBpm", () => {
    const zones = resolveHrZones(snap());
    expect(zones[0]).toEqual({ name: "Z1", lo: 0, hi: 120 });
    expect(zones[zones.length - 1].hi).toBeNull();
  });

  it("scales %-of-LTHR HR bounds by lthr", () => {
    const zones = resolveHrZones(snap({ hrZones: [75, 86, 97], hrZonesAreBpm: false, lthr: 160 }));
    expect(zones[0]).toEqual({ name: "Z1", lo: 0, hi: 120 }); // 75% of 160
  });
});

describe("physiologyAsOf", () => {
  const store: PhysiologyStore = {
    history: [
      snap({ effectiveFrom: "2026-01-01", ftp: 270 }),
      snap({ effectiveFrom: "2026-04-15", ftp: 288 }),
    ],
    current: snap({ effectiveFrom: "2026-06-10", ftp: 300 }),
  };

  it("returns the snapshot in effect on a given date", () => {
    expect(physiologyAsOf(store, "2026-02-01")!.ftp).toBe(270);
    expect(physiologyAsOf(store, "2026-05-01")!.ftp).toBe(288);
    expect(physiologyAsOf(store, "2026-06-12")!.ftp).toBe(300);
  });

  it("anchors dates before the earliest snapshot to the earliest", () => {
    expect(physiologyAsOf(store, "2025-12-01")!.ftp).toBe(270);
  });

  it("returns null with no store", () => {
    expect(physiologyAsOf(null, "2026-01-01")).toBeNull();
  });
});

describe("reconcile", () => {
  it("seeds the store on first capture without flagging a change", () => {
    const { store, changed } = reconcile(null, snap({ ftp: 288 }), "2026-06-15");
    expect(changed).toBe(false);
    expect(store.history).toHaveLength(0);
    expect(store.current.ftp).toBe(288);
  });

  it("keeps the original effective date when physiology is unchanged", () => {
    const prev: PhysiologyStore = { current: snap({ ftp: 288, effectiveFrom: "2026-01-01" }), history: [] };
    const { store, changed } = reconcile(prev, snap({ ftp: 288, effectiveFrom: "2026-06-15" }), "2026-06-15");
    expect(changed).toBe(false);
    expect(store.current.effectiveFrom).toBe("2026-01-01");
  });

  it("archives the old snapshot and starts the new one today when FTP changes", () => {
    const prev: PhysiologyStore = { current: snap({ ftp: 288, effectiveFrom: "2026-01-01" }), history: [] };
    const { store, changed } = reconcile(prev, snap({ ftp: 300, effectiveFrom: "2026-06-15" }), "2026-06-15");
    expect(changed).toBe(true);
    expect(store.history).toHaveLength(1);
    expect(store.history[0].ftp).toBe(288);
    expect(store.current.ftp).toBe(300);
    expect(store.current.effectiveFrom).toBe("2026-06-15");
  });

  it("bounds history growth, keeping the most recent snapshots (RV-5b)", () => {
    // 40 successive FTP changes; history must cap (current + 23 = 24 retained), keeping the newest.
    let store: PhysiologyStore = { current: snap({ ftp: 200, effectiveFrom: "2026-01-01" }), history: [] };
    for (let i = 1; i <= 40; i++) {
      store = reconcile(store, snap({ ftp: 200 + i, effectiveFrom: `2026-02-${String(i).padStart(2, "0")}` }), `2026-02-${String(i).padStart(2, "0")}`).store;
    }
    expect(store.history.length).toBe(23); // + current = 24
    expect(store.current.ftp).toBe(240); // newest change retained
    // Oldest snapshots dropped; the earliest retained is well past the original 200.
    expect(Math.min(...store.history.map((h) => h.ftp))).toBeGreaterThan(200);
    expect(store.history.some((h) => h.ftp === 239)).toBe(true); // recent ones kept
  });
});
