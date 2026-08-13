// Phase 3a §10 + composition. Pure composition, no new calculation — reads WeeklyEnvelope.role for the
// Load stream, ReadinessSignal for the Recovery stream, and summariseBehaviour's BehaviourSummary for
// the Execution stream. Never calls an LLM.
import type { BehaviourSummary, NoBlockSummary, ReadinessSignal, SessionSuggestion, WeeklyEnvelope } from "./types";

const LOAD_LABEL: Record<WeeklyEnvelope["role"], string> = {
  build: "Productive training",
  maintain: "Maintaining fitness",
  recovery: "Unloading",
};

const RECOVERY_LABEL: Record<ReadinessSignal["level"], string> = {
  Build: "fresh",
  Hold: "mild fatigue",
  Recover: "accumulated fatigue",
};

function executionLabel(behaviour: BehaviourSummary): string {
  if (behaviour.totalRides === 0) return "no rides logged yet";
  if (behaviour.driftAvgQuality === null) return "execution uncertain";
  if (behaviour.driftAvgQuality >= 6.5 && behaviour.offPlanPct <= 40) return "executed consistently";
  if (behaviour.driftAvgQuality >= 5) return "execution mixed";
  return "execution uncertain";
}

export function composeNoBlockSummary(
  envelope: WeeklyEnvelope,
  suggestion: SessionSuggestion | null,
  behaviour: BehaviourSummary,
  readiness: ReadinessSignal,
  weekToDateTss: number
): NoBlockSummary {
  const headline = `${LOAD_LABEL[envelope.role]} · ${RECOVERY_LABEL[readiness.level]}`;

  const bodyParts = [
    `Weekly load is within your normal ${envelope.role} range.`,
    `Self-directed rides have been ${executionLabel(behaviour)}.`,
  ];
  if (suggestion) bodyParts.push(suggestion.reason);
  const body = bodyParts.join(" ");

  return {
    headline,
    body,
    weeklyRange: { min: envelope.range.min, max: envelope.range.max, thisWeekTss: weekToDateTss },
    suggestion,
  };
}
