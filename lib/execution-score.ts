// Deterministic 1-10 ride execution quality score.
// Based on: interval-target adherence (when an interval workout was prescribed) or
// duration compliance, intensity appropriateness, effort (RPE vs intensity), aerobic
// decoupling, and pacing smoothness (variability index). No AI.

export interface ExecutionScoreInput {
  compliancePct: number | null;
  intensityFactor: number | null;
  plannedType: string | null;
  decoupling: number | null;
  variabilityIndex: number | null; // NP / avg power; ~1.0 = perfectly steady
  adherencePct?: number | null; // avg interval power vs prescribed target (interval days)
  rpe?: number | null; // perceived exertion 1-10
  // Off-plan ride: the type was inferred FROM intensity, so scoring intensity against that
  // type would be circular. When set, the intensity-vs-type branch is skipped and the score
  // rests on the intent-independent signals (decoupling, pacing, RPE).
  intrinsic?: boolean;
}

export function computeExecutionScore(input: ExecutionScoreInput): number | null {
  const { compliancePct, intensityFactor, plannedType, decoupling, variabilityIndex } = input;
  const adherencePct = input.adherencePct ?? null;
  const rpe = input.rpe ?? null;
  const intrinsic = input.intrinsic ?? false;

  // Need at least one meaningful signal to produce a score.
  if (compliancePct === null && intensityFactor === null && decoupling === null && adherencePct === null) return null;

  let score = 5; // baseline

  // --- Execution: interval-target adherence (±2) takes precedence over duration when
  // an interval workout was prescribed; hitting the watts matters more than ride length.
  if (adherencePct !== null) {
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

  // --- Aerobic execution via decoupling (±2) ---
  if (decoupling !== null) {
    if (decoupling < 2) score += 2;
    else if (decoupling < 4) score += 1;
    else if (decoupling < 7) score += 0;
    else if (decoupling < 10) score -= 1;
    else score -= 2;
  }

  // --- Intensity vs planned type (±2) --- skipped for off-plan rides (would be circular)
  if (intensityFactor !== null && plannedType && !intrinsic) {
    const IF = intensityFactor;
    switch (plannedType) {
      case "Z2":
        if (IF >= 0.60 && IF <= 0.74) score += 1;
        else if (IF > 0.74 && IF <= 0.82) score -= 1;
        else if (IF > 0.82) score -= 2;
        else if (IF < 0.52) score -= 1;
        break;
      case "Recovery":
        if (IF < 0.60) score += 1;
        else if (IF >= 0.70) score -= 2;
        else score -= 1;
        break;
      case "Threshold":
        if (IF >= 0.82 && IF <= 0.92) score += 2;
        else if (IF >= 0.78 && IF <= 0.96) score += 1;
        else if (IF < 0.74 || IF > 1.05) score -= 2;
        else score -= 1;
        break;
      case "VO2max":
        if (IF >= 0.90 && IF <= 1.10) score += 2;
        else if (IF >= 0.86 && IF <= 1.15) score += 1;
        else if (IF < 0.80) score -= 2;
        break;
      case "SIT":
        if (IF >= 1.00) score += 2;
        else if (IF >= 0.90) score += 1;
        else score -= 1;
        break;
      case "RaceSim":
        // Race-sim is hard + surgy — reward a genuinely high, variable effort; penalise a soft one.
        if (IF >= 0.80 && IF <= 0.95) score += 2;
        else if (IF >= 0.75 && IF <= 1.0) score += 1;
        else if (IF < 0.70) score -= 2;
        break;
    }
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
        if (vi <= 1.06) score += 1; // held the zone steadily, as intended
        else if (vi >= 1.12) score -= 1; // surgy easy ride — didn't ride to plan
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
