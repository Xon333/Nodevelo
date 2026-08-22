import { beforeEach, describe, expect, it, vi } from "vitest";

// Integration test for the reschedule route handlers. The IO boundary (data-store, plus the shared
// persistMirroredMove — its own gating/catch orchestration is covered by lib/calendar-mirror.test.ts)
// is mocked; the local move/date logic runs for real.
vi.mock("@/lib/data-store", () => ({
  readCurrentBlock: vi.fn(),
  readDispositions: vi.fn(),
  readScoreLog: vi.fn(),
  writeCurrentBlock: vi.fn(),
}));

vi.mock("@/lib/calendar-mirror", () => ({
  persistMirroredMove: vi.fn(),
}));

import * as store from "@/lib/data-store";
import * as mirror from "@/lib/calendar-mirror";
import { GET, PATCH, POST, PUT } from "@/app/api/reschedule/route";
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
const patchReq = (body: unknown) => new Request("http://t/api/reschedule", { method: "PATCH", body: JSON.stringify(body) });
const getReq = () => new Request(`http://t/api/reschedule?today=${TODAY}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.readCurrentBlock).mockResolvedValue(block());
  vi.mocked(store.readScoreLog).mockResolvedValue({ entries: [], updatedAt: "" });
  vi.mocked(store.readDispositions).mockResolvedValue({ entries: [], updatedAt: "" });
  vi.mocked(store.writeCurrentBlock).mockResolvedValue(undefined);
  // Default: a no-op mirror (as if Intervals.icu isn't configured) that still persists the local
  // move, mirroring persistMirroredMove's real contract — writeCurrentBlock, then report {[], []}.
  vi.mocked(mirror.persistMirroredMove).mockImplementation(async (b, days) => {
    const updatedBlock = { ...b, days };
    await store.writeCurrentBlock(updatedBlock);
    return { updatedBlock, mirrored: [], failed: [], versionConflict: false };
  });
});

describe("GET /api/reschedule", () => {
  it("HR-44: returns the block's createdAt alongside the suggestion, so the client can capture it at fetch time", async () => {
    const json = await (await GET(getReq())).json();
    expect(json.blockCreatedAt).toBe(block().createdAt);
  });

  it("returns blockCreatedAt: null when there's no active block", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(null);
    const json = await (await GET(getReq())).json();
    expect(json.blockCreatedAt).toBeNull();
    expect(json.suggestion).toBeNull();
  });
});

describe("POST /api/reschedule — make-up move", () => {
  it("moves the missed session onto `to`, keeps `from` as history, calls the mirror, and persists mirror-updated eventIds", async () => {
    vi.mocked(mirror.persistMirroredMove).mockImplementation(async (b, days) => {
      const updatedBlock = { ...b, days: days.map((d) => (d.date === "2026-06-21" ? { ...d, eventId: 999 } : d)) };
      await store.writeCurrentBlock(updatedBlock);
      return { updatedBlock, mirrored: ["2026-06-21"], failed: [], versionConflict: false };
    });

    const res = await POST(postReq({ from: "2026-06-18", to: "2026-06-21", today: TODAY }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, mirrored: ["2026-06-21"], mirrorFailed: [] });

    // persistMirroredMove is called with the ORIGINAL block, the LOCALLY-moved days, the move, and
    // the client's today.
    const [calledBlock, calledDays, calledMoves, calledToday] = vi.mocked(mirror.persistMirroredMove).mock.calls[0];
    const movedToDay = calledDays.find((d) => d.date === "2026-06-21")!;
    expect(movedToDay).toMatchObject({ name: "VO2 6x3", type: "VO2max", durationMin: 70, workoutText: "3x8min VO2" });
    expect(calledMoves).toEqual([{ from: "2026-06-18", to: "2026-06-21" }]);
    expect(calledToday).toBe(TODAY);
    expect(calledBlock).toEqual(block()); // the original, unmodified block

    // `from` stays as history, untouched.
    const fromDay = calledDays.find((d) => d.date === "2026-06-18")!;
    expect(fromDay).toMatchObject({ name: "VO2 6x3", type: "VO2max", durationMin: 70 });

    // Persisted block is the mirror's updatedBlock (carrying the fresh eventId), not the pre-mirror one.
    const written = vi.mocked(store.writeCurrentBlock).mock.calls[0][0] as CurrentBlock;
    expect(written.days.find((d) => d.date === "2026-06-21")!.eventId).toBe(999);
  });

  it("rejects `to` at or before the CLIENT's today (400), not the server's UTC date", async () => {
    const res = await POST(postReq({ from: "2026-06-18", to: TODAY, today: TODAY }));
    expect(res.status).toBe(400);
    expect(store.writeCurrentBlock).not.toHaveBeenCalled();
    expect(mirror.persistMirroredMove).not.toHaveBeenCalled();
  });

  it("HR-39: rejects making up onto an occupied (non-rest) day (400) instead of silently overwriting its prescription", async () => {
    // 2026-06-22 is "Easy" (Z2, 60min) — a real planned day, unlike PUT/PATCH's equivalent tests this
    // verb previously had no server-side check for at all.
    const res = await POST(postReq({ from: "2026-06-18", to: "2026-06-22", today: TODAY }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("2026-06-22");
    expect(store.writeCurrentBlock).not.toHaveBeenCalled();
    expect(mirror.persistMirroredMove).not.toHaveBeenCalled();
  });
});

describe("version guard (UXA-24) — shared across POST/PUT/PATCH", () => {
  it("PUT rejects with 409 and doesn't move anything when expectedBlockCreatedAt is stale", async () => {
    const res = await PUT(putReq({ from: "2026-06-18", to: "2026-06-21", today: TODAY, expectedBlockCreatedAt: "2020-01-01T00:00:00Z" }));
    expect(res.status).toBe(409);
    expect(mirror.persistMirroredMove).not.toHaveBeenCalled();
  });

  it("PUT proceeds when expectedBlockCreatedAt matches the real block", async () => {
    const res = await PUT(putReq({ from: "2026-06-23", to: "2026-06-21", today: TODAY, expectedBlockCreatedAt: block().createdAt }));
    expect(res.status).toBe(200);
  });

  it("PUT skips the check entirely when the caller sends no expectedBlockCreatedAt at all", async () => {
    const res = await PUT(putReq({ from: "2026-06-23", to: "2026-06-21", today: TODAY }));
    expect(res.status).toBe(200);
  });

  it("HR-35: PUT surfaces 409 when persistMirroredMove detects a version conflict at the actual write (not just the up-front guard)", async () => {
    // The up-front guard here passes (expectedBlockCreatedAt matches the block read at request start),
    // but a concurrent write can still land before persistMirroredMove's lock-held local commit — its
    // CAS re-check catches this before any mirror work, surfaced here as versionConflict: true.
    vi.mocked(mirror.persistMirroredMove).mockResolvedValue({ updatedBlock: block(), mirrored: [], failed: [], versionConflict: true });
    const res = await PUT(putReq({ from: "2026-06-23", to: "2026-06-21", today: TODAY, expectedBlockCreatedAt: block().createdAt }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.ok).toBeUndefined();
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

// The two success-path swap tests use the fixture's only pair of occupied days that BOTH carry an
// eventId (2026-06-18 ↔ 2026-06-23). 2026-06-18 sits before TODAY, so those tests pass an earlier
// client `today` — the swap must see both sides as future while still exercising eventId carry-over
// on both sides of the trade.
const SWAP_TODAY = "2026-06-17";

describe("PATCH /api/reschedule — swap two occupied sessions", () => {
  it("trades both days' full content symmetrically and calls the mirror with the swap pair", async () => {
    const res = await PATCH(patchReq({ from: "2026-06-18", to: "2026-06-23", today: SWAP_TODAY }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);

    const [calledBlock, calledDays, calledMoves, calledToday] = vi.mocked(mirror.persistMirroredMove).mock.calls[0];
    expect(calledMoves).toEqual([
      { from: "2026-06-18", to: "2026-06-23" },
      { from: "2026-06-23", to: "2026-06-18" },
    ]);
    expect(calledToday).toBe(SWAP_TODAY);
    expect(calledBlock).toEqual(block()); // the original, unmodified block — persistMirroredMove's preMoveDays default relies on this

    // 2026-06-23 now holds what 2026-06-18 used to (VO2 6x3), keeping 2026-06-18's own eventId.
    const newSix23 = calledDays.find((d) => d.date === "2026-06-23")!;
    expect(newSix23).toMatchObject({ name: "VO2 6x3", type: "VO2max", durationMin: 70, workoutText: "3x8min VO2", eventId: 111 });

    // 2026-06-18 now holds what 2026-06-23 used to (VO2 5x4), keeping 2026-06-23's own eventId.
    const newSix18 = calledDays.find((d) => d.date === "2026-06-18")!;
    expect(newSix18).toMatchObject({ name: "VO2 5x4", type: "VO2max", durationMin: 75, workoutText: "5x4min VO2", eventId: 222 });
    expect(newSix18.prescription).toEqual([{ reps: 5, durationSec: 240, targetPctFtp: 120, targetWatts: 300, label: "5×4m @ 300W" }]);

    // Neither day becomes Rest.
    expect(newSix18.type).not.toBe("Rest");
    expect(newSix23.type).not.toBe("Rest");
  });

  it("rejects from === to (400)", async () => {
    const res = await PATCH(patchReq({ from: "2026-06-18", to: "2026-06-18", today: TODAY }));
    expect(res.status).toBe(400);
    expect(store.writeCurrentBlock).not.toHaveBeenCalled();
  });

  it("rejects a past `from` or `to` (400)", async () => {
    const pastFrom = await PATCH(patchReq({ from: "2026-06-19", to: TODAY, today: TODAY }));
    expect(pastFrom.status).toBe(400);
    const pastTo = await PATCH(patchReq({ from: "2026-06-22", to: "2026-06-19", today: TODAY }));
    expect(pastTo.status).toBe(400);
    expect(store.writeCurrentBlock).not.toHaveBeenCalled();
  });

  it("rejects when either side has no real session (400), naming the day and pointing at Move", async () => {
    // 2026-06-21 is Rest — no session to swap.
    const res = await PATCH(patchReq({ from: "2026-06-23", to: "2026-06-21", today: TODAY }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("2026-06-21");
    expect(json.error).toContain("Move");
    expect(store.writeCurrentBlock).not.toHaveBeenCalled();
  });

  it("rejects from/to not in the current block (400)", async () => {
    const res = await PATCH(patchReq({ from: "2026-06-18", to: "2099-01-01", today: TODAY }));
    expect(res.status).toBe(400);
  });
});

describe("PATCH mirror failure surfaces without blocking the local swap", () => {
  it("a rejected mirror call still persists the local swap — 200 with mirrorFailed populated", async () => {
    vi.mocked(mirror.persistMirroredMove).mockImplementation(async (b, days, moves) => {
      const updatedBlock = { ...b, days };
      await store.writeCurrentBlock(updatedBlock);
      return { updatedBlock, mirrored: [], failed: moves.flatMap((m) => (m.to ? [m.from, m.to] : [m.from])), versionConflict: false };
    });

    const res = await PATCH(patchReq({ from: "2026-06-18", to: "2026-06-23", today: SWAP_TODAY }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.mirrorFailed).toEqual(expect.arrayContaining(["2026-06-18", "2026-06-23"]));

    const written = vi.mocked(store.writeCurrentBlock).mock.calls[0][0] as CurrentBlock;
    expect(written.days.find((d) => d.date === "2026-06-23")).toMatchObject({ name: "VO2 6x3" });
    expect(written.days.find((d) => d.date === "2026-06-18")).toMatchObject({ name: "VO2 5x4" });
  });
});

describe("mirror failure surfaces without blocking the local move", () => {
  it("PUT: a rejected mirror call still persists the local move — 200 with mirrorFailed populated", async () => {
    vi.mocked(mirror.persistMirroredMove).mockImplementation(async (b, days, moves) => {
      const updatedBlock = { ...b, days }; // mirror failed — local move still stands, no eventId changes
      await store.writeCurrentBlock(updatedBlock);
      return { updatedBlock, mirrored: [], failed: moves.flatMap((m) => (m.to ? [m.from, m.to] : [m.from])), versionConflict: false };
    });

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
