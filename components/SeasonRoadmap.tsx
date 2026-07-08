"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { roadmapView } from "@/lib/season";
import type { SeasonFocus, SeasonPlan } from "@/lib/types";
import { LoadFailed } from "./ui";

const FOCUS_COLOR: Record<SeasonFocus, string> = {
  "aerobic-base": "#00d4ff", threshold: "#f5a623", vo2max: "#ff49c8", anaerobic: "#a06bff", durability: "#38d39f", sharpen: "#7fd8ea",
};

// Season roadmap stepper for /plan (MACRO-UI, Task 10): a compact strip of done/current/upcoming
// focus-period cards plus a flag for the next upcoming event. Withholds entirely (no error UI) when
// there's no season plan yet or it has zero periods — mirrors this codebase's other best-effort tiles.
export default function SeasonRoadmap({ refreshKey }: { refreshKey?: number }) {
  const [plan, setPlan] = useState<SeasonPlan | null>(null);
  const [failed, setFailed] = useState(false);
  // No plan / zero periods stays silent (absence); a fetch failure renders visibly (S1-3).
  const load = useCallback(async () => {
    try {
      const { plan } = await api<{ plan: SeasonPlan }>("/api/season");
      setPlan(plan);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  // Plain effect (not useMountLoad) so a bump to refreshKey after a Season save re-runs the fetch,
  // not just the initial mount.
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (failed) return <LoadFailed what="the season roadmap" retry={() => void load()} />;
  if (!plan || plan.periods.length === 0) return null;
  const today = localToday();
  const view = roadmapView(plan, today);
  const nextEvent = plan.events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Season</h2>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{plan.objective || "get faster"}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {view.map((p) => (
          <div key={`${p.focus}-${p.startDate}`} className={`min-w-0 flex-1 rounded-md border px-2.5 py-2 ${p.status === "current" ? "border-[#ff49c8] shadow-[0_0_0_1px_#ff49c8]" : "border-zinc-200 dark:border-zinc-700"} ${p.status === "done" ? "opacity-55" : ""}`}>
            <p className="text-[8px] font-bold uppercase tracking-wide" style={{ color: FOCUS_COLOR[p.focus] }}>
              {p.status === "done" ? "✓ " : p.status === "current" ? "● " : "○ "}{p.phase}
            </p>
            <p className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-100">{p.label}</p>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {p.deloadWeek ? "deload · " : ""}{p.weeks} wk{p.targetWeeklyTss != null ? ` · ${p.targetWeeklyTss} TSS/wk` : ""}
            </p>
          </div>
        ))}
        {nextEvent && (
          <div className="flex min-w-[64px] flex-col items-center justify-center rounded-md border border-[#ffcf4d] bg-[#ffcf4d]/10 px-2 py-2 text-center">
            <span className="text-base leading-none">🏁</span>
            <span className="mt-1 text-[9px] font-bold text-[#b8952f] dark:text-[#ffcf4d]">{nextEvent.name}</span>
            <span className="text-[9px] text-zinc-500 dark:text-zinc-400">{nextEvent.date.slice(5)}</span>
          </div>
        )}
      </div>
    </section>
  );
}
