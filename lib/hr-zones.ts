// Re-bucket a heart-rate sample stream into the athlete's own HR zones (from
// athlete_profile.md), rather than relying on Intervals.icu's pre-bucketed
// icu_hr_zone_times — whose zone boundaries can differ from the athlete's.

export interface HrZone {
  name: string;
  lo: number; // inclusive lower bound (bpm)
  hi: number | null; // exclusive upper bound; null = open (top zone)
}

// Counts samples per zone (≈seconds at 1 Hz). The result is used as a distribution,
// so the exact sampling rate doesn't matter as long as it's uniform. Zones are
// expected ordered low→high and contiguous; the first matching zone wins.
export function bucketHrZones(hr: number[], zones: HrZone[]): number[] {
  const times = new Array(zones.length).fill(0);
  for (const v of hr) {
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
