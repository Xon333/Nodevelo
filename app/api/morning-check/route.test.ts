import { beforeEach, describe, expect, it, vi } from "vitest";

// Integration test for the morning-check route handlers (CR-8). The IO boundary (data-store) is
// mocked in-memory; everything else — decision logic, the CR-2 apply guard, the proactive reschedule
// — runs for real, so this exercises the *wiring* the unit tests can't (where CR-2/CR-3 lived).
vi.mock("@/lib/data-store", () => ({
  readCurrentBlock: vi.fn(),
  readLastSync: vi.fn(),
  readMorningChecks: vi.fn(),
  readTodayAnalysis: vi.fn(),
  writeMorningChecks: vi.fn(),
  writeCurrentBlock: vi.fn(),
}));

import * as store from "@/lib/data-store";
import { GET, POST, PUT } from "@/app/api/morning-check/route";
import type { CurrentBlock, MorningCheckEntry, MorningCheckLog, SyncData, TodayAnalysis } from "@/lib/types";

const TODAY = "2026-06-20";
const sync = { syncedAt: "", activities: [], wellness: [], powerCurve: [], fitness: { ctl: 50, atl: 60, tsb: -10 } } as unknown as SyncData;

const block = (): CurrentBlock => ({
  goal: "Raise threshold",
  lengthWeeks: 4,
  startDate: "2026-06-15",
  endDate: "2026-07-12",
  overview: "",
  createdAt: "2026-06-15T00:00:00Z",
  days: [
    { date: TODAY, name: "VO2 6x3", type: "VO2max", durationMin: 70 },
    { date: "2026-06-21", name: "Rest", type: "Rest", durationMin: 0 },
    { date: "2026-06-22", name: "Easy", type: "Z2", durationMin: 60 },
  ],
});

const check = (decision: "proceed" | "downgrade"): MorningCheckEntry => ({
  date: TODAY, fatigue: 5, sleep: 1, soreness: 5, motivation: 2, illness: "none", strain: 19, decision, setAt: "",
});

const req = (method: string, body?: unknown) =>
  new Request(`http://t/api/morning-check${method === "GET" ? `?today=${TODAY}` : ""}`, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(() => {
  vi.clearAllMocks(); // reset call history between tests (keeps the implementations set below)
  vi.mocked(store.readCurrentBlock).mockResolvedValue(block());
  vi.mocked(store.readLastSync).mockResolvedValue(sync);
  vi.mocked(store.readMorningChecks).mockResolvedValue({ entries: [], updatedAt: "" });
  vi.mocked(store.readTodayAnalysis).mockResolvedValue(null);
  vi.mocked(store.writeMorningChecks).mockResolvedValue(undefined);
  vi.mocked(store.writeCurrentBlock).mockResolvedValue(undefined);
});

describe("POST /api/morning-check", () => {
  it("computes + stores a downgrade for a wrecked check on a quality day", async () => {
    const res = await POST(req("POST", { fatigue: 5, sleep: 1, soreness: 5, motivation: 2, illness: "none", today: TODAY }));
    const json = await res.json();
    expect(json.decision).toBe("downgrade");
    expect(json.suggestion).not.toBeNull();
    const stored = vi.mocked(store.writeMorningChecks).mock.calls[0][0] as MorningCheckLog;
    expect(stored.entries[0]).toMatchObject({ date: TODAY, decision: "downgrade" });
  });

  it("proceeds for a fresh check", async () => {
    const res = await POST(req("POST", { fatigue: 1, sleep: 5, soreness: 1, motivation: 5, illness: "none", today: TODAY }));
    expect((await res.json()).decision).toBe("proceed");
  });

  it("rejects an out-of-range rating (400)", async () => {
    const res = await POST(req("POST", { fatigue: 9, sleep: 5, soreness: 1, motivation: 5, illness: "none", today: TODAY }));
    expect(res.status).toBe(400);
    expect(store.writeMorningChecks).not.toHaveBeenCalled();
  });
});

describe("PUT /api/morning-check — the CR-2 apply guard", () => {
  it("rejects when today's check didn't recommend a downgrade", async () => {
    vi.mocked(store.readMorningChecks).mockResolvedValue({ entries: [check("proceed")], updatedAt: "" });
    const res = await PUT(req("PUT", { today: TODAY }));
    expect(res.status).toBe(400);
    expect(store.writeCurrentBlock).not.toHaveBeenCalled();
  });

  it("rejects when today's ride is already logged", async () => {
    vi.mocked(store.readMorningChecks).mockResolvedValue({ entries: [check("downgrade")], updatedAt: "" });
    vi.mocked(store.readTodayAnalysis).mockResolvedValue({ activityDate: TODAY } as TodayAnalysis);
    const res = await PUT(req("PUT", { today: TODAY }));
    expect(res.status).toBe(400);
    expect(store.writeCurrentBlock).not.toHaveBeenCalled();
  });

  it("applies the downgrade when checked-in with a downgrade and no ride logged", async () => {
    vi.mocked(store.readMorningChecks).mockResolvedValue({ entries: [check("downgrade")], updatedAt: "" });
    const res = await PUT(req("PUT", { today: TODAY }));
    expect((await res.json()).ok).toBe(true);
    const written = vi.mocked(store.writeCurrentBlock).mock.calls[0][0] as CurrentBlock;
    expect(written.days.find((d) => d.date === TODAY)!.type).not.toBe("VO2max"); // today downgraded
  });
});

describe("GET /api/morning-check", () => {
  it("reports a quality day + a reschedule suggestion", async () => {
    const json = await (await GET(req("GET"))).json();
    expect(json.isQualityDay).toBe(true);
    expect(json.suggestion).not.toBeNull();
  });
});
