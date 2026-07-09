"use client";

import { useMemo } from "react";
import { deriveTrendsVerdict, type VerdictAxis } from "@/lib/trends-verdict";
import type { Insight } from "@/lib/types";
import { Card, InfoDot } from "../ui";
import type { TrendsData } from "./types";

// Fold-1 of /trends (UX v2 §5): the one-sentence three-axis verdict — each axis linking to its
// group below, derivation stated per axis (Constitution §5) — then the ranked coach insights
// with their validation marks: top 3 visible, the rest (and the track record) one disclosure away.

const DIR_CLS: Record<string, string> = {
  up: "text-green-600 dark:text-emerald-400",
  steady: "text-zinc-600 dark:text-zinc-300",
  down: "text-amber-600 dark:text-amber-400",
};

const WORD_CLS: Record<string, string> = {
  Improving: "text-green-600 dark:text-emerald-400",
  Holding: "text-zinc-800 dark:text-zinc-100",
  Mixed: "text-amber-600 dark:text-amber-400",
  Slipping: "text-red-600 dark:text-red-400",
};

const AXIS_GROUP: Record<VerdictAxis["key"], string> = {
  engine: "#group-engine",
  delivery: "#group-delivery",
  fueling: "#group-fuel",
};

export function VerdictStrip({ data }: { data: TrendsData }) {
  const verdict = useMemo(
    () => deriveTrendsVerdict({ ctl: data.ctl, ef: data.ef, scores: data.scores, energy: data.energy }),
    [data]
  );
  if (!verdict.word) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
        Not enough history for a verdict yet — it appears once a few weeks of rides and scores accumulate.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
      <span className={`text-xl font-bold ${WORD_CLS[verdict.word]}`}>{verdict.word}</span>
      <span aria-hidden className="text-zinc-400 dark:text-zinc-500">—</span>
      {verdict.axes.map((axis, i) => (
        <span key={axis.key} className="flex items-baseline gap-1 text-sm">
          {axis.dir ? (
            <a href={AXIS_GROUP[axis.key]} className={`font-medium hover:underline ${DIR_CLS[axis.dir]}`}>
              {axis.label}
            </a>
          ) : (
            <span className="text-zinc-500 dark:text-zinc-400">{axis.label}</span>
          )}
          <InfoDot text={axis.derivation} align={axis.key === "fueling" ? "right" : "left"} />
          {i < verdict.axes.length - 1 && <span aria-hidden className="ml-1 text-zinc-300 dark:text-zinc-600">·</span>}
        </span>
      ))}
    </div>
  );
}

// Ranked: alert (act) first, then watch, then good — stable within a severity.
const SEV_RANK: Record<Insight["severity"], number> = { alert: 0, watch: 1, good: 2 };

export function InsightsFold({
  insights,
  validation,
  recentInterventions,
}: {
  insights: Insight[];
  validation: TrendsData["validation"];
  recentInterventions: TrendsData["recentInterventions"];
}) {
  // Narrowed const (not a bare boolean) so TypeScript keeps the non-null type inside the JSX.
  const track = validation !== null && (validation.evaluated > 0 || validation.pending > 0) ? validation : null;
  // Hidden ≠ deleted (final-review F1): with no current insights the card still renders when a
  // track record exists — the closed learning loop must stay reachable (pre-wave it was its own card).
  if (insights.length === 0 && track === null) return null;
  const ranked = [...insights].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const top = ranked.slice(0, 3);
  const rest = ranked.slice(3);
  // Validation mark: this dimension's matured hit rate, when any insight of its kind has been
  // evaluated (Constitution §5: has this kind of advice been right before?).
  const mark = (dimension: string) => {
    const d = validation?.byDimension.find((x) => x.dimension === dimension);
    return d && d.hitRate !== null ? d : null;
  };
  const row = (ins: Insight, i: number) => {
    const dot = ins.severity === "alert" ? "bg-red-500" : ins.severity === "watch" ? "bg-amber-500" : "bg-green-500";
    const m = mark(ins.dimension);
    return (
      <li key={`${ins.dimension}-${i}`} className="flex items-start gap-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
            {ins.title}
            {m && (
              <span
                title={`How often acting on matured ${ins.dimension} insights proved right (${m.validated} validated of ${m.validated + m.refuted + m.inconclusive} evaluated).`}
                className="ml-1.5 font-mono text-[10px] font-normal text-green-700 dark:text-emerald-400"
              >
                ✓ {Math.round(m.hitRate! * 100)}%
              </span>
            )}
          </p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {ins.evidence} <span className="text-zinc-700 dark:text-zinc-300">→ {ins.suggestion}</span>
          </p>
        </div>
      </li>
    );
  };
  return (
    <Card title="Coach insights" hint="ranked · learned from your execution history">
      {top.length > 0 && <ul className="space-y-1.5">{top.map(row)}</ul>}
      {(rest.length > 0 || track !== null) && (
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {rest.length > 0 ? `${rest.length} more · track record` : "Track record"}
          </summary>
          {rest.length > 0 && <ul className="mt-2 space-y-1.5">{rest.map((ins, i) => row(ins, top.length + i))}</ul>}
          {track && (
            <div className="mt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Insight track record · {track.evaluated} evaluated · {track.pending} pending
              </p>
              {recentInterventions.length > 0 ? (
                <ul className="mt-1.5 space-y-1.5">
                  {recentInterventions.map((iv, i) => {
                    const ivDot =
                      iv.verdict === "validated" ? "bg-green-500" : iv.verdict === "refuted" ? "bg-red-500" : "bg-zinc-400";
                    const deltas = [
                      iv.execDelta != null ? `exec ${iv.execDelta > 0 ? "+" : ""}${iv.execDelta}` : null,
                      iv.physDelta != null ? `${iv.physMetric} ${iv.physDelta > 0 ? "+" : ""}${iv.physDelta}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li key={i} className="flex items-start gap-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${ivDot}`} />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-zinc-800 dark:text-zinc-100">{iv.title}</p>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            <span className="uppercase tracking-wide">{iv.verdict}</span>
                            {deltas ? ` · ${deltas}` : ""} · since {iv.firedAt}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-1.5 rounded-md bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  {track.pending} intervention{track.pending === 1 ? "" : "s"} recorded — outcomes evaluate after ~4 weeks.
                </p>
              )}
              <p className="mt-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                Whether acting on each past insight actually moved execution or a physiological marker — the closed learning loop.
              </p>
            </div>
          )}
        </details>
      )}
      {insights.length > 0 && (
        <p className="mt-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">These also steer the next block you generate.</p>
      )}
    </Card>
  );
}
