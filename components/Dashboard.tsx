"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, isStale, nextMonday } from "@/lib/client-api";
import AskCoach from "./AskCoach";
import type { AthleteMdSnapshot } from "@/lib/kb-loader";
import type {
  AcwrResult,
  BlockHistoryEntry,
  CurrentBlock,
  FatigueAlert,
  GeneratedPlan,
  IntensityDistribution,
  LoadRampAlert,
  ReadinessSignal,
  RideScoreEntry,
  SyncData,
  TodayAnalysis,
  WriteResult,
} from "@/lib/types";
import { executionScoreLabel } from "@/lib/execution-score";
import { TYPE_STYLES } from "@/lib/workout-types";
import PlanPreview from "./PlanPreview";
import RideTrace from "./RideTrace";
import TrendPulse from "./TrendPulse";
import { useSync } from "./SyncProvider";
import { Card, StatTile, CyberFrame, Zone } from "./ui";

function todayIso(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}

// ---------- Readiness badge ----------

const READINESS_STYLES: Record<ReadinessSignal["level"], string> = {
  Build:   "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
  Hold:    "bg-amber-50  text-amber-800  border-amber-200  dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
  Recover: "bg-red-50    text-red-800    border-red-200    dark:bg-red-950/60   dark:text-red-300   dark:border-red-800",
};

const ACWR_COLOR: Record<AcwrResult["level"], string> = {
  low: "text-zinc-400 dark:text-zinc-500",
  optimal: "text-green-600 dark:text-green-400",
  high: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
};

// One-line explanation shown on hover over an alert/readiness bracket. `align` flips the
// tooltip to the right edge so it doesn't clip when the anchor sits near the card's right.
function MetricTip({ text, align = "left" }: { text: string; align?: "left" | "right" }) {
  return (
    <span
      className={`pointer-events-none absolute ${
        align === "right" ? "right-0" : "left-0"
      } top-full z-30 mt-1 w-64 max-w-[80vw] rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug text-zinc-600 opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300`}
    >
      {text}
    </span>
  );
}

function ReadinessBadge({
  readiness,
  fatigueAlert,
  loadRamp,
}: {
  readiness: ReadinessSignal | null;
  fatigueAlert: FatigueAlert | null;
  loadRamp: LoadRampAlert | null;
}) {
  if (!readiness) return null;
  return (
    <div className="space-y-1.5">
      {fatigueAlert?.triggered && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-800 dark:bg-red-950/60">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
          <p className="text-xs font-medium text-red-700 dark:text-red-300">
            <span className="font-semibold">Fatigue alert — </span>{fatigueAlert.reason}
          </p>
        </div>
      )}
      {loadRamp?.triggered && (
        <div
          className={`group relative flex items-start gap-2 rounded-lg border px-3 py-2.5 ${
            loadRamp.level === "high"
              ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/60"
              : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50"
          }`}
        >
          <span
            className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${loadRamp.level === "high" ? "bg-red-500" : "bg-amber-500"}`}
          />
          <p
            className={`text-xs font-medium ${
              loadRamp.level === "high"
                ? "text-red-700 dark:text-red-300"
                : "text-amber-800 dark:text-amber-300"
            }`}
          >
            <span className="font-semibold">Load ramp — </span>{loadRamp.reason}
          </p>
          <span className="ml-auto shrink-0 self-start text-xs opacity-40">ⓘ</span>
          <MetricTip text="Flags when this week's training load jumps well above last week's — a common injury-risk signal." />
        </div>
      )}
      <div className={`group relative flex items-center gap-2.5 rounded-lg border px-3 py-2 ${READINESS_STYLES[readiness.level]}`}>
        <span className="text-xs font-semibold uppercase tracking-wider opacity-60">Readiness</span>
        <span className="text-sm font-semibold">{readiness.level}</span>
        <span className="text-xs opacity-70">— {readiness.reason}</span>
        <span className="ml-auto shrink-0 text-xs opacity-40">ⓘ</span>
        <MetricTip text="Combines your form (TSB) and recent HRV to suggest whether to build, hold, or recover today." />
      </div>
    </div>
  );
}

// ---------- Weekly debrief ----------

function WeeklyDebrief({ sync }: { sync: SyncData }) {
  const today = todayIso();
  const d = new Date();
  const dayOfWeek = d.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset);
  // Format from local components (matches todayIso() and activity start_date_local)
  // so the week boundary doesn't shift via UTC near midnight.
  const weekStart = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;

  const weekActivities = sync.activities.filter((a) => a.date >= weekStart && a.date <= today);
  const weekHours = weekActivities.reduce((s, a) => s + a.movingTimeSec, 0) / 3600;
  const weekTss = weekActivities.reduce((s, a) => s + (a.trainingLoad ?? 0), 0);
  const topSession = [...weekActivities].sort((a, b) => (b.trainingLoad ?? 0) - (a.trainingLoad ?? 0))[0];

  const cutoff7 = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const weekWellness = sync.wellness.filter((w) => w.date >= cutoff7 && w.date <= today);
  const hrvValues = weekWellness.map((w) => w.hrv).filter((v): v is number => v !== null);
  const sleepValues = weekWellness.map((w) => w.sleepHours).filter((v): v is number => v !== null);
  const avgHrv = hrvValues.length > 0 ? Math.round(hrvValues.reduce((s, v) => s + v, 0) / hrvValues.length) : null;
  const avgSleep = sleepValues.length > 0 ? (sleepValues.reduce((s, v) => s + v, 0) / sleepValues.length).toFixed(1) : null;

  if (weekActivities.length === 0 && avgHrv === null) return null;

  return (
    <Card title="This week">
      <div className="flex flex-wrap gap-2">
        <StatTile label="Hours" value={`${weekHours.toFixed(1)} h`} />
        {weekTss > 0 && <StatTile label="TSS" value={String(Math.round(weekTss))} />}
        {avgHrv !== null && <StatTile label="Avg HRV" value={String(avgHrv)} />}
        {avgSleep !== null && <StatTile label="Avg sleep" value={`${avgSleep} h`} />}
      </div>
      {topSession && (
        <div className="mt-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">Top session</p>
          <p className="mt-0.5 text-sm font-medium leading-snug text-zinc-800 dark:text-zinc-100">{topSession.name}</p>
          {topSession.trainingLoad != null && (
            <p className="mt-0.5 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{topSession.trainingLoad} TSS</p>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------- Retrospective section ----------

function RetroSection({
  block,
  generating,
  result,
  error,
  onGenerate,
}: {
  block: CurrentBlock | null;
  generating: boolean;
  result: { retrospective: string; seeds: string[]; complianceByType: Record<string, number> } | null;
  error: string | null;
  onGenerate: () => void;
}) {
  const today = todayIso();
  const blockEnded = block && block.endDate < today;

  // Show the latest retro from a history entry if we've already run it for this block.
  if (!result && !blockEnded) return null;

  if (result) {
    return (
      <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Block retrospective</h2>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-900 dark:text-[#ff49c8]/70">
            completed
          </span>
        </div>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">{result.retrospective}</p>
        {result.seeds.length > 0 && (
          <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-700">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1.5">
              Seeded into next block
            </p>
            <ul className="space-y-1">
              {result.seeds.map((s, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300 dark:bg-[#ff49c8]/40" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 dark:border-zinc-600 dark:bg-zinc-800">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-amber-900 dark:text-zinc-100">
            Block ended {block!.endDate}
          </p>
          <p className="mt-0.5 text-xs text-amber-700 dark:text-zinc-400">
            Generate a retrospective to close the block and seed the next one with insights.
          </p>
          {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <button
          onClick={onGenerate}
          disabled={generating}
          className="shrink-0 rounded-md bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-900 disabled:opacity-50 dark:bg-[#ff49c8]/20 dark:text-[#ff49c8] dark:hover:bg-[#ff49c8]/30 dark:border dark:border-[#ff49c8]/40"
        >
          {generating ? "Generating…" : "Wrap up block"}
        </button>
      </div>
    </section>
  );
}

// ---------- Zone distribution mini-bars ----------

function ZoneBars({ times, label, secondary }: { times: number[]; label: string; secondary?: boolean }) {
  const total = times.reduce((s, t) => s + t, 0);
  if (total === 0) return null;
  const pcts = times.map((t) => Math.round((t / total) * 100));
  const ZONE_COLORS = [
    "bg-blue-300 dark:bg-blue-700",
    "bg-green-400 dark:bg-green-600",
    "bg-yellow-400 dark:bg-yellow-500",
    "bg-orange-400 dark:bg-orange-500",
    "bg-red-400 dark:bg-red-500",
    "bg-red-600 dark:bg-red-700",
    "bg-red-900 dark:bg-red-900",
  ];
  return (
    <div className={secondary ? "opacity-90" : undefined}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1">{label}</p>
      <div className={`flex w-full overflow-hidden rounded gap-px ${secondary ? "h-1.5" : "h-3.5"}`}>
        {pcts.map((pct, i) =>
          pct >= 1 ? (
            <div
              key={i}
              style={{ width: `${pct}%` }}
              className={`${ZONE_COLORS[i] ?? "bg-zinc-400"} shrink-0`}
            />
          ) : null
        )}
      </div>
      <div className="mt-0.5 flex gap-2 flex-wrap">
        {pcts.map((pct, i) =>
          pct >= 1 ? (
            <span key={i} className="text-[10px] text-zinc-400 dark:text-zinc-500">
              Z{i + 1} {pct}%
            </span>
          ) : null
        )}
      </div>
    </div>
  );
}

// ---------- Today's ride analysis ----------

function TodayRideCard({
  analysis,
  onPostNote,
  notePosting,
  notePosted,
  bare,
  hideCoachNote,
}: {
  analysis: TodayAnalysis;
  onPostNote?: () => void;
  notePosting?: boolean;
  notePosted?: boolean;
  bare?: boolean;
  hideCoachNote?: boolean; // rendered separately (e.g. in the trend-pulse column)
}) {
  const plannedStyle = analysis.plannedType
    ? TYPE_STYLES[analysis.plannedType as keyof typeof TYPE_STYLES] ?? TYPE_STYLES.Z2
    : null;

  // Compliance % removed — execution (the duration/completion-aware 1–10 shown above) is the
  // single completion-anchored index; a separate macro % only duplicated the same story.
  const metrics: Array<{ label: string; value: string; highlight?: string }> = [];
  if (analysis.intensityFactor != null)
    metrics.push({ label: "IF", value: analysis.intensityFactor.toFixed(2) });
  if (analysis.activityNormalizedPower != null)
    metrics.push({ label: "NP", value: `${analysis.activityNormalizedPower}W` });
  if (analysis.activityAvgWatts != null)
    metrics.push({ label: "Avg power", value: `${analysis.activityAvgWatts}W` });
  if (analysis.activityTrainingLoad != null)
    metrics.push({ label: "TSS", value: String(analysis.activityTrainingLoad) });
  if (analysis.activityDecoupling != null)
    metrics.push({ label: "Decoupling", value: `${analysis.activityDecoupling.toFixed(1)}%` });
  if (analysis.activityRpe != null)
    metrics.push({ label: "RPE", value: `${analysis.activityRpe}/10` });

  const body = (
    <>
      {!bare && (
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Today's ride</h2>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">{analysis.activityDate}</span>
        </div>
      )}

      {/* Planned vs Actual */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Planned</p>
          {analysis.plannedName ? (
            <div className="mt-1">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{analysis.plannedName}</p>
              <div className="mt-1 flex items-center gap-2">
                {plannedStyle && (
                  <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${plannedStyle.badge}`}>
                    {analysis.plannedType}
                  </span>
                )}
                {analysis.plannedDurationMin !== null && (
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">{analysis.plannedDurationMin} min</span>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-1 text-xs text-zinc-400">No session planned</p>
          )}
        </div>

        <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Actual</p>
          <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">{analysis.activityName}</p>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{analysis.activityDurationMin} min</span>
            {analysis.activityAvgHr !== null && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{analysis.activityAvgHr} bpm avg</span>
            )}
            {analysis.activityKj !== null && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{analysis.activityKj} kJ</span>
            )}
          </div>
        </div>
      </div>

      {/* Key metrics strip */}
      {metrics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {metrics.map((m) => (
            <div key={m.label} className="rounded bg-zinc-100 px-2.5 py-1.5 dark:bg-zinc-900">
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500">{m.label}</p>
              <p className={`font-mono text-sm font-semibold text-zinc-800 ${m.highlight ? m.highlight : "dark:text-zinc-100"}`}>
                {m.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Execution score */}
      {analysis.executionScore != null && (
        <div className="mt-3 flex items-center gap-3">
          <div className="flex items-center gap-2 rounded bg-zinc-100 px-3 py-1.5 dark:bg-zinc-900">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Execution</span>
            <span className="font-mono text-sm font-bold text-zinc-800 dark:text-[#ff49c8]">
              {analysis.executionScore}/10
            </span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {executionScoreLabel(analysis.executionScore)}
            </span>
          </div>
          {onPostNote && analysis.coachNote && (
            <button
              onClick={onPostNote}
              disabled={notePosting || notePosted}
              title="Post coach note to Intervals.icu"
              className={`ml-auto shrink-0 whitespace-nowrap rounded border px-2 py-1 text-[10px] font-medium transition-colors ${
                notePosted
                  ? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
                  : "border-zinc-300 text-zinc-600 hover:border-zinc-400 hover:text-zinc-800 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
              }`}
            >
              {notePosted ? "✓ Posted" : notePosting ? "Posting…" : "↑ Post to Intervals.icu"}
            </button>
          )}
        </div>
      )}

      {/* Power execution — the card's focal group: prescription vs execution, the
          power/HR trace, and power time-in-zone. There is no separate HR zone bar;
          HR comparison lives in the trace overlay (decoupling = the gap widening). */}
      {(analysis.powerZoneTimes || analysis.trace || (analysis.intervalComparison && analysis.intervalComparison.reps.length > 0)) && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Power execution</p>

          {analysis.intervalComparison && analysis.intervalComparison.reps.length > 0 && (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Prescribed</span>
                  {analysis.intervalComparison.prescribedLabels.map((l, i) => (
                    <span key={i} className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff]">
                      {l}
                    </span>
                  ))}
                </div>
                <span
                  className="font-mono text-xs font-semibold text-zinc-700 dark:text-zinc-200"
                  title="reps that held ≥90% of prescribed duration · power × duration completion"
                >
                  {analysis.intervalComparison.completed}/{analysis.intervalComparison.total} · {analysis.intervalComparison.effectiveAdherencePct}%
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {analysis.intervalComparison.reps.map((r, i) => {
                  const band = (pct: number) =>
                    pct >= 97
                      ? "text-green-700 dark:text-green-400"
                      : pct >= 90
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-red-600 dark:text-red-400";
                  const durBand =
                    r.durationPct >= 90
                      ? "text-green-700 dark:text-green-400"
                      : r.durationPct >= 60
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-red-600 dark:text-red-400";
                  const mins = Math.floor(r.durationSec / 60);
                  const secs = String(Math.round(r.durationSec % 60)).padStart(2, "0");
                  return (
                    <span
                      key={i}
                      title={`held ${r.durationPct}% of the prescribed ${Math.round(r.targetDurationSec / 60)} min`}
                      className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] dark:bg-zinc-800"
                    >
                      <span className="text-zinc-700 dark:text-zinc-200">{r.actualWatts}W</span>{" "}
                      <span className={band(r.adherencePct)}>{r.adherencePct}%</span>{" "}
                      <span className={durBand}>{mins}:{secs}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {analysis.trace && (
            <div className="rounded-md border border-zinc-200 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900">
              <RideTrace trace={analysis.trace} />
              <p className="mt-1 px-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                Power (cyan) · HR (grey){analysis.trace.targetWatts ? ` · dashed = ${analysis.trace.targetWatts}W target` : ""}
                {analysis.trace.bands.length > 0 ? " · shaded = work intervals" : ""}
              </p>
            </div>
          )}

          {analysis.powerZoneTimes && <ZoneBars times={analysis.powerZoneTimes} label="Time in power zones" />}
        </div>
      )}

      {/* Advised daily intake */}
      {analysis.advisedIntakeKcal != null && (
        <div className="mt-3 flex items-baseline gap-3 rounded bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Advised daily intake</p>
            <p className="mt-0.5 font-mono text-base font-bold text-zinc-900 dark:text-[#ff49c8] dark:[text-shadow:0_0_8px_rgba(255,73,200,0.3)]">
              {analysis.advisedIntakeKcal.toLocaleString()} kcal
            </p>
          </div>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            {analysis.advisedBaseKcal?.toLocaleString()} base
            {analysis.advisedRideFuelKcal ? ` + ${analysis.advisedRideFuelKcal.toLocaleString()} ride` : ""}
            {analysis.advisedBufferKcal ? ` + ${analysis.advisedBufferKcal.toLocaleString()} buffer` : ""}
          </p>
        </div>
      )}

      {/* Athlete note (from Intervals.icu activity description) — scrolls if long */}
      {analysis.activityDescription != null && analysis.activityDescription.trim() !== "" && (
        <div className="mt-3 rounded border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Your note</p>
          <p className="mt-0.5 text-xs italic leading-5 text-zinc-600 dark:text-zinc-400">{analysis.activityDescription}</p>
        </div>
      )}

      {/* Coach note (only when shown inline, i.e. not relocated to its own card) */}
      {!hideCoachNote && (analysis.coachNote ?? (analysis as unknown as { analysis?: string }).analysis) && (
        <div className="mt-3 border-l-2 border-zinc-300 pl-3 dark:border-[#ff49c8]/30">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Coach note</p>
          <p className="mt-0.5 max-h-48 overflow-y-auto text-xs leading-5 text-zinc-600 dark:text-zinc-400">
            {analysis.coachNote ?? (analysis as unknown as { analysis?: string }).analysis}
          </p>
        </div>
      )}
    </>
  );
  if (bare) return body;
  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-700 dark:bg-zinc-800">
      {body}
    </section>
  );
}

// ---------- Progress toward goals ----------

interface ProfileGoals {
  athleteMd: AthleteMdSnapshot;
}

function GoalsProgress({ athleteMd }: ProfileGoals) {
  if (!athleteMd.goals.length) return null;

  const powerGoals = athleteMd.performanceData;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-700 dark:bg-zinc-800">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Goals</h2>
      <div className="mt-3 flex flex-col gap-2">
        {athleteMd.goals.map((g) => (
          <div key={g.goal} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 text-sm text-zinc-700 dark:text-zinc-300">{g.goal}</span>
            {g.target && (
              <span className="shrink-0 rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff] dark:ring-1 dark:ring-[#00d4ff]/30">
                → {g.target}
              </span>
            )}
          </div>
        ))}
      </div>
      {powerGoals && Object.keys(powerGoals).length > 0 && (
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Current performance</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(powerGoals).map(([k, v]) => (
              <div key={k} className="rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900">
                <p className="text-[11px] text-zinc-400">{k}</p>
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{v}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- Block history ----------

function BlockHistory({ history }: { history: BlockHistoryEntry[] }) {
  if (!history.length) return null;
  return (
    <details className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-700 select-none dark:text-zinc-300">
        Block history ({history.length})
      </summary>
      <div className="mt-3 space-y-2">
        {history.map((entry) => (
          <div
            key={entry.id}
            className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 line-clamp-1">
                {entry.goal}
              </p>
              <span className="shrink-0 text-xs text-zinc-400">
                {entry.startDate} → {entry.endDate}
              </span>
            </div>
            {entry.overview && (
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400 line-clamp-2">
                {entry.overview}
              </p>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

// ---------- Current block card ----------

function BlockCalendar({ block, scores }: { block: CurrentBlock; scores: RideScoreEntry[] }) {
  const today = todayIso();
  const scoreByDate = new Map(scores.map((s) => [s.date, s.executionScore]));
  const scoreColor = (v: number) =>
    v >= 7 ? "text-green-700 dark:text-green-400" : v >= 5 ? "text-amber-700 dark:text-amber-400" : "text-red-600 dark:text-red-400";
  const weeks: CurrentBlock["days"][] = [];
  const sorted = [...block.days].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < sorted.length; i += 7) weeks.push(sorted.slice(i, i + 7));

  const weeklyMinutes = weeks.map((week) =>
    week.reduce((s, d) => s + d.durationMin, 0)
  );

  return (
    <div className="mt-3 space-y-1">
      {weeks.map((week, i) => {
        const mins = weeklyMinutes[i];
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const label = m === 0 ? `${h}h` : `${h}h ${m}m`;
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-right text-[10px] font-medium text-zinc-400">{label}</span>
            <div className="flex flex-1 gap-1.5 overflow-visible">
              {week.map((day, dayIdx) => {
                const alignClass =
                  dayIdx <= 1 ? "left-0" : dayIdx >= week.length - 2 ? "right-0" : "left-1/2 -translate-x-1/2";
                const score = scoreByDate.get(day.date);
                const completed = score !== undefined;
                const missed = !completed && day.date < today && day.type !== "Rest";
                return (
                  <div key={day.date} className="group relative flex-1">
                    <div
                      className={`flex h-7 w-full items-center justify-center rounded text-[10px] font-medium ${TYPE_STYLES[day.type].cell} ${
                        day.type === "Rest" ? "text-zinc-600" : "text-white"
                      } ${day.date === today ? "ring-2 ring-zinc-900 ring-offset-1 dark:ring-[#ff49c8] dark:ring-offset-zinc-800" : ""} ${
                        completed ? "font-bold ring-1 ring-inset ring-white/60 dark:ring-black/30" : ""
                      } ${missed ? "opacity-40" : ""} ${!completed && !missed && day.date < today ? "opacity-40" : ""}`}
                    >
                      {completed ? (
                        <span className="flex items-baseline gap-0.5">
                          <span className="text-[8px] leading-none">✓</span>
                          {score}
                        </span>
                      ) : (
                        day.date.slice(8)
                      )}
                    </div>
                    {/* Custom tooltip */}
                    <div
                      className={`pointer-events-none absolute bottom-full mb-2 z-30 opacity-0 transition-opacity duration-100 group-hover:opacity-100 w-max max-w-[160px] ${alignClass}`}
                    >
                      <div className="rounded border border-zinc-200 bg-white px-2.5 py-2 shadow-md dark:border-zinc-700 dark:bg-zinc-900">
                        <p className="text-[11px] font-semibold leading-tight text-zinc-800 dark:text-zinc-100">
                          {day.name}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${TYPE_STYLES[day.type].cell}`}
                          />
                          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{day.type}</span>
                          {day.durationMin > 0 && (
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                              · {day.durationMin} min
                            </span>
                          )}
                        </div>
                        {completed ? (
                          <p className="mt-0.5 text-[10px] font-medium">
                            <span className="text-zinc-500 dark:text-zinc-400">Completed · </span>
                            <span className={scoreColor(score)}>execution {score}/10</span>
                          </p>
                        ) : missed ? (
                          <p className="mt-0.5 text-[10px] font-medium text-red-500">Missed</p>
                        ) : null}
                        <p className="mt-0.5 font-mono text-[10px] text-zinc-400 dark:text-zinc-600">
                          {day.date}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 pl-12">
        {(["Z2", "Recovery", "Threshold", "VO2max", "SIT", "Strength", "Rest"] as const).map(
          (t) => (
            <span key={t} className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className={`h-2 w-2 rounded-sm ${TYPE_STYLES[t].cell}`} /> {t}
            </span>
          )
        )}
      </div>
    </div>
  );
}

function CurrentBlockSection({
  block,
  onDelete,
  scores,
}: {
  block: CurrentBlock | null;
  onDelete?: () => void;
  scores: RideScoreEntry[];
}) {
  if (!block) {
    return (
      <section className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-6 text-center dark:border-zinc-600 dark:bg-zinc-800">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No active training block. Generate one below to get started.
        </p>
      </section>
    );
  }
  const today = todayIso();
  const daysRemaining = Math.max(
    0,
    Math.ceil((Date.parse(block.endDate) - Date.parse(today)) / 86_400_000)
  );
  const upcoming = block.days.filter((d) => d.date >= today).length;
  return (
    <section className="relative rounded-none border-2 border-zinc-300 bg-white px-4 py-4 dark:border-[#00d4ff]/55 dark:bg-zinc-900 dark:shadow-[0_0_28px_-8px_rgba(0,212,255,0.45)]">
      <CyberFrame accent="cyan" />
      <div className="relative z-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Active block</h2>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff] dark:ring-1 dark:ring-[#00d4ff]/30">
                {block.lengthWeeks}w
              </span>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {block.startDate} → {block.endDate} ·{" "}
              {daysRemaining > 0
                ? `${daysRemaining} days remaining · ${upcoming} sessions left`
                : "finished"}
            </p>
          </div>
          {onDelete && (
            <button
              onClick={onDelete}
              className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
              title="Delete this block to generate a new one"
            >
              Delete block
            </button>
          )}
        </div>
        {block.overview && (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">{block.overview}</p>
        )}
        <BlockCalendar block={block} scores={scores} />
      </div>
    </section>
  );
}

// ---------- Recent data summary ----------

function trendArrow(current: number | null, prev: number | null, higherIsBetter = true): string {
  if (current === null || prev === null) return "";
  const delta = current - prev;
  if (Math.abs(delta) < 0.5) return " →";
  return delta > 0 ? (higherIsBetter ? " ↑" : " ↓") : (higherIsBetter ? " ↓" : " ↑");
}

function RecentDataSummary({
  sync,
  acwr,
  polarization,
  bare,
}: {
  sync: SyncData | null;
  acwr?: AcwrResult | null;
  polarization?: IntensityDistribution | null;
  bare?: boolean;
}) {
  if (!sync) return null;
  const today = todayIso();
  const cutoff7 = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const cutoff14 = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const hours7 =
    sync.activities
      .filter((a) => a.date >= cutoff7 && a.date <= today)
      .reduce((s, a) => s + a.movingTimeSec, 0) / 3600;

  // Wellness sorted newest-first for trend deltas.
  const wSorted = [...sync.wellness].sort((a, b) => b.date.localeCompare(a.date));
  const latest7d = wSorted.find((w) => w.date >= cutoff7 && w.ctl !== null);
  const week2Ago = wSorted.find((w) => w.date < cutoff7 && w.date >= cutoff14 && w.ctl !== null);
  const ctlArrow = trendArrow(latest7d?.ctl ?? null, week2Ago?.ctl ?? null, true);
  const atlArrow = trendArrow(latest7d?.atl ?? null, week2Ago?.atl ?? null, false);
  const tsbNow = latest7d?.ctl != null && latest7d?.atl != null ? latest7d.ctl - latest7d.atl : null;
  const tsbPrev = week2Ago?.ctl != null && week2Ago?.atl != null ? week2Ago.ctl - week2Ago.atl : null;
  const tsbArrow = trendArrow(tsbNow, tsbPrev, true); // rising form (fresher) is "up"

  // Weight / weight-trend deliberately live on the Trends page now; the freed slots here
  // surface ACWR and polarization — the load-and-balance signals that belong with readiness.
  const tiles = (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile label="CTL (fitness)" value={sync.fitness.ctl?.toFixed(1) ?? "—"} arrow={ctlArrow} accent="pink" />
      <StatTile label="ATL (fatigue)" value={sync.fitness.atl?.toFixed(1) ?? "—"} arrow={atlArrow} accent="pink" />
      <StatTile label="TSB (form)" value={sync.fitness.tsb?.toFixed(1) ?? "—"} arrow={tsbArrow} accent="pink" />
      <StatTile label="7-day hours" value={`${hours7.toFixed(1)} h`} accent="pink" />
      {acwr && (
        <div className="group relative rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-400">
            <span className="cursor-help underline decoration-dotted underline-offset-2">ACWR</span>
            <MetricTip
              text={`Acute:chronic workload ratio — your last 7 days of load (${acwr.acute} TSS/day) vs the last 28 (${acwr.chronic} TSS/day). 0.8–1.3 is the safe progression band; >1.5 is a spike with raised injury risk. You're at ${acwr.ratio.toFixed(2)} (${acwr.level}).`}
            />
          </p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            {acwr.ratio.toFixed(2)}
            <span className={`ml-1 text-[10px] font-normal ${ACWR_COLOR[acwr.level]}`}>{acwr.level}</span>
          </p>
        </div>
      )}
      {polarization && (
        <div className="group relative rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-400">
            <span className="cursor-help underline decoration-dotted underline-offset-2">Polarization</span>
            <MetricTip
              align="right"
              text="Share of training time spent easy / moderate / hard (by ride power vs FTP) over the last 7 days. ~80% easy is the endurance-base target — most of your time should be in the first number."
            />
          </p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {polarization.easyPct}/{polarization.moderatePct}/{polarization.hardPct}
            <span className="ml-1 text-[10px] font-normal text-zinc-400 dark:text-zinc-500">e/m/h</span>
          </p>
        </div>
      )}
    </div>
  );
  if (bare) return tiles;
  return <Card title="Training status">{tiles}</Card>;
}

// ---------- Today's planned session (Zone 2 fallback before a ride is logged) ----------

function PlannedToday({ block }: { block: CurrentBlock | null }) {
  const today = todayIso();
  const day = block?.days.find((d) => d.date === today) ?? null;
  if (!day || day.type === "Rest") {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {day?.type === "Rest" ? "Rest day — recover." : "No session planned for today."}
      </p>
    );
  }
  const style = TYPE_STYLES[day.type];
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${style.cell}`} />
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{day.name}</span>
        </div>
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {day.type}
          {day.durationMin > 0 ? ` · ${day.durationMin} min` : ""}
        </span>
      </div>
      {day.prescription && day.prescription.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Prescribed</span>
          {day.prescription.map((iv, i) => (
            <span
              key={i}
              className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-700 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff] dark:ring-1 dark:ring-[#00d4ff]/30"
            >
              {iv.label}
            </span>
          ))}
        </div>
      )}
      <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
        Ride it, then sync to see your execution score and fuel.
      </p>
    </div>
  );
}

// ---------- Dashboard ----------

export default function Dashboard({ mode = "plan" }: { mode?: "today" | "plan" }) {
  // Sync state is shared via SyncProvider so the nav-rail sync control and the page
  // views stay in lock-step. Page-specific state (below) stays local.
  const { state, setState, loadError, doSync } = useSync();

  const [lengthWeeks, setLengthWeeks] = useState<2 | 4>(4);
  const [goal, setGoal] = useState("");
  const [weakpointsText, setWeakpointsText] = useState("");
  const [startDate, setStartDate] = useState(nextMonday());

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);

  const [writing, setWriting] = useState(false);
  const [writeResults, setWriteResults] = useState<WriteResult[] | null>(null);

  const [athleteMd, setAthleteMd] = useState<AthleteMdSnapshot | null>(null);
  const [blockHistory, setBlockHistory] = useState<BlockHistoryEntry[]>([]);

  const [retroGenerating, setRetroGenerating] = useState(false);
  const [retroResult, setRetroResult] = useState<{
    retrospective: string;
    seeds: string[];
    complianceByType: Record<string, number>;
  } | null>(null);
  const [retroError, setRetroError] = useState<string | null>(null);

  const [notePosting, setNotePosting] = useState(false);
  const [notePosted, setNotePosted] = useState(false);

  // When a block is already active the generator collapses to a thin bar so it stops
  // cutting the Plan page in half; it expands on demand (and is always open with no block).
  const [genOpen, setGenOpen] = useState(false);

  const autoSyncDone = useRef(false);

  const loadBlockHistory = useCallback(async () => {
    try {
      const h = await api<BlockHistoryEntry[]>("/api/history");
      setBlockHistory(h);
    } catch {
      // history is best-effort
    }
  }, []);

  // Plan-only data: goal/weakpoint prefill + block history (Today doesn't need them).
  useEffect(() => {
    if (mode !== "plan") return;
    let cancelled = false;
    (async () => {
      try {
        const { athleteMd: md } = await api<{ athleteMd: AthleteMdSnapshot }>("/api/profile");
        if (!cancelled) {
          setAthleteMd(md);
          if (md.goals.length > 0) {
            setGoal(md.goals.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
          }
          if (md.weakpoints.length > 0) {
            setWeakpointsText(md.weakpoints.map((w) => w.weakpoint).join("\n"));
          }
        }
      } catch {
        // profile prefill is best-effort
      }
      void loadBlockHistory();
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, loadBlockHistory]);

  // Auto-sync once on Today when the cached data is stale.
  useEffect(() => {
    if (mode !== "today" || !state || autoSyncDone.current) return;
    if (state.autoSyncOnOpen && state.configured && isStale(state.lastSync?.syncedAt ?? null)) {
      autoSyncDone.current = true;
      void doSync();
    }
  }, [mode, state, doSync]);

  useEffect(() => {
    if (!generating) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [generating]);

  const generate = async () => {
    if (!goal.trim()) {
      setGenerateError("Enter a block goal first.");
      return;
    }
    setGenerating(true);
    setGenerateError(null);
    setWriteResults(null);
    try {
      const { plan } = await api<{ plan: GeneratedPlan }>("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          lengthWeeks,
          goal: goal.trim(),
          startDate,
          weakpoints: weakpointsText
            .split("\n")
            .map((w) => w.trim())
            .filter(Boolean),
        }),
      });
      setPlan(plan);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const write = async () => {
    if (!plan) return;
    setWriting(true);
    try {
      const { results, currentBlock } = await api<{
        results: WriteResult[];
        currentBlock: CurrentBlock | null;
      }>("/api/write", { method: "POST", body: JSON.stringify({ plan }) });
      setWriteResults(results);
      if (currentBlock) {
        setState((s) => (s ? { ...s, currentBlock } : s));
        void loadBlockHistory();
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Write failed");
    } finally {
      setWriting(false);
    }
  };

  const deleteBlock = async () => {
    if (!window.confirm("Delete the current block? You can generate a new one after.")) return;
    try {
      await api("/api/sync", { method: "DELETE" });
      setState((s) => (s ? { ...s, currentBlock: null } : s));
      setPlan(null);
      setWriteResults(null);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const generateRetro = async () => {
    setRetroGenerating(true);
    setRetroError(null);
    try {
      const result = await api<{ retrospective: string; seeds: string[]; complianceByType: Record<string, number> }>(
        "/api/retrospective",
        { method: "POST" }
      );
      setRetroResult(result);
      // Block is now cleared server-side — update local state.
      setState((s) => (s ? { ...s, currentBlock: null } : s));
      void loadBlockHistory();
    } catch (err) {
      setRetroError(err instanceof Error ? err.message : "Retrospective failed");
    } finally {
      setRetroGenerating(false);
    }
  };

  const postNote = async () => {
    if (!state?.todayAnalysis) return;
    setNotePosting(true);
    try {
      await api("/api/note", {
        method: "POST",
        body: JSON.stringify({
          date: state.todayAnalysis.activityDate,
          activityName: state.todayAnalysis.activityName,
          coachNote: state.todayAnalysis.coachNote,
          executionScore: state.todayAnalysis.executionScore,
        }),
      });
      setNotePosted(true);
    } catch {
      // best-effort — don't show error for note post failure
    } finally {
      setNotePosting(false);
    }
  };

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        Failed to load app state: {loadError}
      </div>
    );
  }
  if (!state) {
    return <p className="py-12 text-center text-sm text-zinc-400">Loading…</p>;
  }

  const hasActiveBlock =
    state.currentBlock !== null && state.currentBlock.endDate >= todayIso();

  return (
    <div className={mode === "today" ? "flex flex-col gap-3 lg:h-[calc(100dvh-4rem)] lg:overflow-hidden" : "space-y-3"}>
      {mode === "today" && (
        <>
          <Zone rank={1} title="Readiness — can I go hard?">
            {state.readiness || state.fatigueAlert?.triggered || state.loadRamp?.triggered ? (
              <ReadinessBadge
                readiness={state.readiness}
                fatigueAlert={state.fatigueAlert}
                loadRamp={state.loadRamp}
              />
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Sync to compute today&apos;s readiness.</p>
            )}
            {state.lastSync && (
              <div className="mt-2">
                <RecentDataSummary
                  sync={state.lastSync}
                  acwr={state.acwr}
                  polarization={state.polarization}
                  bare
                />
              </div>
            )}
          </Zone>

          {/* Session & fuel is the wide focus; trend pulse + coach note fill the column
              beside it. On desktop the page is locked to the viewport — the session card's
              body and the right column scroll internally so all borders stay visible. */}
          <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[1.7fr_1fr] lg:[grid-template-rows:minmax(0,1fr)]">
            {/* Session card fills its grid cell and scrolls internally so the bottom
                border lands at the page bottom instead of being clipped. */}
            <Zone rank={2} title="Today — session & fuel" hero fill>
              {state.todayAnalysis && state.todayAnalysis.activityDate === todayIso() ? (
                <TodayRideCard
                  analysis={state.todayAnalysis}
                  onPostNote={state.configured ? postNote : undefined}
                  notePosting={notePosting}
                  notePosted={notePosted}
                  bare
                  hideCoachNote
                />
              ) : (
                <PlannedToday block={state.currentBlock} />
              )}
            </Zone>

            {/* Trend pulse fixed; coach note fills the rest of the column and scrolls,
                so its bottom border lands at the page bottom (never clipped). */}
            <div className="flex flex-col gap-3 lg:min-h-0">
              <Zone rank={3} title="Trend pulse — am I improving?" hint="opens Trends">
                <TrendPulse vertical />
              </Zone>
              {state.todayAnalysis?.activityDate === todayIso() && state.todayAnalysis.coachNote && (
                <Zone title="Coach note" hero accent="pink" fill>
                  <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-300">{state.todayAnalysis.coachNote}</p>
                </Zone>
              )}
              {state.anthropicConfigured && <AskCoach />}
            </div>
          </div>
        </>
      )}

      {mode === "plan" && (
        <>
      <RetroSection
        block={state.currentBlock}
        generating={retroGenerating}
        result={retroResult}
        error={retroError}
        onGenerate={generateRetro}
      />

      {!retroResult && <CurrentBlockSection block={state.currentBlock} onDelete={deleteBlock} scores={state.scores} />}

      {/* Goals + this-week side by side, just under the active block */}
      {(athleteMd || state.lastSync) && (
        <div className="grid gap-3 sm:grid-cols-[1.7fr_1fr]">
          {athleteMd && <GoalsProgress athleteMd={athleteMd} />}
          {state.lastSync && <WeeklyDebrief sync={state.lastSync} />}
        </div>
      )}

      {/* Block generation — collapses to a thin bar when a block is active so it no longer
          cuts the page in half; always open when there's no block to generate against. */}
      <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-700 dark:bg-zinc-800">
        {hasActiveBlock && !genOpen ? (
          <button
            onClick={() => setGenOpen(true)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Generate next block</span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">Plan the next 2–4 weeks →</span>
          </button>
        ) : (
          <>
            {hasActiveBlock && (
              <div className="mb-3 flex justify-end">
                <button
                  onClick={() => setGenOpen(false)}
                  className="text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  Collapse
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={generate}
            disabled={generating || !state.anthropicConfigured}
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:border dark:border-[#ff49c8]/50 dark:bg-transparent dark:text-[#ff49c8] dark:hover:bg-[#ff49c8]/10 dark:disabled:border-zinc-600 dark:disabled:text-zinc-500 dark:disabled:bg-transparent"
          >
            {generating
              ? `Generating… ${elapsed}s`
              : hasActiveBlock
                ? "Generate Next Block"
                : "Generate New Block"}
          </button>
          {!state.anthropicConfigured && (
            <p className="text-xs text-red-600">
              ANTHROPIC_API_KEY is not set — generation is unavailable.
            </p>
          )}
          {!state.lastSync && state.configured && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Tip: sync first so the plan reflects your recent training.
            </p>
          )}
        </div>
        {generateError && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
            {generateError}
          </p>
        )}

        <div className="mt-4 grid gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-zinc-700">
          <div>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Block length</label>
            <div className="mt-1.5 flex gap-2">
              {([2, 4] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => setLengthWeeks(w)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                    lengthWeeks === w
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-[#ff49c8]/60 dark:bg-[#ff49c8]/10 dark:text-[#ff49c8]"
                      : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-500"
                  }`}
                >
                  {w} weeks
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="start-date" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Start date
            </label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:focus:border-zinc-400"
            />
          </div>
          <div>
            <label htmlFor="goal" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Block goal (one per line)
            </label>
            <textarea
              id="goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              placeholder="from profile; edit to override"
              className="mt-1.5 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:placeholder-zinc-500 dark:focus:border-zinc-400"
            />
          </div>
          <div>
            <label htmlFor="weakpoints" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Weakpoints to target (one per line)
            </label>
            <textarea
              id="weakpoints"
              value={weakpointsText}
              onChange={(e) => setWeakpointsText(e.target.value)}
              rows={2}
              placeholder="from profile; edit to override"
              className="mt-1.5 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:placeholder-zinc-500 dark:focus:border-zinc-400"
            />
          </div>
            </div>
          </>
        )}
      </section>

      {plan && (
        <PlanPreview
          plan={plan}
          writing={writing}
          results={writeResults}
          intervalsConfigured={state.configured}
          onWrite={write}
          onDismiss={() => {
            setPlan(null);
            setWriteResults(null);
          }}
        />
      )}

      <BlockHistory history={blockHistory} />
        </>
      )}
    </div>
  );
}
