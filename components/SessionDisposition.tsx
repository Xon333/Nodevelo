"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/client-api";
import type { CompromiseReason, DispositionEntry, SessionDisposition as Disp } from "@/lib/types";
import { InfoDot, LoadFailed, useMountLoad } from "./ui";

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
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // A failed load used to render as "no disposition set" — indistinguishable from a real unset
  // state, and a tap from there would write blind over whatever is saved (S1-3).
  const load = useCallback(async () => {
    try {
      const r = await api<{ disposition: DispositionEntry | null }>(`/api/disposition?date=${date}`);
      setCurrent(r.disposition);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [date]);

  useMountLoad(load);

  const set = async (disposition: Disp, reason: CompromiseReason | null = null) => {
    if (saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const r = await api<{ disposition: DispositionEntry }>("/api/disposition", {
        method: "POST",
        body: JSON.stringify({ date, disposition, reason }),
      });
      setCurrent(r.disposition);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed)
    return (
      <div className="mt-3">
        <LoadFailed what="session attribution" retry={() => void load()} />
      </div>
    );
  if (current === undefined) return null;

  // S2-2: py-0.5 gave these chips a sub-24px hit area; py-1 keeps the visual size close while
  // giving the click/tap target more room.
  const chip = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
      active
        ? "bg-zinc-900 text-white dark:bg-[#00d4ff]/20 dark:text-[#00d4ff]"
        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
    }`;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Session
        {/* S2-10: the one attribution that changes what the model learns — worth a beat of explanation. */}
        <InfoDot text="Compromised keeps the ride as history but stops it teaching the model or being misdiagnosed as under-recovery." />
      </span>
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
      {saveError && <span className="text-[11px] text-red-600 dark:text-red-400">Couldn&apos;t save — tap again.</span>}
    </div>
  );
}
