import { originOf } from "./ride-origin";
import type { EffectiveOutcome, IntentOverlay, NotScoredReason, ResolvedRide, RideScoreEntry } from "./types";

const NO_TRUSTWORTHY_INTENT: ReadonlySet<NotScoredReason> = new Set([
  "no-intent-found",
  "interpreter-failed",
  "intent-unreliable",
]);

function isCoherent(overlay: IntentOverlay): boolean {
  if ((overlay.effectiveExecutionScore === null) !== (overlay.notScoredReason !== null)) return false;
  if ((overlay.effectiveExecutionScore === null) !== (overlay.scoringVersion === null)) return false;
  if (
    overlay.notScoredReason &&
    NO_TRUSTWORTHY_INTENT.has(overlay.notScoredReason) &&
    overlay.origin !== "unspecified"
  ) {
    return false;
  }
  return true;
}

export function isApplicable(overlay: IntentOverlay): boolean {
  return overlay.status === "active" && overlay.supersededBy === null && isCoherent(overlay);
}

function newestApplicable(
  overlays: IntentOverlay[],
  keyOf: (overlay: IntentOverlay) => string
): Map<string, IntentOverlay> {
  const indexed = new Map<string, IntentOverlay>();
  for (const overlay of overlays) {
    if (!isApplicable(overlay)) continue;
    const key = keyOf(overlay);
    if (!key) continue;
    const previous = indexed.get(key);
    if (!previous || overlay.createdAt > previous.createdAt) indexed.set(key, overlay);
  }
  return indexed;
}

export function indexOverlaysByActivity(overlays: IntentOverlay[]): Map<string, IntentOverlay> {
  return newestApplicable(overlays, (overlay) => overlay.activityId);
}

export function indexOverlaysByDate(overlays: IntentOverlay[]): Map<string, IntentOverlay> {
  return newestApplicable(overlays, (overlay) => overlay.date);
}

export function resolveEffectiveOutcome(
  entry: RideScoreEntry,
  byActivity: Map<string, IntentOverlay>,
  byDate: Map<string, IntentOverlay>
): EffectiveOutcome {
  const ledger: EffectiveOutcome = {
    effectiveExecutionScore: entry.executionScore,
    origin: originOf(entry),
    source: "ledger",
    overlay: null,
  };
  if (entry.planned) return ledger;

  const matched = entry.activityId ? byActivity.get(entry.activityId) : byDate.get(entry.date);
  if (!matched) return ledger;
  return {
    effectiveExecutionScore: matched.effectiveExecutionScore,
    origin: matched.origin,
    source: "overlay",
    overlay: matched,
  };
}

export function resolveAll(entries: RideScoreEntry[], overlays: IntentOverlay[]): ResolvedRide[] {
  const byActivity = indexOverlaysByActivity(overlays);
  const byDate = indexOverlaysByDate(overlays);
  return entries.map((entry) => ({ entry, outcome: resolveEffectiveOutcome(entry, byActivity, byDate) }));
}
