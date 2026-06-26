import { beforeEach, describe, expect, it, vi } from "vitest";

// Integration test for the settings PUT wiring (SET-1). The data-store IO boundary is mocked in-memory;
// the override clamp-or-preserve logic runs for real. Guards the regression where PUT rebuilt the settings
// object from scratch and silently dropped the strainBands / durabilityInsertEnvelope / athleteStateWeights
// overrides — fields the sync / generate / morning-check routes read but that no save path persisted.
vi.mock("@/lib/data-store", () => ({
  readBlockSettings: vi.fn(),
  writeBlockSettings: vi.fn(),
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

const readMock = () => store.readBlockSettings as ReturnType<typeof vi.fn>;
const writeMock = () => store.writeBlockSettings as ReturnType<typeof vi.fn>;
const put = (body: unknown) => PUT(new Request("http://x/api/settings", { method: "PUT", body: JSON.stringify(body) }));
const lastWritten = (): BlockSettings => writeMock().mock.calls.at(-1)![0] as BlockSettings;

beforeEach(() => vi.clearAllMocks());

describe("PUT /api/settings — calibration override persistence (SET-1)", () => {

  it("persists a durabilityInsertEnvelope override and preserves it when omitted", async () => {
    readMock().mockResolvedValue(base());
    await put({ durabilityInsertEnvelope: { embeddedHardPct: 90, maxIntensityPct: 120, maxEffortMin: 18 } });
    expect(lastWritten().durabilityInsertEnvelope).toEqual({ embeddedHardPct: 90, maxIntensityPct: 120, maxEffortMin: 18 });

    readMock().mockResolvedValue(base({ durabilityInsertEnvelope: { embeddedHardPct: 92, maxIntensityPct: 118, maxEffortMin: 15 } }));
    await put({ autoSyncOnOpen: false }); // unrelated change
    expect(lastWritten().durabilityInsertEnvelope).toEqual({ embeddedHardPct: 92, maxIntensityPct: 118, maxEffortMin: 15 });
  });

  it("preserves an existing athleteStateWeights override across an unrelated PUT (no wipe)", async () => {
    const w = { BASE: 60, tsb: { scale: 0.5 } };
    readMock().mockResolvedValue(base({ athleteStateWeights: w }));
    await put({ restDaysPerWeek: 2 });
    expect(lastWritten().athleteStateWeights).toEqual(w);
  });

  it("accepts a new athleteStateWeights override, clamped via the resolver (CAL-1)", async () => {
    readMock().mockResolvedValue(base());
    // The disable-the-safety-cap attack: scoreCap 100 / livedThreshold 99 must be clamped on the way in.
    await put({ athleteStateWeights: { override: { scoreCap: 100, livedThreshold: 99 } } });
    const w = lastWritten().athleteStateWeights!;
    expect(w.override!.scoreCap).toBe(70);
    expect(w.override!.livedThreshold).toBe(3);
    expect(w.BASE).toBe(60); // untouched leaves fall to population default
  });

  it("does not invent override fields when neither the body nor current settings carry them", async () => {
    readMock().mockResolvedValue(base());
    await put({ restDaysPerWeek: 2 });
    const out = lastWritten();
    expect(out.durabilityInsertEnvelope).toBeUndefined();
    expect(out.athleteStateWeights).toBeUndefined();
  });
});
