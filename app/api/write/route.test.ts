import { beforeEach, describe, expect, it, vi } from "vitest";

// Integration test for /api/write (RV-9, regression for RV-2). Proves the route's partial-failure
// safety at the IO boundary the pure tests can't reach: a mid-loop createEvent failure must NOT
// write a local block or archive history (no half-applied state), and on success every day POSTed
// to Intervals.icu carries the stable `nodevelo-<date>` uid that makes the write idempotent.

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
  readCurrentBlock: vi.fn(async () => null),
  readInterventionLog: vi.fn(async () => ({ records: [], updatedAt: "" })),
  readLastSync: vi.fn(async () => null),
  readScoreLog: vi.fn(async () => ({ entries: [] })),
  writeCurrentBlock: vi.fn(async () => {}),
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
    expect(store.writeCurrentBlock).not.toHaveBeenCalled();
    expect(store.appendBlockHistory).not.toHaveBeenCalled();
  });

  it("on full success writes the block and posts every day with a stable nodevelo-<date> uid", async () => {
    h.createEvent.mockResolvedValue(200);
    const json = await (await post({ plan })).json();
    expect(json.blockSaved).toBe(true);
    expect(store.writeCurrentBlock).toHaveBeenCalledTimes(1);
    const uids = h.createEvent.mock.calls.map((c) => (c[0] as { uid?: string }).uid);
    expect(uids).toEqual(["nodevelo-2026-06-15", "nodevelo-2026-06-16"]);
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
