"use client";

import Link from "next/link";
import type { AthleteState } from "@/lib/types";
import { BAND_COLOR, DIR, driverEffectClass } from "./athlete-state-ui";

// The §5 "second brain's read on you now" glance: a 0–100 score (the default view); the band label
// + drivers reveal on hover. Band/driver styling is shared with StateDriversCard via athlete-state-ui.
const BAND_BAR: Record<AthleteState["band"], string> = {
  primed: "bg-emerald-500",
  ready: "bg-green-500",
  steady: "bg-zinc-400 dark:bg-zinc-500",
  strained: "bg-amber-500",
  depleted: "bg-red-500",
};

export default function AthleteStateCard({ state }: { state: AthleteState }) {
  const band = state.band[0].toUpperCase() + state.band.slice(1);
  return (
    <div className="group relative flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="flex items-baseline gap-0.5">
        <span className={`font-mono text-3xl font-bold leading-none ${BAND_COLOR[state.band]}`}>{state.score}</span>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">/100</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Athlete state
            {state.confidence !== "high" && <span className="ml-1 normal-case">· {state.confidence} confidence</span>}
          </p>
          <Link
            href="/model"
            aria-label="Why this state — open your coaching model"
            className="shrink-0 text-[10px] font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-[#00d4ff]"
          >
            why? →
          </Link>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
          <div className={`h-full rounded-full ${BAND_BAR[state.band]}`} style={{ width: `${state.score}%` }} />
        </div>
      </div>

      {/* Hover detail: band + recommendation + the drivers that moved the score. */}
      <div className="pointer-events-none absolute left-0 top-full z-30 mt-1 w-72 max-w-[90vw] rounded-lg border border-zinc-200 bg-white p-3 text-left opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100 dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {band} <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">· {state.recommendation}</span>
        </p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{state.headline}</p>
        <ul className="mt-2 space-y-1">
          {state.drivers.map((d) => (
            <li key={d.key} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="min-w-0 text-zinc-500 dark:text-zinc-400">
                {DIR[d.dir]} {d.note}
              </span>
              <span className={`shrink-0 font-mono ${driverEffectClass(d.effect)}`}>
                {d.effect > 0 ? "+" : ""}
                {d.effect}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
