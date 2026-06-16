"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { CompromiseReason, DispositionEntry, SessionDisposition as Disp } from "@/lib/types";

// One small attribution row on the ride card: the fact the system can't infer — whether a
// session was completed, cut short, or compromised (and why). "Compromised" is the one that
// matters: it keeps the ride as history but stops it teaching the model or being misdiagnosed.
const OPTIONS: { value: Disp; label: string }[] = [
  { value: "completed", label: "Completed" },
  { value: "partial", label: "Partial" },
  { value: "compromised", label: "Compromised" },
];
const REASONS: CompromiseReason[] = ["equipment", "sickness", "weather", "other"];

export default function SessionDisposition({ date }: { date: string }) {
  const [current, setCurrent] = useState<DispositionEntry | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ disposition: DispositionEntry | null }>(`/api/disposition?date=${date}`);
        if (!cancelled) setCurrent(r.disposition);
      } catch {
        if (!cancelled) setCurrent(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  const set = async (disposition: Disp, reason: CompromiseReason | null = null) => {
    if (saving) return;
    setSaving(true);
    try {
      const r = await api<{ disposition: DispositionEntry }>("/api/disposition", {
        method: "POST",
        body: JSON.stringify({ date, disposition, reason }),
      });
      setCurrent(r.disposition);
    } catch {
      // non-critical
    } finally {
      setSaving(false);
    }
  };

  if (current === undefined) return null;

  const chip = (active: boolean) =>
    `rounded-full px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50 ${
      active
        ? "bg-zinc-900 text-white dark:bg-[#00d4ff]/20 dark:text-[#00d4ff]"
        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
    }`;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Session</span>
      {OPTIONS.map((o) => (
        <button key={o.value} disabled={saving} onClick={() => set(o.value)} className={chip(current?.disposition === o.value)}>
          {o.label}
        </button>
      ))}
      {current?.disposition === "compromised" && (
        <>
          <span className="text-zinc-300 dark:text-zinc-600">·</span>
          {REASONS.map((r) => (
            <button key={r} disabled={saving} onClick={() => set("compromised", r)} className={chip(current?.reason === r)}>
              {r}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
