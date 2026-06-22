// Per-athlete calibration — replaces a couple of the population "magic numbers" with values
// that adapt to the athlete. Hybrid by design: EWMA responsiveness is auto-derived from how
// much history exists; ACWR bands stay population-validated defaults that can be manually
// overridden (auto-deriving injury-risk bands isn't possible without injury data, so we don't
// pretend to). Pure + deterministic + defensive — every output is clamped to a sane range.

import type { CalibratedParameter, CalibrationStore, WorkoutType } from "./types";

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
  const optimalLow = clamp(pick(o.optimalLow, DEFAULT_ACWR_BANDS.optimalLow), 0.1, 2);
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

// ---------- TSB adaptation-window edges (ROADMAP #2, closes #1's tsbModifier sliver) ----------
// The band edges resolveTsbModifier classifies today's form against (deep fatigue / productive overload
// / balanced / fresh). Like the ACWR bands above — and UNLIKE the decoupling cutoff — these are NOT
// auto-derived: the honest per-athlete signal (where THIS athlete stops adapting to a quality stimulus
// under fatigue) is measured nowhere. Recentering on the athlete's own TSB distribution would calibrate
// to where they TRAIN, not where they ADAPT — the same "don't pretend to derive what we lack data for"
// trap the ACWR injury-band note calls out. So they stay population-validated defaults with a manual
// override, brought under the framework's resolve-with-fallback machinery (population fallback).

export interface TsbModifierEdges {
  deepFatigue: number; // tsb ≤ this → "deep fatigue"
  productiveOverload: number; // tsb ≤ this (and > deepFatigue) → "productive overload"
  balanced: number; // tsb ≤ this (and > productiveOverload) → "balanced"; above → "fresh"
}

// Population defaults — the literal edges resolveTsbModifier shipped with, so an un-overridden athlete
// is classified byte-identically.
export const DEFAULT_TSB_MODIFIER_EDGES: TsbModifierEdges = { deepFatigue: -25, productiveOverload: -10, balanced: 5 };

// Merge a manual override onto the population defaults, defensively: ignore non-finite values, clamp to
// a sane TSB range, and enforce strict ascending order (deep < productive < balanced) so a bad override
// can't invert the bands. Mirrors resolveAcwrBands.
export function resolveTsbModifierEdges(override?: Partial<TsbModifierEdges> | null): TsbModifierEdges {
  const o = override ?? {};
  const pick = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const deepFatigue = clamp(pick(o.deepFatigue, DEFAULT_TSB_MODIFIER_EDGES.deepFatigue), -60, -5);
  let productiveOverload = clamp(pick(o.productiveOverload, DEFAULT_TSB_MODIFIER_EDGES.productiveOverload), -50, 0);
  let balanced = clamp(pick(o.balanced, DEFAULT_TSB_MODIFIER_EDGES.balanced), -5, 30);
  // Enforce strict ordering; nudge up if an override (or a clamp) collapses the bands.
  if (productiveOverload <= deepFatigue) productiveOverload = deepFatigue + 1;
  if (balanced <= productiveOverload) balanced = productiveOverload + 1;
  return { deepFatigue, productiveOverload, balanced };
}

export function isTsbModifierEdgesOverridden(override?: Partial<TsbModifierEdges> | null): boolean {
  if (!override) return false;
  return (["deepFatigue", "productiveOverload", "balanced"] as const).some(
    (k) => typeof override[k] === "number" && Number.isFinite(override[k] as number)
  );
}

// ---------- Per-parameter calibration framework (ROADMAP #2) ----------
// A uniform record so every learned value carries provenance + a confidence/lock guard against
// chasing noise. The confidence layer here is the one Track D deferred into #2 — built once, shared.

// Sample-size → confidence. Conservative thresholds; variance can sharpen these later.
export function confidenceFromN(n: number): CalibratedParameter["confidence"] {
  const c = Number.isFinite(n) ? n : 0;
  return c < 8 ? "low" : c < 20 ? "medium" : "high";
}

// A blank parameter — population default in effect until enough data derives one.
export function defaultParameter(): CalibratedParameter {
  return { value: NaN, source: "default", confidence: "low", dataPoints: 0, lastUpdated: new Date(0).toISOString(), locked: false, manualOverride: null };
}

// Resolve the EFFECTIVE value the rest of the app should use. Precedence: a manual override always
// wins; otherwise a derived value only counts once it's trustworthy (locked, or ≥ medium confidence);
// below that we fall back to the caller's population default. Never returns NaN/non-finite.
export function resolveCalibratedValue(param: CalibratedParameter | undefined | null, populationDefault: number): number {
  if (param) {
    if (typeof param.manualOverride === "number" && Number.isFinite(param.manualOverride)) return param.manualOverride;
    if (param.source === "derived" && Number.isFinite(param.value) && (param.locked || param.confidence !== "low")) {
      return param.value;
    }
  }
  return populationDefault;
}

// A fresh calibration store — every parameter at its population default (resolves to the fallback).
export function emptyCalibration(): CalibrationStore {
  return { decouplingGood: defaultParameter(), updatedAt: new Date(0).toISOString() };
}

// Derive the decoupling "good" threshold from the athlete's own 90-day mean decoupling (ROADMAP #2):
// their typical decoupling becomes the +1/0 boundary, so a structurally-drifty rider isn't punished
// to the floor and a flat-TT rider is graded tightly — instead of a fixed 4%. `n` is how many rides
// in the window carried a decoupling reading (drives confidence). Preserves a prior manual override.
//
// Deliberately NOT frozen at high confidence (CR-E): the input is ALREADY a 90-day rolling mean, so
// the derived value tracks the athlete's recent physiology and must keep re-deriving every sync — a
// rider who gets fitter across a season drifts less, and a value latched in March must not govern
// December scoring. The rolling window + the sample-size confidence gate (medium+ to take effect) are
// what guard against chasing noise; a permanent lock would defeat the whole point of calibrating.
export function deriveDecouplingGood(
  prior: CalibratedParameter | undefined | null,
  avgDecoupling90d: number | null,
  n: number
): CalibratedParameter {
  const now = new Date().toISOString();
  const manualOverride = prior?.manualOverride ?? null;
  if (avgDecoupling90d === null || !Number.isFinite(avgDecoupling90d) || n <= 0) {
    // No usable signal this window. Keep a previously-derived value (refresh only the timestamp) so a
    // transient gap doesn't snap the cutoff back to the population default and jitter scoring; with no
    // prior derived value, start blank. (Adapting to new data ≠ discarding calibration on a gap.)
    if (prior?.source === "derived" && Number.isFinite(prior.value)) {
      return { ...prior, manualOverride, lastUpdated: now };
    }
    return { ...defaultParameter(), manualOverride, lastUpdated: now };
  }
  return {
    value: clamp(avgDecoupling90d, 2.5, 8), // sanity-bounded so one weird window can't produce a silly cutoff
    source: "derived",
    confidence: confidenceFromN(n),
    dataPoints: n,
    lastUpdated: now,
    locked: false, // never auto-freeze — keep adapting to the rolling window
    manualOverride,
  };
}

// ---------- Per-type IF-band calibration (ROADMAP #2) ----------
// Shift the execution-score intensity-vs-type bands to the athlete's OWN power-zone edges, instead of
// fixed population constants. Same `derive-with-fallback` pattern: a zero offset reproduces the
// existing bands exactly, so a default-zoned athlete scores byte-identically.

// Population-default power-zone upper bounds as %FTP. These are the Coggan / Intervals.icu defaults
// (Z1<55, Z2 56-75, Z3 76-90, Z4 91-105, Z5 106-120, Z6 121-150, Z7 open) the execution-score IF
// bands were tuned against — so an athlete whose zones match gets a zero offset.
export const DEFAULT_POWER_ZONE_TOPS_PCT = [55, 75, 90, 105, 120, 150];

// Which power-zone upper bound anchors each workout type's IF bands. RaceSim is intentionally absent
// (surgy/mixed effort with no single anchoring zone edge), so it stays on the population constants.
const IF_ANCHOR_ZONE_INDEX: Partial<Record<WorkoutType, number>> = {
  Recovery: 0, // Z1 top
  Z2: 1, // Z2 top
  Threshold: 3, // Z4 top
  VO2max: 4, // Z5 top
  SIT: 5, // Z6 top
};

const IF_OFFSET_DEADBAND = 0.02; // <2% FTP off default → treat as default (don't perturb on noise)
const IF_OFFSET_CLAMP = 0.08; // bound the shift so a wildly customised zone set can't distort scoring

// Per-workout-type IF-band shift (in FTP fraction) derived from how far the athlete's power-zone edges
// sit from the population default. Returns only the types that materially deviate — default/near-default
// or missing zones yield {}, leaving computeExecutionScore on its population bands. Pure + bounded.
export function deriveIfBandOffsets(powerZonePct: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(powerZonePct) || powerZonePct.length === 0) return out;
  for (const [type, idx] of Object.entries(IF_ANCHOR_ZONE_INDEX) as [WorkoutType, number][]) {
    const top = powerZonePct[idx];
    const def = DEFAULT_POWER_ZONE_TOPS_PCT[idx];
    if (typeof top !== "number" || !Number.isFinite(top)) continue;
    const raw = (top - def) / 100;
    if (Math.abs(raw) < IF_OFFSET_DEADBAND) continue; // within the deadband → no shift
    out[type] = clamp(raw, -IF_OFFSET_CLAMP, IF_OFFSET_CLAMP);
  }
  return out;
}
