# Two-Way Session Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the athlete swap two future, already-occupied planned sessions directly (e.g. today's ride with tomorrow's), with the swap mirrored to the real Intervals.icu calendar — closing the gap the existing Manual Move (move onto a *clear rest day* only) can't reach.

**Architecture:** A new `PATCH /api/reschedule` handler, in the same route file as the existing GET/POST/PUT, validates that both days are in-block, future, distinct, and both carry a real session (no rest/empty side — that's what Move is for). It swaps the two days' content symmetrically and calls the already-shipped `persistMirroredMove` with the swap-pair form (`[{from, to}, {from: to, to: from}]`) that the morning-check proactive swap already exercises — no changes needed to `lib/calendar-mirror.ts`. A new `components/SwapDay.tsx`, near-identical in shape to the existing `MoveDay.tsx`, mounts alongside it in the same pinned day-cell popover in `components/dashboard/plan.tsx`.

**Tech Stack:** Next.js 16 route handlers, React 19, TypeScript 5, Vitest. No new dependencies.

## Global Constraints

- Run everything with `npm`. Full verify: `npx tsc --noEmit && npm run lint && npm run build && npm test` (or `npm run check`).
- "Today" is the client's resolved local date (`resolveToday` server-side, client sends `localToday()`) — reuse the existing `parseBody` helper in `app/api/reschedule/route.ts`, don't reimplement.
- Sparse-field convention: optional fields omitted when absent, never persisted `null`.
- **Past is immutable:** neither `from` nor `to` may be `< today`.
- **Both sides must have a real session:** `durationMin > 0 && type !== "Rest"` for both `from` and `to` — a swap where either side is empty is a scope error (point the athlete at Move instead), not a valid swap.
- **Best-effort mirror, honest failure:** the local swap always persists; a failed calendar call surfaces as a warning in the response, never rolls back the local change and never throws the route. (Already implemented in `persistMirroredMove` — this plan only calls it correctly.)
- **Outbound only:** no changes to `lib/calendar-mirror.ts`'s inbound reconcile — a calendar-side swap (dragging two events on Intervals.icu itself) stays out of scope, unchanged.
- Concurrent-agent repo: commit on `main`, stage only files you touched (never `git add -A`).

## File Structure

| File | Responsibility |
|---|---|
| Modify `app/api/reschedule/route.ts` (+ test) | New `PATCH` handler — swap two occupied sessions |
| Create `components/SwapDay.tsx` | Swap-with-another-day control, mirrors `MoveDay.tsx`'s shape |
| Modify `components/dashboard/plan.tsx` | Mount `SwapDay` alongside `MoveDay` in the pinned popover |
| Modify `FEATURES.md`, `ROADMAP.md`, `ARCHIVE.md` | Docs |

---

### Task 1: `PATCH /api/reschedule` — swap two occupied sessions

**Files:**
- Modify: `app/api/reschedule/route.ts`
- Test: `app/api/reschedule/route.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `persistMirroredMove(block, days, moves, today)` (already exists in `lib/calendar-mirror.ts`, unchanged), `parseBody` (already exists in this route file, unchanged).
- Produces: `PATCH { from, to, today }` → `{ ok: true, mirrored: string[], mirrorFailed: string[] }` on success; `400 { error: string }` on any validation failure.

- [ ] **Step 1: Write the failing tests**

Add to `app/api/reschedule/route.test.ts` (the file already imports `POST, PUT` from the route and mocks `@/lib/data-store` + `@/lib/calendar-mirror` — extend both the import and the test bodies below; the `block()`, `postReq`/`putReq` helpers, `TODAY`, and the `beforeEach` mock setup already exist and don't need to change):

```ts
// Change the existing import line from:
//   import { POST, PUT } from "@/app/api/reschedule/route";
// to:
import { PATCH, POST, PUT } from "@/app/api/reschedule/route";

// Add alongside the existing postReq/putReq helpers:
const patchReq = (body: unknown) => new Request("http://t/api/reschedule", { method: "PATCH", body: JSON.stringify(body) });

describe("PATCH /api/reschedule — swap two occupied sessions", () => {
  it("trades both days' full content symmetrically and calls the mirror with the swap pair", async () => {
    const res = await PATCH(patchReq({ from: "2026-06-18", to: "2026-06-23", today: TODAY }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);

    const [calledBlock, calledDays, calledMoves, calledToday] = vi.mocked(mirror.persistMirroredMove).mock.calls[0];
    expect(calledMoves).toEqual([
      { from: "2026-06-18", to: "2026-06-23" },
      { from: "2026-06-23", to: "2026-06-18" },
    ]);
    expect(calledToday).toBe(TODAY);
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
      return { updatedBlock, mirrored: [], failed: moves.flatMap((m) => (m.to ? [m.from, m.to] : [m.from])) };
    });

    const res = await PATCH(patchReq({ from: "2026-06-18", to: "2026-06-23", today: TODAY }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.mirrorFailed).toEqual(expect.arrayContaining(["2026-06-18", "2026-06-23"]));

    const written = vi.mocked(store.writeCurrentBlock).mock.calls[0][0] as CurrentBlock;
    expect(written.days.find((d) => d.date === "2026-06-23")).toMatchObject({ name: "VO2 6x3" });
    expect(written.days.find((d) => d.date === "2026-06-18")).toMatchObject({ name: "VO2 5x4" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/api/reschedule/route.test.ts`
Expected: FAIL — `PATCH` is not exported from the route.

- [ ] **Step 3: Implement**

Append to `app/api/reschedule/route.ts` (after the existing `PUT` handler, end of file):

```ts

// PATCH { from, to, today } → SWAP two occupied sessions (§7 follow-on): both days trade their full
// content, symmetrically. Unlike PUT (move onto a clear rest day), neither side becomes Rest — this
// is "swap Tuesday's Threshold with Saturday's long ride," not "move X onto empty space." Each day's
// content carries its OWN eventId to its new date (mirrors PUT's precedent of always stamping the
// source's eventId onto the destination in the local write) — if the calendar mirror is configured
// and succeeds, persistMirroredMove overwrites both with the freshly-created events' real ids anyway;
// this only matters as the value that survives when isIntervalsConfigured() is false.
export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const p = parseBody(body);
  if (!p) return NextResponse.json({ error: "from and to dates are required." }, { status: 400 });

  const block = await readCurrentBlock();
  if (!block) return NextResponse.json({ error: "No active block." }, { status: 400 });
  const fromDay = block.days.find((d) => d.date === p.from);
  const toDay = block.days.find((d) => d.date === p.to);
  if (!fromDay || !toDay) return NextResponse.json({ error: "from/to not in the current block." }, { status: 400 });
  if (p.from === p.to) return NextResponse.json({ error: "from and to must be different days." }, { status: 400 });
  if (p.from < p.today) return NextResponse.json({ error: "Can't swap a past session." }, { status: 400 });
  if (p.to < p.today) return NextResponse.json({ error: "Can't swap onto a past day." }, { status: 400 });
  if (fromDay.durationMin <= 0 || fromDay.type === "Rest") {
    return NextResponse.json({ error: `${p.from} has no session — use Move instead.` }, { status: 400 });
  }
  if (toDay.durationMin <= 0 || toDay.type === "Rest") {
    return NextResponse.json({ error: `${p.to} has no session — use Move instead.` }, { status: 400 });
  }

  const { date: _fd, eventId: _fe, ...fromContent } = fromDay;
  const { date: _td, eventId: _te, ...toContent } = toDay;
  const days = block.days.map((d) => {
    if (d.date === p.to) return { date: p.to, ...fromContent, ...(typeof fromDay.eventId === "number" ? { eventId: fromDay.eventId } : {}) };
    if (d.date === p.from) return { date: p.from, ...toContent, ...(typeof toDay.eventId === "number" ? { eventId: toDay.eventId } : {}) };
    return d;
  });
  const { mirrored, failed: mirrorFailed } = await persistMirroredMove(
    block,
    days,
    [{ from: p.from, to: p.to }, { from: p.to, to: p.from }],
    p.today
  );
  return NextResponse.json({ ok: true, mirrored, mirrorFailed });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run app/api/reschedule/route.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/reschedule/route.ts app/api/reschedule/route.test.ts
git commit -m "feat(reschedule): PATCH swaps two occupied sessions (§7 follow-on)"
```

---

### Task 2: `SwapDay.tsx` — the UI control

**Files:**
- Create: `components/SwapDay.tsx`
- Modify: `components/dashboard/plan.tsx`

**Interfaces:**
- Consumes: `PATCH /api/reschedule` (Task 1), `SYNC_QUERY_KEY` (already exported from `components/SyncProvider.tsx`), `localToday`/`addDaysIso` (already exported from `lib/date.ts`).
- Produces: `SwapDay({ date, maxDate, onMoved? }): JSX.Element` — same prop shape as the existing `MoveDay`.

- [ ] **Step 1: Implement the component**

Create `components/SwapDay.tsx` (mirrors `components/MoveDay.tsx`'s shape exactly — same state machine, same styling, different endpoint/verb and copy):

```tsx
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { localToday, addDaysIso } from "@/lib/date";
import { SYNC_QUERY_KEY } from "./SyncProvider";

// §7 follow-on: swap two occupied sessions directly (both keep real content — neither becomes Rest).
// Server validates (both days must have a real session, future-only, in-block); this control just
// collects the target date. Mirrored to Intervals.icu by the route via the existing swap-pair path.
export default function SwapDay({
  date,
  maxDate,
  onMoved,
}: {
  date: string;
  maxDate: string;
  onMoved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const minDate = addDaysIso(localToday(), 1);

  const swap = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ ok: boolean; mirrorFailed: string[] }>("/api/reschedule", {
        method: "PATCH",
        body: JSON.stringify({ from: date, to, today: localToday() }),
      });
      setNote(
        res.mirrorFailed.length === 0
          ? "Swapped — Intervals.icu calendar updated."
          : "Swapped in the app; Intervals.icu update failed (will drift until re-synced)."
      );
      setOpen(false);
      // Same reasoning as MoveDay: doSync()'s response has no currentBlock, so invalidate the sync
      // query instead of relying on it to refresh the calendar's day layout.
      await queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY });
      onMoved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Swap failed");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <button onClick={() => setOpen(true)} className="text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400">
          Swap with…
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
        aria-label={`Swap ${date} with`}
      />
      <button disabled={busy || !to} onClick={swap} className="rounded border border-[#ff49c8]/60 px-2 py-0.5 text-[#ff49c8] disabled:opacity-50">
        Swap
      </button>
      <button disabled={busy} onClick={() => setOpen(false)} className="text-zinc-500 dark:text-zinc-400">
        Cancel
      </button>
      {error && (
        <span role="alert" className="text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Mount it in `components/dashboard/plan.tsx`**

Add the import alongside the existing `MoveDay` import (near the top of the file, currently `import MoveDay from "../MoveDay";`):

```tsx
import SwapDay from "../SwapDay";
```

In the pinned popover's `MoveDay` mount (find `{eligible && pinned && (` — it wraps a `<div className="mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-700">` containing a single `<MoveDay .../>`), change it to mount both controls stacked:

```tsx
                        {eligible && pinned && (
                          <div className="mt-2 space-y-1 border-t border-zinc-100 pt-2 dark:border-zinc-700">
                            <MoveDay date={day.date} maxDate={blockEndDate} onMoved={() => setPinnedDate(null)} />
                            <SwapDay date={day.date} maxDate={blockEndDate} onMoved={() => setPinnedDate(null)} />
                          </div>
                        )}
```

(The only change from what's there today: the wrapping `<div>` gains `space-y-1` for spacing between the two stacked controls, and a `<SwapDay .../>` line is added after the existing `<MoveDay .../>` line — same `date`/`maxDate`/`onMoved` props, since both controls act on the same day cell.)

- [ ] **Step 3: Verify**

Run: `npm run check && npm run build` — Expected: clean.

Preview (preview port): open `/plan`, click a future non-rest day cell → popover pins, shows both "Move…" and "Swap with…" affordances stacked; clicking "Swap with…" expands to a native date input + Swap/Cancel buttons, dark mode correct; a past/rest day cell shows neither control when pinned. Don't execute a real swap against the live calendar here unless you have two real occupied days you're happy to test against and are prepared to swap back — that's a live-verification step, not required to consider this task done (per the spec, this reuses an already-tested mirror path, so it's good practice rather than a hard gate).

- [ ] **Step 4: Commit**

```bash
git add components/SwapDay.tsx components/dashboard/plan.tsx
git commit -m "feat(plan): swap-with-another-day control alongside Move (§7 follow-on)"
```

---

### Task 3: Docs

**Files:**
- Modify: `FEATURES.md`, `ROADMAP.md`, `ARCHIVE.md`

- [ ] **Step 1: `FEATURES.md`** — "Adaptive scheduling" section, new bullet directly after the existing "Manual move (§7)" bullet:

```md
- **Session swap (§7 follow-on)** — trade any two future, already-occupied sessions directly (e.g.
  today's ride with tomorrow's) — the gap Manual Move can't reach (it only moves onto a clear rest
  day). Reuses the existing swap-pair calendar mirror. `PATCH /api/reschedule`, `components/SwapDay.tsx`
```

- [ ] **Step 2: `ROADMAP.md`** — the current `§7` bullet (verify it still reads this way before editing — it may have drifted if other work landed first):

```md
- **§7 · Calendar flexibility — remaining scope** — the in-app rescheduling + bidirectional
  Intervals.icu calendar mirror lean slice shipped 2026-07-10 → [ARCHIVE.md](ARCHIVE.md). Left,
  deliberately out of that plan: **condition-driven auto-swaps** (react to a fatigue/load condition
  directly, not just a missed session or a manual move) and **content-edit inbound sync** (an
  athlete editing a workout's content — not just its date — on Intervals.icu, flowing back into
  the block).
```

Replace it with (this plan ships *outbound athlete-initiated* swapping only — narrow the bullet to
note that's done, keep the automatic/inbound halves open exactly as before):

```md
- **§7 · Calendar flexibility — remaining scope** — the in-app rescheduling + bidirectional
  Intervals.icu calendar mirror lean slice shipped 2026-07-10, plus the two-way session swap shipped
  2026-07-11 → [ARCHIVE.md](ARCHIVE.md). Left, deliberately out of scope: **condition-driven
  auto-swaps** (react to a fatigue/load condition directly and automatically, not an athlete-initiated
  swap) and **content-edit inbound sync** (an athlete editing a workout's content — not just its
  date — on Intervals.icu, flowing back into the block). Calendar-side (inbound) swap-pairing also
  stays open — a swap made directly on Intervals.icu still surfaces as two separate conflict
  warnings, not auto-applied.
```

- [ ] **Step 3: `ARCHIVE.md`** — new entry at the top (after the existing calendar-mirror entries), following the file's established entry format (header + description + what shipped):

```md
## Two-way session swap — §7 follow-on (2026-07-11)

Closes the gap the original §7 lean slice deliberately left open: Manual Move only moves a session
onto a *clear rest day*; this adds a genuine swap between two already-occupied future sessions (e.g.
today's ride with tomorrow's), reusing the swap-pair calendar-mirror path the morning-check proactive
swap already exercised and this session's final-review fixes already hardened (id-based
description-carry). `PATCH /api/reschedule` validates both days are in-block, future, distinct, and
both carry a real session; `components/SwapDay.tsx` mounts alongside the existing `MoveDay` in the
same pinned day-cell popover. Outbound only — calendar-side (inbound) swap-pairing stays deferred, per
`lib/calendar-mirror.ts`'s existing `reconcileInboundMoves` comment. Design:
`docs/superpowers/specs/2026-07-11-session-swap-design.md`. Plan:
`docs/superpowers/plans/2026-07-11-session-swap.md`.
```

- [ ] **Step 4: Commit**

```bash
git add FEATURES.md ROADMAP.md ARCHIVE.md
git commit -m "docs: two-way session swap shipped (§7 follow-on)"
```

---

## Self-review notes (already applied)

- **Spec coverage:** general-purpose swap (any two future occupied days) ✓ · UI mounted alongside `MoveDay` in the same popover, not a mode toggle ✓ · `PATCH` verb on the existing route, sharing `parseBody`/`persistMirroredMove` ✓ · outbound-only, no `lib/calendar-mirror.ts` changes ✓ · eventId carry-forward matches PUT's existing precedent (spec §4, closed during the spec's own self-review) ✓.
- **Type consistency:** `PATCH`'s response shape (`{ ok: true, mirrored, mirrorFailed }`) matches POST/PUT exactly. `SwapDay`'s prop shape (`{ date, maxDate, onMoved? }`) matches `MoveDay`'s exactly — both accept identical props from the same call site in `plan.tsx`.
- **No placeholder scan:** all steps show complete code, no "similar to Task N" cross-references — Task 2's component is written out in full even though it closely mirrors `MoveDay.tsx`.
