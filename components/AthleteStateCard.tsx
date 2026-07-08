"use client";

import Link from "next/link";
import { useId } from "react";
import type { AthleteState } from "@/lib/types";
import { BAND_COLOR, DIR, driverEffectClass } from "./athlete-state-ui";

// The ONE readiness verdict on Today (S1-1): the fused §5 signal-fusion read owns fold-1. Band +
// recommendation are visible at a glance (the verdict register: primed/ready/steady/strained/depleted),
// the headline reason sits under them, and the coach's TSB-as-modifier read ("Form +3 · fresh — …")
// folds in as this card's supporting line instead of a separate competing card. The ranked drivers
// stay behind the hover/focus reveal — same tabIndex + aria-describedby + role="tooltip" wiring as
// Wave 1, so keyboard and assistive tech reach them. Band/driver styling is shared with
// StateDriversCard via athlete-state-ui.
const BAND_BAR: Record<AthleteState["band"], string> = {
  primed: "bg-emerald-500",
  ready: "bg-green-500",
  steady: "bg-zinc-400 dark:bg-zinc-500",
  strained: "bg-amber-500",
  depleted: "bg-red-500",
};

export default function AthleteStateCard({
  state,
  form,
  ftpRetest,
  compact,
}: {
  state: AthleteState;
  // The coach-snapshot TSB-as-actionable-modifier read (lib/coach-snapshot.ts resolveTsbModifier) —
  // supporting evidence under the verdict, not a second verdict (Constitution §4).
  form?: { tsb: number | null; band: string; guidance: string } | null;
  ftpRetest?: { evidence: string } | null;
  // Post-ride strip (UX v2 §4): score · band · recommendation · why? in one line — the day's
  // go/no-go is decided, so the verdict compresses. Keeps confidence (Constitution §5) and the
  // hover/focus drivers reveal; drops the form line and score bar.
  compact?: boolean;
}) {
  const band = state.band[0].toUpperCase() + state.band.slice(1);
  // headline is deterministic "`Band` — reason" (lib/athlete-state.ts); the band now shows as the
  // visible verdict, so display only the reason part (fall back to the full headline if the shape
  // ever changes).
  const bandPrefix = `${band} — `;
  const reason = state.headline.startsWith(bandPrefix) ? state.headline.slice(bandPrefix.length) : state.headline;
  const detailId = useId();

  // Hover/focus detail shared by both variants: the ranked drivers that moved the score.
  const driversTip = (
    <div
      id={detailId}
      role="tooltip"
      className="pointer-events-none absolute left-0 top-full z-30 mt-1 w-80 max-w-[90vw] rounded-lg border border-zinc-200 bg-white p-3 text-left opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        What moved it
      </p>
      <ul className="mt-1.5 space-y-1">
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
  );

  if (compact) {
    return (
      <div
        tabIndex={0}
        aria-describedby={detailId}
        className="group relative flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800"
      >
        <span className="flex shrink-0 items-baseline gap-0.5">
          <span className={`font-mono text-xl font-bold leading-none ${BAND_COLOR[state.band]}`}>{state.score}</span>
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">/100</span>
        </span>
        <p className="min-w-0 text-sm font-semibold leading-tight">
          <span className={BAND_COLOR[state.band]}>{band}</span>
          <span className="font-medium text-zinc-600 dark:text-zinc-300"> — {state.recommendation}</span>
          {state.confidence !== "high" && (
            <span
              className={`ml-1.5 text-[10px] font-normal ${
                state.confidence === "low" ? "text-amber-600 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              · {state.confidence} confidence
            </span>
          )}
        </p>
        <Link
          href="/model"
          aria-label="Why this state — open your coaching model"
          className="ml-auto shrink-0 text-[10px] font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-[#00d4ff]"
        >
          why? →
        </Link>
        {ftpRetest && (
          <p className="w-full text-[11px] leading-snug text-amber-600 dark:text-amber-400">
            <span className="font-semibold">FTP check:</span> {ftpRetest.evidence}
          </p>
        )}
        {driversTip}
      </div>
    );
  }

  return (
    // tabIndex + group-focus-within: the drivers detail below opens on keyboard focus as well as
    // hover (Constitution §6) — tabbing to the card reveals it visually; aria-describedby hands
    // the same content to assistive tech regardless of the visual reveal state.
    <div
      tabIndex={0}
      aria-describedby={detailId}
      className="group relative rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Athlete state
          {/* Confidence tier (A): low = visible amber caution (the read is thin — few core signals or a
              tiny execution sample); medium = muted; high = hidden (the default, no need to flag). */}
          {state.confidence !== "high" && (
            <span
              className={`ml-1 normal-case ${state.confidence === "low" ? "text-amber-600 dark:text-amber-400" : ""}`}
            >
              · {state.confidence} confidence
            </span>
          )}
        </p>
        <Link
          href="/model"
          aria-label="Why this state — open your coaching model"
          className="shrink-0 text-[10px] font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-[#00d4ff]"
        >
          why? →
        </Link>
      </div>

      {/* The verdict: score + band + recommendation, visible — not hidden behind hover. */}
      <div className="mt-1.5 flex items-center gap-4">
        <div className="flex shrink-0 items-baseline gap-0.5">
          <span className={`font-mono text-4xl font-bold leading-none ${BAND_COLOR[state.band]}`}>{state.score}</span>
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">/100</span>
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold leading-tight">
            <span className={BAND_COLOR[state.band]}>{band}</span>
            <span className="font-medium text-zinc-600 dark:text-zinc-300"> — {state.recommendation}</span>
          </p>
          <p className="mt-0.5 text-xs leading-snug text-zinc-500 dark:text-zinc-400">{reason}</p>
        </div>
      </div>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
        <div className={`h-full rounded-full ${BAND_BAR[state.band]}`} style={{ width: `${state.score}%` }} />
      </div>

      {/* Coach's read (folded in from the old CoachSnapshotCard): how today's form shapes executing
          the session — a supporting sentence in the form register, subordinate to the verdict above. */}
      {form && (
        <p className="mt-2 text-xs leading-snug text-zinc-700 dark:text-zinc-200">
          <span className="font-semibold">
            Form{form.tsb !== null ? ` ${form.tsb > 0 ? "+" : ""}${form.tsb}` : ""} · {form.band}
          </span>
          {" — "}
          {form.guidance}
        </p>
      )}
      {ftpRetest && (
        <p className="mt-1.5 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
          <span className="font-semibold">FTP check:</span> {ftpRetest.evidence}
        </p>
      )}

      {driversTip}
    </div>
  );
}
