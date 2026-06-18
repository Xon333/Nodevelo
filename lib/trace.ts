// Build the downsampled streams + executed-interval bands that drive the ride
// power-trace chart. Downsampling keeps the stored analysis small (~240 points) while
// preserving the shape; bands mark where the athlete's WORK intervals fell.

import type { ExecutedInterval, RideTrace } from "./types";

// Centred rolling mean — smooths the per-second power stream so the trace reads as a clean
// ~30s-average line (what a head unit shows) instead of a spiky raw signal. Centred (not
// trailing) so peaks don't visually shift. Assumes a 1 Hz stream (Intervals.icu standard).
function smooth(arr: number[], window: number): number[] {
  if (window <= 1 || arr.length < window) return arr;
  const half = Math.floor(window / 2);
  const out = new Array<number>(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      const v = arr[j];
      if (Number.isFinite(v)) {
        sum += v;
        n += 1;
      }
    }
    out[i] = n > 0 ? sum / n : 0;
  }
  return out;
}

function downsample(arr: number[], target: number): number[] {
  if (arr.length <= target) return arr.map((v) => (Number.isFinite(v) ? Math.round(v) : 0));
  const out: number[] = [];
  const bucket = arr.length / target;
  for (let i = 0; i < target; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.floor((i + 1) * bucket);
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j++) {
      const v = arr[j];
      if (Number.isFinite(v)) {
        sum += v;
        n += 1;
      }
    }
    out.push(n > 0 ? Math.round(sum / n) : 0);
  }
  return out;
}

export function buildRideTrace(
  power: number[],
  hr: number[],
  executed: ExecutedInterval[],
  targetWatts: number | null,
  points = 240
): RideTrace | null {
  if (power.length < 2) return null;
  const len = power.length;
  // 30 s smoothing before downsampling tames the spiky raw signal (UI-5).
  const dsPower = downsample(smooth(power, 30), points);
  const pts = dsPower.length;
  // Map raw sample indices into the SAME coordinate space the power line is drawn in: the chart
  // plots point i at x = i/(pts-1), so a raw index must scale by pts/((pts-1)·len), not 1/len —
  // otherwise the work bands sit ~1px left of the line (worse toward the ride's end).
  const scale = pts > 1 ? pts / ((pts - 1) * len) : 1 / len;
  const bands = executed
    .filter((e) => e.type === "WORK" && e.startIndex !== null && e.endIndex !== null)
    .map((e) => ({ start: (e.startIndex as number) * scale, end: (e.endIndex as number) * scale }))
    .filter((b) => b.end > b.start && b.start >= 0 && b.start < 1)
    .map((b) => ({ start: b.start, end: Math.min(1, b.end) }));
  return {
    power: dsPower,
    hr: hr.length >= 2 ? downsample(hr, points) : [],
    bands,
    targetWatts,
  };
}
