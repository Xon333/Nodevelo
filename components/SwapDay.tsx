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
