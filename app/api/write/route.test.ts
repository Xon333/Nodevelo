import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RideScoreEntry, WorkoutType } from "@/lib/types";

// Integration test for /api/write (RV-9, regression for RV-2). Proves the route's partial-failure
// safety at the IO boundary the pure tests can't reach: a mid-loop createEvent failure must NOT
// write a local block or archive history (no half-applied state), and on success every day POSTed
// to Intervals.icu carries the stable `nodevelo-<date>` external_id that makes the write idempotent.

const h = vi.hoisted(() => ({
  createEvent: vi.fn(),
  deleteEvents: vi.fn(async (ids: number[]) => ({ deleted: ids, failed: [] as number[] })),
}));

vi.mock("@/lib/intervals-api", () => ({
  isIntervalsConfigured: () => true,
  createEvent: h.createEvent,
  deleteEvents: h.deleteEvents,
}));
vi.mock("@/lib/data-store", () => ({
  appendBlockHistory: vi.fn(async () => {}),
  readAthleteProfile: vi.fn(async () => ({ performance: { ftp: 280 } })),
  readBlockSettings: vi.fn(async () => ({ durabilityInsertEnvelope: undefined })),
  readCurrentBlock: vi.fn(async () => null),
  readInterventionLog: vi.fn(async () => ({ records: [], updatedAt: "" })),
  readLastSync: vi.fn(async () => null),
  readScoreLog: vi.fn(async () => ({ entries: [] })),
  readSeasonPlan: vi.fn(async () => ({ objective: "", events: [], periods: [], updatedAt: "" })),
  updateCurrentBlock: vi.fn(async (mutate: (cur: null) => unknown) => mutate(null)),
  writeInterventionLog: vi.fn(async () => {}),
}));

import * as store from "@/lib/data-store";
import { POST } from "@/app/api/write/route";

const day = (date: string, name: string) => ({
  date,
  weekNumber: 1,
  weekTheme: "t",
  name,
  type: "Z2",
  durationMin: 60,
  workoutText: "- 60m 65%",
  description: "Daily target: 2600 kcal.",
});

const plan = {
  overview: "o",
  days: [day("2026-06-15", "A"), day("2026-06-16", "B")],
  warnings: [],
  raw: "",
  blockParams: { lengthWeeks: 2, goal: "g", startDate: "2026-06-15", weakpoints: [] },
  model: "claude-sonnet-4-6",
  promptVersion: "v1",
  durabilityTemplate: "A",
};

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/write", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/write partial-failure safety (RV-9 / RV-2)", () => {
  it("does not write a local block or archive history when a day fails mid-loop", async () => {
    h.createEvent.mockResolvedValueOnce(101).mockRejectedValueOnce(new Error("502 upstream"));
    const json = await (await post({ plan })).json();
    expect(json.blockSaved).toBe(false);
    expect(json.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, false]);
    // The critical invariant: no half-applied local state on a partial calendar write.
    expect(store.updateCurrentBlock).not.toHaveBeenCalled();
    expect(store.appendBlockHistory).not.toHaveBeenCalled();
  });

  it("on full success writes the block and posts every day with a stable nodevelo-<date> external_id", async () => {
    h.createEvent.mockResolvedValue(200);
    const json = await (await post({ plan })).json();
    expect(json.blockSaved).toBe(true);
    expect(store.updateCurrentBlock).toHaveBeenCalledTimes(1);
    const externalIds = h.createEvent.mock.calls.map((c) => (c[0] as { external_id?: string }).external_id);
    expect(externalIds).toEqual(["nodevelo-2026-06-15", "nodevelo-2026-06-16"]);
  });

  it("auto-rolls-back the days that wrote when a later day fails (RV-9)", async () => {
    h.createEvent.mockResolvedValueOnce(101).mockRejectedValueOnce(new Error("502 upstream"));
    const json = await (await post({ plan })).json();
    expect(json.blockSaved).toBe(false);
    expect(h.deleteEvents).toHaveBeenCalledWith([101]); // the one event that wrote is deleted
    expect(json.rolledBack).toBe(1);
    expect(json.rollbackFailed).toEqual([]);
  });

  it("stores each day's event id and prunes the replaced block's dropped FUTURE events (RV-9)", async () => {
    // An existing block with a far-future day the new plan doesn't re-cover → that day's event is pruned.
    (store.readCurrentBlock as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      goal: "old",
      lengthWeeks: 2,
      startDate: "2026-06-10",
      endDate: "2999-06-20",
      overview: "",
      createdAt: "2026-06-01T00:00:00Z",
      days: [{ date: "2999-06-20", name: "Old", type: "Z2", durationMin: 60, eventId: 900 }],
    });
    h.createEvent.mockResolvedValueOnce(501).mockResolvedValueOnce(502);
    const json = await (await post({ plan })).json();
    expect(json.blockSaved).toBe(true);
    expect(json.currentBlock.days.map((d: { eventId?: number }) => d.eventId)).toEqual([501, 502]);
    expect(h.deleteEvents).toHaveBeenCalledWith([900]); // old future day, dropped from the new plan
  });

  it("rejects a plan with no days (400, before any write)", async () => {
    const res = await post({ plan: { ...plan, days: [] } });
    expect(res.status).toBe(400);
    expect(h.createEvent).not.toHaveBeenCalled();
  });
});

describe("/api/write version guard (UXA-24)", () => {
  it("rejects with 409 and writes nothing when expectedBlockCreatedAt doesn't match the real block", async () => {
    (store.readCurrentBlock as ReturnType<typeof vi.fn>).mockResolvedValue({
      goal: "g", lengthWeeks: 2, startDate: "2026-06-10", endDate: "2026-06-20", overview: "",
      createdAt: "2026-06-01T00:00:00Z", days: [],
    });
    const res = await post({ plan, expectedBlockCreatedAt: "2026-05-01T00:00:00Z" });
    expect(res.status).toBe(409);
    expect(h.createEvent).not.toHaveBeenCalled();
    expect(store.updateCurrentBlock).not.toHaveBeenCalled();
  });

  it("rejects when the client believes no block is active but one now exists", async () => {
    (store.readCurrentBlock as ReturnType<typeof vi.fn>).mockResolvedValue({
      goal: "g", lengthWeeks: 2, startDate: "2026-06-10", endDate: "2026-06-20", overview: "",
      createdAt: "2026-06-01T00:00:00Z", days: [],
    });
    const res = await post({ plan, expectedBlockCreatedAt: null });
    expect(res.status).toBe(409);
    expect(h.createEvent).not.toHaveBeenCalled();
  });

  it("proceeds when expectedBlockCreatedAt matches the real block", async () => {
    (store.readCurrentBlock as ReturnType<typeof vi.fn>).mockResolvedValue({
      goal: "g", lengthWeeks: 2, startDate: "2026-06-10", endDate: "2026-06-20", overview: "",
      createdAt: "2026-06-01T00:00:00Z", days: [],
    });
    h.createEvent.mockResolvedValue(200);
    const json = await (await post({ plan, expectedBlockCreatedAt: "2026-06-01T00:00:00Z" })).json();
    expect(json.blockSaved).toBe(true);
  });
});

describe("/api/write archive-truncation uses the client's local today (HR-32)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z")); // utcToday() === "2026-06-15"
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("archives a day already lived local-side even though the server's UTC date hasn't rolled over yet", async () => {
    (store.readCurrentBlock as ReturnType<typeof vi.fn>).mockResolvedValue({
      goal: "old", lengthWeeks: 2, startDate: "2026-06-14", endDate: "2026-06-27", overview: "",
      createdAt: "2026-06-01T00:00:00Z",
      days: [{ date: "2026-06-16", name: "Threshold", type: "Threshold", durationMin: 60 }],
    });
    h.createEvent.mockResolvedValue(200);
    await post({ plan, expectedBlockCreatedAt: "2026-06-01T00:00:00Z", today: "2026-06-16" });
    const archived = vi.mocked(store.appendBlockHistory).mock.calls[0][0];
    expect(archived.days?.map((d: { date: string }) => d.date)).toEqual(["2026-06-16"]); // not silently dropped
  });
});

describe("/api/write season stamp (MACRO)", () => {
  const focusPeriod = (overrides: Partial<{
    focus: string;
    phase: string;
    startDate: string;
    plannedWeeks: number;
  }>) => ({
    focus: "threshold",
    phase: "build",
    startDate: "2026-01-01",
    plannedWeeks: 4,
    intensitySplit: "80/20",
    targetWeeklyTss: 400,
    deloadWeek: false,
    rationale: "",
    source: "derived",
    confidence: "medium",
    ...overrides,
  });

  it("stamps the period covering the block's startDate, not the period covering today", async () => {
    h.createEvent.mockResolvedValue(200);
    // "Today" (2026-07-03, real wall-clock) falls in the vo2max period below. The block's
    // own startDate (2026-06-15) falls in the earlier aerobic-base period. The stamp must
    // follow the block's start date, not wall-clock today.
    (store.readSeasonPlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      objective: "",
      events: [],
      periods: [
        focusPeriod({ focus: "aerobic-base", phase: "base", startDate: "2026-06-01", plannedWeeks: 4 }),
        focusPeriod({ focus: "vo2max", phase: "build", startDate: "2026-06-29", plannedWeeks: 4 }),
      ],
      updatedAt: "",
    });
    const json = await (await post({ plan })).json();
    expect(json.blockSaved).toBe(true);
    expect(json.currentBlock.seasonFocus).toBe("aerobic-base");
    expect(json.currentBlock.seasonPhase).toBe("base");
  });

  it("omits the stamp when no period covers the block's startDate", async () => {
    h.createEvent.mockResolvedValue(200);
    (store.readSeasonPlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      objective: "",
      events: [],
      periods: [focusPeriod({ focus: "vo2max", phase: "build", startDate: "2026-07-01", plannedWeeks: 4 })],
      updatedAt: "",
    });
    const json = await (await post({ plan })).json();
    expect(json.blockSaved).toBe(true);
    expect(json.currentBlock.seasonFocus).toBeUndefined();
    expect(json.currentBlock.seasonPhase).toBeUndefined();
  });

  // CFS-8: a rolling-mode plan already carries the focus chooseNextFocus picked at GENERATION time
  // (plan.seasonFocus) — /api/write must stamp CurrentBlock directly from that, never re-derive via
  // currentPeriod (which could disagree, having consulted the season plan as it stands at WRITE time).
  it("stamps seasonFocus/seasonPhase straight from plan.seasonFocus when present (threshold -> build), without consulting the season plan at all", async () => {
    h.createEvent.mockResolvedValue(200);
    const json = await (
      await post({ plan: { ...plan, seasonFocus: "threshold", seasonFocusRationale: "rotation: threshold next" } })
    ).json();
    expect(json.blockSaved).toBe(true);
    expect(json.currentBlock.seasonFocus).toBe("threshold");
    expect(json.currentBlock.seasonPhase).toBe("build");
    // The short-circuited `plan.seasonFocus ? null : currentPeriod(await readSeasonPlan(), ...)` must
    // never touch readSeasonPlan when the stamp is already present on the plan.
    expect(store.readSeasonPlan).not.toHaveBeenCalled();
  });

  it("maps plan.seasonFocus 'aerobic-base' to seasonPhase 'base' (the one focus outside the build-phase default)", async () => {
    h.createEvent.mockResolvedValue(200);
    const json = await (await post({ plan: { ...plan, seasonFocus: "aerobic-base" } })).json();
    expect(json.blockSaved).toBe(true);
    expect(json.currentBlock.seasonFocus).toBe("aerobic-base");
    expect(json.currentBlock.seasonPhase).toBe("base");
  });

  // The two tests above ("stamps the period covering the block's startDate..." / "omits the stamp...")
  // already exercise the OLD fallback path end-to-end: this file's shared `plan` fixture carries no
  // `seasonFocus`, so `plan.seasonFocus ? null : currentPeriod(...)` takes the `currentPeriod` branch —
  // proving the period lookup still applies for event-anchored/pre-upgrade plans without a new,
  // duplicate test.
});

describe("/api/write intervention recording (learning loop, first-ever write)", () => {
  // Same low-scoring-VO2max fixture pattern as lib/athlete-model.test.ts: 4 observations clears
  // MIN_OBSERVATIONS (3), and execEwma < 5.5 fires an "alert" insight on dimension "VO2max".
  const scoreEntry = (type: WorkoutType, executionScore: number, date: string): RideScoreEntry => ({
    date,
    executionScore,
    plannedType: type,
    inferredType: type,
    planned: true,
    legacy: false,
    compliancePct: 100,
    intensityFactor: null,
    ftpUsed: 288,
    durationMin: 60,
    tss: null,
  });

  it("first-ever write with no existing log + non-empty directives creates one record per insight with a baseline snapshot and correct block linkage", async () => {
    h.createEvent.mockResolvedValue(200);
    // Genuine on-disk default for a never-yet-written intervention-log.json (lib/data-store.ts:207-210) —
    // not the file's placeholder `{ records: [], updatedAt: "" }`.
    (store.readInterventionLog as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      records: [],
      updatedAt: new Date(0).toISOString(),
    });
    (store.readScoreLog as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      entries: [
        scoreEntry("VO2max", 4, "2026-05-01"),
        scoreEntry("VO2max", 5, "2026-05-03"),
        scoreEntry("VO2max", 4, "2026-05-06"),
        scoreEntry("VO2max", 5, "2026-05-08"),
      ],
    });

    const json = await (await post({ plan })).json();
    expect(json.blockSaved).toBe(true);

    expect(store.writeInterventionLog).toHaveBeenCalledTimes(1);
    const written = (store.writeInterventionLog as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      records: Array<{
        dimension: string;
        blockStartDate: string;
        baselineExecEwma: number | null;
        baselinePhys: number | null;
        physMetric: string;
      }>;
      updatedAt: string;
    };
    expect(written.records.length).toBeGreaterThan(0);
    const vo2 = written.records.find((r) => r.dimension === "VO2max");
    expect(vo2).toBeDefined();
    expect(vo2!.blockStartDate).toBe("2026-06-15"); // dates[0] of this file's shared `plan` fixture
    expect(vo2!.baselineExecEwma).not.toBeNull();
    expect(typeof vo2!.baselinePhys === "number" || vo2!.baselinePhys === null).toBe(true);
    expect(typeof vo2!.physMetric).toBe("string");
    expect(vo2!.physMetric.length).toBeGreaterThan(0);
  });

  it("empty directives (no insights fire) succeeds without ever calling writeInterventionLog", async () => {
    h.createEvent.mockResolvedValue(200);
    // readScoreLog default from this file's top-level mock is already { entries: [] }, which can't
    // clear MIN_OBSERVATIONS for any dimension — deriveInsights returns [].
    const json = await (await post({ plan })).json();
    expect(json.blockSaved).toBe(true);
    expect(store.writeInterventionLog).not.toHaveBeenCalled();
  });
});

describe("/api/write sessionLevel stamp (measurability)", () => {
  const qualityPlan = {
    ...plan,
    days: [
      day("2026-06-15", "Endurance"), // Z2 @ 65% — no work efforts, so no stamp
      { ...day("2026-06-16", "Threshold 2x20"), type: "Threshold", workoutText: "Main Set 2x\n- 20m 95%\n- 5m 55%" },
    ],
  };

  it("stamps a comparable sessionLevel on quality days and omits it on pure endurance", async () => {
    h.createEvent.mockResolvedValue(200);
    const json = await (await post({ plan: qualityPlan })).json();
    expect(json.blockSaved).toBe(true);
    const [endurance, threshold] = json.currentBlock.days;
    expect(endurance.sessionLevel).toBeUndefined();
    // 2×20m @ 95%: 40 work-min × 0.95 = 38; band (95−80)/(115−80) = 0.43. Frozen for retrospectives.
    expect(threshold.sessionLevel).toEqual({ score: 38, workMin: 40, avgPctFtp: 95, bandPosition: 0.43 });
  });
});

describe("/api/write protocolFindings stamp (§8, block-history-enrichment)", () => {
  it("stamps protocolFindings onto a day whose workout text violates its own protocol", async () => {
    h.createEvent.mockResolvedValue(200);
    // SIT protocol (lib/workout-validate.ts PROTOCOL.SIT): maxEffortSec 45, minIntensityPct 130.
    // 6×90s @ 150% FTP clears the intensity floor but blows past the max-effort-length ceiling.
    const violatingPlan = {
      ...plan,
      days: [{ ...day("2026-06-15", "SIT"), type: "SIT", durationMin: 33, workoutText: "6x\n- 90s 150%\n- 4m 50%" }],
    };
    const json = await (await post({ plan: violatingPlan })).json();
    expect(json.blockSaved).toBe(true);
    expect(json.currentBlock.days[0].protocolFindings).toEqual(
      expect.arrayContaining([expect.stringContaining("longer than protocol")])
    );
  });

  it("omits protocolFindings on a clean day", async () => {
    h.createEvent.mockResolvedValue(200);
    const cleanPlan = {
      ...plan,
      days: [{ ...day("2026-06-15", "Rest"), type: "Rest", durationMin: 0, workoutText: "" }],
    };
    const json = await (await post({ plan: cleanPlan })).json();
    expect(json.blockSaved).toBe(true);
    expect(json.currentBlock.days[0].protocolFindings).toBeUndefined();
  });
});
