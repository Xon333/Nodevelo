"use client";

import { useState } from "react";
import type { RideTrace as RideTraceData } from "@/lib/types";

// Power-trace chart: power as the primary line, the prescribed target as a dashed line,
// shaded bands where work intervals fell, and HR as a faint secondary overlay (decoupling
// shows as the gap widening). Hovering shows power/HR at that point — styled to match the
// app's other chart tooltips.
export default function RideTrace({ trace }: { trace: RideTraceData }) {
  const { power, hr, bands, targetWatts } = trace;
  const [idx, setIdx] = useState<number | null>(null);
  if (power.length < 2) return null;

  const W = 340;
  const H = 72;
  const PAD = 4;
  const maxP = Math.max(...power, targetWatts ?? 0) || 1;
  // UXA-14: this trace is the only place the ride's power/HR shape exists in the app — a screen
  // reader gets nothing without this. A summary, not full data-point parity (see the todo backlog
  // item for real keyboard scrubbing).
  const avgPower = Math.round(power.reduce((s, v) => s + v, 0) / power.length);
  const peakPower = Math.round(Math.max(...power));
  const hasHrData = hr.length === power.length && hr.some((v) => v > 0);
  const traceLabel = `Power trace over the ride: average ${avgPower} watts, peak ${peakPower} watts${
    targetWatts ? `, target ${targetWatts} watts` : ""
  }${hasHrData ? ", with heart rate overlaid" : ""}.`;
  const toX = (i: number) => (i / (power.length - 1)) * W;
  const toYp = (v: number) => PAD + (1 - v / maxP) * (H - PAD * 2);
  const powerPath = power.map((v, i) => `${i ? "L" : "M"}${toX(i).toFixed(1)},${toYp(v).toFixed(1)}`).join(" ");

  const hasHr = hr.length === power.length && hr.some((v) => v > 0);
  let hrPath = "";
  if (hasHr) {
    const valid = hr.filter((v) => v > 0);
    const lo = Math.min(...valid);
    const range = Math.max(...valid) - lo || 1;
    const toYh = (v: number) => PAD + (1 - (Math.max(v, lo) - lo) / range) * (H - PAD * 2);
    hrPath = hr.map((v, i) => `${i ? "L" : "M"}${toX(i).toFixed(1)},${toYh(v).toFixed(1)}`).join(" ");
  }

  const targetY = targetWatts ? toYp(targetWatts) : null;

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setIdx(Math.max(0, Math.min(power.length - 1, Math.round(ratio * (power.length - 1)))));
  };
  const pct = idx !== null ? (idx / (power.length - 1)) * 100 : 0;
  const tipPct = Math.min(92, Math.max(8, pct));

  return (
    <div className="relative" onMouseMove={onMove} onMouseLeave={() => setIdx(null)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        style={{ height: H }}
        preserveAspectRatio="none"
        role="img"
        aria-label={traceLabel}
      >
        {bands.map((b, i) => {
          // Short efforts (e.g. 30 s reps on a long ride) span <1% of the width — enforce a
          // minimum so they stay visible, and use a stronger fill + edge than before (UI-5).
          const rawW = (b.end - b.start) * W;
          const w = Math.max(rawW, 2.5);
          const x = Math.min(b.start * W, W - w);
          return (
            <rect
              key={i}
              x={x}
              y={0}
              width={w}
              height={H}
              // UXA-28: was amber in light mode, cyan in dark — same hue (cyan, matching the power
              // line below) in both now.
              className="fill-cyan-300/40 stroke-cyan-400/50 dark:fill-[#00d4ff]/25 dark:stroke-[#00d4ff]/40"
              strokeWidth={0.75}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {targetY !== null && (
          <line x1={0} y1={targetY} x2={W} y2={targetY} strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" className="stroke-pink-500/70 dark:stroke-[#ff49c8]/70" />
        )}
        {/* UXA-57: was stroke-zinc-400 dark:stroke-zinc-500 — the inverse of the app's own
            text-zinc-500 dark:text-zinc-400 muted convention, leaving light mode under the 3:1
            floor for a graphical object conveying real data (WCAG 1.4.11). */}
        {hrPath && <path d={hrPath} fill="none" strokeWidth={1} vectorEffect="non-scaling-stroke" className="stroke-zinc-500 dark:stroke-zinc-400" />}
        {/* UXA-28: was blue in light mode, cyan in dark — matches PowerCurveChart's own
            stroke-cyan-600 dark:stroke-[#00d4ff] convention for the same "power" concept. */}
        <path d={powerPath} fill="none" strokeWidth={1.4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="stroke-cyan-600 dark:stroke-[#00d4ff]" />
        {idx !== null && (
          <line x1={toX(idx)} y1={0} x2={toX(idx)} y2={H} strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" className="stroke-zinc-300 dark:stroke-zinc-600" />
        )}
      </svg>
      {idx !== null && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-zinc-200 bg-white px-2 py-1 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          style={{ left: `${tipPct}%` }}
        >
          <p className="font-mono text-[10px] font-semibold text-cyan-700 dark:text-[#00d4ff]">{power[idx]} W</p>
          {hasHr && <p className="font-mono text-[9px] text-zinc-500 dark:text-zinc-400">{hr[idx]} bpm</p>}
        </div>
      )}
    </div>
  );
}
