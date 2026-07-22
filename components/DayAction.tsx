"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { localToday, addDaysIso } from "@/lib/date";
import { SYNC_QUERY_KEY } from "./SyncProvider";

const COPY = {
  move: { method: "PUT" as const, openLabel: "Move…", actionLabel: "Move", ariaVerb: "Move", ariaPrep: "to", verbed: "Moved" },
  swap: { method: "PATCH" as const, openLabel: "Swap with…", actionLabel: "Swap", ariaVerb: "Swap", ariaPrep: "with", verbed: "Swapped" },
};

// §7 manual move / §7 follow-on swap: shift a future planned session onto a rest day (move, PUT), or
// exchange it directly with another occupied session (swap, PATCH — neither day becomes Rest). Server
// validates (rest-day target / both-occupied, future-only, in-block); this control just collects the
// target date. Mirrored to Intervals.icu by the route. `to` must be strictly after today (the route
// rejects `to <= today`), so the input's min is tomorrow — computed here rather than making every call
// site redo the same arithmetic.
export default function DayAction({
  verb,
  date,
  maxDate,
  blockCreatedAt,
  onMoved,
}: {
  verb: "move" | "swap";
  date: string;
  maxDate: string;
  // UXA-24: this tab's understanding of which block is active, so a stale tab can't silently
  // move/swap days on a block another tab already replaced.
  blockCreatedAt: string;
  onMoved?: () => void;
}) {
  const c = COPY[verb];
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const minDate = addDaysIso(localToday(), 1);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ ok: boolean; mirrorFailed: string[] }>("/api/reschedule", {
        method: c.method,
        body: JSON.stringify({ from: date, to, today: localToday(), expectedBlockCreatedAt: blockCreatedAt }),
      });
      setNote(
        res.mirrorFailed.length === 0
          ? `${c.verbed} — Intervals.icu calendar updated.`
          : `${c.verbed} in the app; Intervals.icu update failed (will drift until re-synced).`
      );
      setOpen(false);
      // doSync()'s POST response has no `currentBlock` field, so it wouldn't refresh the calendar's
      // day layout. GET /api/sync (the query this cache key backs) DOES return `currentBlock` — so
      // invalidate and let the next read re-fetch fresh state instead.
      await queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY });
      onMoved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${c.actionLabel} failed`);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <button onClick={() => setOpen(true)} className="text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400">
          {c.openLabel}
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
        aria-label={`${c.ariaVerb} ${date} ${c.ariaPrep}`}
      />
      <button disabled={busy || !to} onClick={run} className="rounded border border-[#ff49c8]/60 px-2 py-0.5 text-[#ff49c8] disabled:opacity-50">
        {c.actionLabel}
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
