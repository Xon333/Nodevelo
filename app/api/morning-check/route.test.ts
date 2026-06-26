import { beforeEach, describe, expect, it, vi } from "vitest";

// Integration test for the morning-check route handlers. The IO boundary (data-store) is mocked
// in-memory; the decision logic, the apply guard, and the proactive reschedule run for real.
vi.mock("@/lib/data-store", () => ({
  readCurrentBlock: vi.fn(),
  readMorningChecks: vi.fn(),
  readTodayAnalysis: vi.fn(),
  writeMorningChecks: vi.fn(),
  writeCurrentBlock: vi.fn(),
}));

import * as store from "@/lib/data-store";
import { GET, POST, PUT } from "@/app/api/morning-check/route";
import type { CurrentBlock, MorningCheckEntry, MorningCheckFlag, MorningCheckLog, TodayAnalysis } from "@/lib/types";

const TODAY = "2026-06-20";

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

const check = (decision: "proceed" | "downgrade", flag: MorningCheckFlag = "extreme-fatigue"): MorningCheckEntry => ({
  date: TODAY, flag, decision, setAt: "",
});

const req = (method: string, body?: unknown) =>
  new Request(`http://t/api/morning-check${method === "GET" ? `?today=${TODAY}` : ""}`, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.readCurrentBlock).mockResolvedValue(block());
  vi.mocked(store.readMorningChecks).mockResolvedValue({ entries: [], updatedAt: "" });
  vi.mocked(store.readTodayAnalysis).mockResolvedValue(null);
  vi.mocked(store.writeMorningChecks).mockResolvedValue(undefined);
  vi.mocked(store.writeCurrentBlock).mockResolvedValue(undefined);
});

describe("POST /api/morning-check", () => {
  it("computes + stores a downgrade for a flag on a quality day", async () => {
    const res = await POST(req("POST", { flag: "ill", today: TODAY }));
    const json = await res.json();
    expect(json.decision).toBe("downgrade");
    expect(json.suggestion).not.toBeNull();
    const stored = vi.mocked(store.writeMorningChecks).mock.calls[0][0] as MorningCheckLog;
    expect(stored.entries[0]).toMatchObject({ date: TODAY, flag: "ill", decision: "downgrade" });
  });

  it("rejects a missing/invalid flag (400)", async () => {
    const res = await POST(req("POST", { flag: "meh", today: TODAY }));
    expect(res.status).toBe(400);
    expect(store.writeMorningChecks).not.toHaveBeenCalled();
  });
});

describe("PUT /api/morning-check — the apply guard", () => {
  it("rejects when today's flag didn't recommend a downgrade", async () => {
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

  it("applies the downgrade when flagged with a downgrade and no ride logged", async () => {
    vi.mocked(store.readMorningChecks).mockResolvedValue({ entries: [check("downgrade")], updatedAt: "" });
    const res = await PUT(req("PUT", { today: TODAY }));
    expect((await res.json()).ok).toBe(true);
    const written = vi.mocked(store.writeCurrentBlock).mock.calls[0][0] as CurrentBlock;
    expect(written.days.find((d) => d.date === TODAY)!.type).not.toBe("VO2max"); // today downgraded
  });

  it("deloads with a note naming the rest day it deliberately skipped (RR-1 UI)", async () => {
    const b: CurrentBlock = {
      ...block(),
      days: [
        { date: TODAY, name: "VO2 6x3", type: "VO2max", durationMin: 70 },
        { date: "2026-06-21", name: "Rest", type: "Rest", durationMin: 0 },
        { date: "2026-06-22", name: "Strength", type: "Strength", durationMin: 45 }, // not easy → no swap slot
      ],
    };
    vi.mocked(store.readCurrentBlock).mockResolvedValue(b);
    vi.mocked(store.readMorningChecks).mockResolvedValue({ entries: [check("downgrade")], updatedAt: "" });
    const json = await (await PUT(req("PUT", { today: TODAY }))).json();
    expect(json.ok).toBe(true);
    expect(json.to).toBeNull();
    expect(json.note).toContain("2026-06-21");
  });
});

describe("GET /api/morning-check", () => {
  it("reports a quality day + a reschedule suggestion", async () => {
    const json = await (await GET(req("GET"))).json();
    expect(json.isQualityDay).toBe(true);
    expect(json.suggestion).not.toBeNull();
  });
});
