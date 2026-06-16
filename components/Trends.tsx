"use client";

import { useEffect, useState } from "react";
import { api, timeAgo } from "@/lib/client-api";
import type { Insight, RollingBaselines, WorkoutType } from "@/lib/types";
import { TYPE_STYLES } from "@/lib/workout-types";
import Sparkline, { type SparkPoint } from "./Sparkline";
import MultiSparkline, { type MultiSeries } from "./MultiSparkline";
import { Card, StatTile, CyberFrame } from "./ui";
import { useSync } from "./SyncProvider";

type Point = SparkPoint;
interface TrendBlock {
  goal: string;
  startDate: string;
  endDate: string;
  lengthWeeks: number;
  complianceByType: Partial<Record<WorkoutType, number>> | null;
  ctlGain: number | null;
  actualHours: number | null;
  plannedHours: number | null;
  nextBlockSeeds: string[] | null;
}
interface ScoreEntry {
  date: string;
  executionScore: number;
  plannedType: WorkoutType | null;
  inferredType: WorkoutType;
  planned: boolean;
}
interface EnergyRow {
  date: string;
  burnKcal: number | null;
  intakeKcal: number | null;
  weightKg: number | null;
}
interface RecentSnapshot {
  latestWeightKg: number | null;
  weightTrend7Day: number | null;
  avgRpe7Day: number | null;
  lastKcalConsumed: number | null;
}
interface ValidationData {
  byDimension: Array<{ dimension: string; validated: number; refuted: number; inconclusive: number; hitRate: number | null }>;
  evaluated: number;
  pending: number;
}
interface InterventionRow {
  dimension: string;
  title: string;
  firedAt: string;
  verdict: "validated" | "refuted" | "inconclusive";
  execDelta: number | null;
  physDelta: number | null;
  physMetric: string;
}
interface TrendsData {
  ef: Point[];
  ctl: Point[];
  energy: EnergyRow[];
  blocks: TrendBlock[];
  baselines: RollingBaselines;
  scores: ScoreEntry[];
  insights: Insight[];
  recent: RecentSnapshot | null;
  validation: ValidationData | null;
  recentInterventions: InterventionRow[];
  syncedAt: string | null;
}

// ---------- shared bits ----------

function trendDir(points: Point[], higherIsBetter = true): { label: string; cls: string } {
  if (points.length < 4) return { label: "", cls: "text-zinc-400" };
  const mid = Math.floor(points.length / 2);
  const a = points.slice(0, mid).reduce((s, p) => s + p.value, 0) / mid;
  const b = points.slice(mid).reduce((s, p) => s + p.value, 0) / (points.length - mid);
  const delta = b - a;
  const eps = Math.max(0.02, Math.abs(a) * 0.02);
  if (Math.abs(delta) < eps) return { label: "→ stable", cls: "text-zinc-400" };
  const improving = higherIsBetter ? delta > 0 : delta < 0;
  return improving
    ? { label: delta > 0 ? "↑ improving" : "↓ improving", cls: "text-green-600 dark:text-emerald-400" }
    : { label: delta > 0 ? "↑ declining" : "↓ declining", cls: "text-red-500" };
}

// ---------- sections ----------

function BlockTimeline({ blocks }: { blocks: TrendBlock[] }) {
  return (
    <section className="relative rounded-none border-2 border-zinc-300 bg-white px-4 py-4 dark:border-[#00d4ff]/55 dark:bg-zinc-900 dark:shadow-[0_0_28px_-8px_rgba(0,212,255,0.45)]">
      <CyberFrame accent="cyan" />
      <div className="relative z-10">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Block history</h2>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        How each block executed and what it changed — the long view your coach reasons from.
      </p>
      {blocks.length === 0 ? (
        <p className="mt-4 rounded-md bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
          No completed blocks yet. Wrap up a block on the dashboard to start building history.
        </p>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {blocks.map((b, i) => (
            <li key={i} className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{b.goal}</span>
                  <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                    {b.lengthWeeks}w
                  </span>
                </div>
                {b.ctlGain != null && (
                  <span
                    className={`font-mono text-xs font-semibold ${
                      b.ctlGain > 0 ? "text-green-600 dark:text-emerald-400" : b.ctlGain < 0 ? "text-red-500" : "text-zinc-400"
                    }`}
                  >
                    CTL {b.ctlGain > 0 ? "+" : ""}{b.ctlGain}
                  </span>
                )}
              </div>
              <p className="mt-0.5 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                {b.startDate} → {b.endDate}
                {b.actualHours != null && b.plannedHours != null && ` · ${b.actualHours}/${b.plannedHours}h`}
              </p>
              {b.complianceByType && Object.keys(b.complianceByType).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(b.complianceByType).map(([type, pct]) => (
                    <span
                      key={type}
                      className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[10px] dark:bg-zinc-800"
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${TYPE_STYLES[type as WorkoutType]?.cell ?? "bg-zinc-400"}`} />
                      <span className="text-zinc-500 dark:text-zinc-400">{type}</span>
                      <span
                        className={`font-mono font-semibold ${
                          (pct ?? 0) >= 90 ? "text-green-600 dark:text-green-400" : (pct ?? 0) >= 75 ? "text-amber-600 dark:text-amber-400" : "text-red-500"
                        }`}
                      >
                        {pct}%
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {b.nextBlockSeeds && b.nextBlockSeeds.length > 0 && (
                <p className="mt-1.5 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                  <span className="font-medium text-zinc-600 dark:text-zinc-300">Learned: </span>
                  {b.nextBlockSeeds.join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      </div>
    </section>
  );
}

function ScoreBars({ scores }: { scores: ScoreEntry[] }) {
  const recent = scores.slice(-24);
  if (recent.length < 2) return null;
  const avg = Math.round((recent.reduce((s, e) => s + e.executionScore, 0) / recent.length) * 10) / 10;
  const barColor = (v: number) =>
    v >= 7 ? "bg-green-400 dark:bg-emerald-500/70" : v >= 5 ? "bg-amber-400 dark:bg-amber-500" : "bg-red-400 dark:bg-red-500";
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height: 56 }}>
        {recent.map((e, i) => (
          <div
            key={i}
            title={`${e.date} · ${e.plannedType ?? e.inferredType}${e.planned ? "" : " (off-plan)"} · ${e.executionScore}/10`}
            className={`min-w-[4px] flex-1 rounded-sm ${barColor(e.executionScore)}`}
            style={{ height: `${(e.executionScore / 10) * 100}%` }}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
        Avg {avg}/10 over last {recent.length} matched sessions · taller = better execution
      </p>
    </div>
  );
}

function baselineCards(b: RollingBaselines) {
  const cards: Array<{ label: string; value: string }> = [];
  if (b.avgCtl90d != null) cards.push({ label: "Avg CTL", value: b.avgCtl90d.toFixed(1) });
  if (b.avgTss90d != null) cards.push({ label: "Avg TSS / ride", value: String(Math.round(b.avgTss90d)) });
  if (b.avgDecoupling90d != null) cards.push({ label: "Avg decoupling", value: `${b.avgDecoupling90d.toFixed(1)}%` });
  if (b.avgCadence90d != null) cards.push({ label: "Avg cadence", value: `${Math.round(b.avgCadence90d)} rpm` });
  return cards;
}

// ---------- main ----------

export default function Trends() {
  const [data, setData] = useState<TrendsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Re-fetch whenever a sync completes so execution quality + compliance-by-type reflect the
  // latest scores rather than going stale after the page first mounted.
  const { state } = useSync();
  const syncedAt = state?.lastSync?.syncedAt ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api<TrendsData>("/api/trends");
        if (!cancelled) setData(d);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load trends");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [syncedAt]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        {error}
      </div>
    );
  }
  if (!data) return <p className="py-12 text-center text-sm text-zinc-400">Loading…</p>;

  const noData = !data.syncedAt;
  const efTrend = trendDir(data.ef, true);
  const ctlTrend = trendDir(data.ctl, true);
  const cards = baselineCards(data.baselines);

  const kcal = (v: number) => `${Math.round(v).toLocaleString()} kcal`;
  const energySeries: MultiSeries[] = [
    {
      label: "Burn",
      strokeClass: "stroke-amber-500 dark:stroke-amber-400",
      fillClass: "fill-amber-500 dark:fill-amber-400",
      swatchClass: "bg-amber-500 dark:bg-amber-400",
      textClass: "text-amber-600 dark:text-amber-400",
      format: kcal,
      points: data.energy.filter((e) => e.burnKcal != null).map((e) => ({ date: e.date, value: e.burnKcal as number })),
    },
    {
      label: "Intake",
      strokeClass: "stroke-sky-500 dark:stroke-[#00d4ff]",
      fillClass: "fill-sky-500 dark:fill-[#00d4ff]",
      swatchClass: "bg-sky-500 dark:bg-[#00d4ff]",
      textClass: "text-sky-600 dark:text-[#00d4ff]",
      format: kcal,
      points: data.energy.filter((e) => e.intakeKcal != null).map((e) => ({ date: e.date, value: e.intakeKcal as number })),
    },
    {
      label: "Weight",
      strokeClass: "stroke-emerald-500 dark:stroke-[#ff49c8]",
      fillClass: "fill-emerald-500 dark:fill-[#ff49c8]",
      swatchClass: "bg-emerald-500 dark:bg-[#ff49c8]",
      textClass: "text-emerald-600 dark:text-[#ff49c8]",
      format: (v) => `${v.toFixed(1)} kg`,
      points: data.energy.filter((e) => e.weightKg != null).map((e) => ({ date: e.date, value: e.weightKg as number })),
    },
  ];
  const energyHasData = energySeries.some((s) => s.points.length >= 2);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Trends</h1>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            What your second brain has learned over time — not a duplicate of intervals.icu.
          </p>
        </div>
        {data.syncedAt && (
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">synced {timeAgo(data.syncedAt)}</span>
        )}
      </div>

      {noData && (
        <p className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-center text-sm text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500">
          No synced data yet. Sync from the dashboard to populate trends.
        </p>
      )}

      {data.recent &&
        (data.recent.latestWeightKg != null ||
          data.recent.avgRpe7Day != null ||
          data.recent.lastKcalConsumed != null) && (
          <Card title="Last 7 days" hint="recent snapshot">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile
                label="Latest weight"
                value={data.recent.latestWeightKg != null ? `${data.recent.latestWeightKg.toFixed(1)} kg` : "—"}
              />
              <StatTile
                label="7-day trend"
                value={
                  data.recent.weightTrend7Day != null
                    ? `${data.recent.weightTrend7Day > 0 ? "+" : ""}${data.recent.weightTrend7Day.toFixed(1)} kg`
                    : "—"
                }
              />
              <StatTile label="Avg RPE" value={data.recent.avgRpe7Day != null ? `${data.recent.avgRpe7Day}/10` : "—"} />
              <StatTile
                label="Last intake"
                value={data.recent.lastKcalConsumed != null ? `${data.recent.lastKcalConsumed} kcal` : "—"}
              />
            </div>
          </Card>
        )}

      {data.insights.length > 0 && (
        <Card title="Coach insights" hint="learned from your execution history">
          <ul className="space-y-1.5">
            {data.insights.map((ins, i) => {
              const dot =
                ins.severity === "alert"
                  ? "bg-red-500"
                  : ins.severity === "watch"
                  ? "bg-amber-500"
                  : "bg-green-500";
              return (
                <li key={i} className="flex items-start gap-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{ins.title}</p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {ins.evidence} <span className="text-zinc-700 dark:text-zinc-300">→ {ins.suggestion}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
            These also steer the next block you generate.
          </p>
        </Card>
      )}

      {data.validation && (data.validation.evaluated > 0 || data.validation.pending > 0) && (
        <Card
          title="Insight track record"
          hint={`${data.validation.evaluated} evaluated · ${data.validation.pending} pending`}
        >
          {data.recentInterventions.length > 0 ? (
            <ul className="space-y-1.5">
              {data.recentInterventions.map((iv, i) => {
                const dot =
                  iv.verdict === "validated" ? "bg-green-500" : iv.verdict === "refuted" ? "bg-red-500" : "bg-zinc-400";
                const deltas = [
                  iv.execDelta != null ? `exec ${iv.execDelta > 0 ? "+" : ""}${iv.execDelta}` : null,
                  iv.physDelta != null ? `${iv.physMetric} ${iv.physDelta > 0 ? "+" : ""}${iv.physDelta}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={i} className="flex items-start gap-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
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
            <p className="rounded-md bg-zinc-50 px-3 py-3 text-xs text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
              {data.validation.pending} intervention{data.validation.pending === 1 ? "" : "s"} recorded — outcomes evaluate after ~4 weeks.
            </p>
          )}
          <p className="mt-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
            Whether acting on each past insight actually moved execution or a physiological marker — the closed learning loop.
          </p>
        </Card>
      )}

      {/* Fitness pair — aerobic efficiency vs. fitness trajectory, side by side to correlate */}
      {(data.ef.length >= 3 || data.ctl.length >= 3) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.ef.length >= 3 && (
            <Card title="Pw:HR — power-to-heart-rate" hint={`${data.ef.length} rides · ≥45 min`}>
              <div className="mb-1 flex items-center justify-between">
                <span className={`text-xs font-medium ${efTrend.cls}`}>{efTrend.label}</span>
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  latest {data.ef[data.ef.length - 1].value.toFixed(2)}
                </span>
              </div>
              <Sparkline points={data.ef} format={(v) => v.toFixed(2)} />
              <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                Power-to-HR on steady endurance rides. Rising = more output at the same HR = better aerobic base.
              </p>
            </Card>
          )}
          {data.ctl.length >= 3 && (
            <Card title="Fitness trajectory — CTL" hint="last ~6 months">
              <div className="mb-1 flex items-center justify-between">
                <span className={`text-xs font-medium ${ctlTrend.cls}`}>{ctlTrend.label}</span>
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  now {data.ctl[data.ctl.length - 1].value.toFixed(1)}
                </span>
              </div>
              <Sparkline
                points={data.ctl}
                format={(v) => v.toFixed(1)}
                strokeClass="stroke-purple-400 dark:stroke-[#00d4ff]/70"
                dotClass="fill-purple-500 dark:fill-[#00d4ff]"
                tipTextClass="fill-zinc-800 dark:fill-[#00d4ff]"
              />
            </Card>
          )}
        </div>
      )}

      {/* Execution quality — the single completion-anchored index (duration-aware, capped).
          The old "compliance by session type" card was removed: it told the same story. */}
      {data.scores.length >= 2 && (
        <Card title="Execution quality" hint="per-ride completion score, accumulating">
          <ScoreBars scores={data.scores} />
        </Card>
      )}

      {/* Fueling & weight — kept wide; it carries three weekly series */}
      {energyHasData && (
        <Card title="Fueling & weight" hint="weekly · tap to isolate">
          <MultiSparkline series={energySeries} />
          <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
            Per week: total ride burn (kJ≈kcal) and total intake against the week&apos;s median weight, each on its own scale. Fills in over a few weeks. Tap a legend chip to show/hide; isolating one fills the area.
          </p>
        </Card>
      )}

      {cards.length > 0 && (
        <Card title="Recent baselines" hint="rolling 90 days">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {cards.map((c) => (
              <StatTile key={c.label} label={c.label} value={c.value} />
            ))}
          </div>
        </Card>
      )}

      {/* Block history — the long archive, at the bottom */}
      <BlockTimeline blocks={data.blocks} />
    </div>
  );
}
