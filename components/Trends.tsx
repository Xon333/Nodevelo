"use client";

import { useQuery } from "@tanstack/react-query";
import { api, timeAgo } from "@/lib/client-api";
import Sparkline from "./Sparkline";
import MultiSparkline, { type MultiSeries } from "./MultiSparkline";
import { Card, StatTile } from "./ui";
import { useSync } from "./SyncProvider";
import type { TrendsData } from "./trends/types";
import { BlockTimeline, ScoreBars, WeeklyVolumeBars, baselineCards, trendDir } from "./trends/sections";

// The /trends page — a fetch-and-lay-out shell. The payload type, the standalone chart sections
// (block timeline, execution-score bars, weekly-volume bars) and their helpers live in ./trends/*
// (RV-8 split of the old 508-line file).
export default function Trends() {
  // Keyed on the last sync time so it re-fetches whenever a sync completes (execution quality +
  // compliance-by-type reflect the latest scores). TanStack Query also refetches on tab focus /
  // reconnect and dedups/retries — same data layer as the main sync state.
  const { state } = useSync();
  const syncedAt = state?.lastSync?.syncedAt ?? null;
  const { data, error } = useQuery({
    queryKey: ["trends", syncedAt],
    queryFn: () => api<TrendsData>("/api/trends"),
  });

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        {error instanceof Error ? error.message : "Failed to load trends"}
      </div>
    );
  }
  if (!data) return <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;

  const noData = !data.syncedAt;
  const efTrend = trendDir(data.ef, true);
  const ctlTrend = trendDir(data.ctl, true);
  const cards = baselineCards(data.baselines, data.recent?.wkgAtThreshold ?? null);

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
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">synced {timeAgo(data.syncedAt)}</span>
        )}
      </div>

      {noData && (
        <p className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          No synced data yet. Sync from the dashboard to populate trends.
        </p>
      )}

      {data.recent &&
        (data.recent.latestWeightKg != null ||
          data.recent.load7Day != null ||
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
              <StatTile label="7-day load" value={data.recent.load7Day != null ? String(data.recent.load7Day) : "—"} />
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
          <p className="mt-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
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
            <p className="rounded-md bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              {data.validation.pending} intervention{data.validation.pending === 1 ? "" : "s"} recorded — outcomes evaluate after ~4 weeks.
            </p>
          )}
          <p className="mt-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
            Whether acting on each past insight actually moved execution or a physiological marker — the closed learning loop.
          </p>
        </Card>
      )}

      {/* Fitness pair — aerobic efficiency vs. fitness trajectory, side by side to correlate */}
      {(data.ef.length >= 3 || data.ctl.length >= 3) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.ef.length >= 3 && (
            <Card title="Pw:HR — power-to-heart-rate" hint={`${data.ef.length} outdoor rides · ≥45 min`}>
              <div className="mb-1 flex items-center justify-between">
                <span className={`text-xs font-medium ${efTrend.cls}`}>{efTrend.label}</span>
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  latest {data.ef[data.ef.length - 1].value.toFixed(2)}
                </span>
              </div>
              <Sparkline points={data.ef} format={(v) => v.toFixed(2)} />
              <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
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
                tipAccentClass="stroke-zinc-300 dark:stroke-[#00d4ff]/40"
              />
            </Card>
          )}
        </div>
      )}

      {/* Execution quality + recent baselines — compact pair so they stop spreading wide. */}
      {(data.scores.length >= 2 || cards.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.scores.length >= 2 && (
            <Card
              title="Execution quality"
              hint="per-ride completion score"
              tip="How completely you delivered each session (1–10): duration × power against the plan, over your last 24 matched rides. Taller / greener = better execution; the immutable score the coach and trends read from."
            >
              <ScoreBars scores={data.scores} />
            </Card>
          )}
          {cards.length > 0 && (
            <Card title="Recent baselines" hint="rolling 90 days">
              <div className="grid grid-cols-2 gap-2">
                {cards.map((c) => (
                  <StatTile key={c.label} label={c.label} value={c.value} />
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Weekly volume — the landing view for the Today trend-pulse "Weekly volume" tile (UX-2).
          Half-width to match the Execution-quality card; the right column is left empty by design. */}
      {data.weeklyHours.length >= 2 && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card
            title="Weekly volume"
            hint="ride hours · complete weeks"
            tip="Total ride hours per complete week over the last ~16 weeks (the in-progress week is excluded). Bar height and blue shade both track weekly training volume — your consistency and ramp at a glance."
          >
            <WeeklyVolumeBars weeks={data.weeklyHours} />
          </Card>
        </div>
      )}

      {/* Fueling & weight — kept wide; it carries three weekly series */}
      {energyHasData && (
        <Card title="Fueling & weight" hint="complete weeks · tap to isolate">
          <MultiSparkline series={energySeries} />
          <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
            Per complete week: total ride burn (kJ≈kcal) and total intake against the week&apos;s median weight, each on its own scale. The current in-progress week is excluded until it closes. Tap a legend chip to show/hide; isolating one fills the area.
          </p>
        </Card>
      )}

      {/* Block history — the long archive, at the bottom */}
      <BlockTimeline blocks={data.blocks} />
    </div>
  );
}
