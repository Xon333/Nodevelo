import { beforeEach, describe, expect, it, vi } from "vitest";

// Integration test for the /api/loading route handlers. The IO boundary (data-store) is mocked
// in-memory; the pure decision logic (deriveLoadingPrompt/assessLoadingEffect/preLoadTargetG) runs for real.
vi.mock("@/lib/data-store", () => ({
  readAthleteProfile: vi.fn(),
  readCurrentBlock: vi.fn(),
  readLastSync: vi.fn(),
  readLoadingLog: vi.fn(),
  readScoreLog: vi.fn(),
  updateScoreLog: vi.fn(),
  writeLoadingLog: vi.fn(),
}));

import * as store from "@/lib/data-store";
import { GET, POST } from "@/app/api/loading/route";
import type { AthleteProfile, CurrentBlock, LoadingLogStore, RideScoreEntry, ScoreLog, SyncData } from "@/lib/types";

const block = (): CurrentBlock => ({
  goal: "Raise threshold",
  lengthWeeks: 4,
  startDate: "2026-07-01",
  endDate: "2026-07-28",
  overview: "",
  createdAt: "2026-07-01T00:00:00Z",
  days: [
    { date: "2026-07-09", name: "Threshold", type: "Threshold", durationMin: 75 },
    { date: "2026-07-10", name: "Durability", type: "Z2", durationMin: 180, durabilityTemplate: "C" },
    { date: "2026-07-11", name: "Durability", type: "Z2", durationMin: 0, durabilityTemplate: "C" },
  ],
});

const sync = (): SyncData => ({
  syncedAt: "2026-07-08T00:00:00Z",
  activities: [],
  wellness: [{ date: "2026-07-01", weightKg: 70, hrv: null, sleepHours: null, sleepQuality: null, kcalConsumed: null, ctl: null, atl: null }],
  powerCurve: [],
  fitness: { ctl: null, atl: null, tsb: null },
});

const profile = (): AthleteProfile => ({
  performance: { ftp: 300, maxHr: 190, thresholdHr: 170, weightKg: 68, weeklyHoursMin: 6, weeklyHoursMax: 10 },
  goals: [],
  weakpoints: [],
  nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 68 },
  goalsMigratedAt: null,
  updatedAt: "2026-07-01T00:00:00Z",
});

const scoreEntry = (over: Partial<RideScoreEntry>): RideScoreEntry => ({
  date: "2026-06-01",
  executionScore: 7,
  plannedType: "Z2",
  inferredType: "Z2",
  planned: true,
  legacy: false,
  compliancePct: 100,
  intensityFactor: 0.65,
  ftpUsed: 300,
  durationMin: 180,
  tss: 120,
  ...over,
});

// 5 loaded + 5 skipped template-C entries, delivery rates equal (3/5 each) — Task 1's no-effect fixture shape.
const noEffectScoreLog = (): ScoreLog => ({
  entries: [
    ...[0, 1, 2, 3, 4].map((i) =>
      scoreEntry({
        date: `2026-06-${String(i + 1).padStart(2, "0")}`,
        durabilityTemplate: "C",
        preLoad: { loaded: true, targetG: 490 },
        durabilityDelivery: { signal: i < 3 ? 2 : -2 },
      })
    ),
    ...[5, 6, 7, 8, 9].map((i) =>
      scoreEntry({
        date: `2026-06-${String(i + 1).padStart(2, "0")}`,
        durabilityTemplate: "C",
        preLoad: { loaded: false, targetG: 490 },
        durabilityDelivery: { signal: i < 8 ? 2 : -2 },
      })
    ),
  ],
  updatedAt: "",
});

const req = (method: string, urlSuffix = "", body?: unknown) =>
  new Request(`http://x/api/loading${urlSuffix}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.readCurrentBlock).mockResolvedValue(block());
  vi.mocked(store.readLoadingLog).mockResolvedValue({ entries: [] });
  vi.mocked(store.readScoreLog).mockResolvedValue({ entries: [], updatedAt: "" });
  vi.mocked(store.readLastSync).mockResolvedValue(sync());
  vi.mocked(store.readAthleteProfile).mockResolvedValue(profile());
  vi.mocked(store.writeLoadingLog).mockResolvedValue(undefined);
  vi.mocked(store.updateScoreLog).mockResolvedValue({ entries: [], updatedAt: "" });
});

describe("GET /api/loading", () => {
  it("pre-asks the day before a durability day and reports the assessment", async () => {
    const res = await GET(req("GET", "?today=2026-07-09"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompt).toEqual({ kind: "pre-ask", rideDate: "2026-07-10", template: "C", targetG: 490 });
    expect(body.assessment.verdict).toBe("unproven");
  });

  it("suppresses the prompt entirely on a no-effect verdict", async () => {
    vi.mocked(store.readScoreLog).mockResolvedValue(noEffectScoreLog());
    const res = await GET(req("GET", "?today=2026-07-09"));
    const body = await res.json();
    expect(body.prompt).toBeNull();
    expect(body.assessment.verdict).toBe("no-effect");
  });
});

describe("POST /api/loading", () => {
  it("upserts a response keyed by rideDate and echoes it on GET", async () => {
    const post = await POST(req("POST", "", { rideDate: "2026-07-10", response: "loaded" }));
    expect(post.status).toBe(200);
    const postJson = await post.json();
    expect(postJson.entry).toMatchObject({ rideDate: "2026-07-10", response: "loaded", targetG: 490 });

    const written = vi.mocked(store.writeLoadingLog).mock.calls[0][0] as LoadingLogStore;
    expect(written.entries).toHaveLength(1);
    vi.mocked(store.readLoadingLog).mockResolvedValue(written);

    // Tomorrow's ride is now responded — 07-09's GET (pre-ask window) goes quiet.
    const quiet = await (await GET(req("GET", "?today=2026-07-09"))).json();
    expect(quiet.prompt).toBeNull();

    // The stored entry is echoed back via GET for the ride date itself.
    const rideDay = await (await GET(req("GET", "?today=2026-07-10"))).json();
    expect(rideDay.prompt).toBeNull();
    expect(rideDay.response).toMatchObject({ rideDate: "2026-07-10", response: "loaded" });
  });

  it("replaces an existing entry for the same rideDate rather than duplicating it", async () => {
    vi.mocked(store.readLoadingLog).mockResolvedValue({
      entries: [{ rideDate: "2026-07-10", targetG: 490, response: "skipped", respondedAt: "2026-07-09T00:00:00Z" }],
    });
    await POST(req("POST", "", { rideDate: "2026-07-10", response: "loaded" }));
    const written = vi.mocked(store.writeLoadingLog).mock.calls[0][0] as LoadingLogStore;
    expect(written.entries).toHaveLength(1);
    expect(written.entries[0]).toMatchObject({ rideDate: "2026-07-10", response: "loaded" });
  });

  it("rejects a bad response value (400)", async () => {
    const res = await POST(req("POST", "", { rideDate: "2026-07-10", response: "yes" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
    expect(store.writeLoadingLog).not.toHaveBeenCalled();
  });

  it("rejects a rideDate that is not a durability day in the active block (400)", async () => {
    const res = await POST(req("POST", "", { rideDate: "2026-07-09", response: "loaded" }));
    expect(res.status).toBe(400);
    expect(store.writeLoadingLog).not.toHaveBeenCalled();
  });

  it("rejects a durability day with zero planned duration (400)", async () => {
    const res = await POST(req("POST", "", { rideDate: "2026-07-11", response: "loaded" }));
    expect(res.status).toBe(400);
    expect(store.writeLoadingLog).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON (400)", async () => {
    const res = await POST(new Request("http://x/api/loading", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
    expect(store.writeLoadingLog).not.toHaveBeenCalled();
  });

  describe("ledger back-stamp (retro-ask ordering)", () => {
    it("stamps preLoad onto an already-born ledger entry without touching executionScore", async () => {
      const res = await POST(req("POST", "", { rideDate: "2026-07-10", response: "loaded" }));
      expect(res.status).toBe(200);
      const mutate = vi.mocked(store.updateScoreLog).mock.calls[0][0];
      const ledgerEntry = scoreEntry({ date: "2026-07-10", durabilityTemplate: "C", executionScore: 6 });
      const result = await mutate([ledgerEntry]);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ executionScore: 6, preLoad: { loaded: true, targetG: 490 } });
    });

    it("is a no-op when no ledger entry exists for the date", async () => {
      const res = await POST(req("POST", "", { rideDate: "2026-07-10", response: "loaded" }));
      expect(res.status).toBe(200);
      const mutate = vi.mocked(store.updateScoreLog).mock.calls[0][0];
      const otherEntry = scoreEntry({ date: "2026-06-01", durabilityTemplate: "C" });
      expect(await mutate([otherEntry])).toEqual([otherEntry]);
    });

    it("does not overwrite an existing preLoad stamp (first answer wins)", async () => {
      const res = await POST(req("POST", "", { rideDate: "2026-07-10", response: "loaded" }));
      expect(res.status).toBe(200);
      const mutate = vi.mocked(store.updateScoreLog).mock.calls[0][0];
      const ledgerEntry = scoreEntry({
        date: "2026-07-10",
        durabilityTemplate: "C",
        preLoad: { loaded: false, targetG: 400 },
      });
      const result = await mutate([ledgerEntry]);
      expect(result[0].preLoad).toEqual({ loaded: false, targetG: 400 });
    });
  });
});
