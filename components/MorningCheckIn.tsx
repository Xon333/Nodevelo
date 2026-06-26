"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { useSync, type AppState } from "./SyncProvider";

type Flag = "ill" | "extreme-fatigue";
type Decision = "proceed" | "downgrade";
interface Suggestion {
  from: string;
  fromName: string;
  fromType: string;
  to: string | null;
  skippedRestDay: string | null;
}
interface CheckState {
  check: { flag: Flag; decision: Decision } | null;
  isQualityDay: boolean;
  suggestion: Suggestion | null;
}
interface SubmitResult {
  decision: Decision;
  reasons: string[];
  suggestion: Suggestion | null;
}

// Proactive "not feeling it?" override (ROADMAP #3). Surfaces only on a quality day before the ride is
// logged: two one-tap flags (feeling ill / extreme fatigue) → a deterministic downgrade → one-tap apply
// that moves the quality stimulus (athlete-confirmed, like RescheduleBanner). Objective fatigue is handled
// by the readiness signal; this is the manual override for "I feel worse than the load model can see."
export default function MorningCheckIn() {
  const { state, setState } = useSync();
  const [data, setData] = useState<CheckState | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<CheckState>(`/api/morning-check?today=${localToday()}`);
        if (!cancelled) setData(r);
      } catch {
        // best-effort — the override is optional
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Only relevant before a quality session that hasn't been ridden yet.
  const rideLogged = state?.todayAnalysis?.activityDate === localToday();
  if (dismissed || !data || !data.isQualityDay || rideLogged) return null;

  const submit = async (flag: Flag) => {
    setBusy(true);
    try {
      const r = await api<SubmitResult>("/api/morning-check", { method: "POST", body: JSON.stringify({ flag, today: localToday() }) });
      setResult(r);
    } catch {
      // ignore — leave the buttons up to retry
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      await api("/api/morning-check", { method: "PUT", body: JSON.stringify({ today: localToday() }) });
      const fresh = await api<AppState>("/api/sync"); // refresh so the block calendar reflects the move
      setState(fresh);
      setDismissed(true);
    } catch {
      // leave it up to retry
    } finally {
      setBusy(false);
    }
  };

  // mb-2 lives on the component (not a wrapper in Dashboard) so a hidden override leaves no gap.
  const shell = "mb-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-900/60";

  // ---- After flagging: the downgrade recommendation + the proposed move ----
  if (result) {
    const downgrade = result.decision === "downgrade";
    const s = result.suggestion;
    return (
      <div className={shell}>
        <p className={`text-xs font-semibold ${downgrade ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-400"}`}>
          {downgrade ? "Downgrade recommended" : "You're good — proceed"}
        </p>
        {result.reasons.length > 0 && (
          <p className="mt-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{result.reasons.join(" ")}</p>
        )}
        {downgrade && s && (
          <p className="mt-1.5 text-[11px] leading-snug text-zinc-600 dark:text-zinc-300">
            {s.to ? (
              <>
                Move your {s.fromType} ({s.fromName}) to <span className="font-medium">{s.to}</span> — swap it with that day&apos;s easy ride.
              </>
            ) : s.skippedRestDay ? (
              <>
                There&apos;s a rest day on <span className="font-medium">{s.skippedRestDay}</span>, but moving a hard session there
                would add load while you&apos;re compromised — today deloads to recovery and your {s.fromType} carries to the next block.
              </>
            ) : (
              <>No make-up slot left this block — today deloads to recovery and it&apos;s a priority next block.</>
            )}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          {downgrade && (
            <button
              onClick={apply}
              disabled={busy}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
            >
              {busy ? "Applying…" : s?.to ? "Apply downgrade + move" : "Downgrade today"}
            </button>
          )}
          <button onClick={() => setDismissed(true)} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
            {downgrade ? "Proceed anyway" : "Dismiss"}
          </button>
        </div>
      </div>
    );
  }

  // ---- Collapsed prompt: two one-tap flags ----
  const btn =
    "shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:border-zinc-500";
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${shell}`}>
      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#00d4ff]" />
      <p className="min-w-0 flex-1 text-xs text-zinc-700 dark:text-zinc-300">
        <span className="font-semibold">Quality session today</span> — not feeling it?
      </p>
      <button onClick={() => submit("ill")} disabled={busy} className={btn}>
        Feeling ill
      </button>
      <button onClick={() => submit("extreme-fatigue")} disabled={busy} className={btn}>
        Extreme fatigue
      </button>
    </div>
  );
}
