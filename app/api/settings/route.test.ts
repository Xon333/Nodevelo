import { beforeEach, describe, expect, it, vi } from "vitest";

// Integration test for the settings PUT wiring (SET-1). The data-store IO boundary is mocked in-memory;
// the override clamp-or-preserve logic runs for real. Guards the regression where PUT rebuilt the settings
// object from scratch and silently dropped the strainBands / durabilityInsertEnvelope / athleteStateWeights
// overrides — fields the sync / generate / morning-check routes read but that no save path persisted.
//
// HR-52: PUT now runs its whole read-validate-merge-write as one locked critical section via
// updateBlockSettings, not a readBlockSettings()-then-writeBlockSettings() pair. These tests mock
// updateBlockSettings to apply its captured mutate callback against a fixed "current" settings object —
// the same shape a real locked read would hand it — and assert on the route's own JSON response, which
// is built directly from updateBlockSettings' return value.
vi.mock("@/lib/data-store", () => ({
  readBlockSettings: vi.fn(),
  updateBlockSettings: vi.fn(),
}));

import * as store from "@/lib/data-store";
import { PUT } from "@/app/api/settings/route";
import { DEFAULT_BLOCK_SETTINGS } from "@/lib/types";
import type { BlockSettings } from "@/lib/types";

const base = (over: Partial<BlockSettings> = {}): BlockSettings => ({
  ...DEFAULT_BLOCK_SETTINGS,
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const updateMock = () => store.updateBlockSettings as ReturnType<typeof vi.fn>;
// Seeds what updateBlockSettings' mutate callback sees as the current on-disk settings — mirrors the
// real function applying `mutate` inside its lock against whatever's actually stored.
const seedCurrentSettings = (current: BlockSettings) => {
  updateMock().mockImplementation(async (mutate: (s: BlockSettings) => BlockSettings) => mutate(current));
};
const put = (body: unknown) => PUT(new Request("http://x/api/settings", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => vi.clearAllMocks());

describe("PUT /api/settings — calibration override persistence (SET-1)", () => {

  it("persists a durabilityInsertEnvelope override and preserves it when omitted", async () => {
    seedCurrentSettings(base());
    const json1 = await (await put({ durabilityInsertEnvelope: { embeddedHardPct: 90, maxIntensityPct: 120, maxEffortMin: 18 } })).json();
    expect(json1.durabilityInsertEnvelope).toEqual({ embeddedHardPct: 90, maxIntensityPct: 120, maxEffortMin: 18 });

    seedCurrentSettings(base({ durabilityInsertEnvelope: { embeddedHardPct: 92, maxIntensityPct: 118, maxEffortMin: 15 } }));
    const json2 = await (await put({ autoSyncOnOpen: false })).json(); // unrelated change
    expect(json2.durabilityInsertEnvelope).toEqual({ embeddedHardPct: 92, maxIntensityPct: 118, maxEffortMin: 15 });
  });

  it("preserves an existing athleteStateWeights override across an unrelated PUT (no wipe)", async () => {
    const w = { BASE: 60, tsb: { scale: 0.5 } };
    seedCurrentSettings(base({ athleteStateWeights: w }));
    const json = await (await put({ restDaysPerWeek: 2 })).json();
    expect(json.athleteStateWeights).toEqual(w);
  });

  it("accepts a new athleteStateWeights override, clamped via the resolver (CAL-1)", async () => {
    seedCurrentSettings(base());
    // The disable-the-safety-cap attack: scoreCap 100 / livedThreshold 99 must be clamped on the way in.
    const json = await (await put({ athleteStateWeights: { override: { scoreCap: 100, livedThreshold: 99 } } })).json();
    const w = json.athleteStateWeights!;
    expect(w.override!.scoreCap).toBe(70);
    expect(w.override!.livedThreshold).toBe(3);
    expect(w.BASE).toBe(60); // untouched leaves fall to population default
  });

  it("does not invent override fields when neither the body nor current settings carry them", async () => {
    seedCurrentSettings(base());
    const json = await (await put({ restDaysPerWeek: 2 })).json();
    expect(json.durabilityInsertEnvelope).toBeUndefined();
    expect(json.athleteStateWeights).toBeUndefined();
  });
});

describe("PUT /api/settings — weekly target and ceiling", () => {
  it("rejects a target above available time, without writing", async () => {
    seedCurrentSettings(base());
    const res = await put({ targetWeeklyHours: 20, maxAvailableHours: 6 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/target weekly hours can't exceed maximum available hours/i);
  });

  it("rejects a recovery-week min greater than max, without writing", async () => {
    seedCurrentSettings(base());
    const res = await put({ recoveryWeekHoursMin: 10, recoveryWeekHoursMax: 3 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/minimum hours can't be more than maximum/i);
  });

  it("rejects a recovery minimum above maximum available hours", async () => {
    seedCurrentSettings(base());
    const res = await put({
      targetWeeklyHours: 4,
      maxAvailableHours: 4,
      recoveryWeekHoursMin: 6,
      recoveryWeekHoursMax: 8,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/recovery.*minimum.*available/i);
  });

  it("accepts a valid target at or below the ceiling", async () => {
    seedCurrentSettings(base());
    const res = await put({ targetWeeklyHours: 6, maxAvailableHours: 20 });
    expect(res.status).toBe(200);
  });

  it("preserves lapButtonSteps across an unrelated PUT", async () => {
    seedCurrentSettings(base({ lapButtonSteps: true }));
    const json = await (await put({ restDaysPerWeek: 2 })).json();
    expect(json.lapButtonSteps).toBe(true);
  });
});

describe("PUT /api/settings — HR-52 (locked read-modify-write)", () => {
  it("preserves normalized numeric values outside current input bounds on an unrelated PUT", async () => {
    seedCurrentSettings(base({ targetWeeklyHours: 30, maxAvailableHours: 30 }));
    const json = await (await put({ lapButtonSteps: true })).json();
    expect(json.targetWeeklyHours).toBe(30);
    expect(json.maxAvailableHours).toBe(30);
  });

  it("merges onto whatever updateBlockSettings' lock actually hands it, not a value the route captured earlier", async () => {
    // Simulates the real guarantee: the settings inside the lock at mutate-time can differ from
    // anything the route itself might have read before calling updateBlockSettings (it doesn't read
    // at all anymore) — e.g. a concurrent PUT already changed autoPostCoachNote.
    const concurrentlyChanged = base({ autoPostCoachNote: false });
    seedCurrentSettings(concurrentlyChanged);
    const json = await (await put({ restDaysPerWeek: 2 })).json();
    expect(json.restDaysPerWeek).toBe(2); // the field this PUT touched
    expect(json.autoPostCoachNote).toBe(false); // the concurrent value the lock actually saw
  });
});
