"use client";

import type {
  AcwrResult,
  CurrentBlock,
  FatigueAlert,
  IntensityDistribution,
  LoadRampAlert,
  ReadinessSignal,
  SyncData,
  TodayAnalysis,
} from "@/lib/types";
import { executionScoreLabel } from "@/lib/execution-score";
import { ifBandLabel } from "@/lib/zones";
import { TYPE_STYLES } from "@/lib/workout-types";
import { prDurationLabel } from "@/lib/pr";
import { computeEnergyAvailability } from "@/lib/nutrition";
import { isoDaysAgo, localToday as todayIso } from "@/lib/date";
import RideTrace from "../RideTrace";
import SessionDisposition from "../SessionDisposition";
import { Card, InfoDot, MetricTip } from "../ui";
import { ACWR_COLOR, READINESS_STYLES, ZoneBars, trendArrow } from "./shared";

// ---------- Readiness badge ----------

export function ReadinessBadge({
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
        <MetricTip text="Reads your form (TSB) and acute-fatigue load (ATL/CTL) to suggest whether to build, hold, or recover today. (HRV is not yet in the loop — it's gated off until an overnight source exists.)" />
      </div>
    </div>
  );
}

// ---------- Today's ride analysis ----------

export function TodayRideCard({
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
  const metrics: Array<{ label: string; value: string; sub?: string; tip?: string; highlight?: string }> = [];
  // IF alone is opaque ("0.85" relative to what?), so pair it with the effort band it implies and a
  // hover that explains the metric. NP-based when NP is present (the real signal), avg-power-based
  // otherwise. TSS is intentionally dropped — it's Intervals' "Load" (same field); execution is the
  // app's load-completion read.
  if (analysis.intensityFactor != null) {
    const IF = analysis.intensityFactor;
    // Band boundaries come from the athlete's OWN synced power zones (Intervals.icu zone tops as %FTP,
    // as-of this ride), so the label tracks their zone defs + any FTP/zone change — falling back to the
    // population defaults (which match the execution scorer's Z2 = IF 0.60–0.74). The single IF is a
    // whole-ride average; the per-ride time-in-zone bars below tell the distribution story.
    const band = ifBandLabel(IF, analysis.powerZoneTopsPct);
    // Provenance stamp (B): IF reads NP when present, else avg power (ride-analysis.ts — `normalizedPower
    // ?? avgWatts`). An avg-based IF understates variable efforts, so the basis is shown, not hidden.
    const npBased = analysis.activityNormalizedPower != null;
    metrics.push({
      label: "IF",
      value: IF.toFixed(2),
      sub: `${band} · ${npBased ? "NP" : "avg"}`,
      tip: `Intensity Factor = ${npBased ? "normalized power" : "average power (NP unavailable)"} ÷ FTP — how hard the whole ride was relative to your threshold. The effort band (recovery / endurance / tempo / threshold / VO2max / anaerobic) is read from your Intervals.icu power zones, so it tracks your own zone defs and FTP. It's a whole-ride average — check the time-in-zone bars for how the effort was actually distributed.${npBased ? "" : " Avg-based: understates short/variable efforts vs a true NP read."}`,
    });
  }
  // NP and avg power as distinct tiles — NP (the variability-aware figure that IF/execution read
  // from) is the signal; raw avg is the secondary sanity value. Both synced from Intervals.icu.
  if (analysis.activityNormalizedPower != null)
    metrics.push({ label: "NP", value: `${analysis.activityNormalizedPower}W` });
  if (analysis.activityAvgWatts != null)
    metrics.push({ label: "Avg power", value: `${analysis.activityAvgWatts}W` });
  // Avg speed removed from the glance (C): terrain/wind-dependent, rarely a training decision; it lives
  // in Intervals.icu if needed. Decoupling moved to the Power-execution drill-down below (C): it's no
  // longer a scored signal (ACC-2026-06-25), so it shouldn't sit in the strip implying it counts.
  if (analysis.activityRpe != null)
    metrics.push({ label: "RPE", value: `${analysis.activityRpe}/10` });

  const body = (
    <>
      {!bare && (
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Today&apos;s ride</h2>
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{analysis.activityDate}</span>
        </div>
      )}

      {/* Power PR celebration — a new best for a duration set during this ride (PW-10) */}
      {analysis.powerPRs && analysis.powerPRs.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-500/40 dark:bg-amber-950/40">
          <span className="text-sm" aria-hidden>🏆</span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            New {analysis.powerPRs.length === 1 ? "PR" : "PRs"}
          </span>
          {analysis.powerPRs.map((pr) => (
            <span
              key={pr.durationSec}
              title={`previous best ${pr.prevWatts}W`}
              className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
            >
              {prDurationLabel(pr.durationSec)} {pr.watts}W
              <span className="ml-1 text-amber-500/80 dark:text-amber-400/70">+{pr.watts - pr.prevWatts}W</span>
            </span>
          ))}
        </div>
      )}

      {/* Planned vs Actual */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Planned</p>
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
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{analysis.plannedDurationMin} min</span>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">No session planned</p>
          )}
        </div>

        <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Actual</p>
          <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">{analysis.activityName}</p>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{analysis.activityDurationMin} min</span>
            {analysis.activityAvgHr !== null && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{analysis.activityAvgHr} bpm avg</span>
            )}
            {analysis.activityKj !== null && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{analysis.activityKj} kcal</span>
            )}
          </div>
        </div>
      </div>

      {/* Key metrics strip */}
      {metrics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {metrics.map((m) => (
            <div
              key={m.label}
              className={`group relative rounded bg-zinc-100 px-2.5 py-1.5 dark:bg-zinc-900${m.tip ? " cursor-help" : ""}`}
            >
              <p className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                {m.label}
                {m.tip && <span className="opacity-60">ⓘ</span>}
              </p>
              <p className={`font-mono text-sm font-semibold text-zinc-800 ${m.highlight ? m.highlight : "dark:text-zinc-100"}`}>
                {m.value}
                {m.sub && <span className="ml-1 font-sans text-[10px] font-normal text-zinc-500 dark:text-zinc-400">{m.sub}</span>}
              </p>
              {m.tip && <MetricTip text={m.tip} />}
            </div>
          ))}
        </div>
      )}

      {/* Execution score */}
      {analysis.executionScore != null && (
        <div className="mt-3 flex items-center gap-3">
          <div className="flex items-center gap-2 rounded bg-zinc-100 px-3 py-1.5 dark:bg-zinc-900">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Execution</span>
            <span className="font-mono text-sm font-bold text-zinc-800 dark:text-[#ff49c8]">
              {analysis.executionScore}/10
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
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
      {(analysis.powerZoneTimes || analysis.trace || analysis.activityDecoupling != null || (analysis.intervalComparison && analysis.intervalComparison.reps.length > 0)) && (
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Power execution
            {analysis.intervalComparison && analysis.intervalComparison.reps.length > 0 && (
              <span className="ml-1.5 font-mono text-[11px] font-normal normal-case text-zinc-500 dark:text-zinc-400">
                {analysis.intervalComparison.completed}/{analysis.intervalComparison.total} · {analysis.intervalComparison.effectiveAdherencePct}%
              </span>
            )}
          </summary>
          <div className="mt-2 space-y-2">

          {/* Decoupling (C): relocated here from the metric strip — context, not a scored signal. */}
          {analysis.activityDecoupling != null && (
            <div className="group relative inline-flex items-center gap-1.5 rounded bg-zinc-100 px-2.5 py-1.5 dark:bg-zinc-900">
              <span className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                Decoupling <span className="opacity-60">ⓘ</span>
              </span>
              <span className="font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                {analysis.activityDecoupling.toFixed(1)}%
              </span>
              <MetricTip text="Aerobic drift — how much power-to-HR drifted across the ride. Context only: it's no longer part of your execution score (too noisy per-ride), kept as a steady-ride durability reference. Lower is better; ~5%+ on a steady endurance ride hints at fatigue or under-fuelling." />
            </div>
          )}

          {analysis.intervalComparison && analysis.intervalComparison.reps.length > 0 && (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Prescribed</span>
                  {analysis.intervalComparison.prescribedLabels.map((l, i) => (
                    <span key={i} className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff]">
                      {l}
                    </span>
                  ))}
                </div>
                <span className="flex items-center gap-1 font-mono text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                  {analysis.intervalComparison.completed}/{analysis.intervalComparison.total} · {analysis.intervalComparison.effectiveAdherencePct}%
                  <InfoDot
                    align="right"
                    text="Reps that held ≥90% of the prescribed duration, then the session's power × duration completion against the plan — the duration-aware adherence the execution score reads."
                  />
                </span>
              </div>
              {analysis.intervalComparison.structuralMismatch && (
                <p className="mt-1.5 text-[10px] leading-snug text-amber-700 dark:text-amber-400">
                  ⚠ Executed durations differ from the plan&apos;s definition (power was on target) — likely a plan/detection mismatch, scored on power &amp; overall execution rather than rep duration.
                </p>
              )}
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
                {(analysis.intervalComparison.extras ?? []).map((x, i) => {
                  const mins = Math.floor(x.durationSec / 60);
                  const secs = String(Math.round(x.durationSec % 60)).padStart(2, "0");
                  return (
                    <span
                      key={`extra-${i}`}
                      title="extra effort ridden on top of the plan — not scored against a target"
                      className="rounded border border-dashed border-zinc-300 bg-white px-1.5 py-0.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
                    >
                      <span className="text-zinc-500 dark:text-zinc-400">+extra </span>
                      <span className="text-zinc-700 dark:text-zinc-200">{x.actualWatts}W</span>{" "}
                      <span className="text-zinc-500 dark:text-zinc-400">{mins}:{secs}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {analysis.trace && (
            <div className="rounded-md border border-zinc-200 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900">
              <RideTrace trace={analysis.trace} />
              <p className="mt-1 px-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                Power (cyan, 30s smoothed) · HR (grey){analysis.trace.targetWatts ? ` · dashed = ${analysis.trace.targetWatts}W target` : ""}
                {analysis.trace.bands.length > 0 ? " · shaded = work intervals" : ""}
              </p>
            </div>
          )}

          {analysis.powerZoneTimes && <ZoneBars times={analysis.powerZoneTimes} label="Time in power zones" />}
          </div>
        </details>
      )}

      {/* Advised daily intake */}
      {analysis.advisedIntakeKcal != null && (
        <div className="mt-3 flex items-baseline gap-3 rounded bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Advised daily intake</p>
            <p className="mt-0.5 font-mono text-base font-bold text-zinc-900 dark:text-[#ff49c8] dark:[text-shadow:0_0_8px_rgba(255,73,200,0.3)]">
              {analysis.advisedIntakeKcal.toLocaleString()} kcal
            </p>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {analysis.advisedBaseKcal?.toLocaleString()} base
            {analysis.advisedRideFuelKcal ? ` + ${analysis.advisedRideFuelKcal.toLocaleString()} ride` : ""}
            {analysis.advisedBufferKcal ? ` + ${analysis.advisedBufferKcal.toLocaleString()} buffer` : ""}
          </p>
        </div>
      )}

      {/* Athlete note (from Intervals.icu activity description) — scrolls if long */}
      {analysis.activityDescription != null && analysis.activityDescription.trim() !== "" && (
        <div className="mt-3 rounded border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Your note</p>
          <p className="mt-0.5 text-xs italic leading-5 text-zinc-600 dark:text-zinc-400">{analysis.activityDescription}</p>
        </div>
      )}

      {/* Session disposition — the athlete attributes how it went (esp. "compromised") so a
          fluke ride doesn't teach the model or get misdiagnosed by the coach. */}
      <SessionDisposition date={analysis.activityDate} />

      {/* Coach note (only when shown inline, i.e. not relocated to its own card) */}
      {!hideCoachNote && (analysis.coachNote ?? (analysis as unknown as { analysis?: string }).analysis) && (
        <div className="mt-3 border-l-2 border-zinc-300 pl-3 dark:border-[#ff49c8]/30">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Coach note</p>
          <p className="mt-0.5 max-h-48 overflow-y-auto text-xs leading-5 text-zinc-600 dark:text-zinc-400">
            {analysis.coachNote ?? (analysis as unknown as { analysis?: string }).analysis}
          </p>
        </div>
      )}
    </>
  );
  if (bare) return body;
  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
      {body}
    </section>
  );
}

// ---------- Recent data summary ----------

export function RecentDataSummary({
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
  const cutoff7 = isoDaysAgo(7);
  const cutoff14 = isoDaysAgo(14);

  // Wellness sorted newest-first for the form (TSB) trend delta.
  const wSorted = [...sync.wellness].sort((a, b) => b.date.localeCompare(a.date));
  const latest7d = wSorted.find((w) => w.date >= cutoff7 && w.ctl !== null);
  const week2Ago = wSorted.find((w) => w.date < cutoff7 && w.date >= cutoff14 && w.ctl !== null);
  const tsbNow = latest7d?.ctl != null && latest7d?.atl != null ? latest7d.ctl - latest7d.atl : null;
  const tsbPrev = week2Ago?.ctl != null && week2Ago?.atl != null ? week2Ago.ctl - week2Ago.atl : null;
  const tsbArrow = trendArrow(tsbNow, tsbPrev, true); // rising form (fresher) is "up"

  // Trimmed to the tiles that drive today's decision: form (TSB) + the load/balance signals
  // (ACWR, polarization). CTL/ATL/volume are status — CTL now lives in the trend pulse, the
  // rest on Trends.
  const tiles = (
    <div className="grid grid-cols-3 gap-2">
      <div className="group relative rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
        <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          <span className="underline decoration-dotted underline-offset-2">TSB (form)</span>
          <MetricTip text="Training Stress Balance = fitness (CTL, 42-day load) minus fatigue (ATL, 7-day load) — your 'form'. Negative means you're carrying training fatigue; positive means you're fresh/tapered. Rough guide: −10 to −30 is productive overload, around 0 is balanced, +5 to +25 is race-ready freshness, below −30 risks digging a hole." />
        </p>
        <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-800 dark:text-[#ff49c8]">
          {sync.fitness.tsb?.toFixed(1) ?? "—"}
          {tsbArrow ? <span className="ml-0.5 text-[10px] font-normal text-cyan-600 dark:text-[#00d4ff]">{tsbArrow}</span> : null}
        </p>
      </div>
      {acwr && (
        <div className="group relative rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            <span className="underline decoration-dotted underline-offset-2">ACWR</span>
            <MetricTip
              text={`Acute:chronic workload ratio — your last 7 days of load (${acwr.acute} TSS/day) vs the last 28 (${acwr.chronic} TSS/day). Below 0.8 you're detraining (losing fitness); 0.8–1.3 is the safe progression sweet spot; >1.5 is a spike with raised injury risk. You're at ${acwr.ratio.toFixed(2)} (${acwr.level}).`}
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
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            <span className="underline decoration-dotted underline-offset-2">Polarization</span>
            <MetricTip
              align="right"
              text="Share of training time spent easy / moderate / hard (by ride power vs FTP) over the last 7 days. ~80% easy is the endurance-base target — most of your time should be in the first number."
            />
          </p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {polarization.easyPct}/{polarization.moderatePct}/{polarization.hardPct}
            <span className="ml-1 text-[10px] font-normal text-zinc-500 dark:text-zinc-400">e/m/h</span>
          </p>
        </div>
      )}
    </div>
  );
  if (bare) return tiles;
  return <Card title="Training status">{tiles}</Card>;
}

// ---------- Energy-availability tile (deterministic fuel proxy; ⭐ UI refinement) ----------

export function EnergyAvailabilityTile({ sync }: { sync: SyncData | null }) {
  if (!sync) return null;
  const ea = computeEnergyAvailability(sync.wellness, sync.activities, todayIso());
  if (!ea) return null; // withheld until ≥3 complete logged days — no flaky single-day number
  // Trend is vs the prior week; higher EA (more spare energy) is "up". No band — a body-weight proxy off
  // self-logged intake can't honestly claim the clinical 30/45 kcal/kg cutoff; that's Track C calibration.
  const arrow = ea.trend != null && ea.trend !== 0 ? trendArrow(ea.eaKcalPerKg, ea.eaKcalPerKg - ea.trend, true) : null;
  return (
    <div className="group relative mt-2 flex items-center justify-between gap-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <span className="underline decoration-dotted underline-offset-2">Energy availability</span>
        <MetricTip text={`Energy left for recovery after exercise — your logged intake minus ride burn, per kg body weight, averaged over the last ${ea.daysUsed} complete days (today is excluded — it's still being logged). A proxy, not a clinical figure: it's on body weight (not fat-free mass) and reads low if you under-log intake. The arrow is vs the prior week; a personalised "adequate" line comes once enough data accrues.`} />
      </p>
      <p className="shrink-0 font-mono text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        {ea.eaKcalPerKg}
        <span className="ml-0.5 text-[10px] font-normal text-zinc-500 dark:text-zinc-400"> kcal/kg</span>
        {arrow && <span className="ml-1 text-[10px] font-normal text-cyan-600 dark:text-[#00d4ff]">{arrow}</span>}
        <span className="ml-1.5 text-[10px] font-normal text-zinc-400 dark:text-zinc-500">{ea.daysUsed}d</span>
      </p>
    </div>
  );
}

// ---------- Today's planned session (Zone 2 fallback before a ride is logged) ----------

export function PlannedToday({ block }: { block: CurrentBlock | null }) {
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
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Prescribed</span>
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
      <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        Ride it, then sync to see your execution score and fuel.
      </p>
    </div>
  );
}
