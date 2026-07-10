import { beforeEach, describe, expect, it, vi } from "vitest";

// Integration test for the reschedule route handlers. The IO boundary (data-store, the calendar
// mirror, and the "is Intervals.icu configured" check) is mocked; the local move/date logic runs
// for real. Modeled on app/api/morning-check/route.test.ts's mocking pattern.
vi.mock("@/lib/data-store", () => ({
  readCurrentBlock: vi.fn(),
  readDispositions: vi.fn(),
  readScoreLog: vi.fn(),
  writeCurrentBlock: vi.fn(),
}));

vi.mock("@/lib/calendar-mirror", () => ({
  applyCalendarMirror: vi.fn(),
}));

vi.mock("@/lib/intervals-api", () => ({
  isIntervalsConfigured: vi.fn(),
}));

import * as store from "@/lib/data-store";
import * as mirror from "@/lib/calendar-mirror";
import * as intervalsApi from "@/lib/intervals-api";
import { POST, PUT } from "@/app/api/reschedule/route";
import type { CurrentBlock } from "@/lib/types";

const TODAY = "2026-06-20";

const block = (): CurrentBlock => ({
  goal: "Raise threshold",
  lengthWeeks: 4,
  startDate: "2026-06-15",
  endDate: "2026-07-12",
  overview: "",
  createdAt: "2026-06-15T00:00:00Z",
  days: [
    { date: "2026-06-18", name: "VO2 6x3", type: "VO2max", durationMin: 70, workoutText: "3x8min VO2", eventId: 111 },
    { date: "2026-06-19", name: "Z2 Endurance", type: "Z2", durationMin: 90 },
    { date: TODAY, name: "Rest", type: "Rest", durationMin: 0 },
    { date: "2026-06-21", name: "Rest", type: "Rest", durationMin: 0 },
    { date: "2026-06-22", name: "Easy", type: "Z2", durationMin: 60 },
    {
      date: "2026-06-23",
      name: "VO2 5x4",
      type: "VO2max",
      durationMin: 75,
      workoutText: "5x4min VO2",
      prescription: [{ reps: 5, durationSec: 240, targetPctFtp: 120, targetWatts: 300, label: "5×4m @ 300W" }],
      eventId: 222,
    },
  ],
});

const postReq = (body: unknown) => new Request("http://t/api/reschedule", { method: "POST", body: JSON.stringify(body) });
const putReq = (body: unknown) => new Request("http://t/api/reschedule", { method: "PUT", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.readCurrentBlock).mockResolvedValue(block());
  vi.mocked(store.writeCurrentBlock).mockResolvedValue(undefined);
  vi.mocked(intervalsApi.isIntervalsConfigured).mockReturnValue(false); // opt in per test
});

describe("POST /api/reschedule — make-up move", () => {
  it("moves the missed session onto `to`, keeps `from` as history, calls the mirror, and persists mirror-updated eventIds", async () => {
    vi.mocked(intervalsApi.isIntervalsConfigured).mockReturnValue(true);
    vi.mocked(mirror.applyCalendarMirror).mockImplementation(async (b) => ({
      updatedBlock: { ...b, days: b.days.map((d) => (d.date === "2026-06-21" ? { ...d, eventId: 999 } : d)) },
      mirrored: ["2026-06-21"],
      failed: [],
    }));

    const res = await POST(postReq({ from: "2026-06-18", to: "2026-06-21", today: TODAY }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, mirrored: ["2026-06-21"], mirrorFailed: [] });

    // The mirror is called with the LOCALLY-moved block (before the mirror mutates it), the move, and
    // the client's today.
    const [calledBlock, calledMoves, calledToday] = vi.mocked(mirror.applyCalendarMirror).mock.calls[0];
    const movedToDay = calledBlock.days.find((d) => d.date === "2026-06-21")!;
    expect(movedToDay).toMatchObject({ name: "VO2 6x3", type: "VO2max", durationMin: 70, workoutText: "3x8min VO2" });
    expect(calledMoves).toEqual([{ from: "2026-06-18", to: "2026-06-21" }]);
    expect(calledToday).toBe(TODAY);

    // `from` stays as history, untouched.
    const fromDay = calledBlock.days.find((d) => d.date === "2026-06-18")!;
    expect(fromDay).toMatchObject({ name: "VO2 6x3", type: "VO2max", durationMin: 70 });

    // Persisted block is the mirror's updatedBlock (carrying the fresh eventId), not the pre-mirror one.
    const written = vi.mocked(store.writeCurrentBlock).mock.calls[0][0] as CurrentBlock;
    expect(written.days.find((d) => d.date === "2026-06-21")!.eventId).toBe(999);
  });

  it("rejects `to` at or before the CLIENT's today (400), not the server's UTC date", async () => {
    const res = await POST(postReq({ from: "2026-06-18", to: TODAY, today: TODAY }));
    expect(res.status).toBe(400);
    expect(store.writeCurrentBlock).not.toHaveBeenCalled();
    expect(mirror.applyCalendarMirror).not.toHaveBeenCalled();
  });
});

describe("PUT /api/reschedule — manual move", () => {
  it("vacates `from` to a bare Rest placeholder and moves the full content (incl. eventId) onto `to`", async () => {
    const res = await PUT(putReq({ from: "2026-06-23", to: "2026-06-21", today: TODAY }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);

    const written = vi.mocked(store.writeCurrentBlock).mock.calls[0][0] as CurrentBlock;
    const fromDay = written.days.find((d) => d.date === "2026-06-23")!;
    expect(fromDay).toMatchObject({ name: "Rest (moved to 2026-06-21)", type: "Rest", durationMin: 0 });
    expect(fromDay.workoutText).toBeUndefined();
    expect(fromDay.prescription).toBeUndefined();
    expect(fromDay.eventId).toBeUndefined();

    const toDay = written.days.find((d) => d.date === "2026-06-21")!;
    expect(toDay).toMatchObject({ name: "VO2 5x4", type: "VO2max", durationMin: 75, workoutText: "5x4min VO2", eventId: 222 });
    expect(toDay.prescription).toEqual([{ reps: 5, durationSec: 240, targetPctFtp: 120, targetWatts: 300, label: "5×4m @ 300W" }]);
  });

  it("rejects moving onto an occupied (non-rest) day (400)", async () => {
    const res = await PUT(putReq({ from: "2026-06-23", to: "2026-06-22", today: TODAY }));
    expect(res.status).toBe(400);
    expect(store.writeCurrentBlock).not.toHaveBeenCalled();
  });
});

describe("mirror failure surfaces without blocking the local move", () => {
  it("PUT: a rejected mirror call still persists the local move — 200 with mirrorFailed populated", async () => {
    vi.mocked(intervalsApi.isIntervalsConfigured).mockReturnValue(true);
    vi.mocked(mirror.applyCalendarMirror).mockRejectedValue(new Error("network down"));

    const res = await PUT(putReq({ from: "2026-06-23", to: "2026-06-21", today: TODAY }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.mirrorFailed.length).toBeGreaterThan(0);
    expect(json.mirrorFailed).toEqual(expect.arrayContaining(["2026-06-23", "2026-06-21"]));

    const written = vi.mocked(store.writeCurrentBlock).mock.calls[0][0] as CurrentBlock;
    expect(written.days.find((d) => d.date === "2026-06-23")).toMatchObject({ name: "Rest (moved to 2026-06-21)" });
    expect(written.days.find((d) => d.date === "2026-06-21")).toMatchObject({ name: "VO2 5x4" });
  });
});
