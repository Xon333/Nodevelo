import { NextResponse } from "next/server";
import { createEvent, isIntervalsConfigured } from "@/lib/intervals-api";
import { appendBlockHistory, readAthleteProfile, readCurrentBlock, readInterventionLog, readLastSync, readScoreLog, writeCurrentBlock, writeInterventionLog } from "@/lib/data-store";
import { buildAthleteModel, deriveInsights } from "@/lib/athlete-model";
import { buildInterventions, mergeInterventions } from "@/lib/intervention";
import { planDayToEvent } from "@/lib/plan-parser";
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
  let currentBlock: CurrentBlock | null = null;
  if (allOk) {
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
    currentBlock = {
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
        return {
          date: d.date,
          name: d.name,
          type: d.type,
          durationMin: d.durationMin,
          ...(d.workoutText ? { workoutText: d.workoutText } : {}),
          ...(prescription.length > 0 ? { prescription } : {}),
        };
      }),
    };
    await writeCurrentBlock(currentBlock);

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
  }

  return NextResponse.json({ results, blockSaved: allOk, currentBlock });
}
