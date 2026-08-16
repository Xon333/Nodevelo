// Orchestrates a single library entry's export to Intervals.icu (design §8). The wire primitives
// (folder/workout lookup and creation) live in lib/intervals-api.ts; this file owns the idempotency
// guarantees a bare "read state, POST, persist" can't provide on its own — a per-entry single-flight
// for concurrent triggers, and a remote lookup-before-create for the crash-after-POST case neither a
// local lock nor a single-flight can catch.

import { readWorkoutLibrary, updateWorkoutLibrary } from "./data-store";
import { createLibraryWorkout, findOrCreateWorkoutFolder, findRemoteLibraryWorkout } from "./intervals-api";
import type { WorkoutLibraryEntry } from "./types";

function remoteWorkoutName(entry: WorkoutLibraryEntry): string {
  return `${entry.workoutType} — ${entry.durationMin} min — ${entry.id.slice(0, 8)}`;
}

function remoteFolderName(entry: WorkoutLibraryEntry): string {
  return `NodeVelo — ${entry.workoutType}`;
}

async function persistExportState(
  id: string,
  intervalsExport: NonNullable<WorkoutLibraryEntry["intervalsExport"]>
): Promise<WorkoutLibraryEntry | null> {
  const store = await updateWorkoutLibrary((current) => ({
    ...current,
    entries: current.entries.map((e) => (e.id === id ? { ...e, intervalsExport } : e)),
  }));
  return store.entries.find((e) => e.id === id) ?? null;
}

// Per-entry-ID in-process single-flight, mirroring json-store.ts's own per-file lock pattern — two
// concurrent triggers for the SAME entry (a double-clicked retry, two open tabs) await the one real
// export instead of each racing their own remote create.
const inFlight = new Map<string, Promise<WorkoutLibraryEntry | null>>();

export async function exportWorkoutLibraryEntry(id: string): Promise<WorkoutLibraryEntry | null> {
  const existing = inFlight.get(id);
  if (existing) return existing;

  const task = runExport(id);
  inFlight.set(id, task);
  try {
    return await task;
  } finally {
    inFlight.delete(id);
  }
}

async function runExport(id: string): Promise<WorkoutLibraryEntry | null> {
  const store = await readWorkoutLibrary();
  const entry = store.entries.find((e) => e.id === id);
  if (!entry) return null;
  // Never created again: a stored remote workout id is trusted outright, no re-check.
  if (entry.intervalsExport?.status === "synced" && entry.intervalsExport.workoutId) return entry;

  const name = remoteWorkoutName(entry);
  try {
    const folderId = await findOrCreateWorkoutFolder(remoteFolderName(entry));
    // Remote lookup BEFORE create — closes the crash-after-POST case: a retry after the process died
    // between a successful create and the local persist finds its own prior orphan by deterministic
    // name instead of making a second one. (No native upsert exists on this endpoint — design §8.)
    const workoutId =
      (await findRemoteLibraryWorkout(folderId, name)) ??
      (await createLibraryWorkout({ folderId, name, description: entry.workoutText, type: "Ride" }));
    // WorkoutLibraryEntry.intervalsExport.workoutId is a string (Task 1's type); the wire id is numeric.
    return await persistExportState(id, { status: "synced", workoutId: String(workoutId) });
  } catch (err) {
    // Never deactivate on export failure — the local active entry stays usable and generation
    // continues normally regardless of export state (design §8).
    const message = err instanceof Error ? err.message : "Intervals.icu export failed.";
    return await persistExportState(id, { status: "failed", error: message });
  }
}
