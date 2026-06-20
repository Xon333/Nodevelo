// Shared presentational primitives + style maps used across the Today and Plan dashboard views.
import type { AcwrResult, ReadinessSignal } from "@/lib/types";

// ---------- Readiness / ACWR colour maps ----------

export const READINESS_STYLES: Record<ReadinessSignal["level"], string> = {
  Build:   "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
  Hold:    "bg-amber-50  text-amber-800  border-amber-200  dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
  Recover: "bg-red-50    text-red-800    border-red-200    dark:bg-red-950/60   dark:text-red-300   dark:border-red-800",
};

export const ACWR_COLOR: Record<AcwrResult["level"], string> = {
  low: "text-zinc-400 dark:text-zinc-500",
  optimal: "text-green-600 dark:text-green-400",
  high: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
};

// One-line explanation shown on hover over an alert/readiness bracket. `align` flips the
// tooltip to the right edge so it doesn't clip when the anchor sits near the card's right.
export function MetricTip({ text, align = "left" }: { text: string; align?: "left" | "right" }) {
  return (
    <span
      className={`pointer-events-none absolute ${
        align === "right" ? "right-0" : "left-0"
      } top-full z-30 mt-1 w-64 max-w-[80vw] rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug text-zinc-600 opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300`}
    >
      {text}
    </span>
  );
}

// ---------- Zone distribution mini-bars ----------

export function ZoneBars({ times, label, secondary }: { times: number[]; label: string; secondary?: boolean }) {
  const total = times.reduce((s, t) => s + t, 0);
  if (total === 0) return null;
  const pcts = times.map((t) => Math.round((t / total) * 100));
  const ZONE_COLORS = [
    "bg-blue-300 dark:bg-blue-700",
    "bg-green-400 dark:bg-green-600",
    "bg-yellow-400 dark:bg-yellow-500",
    "bg-orange-400 dark:bg-orange-500",
    "bg-red-400 dark:bg-red-500",
    "bg-red-600 dark:bg-red-700",
    "bg-red-900 dark:bg-red-900",
  ];
  const fmtT = (s: number) =>
    s >= 3600 ? `${Math.floor(s / 3600)}h${Math.round((s % 3600) / 60)}m` : `${Math.max(1, Math.round(s / 60))}m`;
  // Visible segments only; track first/last so the bar keeps its rounded ends without the
  // overflow-hidden that would otherwise clip each segment's hover tooltip.
  const segs = pcts.map((pct, i) => ({ pct, i })).filter((s) => s.pct >= 1);
  return (
    <div className={secondary ? "opacity-90" : undefined}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1">{label}</p>
      <div className={`flex w-full gap-px ${secondary ? "h-2" : "h-4"}`}>
        {segs.map((s, k) => (
          <div key={s.i} style={{ width: `${s.pct}%` }} className="group/zone relative min-w-0">
            <div
              className={`h-full w-full ${k === 0 ? "rounded-l" : ""} ${k === segs.length - 1 ? "rounded-r" : ""} ${ZONE_COLORS[s.i] ?? "bg-zinc-400"}`}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 -translate-x-1/2 whitespace-nowrap rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 opacity-0 shadow-md transition-opacity duration-100 group-hover/zone:opacity-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              Z{s.i + 1} · {s.pct}% · {fmtT(times[s.i])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Week-over-week trend glyph for a metric: → when flat, ↑/↓ in the direction that's "good"
// for the metric (higherIsBetter flips which way is an improvement arrow).
export function trendArrow(current: number | null, prev: number | null, higherIsBetter = true): string {
  if (current === null || prev === null) return "";
  const delta = current - prev;
  if (Math.abs(delta) < 0.5) return " →";
  return delta > 0 ? (higherIsBetter ? " ↑" : " ↓") : (higherIsBetter ? " ↓" : " ↑");
}
