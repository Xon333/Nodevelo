"use client";

import type {
  AcwrResult,
  CurrentBlock,
  FatigueAlert,
  IntensityDistribution,
  LoadRampAlert,
  SyncData,
  TodayAnalysis,
} from "@/lib/types";
import { executionScoreLabel } from "@/lib/execution-score";
import { ifBandLabel } from "@/lib/zones";
import { TYPE_STYLES } from "@/lib/workout-types";
import { prDurationLabel } from "@/lib/pr";
import { formatPrescriptionLabel } from "@/lib/prescription";
import { computeEnergyAvailability, eaLevel } from "@/lib/nutrition";
import { addDaysIso, isoDaysAgo, localToday as todayIso, isBlockFinished } from "@/lib/date";
import { splitLeadSentences } from "@/lib/text";
import Link from "next/link";
import { useId } from "react";
import RideTrace from "../RideTrace";
import SessionDisposition from "../SessionDisposition";
import { Card, InfoDot, MetricTip } from "../ui";
import { ACWR_COLOR, ZoneBars, trendArrow } from "./shared";

// ---------- Readiness alerts ----------

// Triggered fatigue/load-ramp banners — alarms outrank verdicts (Constitution §4, aviation-style),
// so these render at the very top of Zone 1, above the athlete-state verdict. The old standalone
// Build/Hold/Recover readiness badge was retired here (S1-1): it was a second same-altitude verdict
// in a rival vocabulary. Its fatigue overrides share thresholds with these banners (lib/readiness.ts
// RV2-9), and its TSB narration lives on in the verdict card's form line, its TSB driver, and the
// TSB tile — the signal still feeds the AI snapshot unchanged.
export function ReadinessAlerts({
  fatigueAlert,
  loadRamp,
}: {
  fatigueAlert: FatigueAlert | null;
  loadRamp: LoadRampAlert | null;
}) {
  // Tips open on keyboard focus too (tabIndex + group-focus-within), not hover alone — the
  // Constitution §6 rule; ids wire the text to assistive tech.
  const tipId = useId();
  if (!fatigueAlert?.triggered && !loadRamp?.triggered) return null;
  return (
    <div className="mb-2 space-y-1.5">
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
          tabIndex={0}
          aria-describedby={`${tipId}-ramp`}
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
          <MetricTip id={`${tipId}-ramp`} text="Flags when this week's training load jumps well above last week's — a common injury-risk signal." />
        </div>
      )}
    </div>
  );
}

// ---------- Today's ride analysis ----------

export function TodayRideCard({
  analysis,
  onPostNote,
  notePosting,
  notePosted,
  notePostFailed,
  analyzing,
  onReAnalyse,
}: {
  analysis: TodayAnalysis;
  onPostNote?: () => void;
  notePosting?: boolean;
  notePosted?: boolean;
  notePostFailed?: boolean; // last post attempt failed — the button says so and retries (S1-3)
  analyzing?: boolean; // the deferred coach-note step is in flight
  onReAnalyse?: () => void; // manual (re)generate — absent for read-only renders (last-debrief disclosure)
}) {
  const plannedStyle = analysis.plannedType
    ? TYPE_STYLES[analysis.plannedType as keyof typeof TYPE_STYLES] ?? TYPE_STYLES.Z2
    : null;
  // Keyboard/AT access for the metric-strip + decoupling tips (focus reveals; hover stays).
  const tipId = useId();

  const note = analysis.coachNote ?? (analysis as unknown as { analysis?: string }).analysis ?? null;
  // Coach takeaway ≤3 sentences visible (court rule 3); the rest is one disclosure away.
  const takeaway = note ? splitLeadSentences(note, 3) : null;

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
  // RPE tile removed (FB-2026-06-30) alongside dropping RPE as an athlete-state driver — revisit once a
  // real RPE-logging baseline exists.

  const body = (
    <>
      {/* The debrief verdict first (M2): execution is the answer to "how did it go?". */}
      {analysis.executionScore != null && (
        <div className="flex items-center gap-3">
          <span className="font-mono text-3xl font-bold leading-none text-zinc-800 dark:text-[#ff49c8]">
            {analysis.executionScore}
            <span className="font-sans text-sm font-normal text-zinc-500 dark:text-zinc-400">/10</span>
          </span>
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            {executionScoreLabel(analysis.executionScore)}
          </span>
          {onPostNote && analysis.coachNote && (
            <button
              onClick={onPostNote}
              disabled={notePosting || notePosted}
              title={notePostFailed ? "Posting failed — click to retry" : "Post coach note to Intervals.icu"}
              className={`ml-auto shrink-0 whitespace-nowrap rounded border px-2 py-1 text-[10px] font-medium transition-colors ${
                notePosted
                  ? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
                  : notePostFailed
                    ? "border-red-300 text-red-700 hover:border-red-400 dark:border-red-700 dark:text-red-400 dark:hover:border-red-600"
                    : "border-zinc-300 text-zinc-600 hover:border-zinc-400 hover:text-zinc-800 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
              }`}
            >
              {notePosted ? "✓ Posted" : notePosting ? "Posting…" : notePostFailed ? "✕ Failed — retry" : "↑ Post to Intervals.icu"}
            </button>
          )}
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

      {/* Planned vs actual as one line (masterplan §4): the comparison, not two boxes. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Planned</span>
        {analysis.plannedName ? (
          <>
            <span className="font-medium text-zinc-800 dark:text-zinc-200">{analysis.plannedName}</span>
            {plannedStyle && (
              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${plannedStyle.badge}`}>
                {analysis.plannedType}
              </span>
            )}
            {analysis.plannedDurationMin !== null && (
              <span className="text-zinc-500 dark:text-zinc-400">{analysis.plannedDurationMin} min</span>
            )}
          </>
        ) : (
          <span className="text-zinc-500 dark:text-zinc-400">no session planned</span>
        )}
        <span aria-hidden className="text-zinc-400 dark:text-zinc-500">→</span>
        <span className="font-medium text-zinc-800 dark:text-zinc-200">{analysis.activityName}</span>
        <span className="text-zinc-500 dark:text-zinc-400">{analysis.activityDurationMin} min</span>
        {analysis.activityAvgHr !== null && (
          <span className="text-zinc-500 dark:text-zinc-400">{analysis.activityAvgHr} bpm avg</span>
        )}
        {analysis.activityKj !== null && (
          <span className="text-zinc-500 dark:text-zinc-400">{analysis.activityKj} kcal</span>
        )}
      </div>

      {/* Key metrics strip */}
      {metrics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {metrics.map((m) => (
            <div
              key={m.label}
              tabIndex={m.tip ? 0 : undefined}
              aria-describedby={m.tip ? `${tipId}-${m.label.replace(/\s+/g, "-")}` : undefined}
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
              {m.tip && <MetricTip id={`${tipId}-${m.label.replace(/\s+/g, "-")}`} text={m.tip} />}
            </div>
          ))}
        </div>
      )}

      {/* Coach takeaway — ≤3 sentences visible, full note one disclosure away (court rule 3).
          The analysing / missing-note / re-analyse states live here now: the old right-column
          note Zone died with the two-moment split (UX v2 §4), and keeping one stable card frame
          around the swapping inner content preserves the FB-2026-06-30 no-remount fix. */}
      <div className="mt-3 border-l-2 border-zinc-300 pl-3 dark:border-[#ff49c8]/30">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Coach takeaway</p>
        {takeaway ? (
          <>
            <p className="mt-0.5 text-xs leading-5 text-zinc-600 dark:text-zinc-300">{takeaway.lead}</p>
            {takeaway.rest && (
              <details className="mt-1">
                <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Full note
                </summary>
                <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">{takeaway.rest}</p>
              </details>
            )}
            {onReAnalyse && (
              <button
                onClick={onReAnalyse}
                disabled={analyzing}
                title="Regenerate today's coach note"
                className="mt-2 rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
              >
                {analyzing ? "Re-analysing…" : "↻ Re-analyse"}
              </button>
            )}
          </>
        ) : analyzing ? (
          <p className="mt-0.5 text-xs italic leading-5 text-zinc-500 dark:text-zinc-400">Analysing today&apos;s ride…</p>
        ) : onReAnalyse ? (
          // Ride synced but the note is missing (e.g. the auto-run hit an Anthropic hiccup) —
          // offer a manual retry instead of waiting for the next full sync.
          <>
            <p className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">No coach note yet.</p>
            <button
              onClick={onReAnalyse}
              className="mt-2 rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
            >
              ↻ Generate coach note
            </button>
          </>
        ) : (
          <p className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">No coach note for this ride.</p>
        )}
      </div>

      {/* Power execution — the card's focal group: prescription vs execution, the
          power/HR trace, and power time-in-zone. There is no separate HR zone bar;
          HR comparison lives in the trace overlay (decoupling = the gap widening). */}
      {(analysis.powerZoneTimes || analysis.trace || analysis.activityDecoupling != null || (analysis.intervalComparison && analysis.intervalComparison.reps.length > 0)) && (
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {/* EC-7: "Power execution" only with real power content; a decoupling-only ride (no
                zones/trace/intervals) is aerobic drift, not power execution — label it honestly. */}
            {analysis.powerZoneTimes || analysis.trace || (analysis.intervalComparison && analysis.intervalComparison.reps.length > 0)
              ? "Power execution"
              : "Aerobic drift"}
            {analysis.intervalComparison && analysis.intervalComparison.reps.length > 0 && (
              <span className="ml-1.5 font-mono text-[11px] font-normal normal-case text-zinc-500 dark:text-zinc-400">
                {analysis.intervalComparison.completed}/{analysis.intervalComparison.total} · {analysis.intervalComparison.effectiveAdherencePct}%
              </span>
            )}
          </summary>
          <div className="mt-2 space-y-2">

          {/* Decoupling (C): relocated here from the metric strip — context, not a scored signal. */}
          {analysis.activityDecoupling != null && (
            <div
              tabIndex={0}
              aria-describedby={`${tipId}-decoupling`}
              className="group relative inline-flex items-center gap-1.5 rounded bg-zinc-100 px-2.5 py-1.5 dark:bg-zinc-900"
            >
              <span className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                Decoupling <span className="opacity-60">ⓘ</span>
              </span>
              <span className="font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                {analysis.activityDecoupling.toFixed(1)}%
              </span>
              <MetricTip id={`${tipId}-decoupling`} text="Aerobic drift — how much power-to-HR drifted across the ride. Context only: it's no longer part of your execution score (too noisy per-ride), kept as a steady-ride durability reference. Lower is better; ~5%+ on a steady endurance ride hints at fatigue or under-fuelling." />
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

      {/* Session disposition — the athlete attributes how it went (esp. "compromised") so a
          fluke ride doesn't teach the model or get misdiagnosed by the coach. */}
      <SessionDisposition date={analysis.activityDate} />

      {/* Athlete note (Intervals.icu activity description) — disclosed, not fold-1 (M2 budget). */}
      {analysis.activityDescription != null && analysis.activityDescription.trim() !== "" && (
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Your note
          </summary>
          <p className="mt-1 text-xs italic leading-5 text-zinc-600 dark:text-zinc-400">{analysis.activityDescription}</p>
        </details>
      )}
    </>
  );
  return body;
}

// ---------- "Eat today" — the post-ride fuel card (UX v2 §4) ----------

// Advised daily intake + its formula, promoted out of the ride card: post-ride this is the
// decision that still remains (M2). The deterministic fuel-prompt nudge/gap read rides along —
// same decision, same moment. Truthy-checked fields throughout (never `=== null`): a
// today-analysis.json written before a field existed parses back with the key simply absent.
export function EatToday({ analysis }: { analysis: TodayAnalysis }) {
  if (analysis.advisedIntakeKcal == null && !analysis.fuelPrompt) return null;
  return (
    <Card title="Eat today">
      {analysis.advisedIntakeKcal != null && (
        <div className="flex items-baseline gap-3">
          <p className="font-mono text-xl font-bold text-zinc-900 dark:text-[#ff49c8] dark:[text-shadow:0_0_8px_rgba(255,73,200,0.3)]">
            {analysis.advisedIntakeKcal.toLocaleString()} kcal
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {analysis.advisedBaseKcal?.toLocaleString()} base
            {analysis.advisedRideFuelKcal ? ` + ${analysis.advisedRideFuelKcal.toLocaleString()} ride` : ""}
            {analysis.advisedBufferKcal ? ` + ${analysis.advisedBufferKcal.toLocaleString()} buffer` : ""}
          </p>
        </div>
      )}
      {analysis.fuelPrompt && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <span className="text-sm" aria-hidden>⛽</span>
          {analysis.fuelPrompt.kind === "log-nudge" ? (
            <p className="text-xs text-zinc-600 dark:text-zinc-300">
              Log your in-ride carbs on Intervals.icu —{" "}
              {analysis.fuelPrompt.reason === "long-ride" ? "long rides" : "interval days"} teach your fueling
              optimum.
            </p>
          ) : (
            <p className="text-xs text-zinc-600 dark:text-zinc-300">
              You logged{" "}
              <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-100">
                {analysis.fuelPrompt.loggedGPerH} g/h
              </span>
              ; your derived optimum is{" "}
              <span className="font-mono font-semibold text-cyan-700 dark:text-[#00d4ff]">
                {analysis.fuelPrompt.optimumGPerH} g/h
              </span>{" "}
              <span className="text-zinc-400 dark:text-zinc-500">(from your own rides)</span>.
            </p>
          )}
        </div>
      )}
    </Card>
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
  const tipId = useId();
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
      <div tabIndex={0} aria-describedby={`${tipId}-tsb`} className="group relative rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
        <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          <span className="underline decoration-dotted underline-offset-2">TSB (form)</span>
          <MetricTip id={`${tipId}-tsb`} text="Training Stress Balance = fitness (CTL, 42-day load) minus fatigue (ATL, 7-day load) — your 'form'. Negative means you're carrying training fatigue; positive means you're fresh/tapered. Rough guide: −10 to −30 is productive overload, around 0 is balanced, +5 to +25 is race-ready freshness, below −30 risks digging a hole." />
        </p>
        <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-800 dark:text-[#ff49c8]">
          {sync.fitness.tsb?.toFixed(1) ?? "—"}
          {tsbArrow ? <span className="ml-0.5 text-[10px] font-normal text-cyan-600 dark:text-[#00d4ff]">{tsbArrow}</span> : null}
        </p>
      </div>
      {acwr && (
        <div tabIndex={0} aria-describedby={`${tipId}-acwr`} className="group relative rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            <span className="underline decoration-dotted underline-offset-2">ACWR</span>
            {/* S2-6: trimmed to Constitution §6's 2-sentence tip limit — the ratio/level readout is
                already the value shown beside this label, so it isn't repeated here. */}
            <MetricTip
              id={`${tipId}-acwr`}
              text={`Acute:chronic workload ratio — your last 7 days of load (${acwr.acute} TSS/day) vs the last 28 (${acwr.chronic} TSS/day). Sweet spot is 0.8–1.3; below that you're detraining, above 1.5 is a spike with raised injury risk.`}
            />
          </p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            {acwr.ratio.toFixed(2)}
            <span className={`ml-1 text-[10px] font-normal ${ACWR_COLOR[acwr.level]}`}>{acwr.level}</span>
          </p>
        </div>
      )}
      {polarization && (
        <div tabIndex={0} aria-describedby={`${tipId}-polarization`} className="group relative rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {/* "· 7d" stamps the window on the label (S2-3): Trend pulse shows a near-identical e/m/h
                split over 28d — the two must not read as the same number disagreeing. */}
            <span className="underline decoration-dotted underline-offset-2">Polarization · 7d</span>
            <MetricTip
              id={`${tipId}-polarization`}
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
  const tipId = useId();
  if (!sync) return null;
  const ea = computeEnergyAvailability(sync.wellness, sync.activities, todayIso());
  if (!ea) return null; // withheld until ≥3 complete logged days — no flaky single-day number
  // Trend is vs the prior week; higher EA (more spare energy) is "up".
  const arrow = ea.trend != null && ea.trend !== 0 ? trendArrow(ea.eaKcalPerKg, ea.eaKcalPerKg - ea.trend, true) : null;
  // A soft, non-clinical read so the number means something at a glance (FB-2026-06-30) — bands are on a
  // body-weight basis, not the clinical FFM cutoffs (see eaLevel), so the tip frames it as a rough reference.
  const level = eaLevel(ea.eaKcalPerKg);
  const levelTone =
    level === "low"
      ? "text-amber-600 dark:text-amber-400"
      : level === "ample"
        ? "text-cyan-700 dark:text-[#00d4ff]"
        : "text-zinc-500 dark:text-zinc-400";
  return (
    <div
      tabIndex={0}
      aria-describedby={`${tipId}-ea`}
      className="group relative mt-2 flex items-center justify-between gap-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900"
    >
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <span className="underline decoration-dotted underline-offset-2">Energy availability</span>
        {/* S2-6: trimmed to Constitution §6's 2-sentence tip limit. */}
        <MetricTip id={`${tipId}-ea`} text={`Energy left for recovery — logged intake minus exercise burn, per kg body weight, averaged over your last ${ea.daysUsed} complete days. A rough proxy on body weight (not the clinical fat-free-mass figure) — reads low if you under-log intake.`} />
      </p>
      <p className="shrink-0 font-mono text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        {ea.eaKcalPerKg}
        <span className="ml-0.5 text-[10px] font-normal text-zinc-500 dark:text-zinc-400"> kcal/kg</span>
        <span className={`ml-1.5 font-sans text-[10px] font-medium ${levelTone}`}>{level}</span>
        {arrow && <span className="ml-1 text-[10px] font-normal text-cyan-600 dark:text-[#00d4ff]">{arrow}</span>}
        {/* S3-4: the documented micro-label pair (DESIGN.md §3 — zinc-500 light / zinc-400 dark,
            "for AA contrast"); this suffix had drifted to the inverse pair. On the dark zinc-900
            tile zinc-500 was 3.67:1 (fails AA 4.5:1) vs zinc-400's 6.91:1; on the light zinc-50
            tile zinc-400 was 2.46:1 vs zinc-500's 4.63:1. */}
        <span className="ml-1.5 text-[10px] font-normal text-zinc-500 dark:text-zinc-400">{ea.daysUsed}d</span>
      </p>
    </div>
  );
}

// ---------- Today's planned session (Zone 2 fallback before a ride is logged) ----------

export function PlannedToday({ block }: { block: CurrentBlock | null }) {
  const today = todayIso();
  if (isBlockFinished(block, today)) {
    return (
      <div>
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
          Your block finished on {block!.endDate} — ready to plan the next one?
        </p>
        <Link
          href="/plan"
          className="mt-2 inline-block text-sm text-cyan-700 hover:underline dark:text-[#00d4ff]"
        >
          Generate the next block →
        </Link>
      </div>
    );
  }
  const day = block?.days.find((d) => d.date === today) ?? null;

  // Rest/empty days answer M1 with "what's next" instead (masterplan §4): tomorrow's session.
  const tomorrow = block?.days.find((d) => d.date === addDaysIso(today, 1)) ?? null;
  const tomorrowPreview =
    tomorrow && tomorrow.type !== "Rest" ? (
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Tomorrow: <span className="font-medium text-zinc-700 dark:text-zinc-300">{tomorrow.name}</span>
        {" · "}
        {tomorrow.type}
        {tomorrow.durationMin > 0 ? ` · ${tomorrow.durationMin} min` : ""}
      </p>
    ) : tomorrow ? (
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Tomorrow: rest day.</p>
    ) : null;

  if (!day || day.type === "Rest") {
    if (day?.type === "Rest") {
      return (
        <div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Rest day — recover.</p>
          {tomorrowPreview}
        </div>
      );
    }
    // S1-4: no active block is a dead end without a link — mirrors the finished-block CTA above.
    // A block that HAS a gap for today (rare data edge case) still gets the plain honest message.
    if (!block) {
      return (
        <div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No active training block yet.</p>
          <Link
            href="/plan"
            className="mt-2 inline-block text-sm text-cyan-700 hover:underline dark:text-[#00d4ff]"
          >
            Plan your next block →
          </Link>
        </div>
      );
    }
    return (
      <div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No session planned for today.</p>
        {tomorrowPreview}
      </div>
    );
  }
  const style = TYPE_STYLES[day.type];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{day.name}</span>
        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${style.badge}`}>{day.type}</span>
        {day.durationMin > 0 && (
          <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{day.durationMin} min</span>
        )}
      </div>
      {day.prescription && day.prescription.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Prescribed</span>
          {day.prescription.map((iv, i) => (
            <span
              key={i}
              className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-700 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff] dark:ring-1 dark:ring-[#00d4ff]/30"
            >
              {formatPrescriptionLabel(iv)}
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
