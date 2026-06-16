"use client";

import { useState } from "react";

export interface SparkPoint {
  date: string;
  value: number;
}

// Interactive sparkline with an in-SVG hover tooltip (date + value). The tooltip
// lives inside the SVG so it stays aligned under any responsive scaling, and the
// invisible hit-columns make every point easy to hover or tap.
export default function Sparkline({
  points,
  chartHeight = 46,
  format = (v: number) => v.toFixed(2),
  strokeClass = "stroke-blue-400 dark:stroke-[#ff49c8]/70",
  dotClass = "fill-blue-500 dark:fill-[#ff49c8]",
  tipTextClass = "fill-zinc-800 dark:fill-[#ff49c8]",
  // Hover guide-line + tooltip border. Defaults to the pink accent; pass the chart's own
  // accent (e.g. cyan for CTL) so the border matches the tooltip text instead of clashing.
  tipAccentClass = "stroke-zinc-300 dark:stroke-[#ff49c8]/35",
}: {
  points: SparkPoint[];
  chartHeight?: number;
  format?: (v: number) => string;
  strokeClass?: string;
  dotClass?: string;
  tipTextClass?: string;
  tipAccentClass?: string;
}) {
  const [idx, setIdx] = useState<number | null>(null);
  if (points.length < 2) return null;

  const W = 340;
  const H = chartHeight;
  const TIP = 26;
  const PAD = 5;
  const TOTAL = H + TIP;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const toX = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const toY = (v: number) => TIP + PAD + (1 - (v - min) / range) * (H - PAD * 2);
  const d = points.map((p, i) => `${i ? "L" : "M"}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`).join(" ");

  const hp = idx !== null ? points[idx] : null;
  const hx = idx !== null ? toX(idx) : 0;
  const TIP_W = 94;
  const tipX = hp ? Math.max(0, Math.min(hx - TIP_W / 2, W - TIP_W)) : 0;
  const colW = (W - PAD * 2) / points.length;

  return (
    <svg
      viewBox={`0 0 ${W} ${TOTAL}`}
      className="w-full touch-none"
      style={{ height: TOTAL }}
      onMouseLeave={() => setIdx(null)}
    >
      <path d={d} fill="none" strokeWidth="1.5" strokeLinejoin="round" className={strokeClass} />

      {!hp && <circle cx={toX(points.length - 1)} cy={toY(vals[vals.length - 1])} r={3} className={dotClass} />}

      {hp && (
        <g style={{ pointerEvents: "none" }}>
          <line
            x1={hx}
            y1={TIP}
            x2={hx}
            y2={TOTAL - PAD}
            strokeWidth={1}
            strokeDasharray="2 2"
            className={tipAccentClass}
          />
          <circle cx={hx} cy={toY(hp.value)} r={4} className={dotClass} />
          <rect x={tipX} y={1} width={TIP_W} height={TIP - 5} rx={3} className="fill-zinc-100 dark:fill-zinc-900" fillOpacity={0.97} />
          <rect x={tipX} y={1} width={TIP_W} height={TIP - 5} rx={3} fill="none" strokeWidth={0.5} className={tipAccentClass} />
          <text x={tipX + TIP_W / 2} y={10} textAnchor="middle" fontSize={9} fontWeight="600" fontFamily="monospace" className={tipTextClass}>
            {format(hp.value)}
          </text>
          <text x={tipX + TIP_W / 2} y={18.5} textAnchor="middle" fontSize={7.5} fontFamily="monospace" className="fill-zinc-500 dark:fill-zinc-400">
            {hp.date}
          </text>
        </g>
      )}

      {points.map((p, i) => (
        <rect
          key={i}
          x={toX(i) - colW / 2}
          y={TIP}
          width={colW}
          height={H}
          fill="transparent"
          className="cursor-crosshair"
          onMouseEnter={() => setIdx(i)}
          onPointerDown={() => setIdx(i)}
        />
      ))}
    </svg>
  );
}
