import { NextResponse } from "next/server";
import { createEvent, deleteEvents, isIntervalsConfigured } from "@/lib/intervals-api";
import { appendBlockHistory, readAthleteProfile, readCurrentBlock, readInterventionLog, readLastSync, readScoreLog, writeCurrentBlock, writeInterventionLog } from "@/lib/data-store";
import { buildAthleteModel, deriveInsights } from "@/lib/athlete-model";
import { buildInterventions, mergeInterventions } from "@/lib/intervention";
import { planDayToEvent } from "@/lib/plan-parser";
import { staleEventIds } from "@/lib/block-events";
import { utcToday } from "@/lib/date";
import { parsePrescription } from "@/lib/prescription";
import type { CurrentBlock, GeneratedPlan, PlannedDay, WriteResult } from "@/lib/types";
import { WORKOUT_TYPES } from "@/lib/types";

export const maxDuration = 120;

function validatePlan(body: unknown): GeneratedPlan | string {
  if (!body || typeof body !== "object") return "Request body must be a JSON object.";
  const plan = (body as Record<string, unknown>).plan;
  if (!plan || typeof plan !== "object") return "Missing plan.";
  const p = plan as Record<string, unknown>;
  if (!Array.isArray(p.days) || p.days.length === 0) return "Plan has no days.";
  for (const day of p.days) {
    const d = day as Record<string, unknown>;
    if (typeof d.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      return "Every day needs a YYYY-MM-DD date.";
    }
    if (typeof d.name !== "string" || typeof d.description !== "string") {
      return `Day ${d.date}: name and description are required.`;
    }
    if (!WORKOUT_TYPES.includes(d.type as (typeof WORKOUT_TYPES)[number])) {
      return `Day ${d.date}: invalid type "${String(d.type)}".`;
    }
  }
  return plan as unknown as GeneratedPlan;
}

export async function POST(req: Request) {
  if (!isIntervalsConfigured()) {
    return NextResponse.json(
      { error: "Intervals.icu is not configured. Set INTERVALS_API_KEY and INTERVALS_ATHLETE_ID in .env.local." },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const plan = validatePlan(body);
  if (typeof plan === "string") {
    return NextResponse.json({ error: plan }, { status: 400 });
  }

  // Sequential writes so per-day results are deterministic and the API isn't hammered.
  const results: WriteResult[] = [];
  for (const day of plan.days as PlannedDay[]) {
    try {
      const eventId = await createEvent(planDayToEvent(day));
      results.push({ date: day.date, name: day.name, ok: true, eventId });
    } catch (err) {
      results.push({
        date: day.date,
        name: day.name,
        ok: false,
        eventId: null,
        error: err instanceof Error ? err.message : "Write failed",
      });
    }
  }

  const allOk = results.every((r) => r.ok);

  // Auto-rollback (RV-9): a partial write must never leave a half-written block on the calendar. Delete
  // the days that DID write so the calendar returns to its pre-write state, and report it. The stable
  // per-day uid (RV-2) means a later clean re-Write still won't duplicate — this just doesn't make the
  // user live with a half-block in the meantime. Nothing is persisted locally on a failed write.
  if (!allOk) {
    const created = results.filter((r) => r.ok && r.eventId !== null).map((r) => r.eventId as number);
    const { deleted, failed } = created.length > 0 ? await deleteEvents(created) : { deleted: [], failed: [] };
    return NextResponse.json({
      results,
      blockSaved: false,
      currentBlock: null,
      rolledBack: deleted.length,
      rollbackFailed: failed, // ids the rollback couldn't remove (rare) — surfaced so the user can clear them
    });
  }

  // Archive the old block before replacing it.
  const existing = await readCurrentBlock();
  if (existing) {
    await appendBlockHistory({
      id: existing.createdAt,
      goal: existing.goal,
      startDate: existing.startDate,
      endDate: existing.endDate,
      lengthWeeks: existing.lengthWeeks,
      overview: existing.overview,
      createdAt: existing.createdAt,
      model: existing.model,
      promptVersion: existing.promptVersion,
      durabilityTemplate: existing.durabilityTemplate,
    });
  }

  const dates = plan.days.map((d) => d.date).sort();
  const ftp = (await readAthleteProfile()).performance.ftp;
  // The event id each day was written as, so the block's events can be pruned on a later discard/replace.
  const eventIdByDate = new Map(results.map((r) => [r.date, r.eventId]));
  const currentBlock: CurrentBlock = {
    goal: plan.blockParams.goal,
    lengthWeeks: plan.blockParams.lengthWeeks,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    overview: plan.overview,
    createdAt: new Date().toISOString(),
    model: plan.model,
    promptVersion: plan.promptVersion,
    durabilityTemplate: plan.durabilityTemplate,
    days: plan.days.map((d) => {
      // Capture the coach's prescription structurally so execution can be compared.
      const prescription = parsePrescription(d.workoutText, ftp);
      const eventId = eventIdByDate.get(d.date) ?? null;
      return {
        date: d.date,
        name: d.name,
        type: d.type,
        durationMin: d.durationMin,
        ...(d.workoutText ? { workoutText: d.workoutText } : {}),
        ...(prescription.length > 0 ? { prescription } : {}),
        ...(eventId !== null ? { eventId } : {}),
      };
    }),
  };
  await writeCurrentBlock(currentBlock);

  // Clean the replaced block's now-orphaned events (RV-9): future planned days the new block doesn't
  // re-cover. A shared date is upserted in place (same uid) so it's left alone; past days keep their
  // marker (the athlete may have ridden them). Best-effort — never fail the write on cleanup.
  if (existing) {
    const stale = staleEventIds(existing, currentBlock.days.map((d) => d.date), utcToday());
    if (stale.length > 0) await deleteEvents(stale);
  }

  // Record the insights that drove this block as interventions, with a baseline snapshot,
  // to be validated after a horizon (the learning loop). Best-effort.
  try {
    const firedAt = new Date().toISOString().slice(0, 10);
    const [scoreLog, sync, log] = await Promise.all([readScoreLog(), readLastSync(), readInterventionLog()]);
    const model = buildAthleteModel(scoreLog.entries);
    const fresh = buildInterventions(deriveInsights(model), model, sync, currentBlock.startDate, firedAt);
    if (fresh.length > 0) {
      await writeInterventionLog({
        records: mergeInterventions(log.records, fresh),
        updatedAt: new Date().toISOString(),
      });
    }
  } catch {
    // Non-critical.
  }

  return NextResponse.json({ results, blockSaved: true, currentBlock });
}
