"use client";

import { InfoDot } from "../ui";

// The block-generation form on the Plan page. Presentational: PlanView owns the generator state and
// handlers and threads them in. Extracted from the old 529-line Dashboard monolith (RV-8) — it was the
// largest, most tangled inline chunk. When a block is already active it collapses to a thin bar so it
// stops cutting the page in half; it expands on demand (and is always open when there's no block).
export interface BlockGeneratorProps {
  hasActiveBlock: boolean;
  genOpen: boolean;
  setGenOpen: (open: boolean) => void;
  lengthWeeks: 2 | 4 | 6 | 8;
  setLengthWeeks: (w: 2 | 4 | 6 | 8) => void;
  startDate: string;
  setStartDate: (d: string) => void;
  goal: string;
  setGoal: (g: string) => void;
  weakpointsText: string;
  setWeakpointsText: (w: string) => void;
  generating: boolean;
  generate: () => void;
  generateError: string | null;
  elapsed: number;
  anthropicConfigured: boolean;
  showSyncTip: boolean; // no cached sync yet but Intervals is configured → nudge to sync first
  seasonReadout: string | null;
  focusLabel: string | null; // current season phase this block targets (display label), or null (no season)
  goalCount: number; // how many profile goals are being pulled into this focus
}

export default function BlockGenerator({
  hasActiveBlock,
  genOpen,
  setGenOpen,
  lengthWeeks,
  setLengthWeeks,
  startDate,
  setStartDate,
  goal,
  setGoal,
  weakpointsText,
  setWeakpointsText,
  generating,
  generate,
  generateError,
  elapsed,
  anthropicConfigured,
  showSyncTip,
  seasonReadout,
  focusLabel,
  goalCount,
}: BlockGeneratorProps) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
      {hasActiveBlock && !genOpen ? (
        <button
          onClick={() => setGenOpen(true)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Generate next block</span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Plan the next 2–4 weeks →</span>
        </button>
      ) : (
        <>
          {hasActiveBlock && (
            <div className="mb-3 flex justify-end">
              <button
                onClick={() => setGenOpen(false)}
                className="text-xs text-zinc-500 dark:text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                Collapse
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={generate}
              disabled={generating || !anthropicConfigured}
              className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:border dark:border-[#ff49c8]/50 dark:bg-transparent dark:text-[#ff49c8] dark:hover:bg-[#ff49c8]/10 dark:disabled:border-zinc-600 dark:disabled:text-zinc-500 dark:disabled:bg-transparent"
            >
              {generating
                ? `Generating… ${elapsed}s`
                : hasActiveBlock
                  ? "Generate Next Block"
                  : "Generate New Block"}
            </button>
            {/* S1-4: coach-voice message, not a raw env-var name — the setup detail moves to the tip. */}
            {!anthropicConfigured && (
              <p className="flex items-center gap-1 text-xs text-red-600">
                Connect the AI coach to generate blocks.
                <InfoDot text="Set ANTHROPIC_API_KEY in the server's environment config, then restart." />
              </p>
            )}
            {showSyncTip && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Tip: sync first so the plan reflects your recent training.
              </p>
            )}
          </div>
          {/* S2-8: the current block is untouched by clicking Generate — it only opens a preview
              you review below, and nothing replaces the active block until you explicitly write it. */}
          {hasActiveBlock && (
            <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              Opens a preview to review — your current block stays active until you choose to write the new one.
            </p>
          )}
          {generateError && (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
              {generateError}
            </p>
          )}

          {seasonReadout && (
            <p className="mt-3 rounded bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              {seasonReadout}
            </p>
          )}
          {focusLabel && (
            <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span>Targeting</span>
              <span className="rounded-full bg-[#ff49c8]/10 px-2 py-0.5 font-medium text-[#b8348f] dark:text-[#ff49c8]">{focusLabel}</span>
              {goalCount > 0 && <span>· pulling {goalCount} goal{goalCount === 1 ? "" : "s"} from your profile</span>}
              <a href="/profile" className="text-cyan-700 hover:underline dark:text-[#00d4ff]">edit profile →</a>
            </p>
          )}
          <div className="mt-4 grid gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-2 xl:grid-cols-4 dark:border-zinc-700">
            <div>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Block length</label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {([2, 4, 6, 8] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => setLengthWeeks(w)}
                    className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                      lengthWeeks === w
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-[#ff49c8]/60 dark:bg-[#ff49c8]/10 dark:text-[#ff49c8]"
                        : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-500"
                    }`}
                  >
                    {w} weeks
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="start-date" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Start date
              </label>
              <input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:focus:border-zinc-400"
              />
            </div>
            <div>
              <label htmlFor="goal" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Block goal (one per line)
              </label>
              <textarea
                id="goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={2}
                placeholder="from profile; edit to override"
                className="mt-1.5 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:placeholder-zinc-500 dark:focus:border-zinc-400"
              />
            </div>
            <div>
              <label htmlFor="weakpoints" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Weakpoints to target (one per line)
              </label>
              <textarea
                id="weakpoints"
                value={weakpointsText}
                onChange={(e) => setWeakpointsText(e.target.value)}
                rows={2}
                placeholder="from profile; edit to override"
                className="mt-1.5 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:placeholder-zinc-500 dark:focus:border-zinc-400"
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
