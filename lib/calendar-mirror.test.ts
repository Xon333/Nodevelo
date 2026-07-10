import { beforeEach, describe, expect, it, vi } from "vitest";

// Only persistMirroredMove needs these mocked — the pure decision functions above don't touch IO.
vi.mock("./intervals-api", () => ({
  isIntervalsConfigured: vi.fn(),
  fetchEvents: vi.fn(),
  createEvent: vi.fn(),
}));
vi.mock("./data-store", () => ({
  writeCurrentBlock: vi.fn(),
}));

import { buildMovePayloads, dayToEventPayload, persistMirroredMove, reconcileInboundMoves } from "./calendar-mirror";
import * as intervalsApi from "./intervals-api";
import * as dataStore from "./data-store";
import type { CurrentBlock, CurrentBlockDay, IntervalsCalendarEvent } from "./types";

const day = (over: Partial<CurrentBlockDay> & { date: string }): CurrentBlockDay => ({
  name: "Z2", type: "Z2", durationMin: 120, ...over,
});
const ev = (over: Partial<IntervalsCalendarEvent> & { date: string }): IntervalsCalendarEvent => ({
  id: 100, uid: `nodevelo-${over.date}`, externalId: `nodevelo-${over.date}`, name: "Ride", description: "steps\n\nintent text", category: "WORKOUT", type: "Ride", ...over,
});
const mkBlock = (days: CurrentBlockDay[]): CurrentBlock => ({
  goal: "g", lengthWeeks: 4, startDate: days[0].date, endDate: days[days.length - 1].date,
  overview: "", createdAt: "2026-07-01T00:00:00Z", days,
});

describe("dayToEventPayload", () => {
  it("builds WORKOUT for rides, NOTE for rest, with the nodevelo external_id", () => {
    const p = dayToEventPayload(day({ date: "2026-07-15", name: "Threshold 2x20", type: "Threshold", durationMin: 75, workoutText: "- 2x20m 95%" }), "desc");
    expect(p).toMatchObject({ category: "WORKOUT", type: "Ride", external_id: "nodevelo-2026-07-15", start_date_local: "2026-07-15T00:00:00", description: "desc" });
    const r = dayToEventPayload(day({ date: "2026-07-16", name: "Rest", type: "Rest", durationMin: 0 }), "rest note");
    expect(r).toMatchObject({ category: "NOTE", external_id: "nodevelo-2026-07-16" });
    expect(r.type).toBeUndefined();
  });
});

describe("buildMovePayloads", () => {
  const days = [
    day({ date: "2026-07-14", name: "Rest", type: "Rest", durationMin: 0 }), // vacated source (was Threshold)
    day({ date: "2026-07-16", name: "Threshold 2x20", type: "Threshold", durationMin: 75, workoutText: "- 2x20m 95%" }), // destination
  ];
  const eventByDate = new Map([["2026-07-14", ev({ date: "2026-07-14", id: 41, description: "the original threshold description" })]]);

  it("destination carries the source event's description wholesale; future vacated source re-upserts as its new self", () => {
    const out = buildMovePayloads(days, [{ from: "2026-07-14", to: "2026-07-16" }], eventByDate, "2026-07-13");
    const dest = out.find((o) => o.date === "2026-07-16")!;
    expect(dest.payload.description).toBe("the original threshold description");
    expect(dest.payload.external_id).toBe("nodevelo-2026-07-16");
    expect(dest.payload.name).toBe("Threshold 2x20"); // name from the day now living there
    const src = out.find((o) => o.date === "2026-07-14")!;
    expect(src.payload.category).toBe("NOTE"); // the day is now Rest
  });

  it("a PAST vacated source is left untouched (history keeps its marker)", () => {
    const out = buildMovePayloads(days, [{ from: "2026-07-14", to: "2026-07-16" }], eventByDate, "2026-07-15");
    expect(out.map((o) => o.date)).toEqual(["2026-07-16"]); // destination only
  });

  it("a swap (two moves) carries each description to the other date", () => {
    const swapDays = [
      day({ date: "2026-07-14", name: "Endurance", type: "Z2", durationMin: 90 }),
      day({ date: "2026-07-16", name: "VO2 5x3", type: "VO2max", durationMin: 60 }),
    ];
    const evs = new Map([
      ["2026-07-14", ev({ date: "2026-07-14", id: 41, description: "vo2 desc" })], // old VO2 lived on 14th
      ["2026-07-16", ev({ date: "2026-07-16", id: 42, description: "z2 desc" })],
    ]);
    const out = buildMovePayloads(swapDays, [{ from: "2026-07-14", to: "2026-07-16" }, { from: "2026-07-16", to: "2026-07-14" }], evs, "2026-07-13");
    expect(out.find((o) => o.date === "2026-07-16")!.payload.description).toBe("vo2 desc");
    expect(out.find((o) => o.date === "2026-07-14")!.payload.description).toBe("z2 desc");
    expect(out).toHaveLength(2); // each date exactly once — a swap destination is never re-emitted as a vacated source
  });

  it("to:null (in-place downgrade) re-upserts only the source from its new day state", () => {
    const dg = [day({ date: "2026-07-14", name: "Recovery (downgraded from VO2max)", type: "Recovery", durationMin: 45 })];
    const out = buildMovePayloads(dg, [{ from: "2026-07-14", to: null }], new Map(), "2026-07-13");
    expect(out).toHaveLength(1);
    expect(out[0].payload.name).toBe("Recovery (downgraded from VO2max)");
  });

  it("a destination date in the past is never emitted (immutable history, same as a vacated source)", () => {
    const pastDays = [
      day({ date: "2026-07-10", name: "Threshold 2x20", type: "Threshold", durationMin: 75 }), // destination, but in the past
      day({ date: "2026-07-16", name: "Rest", type: "Rest", durationMin: 0 }), // vacated source, future
    ];
    const out = buildMovePayloads(pastDays, [{ from: "2026-07-16", to: "2026-07-10" }], new Map(), "2026-07-13");
    expect(out.map((o) => o.date)).not.toContain("2026-07-10");
  });

  it("a vacated source with real workoutText keeps it alongside the reschedule boilerplate", () => {
    const withText = [
      day({ date: "2026-07-14", name: "Recovery (downgraded from VO2max)", type: "Recovery", durationMin: 45, workoutText: "- 30m Z1 spin" }),
    ];
    const out = buildMovePayloads(withText, [{ from: "2026-07-14", to: null }], new Map(), "2026-07-13");
    expect(out[0].payload.description).toContain("- 30m Z1 spin");
    expect(out[0].payload.description).toContain("Rescheduled by NodeVelo — see the moved session.");
  });
});

describe("reconcileInboundMoves", () => {
  const block = mkBlock([
    day({ date: "2026-07-14", name: "VO2 5x3", type: "VO2max", durationMin: 60, eventId: 41 }),
    day({ date: "2026-07-15", name: "Rest", type: "Rest", durationMin: 0 }),
    day({ date: "2026-07-16", name: "Z2", type: "Z2", durationMin: 120, eventId: 43 }),
  ]);

  it("applies a future move onto a rest day, matched by eventId", () => {
    const res = reconcileInboundMoves(block, [ev({ date: "2026-07-15", id: 41 }), ev({ date: "2026-07-16", id: 43 })], "2026-07-13")!;
    expect(res.applied).toEqual([{ from: "2026-07-14", to: "2026-07-15" }]);
    const moved = res.days.find((d) => d.date === "2026-07-15")!;
    expect(moved).toMatchObject({ name: "VO2 5x3", type: "VO2max", durationMin: 60, eventId: 41 });
    expect(res.days.find((d) => d.date === "2026-07-14")!.type).toBe("Rest");
    expect(res.warnings).toEqual([]);
  });

  it("warns instead of moving onto an occupied day, and never touches past days", () => {
    const conflict = reconcileInboundMoves(block, [ev({ date: "2026-07-16", id: 41 }), ev({ date: "2026-07-16", id: 43 })], "2026-07-13")!;
    expect(conflict.applied).toEqual([]);
    expect(conflict.warnings.length).toBe(1); // 41 wants the 16th, but Z2 lives there
    expect(reconcileInboundMoves(block, [ev({ date: "2026-07-15", id: 41 })], "2026-07-20")).toBeNull(); // whole block in the past → nothing
  });

  it("warns when a future workout's event vanished from the calendar (never auto-deletes the plan)", () => {
    const res = reconcileInboundMoves(block, [ev({ date: "2026-07-16", id: 43 })], "2026-07-13")!;
    expect(res.applied).toEqual([]);
    expect(res.warnings[0]).toContain("2026-07-14");
  });

  it("returns null when calendar and plan agree", () => {
    expect(reconcileInboundMoves(block, [ev({ date: "2026-07-14", id: 41 }), ev({ date: "2026-07-16", id: 43 })], "2026-07-13")).toBeNull();
  });
});

// The shared persist-then-best-effort-mirror orchestrator used by both /api/reschedule and
// /api/morning-check (Task 4 extraction). Route tests mock this function as a unit; this suite
// covers its own gating/success/per-date-failure behavior for real, with only the true IO boundary
// (intervals-api, data-store) mocked.
describe("persistMirroredMove", () => {
  const blk = mkBlock([
    day({ date: "2026-07-14", name: "VO2 5x3", type: "VO2max", durationMin: 60 }),
    day({ date: "2026-07-16", name: "Rest", type: "Rest", durationMin: 0 }),
  ]);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dataStore.writeCurrentBlock).mockResolvedValue(undefined);
  });

  it("not configured → writes the local move straight through, no mirror calls", async () => {
    vi.mocked(intervalsApi.isIntervalsConfigured).mockReturnValue(false);
    const days = blk.days.map((d) => (d.date === "2026-07-14" ? { ...d, name: "Recovery" } : d));

    const res = await persistMirroredMove(blk, days, [{ from: "2026-07-14", to: null }], "2026-07-13");

    expect(intervalsApi.fetchEvents).not.toHaveBeenCalled();
    expect(intervalsApi.createEvent).not.toHaveBeenCalled();
    expect(res).toEqual({ updatedBlock: { ...blk, days }, mirrored: [], failed: [] });
    expect(dataStore.writeCurrentBlock).toHaveBeenCalledWith({ ...blk, days });
  });

  it("configured + mirror succeeds → stamps the fresh eventId and persists it", async () => {
    vi.mocked(intervalsApi.isIntervalsConfigured).mockReturnValue(true);
    vi.mocked(intervalsApi.fetchEvents).mockResolvedValue([]);
    vi.mocked(intervalsApi.createEvent).mockResolvedValue(777);

    const res = await persistMirroredMove(blk, blk.days, [{ from: "2026-07-14", to: null }], "2026-07-13");

    expect(res.mirrored).toEqual(["2026-07-14"]);
    expect(res.failed).toEqual([]);
    expect(res.updatedBlock.days.find((d) => d.date === "2026-07-14")!.eventId).toBe(777);
    const written = vi.mocked(dataStore.writeCurrentBlock).mock.calls[0][0] as CurrentBlock;
    expect(written.days.find((d) => d.date === "2026-07-14")!.eventId).toBe(777);
  });

  it("configured + createEvent rejects for a date → reports it failed, still persists the local move", async () => {
    vi.mocked(intervalsApi.isIntervalsConfigured).mockReturnValue(true);
    vi.mocked(intervalsApi.fetchEvents).mockResolvedValue([]);
    vi.mocked(intervalsApi.createEvent).mockRejectedValue(new Error("network down"));

    const res = await persistMirroredMove(blk, blk.days, [{ from: "2026-07-14", to: null }], "2026-07-13");

    expect(res.mirrored).toEqual([]);
    expect(res.failed).toEqual(["2026-07-14"]);
    expect(dataStore.writeCurrentBlock).toHaveBeenCalled(); // local move still stands despite the mirror failure
  });
});
