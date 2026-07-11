// Deterministic 1-10 ride execution quality score.
// Based on: interval-target adherence (when an interval workout was prescribed) or
// duration compliance, intensity appropriateness, effort (RPE vs intensity), the off-plan
// aerobic read (Z2 Pw:HR vs baseline), and pacing smoothness (variability index). No AI.

import { AEROBIC_DEADBAND_PCT } from "./aerobic";
import { EXPECTS_EMBEDDED_EFFORTS } from "./durability-score";

// Population default for the decoupling "good" cutoff. At this value the bands are the historical
// absolute cutoffs [2, 4, 7, 10], so an uncalibrated score is byte-identical to before.
export const DEFAULT_DECOUPLING_GOOD = 4;

// The "sweet spot" whole-ride IF bands for the FTP-anchored quality types — the range the scorer
// awards +2 for. Exported as the SINGLE source for ROADMAP #4's planned-vs-actual read and the
// FTP-retest overdelivery detector (lib/plan-vs-actual.ts), so the "expected IF" those surfaces show
// can never drift from what scoring rewards. Per-athlete calibration shifts these via ifBandOffsets
// at the point of use (see the switch below / the detector).
export const FTP_ANCHORED_IF_BANDS = {
  Threshold: { lo: 0.82, hi: 0.92 },
  VO2max: { lo: 0.9, hi: 1.1 },
} as const;

// Per-athlete scoring calibration (ROADMAP #2) threaded into the score. Every field is optional and
// defaults to the population behaviour, so an uncalibrated/default-zoned athlete scores identically.
export interface ScoringCalibration {
  // Per-workout-type IF-band shift (FTP fraction) that moves the intensity-vs-type bands to the
  // athlete's own power-zone edges (see deriveIfBandOffsets). Absent/0 → unchanged population bands.
  ifBandOffsets?: Record<string, number>;
}

export interface ExecutionScoreInput {
  compliancePct: number | null;
  intensityFactor: number | null;
  plannedType: string | null;
  variabilityIndex: number | null; // NP / avg power; ~1.0 = perfectly steady
  adherencePct?: number | null; // avg interval power vs prescribed target (interval days)
  rpe?: number | null; // perceived exertion 1-10
  // Easy-ride effort judge (Z2/Recovery): fraction (0–1) of the ride's HR-zone time spent ABOVE the
  // aerobic ceiling (HR zones 3+), from timeAboveAerobicHrFraction. Terrain-immune — this, not power,
  // decides whether an "easy" ride was actually easy. Only applied for prescribed Z2/Recovery; null/absent
  // → no HR penalty. Replaces the old power-based aboveZ2Frac, which penalized outdoor rides for terrain.
  aboveAerobicHrFrac?: number | null;
  // Off-plan ride: the type was inferred FROM intensity, so scoring intensity against that
  // type would be circular. When set, the intensity-vs-type branch is skipped and the score
  // rests on the intent-independent signals (pacing, RPE, and the aerobic read below).
  intrinsic?: boolean;
  // Off-plan aerobic signal (the gap decoupling left): signed %Δ of the ride's Z2-isolated Pw:HR vs the
  // athlete's own baseline (lib/aerobic.ts). Intent-INDEPENDENT — it doesn't infer intensity from the
  // inferred type. Only applied for intrinsic rides; null/absent → no effect. Positive = above baseline =
  // better aerobic efficiency = a good off-plan endurance day.
  aerobicEffPct?: number | null;
  // Track B — durability long ride: the block's template (A–E) this Z2 ride was built around. Makes the
  // "above Z2" rule template-aware (A expects unbroken Z2; B–E embed efforts, so above-Z2 time is the
  // point, not a discipline lapse). Absent → plain Z2 behaviour.
  durabilityTemplate?: string | null;
  // Track B — the effort-delivery grade for a durability ride (gradeDurabilityDelivery): did the template's
  // prescribed efforts actually happen, at the right intensity + timing? +2 delivered · 0 mis-placed · -2
  // skipped. Null/absent → no effect (no interval data, or template A). Only the today path can compute it.
  durabilityDelivery?: number | null;
  // Per-athlete calibration (ROADMAP #2): shifts the IF-vs-type bands to the athlete's own zone edges.
  // Absent → population behaviour (unchanged scoring).
  calibration?: ScoringCalibration | null;
}

export function computeExecutionScore(input: ExecutionScoreInput): number | null {
  const { compliancePct, intensityFactor, plannedType, variabilityIndex } = input;
  const adherencePct = input.adherencePct ?? null;
  const rpe = input.rpe ?? null;
  const intrinsic = input.intrinsic ?? false;

  // Need at least one meaningful signal to produce a score.
  if (compliancePct === null && intensityFactor === null && adherencePct === null) return null;

  // Track B: a durability long ride (template B–E) whose embedded effort is graded by the durability
  // delivery grader below. That grader is the right lens for a fatigued mid-ride effort; the generic
  // interval-adherence axis (which demands strict full-rep completion) would double-penalise the same
  // climb — so it's suppressed here, and the ride rests on duration compliance + the delivery grade.
  const embedsEfforts = EXPECTS_EMBEDDED_EFFORTS.has(input.durabilityTemplate ?? "");
  const gradedByDurability =
    embedsEfforts && input.durabilityDelivery != null && Number.isFinite(input.durabilityDelivery);

  let score = 5; // baseline

  // --- Execution: interval-target adherence (±2) takes precedence over duration when
  // an interval workout was prescribed; hitting the watts matters more than ride length.
  if (adherencePct !== null && !gradedByDurability && plannedType === "SIT") {
    // All-out sprint: the target is a floor to clear, not a pace to hold near. Sustained overshoot on a
    // Threshold/VO2max effort is a real risk (going out too hard to finish the interval), but a 30s
    // maximal rep carries no such risk — the full-length recovery between reps is the whole point of the
    // rest windows, and clearing the target by a lot is a stronger sprint, not a blown pacing plan.
    // Only undershoot (didn't clear the bar) signals a problem.
    const a = adherencePct;
    if (a >= 95) score += 2;
    else if (a >= 90) score += 1;
    else if (a >= 85) score += 0;
    else if (a >= 80) score -= 1;
    else score -= 2;
  } else if (adherencePct !== null && !gradedByDurability) {
    const a = adherencePct;
    if (a >= 95 && a <= 106) score += 2; // nailed the targets
    else if ((a >= 90 && a < 95) || (a > 106 && a <= 112)) score += 1;
    else if (a >= 85 && a < 90) score += 0;
    else if (a >= 80 && a < 85) score -= 1;
    else score -= 2; // well under target, or blew past it (won't recover well)
  } else if (compliancePct !== null) {
    // --- Duration compliance (±2) for steady/endurance rides ---
    if (compliancePct >= 95) score += 2;
    else if (compliancePct >= 85) score += 1;
    else if (compliancePct >= 70) score += 0;
    else if (compliancePct >= 55) score -= 1;
    else score -= 2;
  }

  // Decoupling no longer contributes to execution (ACC-2026-06-25): whole-ride decoupling is a ride-
  // structure artifact on non-steady days and too noisy per-ride to grade a session. It's now a
  // steady-ride DURABILITY signal only — see lib/calibration.ts (decouplingGood) + the coach note.

  // --- Intensity vs planned type (±2) --- skipped for off-plan rides (would be circular)
  if (intensityFactor !== null && plannedType && !intrinsic) {
    const IF = intensityFactor;
    // Per-athlete IF-band shift (ROADMAP #2): moves the band edges to the athlete's own zone edges.
    // Defaults to 0 (population bands) — so a default-zoned/uncalibrated athlete scores identically.
    const o = input.calibration?.ifBandOffsets?.[plannedType] ?? 0;
    switch (plannedType) {
      case "Z2":
        // Reward-only for easy rides: NP/FTP in-band is a nice controlled ride (+1), but being over is
        // NOT penalized here — outdoor NP inflates on terrain, and the HR read below is the sole "too hard"
        // judge. `o` is the per-athlete zone-edge offset (ROADMAP #2).
        if (IF >= 0.60 + o && IF <= 0.74 + o) score += 1;
        break;
      case "Recovery":
        if (IF < 0.60 + o) score += 1; // genuinely gentle — a bonus, never a penalty (HR judges "too hard")
        break;
      case "Threshold": {
        const b = FTP_ANCHORED_IF_BANDS.Threshold;
        if (IF >= b.lo + o && IF <= b.hi + o) score += 2;
        else if (IF >= 0.78 + o && IF <= 0.96 + o) score += 1;
        else if (IF < 0.74 + o || IF > 1.05 + o) score -= 2;
        else score -= 1;
        break;
      }
      case "VO2max": {
        const b = FTP_ANCHORED_IF_BANDS.VO2max;
        if (IF >= b.lo + o && IF <= b.hi + o) score += 2;
        else if (IF >= 0.86 + o && IF <= 1.15 + o) score += 1;
        else if (IF < 0.80 + o) score -= 2;
        else if (IF > 1.20 + o) score -= 1; // sustained way over VO2 isn't the prescribed session either (RV2-8)
        break;
      }
      // SIT deliberately has no case here: whole-ride NP/FTP is the wrong signal for a session built
      // from a handful of 30s max efforts diluted by a long warmup + full-recovery windows — even a
      // flawless sprint day can't push whole-ride IF near the 0.90+ this band used to require, so it
      // silently capped every well-ridden SIT session at -1 regardless of execution (BUG-2026-07-03).
      // adherencePct (above) already grades SIT quality directly and correctly; this axis would only
      // double-count it. VI is excluded from SIT for the same short-effort/long-recovery reason (below).
      case "RaceSim":
        // Race-sim is hard + surgy — reward a genuinely high, variable effort; penalise a soft one.
        // (No zone anchor, so `o` is always 0 here; kept uniform for clarity.)
        if (IF >= 0.80 + o && IF <= 0.95 + o) score += 2;
        else if (IF >= 0.75 + o && IF <= 1.0 + o) score += 1;
        else if (IF < 0.70 + o) score -= 2;
        else if (IF > 1.05 + o) score -= 1; // way over even for a hard surgy race-sim (RV2-8)
        break;
    }
  }

  // --- Easy-ride effort judge: HR time above the aerobic ceiling (+1 / 0 / −4) --- prescribed Z2/Recovery.
  // The terrain-immune "was this actually easy?" read (aerobicDisciplineRead over HR-zone time), and the
  // ONLY penalty axis for easy rides: dialed in = +1, some drift = 0, ran hot = −4 (the overtraining
  // guardrail — a genuinely too-hard easy day is still flagged). −4, not −2/−3: the reward-only bonuses
  // above it (duration +2, IF-band +1, VI +1) can stack to +4 above baseline, so the penalty must clear
  // that whole stack to guarantee the guardrail holds on every combination, not just the common case.
  // A second path also reaches +4 without the IF-band bonus: IF ≥ the band ceiling (no +1 there) paired
  // with a big RPE undershoot (gap ≤ −2 at IF ≥0.85, +1 below) — this SUBSTITUTES for the IF-band bonus,
  // it doesn't stack alongside it (a ride can't be both in-band and out-of-band). Both zero-margin
  // boundaries are pinned by tests in the "easy-ride execution" describe block below.
  // Skipped for off-plan rides (no plan to be easy against), for durability templates B–E (efforts INSIDE
  // the ride are the point — Track B), and when HR-zone data is absent (older rides / no HR monitor score
  // exactly as before, on duration + bonuses).
  if (
    input.aboveAerobicHrFrac != null &&
    !intrinsic &&
    !embedsEfforts &&
    (plannedType === "Z2" || plannedType === "Recovery")
  ) {
    const read = aerobicDisciplineRead(input.aboveAerobicHrFrac);
    if (read === "dialed") score += 1;
    else if (read === "hot") score -= 4;
    // "drift" → 0 (lenient middle: the odd climb or brief effort is fine).
  }

  // --- Track B: durability effort delivery (±2) --- did the template's prescribed efforts actually
  // happen, at the right intensity + timing (gradeDurabilityDelivery, computed by the today path from the
  // ride's intervals)? Absent → no effect (no interval data, or template A).
  // Gated on gradedByDurability (an efforts-embedding template B–E + a finite grade), not just a finite
  // grade: a lone durabilityDelivery on template A / no template would otherwise stack on the full
  // interval-adherence axis and double-count in the immutable ledger (EC-3). gradedByDurability already
  // implies the finite check above.
  if (gradedByDurability) {
    score += Math.max(-2, Math.min(2, Math.round(input.durabilityDelivery as number)));
  }

  // --- Off-plan aerobic quality (±2) --- intrinsic rides only.
  // The non-circular aerobic read that replaces decoupling for off-plan rides: the ride's Z2-isolated
  // Pw:HR vs the athlete's own baseline (signed %Δ; the qualifying gate + baseline live in lib/aerobic.ts).
  // Off-plan rides skip the intensity-vs-type branch (circular) and carry no duration target, so without
  // this they'd score almost flat on pacing + RPE alone — this is their main quality differentiator. An
  // absent signal (too little Z2, no baseline) → no effect.
  if (intrinsic && input.aerobicEffPct != null) {
    const d = input.aerobicEffPct;
    if (d >= 2 * AEROBIC_DEADBAND_PCT) score += 2; // notably above baseline = efficient/fresh aerobic day
    else if (d >= AEROBIC_DEADBAND_PCT) score += 1;
    else if (d <= -2 * AEROBIC_DEADBAND_PCT) score -= 2; // well below = aerobic strain (fatigue / heat / under-fuel)
    else if (d <= -AEROBIC_DEADBAND_PCT) score -= 1;
  }

  // --- Pacing smoothness via variability index (±1) ---
  // VI = NP / avg power. ~1.0 means perfectly steady; higher means surgy.
  // Only meaningful for steady session types — intervals (VO2max/SIT) are meant
  // to be variable, so they are left neutral.
  if (variabilityIndex !== null && plannedType) {
    const vi = variabilityIndex;
    switch (plannedType) {
      case "Z2":
      case "Recovery":
        if (vi <= 1.06) score += 1; // held the zone steadily, as intended — a bonus only.
        // No penalty for high VI: outdoor easy rides are naturally surgy (terrain), which is not a
        // discipline failure. The HR read is the sole "too hard" judge for easy rides.
        break;
      case "Threshold":
        if (vi <= 1.08) score += 1; // well-controlled threshold effort
        else if (vi >= 1.15) score -= 1;
        break;
    }
  }

  // --- Effort: RPE vs intensity (±1) ---
  // Expected RPE ≈ IF×10. If it felt much harder than the power warrants, that's a
  // fatigue/struggle flag (−1); strong output at controlled RPE is a good day (+1).
  if (rpe !== null && intensityFactor !== null) {
    const expected = Math.max(1, Math.min(10, intensityFactor * 10));
    const gap = rpe - expected;
    if (gap >= 2.5) score -= 1;
    else if (gap <= -2 && intensityFactor >= 0.85) score += 1;
  }

  return Math.min(10, Math.max(1, Math.round(score)));
}

// Fraction (0–1) of measured in-zone time spent ABOVE the Z2 aerobic cap — power zones 3+ (Tempo and
// harder) — from synced power-zone seconds [z1..z7]. The direct measure of easy-ride discipline that a
// ride's AVERAGE IF hides: a Z2 ride can average 0.68 while spending a fifth of its time surging into
// Z4. Returns null when there's no usable zone data, so scoring falls back to its other signals.
// Pure + defensive: ignores non-finite/negative buckets; a missing top zone simply isn't counted.
export function timeAboveZ2Fraction(powerZoneTimes: number[] | null | undefined): number | null {
  if (!Array.isArray(powerZoneTimes) || powerZoneTimes.length < 3) return null;
  const secs = powerZoneTimes.map((s) => (typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 0));
  const total = secs.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const aboveCap = secs.slice(2).reduce((a, b) => a + b, 0); // zones 3+ (index 2 onward) = above the Z2 cap
  return aboveCap / total;
}

// Fraction (0–1) of measured HR-zone time spent ABOVE the aerobic ceiling — HR zones 3+ (above Z2) —
// from synced HR-zone seconds. The terrain-immune counterpart to timeAboveZ2Fraction: outdoors you
// cannot hold Z2 POWER (descents, rollers, restarts, corners spike watts), but the HEART reflects the
// ride's true physiological cost, so this is what decides whether an "easy" ride was actually easy.
// Returns null when there's no usable HR-zone data, so scoring falls back to its other signals.
// Pure + defensive: ignores non-finite/negative buckets; a missing top zone simply isn't counted.
export function timeAboveAerobicHrFraction(hrZoneTimes: number[] | null | undefined): number | null {
  if (!Array.isArray(hrZoneTimes) || hrZoneTimes.length < 3) return null;
  const secs = hrZoneTimes.map((s) => (typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 0));
  const total = secs.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const above = secs.slice(2).reduce((a, b) => a + b, 0); // HR zones 3+ (index 2 onward) = above the aerobic cap
  return above / total;
}

// Research-grounded easy-ride discipline bands, on the HR-time-above-aerobic fraction. A single easy
// ride should be ~100% aerobic (80/20 polarized principle); ≤10% above tolerates terrain-driven HR bumps
// (climbs, the odd brief effort); >25% means the HEART sat above the aerobic ceiling for a quarter-plus of
// the ride — it genuinely wasn't an easy ride. Friel's LTHR Zone-2 ceiling (~89% LTHR) = the top of HR
// zone 2, so "above zone 2" is the physiological line these bands sit on.
export const AEROBIC_HR_DIALED_MAX = 0.10;
export const AEROBIC_HR_DRIFT_MAX = 0.25;

export type AerobicDiscipline = "dialed" | "drift" | "hot";

// Map the HR-time-above-aerobic fraction to a lenient three-state read. Null (no HR-zone data) → no read,
// and the scorer applies no HR penalty (an easy ride with no HR monitor rests on duration + power bonuses).
export function aerobicDisciplineRead(aboveAerobicHrFrac: number | null | undefined): AerobicDiscipline | null {
  if (aboveAerobicHrFrac == null || !Number.isFinite(aboveAerobicHrFrac)) return null;
  if (aboveAerobicHrFrac <= AEROBIC_HR_DIALED_MAX) return "dialed";
  if (aboveAerobicHrFrac <= AEROBIC_HR_DRIFT_MAX) return "drift";
  return "hot";
}

export function executionScoreLabel(score: number): string {
  if (score >= 9) return "Excellent";
  if (score >= 7) return "Good";
  if (score >= 5) return "Adequate";
  if (score >= 3) return "Below target";
  return "Poor";
}

// Compliance and execution are distinct axes — compliance is macro ("did you complete the
// prescribed session?"), execution is granular quality (1–10). But they are not independent
// when execution is poor: a session executed below "adequate" (5/10) was not truly carried
// out, so its compliance is capped by execution. This is the trust guarantee — 100%
// compliance can never sit next to a 1/10 execution. Above adequate the axes stand alone.
// Deterministic and defensive: null-safe, clamps negatives, caps overshoot at 100%.
export function resolveCompliance(durationCompliancePct: number | null, executionScore: number | null): number | null {
  if (durationCompliancePct === null) return null;
  const dur = Math.max(0, durationCompliancePct);
  if (executionScore === null) return Math.min(dur, 100);
  const ceiling = executionScore >= 5 ? 100 : Math.round(executionScore * 18); // 1→18 … 4→72
  return Math.min(dur, ceiling);
}
