"use client";

import { useState } from "react";

export interface MultiSeries {
  label: string;
  strokeClass: string; // line colour
  fillClass: string; // area fill colour (used when isolated)
  swatchClass: string; // legend swatch background
  textClass: string; // value colour
  format: (v: number) => string;
  points: { date: string; value: number }[];
}

// Overlays several metrics on one shared date axis. Each series is normalised to
// its OWN min/max (so e.g. kcal and kg can share the chart). Click a legend entry
// to show/hide that metric; isolating one renders it as a filled area for the
// clearest read of a single trend. Hover reveals every visible value for a date.
export default function MultiSparkline({ series, chartHeight = 104 }: { series: MultiSeries[]; chartHeight?: number }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hi, setHi] = useState<number | null>(null);

  const toggle = (label: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  // x-domain spans all series so toggling lines doesn't shift the axis.
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  if (dates.length < 2) return null;
  const xIndexOf = new Map(dates.map((d, i) => [d, i]));

  const W = 360;
  const H = chartHeight;
  const PAD = 8;
  const xAt = (i: number) => (i / (dates.length - 1)) * W;
  const yAt = (v: number, min: number, range: number) => PAD + (1 - (v - min) / range) * (H - PAD * 2);

  const visible = series.filter((s) => !hidden.has(s.label) && s.points.length >= 2);
  const isolated = visible.length === 1;

  const built = visible.map((s) => {
    const vals = s.points.map((p) => p.value);
    const min = Math.min(...vals);
    const range = Math.max(...vals) - min || 1;
    const pts = [...s.points]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => ({ x: xAt(xIndexOf.get(p.date) ?? 0), y: yAt(p.value, min, range) }));
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z`;
    return { s, line, area };
  });

  const trendArrow = (s: MultiSeries) => {
    const v = [...s.points].sort((a, b) => a.date.localeCompare(b.date)).map((p) => p.value);
    if (v.length < 4) return "→";
    const mid = Math.floor(v.length / 2);
    const a = v.slice(0, mid).reduce((x, y) => x + y, 0) / mid;
    const b = v.slice(mid).reduce((x, y) => x + y, 0) / (v.length - mid);
    const eps = Math.max(Math.abs(a) * 0.02, 1e-6);
    return b - a > eps ? "↑" : b - a < -eps ? "↓" : "→";
  };

  const hoverDate = hi !== null ? dates[hi] : null;
  const hoverPct = hi !== null ? (hi / (dates.length - 1)) * 100 : 0;
  const tipPct = Math.min(86, Math.max(14, hoverPct));
  const valueOn = (s: MultiSeries, date: string) => s.points.find((p) => p.date === date)?.value ?? null;

  return (
    <div className="relative">
      {/* legend — click to toggle */}
      <div className="mb-2 flex flex-wrap gap-x-2 gap-y-1.5">
        {series.map((s) => {
          const off = hidden.has(s.label);
          const last = [...s.points].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
          return (
            <button
              key={s.label}
              onClick={() => toggle(s.label)}
              aria-pressed={!off}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                off
                  ? "border-zinc-200 text-zinc-400 dark:border-zinc-700 dark:text-zinc-600"
                  : "border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${s.swatchClass} ${off ? "opacity-30" : ""}`} />
              <span className={off ? "line-through" : ""}>{s.label}</span>
              {last && !off && (
                <>
                  <span className={`font-mono font-semibold ${s.textClass}`}>{s.format(last.value)}</span>
                  <span className={s.textClass}>{trendArrow(s)}</span>
                </>
              )}
            </button>
          );
        })}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full touch-none"
        style={{ height: H }}
        onMouseLeave={() => setHi(null)}
      >
        {hi !== null && (
          <line x1={xAt(hi)} y1={0} x2={xAt(hi)} y2={H} strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" className="stroke-zinc-300 dark:stroke-zinc-600" />
        )}
        {isolated &&
          built.map(({ s, area }) => <path key={`a-${s.label}`} d={area} className={s.fillClass} fillOpacity={0.12} stroke="none" />)}
        {built.map(({ s, line }) => (
          <path key={s.label} d={line} fill="none" strokeWidth={isolated ? 2.25 : 2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" className={s.strokeClass} />
        ))}
        {dates.map((_, i) => (
          <rect
            key={i}
            x={xAt(i) - W / dates.length / 2}
            y={0}
            width={W / dates.length}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHi(i)}
            onPointerDown={() => setHi(i)}
          />
        ))}
      </svg>

      {visible.length === 0 && (
        <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
          All metrics hidden — tap one above to show it.
        </p>
      )}

      {hoverDate && visible.length > 0 && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full rounded border border-zinc-200 bg-white px-2 py-1 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          style={{ left: `${tipPct}%` }}
        >
          <p className="mb-0.5 text-center font-mono text-[9px] text-zinc-400 dark:text-zinc-500">{hoverDate}</p>
          {visible.map((s) => {
            const v = valueOn(s, hoverDate);
            return (
              <p key={s.label} className="flex items-center justify-between gap-2 whitespace-nowrap text-[10px]">
                <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
                  <span className={`h-1.5 w-1.5 rounded-full ${s.swatchClass}`} />
                  {s.label}
                </span>
                <span className={`font-mono font-semibold ${s.textClass}`}>{v === null ? "—" : s.format(v)}</span>
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
