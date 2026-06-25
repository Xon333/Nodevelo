// Per-athlete calibration — replaces a couple of the population "magic numbers" with values
// that adapt to the athlete. Hybrid by design: EWMA responsiveness is auto-derived from how
// much history exists; ACWR bands stay population-validated defaults that can be manually
// overridden (auto-deriving injury-risk bands isn't possible without injury data, so we don't
// pretend to). Pure + deterministic + defensive — every output is clamped to a sane range.

import type { CalibratedParameter, CalibrationStore, RideScoreEntry, WorkoutType } from "./types";
import { clamp } from "./stats";
import { deriveExecutionEdge, type ExecutionEdgeSpec } from "./correlation";

export interface AcwrBands {
  optimalLow: number; // below this = under-reaching ("low")
  optimalHigh: number; // top of the optimal progression band
  dangerHigh: number; // above this = spike ("danger")
}

// Population defaults (Gabbett acute:chronic workload sweet spot ≈ 0.8–1.3, spike > 1.5).
export const DEFAULT_ACWR_BANDS: AcwrBands = { optimalLow: 0.8, optimalHigh: 1.3, dangerHigh: 1.5 };

// EWMA smoothing for the athlete model, derived from the planned-ride sample size: with little
// history, weight recent rides more (responsive); as history accumulates, smooth out noise.
// Replaces the hardcoded α = 0.35. Clamped to a sane band.
export function autoEwmaAlpha(plannedSampleSize: number): number {
  const n = Number.isFinite(plannedSampleSize) ? Math.max(0, plannedSampleSize) : 0;
  const a = n < 5 ? 0.45 : n < 12 ? 0.38 : 0.3;
  return clamp(a, 0.2, 0.6);
}

// Pick a finite numeric override leaf, else fall back to the default — the shared finite-guard every band
// resolver below uses (CAL-2). The per-field clamp + ordering stays in each resolver: those rules are
// genuinely per-parameter (and nudge in different directions), so only the finite-guard is shared.
const pick = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

// Merge a manual override onto the population defaults, defensively: ignore non-finite values
// and enforce ordering (low < high < danger) so a bad override can't produce nonsense bands.
export function resolveAcwrBands(override?: Partial<AcwrBands> | null): AcwrBands {
  const o = override ?? {};
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

// ---------- Morning-check strain bands (ROADMAP #2 — population-fallback fold-in) ----------
// The subjective-strain thresholds decideMorningCheck downgrades a quality day against. Like the ACWR
// and TSB-edge bands above — and unlike the decoupling cutoff — no honest per-athlete derivation exists
// (we lack a labelled "this strain wrecked the session" signal), so they stay population-validated
// defaults with a manual override, under the same resolve-with-fallback machinery. Strain is the 4
// (fresh) … 20 (wrecked) score from morning-check's strainScore.
export interface StrainBands {
  high: number; // strain ≥ this → downgrade on its own
  med: number; // strain ≥ this → downgrade only when the objective signals agree
}

// Population defaults — the literal edges decideMorningCheck shipped with, so an un-overridden athlete
// is decided byte-identically.
export const DEFAULT_STRAIN_BANDS: StrainBands = { high: 15, med: 12 };

export function resolveStrainBands(override?: Partial<StrainBands> | null): StrainBands {
  const o = override ?? {};
  // Both edges live inside strain's 4–20 range; keep high ≥ med so a bad override can't make the
  // "downgrade only with corroboration" band outrank the "downgrade outright" band.
  const high = clamp(pick(o.high, DEFAULT_STRAIN_BANDS.high), 5, 20);
  let med = clamp(pick(o.med, DEFAULT_STRAIN_BANDS.med), 4, 19);
  if (med >= high) med = high - 1;
  return { high, med };
}

export function isStrainBandsOverridden(override?: Partial<StrainBands> | null): boolean {
  if (!override) return false;
  return (["high", "med"] as const).some((k) => typeof override[k] === "number" && Number.isFinite(override[k] as number));
}

// ---------- Durability-insert envelope (ROADMAP #2 — population-fallback fold-in) ----------
// The KB §12 envelope a durability template's embedded hard efforts (threshold/VO2 work buried inside
// an otherwise-easy ride) must fall within, plus the %FTP floor above which a step COUNTS as such an
// insert. Was three literals duplicated across prescription.ts + workout-validate.ts; centralised here
// as one population default, overridable like the bands above.
export interface DurabilityInsertEnvelope {
  embeddedHardPct: number; // ≥ this %FTP = a genuine hard insert worth validating (the threshold floor)
  maxIntensityPct: number; // an insert above this %FTP is malformed (supra-VO2, not an embedded effort)
  maxEffortMin: number; // an insert longer than this is malformed (a marathon block, not an insert)
}

// Population defaults — the literals the durability validator shipped with (88% floor, ≤122% / ≤20 min
// envelope), so an un-overridden plan validates byte-identically.
export const DEFAULT_DURABILITY_INSERT_ENVELOPE: DurabilityInsertEnvelope = { embeddedHardPct: 88, maxIntensityPct: 122, maxEffortMin: 20 };

export function resolveDurabilityInsertEnvelope(override?: Partial<DurabilityInsertEnvelope> | null): DurabilityInsertEnvelope {
  const o = override ?? {};
  const embeddedHardPct = clamp(pick(o.embeddedHardPct, DEFAULT_DURABILITY_INSERT_ENVELOPE.embeddedHardPct), 70, 105);
  let maxIntensityPct = clamp(pick(o.maxIntensityPct, DEFAULT_DURABILITY_INSERT_ENVELOPE.maxIntensityPct), 100, 160);
  if (maxIntensityPct <= embeddedHardPct) maxIntensityPct = embeddedHardPct + 1; // ceiling must clear the floor
  const maxEffortMin = clamp(pick(o.maxEffortMin, DEFAULT_DURABILITY_INSERT_ENVELOPE.maxEffortMin), 5, 60);
  return { embeddedHardPct, maxIntensityPct, maxEffortMin };
}

export function isDurabilityInsertEnvelopeOverridden(override?: Partial<DurabilityInsertEnvelope> | null): boolean {
  if (!override) return false;
  return (["embeddedHardPct", "maxIntensityPct", "maxEffortMin"] as const).some(
    (k) => typeof override[k] === "number" && Number.isFinite(override[k] as number)
  );
}

// ---------- Athlete-state fusion weights (ROADMAP §5 / #2 — population-fallback fold-in) ----------
// The signal-fusion tuning knobs (BASE + per-signal scales/caps/thresholds) athlete-state.ts grades
// the glanceable 0–100 state with. Were a private `const C` of magic numbers; centralised here as a
// population default so they sit under the same framework and CAN be overridden per athlete. Per-athlete
// *derivation* of these weights is a separate §5 sliver (← #2's correlation engine); this is just the
// population-fallback fold-in, so an un-overridden athlete is scored byte-identically.
export interface AthleteStateWeights {
  BASE: number; // neutral start (no news → mid "steady")
  tsb: { scale: number; cap: number; freshAbove: number; deepBelow: number };
  acwr: { optimal: number; low: number; high: number; danger: number };
  exec: { mid: number; perPoint: number; trend: number; cap: number };
  aerobicEff: { perPct: number; cap: number; deadband: number }; // Pw:HR-Z2 vs baseline (higher = fresher)
  rpe: { perPoint: number; cap: number; deadband: number };
  behaviour: { highOffPlan: number; effect: number };
  override: { livedThreshold: number; scoreCap: number }; // ≥N lived-negatives → cap the score
}

// Population defaults — the literal knobs athlete-state.ts shipped with.
export const DEFAULT_ATHLETE_STATE_WEIGHTS: AthleteStateWeights = {
  BASE: 60,
  tsb: { scale: 0.6, cap: 18, freshAbove: 5, deepBelow: -5 },
  acwr: { optimal: 4, low: -2, high: -10, danger: -20 },
  exec: { mid: 6, perPoint: 4, trend: 4, cap: 16 },
  aerobicEff: { perPct: 1.5, cap: 9, deadband: 2 }, // effect = relative %Δ from baseline × perPct, capped
  rpe: { perPoint: 5, cap: 10, deadband: 0.5 },
  behaviour: { highOffPlan: 60, effect: -4 },
  override: { livedThreshold: 2, scoreCap: 40 },
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

// Per-leaf [min, max] bounds for the fusion weights — the clamp resolveAthleteStateWeights was missing
// (CAL-1; every sibling resolver clamps, this one didn't). Mirrors AthleteStateWeights leaf-for-leaf.
// Ranges are generous (these are tuning knobs, not bands) but tight enough that an override can't invert
// a signal's polarity (scales stay ≥0; ACWR optimal stays a boost / danger stays a penalty) or — the
// dangerous one the review caught — neuter the lived-fatigue safety cap: scoreCap stays below the 80+
// "primed" band so it remains a real ceiling, and livedThreshold stays ≤3 since only three lived signals
// exist (exec/decoupling/rpe), so a high value could otherwise make the cap unreachable.
const ATHLETE_STATE_WEIGHT_BOUNDS = {
  BASE: [40, 80],
  tsb: { scale: [0, 3], cap: [0, 40], freshAbove: [0, 30], deepBelow: [-40, 0] },
  acwr: { optimal: [0, 15], low: [-15, 10], high: [-40, 5], danger: [-60, 0] },
  exec: { mid: [3, 8], perPoint: [0, 12], trend: [0, 12], cap: [0, 30] },
  aerobicEff: { perPct: [0, 6], cap: [0, 30], deadband: [0, 8] },
  rpe: { perPoint: [0, 15], cap: [0, 30], deadband: [0, 3] },
  behaviour: { highOffPlan: [0, 100], effect: [-20, 0] },
  override: { livedThreshold: [1, 3], scoreCap: [0, 70] },
} as const;

// Recursively merge an override's finite numeric leaves onto a default; non-finite or missing values
// fall back. Pure merge — bounding/ordering is the resolver's job (see resolveAthleteStateWeights).
function mergeNumericLeaves<T>(def: T, ov: unknown): T {
  if (typeof def === "number") {
    return (typeof ov === "number" && Number.isFinite(ov) ? ov : def) as T;
  }
  if (def !== null && typeof def === "object") {
    const out: Record<string, unknown> = {};
    const o = (ov ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(def as Record<string, unknown>)) {
      out[k] = mergeNumericLeaves((def as Record<string, unknown>)[k], o[k]);
    }
    return out as T;
  }
  return def;
}

// Clamp every numeric leaf of `value` to the matching leaf in `bounds` (same shape). A leaf with no
// bound is left as-is (defensive — the bounds mirror the weights, so this shouldn't happen).
function clampLeaves<T>(value: T, bounds: unknown): T {
  if (typeof value === "number") {
    if (Array.isArray(bounds)) return clamp(value, bounds[0] as number, bounds[1] as number) as T;
    return value;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const b = (bounds ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(value as Record<string, unknown>)) {
      out[k] = clampLeaves((value as Record<string, unknown>)[k], b[k]);
    }
    return out as T;
  }
  return value;
}

export function resolveAthleteStateWeights(override?: DeepPartial<AthleteStateWeights> | null): AthleteStateWeights {
  const w = clampLeaves(mergeNumericLeaves(DEFAULT_ATHLETE_STATE_WEIGHTS, override ?? undefined), ATHLETE_STATE_WEIGHT_BOUNDS);
  // "Fresh" must sit strictly above "deep fatigue" or evalTsb's direction labels invert (a fatigued TSB
  // would read as fresh). Clamps already pin freshAbove ≥ 0 ≥ deepBelow; nudge if both collapse to 0.
  if (w.tsb.freshAbove <= w.tsb.deepBelow) w.tsb.freshAbove = w.tsb.deepBelow + 1;
  return w;
}

export function isAthleteStateWeightsOverridden(override?: DeepPartial<AthleteStateWeights> | null): boolean {
  if (!override) return false;
  // Any finite numeric leaf anywhere in the (shallow-or-deep) override counts.
  const hasNum = (v: unknown): boolean =>
    typeof v === "number"
      ? Number.isFinite(v)
      : v !== null && typeof v === "object" && Object.values(v as Record<string, unknown>).some(hasNum);
  return hasNum(override);
}

// ---------- Derive the TSB deep-fatigue edge from stamped ledger context (ROADMAP #2) ----------
// Now that each entry freezes the TSB the athlete carried into the session (formState), the deep-fatigue
// edge becomes honestly derivable: the form level at which THIS athlete's quality work falls apart.
// Two guards keep it honest, both of which fall back to the population default when unmet:
//   1) enough under-executed quality sessions to trust the signal (confidence gate), and
//   2) fatigue actually DISCRIMINATES — failures sit meaningfully deeper (lower TSB) than successes.
// Without (2) we'd be calibrating to where the athlete trains, not where they adapt — the exact trap
// the override-only v1 avoided. **Planned** quality sessions only (Threshold/VO2max/SIT/RaceSim) — an
// off-plan ride is scored intrinsically (decoupling/pacing), a different failure than missing prescribed
// targets, so its score must not enter this regression. Legacy + compromised excluded (must not teach the
// model). Provenance comes from the immutable ledger, so this re-derives deterministically each read.

const TSB_QUALITY_TYPES = new Set<WorkoutType>(["Threshold", "VO2max", "SIT", "RaceSim"]);
const TSB_UNDER_BAR = 4; // quality executionScore ≤ this = under-executed
const TSB_GOOD_BAR = 6; // executionScore ≥ this = nailed it
const TSB_DISCRIMINATION_MARGIN = 4; // failures must sit ≥ this many TSB points deeper than successes
const TSB_DEEP_MIN = -45; // clamp the derived edge to a sane deep-fatigue range
const TSB_DEEP_MAX = -12;

// Confidence for the deep-fatigue edge (CS-7) — TSB-specific, not the generic confidenceFromN: quality
// FAILURES are rare and each is informative, so the bar is lower than the sample-size default, but it
// also requires real CONTRAST (enough successes) rather than weighting failure count alone. resolveCalibratedValue
// applies a derived value only at medium+, so the effective gate to take effect is nUnder ≥ 5 AND nGood ≥ 3.
function tsbDeepFatigueConfidence(nUnder: number, nGood: number): CalibratedParameter["confidence"] {
  if (nUnder < 5 || nGood < 3) return "low";
  if (nUnder < 10) return "medium";
  return "high";
}

// The deep-fatigue edge is now the first consumer of the shared correlation engine (lib/correlation.ts):
// the form level (low TSB) at which quality execution falls apart. Behaviour is unchanged — this is the
// same guarded regression, expressed as a spec so the next signals (strain, carbs) reuse the derivation.
const TSB_DEEP_FATIGUE_SPEC: ExecutionEdgeSpec = {
  types: TSB_QUALITY_TYPES,
  signal: (e) => e.formState?.tsb ?? null,
  underBar: TSB_UNDER_BAR,
  goodBar: TSB_GOOD_BAR,
  failureSide: "lower", // deep fatigue = low TSB
  discriminationMargin: TSB_DISCRIMINATION_MARGIN,
  clampTo: [TSB_DEEP_MIN, TSB_DEEP_MAX],
  confidence: tsbDeepFatigueConfidence,
};

export function deriveTsbDeepFatigue(entries: RideScoreEntry[]): CalibratedParameter {
  return deriveExecutionEdge(entries, TSB_DEEP_FATIGUE_SPEC);
}

// The effective TSB-edge override to feed resolveTsbModifierEdges. Precedence is **per-edge**: a manual
// override is authoritative for the edges it pins; the derived deep-fatigue edge fills `deepFatigue` ONLY
// when it isn't manually pinned. Crucially the derived edge must YIELD to a manually-set `productiveOverload`
// — staying strictly below it — so resolveTsbModifierEdges' ordering pass can never nudge a manual value up
// (CS-5: manual > derived > population, including for the *neighbour* edges). No signal → population edges
// (byte-identical classification).
export function resolveTsbEdgesOverride(
  entries: RideScoreEntry[],
  settingsOverride?: Partial<TsbModifierEdges> | null
): Partial<TsbModifierEdges> {
  const o = settingsOverride ?? {};
  const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (isNum(o.deepFatigue)) return { ...o }; // athlete pinned deepFatigue — derived doesn't apply
  let deepFatigue = resolveCalibratedValue(deriveTsbDeepFatigue(entries), DEFAULT_TSB_MODIFIER_EDGES.deepFatigue);
  // Yield to a manually-set productiveOverload: keep the derived edge below it rather than letting the
  // ordering pass rewrite the manual value.
  if (isNum(o.productiveOverload)) deepFatigue = Math.min(deepFatigue, o.productiveOverload - 1);
  return { ...o, deepFatigue };
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
// Sanity band the decoupling-good cutoff must stay within. The derived value (below), a manual override
// (app/api/calibration/route.ts), and the CalibrationPanel input all clamp/validate against this one
// constant so they can't drift apart (CAL-4): below ~2.5% even strong aerobic riders rarely sit, above
// ~8% a "good" cutoff is meaningless.
export const DECOUPLING_GOOD_BOUNDS = { min: 2.5, max: 8 } as const;

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
    value: clamp(avgDecoupling90d, DECOUPLING_GOOD_BOUNDS.min, DECOUPLING_GOOD_BOUNDS.max), // sanity-bounded so one weird window can't produce a silly cutoff
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
