"use client";

import { useSync } from "./SyncProvider";
import { Card } from "./ui";
import { BAND_COLOR, DIR, driverEffectClass } from "./athlete-state-ui";

// "Why is my state what it is?" — the fused 0–100 readiness score plus the ranked signals that moved
// it (the XAI ranked-drivers pattern). Reads the same AthleteState the coach acts on, so the score is
// never a black box: every point traces to a named driver. Band/driver styling is shared with
// AthleteStateCard via athlete-state-ui so the two can't drift.

export default function StateDriversCard() {
  const { state } = useSync();
  const s = state?.athleteState ?? null;

  return (
    <Card
      title="What drives your state"
      tip="The fused 0–100 readiness score and the signals that moved it, largest first — the same read the coach acts on."
    >
      {!s ? (
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
              {s.drivers.map((d) => (
                <li
                  key={d.key}
                  className="flex items-baseline justify-between gap-2 border-t border-zinc-100 pt-1.5 first:border-t-0 first:pt-0 dark:border-zinc-700/60"
                >
                  <span className="min-w-0 text-xs text-zinc-600 dark:text-zinc-300">
                    {DIR[d.dir]} {d.note}
                  </span>
                  <span className={`shrink-0 font-mono text-xs ${driverEffectClass(d.effect)}`}>
                    {d.effect > 0 ? "+" : ""}
                    {d.effect}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
