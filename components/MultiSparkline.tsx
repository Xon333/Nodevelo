"use client";

import { useState } from "react";

export interface MultiSeries {
  label: string;
  strokeClass: string; // line colour
  swatchClass: string; // legend swatch background
  textClass: string; // tooltip value colour
  format: (v: number) => string;
  points: { date: string; value: number }[];
}

// Overlays several metrics on one shared date axis. Each series is normalised to
// its OWN min/max (so e.g. kcal and kg can share the chart), drawn as a line in its
// own colour. Hover anywhere reveals a guide and every series' value for that date.
export default function MultiSparkline({ series, chartHeight = 64 }: { series: MultiSeries[]; chartHeight?: number }) {
  const [hi, setHi] = useState<number | null>(null);

  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  if (dates.length < 2) return null;
  const xIndexOf = new Map(dates.map((d, i) => [d, i]));

  const W = 340;
  const H = chartHeight;
  const PAD = 6;
  const xAt = (i: number) => (i / (dates.length - 1)) * W;
  const yAt = (v: number, min: number, range: number) => PAD + (1 - (v - min) / range) * (H - PAD * 2);

  const paths = series.map((s) => {
    const vals = s.points.map((p) => p.value);
    if (vals.length < 2) return { s, d: "" };
    const min = Math.min(...vals);
    const range = Math.max(...vals) - min || 1;
    const sorted = [...s.points].sort((a, b) => a.date.localeCompare(b.date));
    const d = sorted
      .map((p, i) => `${i ? "L" : "M"}${xAt(xIndexOf.get(p.date) ?? 0).toFixed(1)},${yAt(p.value, min, range).toFixed(1)}`)
      .join(" ");
    return { s, d };
  });

  const hoverDate = hi !== null ? dates[hi] : null;
  const hoverPct = hi !== null ? (hi / (dates.length - 1)) * 100 : 0;
  const tipPct = Math.min(88, Math.max(12, hoverPct));

  const valueOn = (s: MultiSeries, date: string) => s.points.find((p) => p.date === date)?.value ?? null;

  return (
    <div className="relative">
      {/* legend */}
      <div className="mb-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {series.map((s) => {
          const last = [...s.points].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
          return (
            <span key={s.label} className="flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
              <span className={`h-1.5 w-3 rounded-full ${s.swatchClass}`} />
              {s.label}
              {last && <span className="font-mono text-zinc-700 dark:text-zinc-300">{s.format(last.value)}</span>}
            </span>
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
          <line x1={xAt(hi)} y1={0} x2={xAt(hi)} y2={H} strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" className="stroke-zinc-300 dark:stroke-zinc-600" />
        )}
        {paths.map(({ s, d }) =>
          d ? <path key={s.label} d={d} fill="none" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className={s.strokeClass} /> : null
        )}
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

      {hoverDate && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full rounded border border-zinc-200 bg-white px-2 py-1 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          style={{ left: `${tipPct}%` }}
        >
          <p className="mb-0.5 text-center font-mono text-[9px] text-zinc-400 dark:text-zinc-500">{hoverDate}</p>
          {series.map((s) => {
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
