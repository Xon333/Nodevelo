"use client";

import { localToday } from "@/lib/date";
import { roadmapView, SEASON_SHAPES_GENERATION, FOCUS_LABELS, type SeasonOutlookSlot } from "@/lib/season";
import type { SeasonFocus, SeasonPlan } from "@/lib/types";
import { LoadFailed } from "./ui";

// UXA-10: previously 6 undocumented literal hexes via inline style (4 of them near-duplicate shades
// of existing tokens — e.g. #f5a623 vs Threshold's own #f59e0b). Reuses the already-sanctioned
// workout-type accent hexes (DESIGN.md §2) instead, paired by the closest semantic match, and moves
// off inline style onto Tailwind classes so dark mode is technically possible (all 7 sanctioned hexes
// already use one value across both themes, so no dark: variant is needed here either).
const FOCUS_COLOR_CLASS: Record<SeasonFocus, string> = {
  "aerobic-base": "text-[#10b981]", // Z2
  threshold: "text-[#f59e0b]", // Threshold
  vo2max: "text-[#f97316]", // VO2max
  anaerobic: "text-[#f43f5e]", // SIT
  durability: "text-[#8b5cf6]", // Strength
  sharpen: "text-[#d946ef]", // RaceSim
};

// Season roadmap stepper for /plan (MACRO-UI): done/current cards from settled history + event mode's
// real committed arc, plus (season-roadmap-preview §6) a dashed, lower-opacity "if you kept going"
// projection for the rolling case — computed fresh server-side every load, never a promise about what a
// future block will actually contain. Shows a 3-step teaching stub when there's nothing to show yet; a
// fetch failure renders visibly (LoadFailed).
//
// UXA-19: purely presentational — PlanView owns the one /api/season fetch (react-query) and passes the
// result down, instead of this component running its own independent fetch of the same endpoint
// (confirmed live as 3x redundant /api/season calls per Plan load before this change).
export default function SeasonRoadmap({
  plan,
  outlook,
  failed,
  onRetry,
}: {
  plan: SeasonPlan | null;
  outlook: SeasonOutlookSlot[] | null;
  failed: boolean;
  onRetry: () => void;
}) {
  const today = localToday();

  if (failed) return <LoadFailed what="the season roadmap" retry={onRetry} />;

  const hasHistory = plan !== null && plan.periods.length > 0;
  const hasOutlook = outlook !== null && outlook.length > 0;

  if (!hasHistory && !hasOutlook) {
    return (
      <section className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-3 dark:border-zinc-600 dark:bg-zinc-800">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          How planning works
        </h2>
        <ol className="flex flex-col gap-1.5 text-xs text-zinc-600 dark:text-zinc-300 sm:flex-row sm:items-center sm:gap-3">
          <li className="flex items-baseline gap-1.5"><span className="font-mono text-[#ff49c8]">1</span> Set a <span className="font-medium">season</span> — your focus arc (base → build → sharpen).</li>
          <li aria-hidden className="hidden text-zinc-400 sm:block">→</li>
          <li className="flex items-baseline gap-1.5"><span className="font-mono text-[#ff49c8]">2</span> <span className="font-medium">Blocks</span> fill it in, 2–8 weeks at a time.</li>
          <li aria-hidden className="hidden text-zinc-400 sm:block">→</li>
          <li className="flex items-baseline gap-1.5">
            <span className="font-mono text-[#ff49c8]">3</span>
            {SEASON_SHAPES_GENERATION
              ? <>Each block auto-targets the current phase &amp; your goals.</>
              : <>Each block targets your stated goals (phase-targeting is temporarily paused).</>}
          </li>
        </ol>
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          Add an objective &amp; a target event below to generate your season.
        </p>
      </section>
    );
  }

  const view = plan ? roadmapView(plan, today) : [];
  const nextEvent = plan?.events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const nextA = plan?.events.filter((e) => e.priority === "A" && e.date > today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const hasDerived = plan?.periods.some((p) => p.source === "derived") ?? false;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
      {/* UXA-47: was one unwrapped flex row — on a 375px viewport the long objective sentence
          wrapped back under the "SEASON" label mid-paragraph instead of flowing below it. */}
      <div className="mb-2 flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Season</h2>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{plan?.objective || "get faster"}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {view.map((p) => (
          <div key={`${p.focus}-${p.startDate}`} className={`min-w-0 flex-1 rounded-md border px-2.5 py-2 ${p.status === "current" ? "border-[#ff49c8] shadow-[0_0_0_1px_#ff49c8]" : "border-zinc-200 dark:border-zinc-700"} ${p.status === "done" ? "opacity-55" : ""}`}>
            <p className={`text-[8px] font-bold uppercase tracking-wide ${FOCUS_COLOR_CLASS[p.focus]}`}>
              {p.status === "done" ? "✓ " : p.status === "current" ? "● " : "○ "}{p.phase}
            </p>
            <p className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-100">{p.label}</p>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {p.deloadWeek ? "deload · " : ""}{p.weeks} wk{p.targetWeeklyTss != null ? ` · ${p.targetWeeklyTss} TSS/wk` : ""}
            </p>
          </div>
        ))}
        {outlook?.map((slot, i) => (
          <div key={`outlook-${slot.focus}-${slot.startDate}-${i}`} className="min-w-0 flex-1 rounded-md border border-dashed border-zinc-300 px-2.5 py-2 opacity-70 dark:border-zinc-600">
            <p className={`text-[8px] font-bold uppercase tracking-wide ${FOCUS_COLOR_CLASS[slot.focus]}`}>○ projected</p>
            <p className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-100">{FOCUS_LABELS[slot.focus]}</p>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{slot.weeks} wk</p>
          </div>
        ))}
        {/* UXA-10: was an undocumented gold pair (#ffcf4d/#b8952f) — reuses Threshold's sanctioned
            amber instead, with a darker light-mode text shade for readability on the tint (the same
            pattern DESIGN.md §2 already uses for #7fe7ff on a cyan-tinted surface). */}
        {nextEvent && (
          <div className="flex min-w-[64px] flex-col items-center justify-center rounded-md border border-[#f59e0b] bg-[#f59e0b]/10 px-2 py-2 text-center">
            <span className="text-base leading-none">🏁</span>
            <span className="mt-1 text-[9px] font-bold text-amber-800 dark:text-[#f59e0b]">{nextEvent.name}</span>
            <span className="text-[9px] text-zinc-500 dark:text-zinc-400">{nextEvent.date.slice(5)}</span>
          </div>
        )}
      </div>
      {(hasDerived || hasOutlook) && (
        <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
          {nextA ? (
            <>
              Counting down to <span className="font-medium">{nextA.name}</span> ({nextA.date}): build blocks first, then a
              peak (race-specific sharpening), then a taper ending on race week. It refreshes when you generate a block.
            </>
          ) : hasOutlook ? (
            <>If you kept going from today, roughly this — not a promise, recomputed fresh every time you generate a block.</>
          ) : (
            "Auto-drafted from your objective, events, fitness/load, and current limiter. It refreshes when you generate a block."
          )}
        </p>
      )}
    </section>
  );
}
