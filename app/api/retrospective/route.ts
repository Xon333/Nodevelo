import { NextResponse } from "next/server";
import { logWarn } from "@/lib/log";
import {
  appendBlockHistory,
  readAthleteProfile,
  readBlockHistory,
  readCurrentBlock,
  readInterventionLog,
  readLastSync,
  updateCurrentBlock,
} from "@/lib/data-store";
import { analyzePowerProfile, formatPowerProfileForPrompt, powerProfileSeed } from "@/lib/power-profile";
import { writeRetrospective } from "@/lib/kb-loader";
import { blockChangedResponse } from "@/lib/block-version";
import { resolveToday } from "@/lib/date";
import { truncateBlockDays } from "@/lib/score-log";
import { isSeasonFocus } from "@/lib/season";
import {
  generateRetrospective,
  generateStructuredRetrospective,
  isAnthropicConfigured,
  type ReflectionInterventionInput,
} from "@/lib/anthropic-api";
import type { BlockHistoryEntry, StructuredReflection, WorkoutType } from "@/lib/types";

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
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
  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: "Anthropic API is not configured." }, { status: 400 });
  }

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

  const [block, sync, interventionLog, athleteProfile] = await Promise.all([
    readCurrentBlock(),
    readLastSync(),
    readInterventionLog(),
    readAthleteProfile(),
  ]);

  if (!block) {
    return NextResponse.json({ error: "No active block found." }, { status: 404 });
  }
  // HR-33: was the only block-mutating route with no version guard — write and DELETE both got the
  // UXA-24 check, this one didn't. Checked before the live LLM call below (tens of seconds) so a
  // stale tab can't archive-and-clear a block another tab already replaced in the meantime.
  const expectedCreatedAt = "expectedBlockCreatedAt" in b ? (b.expectedBlockCreatedAt as string | null) : undefined;
  const versionError = blockChangedResponse(block, expectedCreatedAt);
  if (versionError) return versionError;
  if (!sync) {
    return NextResponse.json({ error: "No sync data — sync first." }, { status: 400 });
  }

  // Match actual activities to planned days within the block range.
  const blockActivities = sync.activities.filter(
    (a) => a.date >= block.startDate && a.date <= block.endDate && (a.type === "Ride" || a.type === "VirtualRide")
  );

  const actualHours = blockActivities.reduce((s, a) => s + a.movingTimeSec, 0) / 3600;
  const plannedHours = block.days.reduce((s, d) => s + d.durationMin, 0) / 60;

  // Compliance by type
  const complianceByType: Partial<Record<WorkoutType, { planned: number; actual: number; totalCompliance: number }>> = {};
  for (const day of block.days) {
    if (day.durationMin === 0) continue;
    const type = day.type as WorkoutType;
    const actual = blockActivities.find((a) => a.date === day.date);
    const actualMin = actual ? Math.round(actual.movingTimeSec / 60) : 0;
    const compPct = Math.round((actualMin / day.durationMin) * 100);
    const entry = complianceByType[type] ?? { planned: 0, actual: 0, totalCompliance: 0 };
    complianceByType[type] = {
      planned: entry.planned + 1,
      actual: entry.actual + (actual ? 1 : 0),
      totalCompliance: entry.totalCompliance + compPct,
    };
  }

  const complianceMap: Record<string, number> = {};
  for (const [type, stats] of Object.entries(complianceByType)) {
    if (stats && stats.planned > 0) {
      complianceMap[type] = Math.round(stats.totalCompliance / stats.planned);
    }
  }

  const totalPlannedDays = block.days.filter((d) => d.durationMin > 0).length;
  const overallCompliancePct =
    totalPlannedDays > 0
      ? Math.round(
          Object.values(complianceByType).reduce((s, e) => s + (e?.totalCompliance ?? 0), 0) / totalPlannedDays
        )
      : 0;

  const ctlStart = closestCtl(sync.wellness, block.startDate);
  const ctlEnd = closestCtl(sync.wellness, block.endDate);

  const decoupList = blockActivities
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

  const retrospective = await generateRetrospective({
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

  // Build deterministic next-block seeds from compliance data.
  const seeds: string[] = [];
  for (const [type, pct] of Object.entries(complianceMap)) {
    if (pct < 75) seeds.push(`Reduce ${type} frequency or shorten sessions — ${pct}% avg compliance suggests consistent over-reach`);
    else if (pct >= 95) seeds.push(`${type} sessions execute well — safe to progress load`);
  }
  if (ctlStart !== null && ctlEnd !== null) {
    const gain = ctlEnd - ctlStart;
    if (gain >= 10) seeds.push("Strong CTL gain — consider progressing training load in next block");
    else if (gain <= 2) seeds.push("Minimal CTL gain — review session quality or increase effective volume");
  }
  // Track A: a curve-shape seed (rider type / easy-win) so the next-block read isn't compliance-only.
  const curveSeed = powerProfileSeed(powerProfile);
  if (curveSeed) seeds.push(curveSeed);

  // Write markdown file.
  const fileId = `${block.startDate}_${slugify(block.goal)}`;
  const frontmatter = [
    "---",
    `id: "${fileId}"`,
    `goal: "${block.goal}"`,
    `start_date: "${block.startDate}"`,
    `end_date: "${block.endDate}"`,
    `length_weeks: ${block.lengthWeeks}`,
    `status: completed`,
    `planned_hours: ${plannedHours.toFixed(1)}`,
    `actual_hours: ${actualHours.toFixed(1)}`,
    `compliance_pct: ${overallCompliancePct}`,
    ...(ctlStart !== null ? [`ctl_start: ${ctlStart}`] : []),
    ...(ctlEnd !== null ? [`ctl_end: ${ctlEnd}`] : []),
    "compliance_by_type:",
    ...Object.entries(complianceMap).map(([t, pct]) => `  ${t}: ${pct}`),
    "next_block_seeds:",
    ...seeds.map((s) => `  - "${s}"`),
    `generated_at: "${new Date().toISOString()}"`,
    "---",
    "",
    "## Retrospective",
    "",
    retrospective,
    ...(structuredReflections.length
      ? [
          "",
          "## Coach reflections",
          "",
          ...structuredReflections.map(
            (r) =>
              `- **${r.dimension}** — _hypothesis:_ ${r.hypothesis} _observed:_ ${r.observation} ` +
              `_root cause:_ ${r.root_cause} _next:_ ${r.adjusted_strategy}`
          ),
        ]
      : []),
  ].join("\n");

  await writeRetrospective(`${fileId}.md`, frontmatter);

  // Persist retrospective into block history and move block out of current.
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
    retrospective,
    structuredReflections,
    model: block.model,
    promptVersion: block.promptVersion,
    ...(block.seasonFocus && isSeasonFocus(block.seasonFocus) ? { seasonFocus: block.seasonFocus } : {}),
    // SUB-1: truncation is a no-op here in practice — a retrospective only runs on a finished block
    // (isBlockFinished), so every day is already in the past — but applying it uniformly keeps one code
    // path instead of special-casing this call site.
    days: truncateBlockDays(block.days, today),
  };
  await appendBlockHistory(historyEntry);
  // HR-35: re-check createdAt INSIDE the lock, right before this write — the guard above ran once,
  // before the live LLM call(s) above (tens of seconds, the widest window of any block-mutating route).
  // A second mutation (another tab's write/delete/reschedule) landing in that window previously still
  // got silently clobbered by this stale clear. On mismatch, the retrospective is still real and
  // already saved to Plan history above — only the active-block clear is rejected, so the client isn't
  // told a block was cleared when it wasn't.
  const written = await updateCurrentBlock(() => null, expectedCreatedAt);
  if (written !== null) {
    return NextResponse.json(
      {
        error: "This plan changed in another tab while generating the retrospective — it was saved to Plan history, but the active block wasn't cleared. Reload to see the latest.",
        retrospective,
        seeds,
        structuredReflections,
        fileId,
        complianceByType: complianceMap,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ retrospective, seeds, structuredReflections, fileId, complianceByType: complianceMap });
}

// GET — return the most recent completed block retrospective (from history).
export async function GET() {
  const history = await readBlockHistory();
  const latest = history.find((h) => h.retrospective);
  return NextResponse.json({ entry: latest ?? null });
}
