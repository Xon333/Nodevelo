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

// The calendar mirror is mocked as a unit (its own gating/catch orchestration is covered by
// lib/calendar-mirror.test.ts) — the route's job is just to derive the right `moves` and relay
// mirrored/failed into the response. Modeled on app/api/reschedule/route.test.ts's pattern.
vi.mock("@/lib/calendar-mirror", () => ({
  persistMirroredMove: vi.fn(),
}));

import * as store from "@/lib/data-store";
import * as mirror from "@/lib/calendar-mirror";
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
  // Default: a no-op mirror (as if Intervals.icu isn't configured) that still persists the local
  // move, mirroring persistMirroredMove's real contract — writeCurrentBlock, then report {[], []}.
  vi.mocked(mirror.persistMirroredMove).mockImplementation(async (b, days) => {
    const updatedBlock = { ...b, days };
    await store.writeCurrentBlock(updatedBlock);
    return { updatedBlock, mirrored: [], failed: [] };
  });
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

  // The verdict must survive a page refresh: the reasons are stored on the entry (not just returned from
  // this POST), so the GET can render the same card the athlete saw when they flagged.
  it("stores the decision reasons on the entry", async () => {
    await POST(req("POST", { flag: "ill", today: TODAY }));
    const stored = vi.mocked(store.writeMorningChecks).mock.calls[0][0] as MorningCheckLog;
    expect(stored.entries[0].reasons?.length).toBeGreaterThan(0);
  });

  // Easy-day ill/extreme-fatigue now rests the day (skip the easy volume) instead of "proceed" — the
  // athlete's manual override exists precisely for "I feel worse than the model can see".
  it("rests an ill/extreme-fatigue flag on a non-quality (Z2) day, with no reschedule suggestion", async () => {
    const easy: CurrentBlock = { ...block(), days: [{ date: TODAY, name: "Easy", type: "Z2", durationMin: 60 }] };
    vi.mocked(store.readCurrentBlock).mockResolvedValue(easy);
    const json = await (await POST(req("POST", { flag: "extreme-fatigue", today: TODAY }))).json();
    expect(json.decision).toBe("rest");
    expect(json.suggestion).toBeNull();
    const stored = vi.mocked(store.writeMorningChecks).mock.calls[0][0] as MorningCheckLog;
    expect(stored.entries[0]).toMatchObject({ date: TODAY, flag: "extreme-fatigue", decision: "rest" });
  });

  it("rejects a missing/invalid flag (400)", async () => {
    const res = await POST(req("POST", { flag: "meh", today: TODAY }));
    expect(res.status).toBe(400);
    expect(store.writeMorningChecks).not.toHaveBeenCalled();
  });

  // S2-9: an injury on a quality day rests the day, with NO reschedule suggestion (nothing to swap).
  it("stores a 'rest' decision with no suggestion on an injury flag", async () => {
    const res = await POST(req("POST", { flag: "injury", today: TODAY }));
    const json = await res.json();
    expect(json.decision).toBe("rest");
    expect(json.suggestion).toBeNull();
    const stored = vi.mocked(store.writeMorningChecks).mock.calls[0][0] as MorningCheckLog;
    expect(stored.entries[0]).toMatchObject({ date: TODAY, flag: "injury", decision: "rest" });
  });

  // Injury is accepted on a non-quality ride day too (unlike ill/extreme-fatigue, which would proceed).
  it("rests an injury flag even on a non-quality (Z2) day", async () => {
    const easy: CurrentBlock = { ...block(), days: [{ date: TODAY, name: "Easy", type: "Z2", durationMin: 90 }] };
    vi.mocked(store.readCurrentBlock).mockResolvedValue(easy);
    const json = await (await POST(req("POST", { flag: "injury", today: TODAY }))).json();
    expect(json.decision).toBe("rest");
    expect(json.suggestion).toBeNull();
  });
});

describe("PUT /api/morning-check — injury is not applyable", () => {
  it("rejects applying a 'rest' (injury) decision — nothing to move (S2-9)", async () => {
    const injuryCheck: MorningCheckEntry = { date: TODAY, flag: "injury", decision: "rest", setAt: "" };
    vi.mocked(store.readMorningChecks).mockResolvedValue({ entries: [injuryCheck], updatedAt: "" });
    const res = await PUT(req("PUT", { today: TODAY }));
    expect(res.status).toBe(400);
    expect(store.writeCurrentBlock).not.toHaveBeenCalled();
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

  // The UI re-derives its card from the stored entry after a refresh — a successful apply must stamp
  // appliedAt so the card shows "applied" instead of re-offering an Apply button that would now 400.
  it("stamps appliedAt on today's entry after a successful apply", async () => {
    vi.mocked(store.readMorningChecks).mockResolvedValue({ entries: [check("downgrade")], updatedAt: "" });
    const res = await PUT(req("PUT", { today: TODAY }));
    expect((await res.json()).ok).toBe(true);
    const stored = vi.mocked(store.writeMorningChecks).mock.calls[0][0] as MorningCheckLog;
    const entry = stored.entries.find((e) => e.date === TODAY);
    expect(entry?.appliedAt).toBeTruthy();
    expect(entry).toMatchObject({ flag: "extreme-fatigue", decision: "downgrade" }); // rest of the entry untouched
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

describe("PUT /api/morning-check — mirrors the applied swap/downgrade to Intervals.icu", () => {
  // Default block(): TODAY is VO2max, 06-21 is Rest, 06-22 is an easy Z2 → applyProactiveReschedule
  // finds an easy-day swap slot at 06-22 (see lib/reschedule.ts findMakeUpSlot).
  it("swap applied → mirrors both directions and persists the mirror-updated block", async () => {
    vi.mocked(store.readMorningChecks).mockResolvedValue({ entries: [check("downgrade")], updatedAt: "" });
    vi.mocked(mirror.persistMirroredMove).mockImplementation(async (b, days) => {
      const updatedBlock = { ...b, days: days.map((d) => (d.date === "2026-06-22" ? { ...d, eventId: 555 } : d)) };
      await store.writeCurrentBlock(updatedBlock);
      return { updatedBlock, mirrored: [TODAY, "2026-06-22"], failed: [] };
    });

    const res = await PUT(req("PUT", { today: TODAY }));
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.to).toBe("2026-06-22");
    expect(json.mirrored).toEqual([TODAY, "2026-06-22"]);
    expect(json.mirrorFailed).toEqual([]);

    const [, , calledMoves, calledToday] = vi.mocked(mirror.persistMirroredMove).mock.calls[0];
    expect(calledMoves).toEqual([
      { from: TODAY, to: "2026-06-22" },
      { from: "2026-06-22", to: TODAY },
    ]);
    expect(calledToday).toBe(TODAY);

    const written = vi.mocked(store.writeCurrentBlock).mock.calls[0][0] as CurrentBlock;
    expect(written.days.find((d) => d.date === "2026-06-22")!.eventId).toBe(555);
  });

  // Fix A (final review): applyProactiveReschedule's swap builds each destination's day from
  // {name, type, durationMin, workoutText?, prescription?} only (lib/reschedule.ts's carry()) — so
  // `updated.days` (the route's 2nd arg to persistMirroredMove) drops eventId from BOTH swapped dates.
  // The route must pass the ORIGINAL pre-move `block.days` as the 5th arg so the description-carry
  // lookup inside persistMirroredMove can still find each source's eventId.
  it("passes the ORIGINAL pre-move block.days as persistMirroredMove's 5th arg (swap drops eventId from updated.days)", async () => {
    const withIds: CurrentBlock = {
      ...block(),
      days: [
        { date: TODAY, name: "VO2 6x3", type: "VO2max", durationMin: 70, eventId: 41 },
        { date: "2026-06-21", name: "Rest", type: "Rest", durationMin: 0 },
        { date: "2026-06-22", name: "Easy", type: "Z2", durationMin: 60, eventId: 42 },
      ],
    };
    vi.mocked(store.readCurrentBlock).mockResolvedValue(withIds);
    vi.mocked(store.readMorningChecks).mockResolvedValue({ entries: [check("downgrade")], updatedAt: "" });

    await PUT(req("PUT", { today: TODAY }));

    const call = vi.mocked(mirror.persistMirroredMove).mock.calls[0];
    const calledDays = call[1];
    const calledPreMoveDays = call[4];
    // updated.days (2nd arg, post-swap) lost both eventIds.
    expect(calledDays.find((d) => d.date === TODAY)?.eventId).toBeUndefined();
    expect(calledDays.find((d) => d.date === "2026-06-22")?.eventId).toBeUndefined();
    // The 5th arg is the block's ORIGINAL pre-move days, which still has both.
    expect(calledPreMoveDays?.find((d) => d.date === TODAY)?.eventId).toBe(41);
    expect(calledPreMoveDays?.find((d) => d.date === "2026-06-22")?.eventId).toBe(42);
  });

  it("downgrade with no swap slot → mirrors a single to:null move", async () => {
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

    const res = await PUT(req("PUT", { today: TODAY }));
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.to).toBeNull();

    const [, , calledMoves] = vi.mocked(mirror.persistMirroredMove).mock.calls[0];
    expect(calledMoves).toEqual([{ from: TODAY, to: null }]);
  });

  it("mirror failure still applies locally — 200 with mirrorFailed populated", async () => {
    vi.mocked(store.readMorningChecks).mockResolvedValue({ entries: [check("downgrade")], updatedAt: "" });
    vi.mocked(mirror.persistMirroredMove).mockImplementation(async (b, days, moves) => {
      const updatedBlock = { ...b, days }; // mirror failed — local move still stands, no eventId changes
      await store.writeCurrentBlock(updatedBlock);
      return { updatedBlock, mirrored: [], failed: moves.flatMap((m) => (m.to ? [m.from, m.to] : [m.from])) };
    });

    const res = await PUT(req("PUT", { today: TODAY }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.mirrorFailed.length).toBeGreaterThan(0);
    expect(store.writeCurrentBlock).toHaveBeenCalled(); // local move still persists
  });
});

describe("GET /api/morning-check", () => {
  it("reports a quality day + a reschedule suggestion", async () => {
    const json = await (await GET(req("GET"))).json();
    expect(json.isQualityDay).toBe(true);
    expect(json.hasRideToday).toBe(true);
    expect(json.suggestion).not.toBeNull();
  });

  // S2-9: an easy ride day is not a quality day, but a ride IS planned — the injury surface needs this.
  it("reports hasRideToday true / isQualityDay false on an easy day", async () => {
    const easy: CurrentBlock = { ...block(), days: [{ date: TODAY, name: "Easy", type: "Z2", durationMin: 90 }] };
    vi.mocked(store.readCurrentBlock).mockResolvedValue(easy);
    const json = await (await GET(req("GET"))).json();
    expect(json.isQualityDay).toBe(false);
    expect(json.hasRideToday).toBe(true);
  });

  it("reports hasRideToday false on a true rest day", async () => {
    const rest: CurrentBlock = { ...block(), days: [{ date: TODAY, name: "Rest", type: "Rest", durationMin: 0 }] };
    vi.mocked(store.readCurrentBlock).mockResolvedValue(rest);
    const json = await (await GET(req("GET"))).json();
    expect(json.hasRideToday).toBe(false);
  });
});
