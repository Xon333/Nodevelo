"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { useSync, type AppState } from "./SyncProvider";
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
  const { state, setState } = useSync();
  const [s, setS] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  // Set right after a successful apply: [] means every mirrored date wrote clean, non-empty names
  // the dates that didn't. null = nothing to report (either not applied yet, or dismissed).
  const [mirrorFailed, setMirrorFailed] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ suggestion: Suggestion | null }>(`/api/reschedule?today=${localToday()}`);
      setS(r.suggestion);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true); // visible failure (S1-3): no suggestion ≠ couldn't check
    }
  }, []);

  useMountLoad(load);

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
    try {
      const res = await api<{ ok: boolean; mirrored: string[]; mirrorFailed: string[] }>("/api/reschedule", {
        method: "POST",
        body: JSON.stringify({
          from: s.from,
          to: s.to,
          today: localToday(),
          expectedBlockCreatedAt: state?.currentBlock?.createdAt ?? null,
        }),
      });
      const fresh = await api<AppState>("/api/sync"); // refresh so the block calendar reflects the move
      setState(fresh);
      setS(null);
      setMirrorFailed(res.mirrorFailed);
    } catch {
      setApplyError("Couldn't apply the move — try again.");
    } finally {
      setBusy(false);
    }
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
