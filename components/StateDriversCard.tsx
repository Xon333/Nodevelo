"use client";

import { useSync } from "./SyncProvider";
import { Card, LoadFailed, Skeleton } from "./ui";
import { BAND_COLOR, DIR, driverEffectClass } from "./athlete-state-ui";

// "Why is my state what it is?" — the fused 0–100 readiness score plus the ranked signals that moved
// it (the XAI ranked-drivers pattern). Reads the same AthleteState the coach acts on, so the score is
// never a black box: every point traces to a named driver. Band/driver styling is shared with
// AthleteStateCard via athlete-state-ui so the two can't drift.

export default function StateDriversCard() {
  const { state, loadError } = useSync();
  const s = state?.athleteState ?? null;

  // Bars scale to the biggest mover so relative magnitude reads at a glance (masterplan §6 NOW:
  // "signed magnitude bars, largest first" — the list is already |effect|-sorted upstream).
  // Floor of 1: a plausible all-zero-effect driver set (steady athlete) must not divide by zero
  // into NaN bar widths (final-review F1).
  const maxAbs = s && s.drivers.length > 0 ? Math.max(1, ...s.drivers.map((d) => Math.abs(d.effect))) : 1;

  return (
    <Card
      title="What drives your state"
      tip="The fused 0–100 readiness score and the signals that moved it, largest first — the same read the coach acts on."
    >
      {/* UXA-9: distinguishes "still loading" (state itself is null) from "loaded but genuinely no
          data yet" (state exists, athleteState doesn't) — previously both read as the same
          "Sync to compute" line, with no page-level skeleton guard like Dashboard.tsx uses. */}
      {state === null && !loadError ? (
        <Skeleton className="h-20" />
      ) : loadError ? (
        <LoadFailed what="your state" />
      ) : !s ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Sync to compute your state.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className={`font-mono text-2xl font-bold leading-none ${BAND_COLOR[s.band]}`}>{s.score}</span>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">/100</span>
            <span className="ml-1 text-xs font-medium capitalize text-zinc-700 dark:text-zinc-200">{s.band}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">· {s.recommendation}</span>
            {s.confidence !== "high" && (
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400">· {s.confidence} confidence</span>
            )}
          </div>
          <p className="mt-1 text-xs leading-snug text-zinc-500 dark:text-zinc-400">{s.headline}</p>
          {s.drivers.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {s.drivers.map((d) => {
                const pct = Math.max(6, Math.round((Math.abs(d.effect) / maxAbs) * 100));
                const positive = d.effect > 0;
                return (
                  <li key={d.key} className="grid grid-cols-[minmax(0,1fr)_5.5rem_2.5rem] items-center gap-2">
                    <span title={d.note} className="min-w-0 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-300">
                      {DIR[d.dir]} {d.note}
                    </span>
                    <span aria-hidden className="flex h-2 items-center overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                      {d.effect !== 0 && (
                        <span
                          className={`h-full rounded-full ${positive ? "bg-emerald-500/80 dark:bg-emerald-400/70" : "bg-red-500/80 dark:bg-red-400/70"}`}
                          style={{ width: `${pct}%` }}
                        />
                      )}
                    </span>
                    <span className={`text-right font-mono text-xs ${driverEffectClass(d.effect)}`}>
                      {d.effect > 0 ? "+" : ""}
                      {d.effect}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
