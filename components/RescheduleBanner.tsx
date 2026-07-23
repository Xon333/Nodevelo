"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { SYNC_QUERY_KEY, useSync } from "./SyncProvider";
import { LoadFailed, useMountLoad } from "./ui";

interface Suggestion {
  from: string;
  fromName: string;
  fromType: string;
  reason: "missed" | "compromised";
  to: string | null;
}

// Surfaces the deterministic reschedule suggestion: a not-delivered quality session + the next
// rest day to make it up on. Athlete-confirmed — "Apply" rewrites the local block plan and mirrors
// the move to the Intervals.icu calendar (best-effort; a failed mirror never blocks the local move).
export default function RescheduleBanner() {
  const { state } = useSync();
  const queryClient = useQueryClient();
  const [s, setS] = useState<Suggestion | null>(null);
  // HR-44: captured at the moment THIS suggestion was fetched — not re-read from `state.currentBlock`
  // at Apply-click time, which may by then point at a different block (the athlete could have
  // written/deleted a replacement covering the same dates while this stale suggestion was still
  // showing, in which case the version check would wrongly pass against the NEW block's identity).
  const [suggestionBlockCreatedAt, setSuggestionBlockCreatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  // Set right after a successful apply: [] means every mirrored date wrote clean, non-empty names
  // the dates that didn't. null = nothing to report (either not applied yet, or dismissed).
  const [mirrorFailed, setMirrorFailed] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ suggestion: Suggestion | null; blockCreatedAt: string | null }>(
        `/api/reschedule?today=${localToday()}`
      );
      setS(r.suggestion);
      setSuggestionBlockCreatedAt(r.blockCreatedAt);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true); // visible failure (S1-3): no suggestion ≠ couldn't check
    }
  }, []);

  // HR-44: reload whenever the current block itself changes (write/delete/retro/sync all can replace
  // it) — a suggestion computed against a since-superseded block must never linger and be applied
  // against the new one.
  useMountLoad(load, state?.currentBlock?.createdAt ?? null);

  if (dismissed) return null;
  if (loadFailed) return <LoadFailed what="the reschedule check" retry={() => void load()} />;
  if (!s) {
    if (mirrorFailed === null) return null;
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs dark:border-zinc-700 dark:bg-zinc-900">
        {mirrorFailed.length === 0 ? (
          <p className="text-green-700 dark:text-green-400">Calendar updated on Intervals.icu ✓</p>
        ) : (
          <p className="min-w-0 flex-1 text-amber-700 dark:text-amber-400">
            Moved in the app — Intervals.icu update failed for {mirrorFailed.join(", ")}; re-syncing later or moving it
            there manually keeps them aligned.
          </p>
        )}
        <button onClick={() => setMirrorFailed(null)} className="shrink-0 text-zinc-500 hover:underline dark:text-zinc-400">
          Dismiss
        </button>
      </div>
    );
  }

  const apply = async () => {
    if (!s.to || busy) return;
    setBusy(true);
    setApplyError(null);
    let res: { ok: boolean; mirrored: string[]; mirrorFailed: string[] };
    try {
      res = await api<{ ok: boolean; mirrored: string[]; mirrorFailed: string[] }>("/api/reschedule", {
        method: "POST",
        body: JSON.stringify({
          from: s.from,
          to: s.to,
          today: localToday(),
          // HR-44: the createdAt THIS suggestion was computed against, captured at fetch time —
          // not `state.currentBlock?.createdAt` read fresh here, which could by now point at a
          // different (newer) block that happens to cover the same dates.
          expectedBlockCreatedAt: suggestionBlockCreatedAt,
        }),
      });
    } catch (e) {
      // HR-59: the move itself failed — preserve the real message (e.g. a 409 "this plan changed in
      // another tab" conflict) instead of a generic string, matching DayAction.tsx's equivalent path.
      setApplyError(e instanceof Error ? e.message : "Couldn't apply the move — try again.");
      setBusy(false);
      return;
    }
    // HR-59: the move already succeeded server-side at this point — a failure below is only the
    // post-move cache refresh, and must never be reported as "couldn't apply the move" (it wasn't).
    setS(null);
    setMirrorFailed(res.mirrorFailed);
    try {
      // HR-46: was a bare GET with no ?today= (fell back to the server's UTC date) plus a manual
      // setState(fresh) that replaced the ENTIRE app-state cache — if a Sync was also in flight, whichever
      // response landed second won outright, with no error surfaced either way. invalidateQueries is the
      // same idiom DayAction.tsx already uses for this exact refresh-after-move need: it merges through
      // react-query's own cache instead of a competing raw overwrite, and needs no `today` at all.
      await queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY });
    } catch {
      // Best-effort — the cache will catch up on the next natural refetch/sync.
    }
    setBusy(false);
  };

  const verb = s.reason === "compromised" ? "couldn't complete" : "missed";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/50">
      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
      <p className="min-w-0 flex-1 text-xs text-amber-900 dark:text-amber-200">
        <span className="font-semibold">Missed stimulus — </span>
        you {verb} your {s.fromType} session ({s.fromName}) on {s.from}.{" "}
        {s.to ? (
          <>Make it up on <span className="font-medium">{s.to}</span> (currently rest)?</>
        ) : (
          <>No rest day left in this block — it&apos;ll be a priority for your next block.</>
        )}
      </p>
      {s.to && (
        <button
          onClick={apply}
          disabled={busy}
          // UXA-55: no dark: pairing — same brightness in both themes instead of the lighter shade
          // the app's other amber CTAs use against a dark surface (KnowledgeBaseEditor's discard button).
          className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50 dark:bg-amber-500 dark:hover:bg-amber-600"
        >
          {busy ? "Moving…" : "Apply"}
        </button>
      )}
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 text-xs text-amber-700 hover:underline dark:text-amber-300"
      >
        Dismiss
      </button>
      {applyError && <p className="w-full text-[11px] text-red-600 dark:text-red-400">{applyError}</p>}
    </div>
  );
}
