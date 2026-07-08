# In-App Rescheduling + Bidirectional Intervals.icu Calendar Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the athlete move a planned session in-app (and keep the existing reactive/proactive reschedules), with every app-initiated move mirrored onto the Intervals.icu calendar — **and** the reverse: a session moved on the Intervals.icu calendar is reconciled into the local block at sync time. Kills the "Mirror it on your Intervals.icu calendar" manual step the reschedule route currently apologises for.

**Architecture:** The mirror rides the existing idempotent write machinery: every NodeVelo day already owns one calendar event keyed by uid `nodevelo-<date>` (`createEvent` upserts on uid), and `CurrentBlockDay.eventId` is stamped at write time. Outbound: a move re-upserts the affected dates' events, carrying the *source event's description wholesale* to the destination (descriptions live only on the calendar — `CurrentBlockDay` has no description field, so delete+recreate would lose the intent/nutrition text). Inbound: `POST /api/sync` fetches the block window's events once (the `/events` GET endpoint was proven live in the SUB-2 investigation), matches by `eventId` (uid fallback), and applies future-only date moves onto rest/empty days — anything ambiguous becomes a sync warning, never a silent mutation. One new pure module (`lib/calendar-mirror.ts`) owns both directions' decisions; IO stays in `intervals-api.ts` + routes.

**Why the calendar matters (the stakes):** the athlete's head unit serves workouts from the Intervals.icu calendar. Today every reschedule desyncs plan from calendar — the app then serves the *wrong workout on the wrong day* at the worst possible surface. This is §7's lean slice riding the #3 sliver; the remaining §7 scope (condition-driven auto-swaps, content-edit inbound sync) stays out.

**Tech Stack:** Next.js 16 route handlers, React 19, TypeScript 5, Vitest. No new dependencies.

## Global Constraints

- Run everything with `npm`. Full verify: `npx tsc --noEmit && npm run lint && npm run build && npm test` (or `npm run check`).
- "Today" is the client's resolved local date (`resolveToday` server-side, client sends `localToday()`). **This plan also fixes the existing UTC-today bug in `/api/reschedule`** (both GET and POST currently inline `new Date().toISOString().slice(0,10)` — AGENTS.md recurring bug class #2).
- Sparse-field convention: optional fields omitted when absent, never persisted `null`; read sites truthy-check.
- **Best-effort mirror, honest failure:** a local move always persists; a failed calendar call surfaces as a warning in the response, never rolls back the local change and never throws the route.
- **Past is immutable:** no calendar or block mutation ever touches a date `< today` — a ridden/missed day keeps its history and its calendar marker (same rule as `staleEventIds`).
- Frozen ledger untouched: moving a future day changes only future `plannedByDate` matching; `mergeScoreLog` already freezes existing dates.
- **Live write-path verification is mandatory** (Task 7, attended): this touches the athlete's real calendar. No destructive experimentation — verify with one real future session, then restore. Do not run this while the 2026-07-12 turnover runbook is mid-flight.
- Concurrent-agent repo: commit on `main`, stage only files you touched (never `git add -A`).

## File Structure

| File | Responsibility |
|---|---|
| Modify `lib/types.ts` | `IntervalsCalendarEvent` type |
| Modify `lib/intervals-api.ts` | `fetchEvents(oldest, newest)` GET + pure `parseCalendarEvents` |
| Create `lib/calendar-mirror.ts` | Both directions' decisions: `dayToEventPayload`, `buildMovePayloads` (outbound), `reconcileInboundMoves` (inbound), plus the one IO orchestrator `applyCalendarMirror` |
| Create `lib/calendar-mirror.test.ts` | Unit tests for the pure functions |
| Modify `app/api/reschedule/route.ts` (+ test) | UTC-today fix · make-up POST gains mirror · new PUT = manual move |
| Modify `app/api/morning-check/route.ts` (+ test) | Proactive-apply PUT gains mirror (swap/downgrade) |
| Modify `app/api/sync/route.ts` (+ test) | Inbound reconcile before scoring |
| Modify `components/RescheduleBanner.tsx` | Send `today`; drop the "mirror manually" copy |
| Create `components/MoveDay.tsx`; modify `components/dashboard/plan.tsx` | Manual-move control on future day cards (native date input) |
| Modify `FEATURES.md`, `README.md`, `ROADMAP.md`, `ARCHIVE.md` | Docs |

---

### Task 1: `fetchEvents` — the calendar read

**Files:**
- Modify: `lib/types.ts` (near `IntervalsEventPayload`, ~line 784)
- Modify: `lib/intervals-api.ts` (writes section, after `createEvent`)
- Test: `lib/intervals-api-parse.test.ts` (create — parsing only; the fetch itself is IO)

**Interfaces:**
- Produces:
  - `IntervalsCalendarEvent { id: number | null; uid: string | null; date: string; name: string; description: string; category: string; type: string | null }`
  - `parseCalendarEvents(raw: unknown): IntervalsCalendarEvent[]` (pure, exported for tests)
  - `fetchEvents(oldestDate: string, newestDate: string): Promise<IntervalsCalendarEvent[]>`

- [ ] **Step 1: Write the failing parse test**

```ts
// lib/intervals-api-parse.test.ts
import { describe, expect, it } from "vitest";
import { parseCalendarEvents } from "./intervals-api";

describe("parseCalendarEvents", () => {
  it("maps the fields the mirror needs and takes the date part of start_date_local", () => {
    const raw = [
      { id: 111, uid: "nodevelo-2026-07-10", start_date_local: "2026-07-10T00:00:00", name: "Durability C", description: "3h Z2…", category: "WORKOUT", type: "Ride" },
      { id: 222, uid: null, start_date_local: "2026-07-11T09:30:00", name: "note", description: "", category: "NOTE" },
    ];
    expect(parseCalendarEvents(raw)).toEqual([
      { id: 111, uid: "nodevelo-2026-07-10", date: "2026-07-10", name: "Durability C", description: "3h Z2…", category: "WORKOUT", type: "Ride" },
      { id: 222, uid: null, date: "2026-07-11", name: "note", description: "", category: "NOTE", type: null },
    ]);
  });

  it("drops malformed entries instead of throwing", () => {
    expect(parseCalendarEvents([{ id: 1 }, "junk", null])).toEqual([]);
    expect(parseCalendarEvents("not-an-array")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/intervals-api-parse.test.ts`
Expected: FAIL — `parseCalendarEvents` not exported.

- [ ] **Step 3: Implement**

`lib/types.ts` (below `IntervalsEventPayload`):

```ts
// A calendar event as READ from Intervals.icu (GET /athlete/{id}/events) — the mirror's inbound shape.
// `date` is the YYYY-MM-DD part of start_date_local; description is carried wholesale on moves because
// CurrentBlockDay stores no description (it lives only on the calendar event).
export interface IntervalsCalendarEvent {
  id: number | null;
  uid: string | null;
  date: string;
  name: string;
  description: string;
  category: string; // WORKOUT | NOTE (loosely typed — upstream may add values)
  type: string | null; // Ride, WeightTraining, …
}
```

`lib/intervals-api.ts` (after `createEvent`; reuse the file's existing `asRecord`/`num`/`str`-style coercion helpers — check their exact names at the top of the file and use those):

```ts
// Pure mapper for the events list — exported for tests; drops anything without an id-or-uid + date.
export function parseCalendarEvents(raw: unknown): IntervalsCalendarEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: IntervalsCalendarEvent[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "number" ? r.id : null;
    const uid = typeof r.uid === "string" && r.uid.length > 0 ? r.uid : null;
    const sdl = typeof r.start_date_local === "string" ? r.start_date_local : "";
    const date = sdl.slice(0, 10);
    if ((id === null && uid === null) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      id,
      uid,
      date,
      name: typeof r.name === "string" ? r.name : "",
      description: typeof r.description === "string" ? r.description : "",
      category: typeof r.category === "string" ? r.category : "",
      type: typeof r.type === "string" ? r.type : null,
    });
  }
  return out;
}

// All calendar events in a date window (GET /athlete/{id}/events?oldest=&newest=) — the inbound half
// of the calendar mirror, and the description source for outbound moves. Endpoint proven live in the
// SUB-2 legacy-backfill investigation (ROADMAP "Data substrate").
export async function fetchEvents(oldestDate: string, newestDate: string): Promise<IntervalsCalendarEvent[]> {
  const data = await icuFetch(
    athletePath(`/events?oldest=${encodeURIComponent(oldestDate)}&newest=${encodeURIComponent(newestDate)}`)
  );
  return parseCalendarEvents(data);
}
```

Add `IntervalsCalendarEvent` to the file's `./types` import.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/intervals-api-parse.test.ts && npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/intervals-api.ts lib/intervals-api-parse.test.ts
git commit -m "feat(icu): fetchEvents calendar read + parseCalendarEvents (§7 mirror substrate)"
```

---

### Task 2: `lib/calendar-mirror.ts` — pure decisions, both directions

**Files:**
- Create: `lib/calendar-mirror.ts`
- Test: `lib/calendar-mirror.test.ts`

**Interfaces:**
- Consumes: `CurrentBlock`, `CurrentBlockDay`, `IntervalsCalendarEvent`, `IntervalsEventPayload`, `WorkoutType` from `./types`.
- Produces (Tasks 3–5 rely on these exact names):
  - `type PlannedMove = { from: string; to: string | null }` — content flowed from→to; `to: null` = the source was downgraded in place (deload), only the source re-upserts
  - `dayToEventPayload(day: CurrentBlockDay, description: string): IntervalsEventPayload`
  - `buildMovePayloads(days: CurrentBlockDay[], moves: PlannedMove[], eventByDate: Map<string, IntervalsCalendarEvent>, today: string): Array<{ date: string; payload: IntervalsEventPayload }>`
  - `reconcileInboundMoves(block: CurrentBlock, events: IntervalsCalendarEvent[], today: string): { days: CurrentBlockDay[]; applied: Array<{ from: string; to: string }>; warnings: string[] } | null` — null = nothing to change and nothing to warn
  - `applyCalendarMirror(block: CurrentBlock, moves: PlannedMove[]): Promise<{ updatedBlock: CurrentBlock; mirrored: string[]; failed: string[] }>` (the IO orchestrator — Task 3 wires it)

- [ ] **Step 1: Write the failing tests**

```ts
// lib/calendar-mirror.test.ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/calendar-mirror.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `lib/calendar-mirror.ts`**

```ts
// §7 lean slice — the bidirectional calendar mirror's DECISIONS (pure) plus one IO orchestrator.
// The invariant both directions preserve: one NodeVelo-owned event per block date, keyed by uid
// `nodevelo-<date>` (createEvent upserts on it) and tracked by CurrentBlockDay.eventId.
// Descriptions live ONLY on the calendar (CurrentBlockDay has no description field), so an outbound
// move carries the source event's description wholesale instead of rebuilding-and-losing it.

import { createEvent, fetchEvents } from "./intervals-api";
import type { CurrentBlock, CurrentBlockDay, IntervalsCalendarEvent, IntervalsEventPayload } from "./types";

export type PlannedMove = { from: string; to: string | null };

// CurrentBlockDay → event payload; mirrors planDayToEvent's shape (plan-parser.ts) but takes the
// description explicitly, because a block day carries none of its own.
export function dayToEventPayload(day: CurrentBlockDay, description: string): IntervalsEventPayload {
  const start_date_local = `${day.date}T00:00:00`;
  const uid = `nodevelo-${day.date}`;
  if (day.type === "Rest" || day.durationMin <= 0) {
    return { category: "NOTE", start_date_local, name: day.name || "Rest day", description, uid };
  }
  const isStrength = day.type === "Strength";
  return {
    category: "WORKOUT",
    start_date_local,
    name: day.name,
    type: isStrength ? "WeightTraining" : "Ride",
    description: [day.workoutText?.trim() ?? "", description].filter(Boolean).join("\n\n"),
    uid,
    ...(isStrength && day.durationMin > 0 ? { moving_time: day.durationMin * 60 } : {}),
  };
}

// The upserts a set of moves requires. Content flows from→to: each destination's payload is built
// from the day now living there, carrying the OLD source event's description; a vacated source
// re-upserts as its new self (rest note / swapped-in easy day) — but only when it's today-or-future
// (a past date keeps its history marker untouched). A swap is two moves; each date emits exactly once.
export function buildMovePayloads(
  days: CurrentBlockDay[],
  moves: PlannedMove[],
  eventByDate: Map<string, IntervalsCalendarEvent>,
  today: string
): Array<{ date: string; payload: IntervalsEventPayload }> {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const destinationSource = new Map<string, string>(); // to → from (where its content came from)
  for (const m of moves) if (m.to) destinationSource.set(m.to, m.from);

  const affected = new Set<string>();
  for (const m of moves) {
    affected.add(m.from);
    if (m.to) affected.add(m.to);
  }

  const out: Array<{ date: string; payload: IntervalsEventPayload }> = [];
  for (const date of affected) {
    const d = byDate.get(date);
    if (!d) continue;
    const sourceOfContent = destinationSource.get(date);
    if (sourceOfContent) {
      // Destination: carry the moved workout's original description (intent + nutrition text).
      const oldEvent = eventByDate.get(sourceOfContent);
      out.push({ date, payload: dayToEventPayload(d, oldEvent?.description ?? "") });
    } else if (date >= today) {
      // Vacated source, still in the future → its event becomes what the day now is.
      out.push({ date, payload: dayToEventPayload(d, `Rescheduled by NodeVelo — see the moved session.`) });
    } // past vacated source: leave the calendar marker as history
  }
  return out;
}

// Inbound: the athlete moved things ON Intervals.icu; reconcile the local block to match. Deliberate
// limits (each violation is a warning, never a silent mutation):
//   - future-only, both sides — past days are frozen history;
//   - single moves onto rest/empty days only — a pairwise swap made on Intervals.icu surfaces as two
//     conflict warnings for manual resolution (ponytail: handle singles; add swap pairing if real use
//     hits the warning often);
//   - a vanished future workout event warns — the app never deletes a prescription off the calendar's say-so.
// Known limit: an accepted inbound move leaves the event's uid stamped with its OLD date. eventId
// (which we re-key here) is the true key everywhere (blockEventIds/staleEventIds/this reconcile), so
// cleanup and future matching are unaffected.
export function reconcileInboundMoves(
  block: CurrentBlock,
  events: IntervalsCalendarEvent[],
  today: string
): { days: CurrentBlockDay[]; applied: Array<{ from: string; to: string }>; warnings: string[] } | null {
  const byId = new Map(events.filter((e) => e.id !== null).map((e) => [e.id as number, e]));
  const byUid = new Map(events.filter((e) => e.uid !== null).map((e) => [e.uid as string, e]));
  const dayAt = new Map(block.days.map((d) => [d.date, d]));

  const applied: Array<{ from: string; to: string }> = [];
  const warnings: string[] = [];
  let days = [...block.days];

  for (const d of block.days) {
    if (d.date < today || d.durationMin <= 0 || d.type === "Rest") continue;
    const evt = (typeof d.eventId === "number" ? byId.get(d.eventId) : undefined) ?? byUid.get(`nodevelo-${d.date}`);
    if (!evt) {
      warnings.push(`Calendar event for ${d.date} (${d.name}) is missing on Intervals.icu — plan kept; re-write the block or restore the event.`);
      continue;
    }
    if (evt.date === d.date) continue;
    if (evt.date < today || !dayAt.has(evt.date)) {
      warnings.push(`Calendar moved ${d.date} (${d.name}) to ${evt.date}, which is outside the movable window — not applied.`);
      continue;
    }
    const target = dayAt.get(evt.date)!;
    if (target.durationMin > 0 && target.type !== "Rest") {
      warnings.push(`Calendar moved ${d.date} (${d.name}) onto ${evt.date}, but ${target.name} is planned there — resolve manually.`);
      continue;
    }
    // Apply: the workout's content (and eventId) relocates; the old date becomes a rest day.
    days = days.map((x) => {
      if (x.date === evt.date) {
        const { date: _old, ...content } = d;
        return { date: evt.date, ...content };
      }
      if (x.date === d.date) return { date: d.date, name: `Rest (moved to ${evt.date})`, type: "Rest" as CurrentBlockDay["type"], durationMin: 0 };
      return x;
    });
    applied.push({ from: d.date, to: evt.date });
  }

  return applied.length === 0 && warnings.length === 0 ? null : { days, applied, warnings };
}

// The one IO step (Task 3+ wire it): read the block window's events (description source), upsert the
// affected dates, re-stamp eventIds on the updated days. Best-effort per date — a failure never
// unwinds the local move; callers surface `failed` as a warning.
export async function applyCalendarMirror(
  block: CurrentBlock,
  moves: PlannedMove[]
): Promise<{ updatedBlock: CurrentBlock; mirrored: string[]; failed: string[] }> {
  let eventByDate = new Map<string, IntervalsCalendarEvent>();
  try {
    const events = await fetchEvents(block.startDate, block.endDate);
    eventByDate = new Map(events.filter((e) => e.uid?.startsWith("nodevelo-")).map((e) => [e.uid!.slice("nodevelo-".length), e]));
  } catch {
    // No description source — payloads fall back to workoutText-only descriptions rather than failing the mirror.
  }
  const today = new Date().toISOString().slice(0, 10); // pure guard for "past stays untouched"; callers pass resolved dates in `moves`
  const payloads = buildMovePayloads(block.days, moves, eventByDate, today);
  const mirrored: string[] = [];
  const failed: string[] = [];
  let days = block.days;
  for (const { date, payload } of payloads) {
    try {
      const id = await createEvent(payload); // upserts on uid
      mirrored.push(date);
      if (id !== null) days = days.map((d) => (d.date === date ? { ...d, eventId: id } : d));
    } catch {
      failed.push(date);
    }
  }
  return { updatedBlock: { ...days === block.days ? block : { ...block, days } }, mirrored, failed };
}
```

**Fix before running:** the last line's spread is wrong as sketched — make it explicit:

```ts
  return { updatedBlock: days === block.days ? block : { ...block, days }, mirrored, failed };
```

Also replace the `applyCalendarMirror` UTC-today line: accept `today` as a third parameter instead (`applyCalendarMirror(block, moves, today: string)`) and pass it into `buildMovePayloads` — routes always have the resolved local date (AGENTS.md rule; the inline UTC fallback above is exactly the anti-pattern this plan removes elsewhere). Update the Produces block accordingly: **`applyCalendarMirror(block, moves, today)`**.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/calendar-mirror.test.ts && npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/calendar-mirror.ts lib/calendar-mirror.test.ts
git commit -m "feat(mirror): pure calendar-mirror decisions — outbound move payloads + inbound reconcile"
```

---

### Task 3: `/api/reschedule` — UTC fix, mirrored make-up POST, new manual-move PUT

**Files:**
- Modify: `app/api/reschedule/route.ts`
- Test: `app/api/reschedule/route.test.ts` (create if absent — check; model mocks on `app/api/morning-check/route.test.ts`)

**Interfaces:**
- Consumes: `applyCalendarMirror(block, moves, today)`, `PlannedMove` (Task 2); `resolveToday`, `isIntervalsConfigured`.
- Produces: `POST { from, to, today }` (make-up; unchanged local semantics + mirror). `PUT { from, to, today }` (manual move: `from` ≥ today with a ride, `to` ≥ today a rest/no-ride day in-block; `from` becomes Rest locally). Both respond `{ ok: true, mirrored: string[], mirrorFailed: string[] }`.

- [ ] **Step 1: Write the failing route test** — cases: (a) POST make-up moves content to `to`, keeps `from` as history, calls the mirror with `[{ from, to }]`, persists mirror-updated eventIds; (b) POST with `to` ≤ today → 400 (now judged against the *client's* `today`, not UTC); (c) PUT manual move: `from` day becomes `Rest (moved to <to>)` with `durationMin: 0` and no `workoutText`/`prescription`/`eventId` remnants, `to` gets the full content; (d) PUT onto an occupied day → 400; (e) mirror failure (mock `applyCalendarMirror` rejecting or returning `failed`) → 200 with `mirrorFailed` non-empty and the local move still persisted. Mock `@/lib/calendar-mirror` and assert call args; follow the morning-check test file's store-mock pattern.

Run: `npx vitest run app/api/reschedule/route.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implement**

Rework `app/api/reschedule/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readCurrentBlock, readDispositions, readScoreLog, writeCurrentBlock } from "@/lib/data-store";
import { suggestReschedule, type DispositionByDate } from "@/lib/reschedule";
import { applyCalendarMirror, type PlannedMove } from "@/lib/calendar-mirror";
import { isIntervalsConfigured } from "@/lib/intervals-api";
import { resolveToday } from "@/lib/date";
import type { CurrentBlock, CurrentBlockDay } from "@/lib/types";

// GET → the current reschedule suggestion (or null). `today` comes from the client (local date),
// falling back to UTC — the previous inline toISOString() drifted a day near midnight (AGENTS.md
// recurring bug class; fixed here).
export async function GET(req: Request) {
  const today = resolveToday(new URL(req.url).searchParams.get("today"));
  const [block, scoreLog, dispositions] = await Promise.all([readCurrentBlock(), readScoreLog(), readDispositions()]);
  const scoredDates = new Set(scoreLog.entries.map((e) => e.date));
  const dispositionByDate: DispositionByDate = Object.fromEntries(dispositions.entries.map((e) => [e.date, e.disposition]));
  return NextResponse.json({ suggestion: suggestReschedule(block, scoredDates, dispositionByDate, today) });
}

// Shared: persist the local change, then best-effort mirror to the Intervals.icu calendar. The local
// move ALWAYS stands; a mirror failure is surfaced, never a rollback (the athlete can re-sync later).
async function persistAndMirror(block: CurrentBlock, days: CurrentBlockDay[], moves: PlannedMove[], today: string) {
  let updated: CurrentBlock = { ...block, days };
  let mirrored: string[] = [];
  let mirrorFailed: string[] = [];
  if (isIntervalsConfigured()) {
    try {
      const res = await applyCalendarMirror(updated, moves, today);
      updated = res.updatedBlock;
      mirrored = res.mirrored;
      mirrorFailed = res.failed;
    } catch {
      mirrorFailed = moves.flatMap((m) => (m.to ? [m.from, m.to] : [m.from]));
    }
  }
  await writeCurrentBlock(updated);
  return { mirrored, mirrorFailed };
}

function parseBody(body: unknown): { from: string; to: string; today: string } | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const from = typeof b.from === "string" ? b.from : null;
  const to = typeof b.to === "string" ? b.to : null;
  if (!from || !to) return null;
  return { from, to, today: resolveToday(b.today) };
}

// POST { from, to, today } → make up the missed `from` session on the `to` rest day (athlete-confirmed).
// `from` stays as history; the calendar mirror writes the workout onto `to`.
export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const p = parseBody(body);
  if (!p) return NextResponse.json({ error: "from and to dates are required." }, { status: 400 });

  const block = await readCurrentBlock();
  if (!block) return NextResponse.json({ error: "No active block." }, { status: 400 });
  const fromDay = block.days.find((d) => d.date === p.from);
  const toDay = block.days.find((d) => d.date === p.to);
  if (!fromDay || !toDay) return NextResponse.json({ error: "from/to not in the current block." }, { status: 400 });
  if (p.to <= p.today) return NextResponse.json({ error: "Can only reschedule onto a future day." }, { status: 400 });

  const days = block.days.map((d) =>
    d.date === p.to
      ? {
          ...d,
          name: fromDay.name,
          type: fromDay.type,
          durationMin: fromDay.durationMin,
          ...(fromDay.workoutText ? { workoutText: fromDay.workoutText } : {}),
          ...(fromDay.prescription ? { prescription: fromDay.prescription } : {}),
        }
      : d
  );
  const { mirrored, mirrorFailed } = await persistAndMirror(block, days, [{ from: p.from, to: p.to }], p.today);
  return NextResponse.json({ ok: true, mirrored, mirrorFailed });
}

// PUT { from, to, today } → MANUAL move (§7 lean slice): shift a future planned session to a clear
// rest/empty day. Unlike the make-up POST, `from` genuinely vacates (becomes a rest day) — this is
// "I can't ride Thursday, make it Friday," not "I missed it."
export async function PUT(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const p = parseBody(body);
  if (!p) return NextResponse.json({ error: "from and to dates are required." }, { status: 400 });

  const block = await readCurrentBlock();
  if (!block) return NextResponse.json({ error: "No active block." }, { status: 400 });
  const fromDay = block.days.find((d) => d.date === p.from);
  const toDay = block.days.find((d) => d.date === p.to);
  if (!fromDay || !toDay) return NextResponse.json({ error: "from/to not in the current block." }, { status: 400 });
  if (p.from < p.today) return NextResponse.json({ error: "Can't move a past session." }, { status: 400 });
  if (p.to < p.today) return NextResponse.json({ error: "Can't move onto a past day." }, { status: 400 });
  if (fromDay.durationMin <= 0 || fromDay.type === "Rest") return NextResponse.json({ error: "Nothing planned on the from day." }, { status: 400 });
  if (toDay.durationMin > 0 && toDay.type !== "Rest") return NextResponse.json({ error: `${toDay.name} is already planned on ${p.to} — move onto a rest day.` }, { status: 400 });

  const { date: _d, eventId: _e, ...content } = fromDay;
  const days = block.days.map((d) => {
    if (d.date === p.to) return { date: p.to, ...content, ...(typeof fromDay.eventId === "number" ? { eventId: fromDay.eventId } : {}) };
    if (d.date === p.from) return { date: p.from, name: `Rest (moved to ${p.to})`, type: "Rest" as CurrentBlockDay["type"], durationMin: 0 };
    return d;
  });
  const { mirrored, mirrorFailed } = await persistAndMirror(block, days, [{ from: p.from, to: p.to }], p.today);
  return NextResponse.json({ ok: true, mirrored, mirrorFailed });
}
```

- [ ] **Step 3: Run tests, then update `components/RescheduleBanner.tsx`**

Run: `npx vitest run app/api/reschedule/route.test.ts && npx tsc --noEmit` — Expected: PASS.

In `RescheduleBanner.tsx`: the GET fetch gains `?today=${localToday()}`, the POST body gains `today: localToday()` (import `localToday` from `@/lib/date`), and the old "Mirror it on your Intervals.icu calendar" note copy is replaced with a conditional: show "Calendar updated on Intervals.icu ✓" when `mirrorFailed.length === 0`, else "Moved in the app — Intervals.icu update failed for {dates}; re-syncing later or moving it there manually keeps them aligned." (match the component's existing copy tone/classes).

- [ ] **Step 4: Commit**

```bash
git add app/api/reschedule/route.ts app/api/reschedule/route.test.ts components/RescheduleBanner.tsx
git commit -m "feat(reschedule): manual-move PUT + calendar mirror on make-up; local-today fix (AGENTS.md bug class)"
```

---

### Task 4: Morning-check proactive apply — mirror the swap/downgrade

**Files:**
- Modify: `app/api/morning-check/route.ts` (the PUT handler that calls `applyProactiveReschedule` / `proactiveApplyBlock`)
- Test: `app/api/morning-check/route.test.ts`

**Interfaces:**
- Consumes: `applyProactiveReschedule` already returns `{ days, to, deferred, skippedRestDay }` (`lib/reschedule.ts:115`) — `to !== null` means a two-way swap of `today ↔ to`; `to === null` means an in-place downgrade of `today`.

- [ ] **Step 1: Write the failing test** — extend the existing PUT cases: (a) swap applied → mirror called with `[{ from: today, to }, { from: to, to: today }]` and the persisted block carries mirror-updated `eventId`s; (b) downgrade (no slot) → mirror called with `[{ from: today, to: null }]`; (c) mirror throwing → PUT still 200, response gains `mirrorFailed`. Mock `@/lib/calendar-mirror` as in Task 3.

Run: `npx vitest run app/api/morning-check/route.test.ts` — Expected: FAIL on the new cases.

- [ ] **Step 2: Implement** — in the PUT handler, locate where the applied result's `days` are written (`writeCurrentBlock`). Replace the direct write with the moves derivation + the same persist-and-mirror shape as Task 3 (import `applyCalendarMirror`, `isIntervalsConfigured`; the route already resolves the client `today`):

```ts
      const moves: PlannedMove[] =
        applied.to !== null
          ? [{ from: date, to: applied.to }, { from: applied.to, to: date }] // load-preserving swap — both dates changed
          : [{ from: date, to: null }]; // honest deload — today's event becomes the downgraded session
      let updated: CurrentBlock = { ...block, days: applied.days };
      let mirrored: string[] = [];
      let mirrorFailed: string[] = [];
      if (isIntervalsConfigured()) {
        try {
          const res = await applyCalendarMirror(updated, moves, date);
          updated = res.updatedBlock;
          mirrored = res.mirrored;
          mirrorFailed = res.failed;
        } catch {
          mirrorFailed = moves.flatMap((m) => (m.to ? [m.from, m.to] : [m.from]));
        }
      }
      await writeCurrentBlock(updated);
```

and add `mirrored`/`mirrorFailed` to the PUT's JSON response. (Adapt local names — `applied`, `date`, `block` — to the handler's actual variables; the shape above is the contract. If the shared persist-and-mirror block is identical to Task 3's, extract it: `lib/calendar-mirror.ts` gains `export async function persistMirroredMove(block, days, moves, today)` and **both** routes call it — DRY beats two copies; move the Task 3 helper there in this task and update Task 3's route import.)

- [ ] **Step 3: Run tests**

Run: `npx vitest run app/api/morning-check/route.test.ts app/api/reschedule/route.test.ts && npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/morning-check/route.ts app/api/morning-check/route.test.ts lib/calendar-mirror.ts app/api/reschedule/route.ts
git commit -m "feat(mirror): proactive downgrade/swap mirrors to the Intervals.icu calendar"
```

---

### Task 5: Inbound reconcile in `POST /api/sync`

**Files:**
- Modify: `app/api/sync/route.ts`
- Test: `app/api/sync/route.test.ts`

**Interfaces:**
- Consumes: `fetchEvents` (Task 1), `reconcileInboundMoves` (Task 2), the route's resolved `today` and its `block` local (the one later passed to `buildRideScores` — reconcile MUST run before scoring so this sync's plannedByDate matching sees the athlete's calendar reality).

- [ ] **Step 1: Write the failing route test** — following the sync test file's established mocks: with a current block whose future day has `eventId: 41` and a mocked `fetchEvents` returning that event on a different future rest date, `POST /api/sync` (a) persists the block with the day relocated, (b) includes a "Calendar move applied" line in the response warnings/notices, (c) scores against the NEW date. Add one case where `fetchEvents` rejects → sync succeeds with a "calendar check skipped" warning.

Run: `npx vitest run app/api/sync/route.test.ts` — Expected: FAIL on new cases.

- [ ] **Step 2: Implement** — in `POST`, after the fresh sync data is persisted and the current block is read, **before** the `buildRideScores` call (locate `const fresh = buildRideScores(`), insert:

```ts
      // §7 inbound: the athlete may have moved NodeVelo events on the Intervals.icu calendar (the head
      // unit's source of truth). Reconcile date moves into the local block BEFORE scoring, so this
      // sync's planned-day matching sees the same calendar the athlete rode from. Best-effort — a
      // calendar hiccup must never fail the sync.
      if (block) {
        try {
          const calendarEvents = await fetchEvents(block.startDate, block.endDate);
          const rec = reconcileInboundMoves(block, calendarEvents, today);
          if (rec) {
            if (rec.applied.length > 0) {
              block = { ...block, days: rec.days };
              await writeCurrentBlock(block);
              warnings.push(...rec.applied.map((m) => `Calendar move applied: ${m.from} → ${m.to} (from Intervals.icu).`));
            }
            warnings.push(...rec.warnings);
          }
        } catch (e) {
          logWarn("/api/sync", "calendar-reconcile", e instanceof Error ? e.message : String(e));
          warnings.push("Intervals.icu calendar check skipped (fetch failed) — plan/calendar may be out of step until the next sync.");
        }
      }
```

Adapt to the route's real locals: `block` may be `const` (change to `let`), the warnings collector's real name, and `writeCurrentBlock`/`fetchEvents`/`reconcileInboundMoves`/`logWarn` imports. One extra API call per sync, inside the existing best-effort discipline.

- [ ] **Step 3: Run tests**

Run: `npx vitest run app/api/sync/route.test.ts && npx tsc --noEmit` — Expected: PASS (all pre-existing sync cases still green).

- [ ] **Step 4: Commit**

```bash
git add app/api/sync/route.ts app/api/sync/route.test.ts
git commit -m "feat(sync): inbound calendar reconcile — Intervals.icu moves flow into the local block (§7)"
```

---

### Task 6: Plan-page move control

**Files:**
- Create: `components/MoveDay.tsx`
- Modify: `components/dashboard/plan.tsx` (the day-card region; an overflow-menu pattern already exists at ~lines 335–420 — reuse its classes/aria)

- [ ] **Step 1: Implement the component** (native `<input type="date">` — no picker dependency)

```tsx
"use client";

import { useState } from "react";
import { api } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { useSync } from "../SyncProvider";

// §7 manual move: shift a future planned session to a clear rest day. Server validates (rest-day
// target, future-only); this control just collects the date. Mirrored to Intervals.icu by the route.
export default function MoveDay({ date, minDate, maxDate }: { date: string; minDate: string; maxDate: string }) {
  const { doSync } = useSync(); // confirm the provider's actual refresh member — see step 2
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const move = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ ok: boolean; mirrorFailed: string[] }>("/api/reschedule", {
        method: "PUT",
        body: JSON.stringify({ from: date, to, today: localToday() }),
      });
      setNote(res.mirrorFailed.length === 0 ? "Moved — Intervals.icu calendar updated." : "Moved in the app; Intervals.icu update failed (will drift until re-synced).");
      setOpen(false);
      await doSync(); // refresh the calendar view
    } catch (e) {
      setError(e instanceof Error ? e.message : "Move failed");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <button onClick={() => setOpen(true)} className="text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400">
          Move…
        </button>
        {note && <span className="text-xs text-zinc-500 dark:text-zinc-400">{note}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <input
        type="date"
        value={to}
        min={minDate}
        max={maxDate}
        onChange={(e) => setTo(e.target.value)}
        className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-600 dark:bg-zinc-900"
        aria-label={`Move ${date} to`}
      />
      <button disabled={busy || !to} onClick={move} className="rounded border border-[#ff49c8]/60 px-2 py-0.5 text-[#ff49c8] disabled:opacity-50">
        Move
      </button>
      <button disabled={busy} onClick={() => setOpen(false)} className="text-zinc-500 dark:text-zinc-400">
        Cancel
      </button>
      {error && <span role="alert" className="text-red-600 dark:text-red-400">{error}</span>}
    </span>
  );
}
```

- [ ] **Step 2: Mount it** — in `components/dashboard/plan.tsx`, find the expanded day-card detail (the `<details>` day rendering, ~line 165) and render `<MoveDay date={day.date} minDate={/* tomorrow: computed from localToday */} maxDate={block.endDate} />` only for days where `day.date >= today && day.durationMin > 0 && day.type !== "Rest"`. Check `components/SyncProvider.tsx` for the real refresh member (`doSync` per the provider's docs in README §1) and the day-card's actual prop names; place the control where the card's secondary actions sit so it doesn't compete with the page's primary action (UX-CONSTITUTION: one primary action per page).

- [ ] **Step 3: Verify**

Run: `npm run check && npm run build` — Expected: clean.
Preview (preview port): open `/plan`, expand a future day card → "Move…" affordance renders with the native date input, dark mode correct; a past/rest day shows none. Don't execute a real move against the live calendar here — that's Task 7, attended.

- [ ] **Step 4: Commit**

```bash
git add components/MoveDay.tsx components/dashboard/plan.tsx
git commit -m "feat(plan): manual move control on future day cards (§7 lean slice)"
```

---

### Task 7: Attended live verification + docs

**Files:**
- Modify: `FEATURES.md`, `README.md`, `ROADMAP.md`, `ARCHIVE.md`

- [ ] **Step 1: Attended live run (write path — real calendar; do this WITH the user, not around the 07-12 turnover runbook)**

1. `GET /api/export` → save a backup first (same discipline as the turnover runbook).
2. Outbound: on `/plan`, move one real *future* session to a rest day → confirm on intervals.icu the workout event moved (name, description intact — the intent text must have travelled) and the vacated day shows the rest note. Then move it back and re-confirm.
3. Inbound: on intervals.icu, drag one future NodeVelo event to a rest day → `POST /api/sync` in the app → confirm the Plan calendar shows the move + the "Calendar move applied" sync notice. Drag it back, re-sync, confirm again.
4. Any mismatch: stop, restore from the backup, report — don't improvise against live data.

- [ ] **Step 2: Docs**

- `FEATURES.md` → "Adaptive scheduling" section, new bullets:
  ```md
  - **Manual move** — shift any future session to a clear rest day from its Plan day card; validated
    server-side (future-only, rest-target-only). `PUT /api/reschedule`, `components/MoveDay.tsx`
  - **Bidirectional calendar mirror (§7 lean slice)** — every app-initiated move (manual, make-up,
    morning-check swap/downgrade) upserts the affected Intervals.icu events (descriptions carried with
    the moved workout); moves made ON Intervals.icu reconcile into the local block at sync (future-only,
    onto rest days; conflicts surface as warnings, never silent edits). `lib/calendar-mirror.ts`
  ```
- `README.md` → module map: `calendar-mirror.ts` row ("Bidirectional §7 mirror: outbound move upserts + inbound sync-time reconcile"); §4 gets one sentence noting planned-workout events are now kept bidirectionally in step (physiology remains strictly one-way).
- `ROADMAP.md` → `§7`: the reschedule/calendar-mirror slice shipped → ARCHIVE; §7 keeps condition-driven swaps + content-edit inbound sync as the remaining open scope. `#3`: strike the "calendar mirror ← §7" sliver (shipped).
- `ARCHIVE.md` → entry "In-app rescheduling + bidirectional calendar mirror — §7 lean slice (2026-07-08)": the uid-upsert mirror design, description-carry rationale, inbound limits (future-only, rest-target-only, swap→warnings, vanished-event→warning), the stale-uid known limit, the reschedule-route UTC-today fix, live verification record. Plan: `docs/superpowers/plans/2026-07-08-reschedule-calendar-mirror.md`.

- [ ] **Step 3: Commit (docs separate)**

```bash
git add FEATURES.md README.md ROADMAP.md ARCHIVE.md
git commit -m "docs: bidirectional reschedule + calendar mirror shipped (§7 lean slice, #3 sliver closed)"
```

---

## Self-review notes (already applied)

- **Spec coverage:** manual in-app move ✓ (Task 3 PUT + Task 6 UI) · all app-initiated moves mirrored ✓ (Task 3 make-up, Task 4 proactive swap/downgrade) · **inbound Intervals.icu sync ✓ (Tasks 1, 2, 5 — the user's "really important" requirement is a first-class task, not an afterthought)** · §7 remainder explicitly out ✓.
- **Safety rails:** past dates immutable both directions; inbound applies only unambiguous future moves onto rest days (everything else = warning); mirror is best-effort with the local change always persisted and failures surfaced; frozen ledger untouched; attended live verification with a backup-first abort path, kept clear of the 07-12 turnover.
- **Known limits (documented in code):** an inbound-accepted move leaves the event's uid on its old date (eventId is the true key everywhere — cleanup unaffected); calendar swaps made on Intervals.icu surface as two conflict warnings rather than auto-pairing; ponytail comments name both upgrade paths.
- **Type consistency:** `PlannedMove { from, to: string | null }`, `applyCalendarMirror(block, moves, today)`, `reconcileInboundMoves(block, events, today)`, `IntervalsCalendarEvent` used with identical shapes across Tasks 2–5.
