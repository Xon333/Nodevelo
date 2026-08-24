import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  assessPhysiologyFreshness,
  clearPhysiologyObsolete,
  describeFreshnessForAthlete,
  markPhysiologyObsolete,
  physiologyGenerationBlock,
  physiologyGenerationWarning,
  readPhysiologyStatus,
  recordPhysiologyCheck,
  validateSnapshotConsistency,
} from "./physiology-freshness";
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

  it("treats invalid today and status timestamps as malformed before freshness math", () => {
    expect(
      assessPhysiologyFreshness(
        baseInput({
          today: "garbage",
        })
      )
    ).toEqual({
      state: "malformed",
      reason: 'today "garbage" is not a valid date',
    });

    expect(
      assessPhysiologyFreshness(
        baseInput({
          status: {
            ...baseInput().status,
            lastConfirmedAt: "garbage",
          },
        })
      )
    ).toEqual({
      state: "malformed",
      reason: 'lastConfirmedAt "garbage" is not a valid date',
    });
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

describe("describeFreshnessForAthlete", () => {
  it("maps each freshness verdict to deterministic athlete-facing copy", () => {
    expect(
      describeFreshnessForAthlete({
        state: "fresh",
        confirmedAt: "2026-08-24T09:15:00.000Z",
        effectiveFrom: "2026-08-24",
      })
    ).toEqual({
      tone: "ok",
      text: "Physiology confirmed 2026-08-24 — current.",
    });

    expect(
      describeFreshnessForAthlete({
        state: "sync-failed",
        lastAttemptAt: "2026-08-24T09:15:00.000Z",
        lastDetail: "Intervals.icu timeout",
        lastConfirmedAt: "2026-08-22T09:15:00.000Z",
      })
    ).toEqual({
      tone: "warn",
      text: "Physiology check failed (Intervals.icu timeout); using values confirmed 2026-08-22.",
    });

    expect(
      describeFreshnessForAthlete({
        state: "stale",
        lastConfirmedAt: null,
        ageDays: null,
      })
    ).toEqual({
      tone: "warn",
      text: "Physiology has never been confirmed since freshness tracking began — re-sync to confirm.",
    });

    expect(
      describeFreshnessForAthlete({
        state: "obsolete",
        markedObsoleteAt: "2026-08-24T09:15:00.000Z",
      })
    ).toEqual({
      tone: "block",
      text: "Physiology marked obsolete 2026-08-24 — generation blocked until re-synced.",
    });

    expect(
      describeFreshnessForAthlete({
        state: "inconsistent",
        reason: "power-zone bounds are not strictly ascending",
      })
    ).toEqual({
      tone: "block",
      text: "Physiology inconsistent (power-zone bounds are not strictly ascending) — generation blocked until refreshed.",
    });

    expect(
      describeFreshnessForAthlete({
        state: "malformed",
        reason: "physiology.json does not parse",
      })
    ).toEqual({
      tone: "block",
      text: "Physiology store is unreadable — restore its backup or re-sync. Generation blocked.",
    });

    expect(describeFreshnessForAthlete({ state: "missing" })).toEqual({
      tone: "block",
      text: "No physiology yet — connect Intervals.icu and sync. Generation blocked.",
    });
  });
});

describe("generation gate helpers", () => {
  it.each([
    [
      { state: "missing" } as const,
      "Physiology has never been established",
    ],
    [
      { state: "malformed", reason: "does not parse" } as const,
      "Physiology store is unreadable",
    ],
    [
      { state: "inconsistent", reason: "FTP -1 is not positive" } as const,
      "Physiology data is internally inconsistent",
    ],
    [
      { state: "obsolete", markedObsoleteAt: "2026-08-20T00:00:00.000Z" } as const,
      "Physiology was marked obsolete on 2026-08-20",
    ],
  ])("blocks %o with the expected message", (freshness, expected) => {
    expect(physiologyGenerationBlock(freshness)).toContain(expected);
  });

  it.each([
    { state: "fresh", confirmedAt: iso(0, TODAY), effectiveFrom: "2026-08-01" } as const,
    {
      state: "sync-failed",
      lastAttemptAt: iso(0, TODAY),
      lastDetail: "timeout",
      lastConfirmedAt: iso(2, TODAY),
    } as const,
    { state: "stale", lastConfirmedAt: iso(120, TODAY), ageDays: 120 } as const,
  ])("does not block %o", (freshness) => {
    expect(physiologyGenerationBlock(freshness)).toBeNull();
  });

  it("warns through a recent sync failure", () => {
    expect(
      physiologyGenerationWarning({
        state: "sync-failed",
        lastAttemptAt: iso(0, TODAY),
        lastDetail: "timeout",
        lastConfirmedAt: iso(2, TODAY),
      })
    ).toBe(
      `Generating on physiology last confirmed ${iso(2, TODAY).slice(0, 10)}; the latest check failed (timeout).`
    );
  });

  it("warns through stale physiology", () => {
    expect(
      physiologyGenerationWarning({
        state: "stale",
        lastConfirmedAt: iso(120, TODAY),
        ageDays: 120,
      })
    ).toBe("Physiology has not been confirmed in 120 days; zones and TSS may be outdated.");
  });

  it.each([
    { state: "fresh", confirmedAt: iso(0, TODAY), effectiveFrom: "2026-08-01" } as const,
    { state: "missing" } as const,
    { state: "malformed", reason: "does not parse" } as const,
    { state: "inconsistent", reason: "FTP -1 is not positive" } as const,
    { state: "obsolete", markedObsoleteAt: "2026-08-20T00:00:00.000Z" } as const,
  ])("does not warn for %o", (freshness) => {
    expect(physiologyGenerationWarning(freshness)).toBeNull();
  });
});

describe("physiology status IO", () => {
  let dir: string;
  const p = (file: string) => path.join(dir, file);

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "nodevelo-phys-"));
    process.env.NODEVELO_DATA_DIR = dir;
  });

  afterAll(async () => {
    delete process.env.NODEVELO_DATA_DIR;
    await fs.rm(dir, { recursive: true, force: true });
  });

  afterEach(async () => {
    for (const f of await fs.readdir(dir)) await fs.rm(p(f), { force: true });
  });

  it("returns an empty status for a missing file", async () => {
    await expect(readPhysiologyStatus()).resolves.toEqual({
      status: {},
      corruptFallback: false,
      liveCorrupt: false,
    });
  });

  it("flags a corrupt status file instead of silently reading empty", async () => {
    await fs.writeFile(p("physiology-status.json"), "{not json");
    const { corruptFallback, liveCorrupt } = await readPhysiologyStatus();
    expect(corruptFallback).toBe(true);
    expect(liveCorrupt).toBe(true);
  });

  it("fails closed for a parsed status object with invalid field types", async () => {
    await fs.writeFile(p("physiology-status.json"), JSON.stringify({ markedObsoleteAt: 42 }));
    await expect(readPhysiologyStatus()).resolves.toEqual({
      status: {},
      corruptFallback: true,
      liveCorrupt: false,
    });
  });

  it("records a confirmation: stamps attempt + confirmed and drops the obsolete marker", async () => {
    await markPhysiologyObsolete();
    await recordPhysiologyCheck("2026-08-23T10:00:00.000Z", "confirmed");
    const s = await readPhysiologyStatus();
    expect(s.status.lastAttemptAt).toBe("2026-08-23T10:00:00.000Z");
    expect(s.status.lastOutcome).toBe("confirmed");
    expect(s.status.lastConfirmedAt).toBe("2026-08-23T10:00:00.000Z");
    expect(s.status.markedObsoleteAt).toBeUndefined();
  });

  it("records a failure without touching lastConfirmedAt", async () => {
    await recordPhysiologyCheck("2026-08-22T09:00:00.000Z", "confirmed");
    await recordPhysiologyCheck("2026-08-23T10:00:00.000Z", "unavailable", "network timeout");
    const s = await readPhysiologyStatus();
    expect(s.status.lastAttemptAt).toBe("2026-08-23T10:00:00.000Z");
    expect(s.status.lastOutcome).toBe("unavailable");
    expect(s.status.lastDetail).toBe("network timeout");
    expect(s.status.lastConfirmedAt).toBe("2026-08-22T09:00:00.000Z");
  });

  it("marks and manually clears obsolescence", async () => {
    await markPhysiologyObsolete();
    expect((await readPhysiologyStatus()).status.markedObsoleteAt).toBeTruthy();
    await clearPhysiologyObsolete();
    expect((await readPhysiologyStatus()).status.markedObsoleteAt).toBeUndefined();
  });

  it("survives a legacy status file missing newer fields", async () => {
    await fs.writeFile(
      p("physiology-status.json"),
      JSON.stringify({ lastConfirmedAt: "2026-07-01T00:00:00.000Z" })
    );
    await recordPhysiologyCheck("2026-08-23T10:00:00.000Z", "invalid", "no ride settings");
    const s = await readPhysiologyStatus();
    expect(s.status.lastConfirmedAt).toBe("2026-07-01T00:00:00.000Z");
    expect(s.status.lastOutcome).toBe("invalid");
    expect(s.status.lastDetail).toBe("no ride settings");
  });
});
