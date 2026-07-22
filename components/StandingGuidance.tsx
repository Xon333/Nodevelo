"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { DIRECTIVE_DEMOTE_DEFAULTS } from "@/lib/synthesis";
import type { Insight } from "@/lib/types";
import { useSync } from "./SyncProvider";
import { Card, LoadFailed, Skeleton } from "./ui";
import type { TrendsData } from "./trends/types";

// STANDING GUIDANCE (UX v2 §6 Model): the directives' sole owner, rendered from their structured
// source (ranked insights + per-dimension validation — the same inputs lib/synthesis.ts folds into
// the generator's directive block) instead of the synthesized text blob. One line per directive,
// evidence behind "why", validation ✓ where earned, proven-poor nudges flagged by the same demote
// rule the generator applies. Reuses the /api/trends query key → shared cache with the Trends page.
export default function StandingGuidance() {
  const { state } = useSync();
  const syncedAt = state?.lastSync?.syncedAt ?? null;
  const acc = state?.coachAccuracy ?? null;
  const { data, error, refetch } = useQuery({
    queryKey: ["trends", syncedAt],
    queryFn: () => api<TrendsData>(`/api/trends?today=${localToday()}`),
  });

  // Aggregate track record beside the guidance (Constitution §5) — canonical home since UX v2 W2.
  const trackRecord =
    acc && (acc.hitRatePct !== null || acc.pending > 0) ? (
      acc.hitRatePct !== null ? (
        <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
          {acc.hitRatePct}% right ({acc.evaluated} checked)
        </span>
      ) : (
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">accruing · {acc.pending} pending</span>
      )
    ) : undefined;

  let body: ReactNode;
  if (error) {
    body = <LoadFailed what="the standing guidance" retry={() => void refetch()} />;
  } else if (!data) {
    // UXA-9: bumped from h-24 — the live-rendered card grows to ~450px once a few dimensions of
    // directives land, so the small skeleton was itself a source of layout jump (a skeleton was
    // already shown, just undersized relative to the real content it stands in for).
    body = <Skeleton className="h-48" />;
  } else if (data.insights.length === 0) {
    body = (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        No directives yet — they synthesise once there&apos;s enough execution history to spot a pattern.
      </p>
    );
  } else {
    // Group by dimension, preserving the overall severity ranking; the dimension's matured track
    // record annotates its header (✓ where earned, proven-poor per the generator's demote rule).
    const groups = new Map<string, Insight[]>();
    for (const ins of data.insights) {
      const g = groups.get(ins.dimension);
      if (g) g.push(ins);
      else groups.set(ins.dimension, [ins]);
    }
    const trackOf = (dimension: string) =>
      data.validation?.byDimension.find((d) => d.dimension === dimension) ?? null;
    body = (
      <div className="space-y-3">
        {[...groups.entries()].map(([dimension, rows]) => {
          const t = trackOf(dimension);
          const decisive = t ? t.validated + t.refuted : 0;
          const demoted =
            t?.hitRate != null &&
            decisive >= DIRECTIVE_DEMOTE_DEFAULTS.minDecisive &&
            t.hitRate <= DIRECTIVE_DEMOTE_DEFAULTS.demoteHitRateMax;
          return (
            <div key={dimension}>
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {dimension}
                {t?.hitRate != null && !demoted && (
                  <span
                    title={`Acting on matured ${dimension} nudges proved right ${Math.round(t.hitRate * 100)}% of the time (${decisive} decisive).`}
                    className="font-mono font-normal normal-case text-green-700 dark:text-emerald-400"
                  >
                    ✓ {Math.round(t.hitRate * 100)}%
                  </span>
                )}
                {demoted && (
                  <span
                    title={`Past ${dimension} nudges worked only ${Math.round((t!.hitRate as number) * 100)}% across ${decisive} decisive blocks — the evidence stands; the coach reaches for a different lever.`}
                    className="rounded bg-amber-50 px-1.5 font-normal normal-case text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                  >
                    proven-poor lever
                  </span>
                )}
              </p>
              <ul className="mt-1 space-y-1.5">
                {rows.map((ins, i) => {
                  const dot =
                    ins.severity === "alert" ? "bg-red-500" : ins.severity === "watch" ? "bg-amber-500" : "bg-green-500";
                  return (
                    <li key={i} className="rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                      <p className="flex items-start gap-2 text-xs">
                        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                        <span className="min-w-0">
                          <span className="font-semibold text-zinc-800 dark:text-zinc-100">{ins.title}</span>
                          <span className="text-zinc-600 dark:text-zinc-300"> — {ins.suggestion}</span>
                        </span>
                      </p>
                      <details className="mt-1 pl-3.5">
                        <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                          why
                        </summary>
                        <p className="mt-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{ins.evidence}</p>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
          The same guidance, with each dimension&apos;s track record folded in, steers every block you generate.
        </p>
      </div>
    );
  }

  return (
    <Card
      title="Coaching directives"
      tip="The standing guidance distilled from your execution history — the structured view of the exact directive block the generator is handed."
      action={trackRecord}
    >
      {body}
    </Card>
  );
}
