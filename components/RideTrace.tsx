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
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none" style={{ height: H }} preserveAspectRatio="none">
        {bands.map((b, i) => (
          <rect key={i} x={b.start * W} y={0} width={(b.end - b.start) * W} height={H} className="fill-zinc-200/70 dark:fill-[#00d4ff]/12" />
        ))}
        {targetY !== null && (
          <line x1={0} y1={targetY} x2={W} y2={targetY} strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" className="stroke-pink-500/70 dark:stroke-[#ff49c8]/70" />
        )}
        {hrPath && <path d={hrPath} fill="none" strokeWidth={1} vectorEffect="non-scaling-stroke" className="stroke-zinc-400 dark:stroke-zinc-500" />}
        <path d={powerPath} fill="none" strokeWidth={1.4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="stroke-blue-500 dark:stroke-[#00d4ff]" />
        {idx !== null && (
          <line x1={toX(idx)} y1={0} x2={toX(idx)} y2={H} strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" className="stroke-zinc-300 dark:stroke-zinc-600" />
        )}
      </svg>
      {idx !== null && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-zinc-200 bg-white px-2 py-1 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          style={{ left: `${tipPct}%` }}
        >
          <p className="font-mono text-[10px] font-semibold text-blue-600 dark:text-[#00d4ff]">{power[idx]} W</p>
          {hasHr && <p className="font-mono text-[9px] text-zinc-500 dark:text-zinc-400">{hr[idx]} bpm</p>}
        </div>
      )}
    </div>
  );
}
