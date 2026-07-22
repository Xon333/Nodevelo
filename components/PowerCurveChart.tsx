"use client";

import { useRef, useState } from "react";
import type { PowerCurvePoint } from "@/lib/types";

// Power-duration curve as a small SVG line chart (log-x, watts on y). Hand-rolled to match the app's other
// charts (Sparkline) — no charting dep. Durations span 5s…60min, so x is log-scaled or the short efforts
// bunch up against the axis. y is 0-based so the magnitude reads honestly. Drag (or hover) anywhere on the
// plot to scrub a crosshair to the nearest duration and read off its watts + W/kg (FB-2026-06-30).

const LABELS: Record<number, string> = {
  5: "5s", 15: "15s", 30: "30s", 60: "1m", 120: "2m", 300: "5m", 1200: "20m", 1800: "30m", 3600: "60m",
};
const LABELLED = new Set([5, 60, 300, 1200, 3600]); // keep the x-axis uncluttered

// Pure geometry: map the curve to plot-area coords [0..1] (x log-scaled by duration, y 0-based by watts).
// Exported for testing; the component just positions these in the SVG. Returns [] for <2 points.
export function scalePowerCurve(points: PowerCurvePoint[]): Array<{ durationSec: number; watts: number; x: number; y: number }> {
  const pts = [...points].filter((p) => p.durationSec > 0 && p.watts > 0).sort((a, b) => a.durationSec - b.durationSec);
  if (pts.length < 2) return [];
  const lmin = Math.log(pts[0].durationSec);
  const lmax = Math.log(pts[pts.length - 1].durationSec);
  const maxW = Math.max(...pts.map((p) => p.watts));
  return pts.map((p) => ({
    durationSec: p.durationSec,
    watts: p.watts,
    x: lmax > lmin ? (Math.log(p.durationSec) - lmin) / (lmax - lmin) : 0,
    y: 1 - p.watts / maxW, // 0 = top (max watts), 1 = baseline
  }));
}

export default function PowerCurveChart({ points, weightKg }: { points: PowerCurvePoint[]; weightKg?: number | null }) {
  const scaled = scalePowerCurve(points);
  const [active, setActive] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  if (scaled.length < 2) return null;

  // Compact (FB-2026-06-30): shorter than before so the curve + PR grid sit in half the row beside the
  // rider profile. `w-full` still scales it to the (now half-width) column.
  const W = 320, H = 128, PAD_L = 30, PAD_R = 8, PAD_T = 14, PAD_B = 18;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const px = (x: number) => PAD_L + x * plotW;
  const py = (y: number) => PAD_T + y * plotH;
  const maxW = Math.max(...scaled.map((s) => s.watts));

  const line = scaled.map((s, i) => `${i === 0 ? "M" : "L"} ${px(s.x).toFixed(1)},${py(s.y).toFixed(1)}`).join(" ");
  const area = `${line} L ${px(scaled[scaled.length - 1].x).toFixed(1)},${(PAD_T + plotH).toFixed(1)} L ${px(scaled[0].x).toFixed(1)},${(PAD_T + plotH).toFixed(1)} Z`;

  // Map a client pointer x → the nearest plotted curve point (drag-scrub readout). The SVG scales via
  // viewBox, so convert client px to viewBox units off the rendered width before snapping.
  const scrub = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const xView = ((clientX - rect.left) / rect.width) * W;
    let best = 0, bestD = Infinity;
    scaled.forEach((s, i) => {
      const d = Math.abs(px(s.x) - xView);
      if (d < bestD) { bestD = d; best = i; }
    });
    setActive(best);
  };

  const act = active != null ? scaled[active] : null;
  const wkg = act && weightKg ? (act.watts / weightKg).toFixed(1) : null;
  const actLabel = act ? (LABELS[act.durationSec] ?? `${act.durationSec}s`) : "";
  // Readout box, clamped so it never clips the plot edges.
  const boxW = 92;
  const boxX = act ? Math.max(PAD_L, Math.min(px(act.x) - boxW / 2, W - PAD_R - boxW)) : 0;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full cursor-crosshair touch-none select-none"
      role="img"
      aria-label="Power-duration curve — drag along it to read off any duration"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e.clientX); }}
      onPointerMove={(e) => scrub(e.clientX)}
      onPointerLeave={() => setActive(null)}
    >
      {/* y-axis: max-watts top, 0 baseline */}
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + plotH} className="stroke-zinc-200 dark:stroke-zinc-700" strokeWidth={1} />
      <line x1={PAD_L} y1={PAD_T + plotH} x2={W - PAD_R} y2={PAD_T + plotH} className="stroke-zinc-200 dark:stroke-zinc-700" strokeWidth={1} />
      <text x={PAD_L - 4} y={PAD_T + 4} textAnchor="end" className="fill-zinc-500 dark:fill-zinc-400 text-[8px]">{maxW}W</text>
      <text x={PAD_L - 4} y={PAD_T + plotH} textAnchor="end" className="fill-zinc-500 dark:fill-zinc-400 text-[8px]">0</text>

      <path d={area} className="fill-cyan-500/10 dark:fill-[#00d4ff]/10" stroke="none" />
      <path d={line} fill="none" strokeWidth={1.5} strokeLinejoin="round" className="stroke-cyan-600 dark:stroke-[#00d4ff]" />

      {scaled.map((s) => (
        <g key={s.durationSec}>
          <circle cx={px(s.x)} cy={py(s.y)} r={2} className="fill-cyan-600 dark:fill-[#00d4ff]" />
          {LABELLED.has(s.durationSec) && (
            <text x={px(s.x)} y={H - 5} textAnchor="middle" className="fill-zinc-500 dark:fill-zinc-400 text-[8px]">
              {LABELS[s.durationSec] ?? `${s.durationSec}s`}
            </text>
          )}
        </g>
      ))}

      {/* Scrub crosshair + readout — the drag interaction's output. */}
      {act && (
        <g pointerEvents="none">
          <line
            x1={px(act.x)} y1={PAD_T} x2={px(act.x)} y2={PAD_T + plotH}
            className="stroke-cyan-500/50 dark:stroke-[#00d4ff]/60" strokeWidth={1} strokeDasharray="2 2"
          />
          <circle cx={px(act.x)} cy={py(act.y)} r={3.5} className="fill-cyan-600 stroke-white dark:fill-[#00d4ff] dark:stroke-zinc-900" strokeWidth={1} />
          <rect
            x={boxX} y={2} width={boxW} height={wkg ? 20 : 12} rx={2}
            className="fill-white/95 stroke-zinc-200 dark:fill-zinc-900/95 dark:stroke-zinc-700" strokeWidth={0.5}
          />
          <text x={boxX + boxW / 2} y={wkg ? 9.5 : 9} textAnchor="middle" className="fill-zinc-700 text-[7px] font-semibold dark:fill-zinc-100">
            {actLabel} · {act.watts}W
          </text>
          {wkg && (
            <text x={boxX + boxW / 2} y={17.5} textAnchor="middle" className="fill-zinc-500 text-[7px] dark:fill-zinc-400">
              {wkg} W/kg
            </text>
          )}
        </g>
      )}
    </svg>
  );
}
