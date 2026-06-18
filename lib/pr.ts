// Power-PR detection: did the latest sync push the rolling power curve to a new best for a
// standard duration? Compares the freshly-synced curve against the curve as it stood on the
// PREVIOUS sync. Both sides are Intervals.icu's own curve math, so a rise is a genuine new best
// (the only new data since last sync is the latest ride) and the delta is the true watts gained.
//
// Why not mean-max the ride's power stream? That mixes two computations — a stream mean-max sits
// ~1W above Intervals' curve value for the same effort, which manufactured fake "+1W PRs" on every
// duration. Comparing curve-to-curve keeps the units honest. Pure + deterministic.

import type { PowerCurvePoint, PowerPR } from "./types";

// Standard PR durations (seconds): 5s/15s/30s neuromuscular-anaerobic, 1m, 5m VO2, 20m threshold.
export const PR_DURATIONS = [5, 15, 30, 60, 300, 1200];

// PRs the latest sync established: a duration whose freshly-synced curve value beats the previous
// sync's. Empty when either curve is missing (first sync — no baseline to beat).
export function detectPowerPRs(
  currentCurve: PowerCurvePoint[],
  prevCurve: PowerCurvePoint[],
  durations: number[] = PR_DURATIONS
): PowerPR[] {
  if (currentCurve.length === 0 || prevCurve.length === 0) return [];
  const prev = new Map(prevCurve.map((p) => [p.durationSec, p.watts]));
  const cur = new Map(currentCurve.map((p) => [p.durationSec, p.watts]));
  const prs: PowerPR[] = [];
  for (const d of durations) {
    const prevWatts = prev.get(d);
    const watts = cur.get(d);
    if (prevWatts == null || prevWatts <= 0 || watts == null) continue; // need a real baseline to beat
    if (watts > prevWatts) prs.push({ durationSec: d, watts, prevWatts });
  }
  return prs;
}

// "5s" / "30s" / "1 min" / "5 min" / "20 min" — for the trophy label.
export function prDurationLabel(sec: number): string {
  return sec < 60 ? `${sec}s` : `${sec / 60} min`;
}
