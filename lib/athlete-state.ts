// Signal fusion (ROADMAP §5). One glanceable, deterministic 0–100 score — "what the second brain
// thinks of the athlete's state right now" — that FUSES the parallel signals the brain otherwise
// surfaces (and lets contradict) separately. Whoop-recovery-style: the score is the glance, the band
// + drivers are the detail. See docs/specs/athlete-state.md.
//
// Architecture: a list of signal EVALUATORS, one per signal, each returning a SignalContribution (or
// null when unavailable). score = BASE + Σ effects, clamped, then a lived-signal override. Adding a
// signal later (e.g. energy-availability) = add one evaluator. All weights/thresholds are the named
// constants in `C` below — retuning is editing constants, not logic. The AI only ever phrases the
// headline from this; it never computes or overrides the state.

import { DEFAULT_ATHLETE_STATE_WEIGHTS, type AthleteStateWeights } from "./calibration";
import { round2 } from "./stats";
import type { AcwrResult, ActivitySummary, AthleteModel, AthleteState, SignalContribution, SyncData } from "./types";

export interface AthleteStateInputs {
  tsb: number | null;
  acwrLevel: "low" | "optimal" | "high" | "danger" | null;
  execEwma: number | null; // overall execution EWMA, 1–10
  execTrend: "up" | "down" | "flat" | null;
  execSampleSize: number; // planned-ride sample behind the EWMA
  aerobicEffLatest: number | null; // latest ride's Z2 Pw:HR (icu_power_hr_z2), if recent + enough Z2; else null
  aerobicEffBaseline: number | null; // mean Z2 Pw:HR over qualifying rides (90d); null if too few
  rpeRecent: number | null; // mean session RPE, recent window
  rpeBaseline: number | null; // mean session RPE, longer baseline window
  offPlanPct: number | null; // 0–100
}

// The fusion weights (BASE + per-signal scales/caps/thresholds) are the calibration framework's
// population default (DEFAULT_ATHLETE_STATE_WEIGHTS in lib/calibration.ts), passed in as `C` so they
// can be overridden per athlete; retuning is editing that default, not this logic. Each evaluator
// takes the resolved weights so the math stays a pure function of (inputs, weights).

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number) => Math.round(v);

// ---- evaluators: (inputs, weights) → SignalContribution | null (null = signal unavailable) ----

function evalTsb(i: AthleteStateInputs, C: AthleteStateWeights): SignalContribution | null {
  if (i.tsb === null) return null;
  const effect = round(clamp(i.tsb * C.tsb.scale, -C.tsb.cap, C.tsb.cap));
  const dir = i.tsb > C.tsb.freshAbove ? "up" : i.tsb < C.tsb.deepBelow ? "down" : "flat";
  const note = dir === "up" ? `Form fresh (TSB ${i.tsb})` : dir === "down" ? `Carrying fatigue (TSB ${i.tsb})` : `Form neutral (TSB ${i.tsb})`;
  return { key: "tsb", label: "Form (TSB)", dir, effect, note };
}

function evalAcwr(i: AthleteStateInputs, C: AthleteStateWeights): SignalContribution | null {
  if (i.acwrLevel === null) return null;
  const effect = C.acwr[i.acwrLevel];
  const dir = effect > 0 ? "up" : effect < 0 ? "down" : "flat";
  return { key: "acwr", label: "Load ratio (ACWR)", dir, effect, note: `Acute:chronic load ${i.acwrLevel}` };
}

function evalExecution(i: AthleteStateInputs, C: AthleteStateWeights): SignalContribution | null {
  if (i.execEwma === null) return null;
  let effect = (i.execEwma - C.exec.mid) * C.exec.perPoint;
  if (i.execTrend === "up") effect += C.exec.trend;
  else if (i.execTrend === "down") effect -= C.exec.trend;
  effect = round(clamp(effect, -C.exec.cap, C.exec.cap));
  // dir reflects how execution is moving (down = worse) — drives the lived-signal override below.
  const dir = i.execTrend === "down" || i.execEwma < C.exec.mid - 0.5 ? "down" : i.execTrend === "up" || i.execEwma > C.exec.mid + 0.5 ? "up" : "flat";
  const note = `Execution ${i.execEwma.toFixed(1)}/10${i.execTrend && i.execTrend !== "flat" ? `, trending ${i.execTrend}` : ""}`;
  return { key: "execution", label: "Execution quality", dir, effect, note };
}

function evalAerobicEff(i: AthleteStateInputs, C: AthleteStateWeights): SignalContribution | null {
  if (i.aerobicEffLatest === null || i.aerobicEffBaseline === null || i.aerobicEffBaseline <= 0) return null;
  // Z2-isolated Pw:HR (intervals.icu's icu_power_hr_z2) vs the athlete's recent baseline — HIGHER = more
  // power per heartbeat = fresher/fitter (the inverse of decoupling's polarity). Relative %Δ so the signal
  // is scale-free across athletes. Below baseline = aerobic system under strain → a "lived negative".
  const relPct = ((i.aerobicEffLatest - i.aerobicEffBaseline) / i.aerobicEffBaseline) * 100;
  if (Math.abs(relPct) < C.aerobicEff.deadband) {
    return { key: "aerobicEff", label: "Aerobic efficiency", dir: "flat", effect: 0, note: `Aerobic efficiency near baseline` };
  }
  const effect = round(clamp(relPct * C.aerobicEff.perPct, -C.aerobicEff.cap, C.aerobicEff.cap));
  const dir = relPct > 0 ? "up" : "down"; // "up" = efficiency rising = better
  const note = dir === "up" ? `Aerobic efficiency ${relPct.toFixed(0)}% above baseline` : `Aerobic efficiency ${(-relPct).toFixed(0)}% below baseline`;
  return { key: "aerobicEff", label: "Aerobic efficiency", dir, effect, note };
}

function evalRpe(i: AthleteStateInputs, C: AthleteStateWeights): SignalContribution | null {
  if (i.rpeRecent === null || i.rpeBaseline === null) return null;
  const delta = i.rpeRecent - i.rpeBaseline; // + = higher perceived cost = worse
  if (Math.abs(delta) < C.rpe.deadband) {
    return { key: "rpe", label: "Perceived effort (RPE)", dir: "flat", effect: 0, note: `RPE near baseline` };
  }
  const effect = round(clamp(-delta * C.rpe.perPoint, -C.rpe.cap, C.rpe.cap));
  const dir = delta > 0 ? "up" : "down"; // "up" = RPE rising = worse
  const note = dir === "up" ? `RPE ${delta.toFixed(1)} above baseline` : `RPE ${(-delta).toFixed(1)} below baseline`;
  return { key: "rpe", label: "Perceived effort (RPE)", dir, effect, note };
}

function evalBehaviour(i: AthleteStateInputs, C: AthleteStateWeights): SignalContribution | null {
  if (i.offPlanPct === null || i.offPlanPct <= C.behaviour.highOffPlan) return null; // light input — fires only on high drift
  return { key: "behaviour", label: "Plan adherence", dir: "down", effect: C.behaviour.effect, note: `${round(i.offPlanPct)}% of rides off-plan` };
}

// The lived signals (what the body/sessions actually say, vs the load model). ≥2 corroborating
// "worse" readings here cap the score even when TSB/ACWR look fresh — the reconciliation rule.
function isLivedNegative(c: SignalContribution): boolean {
  return (c.key === "execution" && c.dir === "down") || (c.key === "aerobicEff" && c.dir === "down") || (c.key === "rpe" && c.dir === "up");
}

function bandFor(score: number): { band: AthleteState["band"]; recommendation: AthleteState["recommendation"] } {
  if (score >= 80) return { band: "primed", recommendation: "push" };
  if (score >= 65) return { band: "ready", recommendation: "proceed" };
  if (score >= 45) return { band: "steady", recommendation: "proceed" };
  if (score >= 25) return { band: "strained", recommendation: "soften" };
  return { band: "depleted", recommendation: "recover" };
}

const CORE_KEYS = new Set(["tsb", "acwr", "execution", "aerobicEff", "rpe"]);

export function computeAthleteState(
  i: AthleteStateInputs,
  C: AthleteStateWeights = DEFAULT_ATHLETE_STATE_WEIGHTS
): AthleteState | null {
  const evaluators = [evalTsb, evalAcwr, evalExecution, evalAerobicEff, evalRpe, evalBehaviour];
  const drivers = evaluators.map((fn) => fn(i, C)).filter((c): c is SignalContribution => c !== null);
  if (drivers.length === 0) return null; // nothing to say

  let score = clamp(C.BASE + drivers.reduce((s, c) => s + c.effect, 0), 0, 100);

  // Lived-signal override: corroborated fatigue beats a fresh load model.
  const livedNegatives = drivers.filter(isLivedNegative).length;
  if (livedNegatives >= C.override.livedThreshold) score = Math.min(score, C.override.scoreCap);
  score = round(score);

  const { band, recommendation } = bandFor(score);

  // Confidence from how many *core* signals fired + the execution sample behind the EWMA.
  const corePresent = drivers.filter((c) => CORE_KEYS.has(c.key)).length;
  const confidence: AthleteState["confidence"] =
    corePresent >= 4 && i.execSampleSize >= 8 ? "high" : corePresent <= 2 || i.execSampleSize < 3 ? "low" : "medium";

  // Drivers sorted by |effect|; headline = band + the 1–2 biggest movers (positives for a high band,
  // negatives for a low one). Deterministic — the AI may rephrase but not recompute.
  const sorted = [...drivers].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  const lowBand = score < 45;
  const movers = sorted.filter((c) => (lowBand ? c.effect < 0 : c.effect > 0)).slice(0, 2);
  const reason = (movers.length ? movers : sorted.slice(0, 2)).map((c) => c.note).join("; ");
  const headline = `${band[0].toUpperCase()}${band.slice(1)} — ${reason}`;

  return { score, band, recommendation, confidence, drivers: sorted, headline };
}

// ---- adapter: resolve the scalar inputs from the app's stored signals (pure; the routes pass the
// pieces they already have, so the fusion stays IO-free and testable). ----

function meanRpe(activities: ActivitySummary[], sinceIso: string): number | null {
  const rpes = activities.filter((a) => a.date >= sinceIso && a.rpe !== null).map((a) => a.rpe as number);
  return rpes.length ? Math.round((rpes.reduce((s, v) => s + v, 0) / rpes.length) * 10) / 10 : null;
}

const AEROBIC_RECENCY_DAYS = 14; // a reading older than this isn't "now" aerobic state
const AEROBIC_BASELINE_DAYS = 90;
const AEROBIC_MIN_BASELINE = 3; // need a few readings before the baseline is trustworthy
const AEROBIC_MIN_Z2_MINS = 15; // trust a ride's Z2 Pw:HR only above this much Z2 (a few warmup mins is noisy)

export function athleteStateInputsFrom(
  sync: SyncData | null,
  model: AthleteModel,
  acwr: AcwrResult | null
): AthleteStateInputs {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const acts = sync?.activities ?? [];
  // Aerobic efficiency from intervals.icu's Z2-isolated Pw:HR (icu_power_hr_z2). Because it's already
  // computed over the ride's Z2 SAMPLES only, it's a clean like-for-like aerobic reading present even on
  // interval days — no ride-structure confound (that was the whole-ride-decoupling problem). Trusted only
  // above a Z2-minutes floor (a few warmup minutes are noisy); the latest must be recent. Baseline = mean
  // over qualifying rides in the window; too few → null → the signal sits out (better absent than wrong).
  const qualifying = acts.filter((a) => a.powerHrZ2 !== null && (a.powerHrZ2Mins ?? 0) >= AEROBIC_MIN_Z2_MINS);
  const latestQual = [...qualifying].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const aerobicEffLatest =
    latestQual && latestQual.date >= daysAgo(AEROBIC_RECENCY_DAYS) ? latestQual.powerHrZ2 : null;
  const baseVals = qualifying
    .filter((a) => a.date >= daysAgo(AEROBIC_BASELINE_DAYS))
    .map((a) => a.powerHrZ2 as number);
  const aerobicEffBaseline =
    baseVals.length >= AEROBIC_MIN_BASELINE ? round2(baseVals.reduce((s, v) => s + v, 0) / baseVals.length) : null;
  return {
    tsb: sync?.fitness.tsb ?? null,
    acwrLevel: acwr?.level ?? null,
    execEwma: model.sampleSize > 0 ? model.overallExecEwma : null,
    execTrend: model.sampleSize > 0 ? model.overallTrend : null,
    execSampleSize: model.sampleSize,
    aerobicEffLatest,
    aerobicEffBaseline,
    rpeRecent: meanRpe(acts, daysAgo(14)),
    rpeBaseline: meanRpe(acts, daysAgo(90)),
    offPlanPct: model.behaviour.offPlanPct,
  };
}
