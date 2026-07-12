// §7 lean slice — the bidirectional calendar mirror's DECISIONS (pure) plus one IO orchestrator.
// The invariant both directions preserve: one NodeVelo-owned event per block date, keyed by external_id
// `nodevelo-<date>` (createEvent upserts on it via /events/bulk?upsert=true) and tracked by
// CurrentBlockDay.eventId.
// Descriptions live ONLY on the calendar (CurrentBlockDay has no description field), so an outbound
// move carries the source event's description wholesale instead of rebuilding-and-losing it.

import { createEvent, fetchEvents, isIntervalsConfigured } from "./intervals-api";
import { mergeCurrentBlockDays } from "./data-store";
import { eventPayloadShape } from "./plan-parser";
import type { CurrentBlock, CurrentBlockDay, IntervalsCalendarEvent, IntervalsEventPayload } from "./types";

export type PlannedMove = { from: string; to: string | null };

// CurrentBlockDay → event payload, via the shared shape planDayToEvent also builds on
// (plan-parser.ts) — takes the description explicitly, because a block day carries none of its own.
export function dayToEventPayload(day: CurrentBlockDay, description: string): IntervalsEventPayload {
  // Passed verbatim — the caller always supplies the full intended description (the source event's
  // description carried wholesale on a move, or an already-composed description on first write).
  // CurrentBlockDay.workoutText is not re-appended here: appending it would duplicate the step text
  // already embedded in a carried-over event description.
  return eventPayloadShape({
    date: day.date,
    isRest: day.type === "Rest" || day.durationMin <= 0,
    name: day.name,
    type: day.type,
    durationMin: day.durationMin,
    description,
  });
}

// The upserts a set of moves requires. Content flows from→to: each destination's payload is built
// from the day now living there, carrying the OLD source event's description; a vacated source
// re-upserts as its new self (rest note / swapped-in easy day) — but only when it's today-or-future
// (a past date keeps its history marker untouched). A swap is two moves; each date emits exactly once.
// Description lookup is id-based (Fix A, final review): the source's fetched calendar event is found
// via its numeric eventId (sourceEventIdByDate → eventById), not by parsing a date out of externalId —
// that missed for every event that predates the external_id-on-write fix (Bug 1: a silently empty
// destination workout). A miss (no pre-move eventId tracked, or no matching fetched event) falls back
// to the destination day's own workoutText rather than an empty description.
export function buildMovePayloads(
  days: CurrentBlockDay[],
  moves: PlannedMove[],
  eventById: Map<number, IntervalsCalendarEvent>,
  sourceEventIdByDate: Map<string, number>,
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
      if (date < today) continue; // a destination in the past is immutable, same as a vacated source
      // Destination: carry the moved workout's original description (intent + nutrition text), found
      // via the source's PRE-move eventId. `||` (not `??`) so an empty-string carried description also
      // falls through to workoutText, instead of writing a genuinely blank workout.
      const sourceEventId = sourceEventIdByDate.get(sourceOfContent);
      const oldEvent = typeof sourceEventId === "number" ? eventById.get(sourceEventId) : undefined;
      const description = oldEvent?.description || d.workoutText?.trim() || "";
      out.push({ date, payload: dayToEventPayload(d, description) });
    } else if (date >= today) {
      // Vacated source, still in the future → its event becomes what the day now is. Preserve any real
      // workout text (e.g. a downgraded-but-not-Rest day) alongside the boilerplate rather than losing it.
      const description = [d.workoutText?.trim() ?? "", "Rescheduled by NodeVelo — see the moved session."]
        .filter(Boolean)
        .join("\n\n");
      out.push({ date, payload: dayToEventPayload(d, description) });
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
// An accepted inbound move leaves the event's external_id stamped with its OLD date — this function
// does not re-key it (that's IO, and this one stays pure); /api/sync's caller does it best-effort
// (create+delete) right after calling this (Fix B, final review) so a later outbound move's id-keyed
// lookup (buildMovePayloads) doesn't miss it and spawn a duplicate. eventId (which we re-key here) is
// the true key everywhere in the meantime (blockEventIds/staleEventIds/this reconcile), so cleanup and
// matching stay correct even before the re-stamp lands.
export function reconcileInboundMoves(
  block: CurrentBlock,
  events: IntervalsCalendarEvent[],
  today: string
): { days: CurrentBlockDay[]; applied: Array<{ from: string; to: string }>; warnings: string[] } | null {
  const byId = new Map(events.filter((e) => e.id !== null).map((e) => [e.id as number, e]));
  const byExternalId = new Map(events.filter((e) => e.externalId !== null).map((e) => [e.externalId as string, e]));
  const dayAt = new Map(block.days.map((d) => [d.date, d]));

  const applied: Array<{ from: string; to: string }> = [];
  const warnings: string[] = [];
  let days = [...block.days];

  for (const d of block.days) {
    if (d.date < today || d.durationMin <= 0 || d.type === "Rest") continue;
    const evt = (typeof d.eventId === "number" ? byId.get(d.eventId) : undefined) ?? byExternalId.get(`nodevelo-${d.date}`);
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
    // Apply: the workout's content relocates; the old date becomes a rest day. eventId is always
    // re-stamped from the just-matched `evt.id`, not carried forward from `d.eventId` — when this
    // match came from the byExternalId fallback (not byId), `d.eventId` is stale/wrong and carrying
    // it forward would silently break the id-keyed lookups downstream (description-carry, restamp).
    const { date: _old, eventId: _staleId, ...content } = d;
    const movedDay: CurrentBlockDay = { date: evt.date, ...content, ...(typeof evt.id === "number" ? { eventId: evt.id } : {}) };
    const vacatedDay: CurrentBlockDay = { date: d.date, name: `Rest (moved to ${evt.date})`, type: "Rest", durationMin: 0 };
    days = days.map((x) => (x.date === evt.date ? movedDay : x.date === d.date ? vacatedDay : x));
    // Keep dayAt in step with `days` — otherwise a second move within this same pass re-reads the
    // stale pre-loop snapshot and can pass the "target is Rest" check onto an already-just-filled date.
    dayAt.set(evt.date, movedDay);
    dayAt.set(d.date, vacatedDay);
    applied.push({ from: d.date, to: evt.date });
  }

  return applied.length === 0 && warnings.length === 0 ? null : { days, applied, warnings };
}

// The one IO step (Task 3+ wire it): read the block window's events (description source), upsert the
// affected dates, re-stamp eventIds on the updated days. Best-effort per date — a failure never
// unwinds the local move; callers surface `failed` as a warning.
// `preMoveDays` (Fix A, final review): the block's PRE-move days, threaded in separately from
// `block.days` (post-move) because the source's eventId isn't reliably found there — different callers
// leave it in different places post-move (a reschedule-POST leaves it at `from`; a reschedule-PUT moves
// it to `to`; morning-check's swap `carry()` drops it from both days entirely). Building
// sourceEventIdByDate off the pre-move snapshot instead sidesteps that entirely.
export async function applyCalendarMirror(
  block: CurrentBlock,
  moves: PlannedMove[],
  today: string,
  preMoveDays: CurrentBlockDay[]
): Promise<{ updatedBlock: CurrentBlock; mirrored: string[]; failed: string[] }> {
  let eventById = new Map<number, IntervalsCalendarEvent>();
  const sourceEventIdByDate = new Map<string, number>(
    preMoveDays.filter((d): d is CurrentBlockDay & { eventId: number } => typeof d.eventId === "number").map((d) => [d.date, d.eventId])
  );
  try {
    const events = await fetchEvents(block.startDate, block.endDate);
    eventById = new Map(events.filter((e) => e.id !== null).map((e) => [e.id as number, e]));
  } catch {
    // No description source — destination payloads fall back to workoutText/empty rather than failing the mirror.
  }
  const payloads = buildMovePayloads(block.days, moves, eventById, sourceEventIdByDate, today);
  const mirrored: string[] = [];
  const failed: string[] = [];
  let days = block.days;
  for (const { date, payload } of payloads) {
    try {
      const id = await createEvent(payload); // upserts on external_id
      mirrored.push(date);
      if (id !== null) days = days.map((d) => (d.date === date ? { ...d, eventId: id } : d));
    } catch {
      failed.push(date);
    }
  }
  return { updatedBlock: days === block.days ? block : { ...block, days }, mirrored, failed };
}

// Shared: persist the local change, then best-effort mirror it to the Intervals.icu calendar. The local
// move ALWAYS stands; a mirror failure is surfaced, never a rollback (the athlete can re-sync later).
// Used by both /api/reschedule (manual/make-up moves) and /api/morning-check (proactive swap/downgrade)
// so the gating (isIntervalsConfigured) + try/catch-and-report shape lives in exactly one place.
// `preMoveDays` (Fix A, final review) defaults to `block.days`, which covers /api/reschedule's POST and
// PUT — `block` there genuinely IS the pre-move state. /api/morning-check's PUT is the one caller that
// must override it explicitly (its `updated.days` loses the swap sources' eventIds — see
// applyCalendarMirror's comment).
export async function persistMirroredMove(
  block: CurrentBlock,
  days: CurrentBlockDay[],
  moves: PlannedMove[],
  today: string,
  preMoveDays: CurrentBlockDay[] = block.days
): Promise<{ updatedBlock: CurrentBlock; mirrored: string[]; failed: string[] }> {
  let updated: CurrentBlock = { ...block, days };
  let mirrored: string[] = [];
  let failed: string[] = [];
  if (isIntervalsConfigured()) {
    try {
      const res = await applyCalendarMirror(updated, moves, today, preMoveDays);
      updated = res.updatedBlock;
      mirrored = res.mirrored;
      failed = res.failed;
    } catch {
      failed = moves.flatMap((m) => (m.to ? [m.from, m.to] : [m.from]));
    }
  }
  // Merge onto a fresh lock-held read (HR-4): `block` may already be stale here — a network round-trip
  // to Intervals.icu just happened above — so only write the dates THIS move actually touches, instead
  // of blindly overwriting the whole array and losing a concurrent writer's change to some other day.
  const touchedDates = new Set(moves.flatMap((m) => (m.to ? [m.from, m.to] : [m.from])));
  const persisted = await mergeCurrentBlockDays(updated, updated.days.filter((d) => touchedDates.has(d.date)));
  updated = persisted ?? updated;
  return { updatedBlock: updated, mirrored, failed };
}
