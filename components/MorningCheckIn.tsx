"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { useSync, type AppState } from "./SyncProvider";

type Illness = "none" | "mild" | "sick";
interface Suggestion {
  from: string;
  fromName: string;
  fromType: string;
  to: string | null;
  toWasRest: boolean;
}
interface CheckState {
  check: { decision: "proceed" | "downgrade"; strain: number } | null;
  isQualityDay: boolean;
  suggestion: Suggestion | null;
}
interface SubmitResult {
  decision: "proceed" | "downgrade";
  reasons: string[];
  suggestion: Suggestion | null;
}

const RATINGS: Array<{ key: "fatigue" | "sleep" | "soreness" | "motivation"; label: string; lo: string; hi: string }> = [
  { key: "fatigue", label: "Fatigue", lo: "fresh", hi: "wrecked" },
  { key: "sleep", label: "Sleep", lo: "poor", hi: "great" },
  { key: "soreness", label: "Soreness", lo: "none", hi: "very" },
  { key: "motivation", label: "Motivation", lo: "low", hi: "high" },
];

// Proactive "not feeling it?" check-in (ROADMAP #3). Surfaces only on a quality day before the ride
// is logged: a few standardised chips → a deterministic proceed/downgrade decision → one-tap apply
// that downgrades today and moves the quality stimulus (athlete-confirmed, like RescheduleBanner).
export default function MorningCheckIn() {
  const { state, setState } = useSync();
  const [data, setData] = useState<CheckState | null>(null);
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState({ fatigue: 3, sleep: 3, soreness: 3, motivation: 3, illness: "none" as Illness });
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
        // best-effort — the check-in is optional
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Only relevant before a quality session that hasn't been ridden yet.
  const rideLogged = state?.todayAnalysis?.activityDate === localToday();
  if (dismissed || !data || !data.isQualityDay || rideLogged) return null;

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<SubmitResult>("/api/morning-check", { method: "POST", body: JSON.stringify({ ...answers, today: localToday() }) });
      setResult(r);
      setOpen(false);
    } catch {
      // ignore — leave the form open to retry
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

  const chip = (active: boolean) =>
    `rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? "border-zinc-900 bg-zinc-900 text-white dark:border-[#00d4ff]/60 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff]"
        : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-500"
    }`;

  // mb-2 lives on the component (not a wrapper in Dashboard) so a hidden check-in leaves no gap.
  const shell = "mb-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-900/60";

  // ---- After submit: decision + (if downgrade) the proposed move ----
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
                Move your {s.fromType} ({s.fromName}) to <span className="font-medium">{s.to}</span>
                {s.toWasRest ? " (a rest day) — today becomes an easy spin." : " — swap it with that day's easy ride."}
              </>
            ) : (
              <>No make-up slot left this block — today downgrades to recovery and it&apos;s a priority next block.</>
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

  // ---- Collapsed prompt ----
  if (!open) {
    const prior = data.check;
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${shell}`}>
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#00d4ff]" />
        <p className="min-w-0 flex-1 text-xs text-zinc-700 dark:text-zinc-300">
          <span className="font-semibold">Quality session today</span> —{" "}
          {prior ? `checked in (${prior.decision}).` : "how are you feeling before it?"}
        </p>
        <button
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:border-zinc-400 dark:border-zinc-600 dark:text-zinc-200 dark:hover:border-zinc-500"
        >
          {prior ? "Re-check" : "Check in"}
        </button>
      </div>
    );
  }

  // ---- Expanded form ----
  return (
    <div className={shell}>
      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Morning check-in</p>
      <div className="mt-2 space-y-2">
        {RATINGS.map((r) => (
          <div key={r.key} className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">{r.label}</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setAnswers((a) => ({ ...a, [r.key]: n }))} className={chip(answers[r.key] === n)}>
                  {n}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
              {r.lo}→{r.hi}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">Illness</span>
          <div className="flex gap-1">
            {(["none", "mild", "sick"] as const).map((lvl) => (
              <button key={lvl} onClick={() => setAnswers((a) => ({ ...a, illness: lvl }))} className={chip(answers.illness === lvl)}>
                {lvl}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-[#00d4ff]/15 dark:text-[#00d4ff] dark:hover:bg-[#00d4ff]/25"
        >
          {busy ? "Checking…" : "See recommendation"}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          Cancel
        </button>
      </div>
    </div>
  );
}
