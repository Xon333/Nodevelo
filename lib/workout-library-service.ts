// I/O layer for the proven workout library (Task 2 — manual promotion only, v1). Pure domain logic
// (fingerprinting, promotion gates, selection) lives in lib/workout-library.ts; this file is the only
// place that touches the filesystem for it.

import { readAthleteProfile, readBlockHistory, readCurrentBlock, readDispositions, readScoreLog, readWorkoutLibrary, updateWorkoutLibrary } from "./data-store";
import { canManuallyPromote, fingerprintWorkout, QUALITY_TYPES } from "./workout-library";
import type { CurrentBlockDay, QualityLibraryType, WorkoutLibraryEntry, WorkoutLibraryEvidence } from "./types";

export { readWorkoutLibrary, updateWorkoutLibrary };

export type PromotionRejectReason =
  | "day-not-found"
  | "not-scored"
  | "not-completed"
  | "unsupported-type"
  | "retired"
  | "protocol-invalid";

export type PromoteWorkoutResult = { ok: true; entry: WorkoutLibraryEntry } | { ok: false; reason: PromotionRejectReason };

// Thrown only from inside updateWorkoutLibrary's mutate callback (never escapes promoteWorkoutManually)
// so the promotion gate can be re-checked atomically INSIDE the lock (design §10, "Concurrent
// promotion/retry") while still surfacing a clean, typed rejection reason to the caller.
class PromotionRejectedError extends Error {
  constructor(readonly reason: PromotionRejectReason) {
    super(reason);
  }
}

// SUB-1's "could be live or archived" lookup shape: the live block first, then the truncated per-day
// history BlockHistoryEntry.days carries. Days without a preserved prescription (older archives) are
// simply not found, not reconstructed.
async function findDay(date: string): Promise<CurrentBlockDay | null> {
  const currentBlock = await readCurrentBlock();
  const liveDay = currentBlock?.days.find((d) => d.date === date);
  if (liveDay) return liveDay;
  const history = await readBlockHistory();
  for (const entry of history) {
    const historyDay = entry.days?.find((d) => d.date === date);
    if (historyDay) return historyDay;
  }
  return null;
}

export async function promoteWorkoutManually(date: string): Promise<PromoteWorkoutResult> {
  const day = await findDay(date);
  if (!day) return { ok: false, reason: "day-not-found" };

  const workoutType = day.type as QualityLibraryType;
  if (!QUALITY_TYPES.has(workoutType)) return { ok: false, reason: "unsupported-type" };

  const [scoreLog, dispositions, profile] = await Promise.all([readScoreLog(), readDispositions(), readAthleteProfile()]);

  const scoreEntry = scoreLog.entries.find((e) => e.date === date);
  if (!scoreEntry) return { ok: false, reason: "not-scored" };

  // Disposition tagging is athlete-optional (most rides never get one) — reject only on an EXPLICIT
  // "partial" | "missed" | "compromised" entry; no entry, or an explicit "completed" one, both qualify.
  const disposition = dispositions.entries.find((e) => e.date === date)?.disposition;
  if (disposition === "partial" || disposition === "missed" || disposition === "compromised") {
    return { ok: false, reason: "not-completed" };
  }

  const ftp = profile.performance.ftp;
  const workoutText = day.workoutText ?? "";
  const durationMin = day.durationMin;
  const id = fingerprintWorkout(workoutText);
  const evidence: WorkoutLibraryEvidence = { date, executionScore: scoreEntry.executionScore };

  try {
    const store = await updateWorkoutLibrary((current) => {
      const existing = current.entries.find((e) => e.id === id);

      if (existing) {
        // Retirement never auto-restores (design §5) — re-promoting the same prescription is an
        // explicit-restore-only situation, not a silent reactivation.
        if (existing.status === "retired") throw new PromotionRejectedError("retired");
        // Already active (v1 never creates "candidate" entries, so this is the only other state):
        // fold in new evidence — a true no-op if this exact date was already recorded.
        if (existing.evidence.some((e) => e.date === evidence.date)) return current;
        return {
          ...current,
          entries: current.entries.map((e) => (e.id === id ? { ...e, evidence: [...e.evidence, evidence] } : e)),
        };
      }

      const candidate: WorkoutLibraryEntry = {
        id, workoutType, durationMin, workoutText,
        status: "candidate", evidence: [], useCount: 0, recentUses: [],
        createdAt: new Date().toISOString(),
      };
      if (!canManuallyPromote(candidate, true, ftp)) throw new PromotionRejectedError("protocol-invalid");

      const newEntry: WorkoutLibraryEntry = {
        ...candidate,
        status: "active",
        promotedBy: "manual",
        evidence: [evidence],
        promotedAt: new Date().toISOString(),
        intervalsExport: { status: "pending" },
      };
      return { ...current, entries: [...current.entries, newEntry] };
    });

    return { ok: true, entry: store.entries.find((e) => e.id === id)! };
  } catch (err) {
    if (err instanceof PromotionRejectedError) return { ok: false, reason: err.reason };
    throw err;
  }
}

export async function setWorkoutLibraryStatus(id: string, status: "active" | "retired"): Promise<WorkoutLibraryEntry | null> {
  const store = await updateWorkoutLibrary((current) => ({
    ...current,
    entries: current.entries.map((e) => (e.id === id ? { ...e, status } : e)),
  }));
  return store.entries.find((e) => e.id === id) ?? null;
}

// Best-effort accounting only, called after a block write commits (Task 8) — never rolls back an
// already-accepted block. Handles the same id appearing more than once (a block that legitimately
// reused one entry twice) by counting every occurrence, not just the first.
export async function recordAcceptedLibraryUses(uses: Array<{ id: string; date: string }>): Promise<void> {
  if (uses.length === 0) return;
  await updateWorkoutLibrary((current) => ({
    ...current,
    entries: current.entries.map((e) => {
      const dates = uses.filter((u) => u.id === e.id).map((u) => u.date);
      if (dates.length === 0) return e;
      return { ...e, useCount: e.useCount + dates.length, recentUses: [...e.recentUses, ...dates].slice(-10) };
    }),
  }));
}
