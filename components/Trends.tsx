"use client";

import { useQuery } from "@tanstack/react-query";
import { api, timeAgo } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import Sparkline from "./Sparkline";
import MultiSparkline, { type MultiSeries } from "./MultiSparkline";
import { Card, SectionDivider, Skeleton, SkeletonScreen, StatTile } from "./ui";
import { useSync } from "./SyncProvider";
import type { TrendsData } from "./trends/types";
import { BlockTimeline, DeliveryCard, WeeklyVolumeBars, baselineCards, trendDir } from "./trends/sections";
import { InsightsFold, VerdictStrip } from "./trends/verdict";

// The /trends page — a fetch-and-lay-out shell over ./trends/* (RV-8 split). UX v2 §5 layout:
// verdict strip + ranked insights fold-1, then four named groups (ENGINE / DELIVERY / LOAD & FUEL /
// MILESTONES), group gap 2× the card gap. The old recent-snapshot tile row is gone — its tenants
// live in the Load & fuel card (weight/intake) and on Plan's week panel (7-day load).
export default function Trends() {
  // Keyed on the last sync time so it re-fetches whenever a sync completes; TanStack Query also
  // refetches on tab focus / reconnect and dedups/retries — same data layer as the main sync state.
  const { state } = useSync();
  const syncedAt = state?.lastSync?.syncedAt ?? null;
  const { data, error } = useQuery({
    queryKey: ["trends", syncedAt],
    queryFn: () => api<TrendsData>(`/api/trends?today=${localToday()}`),
  });

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        {error instanceof Error ? error.message : "Failed to load trends"}
      </div>
    );
  }
  if (!data) {
    // S3-1: mirrors the loaded scaffold (title → verdict strip → insights → grouped chart cards).
    return (
      <SkeletonScreen className="space-y-6">
        <div>
          <Skeleton className="h-6 w-28" />
          <Skeleton className="mt-1.5 h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-14" />
        <Skeleton className="h-36" />
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
        <Skeleton className="h-56" />
      </SkeletonScreen>
    );
  }

  const noData = !data.syncedAt;
  const efTrend = trendDir(data.ef, true);
  const ctlTrend = trendDir(data.ctl, true);
  const cards = baselineCards(data.baselines, data.recent?.wkgAtThreshold ?? null, data.recent?.wkgStale ?? false);

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
  // The killed tile row's surviving tenants, as a quiet stat line inside the Load & fuel card.
  const fuelStats = [
    data.recent?.latestWeightKg != null ? `weight ${data.recent.latestWeightKg.toFixed(1)} kg` : null,
    data.recent?.weightTrend7Day != null
      ? `${data.recent.weightTrend7Day > 0 ? "+" : ""}${data.recent.weightTrend7Day.toFixed(1)} kg/7d`
      : null,
    data.recent?.lastKcalConsumed != null ? `last intake ${data.recent.lastKcalConsumed} kcal` : null,
  ].filter((s): s is string => s !== null);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Trends</h1>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Am I improving?</p>
        </div>
        {data.syncedAt && (
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">synced {timeAgo(data.syncedAt)}</span>
        )}
      </div>

      {noData ? (
        <p className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          No synced data yet. Sync from the dashboard to populate trends.
        </p>
      ) : (
        <>
          {/* Fold-1: the page answer, then the ranked insights (top 3 + disclosure). */}
          <div className="space-y-3">
            <VerdictStrip data={data} />
            <InsightsFold
              insights={data.insights}
              validation={data.validation}
              recentInterventions={data.recentInterventions}
            />
          </div>

          {(data.ef.length >= 3 || data.ctl.length >= 3) && (
            <section id="group-engine" className="scroll-mt-4 space-y-3">
              <SectionDivider label="Engine — is the motor getting bigger?" />
              <div className="grid items-stretch gap-3 lg:grid-cols-2">
                {data.ef.length >= 3 && (
                  <Card className="h-full" title="Pw:HR — power-to-heart-rate" hint={`${data.ef.length} outdoor rides · ≥45 min`}>
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
                  <Card className="h-full" title="Fitness trajectory — CTL" hint="last ~6 months">
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
            </section>
          )}

          {(data.scores.length >= 2 || data.planVsActual.length > 0) && (
            <section id="group-delivery" className="scroll-mt-4 space-y-3">
              <SectionDivider label="Delivery — do I ride what's prescribed?" />
              <DeliveryCard scores={data.scores} planVsActual={data.planVsActual} ftpRetest={data.ftpRetest} />
            </section>
          )}

          {(energyHasData || data.weeklyHours.length >= 2) && (
            <section id="group-fuel" className="scroll-mt-4 space-y-3">
              <SectionDivider label="Load & fuel — am I feeding the work?" />
              <div className="grid items-stretch gap-3 lg:grid-cols-[1.7fr_1fr]">
                {energyHasData && (
                  <Card
                    className="h-full"
                    title="Fueling & weight"
                    hint="complete weeks · tap to isolate"
                    action={
                      fuelStats.length > 0 ? (
                        <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{fuelStats.join(" · ")}</span>
                      ) : undefined
                    }
                  >
                    <MultiSparkline series={energySeries} />
                    <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                      Per complete week: total ride burn (kJ≈kcal) and total intake against the week&apos;s median weight, each on its own scale. The current in-progress week is excluded until it closes. Tap a legend chip to show/hide; isolating one fills the area.
                    </p>
                    {(() => {
                      const withRatio = data.energy.filter((e) => e.ratio != null);
                      const last = withRatio[withRatio.length - 1];
                      if (!last) return null;
                      const pct = Math.round((last.ratio as number) * 100);
                      return (
                        <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                          Last complete week: {last.intakeKcal?.toLocaleString()} kcal eaten vs{" "}
                          {last.needKcal?.toLocaleString()} needed — {pct}% of target ({last.loggedDays}/7 days logged).
                        </p>
                      );
                    })()}
                  </Card>
                )}
                {data.weeklyHours.length >= 2 && (
                  <Card
                    className="h-full"
                    title="Weekly volume"
                    hint="context"
                    tip="Total ride hours per complete week over the last ~16 weeks (the in-progress week is excluded). Bar height and blue shade both track weekly training volume — consistency and ramp at a glance."
                  >
                    <WeeklyVolumeBars weeks={data.weeklyHours} />
                  </Card>
                )}
              </div>
            </section>
          )}

          <section id="group-milestones" className="scroll-mt-4 space-y-3">
            <SectionDivider label="Milestones" />
            {cards.length > 0 && (
              <Card title="Recent baselines" hint="rolling 90 days">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {cards.map((c) => (
                    <StatTile key={c.label} label={c.label} value={c.value} />
                  ))}
                </div>
              </Card>
            )}
            <BlockTimeline blocks={data.blocks} />
          </section>
        </>
      )}
    </div>
  );
}
