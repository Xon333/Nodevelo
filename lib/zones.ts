// Re-bucket a sample stream (power watts or heart-rate bpm) into the athlete's own
// zones from athlete_profile.md, rather than relying on Intervals.icu's pre-bucketed
// times — whose boundaries can differ, and which (for power) are often absent entirely.

export interface Zone {
  name: string;
  lo: number; // inclusive lower bound
  hi: number | null; // exclusive upper bound; null = open (top zone)
}

// The IF effort-band label — which zone the whole-ride normalized power sat in, relative to FTP. The
// boundaries come from the athlete's OWN synced power zones (Intervals.icu zone tops as %FTP) so the label
// tracks their zone definitions and any FTP/zone change, rather than a hardcoded table. Malformed/absent
// zones fall back to the population defaults below, which match the execution scorer's zone model
// (execution-score.ts: Z2 = IF 0.60–0.74, recovery < 0.60) so the label can't contradict the score.
export const DEFAULT_IF_BAND_TOPS = [0.6, 0.76, 0.91, 1.05, 1.15] as const; // recovery|endurance|tempo|threshold|VO2max|(>)anaerobic
const IF_BAND_LABELS = ["recovery", "endurance", "tempo", "threshold", "VO2max", "anaerobic"] as const;

export function ifBandLabel(intensityFactor: number, zoneTopsPct?: number[] | null): string {
  // Use the first 5 synced zone tops (Z1–Z5 %FTP ÷ 100) as boundaries when they're a sane ascending set;
  // 5 boundaries → the 6 labels above. Otherwise the defaults.
  const synced = Array.isArray(zoneTopsPct) && zoneTopsPct.length >= 5 ? zoneTopsPct.slice(0, 5).map((p) => p / 100) : null;
  const ascending = synced != null && synced.every((v, i) => v > 0 && (i === 0 || v > synced[i - 1]));
  const tops = ascending ? (synced as number[]) : [...DEFAULT_IF_BAND_TOPS];
  const idx = tops.findIndex((t) => intensityFactor < t);
  return IF_BAND_LABELS[idx === -1 ? IF_BAND_LABELS.length - 1 : idx];
}

// Counts samples per zone (≈seconds at 1 Hz). Used as a distribution, so the exact
// sampling rate doesn't matter as long as it's uniform. Zones are expected ordered
// low→high and contiguous; the first matching zone wins.
export function bucketZones(samples: number[], zones: Zone[]): number[] {
  const times = new Array(zones.length).fill(0);
  for (const v of samples) {
    if (!Number.isFinite(v) || v <= 0) continue;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (v >= z.lo && (z.hi === null || v < z.hi)) {
        times[i] += 1;
        break;
      }
    }
  }
  return times;
}
