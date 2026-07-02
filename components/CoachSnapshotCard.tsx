"use client";

import type { CoachSnapshot } from "@/lib/coach-snapshot";

// Surfaces the deterministic resolved-numbers the LLM is handed (ROADMAP #1) so the athlete sees the
// same figures the coach reasons from — chiefly the TSB-as-actionable-modifier, which isn't shown
// anywhere else on Today, plus the resolved fuel numbers. The card hides when there's nothing to show.
export default function CoachSnapshotCard({ snapshot }: { snapshot: CoachSnapshot }) {
  const { form, fuel } = snapshot;
  const tsb = form.tsb;
  const fuelBits = [
    fuel.todayTargetKcal !== null ? `${fuel.todayTargetKcal} kcal target` : null,
    fuel.rideBurnKj !== null ? `${fuel.rideBurnKj} kJ ride` : null,
    fuel.weightTrend7dKg !== null ? `${fuel.weightTrend7dKg > 0 ? "+" : ""}${fuel.weightTrend7dKg} kg/7d` : null,
    fuel.fuelingState !== null ? `energy avail. ${fuel.fuelingState}` : null,
  ].filter((b): b is string => b !== null);

  if (!form.tsbModifier && fuelBits.length === 0 && !snapshot.ftpRetest) return null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Coach&apos;s read{snapshot.ftp ? <span className="ml-1 font-normal normal-case">· FTP {snapshot.ftp}W</span> : null}
      </p>
      {form.tsbModifier && (
        <p className="mt-1 text-xs leading-snug text-zinc-700 dark:text-zinc-200">
          <span className="font-semibold">
            Form{tsb !== null ? ` ${tsb > 0 ? "+" : ""}${tsb}` : ""} · {form.tsbModifier.band}
          </span>
          {" — "}
          {form.tsbModifier.guidance}
        </p>
      )}
      {fuelBits.length > 0 && (
        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">Fuel: {fuelBits.join(" · ")}</p>
      )}
      {snapshot.ftpRetest && (
        <p className="mt-1 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
          <span className="font-semibold">FTP check:</span> {snapshot.ftpRetest.evidence}
        </p>
      )}
    </div>
  );
}
