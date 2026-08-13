import { randomUUID } from "node:crypto";
import { isAnthropicConfigured, parseRideIntent } from "./anthropic-api";
import {
  readIntentOverlays,
  readLastSync,
  readScoreLog,
  updateIntentOverlays,
  updateIntentOverlayStore,
} from "./data-store";
import { fetchIntervals } from "./intervals-api";
import { buildIntentQueue, INTENT_MAX_PER_RUN, normalizeNote, primaryRideOfDate } from "./intent-queue";
import { buildOverlay, scoreIntentExecution, type RideEvidence } from "./intent-scoring";
import type { IntentOverlay, RideScoreEntry } from "./types";

export interface RunIntentOptions {
  force?: boolean;
  limit?: number;
  skip?: string[];
}

export interface RunIntentResult {
  processed: number;
  remaining: number;
  stalled: boolean;
  failedIds: string[];
}

function supersedeAndAppend(existing: IntentOverlay[], next: IntentOverlay, entry: RideScoreEntry): IntentOverlay[] {
  const byDate = !entry.activityId;
  return [
    ...existing.map((overlay) =>
      overlay.supersededBy === null &&
      (overlay.activityId === next.activityId || (byDate && overlay.date === next.date))
        ? { ...overlay, supersededBy: next.id }
        : overlay
    ),
    next,
  ];
}

export async function runIntentParsing(
  today: string,
  warnings: string[],
  opts: RunIntentOptions = {}
): Promise<RunIntentResult> {
  const [lastSync, scoreLog, initialStore] = await Promise.all([
    readLastSync(),
    readScoreLog(),
    readIntentOverlays(),
  ]);

  const intentStore = initialStore.autoFromDate
    ? initialStore
    : await updateIntentOverlayStore((current) =>
        current.autoFromDate ? current : { ...current, autoFromDate: today }
      );
  const activities = lastSync?.activities ?? [];
  const forceId = opts.force ? primaryRideOfDate(activities, today)?.id : undefined;
  const eligible = buildIntentQueue(activities, scoreLog.entries, intentStore.overlays, today, intentStore.autoFromDate, {
    force: forceId ? [forceId] : [],
    warnings,
  });
  const skipped = new Set(opts.skip ?? []);
  const queue = eligible.filter((item) => !skipped.has(item.activityId)).slice(0, Math.max(0, opts.limit ?? INTENT_MAX_PER_RUN));
  const failedIds: string[] = [];
  let processed = 0;
  let warnedUnconfigured = false;

  for (const item of queue) {
    const entry = scoreLog.entries.find((candidate) => candidate.date === item.date && !candidate.planned);
    const activity = activities.find((candidate) => candidate.id === item.activityId);
    if (!entry || !activity) continue;

    let next: IntentOverlay;
    if (!normalizeNote(item.note)) {
      next = buildOverlay({
        id: randomUUID(),
        activityId: item.activityId,
        date: item.date,
        noteFingerprint: item.fingerprint,
        createdAt: new Date().toISOString(),
        reason: "no-intent-found",
      });
    } else {
      if (!isAnthropicConfigured()) {
        if (!warnedUnconfigured) warnings.push("Intent parsing skipped: Anthropic API is not configured.");
        warnedUnconfigured = true;
        continue;
      }

      const laps = await fetchIntervals(item.activityId).catch(() => []);
      let interpretation;
      try {
        interpretation = await parseRideIntent(item.note, item.durationMin);
      } catch (error) {
        warnings.push(`Intent parsing failed for ${item.activityId}: ${error instanceof Error ? error.message : String(error)}`);
        failedIds.push(item.activityId);
        continue;
      }

      if (!interpretation) {
        next = buildOverlay({
          id: randomUUID(),
          activityId: item.activityId,
          date: item.date,
          noteFingerprint: item.fingerprint,
          createdAt: new Date().toISOString(),
          reason: "interpreter-failed",
        });
      } else {
        const evidence: RideEvidence = {
          durationMin: item.durationMin,
          isIndoor: activity.type === "VirtualRide",
          powerZoneTimes: activity.powerZoneTimes,
          hrZoneTimes: activity.hrZoneTimes,
          laps,
          ftpUsed: entry.ftpUsed,
          wholeRideMaxHr: activity.maxHr,
          wholeRideAvgCadence: activity.avgCadence,
        };
        const verdict = scoreIntentExecution(interpretation, evidence, item.note);
        next = buildOverlay({
          id: randomUUID(),
          activityId: item.activityId,
          date: item.date,
          noteFingerprint: item.fingerprint,
          createdAt: new Date().toISOString(),
          interpretation,
          verdict,
        });
      }
    }

    await updateIntentOverlays((existing) => supersedeAndAppend(existing, next, entry));
    processed += 1;
  }

  const remaining = Math.max(0, eligible.length - processed);
  return { processed, remaining, stalled: processed === 0 && remaining > 0, failedIds };
}
