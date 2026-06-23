"use client";

import { useSync } from "./SyncProvider";
import { Card } from "./ui";

// The standing coaching directives synthesised from the athlete's execution history (the block the
// generator is handed), plus the validation track record — how often matured directives have proven
// right (ROADMAP #4). Surfacing both is the anti-black-box move: the guidance AND its hit rate.
export default function CoachDirectivesCard() {
  const { state } = useSync();
  const directives = state?.coachSnapshot?.directives ?? null;
  const acc = state?.coachAccuracy ?? null;

  const trackRecord =
    acc && (acc.hitRatePct !== null || acc.pending > 0) ? (
      acc.hitRatePct !== null ? (
        <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
          {acc.hitRatePct}% right <span className="text-zinc-400 dark:text-zinc-500">({acc.evaluated} checked)</span>
        </span>
      ) : (
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">accruing · {acc.pending} pending</span>
      )
    ) : undefined;

  return (
    <Card
      title="Coaching directives"
      tip="The standing guidance the coach distils from your execution history and feeds into every plan — and how often matured directives proved right (28-day validation horizon)."
      action={trackRecord}
    >
      {directives ? (
        <p className="whitespace-pre-wrap text-xs leading-5 text-zinc-600 dark:text-zinc-300">{directives}</p>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          No directives yet — they synthesise once there&apos;s enough execution history to spot a pattern.
        </p>
      )}
    </Card>
  );
}
