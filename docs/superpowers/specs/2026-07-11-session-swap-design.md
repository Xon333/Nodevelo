# Two-way session swap (§7 follow-on) — Design

**Date:** 2026-07-11
**Status:** Shipped 2026-07-11 → [ARCHIVE.md](../../../ARCHIVE.md) "Two-way session swap — §7 follow-on"
**ROADMAP:** `§7 · Calendar flexibility — remaining scope`. The reschedule/calendar-mirror lean slice
(shipped 2026-07-10) deliberately built move-onto-a-clear-rest-day only. This closes the adjacent gap:
trading two already-occupied sessions directly, with no rest day involved.

---

## 1. Problem & context

The shipped Manual Move (`PUT /api/reschedule`, `components/MoveDay.tsx`) lets the athlete shift a
future session onto a clear rest day. It cannot swap two occupied sessions — `toDay.durationMin > 0 &&
toDay.type !== "Rest"` is an explicit 400 rejection (`app/api/reschedule/route.ts:83`). This surfaced
directly: the athlete's current block ends its 4-week taper with three consecutive ride days (no rest
day left), so "swap today's ride with tomorrow's" — a natural, common request — has no path today.

The underlying mirror machinery already supports a two-day trade: `PlannedMove = { from, to }` pairs,
and `buildMovePayloads`/`applyCalendarMirror`/`persistMirroredMove` already handle a swap as two moves
(`[{from: A, to: B}, {from: B, to: A}]`) — this is exactly what the morning-check proactive
swap already does (`app/api/morning-check/route.ts`), and it's covered by existing tests
(`lib/calendar-mirror.test.ts`, "a swap (two moves) carries each description to the other date"). This
feature is mostly wiring a new entry point onto already-proven machinery, not new architecture.

## 2. Locked decisions (user, 2026-07-11 — do not re-open)

1. **General-purpose swap**: any two future, non-rest, in-block sessions — not restricted to adjacent
   days. The mirror machinery already handles arbitrary date pairs; restricting to "adjacent only"
   would add UI constraint for no implementation savings.
2. **UI**: a new `components/SwapDay.tsx`, mounted alongside the existing `MoveDay` inside the same
   pinned day-cell popover (`components/dashboard/plan.tsx`'s `BlockCalendar`) — not a mode toggle
   bolted onto `MoveDay` itself. Two small single-responsibility components, matching the codebase's
   existing file-boundary convention.
3. **API**: `PATCH /api/reschedule` (new handler in the existing route file), body `{ from, to, today }`
   — same shape as the existing PUT, sharing `parseBody`/`persistMirroredMove`. PATCH's REST semantics
   ("trade these two") read cleanly against PUT's ("move onto a slot").
4. **Outbound only.** Calendar-side swap detection (the athlete drags two events to trade places
   directly on Intervals.icu) stays deferred, exactly as already documented in
   `lib/calendar-mirror.ts`'s `reconcileInboundMoves` comment ("add swap pairing if real use hits the
   warning often") and `ROADMAP.md` §3. A calendar-side swap continues to surface as two separate
   "occupied, resolve manually" warnings — unchanged by this work.

## 3. Goals / non-goals

**Goals**
- Athlete can trade any two future, occupied sessions in-app; both sides' full content (name, type,
  duration, workout text/prescription) moves to the other's date.
- Both sides mirror correctly to the real Intervals.icu calendar, using the already-fixed id-based
  description-carry (this session's final-review fix) — no new mirror logic needed.
- Local move always persists even if the calendar mirror call fails (same best-effort contract as
  Move/reactive-reschedule).

**Non-goals**
- Calendar-side (inbound) swap auto-pairing — explicitly deferred (decision #4 above).
- An "eligible days" picker UI (dropdown of valid swap partners) — v1 uses the same plain native date
  input `MoveDay` already uses; the server validates, errors surface inline. Revisit only if real usage
  shows the plain date input is confusing.
- Any change to the existing PUT (move-onto-rest) or POST (reactive make-up) semantics.

## 4. API contract

### `PATCH /api/reschedule`

**Body:** `{ from: string; to: string; today: string }` (identical shape to PUT/POST; reuses the
existing `parseBody` helper unchanged).

**Validation** (in order, matching the existing PUT handler's style):
1. `from`/`to` both present and both dates found in the current block → else 400 `"from/to not in the
   current block."`
2. `from !== to` → else 400 `"from and to must be different days."`
3. `from >= today` and `to >= today` (past immutable, both sides) → else 400 `"Can't swap a past
   session."` / `"Can't swap onto a past day."`
4. **Both** `fromDay` and `toDay` have real content (`durationMin > 0 && type !== "Rest"`) → else 400,
   pointing at the right tool: `"<day> has no session — use Move instead."` (This is what makes PATCH
   a swap and not a second Move: neither side is allowed to be empty.)

**Effect:** the two days' full content trades places symmetrically (name, type, durationMin,
workoutText?, prescription?). Neither day becomes Rest. `eventId` is carried from each day to its
*new* date (A's original `eventId` travels with A's content to B's date, and vice versa) — mirroring
the existing PUT handler's precedent (`app/api/reschedule/route.ts:87`) of always stamping the
source's `eventId` onto the destination in the local write, independent of whether the calendar mirror
actually runs this call. If the mirror IS configured and succeeds, `persistMirroredMove` overwrites
each destination's `eventId` with the freshly-created event's real id anyway (same as every other
mirror-backed write) — the carry-forward here only matters as the value that survives when
`isIntervalsConfigured()` is false. Sparse-omit throughout: absent optional fields are never persisted
as `null`.

**Mirror:** `persistMirroredMove(block, days, [{ from, to }, { from: to, to: from }], today)` — the
existing pair-of-moves pattern. `block.days` is genuinely pre-swap at this call site (same as the
existing PUT/POST handlers), so `persistMirroredMove`'s `preMoveDays` default (`= block.days`) is
correct with no extra threading.

**Response:** `{ ok: true, mirrored: string[], mirrorFailed: string[] }` — identical shape to PUT/POST.

## 5. UI contract

### `components/SwapDay.tsx` (new)

Same interaction shape as the existing `MoveDay.tsx`: collapsed "Swap with…" text button → expands to
a native `<input type="date">` (bounded `min`/`max` to future-in-block, same computation `MoveDay`
already uses) + "Swap"/"Cancel" buttons → on confirm, `PATCH /api/reschedule` with
`{ from: date, to, today: localToday() }` → same `mirrorFailed`-based status copy pattern as `MoveDay`
→ same `queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY })` refresh (not `doSync()` — verified
this session that `doSync()` doesn't refresh `currentBlock`) → same `onMoved`-style callback to close
the pin.

### Mount point

`components/dashboard/plan.tsx`'s `BlockCalendar`: inside the pinned popover, alongside the existing
`{eligible && pinned && <MoveDay .../>}` block, add `<SwapDay date={day.date} maxDate={blockEndDate}
onMoved={() => setPinnedDate(null)} />` under the same `eligible && pinned` gate — no new state, no new
ARIA considerations (reuses the `role="dialog"`/`aria-label` popover this session's Task 6 already
built and hardened through two accessibility review rounds).

## 6. Testing plan

- **Route tests** (`app/api/reschedule/route.test.ts`, extend): successful swap (both days' content
  trades, mirror called with the two-move pair, response shape); each of the 4 validation rejections
  above; mirror-failure-still-persists-locally (same pattern as the existing PUT/POST tests, mocking
  `@/lib/calendar-mirror`).
- **No changes needed** to `lib/calendar-mirror.ts` or its tests — the swap-pair mirror path is already
  covered (`lib/calendar-mirror.test.ts`, "a swap (two moves) carries each description to the other
  date", plus this session's id-based-lookup regression tests).
- **Live verification recommended, not mandatory**: unlike the original §7 plan (which touched a
  brand-new endpoint and an unproven upsert primitive), PATCH reuses an already-fixed, already-tested
  mirror path end-to-end. A live smoke test of the PATCH endpoint specifically (the athlete has two
  real occupied days available right now — today/tomorrow) is good practice but not the same
  high-stakes gate the original plan's Task 7 was.

## 7. File structure

| File | Change |
|---|---|
| `app/api/reschedule/route.ts` | Add `PATCH` handler |
| `app/api/reschedule/route.test.ts` | Add PATCH test cases |
| `components/SwapDay.tsx` | New |
| `components/dashboard/plan.tsx` | Mount `SwapDay` alongside `MoveDay` in the pinned popover |
| `FEATURES.md`, `ROADMAP.md`, `ARCHIVE.md` | Docs, once shipped |
