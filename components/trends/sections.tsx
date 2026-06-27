// Self-contained Trends sections + helpers, lifted out of the old 508-line Trends.tsx (RV-8). Each is
// a pure presentational component over the /api/trends payload, so the page itself stays a thin
// fetch-and-lay-out shell.
import type { RollingBaselines, WorkoutType } from "@/lib/types";
import { TYPE_STYLES } from "@/lib/workout-types";
import { CyberFrame } from "../ui";
import type { Point, ScoreEntry, TrendBlock, TrendsData } from "./types";

export function trendDir(points: Point[], higherIsBetter = true): { label: string; cls: string } {
  if (points.length < 4) return { label: "", cls: "text-zinc-500 dark:text-zinc-400" };
  const mid = Math.floor(points.length / 2);
  const a = points.slice(0, mid).reduce((s, p) => s + p.value, 0) / mid;
  const b = points.slice(mid).reduce((s, p) => s + p.value, 0) / (points.length - mid);
  const delta = b - a;
  const eps = Math.max(0.02, Math.abs(a) * 0.02);
  if (Math.abs(delta) < eps) return { label: "→ stable", cls: "text-zinc-500 dark:text-zinc-400" };
  const improving = higherIsBetter ? delta > 0 : delta < 0;
  return improving
    ? { label: delta > 0 ? "↑ improving" : "↓ improving", cls: "text-green-600 dark:text-emerald-400" }
    : { label: delta > 0 ? "↑ declining" : "↓ declining", cls: "text-red-500" };
}

export function BlockTimeline({ blocks }: { blocks: TrendBlock[] }) {
  return (
    <section className="relative rounded-none border-2 border-zinc-300 bg-white px-4 py-3 dark:border-[#00d4ff]/55 dark:bg-zinc-900 dark:shadow-[0_0_28px_-8px_rgba(0,212,255,0.45)]">
      <CyberFrame accent="cyan" />
      <div className="relative z-10">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Block history</h2>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        How each block executed and what it changed — the long view your coach reasons from.
      </p>
      {blocks.length === 0 ? (
        <p className="mt-4 rounded-md bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          No completed blocks yet. Wrap up a block on the dashboard to start building history.
        </p>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {blocks.map((b, i) => (
            <li key={i} className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{b.goal}</span>
                  <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                    {b.lengthWeeks}w
                  </span>
                </div>
                {b.ctlGain != null && (
                  <span
                    className={`font-mono text-xs font-semibold ${
                      b.ctlGain > 0 ? "text-green-600 dark:text-emerald-400" : b.ctlGain < 0 ? "text-red-500" : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    CTL {b.ctlGain > 0 ? "+" : ""}{b.ctlGain}
                  </span>
                )}
              </div>
              <p className="mt-0.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                {b.startDate} → {b.endDate}
                {b.actualHours != null && b.plannedHours != null && ` · ${b.actualHours}/${b.plannedHours}h`}
              </p>
              {b.complianceByType && Object.keys(b.complianceByType).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(b.complianceByType).map(([type, pct]) => (
                    <span
                      key={type}
                      className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[10px] dark:bg-zinc-800"
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${TYPE_STYLES[type as WorkoutType]?.cell ?? "bg-zinc-400"}`} />
                      <span className="text-zinc-500 dark:text-zinc-400">{type}</span>
                      <span
                        className={`font-mono font-semibold ${
                          (pct ?? 0) >= 90 ? "text-green-600 dark:text-green-400" : (pct ?? 0) >= 75 ? "text-amber-600 dark:text-amber-400" : "text-red-500"
                        }`}
                      >
                        {pct}%
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {b.nextBlockSeeds && b.nextBlockSeeds.length > 0 && (
                <p className="mt-1.5 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                  <span className="font-medium text-zinc-600 dark:text-zinc-300">Learned: </span>
                  {b.nextBlockSeeds.join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      </div>
    </section>
  );
}

export function ScoreBars({ scores }: { scores: ScoreEntry[] }) {
  const recent = scores.slice(-24);
  if (recent.length < 2) return null;
  const avg = Math.round((recent.reduce((s, e) => s + e.executionScore, 0) / recent.length) * 10) / 10;
  const barColor = (v: number) =>
    v >= 7 ? "bg-green-400 dark:bg-emerald-500/70" : v >= 5 ? "bg-amber-400 dark:bg-amber-500" : "bg-red-400 dark:bg-red-500";
  return (
    <div>
      {/* gap-px + min-w-[2px] so up to 24 bars stay within a narrow card without horizontal scroll
          (UX-3); hover:opacity surfaces the per-bar tooltip affordance. */}
      <div className="flex items-end gap-px" style={{ height: 56 }}>
        {recent.map((e, i) => (
          <div
            key={i}
            title={`${e.date} · ${e.plannedType ?? e.inferredType}${e.planned ? "" : " (off-plan)"} · ${e.executionScore}/10`}
            className={`min-w-[2px] flex-1 rounded-sm transition-opacity hover:opacity-70 ${barColor(e.executionScore)}`}
            style={{ height: `${(e.executionScore / 10) * 100}%` }}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
        Avg {avg}/10 over last {recent.length} matched sessions · taller = better execution
      </p>
    </div>
  );
}

// Weekly ride-hours bars — the expanded view the Today "Weekly volume" trend-pulse tile links to
// (UX-2: the tile used to push to /trends with nothing to land on).
export function WeeklyVolumeBars({ weeks }: { weeks: TrendsData["weeklyHours"] }) {
  const recent = weeks.slice(-16);
  if (recent.length < 2) return null;
  const max = Math.max(...recent.map((w) => w.hours), 1);
  const avg = Math.round((recent.reduce((s, w) => s + w.hours, 0) / recent.length) * 10) / 10;
  // Encode volume in the bar's blue shade as well as its height, so a big week reads at a glance
  // (height alone is hard to compare across 16 thin bars). Buckets are relative to the window max.
  const volColor = (h: number) => {
    const r = h / max;
    return r >= 0.85
      ? "bg-sky-700 dark:bg-[#00d4ff]"
      : r >= 0.6
      ? "bg-sky-500 dark:bg-[#00d4ff]/80"
      : r >= 0.35
      ? "bg-sky-400 dark:bg-[#00d4ff]/55"
      : "bg-sky-300 dark:bg-[#00d4ff]/30";
  };
  return (
    <div>
      <div className="flex items-end gap-px" style={{ height: 56 }}>
        {recent.map((w) => (
          <div
            key={w.date}
            title={`Week of ${w.date} · ${w.hours.toFixed(1)} h`}
            className={`min-w-[2px] flex-1 rounded-sm transition-opacity hover:opacity-70 ${volColor(w.hours)}`}
            style={{ height: `${Math.max(4, (w.hours / max) * 100)}%` }}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
        Avg {avg} h/week over last {recent.length} complete weeks · darker blue = bigger week
      </p>
    </div>
  );
}

export function baselineCards(b: RollingBaselines, wkgAtThreshold: number | null) {
  const cards: Array<{ label: string; value: string }> = [];
  // Curated to single numbers that aren't already a chart elsewhere on Trends (athlete-chosen set):
  // w/kg @ threshold · weekly hours · rides/week · avg load/ride. Avg CTL stays out (the CTL graph
  // shows it); cadence + decoupling were dropped — decoupling's story is the Pw:HR chart, cadence is
  // low decision-value. (avgDecoupling90d is still computed for the calibration cutoff; avgCadence90d
  // is now card-unused — a candidate to retire from the store later.)
  if (wkgAtThreshold != null) cards.push({ label: "w/kg @ threshold", value: wkgAtThreshold.toFixed(1) });
  if (b.avgWeeklyHours90d != null) cards.push({ label: "Weekly hours", value: `${b.avgWeeklyHours90d.toFixed(1)} h` });
  if (b.ridesPerWeek90d != null) cards.push({ label: "Rides / week", value: b.ridesPerWeek90d.toFixed(1) });
  if (b.avgTss90d != null) cards.push({ label: "Avg load / ride", value: String(Math.round(b.avgTss90d)) });
  return cards;
}
