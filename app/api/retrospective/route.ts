import { NextResponse } from "next/server";
import { logError, logWarn } from "@/lib/log";
import {
  appendBlockHistory,
  readAthleteProfile,
  readBlockHistory,
  readCurrentBlock,
  readInterventionLog,
  readLastSync,
  readScoreLog,
  updateCurrentBlock,
} from "@/lib/data-store";
import { analyzePowerProfile, formatPowerProfileForPrompt, powerProfileSeed } from "@/lib/power-profile";
import { retroFileId, writeRetrospective } from "@/lib/kb-loader";
import { blockChangedResponse } from "@/lib/block-version";
import { isBlockFinished, resolveToday } from "@/lib/date";
import { truncateBlockDays } from "@/lib/score-log";
import { isSeasonFocus } from "@/lib/season";
import { isSteadyEnduranceRide } from "@/lib/aerobic";
import { buildCloseoutEvidence, deriveCloseoutSeeds } from "@/lib/block-closeout";
import {
  generateRetrospective,
  generateStructuredRetrospective,
  isAnthropicConfigured,
  type ReflectionInterventionInput,
} from "@/lib/anthropic-api";
import type { BlockHistoryEntry, StructuredReflection, WorkoutType } from "@/lib/types";

// slugify deleted — kb-loader.retroFileId owns filename derivation (single owner).

// Correct YAML double-quoted scalar for frontmatter string values: escape backslashes first, then
// quotes (never substitute them), then flatten CR/LF runs to one space so the value stays on a
// single frontmatter line. parseRetroSeeds in kb-loader unescapes the exact inverse of this form.
export function yamlDoubleQuoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ").trim()}"`;
}

function closestCtl(
  wellness: Array<{ date: string; ctl: number | null }>,
  targetDate: string
): number | null {
  const sorted = [...wellness]
    .filter((w) => w.ctl !== null)
    .sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(targetDate)) - Math.abs(Date.parse(b.date) - Date.parse(targetDate)));
  return sorted[0]?.ctl ?? null;
}

// POST — generate retrospective for current block (or most recent history entry without one)
export async function POST(req: Request) {
  // No body was previously ever sent here — tolerate one missing/empty entirely, since `today` is
  // optional (falls back to UTC) and this keeps the route accepting the same bare POST it always has.
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // no body sent — fine
  }
  const b = (body ?? {}) as Record<string, unknown>;
  // HR-32: was utcToday() at the archive-truncation call site below — see the identical fix on
  // /api/sync's DELETE and /api/write's POST.
  const today = resolveToday(b.today);

  const [block, sync, interventionLog, athleteProfile, scoreLog] = await Promise.all([
    readCurrentBlock(),
    readLastSync(),
    readInterventionLog(),
    readAthleteProfile(),
    readScoreLog(),
  ]);

  if (!block) {
    return NextResponse.json({ error: "No active block found." }, { status: 404 });
  }
  // HR-33: checked before any live LLM call below (tens of seconds) so a stale tab can't
  // archive-and-clear a block another tab already replaced in the meantime.
  const expectedCreatedAt = "expectedBlockCreatedAt" in b ? (b.expectedBlockCreatedAt as string | null) : undefined;
  const versionError = blockChangedResponse(block, expectedCreatedAt);
  if (versionError) return versionError;
  if (!sync) {
    return NextResponse.json({ error: "No sync data — sync first." }, { status: 400 });
  }

  // Phase 1 gate: a normal completion or an EXPLICIT early-end decision precedes closeout.
  const endReason = typeof b.endReason === "string" ? b.endReason.trim() : "";
  const endedEarly = b.endedEarly === true && endReason.length > 0;
  if (!isBlockFinished(block, today) && !endedEarly) {
    return NextResponse.json(
      { error: "This block hasn't finished yet. Wait for its end date, or record why it's ending early." },
      { status: 409 }
    );
  }

  // Match actual activities to planned days within the block range.
  const blockActivities = sync.activities.filter(
    (a) => a.date >= block.startDate && a.date <= block.endDate && (a.type === "Ride" || a.type === "VirtualRide")
  );

  const actualHours = blockActivities.reduce((s, a) => s + a.movingTimeSec, 0) / 3600;
  const plannedHours = block.days.reduce((s, d) => s + d.durationMin, 0) / 60;

  // Deterministic FIRST (works with Claude fully unavailable). Evidence covers only lived days.
  const evidence = buildCloseoutEvidence(
    block,
    scoreLog.entries,
    blockActivities,
    today < block.endDate ? today : block.endDate
  );

  const ctlStart = closestCtl(sync.wellness, block.startDate);
  const ctlEnd = closestCtl(sync.wellness, block.endDate);

  const decoupList = blockActivities
    // INVARIANT 34: this block average needs whole-ride comparability, not qualifyingPwHr's
    // separate Z2-segment trust gate; mixed/high-variability rides must not leak into it.
    .filter((a) => isSteadyEnduranceRide(a, athleteProfile.performance.ftp))
    .map((a) => a.decoupling)
    .filter((v): v is number => v !== null);
  const avgDecoupling =
    decoupList.length > 0
      ? Math.round((decoupList.reduce((s, v) => s + v, 0) / decoupList.length) * 10) / 10
      : null;

  const topSessions = [...blockActivities]
    .filter((a) => a.trainingLoad !== null)
    .sort((a, b) => (b.trainingLoad ?? 0) - (a.trainingLoad ?? 0))
    .slice(0, 3)
    .map((a) => ({ date: a.date, name: a.name, tss: a.trainingLoad as number }));

  // Track A: read the rider's curve SHAPE (rider type + relative-strength systems + easy-win) into the
  // retrospective, not just compliance. Recent (84-day) curve so it reflects the form this block produced;
  // formatPowerProfileForPrompt → "" when the curve is too thin to say anything (the prompt then omits it).
  const latestWeight =
    [...sync.wellness].filter((w) => w.weightKg !== null).sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg ??
    athleteProfile.performance.weightKg;
  const powerProfile = analyzePowerProfile(sync.powerCurve, athleteProfile.performance.ftp, latestWeight, "84-day");
  const powerProfileText = formatPowerProfileForPrompt(powerProfile);

  // Model-input compliance switches to the CAPPED ledger figure (same RetrospectiveInput shape).
  const overallCompliancePct = evidence.overallMeanCompliancePct ?? 0;
  const complianceMap: Record<string, number> = {};
  for (const t of evidence.perType) {
    if (t.scored > 0 && t.meanCompliancePct !== null) complianceMap[t.type] = t.meanCompliancePct;
  }

  // Best-effort narrative: skip unconfigured, survive failure — closeout never depends on Claude.
  let retrospective: string | undefined;
  let narrativeDegraded = false;
  if (!isAnthropicConfigured()) {
    narrativeDegraded = true;
    logWarn("/api/retrospective", "narrative", "skipped — Anthropic not configured; closing out deterministically");
  } else {
    try {
      retrospective = await generateRetrospective({
        goal: block.goal,
        lengthWeeks: block.lengthWeeks,
        startDate: block.startDate,
        endDate: block.endDate,
        plannedHours,
        actualHours,
        overallCompliancePct,
        ctlStart,
        ctlEnd,
        complianceByType: complianceMap,
        topSessions,
        avgDecoupling,
        powerProfile: powerProfileText,
      });
    } catch (err) {
      narrativeDegraded = true;
      logWarn("/api/retrospective", "generate", err instanceof Error ? err.message : String(err));
    }
  }

  // Track D: structured reflections. Feed the model the hypotheses this block acted on (the matured
  // interventions) + their scored outcomes, and let it phrase one clinical reflection each. Additive
  // to the prose above; degrades to [] when there are no matured interventions or the call fails.
  const maturedInterventions: ReflectionInterventionInput[] = interventionLog.records
    .filter((r) => r.blockStartDate === block.startDate && r.outcome !== null)
    .map((r) => ({
      dimension: r.dimension,
      severity: r.severity,
      title: r.title,
      physMetric: r.physMetric,
      baselineExecEwma: r.baselineExecEwma,
      baselinePhys: r.baselinePhys,
      outcome: {
        execNow: r.outcome!.execNow,
        physNow: r.outcome!.physNow,
        execDelta: r.outcome!.execDelta,
        physDelta: r.outcome!.physDelta,
        verdict: r.outcome!.verdict,
      },
    }));

  let structuredReflections: StructuredReflection[] = [];
  if (maturedInterventions.length > 0) {
    try {
      structuredReflections = await generateStructuredRetrospective({
        goal: block.goal,
        lengthWeeks: block.lengthWeeks,
        startDate: block.startDate,
        endDate: block.endDate,
        plannedHours,
        actualHours,
        overallCompliancePct,
        ctlStart,
        ctlEnd,
        complianceByType: complianceMap,
        topSessions,
        avgDecoupling,
        powerProfile: powerProfileText,
        interventions: maturedInterventions,
      });
    } catch (err) {
      logWarn("/api/retrospective", "structured-reflections", err instanceof Error ? err.message : String(err));
      structuredReflections = []; // never block the retrospective on the structured call
    }
  }

  const seeds = deriveCloseoutSeeds(evidence, ctlStart, ctlEnd, powerProfileSeed(powerProfile));

  const fileId = retroFileId(block.startDate, block.goal);
  const frontmatter = [
    "---",
    `id: "${fileId}"`,
    `goal: ${yamlDoubleQuoted(block.goal)}`,
    `start_date: "${block.startDate}"`,
    `end_date: "${block.endDate}"`,
    `length_weeks: ${block.lengthWeeks}`,
    `status: completed`,
    ...(endedEarly
      ? [
          `ended_early: true`,
          `ended_early_reason: ${yamlDoubleQuoted(endReason)}`,
        ]
      : []),
    `execution_scored: ${evidence.scoredSessions}/${evidence.plannedSessions}`,
    `execution_missed_sessions: ${evidence.missedSessions}`,
    `execution_overshoot_days: ${evidence.overshootSessions}`,
    `execution_mean_score: ${evidence.overallMeanExecution ?? "n/a"}`,
    `seeds_approved: false`,
    "next_block_seeds:",
    ...seeds.map((s) => `  - ${yamlDoubleQuoted(s)}`),
    `generated_at: "${new Date().toISOString()}"`,
    "---",
    "",
    ...(retrospective ? ["## Retrospective", "", retrospective, ""] : []),
    ...(structuredReflections.length
      ? [
          "## Coach reflections (UNAPPROVED — adopt on Plan before they reach the next block)",
          "",
          ...structuredReflections.map(
            (r) =>
              `- **${r.dimension}** — _hypothesis:_ ${r.hypothesis} _observed:_ ${r.observation} ` +
              `_root cause:_ ${r.root_cause} _next:_ ${r.adjusted_strategy}`
          ),
          "",
        ]
      : []),
  ].join("\n");

  const historyEntry: BlockHistoryEntry = {
    id: block.createdAt,
    goal: block.goal,
    startDate: block.startDate,
    endDate: block.endDate,
    lengthWeeks: block.lengthWeeks,
    overview: block.overview,
    createdAt: block.createdAt,
    complianceByType: complianceMap as Partial<Record<WorkoutType, number>>,
    actualHours: Math.round(actualHours * 10) / 10,
    plannedHours: Math.round(plannedHours * 10) / 10,
    ctlGain: ctlStart !== null && ctlEnd !== null ? Math.round((ctlEnd - ctlStart) * 10) / 10 : null,
    nextBlockSeeds: seeds,
    closeout: evidence,
    ...(retrospective ? { retrospective } : {}),
    structuredReflections,
    model: block.model,
    promptVersion: block.promptVersion,
    ...(block.seasonFocus && isSeasonFocus(block.seasonFocus) ? { seasonFocus: block.seasonFocus } : {}),
    ...(endedEarly ? { endedEarlyAt: new Date().toISOString(), endedEarlyReason: endReason } : {}),
    // SUB-1: truncation keeps one code path instead of special-casing this call site — for an early
    // end it is what actually cuts the not-yet-lived days out of the archived entry.
    days: truncateBlockDays(block.days, today),
  };

  // Persist phase: markdown → history → CAS-clear, each strictly ordered. A failure here must leave
  // the later steps untouched — same coach-voice {error} contract as every other route's failures.
  let persistStage = "markdown";
  try {
    await writeRetrospective(`${fileId}.md`, frontmatter);
    persistStage = "history";
    await appendBlockHistory(historyEntry);
  } catch (err) {
    logError("/api/retrospective", persistStage, err);
    const message = err instanceof Error ? err.message : "Failed to save the retrospective.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // HR-35: re-check createdAt INSIDE the lock, right before this write — the guard above ran once,
  // before the live LLM call(s) above (tens of seconds, the widest window of any block-mutating route).
  // A second mutation (another tab's write/delete/reschedule) landing in that window previously still
  // got silently clobbered by this stale clear. On mismatch, the retrospective is still real and
  // already saved to Plan history above — only the active-block clear is rejected, so the client isn't
  // told a block was cleared when it wasn't.
  const written = await updateCurrentBlock(() => null, expectedCreatedAt); // ALWAYS last (HR-35)
  if (written !== null) {
    return NextResponse.json(
      {
        error: "This plan changed in another tab while generating the retrospective — it was saved to Plan history, but the active block wasn't cleared. Reload to see the latest.",
        retrospective: retrospective ?? null,
        narrativeDegraded,
        seeds,
        structuredReflections,
        fileId,
        complianceByType: complianceMap,
        closeout: evidence,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    retrospective: retrospective ?? null,
    narrativeDegraded,
    seeds,
    structuredReflections,
    fileId,
    complianceByType: complianceMap,
    closeout: evidence,
  });
}

// GET — return the most recent completed block retrospective (from history).
export async function GET() {
  const history = await readBlockHistory();
  const latest = history.find((h) => h.retrospective);
  return NextResponse.json({ entry: latest ?? null });
}
