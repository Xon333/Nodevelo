// Per-athlete calibration — replaces a couple of the population "magic numbers" with values
// that adapt to the athlete. Hybrid by design: EWMA responsiveness is auto-derived from how
// much history exists; ACWR bands stay population-validated defaults that can be manually
// overridden (auto-deriving injury-risk bands isn't possible without injury data, so we don't
// pretend to). Pure + deterministic + defensive — every output is clamped to a sane range.

export interface AcwrBands {
  optimalLow: number; // below this = under-reaching ("low")
  optimalHigh: number; // top of the optimal progression band
  dangerHigh: number; // above this = spike ("danger")
}

// Population defaults (Gabbett acute:chronic workload sweet spot ≈ 0.8–1.3, spike > 1.5).
export const DEFAULT_ACWR_BANDS: AcwrBands = { optimalLow: 0.8, optimalHigh: 1.3, dangerHigh: 1.5 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// EWMA smoothing for the athlete model, derived from the planned-ride sample size: with little
// history, weight recent rides more (responsive); as history accumulates, smooth out noise.
// Replaces the hardcoded α = 0.35. Clamped to a sane band.
export function autoEwmaAlpha(plannedSampleSize: number): number {
  const n = Number.isFinite(plannedSampleSize) ? Math.max(0, plannedSampleSize) : 0;
  const a = n < 5 ? 0.45 : n < 12 ? 0.38 : 0.3;
  return clamp(a, 0.2, 0.6);
}

// Merge a manual override onto the population defaults, defensively: ignore non-finite values
// and enforce ordering (low < high < danger) so a bad override can't produce nonsense bands.
export function resolveAcwrBands(override?: Partial<AcwrBands> | null): AcwrBands {
  const o = override ?? {};
  const pick = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  let optimalLow = clamp(pick(o.optimalLow, DEFAULT_ACWR_BANDS.optimalLow), 0.1, 2);
  let optimalHigh = clamp(pick(o.optimalHigh, DEFAULT_ACWR_BANDS.optimalHigh), 0.2, 3);
  let dangerHigh = clamp(pick(o.dangerHigh, DEFAULT_ACWR_BANDS.dangerHigh), 0.3, 4);
  // Enforce strict ordering; nudge up if an override collapses the bands.
  if (optimalHigh <= optimalLow) optimalHigh = optimalLow + 0.1;
  if (dangerHigh <= optimalHigh) dangerHigh = optimalHigh + 0.1;
  return { optimalLow, optimalHigh, dangerHigh };
}

export function isAcwrBandsOverridden(override?: Partial<AcwrBands> | null): boolean {
  if (!override) return false;
  return (["optimalLow", "optimalHigh", "dangerHigh"] as const).some(
    (k) => typeof override[k] === "number" && Number.isFinite(override[k] as number)
  );
}
