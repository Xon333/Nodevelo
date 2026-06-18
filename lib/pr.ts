// Power-PR detection: did THIS ride set a new best for a standard duration? Compared against
// the 84-day power curve as it stood BEFORE this ride was synced, so a fresh best registers
// once (the curve absorbs it on sync, after which it's no longer "new"). Pure + deterministic.

import type { PowerCurvePoint, PowerPR } from "./types";

// Standard PR durations (seconds): 5s/15s/30s neuromuscular-anaerobic, 1m, 5m VO2, 20m threshold.
export const PR_DURATIONS = [5, 15, 30, 60, 300, 1200];

// Best average power over any window of `win` samples. Assumes a 1 Hz stream (Intervals.icu
// standard), so a window of N samples ≈ N seconds. O(n) via a sliding sum.
export function meanMax(stream: number[], win: number): number | null {
  if (win <= 0 || stream.length < win) return null;
  let sum = 0;
  for (let i = 0; i < win; i++) sum += stream[i] || 0;
  let best = sum;
  for (let i = win; i < stream.length; i++) {
    sum += (stream[i] || 0) - (stream[i - win] || 0);
    if (sum > best) best = sum;
  }
  return best / win;
}

// PRs this ride set vs the prior power curve. Empty when there's no prior baseline (first sync)
// or no power stream. A PR for a duration = today's mean-max beats the previous best for it.
export function detectPowerPRs(
  stream: number[],
  prevCurve: PowerCurvePoint[],
  durations: number[] = PR_DURATIONS
): PowerPR[] {
  if (stream.length < 2 || prevCurve.length === 0) return [];
  const prev = new Map(prevCurve.map((p) => [p.durationSec, p.watts]));
  const prs: PowerPR[] = [];
  for (const d of durations) {
    const prevWatts = prev.get(d);
    if (prevWatts == null || prevWatts <= 0) continue; // need a real baseline to beat
    const mm = meanMax(stream, d);
    if (mm == null) continue; // ride shorter than this duration
    const watts = Math.round(mm);
    if (watts > prevWatts) prs.push({ durationSec: d, watts, prevWatts });
  }
  return prs;
}

// "5s" / "30s" / "1 min" / "5 min" / "20 min" — for the trophy label.
export function prDurationLabel(sec: number): string {
  return sec < 60 ? `${sec}s` : `${sec / 60} min`;
}
