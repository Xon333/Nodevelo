import { NextResponse } from "next/server";
import { logError, logWarn } from "@/lib/log";
import { createEvent, deleteEvents, fetchEvents, isIntervalsConfigured } from "@/lib/intervals-api";
import { appendBlockHistory, readAthleteProfile, readBlockSettings, readCurrentBlock, readLastSync, readScoreLog, readSeasonPlan, updateCurrentBlock, updateInterventionLog } from "@/lib/data-store";
import { blockChangedResponse } from "@/lib/block-version";
import { dayToEventPayload } from "@/lib/calendar-mirror";
import { currentPeriod, isSeasonFocus } from "@/lib/season";
import { buildAthleteModel, deriveInsights } from "@/lib/athlete-model";
import { buildInterventions, mergeInterventions } from "@/lib/intervention";
import { planDayToEvent } from "@/lib/plan-parser";
import { staleEventIds } from "@/lib/block-events";
import { resolveToday } from "@/lib/date";
import { truncateBlockDays } from "@/lib/score-log";
import { parsePrescription } from "@/lib/prescription";
import { computeSessionLevel } from "@/lib/session-level";
import { validateWorkoutProtocol, validateDurationConsistency } from "@/lib/workout-validate";
import { resolveDurabilityInsertEnvelope } from "@/lib/calibration";
import type { CurrentBlock, CurrentBlockDay, GeneratedPlan, PlannedDay, WriteResult } from "@/lib/types";
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
      { error: "Connect Intervals.icu to write this block." },
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

  // UXA-24: checked before any Intervals.icu event is created — a stale tab shouldn't burn real
  // calendar writes on a block the server has already moved past. Read once, reused below for the
  // archive-the-old-block step instead of re-reading.
  const existing = await readCurrentBlock();
  const b = (body ?? {}) as Record<string, unknown>;
  const expectedCreatedAt = "expectedBlockCreatedAt" in b ? (b.expectedBlockCreatedAt as string | null) : undefined;
  const versionError = blockChangedResponse(existing, expectedCreatedAt);
  if (versionError) return versionError;
  // HR-32: was utcToday() at both use sites below — see the identical fix on /api/sync's DELETE.
  const today = resolveToday(b.today);

  // HR-38: snapshot the OLD block's current calendar descriptions BEFORE any new-plan event is
  // created — createEvent upserts on the stable nodevelo-<date> external_id, so for any date both
  // blocks cover, the loop below doesn't create a NEW event, it overwrites the old block's real one.
  // If the write then fails partway, a rollback that only knows how to delete would destroy that
  // still-active old session instead of restoring it. Must run before the loop (once a shared date's
  // event is overwritten, its original description is gone) — best-effort: a fetch failure just means
  // the eventual restore falls back to workoutText/empty, same convention as the reschedule mirror's
  // own description-carry (lib/calendar-mirror.ts).
  const existingDescByDate = new Map<string, string>();
  if (existing) {
    try {
      const oldEvents = await fetchEvents(existing.startDate, existing.endDate);
      for (const e of oldEvents) if (e.date && e.description) existingDescByDate.set(e.date, e.description);
    } catch {
      // best-effort — restore falls back to workoutText/empty below
    }
  }

  // Sequential writes so per-day results are deterministic and the API isn't hammered.
  const results: WriteResult[] = [];
  for (const day of plan.days as PlannedDay[]) {
    try {
      const eventId = await createEvent(planDayToEvent(day));
      results.push({ date: day.date, name: day.name, ok: true, eventId });
    } catch (err) {
      logError("/api/write", "create-event", err, { date: day.date });
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

  // Auto-rollback (RV-9): a partial write must never leave a half-written block on the calendar.
  // The stable per-day external_id (RV-2) means a later clean re-Write still won't duplicate — this
  // just doesn't make the user live with a half-block in the meantime. Nothing is persisted locally
  // on a failed write.
  if (!allOk) {
    const created = results.filter((r) => r.ok && r.eventId !== null);
    const existingByDate = new Map((existing?.days ?? []).map((d) => [d.date, d]));
    // HR-38: a shared date's "created" event above IS the old block's real event (upsert, not
    // insert) — re-upsert its original payload to restore it instead of deleting it outright, which
    // previously destroyed the still-active old block's real planned session. Only genuinely new
    // dates (no old-block day to restore) get deleted — the calendar then truly returns to its
    // pre-write state on both fronts.
    const toRestore = created.filter((r) => existingByDate.has(r.date));
    const toDelete = created.filter((r) => !existingByDate.has(r.date)).map((r) => r.eventId as number);
    const restoreResults = await Promise.allSettled(
      toRestore.map((r) => {
        const oldDay = existingByDate.get(r.date)!;
        const description = existingDescByDate.get(r.date) ?? oldDay.workoutText?.trim() ?? "";
        return createEvent(dayToEventPayload(oldDay, description));
      })
    );
    const restoreFailedIds = toRestore
      .filter((_, i) => restoreResults[i].status === "rejected")
      .map((r) => r.eventId as number);
    const { deleted, failed } = toDelete.length > 0 ? await deleteEvents(toDelete) : { deleted: [], failed: [] };
    return NextResponse.json({
      results,
      blockSaved: false,
      currentBlock: null,
      rolledBack: deleted.length + (toRestore.length - restoreFailedIds.length),
      // ids the rollback couldn't remove or restore (rare) — surfaced so the user can clear/fix them
      rollbackFailed: [...failed, ...restoreFailedIds],
    });
  }

  // Archive the old block before replacing it. `existing` was already read above (before any
  // Intervals.icu write) for the version guard — reused here rather than re-reading.
  if (existing) {
    // SUB-1: archive only the lived portion — the days the superseded block actually covered while
    // live, not the un-lived future the new block is about to overwrite.
    const livedDays = truncateBlockDays(existing.days, today);
    // HR-55: only archive when something was actually lived — mirrors DELETE's own guard
    // (app/api/sync/route.ts). Without it, a generate-then-regenerate-without-delete cycle on a
    // future-start block (nothing lived yet) archived a zero-content noise entry onto the
    // athlete-visible Plan history / Trends block timeline.
    if (livedDays.length > 0) {
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
        ...(existing.seasonFocus && isSeasonFocus(existing.seasonFocus) ? { seasonFocus: existing.seasonFocus } : {}),
        days: livedDays,
      });
    }
  }

  const dates = plan.days.map((d) => d.date).sort();
  const [athleteProfile, blockSettings] = await Promise.all([readAthleteProfile(), readBlockSettings()]);
  const ftp = athleteProfile.performance.ftp;
  const envelope = resolveDurabilityInsertEnvelope(blockSettings.durabilityInsertEnvelope);
  // MACRO: stamp the block with the season focus period active as of the block's own startDate, not
  // wall-clock "today" — a block that starts a few days out can fall in a different period than the one
  // live at generation time. Best-effort by construction — currentPeriod is a pure lookup over the plan
  // already on disk.
  // Season-architecture-redesign §4/§8: a rolling-mode plan already carries the focus chooseNextFocus
  // picked at GENERATION time (plan.seasonFocus) — use it directly rather than re-deriving via a period
  // lookup, which would consult different "as of" data at write time and could disagree. An event-
  // anchored plan (or one generated before this field existed) carries no seasonFocus, so it falls back
  // to the original period lookup by the block's own startDate.
  const seasonPeriod = plan.seasonFocus ? null : currentPeriod(await readSeasonPlan(), dates[0]);
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
    ...(plan.seasonFocus
      ? { seasonFocus: plan.seasonFocus, seasonPhase: plan.seasonFocus === "aerobic-base" ? "base" : "build" }
      : seasonPeriod
        ? { seasonFocus: seasonPeriod.focus, seasonPhase: seasonPeriod.phase }
        : {}),
    // Track B: stamp the template on the week's long Z2 ride(s) — a Z2 day at/near the block's longest Z2
    // duration — so scoring can grade that ride against the template's expected signal. Short easy Z2 days
    // (well below the long-ride duration) aren't durability rides and stay unstamped.
    days: ((): CurrentBlockDay[] => {
      const maxZ2 = Math.max(0, ...plan.days.filter((d) => d.type === "Z2").map((d) => d.durationMin));
      const isLongRide = (d: { type: string; durationMin: number }) => d.type === "Z2" && maxZ2 >= 120 && d.durationMin >= 0.8 * maxZ2;
      return plan.days.map((d) => {
        // Capture the coach's prescription structurally so execution can be compared.
        const prescription = parsePrescription(d.workoutText, ftp);
        // Measurability: freeze the comparable difficulty stamp alongside the prescription it
        // derives from, so block history carries a stable per-session identity.
        const sessionLevel = computeSessionLevel(d.type, prescription);
        const eventId = eventIdByDate.get(d.date) ?? null;
        // §8 (season-architecture-redesign): freeze the same deterministic protocol/duration checks
        // generation already ran, so a "written despite a known violation" pattern is queryable later
        // without re-running validators against whatever FTP/calibration is live at query time.
        const protocolFindings = [
          ...validateWorkoutProtocol(d, ftp, envelope),
          ...(validateDurationConsistency(d) ? [validateDurationConsistency(d) as string] : []),
        ];
        return {
          date: d.date,
          name: d.name,
          type: d.type,
          durationMin: d.durationMin,
          ...(isLongRide(d) && plan.durabilityTemplate ? { durabilityTemplate: plan.durabilityTemplate } : {}),
          ...(d.workoutText ? { workoutText: d.workoutText } : {}),
          ...(prescription.length > 0 ? { prescription } : {}),
          ...(sessionLevel ? { sessionLevel } : {}),
          ...(eventId !== null ? { eventId } : {}),
          ...(protocolFindings.length > 0 ? { protocolFindings } : {}),
        };
      });
    })(),
  };
  // HR-35: re-check createdAt INSIDE the lock, right before the actual write — the guard above ran
  // once, before the per-day event-creation loop and the archive step above, both of which can take a
  // while. A second mutation (another tab's write/delete/reschedule) landing in that window previously
  // still got silently clobbered by this stale write. On mismatch, roll back the events this request
  // just created (mirroring the partial-failure path above) instead of persisting a block onto a
  // premise that's no longer current.
  const written = await updateCurrentBlock(() => currentBlock, expectedCreatedAt);
  if (written !== currentBlock) {
    const created = results.filter((r) => r.ok && r.eventId !== null).map((r) => r.eventId as number);
    const { deleted, failed } = created.length > 0 ? await deleteEvents(created) : { deleted: [], failed: [] };
    return NextResponse.json(
      {
        error: "This plan changed in another tab while writing — reload to see the latest before continuing.",
        results,
        blockSaved: false,
        currentBlock: null,
        rolledBack: deleted.length,
        rollbackFailed: failed,
      },
      { status: 409 }
    );
  }

  // Clean the replaced block's now-orphaned events (RV-9): future planned days the new block doesn't
  // re-cover. A shared date is upserted in place (same external_id) so it's left alone; past days keep
  // their marker (the athlete may have ridden them). Best-effort — never fail the write on cleanup.
  if (existing) {
    const stale = staleEventIds(existing, currentBlock.days.map((d) => d.date), today);
    if (stale.length > 0) await deleteEvents(stale);
  }

  // Record the insights that drove this block as interventions, with a baseline snapshot,
  // to be validated after a horizon (the learning loop). Best-effort.
  try {
    const firedAt = new Date().toISOString().slice(0, 10);
    const [scoreLog, sync] = await Promise.all([readScoreLog(), readLastSync()]);
    const model = buildAthleteModel(scoreLog.entries);
    const fresh = buildInterventions(deriveInsights(model), model, sync, currentBlock.startDate, firedAt);
    if (fresh.length > 0) {
      // HR-36: read-modify-write inside one locked critical section — a concurrent sync's
      // outcome-validation pass (app/api/sync/route.ts) can no longer read the same stale base and
      // clobber this merge (or vice versa).
      await updateInterventionLog((log) => ({
        records: mergeInterventions(log.records, fresh),
        updatedAt: new Date().toISOString(),
      }));
    }
  } catch (err) {
    logWarn("/api/write", "record-interventions", err instanceof Error ? err.message : String(err));
  }

  return NextResponse.json({ results, blockSaved: true, currentBlock });
}
