"use client";
// Phase 2c: the self-directed debrief content design §12.2 requires, extracted as its own module
// rather than grown into today.tsx's TodayRideCard (already a flagged split candidate —
// docs/systems/08-frontend.md#known-rough-edges). Renders nothing for a prescribed ride or when no
// overlay applies — TodayRideCard's existing score display already covers that case unchanged.

import type { EffectiveOutcome } from "@/lib/types";
import { AEROBIC_DRIFT_NOT_MEASURABLE, confidenceCaption, formatIntentUsed, notScoredMessage } from "@/lib/intent-display";

export function RideIntentBlock({
  outcome,
  activityDecoupling,
}: {
  outcome: EffectiveOutcome | null;
  activityDecoupling: number | null;
}) {
  const overlay = outcome?.overlay ?? null;
  if (!overlay) return null;

  const interpretation = overlay.interpretation;
  const caption = interpretation ? confidenceCaption(interpretation.confidence) : null;
  const measurable = interpretation?.objectives.filter((o) => o.measurable) ?? [];
  const qualitative = interpretation?.objectives.filter((o) => !o.measurable) ?? [];

  return (
    <div className="mb-3 space-y-2 border-l-2 border-zinc-300 pl-3 dark:border-[#00d4ff]/30">
      {interpretation && (
        <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-300">
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">Intent used: </span>
          {formatIntentUsed(interpretation.intent)}
        </p>
      )}

      {overlay.notScoredReason && (
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{notScoredMessage(overlay.notScoredReason)}</p>
      )}

      {caption && <p className="text-[11px] italic text-zinc-500 dark:text-zinc-400">{caption}</p>}

      {measurable.length > 0 && (
        <ul className="space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
          {measurable.map((o, i) => (
            <li key={i}>
              {o.description}
              {o.evidence && <span className="text-zinc-500 dark:text-zinc-400"> — {o.evidence}</span>}
            </li>
          ))}
        </ul>
      )}

      {qualitative.length > 0 && (
        <ul className="space-y-0.5 text-xs italic text-zinc-500 dark:text-zinc-400">
          {qualitative.map((o, i) => (
            // Corrected 2026-08-12: italic alone doesn't communicate "acknowledged but not graded" —
            // the label text carries the meaning, italic is styling on top of it, not instead of it.
            <li key={i}>
              <span className="font-medium not-italic">Acknowledged, not graded:</span> {o.description}
            </li>
          ))}
        </ul>
      )}

      {activityDecoupling == null && <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{AEROBIC_DRIFT_NOT_MEASURABLE}</p>}
    </div>
  );
}
