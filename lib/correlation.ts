// Shared state→execution correlation engine (ROADMAP #2 / Track C).
//
// Generalises the guarded regression that `deriveTsbDeepFatigue` hard-coded: given the immutable
// ledger, find the level of a STAMPED signal at which THIS athlete's execution outcome degrades — but
// only when the signal genuinely DISCRIMINATES (failures separate from successes on the expected side)
// and clears a confidence gate; otherwise fall back to the population default. "Build the derivation
// once, reuse it" — the TSB adaptation edge is the first consumer; the morning-check strain edge is the
// second; carbs g/h plugs in the same way once a fueling input is stamped (Track C).
//
// Pure + deterministic: provenance comes from the immutable ledger, so each read re-derives identically.
// Depends only on ./types + ./stats (no ./calibration) so calibration.ts can consume it without a cycle.

import type { CalibratedParameter, RideScoreEntry, WorkoutType } from "./types";
import { clamp, median } from "./stats";

export interface ExecutionEdgeSpec {
  // Which PLANNED session types' execution counts (off-plan rides are scored on a different axis, so
  // they must not enter the regression — same exclusion deriveTsbDeepFatigue made).
  types: ReadonlySet<WorkoutType>;
  // Pull the stamped signal off an entry, e.g. `e => e.formState?.tsb ?? null`. Null/non-finite → the
  // entry is dropped (no signal to correlate).
  signal: (e: RideScoreEntry) => number | null;
  underBar: number; // executionScore ≤ this = under-executed ("failure")
  goodBar: number; // executionScore ≥ this = nailed it ("success")
  // Which side of the signal axis failures sit on:
  //   "lower"  → failures at LOWER signal values  (deep fatigue = low TSB)
  //   "higher" → failures at HIGHER signal values (e.g. high reported soreness/strain)
  // The derived edge is the median signal of the failures; the discrimination guard requires that
  // median to sit a margin away from the successes' median ON THAT SIDE — else the signal isn't the
  // driver and we stay on the population default (don't calibrate to where they train, not adapt).
  failureSide: "lower" | "higher";
  discriminationMargin: number; // failures must beat successes by ≥ this many signal units
  clampTo: readonly [min: number, max: number]; // sanity-bound the derived edge
  confidence: (nUnder: number, nGood: number) => CalibratedParameter["confidence"]; // signal-specific gate
}

// The "no honest signal yet" result: a default-source parameter resolveCalibratedValue ignores in
// favour of the caller's population default. `dataPoints` still reports how many failures were seen so
// the provenance is honest about why it didn't fire.
function blank(dataPoints: number, now: string): CalibratedParameter {
  return { value: NaN, source: "default", confidence: "low", dataPoints, lastUpdated: now, locked: false, manualOverride: null };
}

// Derive a per-athlete execution edge from the ledger. Never throws; never returns NaN as a *derived*
// value (a non-discriminating or low-data signal returns a default-source blank instead).
export function deriveExecutionEdge(entries: RideScoreEntry[], spec: ExecutionEdgeSpec): CalibratedParameter {
  const now = new Date().toISOString();
  // Legacy + compromised entries must never teach the model; planned + in-scope type + present signal only.
  const pairs = entries
    .filter((e) => e.planned && !e.legacy && !e.compromised && e.plannedType != null && spec.types.has(e.plannedType))
    .map((e) => ({ score: e.executionScore, s: spec.signal(e) }))
    .filter((p): p is { score: number; s: number } => p.s != null && Number.isFinite(p.s));

  const under = pairs.filter((p) => p.score <= spec.underBar).map((p) => p.s);
  const good = pairs.filter((p) => p.score >= spec.goodBar).map((p) => p.s);
  const n = under.length;
  // Need both failures to learn from AND successes to contrast against — without contrast (e.g. an
  // athlete who under-executes ALL of a type) the median would track where they train, not adapt.
  if (n === 0 || good.length === 0) return blank(n, now);

  const medUnder = median(under);
  const medGood = median(good);
  const discriminates =
    spec.failureSide === "lower" ? medUnder < medGood - spec.discriminationMargin : medUnder > medGood + spec.discriminationMargin;
  if (!discriminates) return blank(n, now);

  return {
    value: clamp(medUnder, spec.clampTo[0], spec.clampTo[1]),
    source: "derived",
    confidence: spec.confidence(n, good.length),
    dataPoints: n,
    lastUpdated: now,
    locked: false, // keep re-deriving as the rolling ledger window evolves
    manualOverride: null,
  };
}

// ---------- The OPTIMUM shape (ROADMAP Track C) ----------
// deriveExecutionEdge finds where things BREAK (median of failures); deriveOptimum finds where things
// WORK (median of successes). Same honesty guards, mirrored: successes alone are habit, not signal —
// failures must exist to contrast against, and must sit a margin away on the expected side, or we stay
// on the population default. Generic over observations (not RideScoreEntry) because optimum consumers
// classify outcomes off different substrates (carbs classifies steady rides by decoupling, not by
// ledger executionScore).

export interface OptimumObservation {
  signal: number; // the stamped input being calibrated (e.g. carbs g/h)
  good: boolean; // outcome class, decided by the caller (e.g. decoupling ≤ the athlete's reference)
}

export interface OptimumSpec {
  // Which side of the optimum the BAD outcomes must sit for the signal to be credited as the driver:
  //   "lower"  → failures at LOWER signal values (under-fueling degrades late-ride durability)
  //   "higher" → failures at HIGHER signal values
  badSide: "lower" | "higher";
  discriminationMargin: number; // bad median must sit ≥ this many signal units away from the good median
  clampTo: readonly [min: number, max: number]; // sanity-bound the derived optimum
  confidence: (nGood: number, nBad: number) => CalibratedParameter["confidence"];
}

// Derive a per-athlete optimum from classified observations. Never throws; a non-discriminating or
// one-sided sample returns a default-source blank (dataPoints = successes seen) instead.
export function deriveOptimum(obs: OptimumObservation[], spec: OptimumSpec): CalibratedParameter {
  const now = new Date().toISOString();
  const finite = obs.filter((o) => Number.isFinite(o.signal));
  const good = finite.filter((o) => o.good).map((o) => o.signal);
  const bad = finite.filter((o) => !o.good).map((o) => o.signal);
  if (good.length === 0 || bad.length === 0) return blank(good.length, now);

  const medGood = median(good);
  const medBad = median(bad);
  const discriminates =
    spec.badSide === "lower" ? medBad <= medGood - spec.discriminationMargin : medBad >= medGood + spec.discriminationMargin;
  if (!discriminates) return blank(good.length, now);

  return {
    value: clamp(medGood, spec.clampTo[0], spec.clampTo[1]),
    source: "derived",
    confidence: spec.confidence(good.length, bad.length),
    dataPoints: good.length, // the successes the value rests on
    lastUpdated: now,
    locked: false, // keep re-deriving as the rolling window evolves
    manualOverride: null,
  };
}
