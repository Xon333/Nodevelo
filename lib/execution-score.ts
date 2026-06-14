// Deterministic 1-10 ride execution quality score.
// Based on: duration compliance, intensity appropriateness, aerobic decoupling.
// No AI required — computable from fields already in TodayAnalysis.

export interface ExecutionScoreInput {
  compliancePct: number | null;
  intensityFactor: number | null;
  plannedType: string | null;
  decoupling: number | null;
}

export function computeExecutionScore(input: ExecutionScoreInput): number | null {
  const { compliancePct, intensityFactor, plannedType, decoupling } = input;

  // Need at least one meaningful signal to produce a score.
  if (compliancePct === null && intensityFactor === null && decoupling === null) return null;

  let score = 5; // baseline

  // --- Duration compliance (±2) ---
  if (compliancePct !== null) {
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

  // --- Intensity vs planned type (±2) ---
  if (intensityFactor !== null && plannedType) {
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
    }
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
