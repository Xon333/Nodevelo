import { describe, expect, it } from "vitest";
import { buildMovePayloads, dayToEventPayload, reconcileInboundMoves } from "./calendar-mirror";
import type { CurrentBlock, CurrentBlockDay, IntervalsCalendarEvent } from "./types";

const day = (over: Partial<CurrentBlockDay> & { date: string }): CurrentBlockDay => ({
  name: "Z2", type: "Z2", durationMin: 120, ...over,
});
const ev = (over: Partial<IntervalsCalendarEvent> & { date: string }): IntervalsCalendarEvent => ({
  id: 100, uid: `nodevelo-${over.date}`, name: "Ride", description: "steps\n\nintent text", category: "WORKOUT", type: "Ride", ...over,
});
const mkBlock = (days: CurrentBlockDay[]): CurrentBlock => ({
  goal: "g", lengthWeeks: 4, startDate: days[0].date, endDate: days[days.length - 1].date,
  overview: "", createdAt: "2026-07-01T00:00:00Z", days,
});

describe("dayToEventPayload", () => {
  it("builds WORKOUT for rides, NOTE for rest, with the nodevelo uid", () => {
    const p = dayToEventPayload(day({ date: "2026-07-15", name: "Threshold 2x20", type: "Threshold", durationMin: 75, workoutText: "- 2x20m 95%" }), "desc");
    expect(p).toMatchObject({ category: "WORKOUT", type: "Ride", uid: "nodevelo-2026-07-15", start_date_local: "2026-07-15T00:00:00", description: "desc" });
    const r = dayToEventPayload(day({ date: "2026-07-16", name: "Rest", type: "Rest", durationMin: 0 }), "rest note");
    expect(r).toMatchObject({ category: "NOTE", uid: "nodevelo-2026-07-16" });
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
    expect(dest.payload.uid).toBe("nodevelo-2026-07-16");
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
