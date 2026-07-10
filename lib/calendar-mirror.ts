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
    // Passed verbatim — the caller always supplies the full intended description (the source event's
    // description carried wholesale on a move, or an already-composed description on first write).
    // CurrentBlockDay.workoutText is not re-appended here: appending it would duplicate the step text
    // already embedded in a carried-over event description.
    description,
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
  moves: PlannedMove[],
  today: string
): Promise<{ updatedBlock: CurrentBlock; mirrored: string[]; failed: string[] }> {
  let eventByDate = new Map<string, IntervalsCalendarEvent>();
  try {
    const events = await fetchEvents(block.startDate, block.endDate);
    eventByDate = new Map(events.filter((e) => e.uid?.startsWith("nodevelo-")).map((e) => [e.uid!.slice("nodevelo-".length), e]));
  } catch {
    // No description source — destination payloads fall back to an empty description rather than failing the mirror.
  }
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
  return { updatedBlock: days === block.days ? block : { ...block, days }, mirrored, failed };
}
