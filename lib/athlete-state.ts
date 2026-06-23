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
import type { AcwrResult, ActivitySummary, AthleteModel, AthleteState, SignalContribution, SyncData } from "./types";

export interface AthleteStateInputs {
  tsb: number | null;
  acwrLevel: "low" | "optimal" | "high" | "danger" | null;
  execEwma: number | null; // overall execution EWMA, 1–10
  execTrend: "up" | "down" | "flat" | null;
  execSampleSize: number; // planned-ride sample behind the EWMA
  decouplingLatest: number | null; // most recent ride's Pw:HR decoupling %
  decouplingBaseline: number | null; // 90d rolling avg decoupling %
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

function evalDecoupling(i: AthleteStateInputs, C: AthleteStateWeights): SignalContribution | null {
  if (i.decouplingLatest === null || i.decouplingBaseline === null) return null;
  const delta = i.decouplingLatest - i.decouplingBaseline; // + = worse than baseline
  if (Math.abs(delta) < C.decoupling.deadband) {
    return { key: "decoupling", label: "Aerobic decoupling", dir: "flat", effect: 0, note: `Decoupling near baseline` };
  }
  const effect = round(clamp(-delta * C.decoupling.perPct, -C.decoupling.cap, C.decoupling.cap));
  const dir = delta > 0 ? "up" : "down"; // "up" = decoupling rising = worse
  const note = dir === "up" ? `Decoupling ${delta.toFixed(1)}% above baseline` : `Decoupling ${(-delta).toFixed(1)}% below baseline`;
  return { key: "decoupling", label: "Aerobic decoupling", dir, effect, note };
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
  return (c.key === "execution" && c.dir === "down") || (c.key === "decoupling" && c.dir === "up") || (c.key === "rpe" && c.dir === "up");
}

function bandFor(score: number): { band: AthleteState["band"]; recommendation: AthleteState["recommendation"] } {
  if (score >= 80) return { band: "primed", recommendation: "push" };
  if (score >= 65) return { band: "ready", recommendation: "proceed" };
  if (score >= 45) return { band: "steady", recommendation: "proceed" };
  if (score >= 25) return { band: "strained", recommendation: "soften" };
  return { band: "depleted", recommendation: "recover" };
}

const CORE_KEYS = new Set(["tsb", "acwr", "execution", "decoupling", "rpe"]);

export function computeAthleteState(
  i: AthleteStateInputs,
  C: AthleteStateWeights = DEFAULT_ATHLETE_STATE_WEIGHTS
): AthleteState | null {
  const evaluators = [evalTsb, evalAcwr, evalExecution, evalDecoupling, evalRpe, evalBehaviour];
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

export function athleteStateInputsFrom(
  sync: SyncData | null,
  model: AthleteModel,
  baselines: { avgDecoupling90d: number | null }, // only the decoupling baseline is needed
  acwr: AcwrResult | null
): AthleteStateInputs {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const acts = sync?.activities ?? [];
  // Most recent ride that carries a decoupling reading — the "now" aerobic-strain signal.
  const latestDecoup = [...acts]
    .filter((a) => a.decoupling !== null)
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.decoupling ?? null;
  return {
    tsb: sync?.fitness.tsb ?? null,
    acwrLevel: acwr?.level ?? null,
    execEwma: model.sampleSize > 0 ? model.overallExecEwma : null,
    execTrend: model.sampleSize > 0 ? model.overallTrend : null,
    execSampleSize: model.sampleSize,
    decouplingLatest: latestDecoup,
    decouplingBaseline: baselines.avgDecoupling90d,
    rpeRecent: meanRpe(acts, daysAgo(14)),
    rpeBaseline: meanRpe(acts, daysAgo(90)),
    offPlanPct: model.behaviour.offPlanPct,
  };
}
