import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { updateWorkoutLibrary } from "./data-store";
import { exportWorkoutLibraryEntry } from "./workout-library-export";
import type { WorkoutLibraryEntry } from "./types";

vi.mock("./intervals-api", () => ({
  findOrCreateWorkoutFolder: vi.fn(),
  findRemoteLibraryWorkout: vi.fn(),
  createLibraryWorkout: vi.fn(),
}));
import { createLibraryWorkout, findOrCreateWorkoutFolder, findRemoteLibraryWorkout } from "./intervals-api";

const mockFindOrCreateFolder = vi.mocked(findOrCreateWorkoutFolder);
const mockFindRemoteWorkout = vi.mocked(findRemoteLibraryWorkout);
const mockCreateWorkout = vi.mocked(createLibraryWorkout);

function baseEntry(overrides: Partial<WorkoutLibraryEntry> = {}): WorkoutLibraryEntry {
  return {
    id: "abcd1234efgh5678", workoutType: "Threshold", durationMin: 70,
    workoutText: "Warmup\n- 10m 60%\n\nMain Set 2x\n- 20m 95%\n- 8m 50%",
    status: "active", promotedBy: "manual", evidence: [{ date: "2026-08-01", executionScore: 8 }],
    useCount: 0, recentUses: [], createdAt: "2026-08-01T00:00:00.000Z", promotedAt: "2026-08-01T00:00:00.000Z",
    intervalsExport: { status: "pending" },
    ...overrides,
  };
}

async function seed(entry: WorkoutLibraryEntry) {
  await updateWorkoutLibrary((store) => ({ ...store, entries: [entry] }));
}

// Point the store at a throwaway dir so tests never touch real data.
let dir: string;
const p = (file: string) => path.join(dir, file);

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "nodevelo-store-"));
  process.env.NODEVELO_DATA_DIR = dir;
});

afterAll(async () => {
  delete process.env.NODEVELO_DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
  vi.clearAllMocks();
  for (const f of await fs.readdir(dir)) await fs.rm(p(f), { force: true });
});

describe("exportWorkoutLibraryEntry", () => {
  it("creates the workout when no remote match exists and persists synced + workoutId", async () => {
    await seed(baseEntry());
    mockFindOrCreateFolder.mockResolvedValue(10);
    mockFindRemoteWorkout.mockResolvedValue(null);
    mockCreateWorkout.mockResolvedValue(555);

    const result = await exportWorkoutLibraryEntry("abcd1234efgh5678");

    expect(result?.intervalsExport).toEqual({ status: "synced", workoutId: "555" });
    expect(mockFindOrCreateFolder).toHaveBeenCalledWith("NodeVelo — Threshold");
    expect(mockFindRemoteWorkout).toHaveBeenCalledWith(10, "Threshold — 70 min — abcd1234");
    expect(mockCreateWorkout).toHaveBeenCalledWith({
      folderId: 10, name: "Threshold — 70 min — abcd1234",
      description: baseEntry().workoutText, type: "Ride",
    });
  });

  it("never creates again once synced with a stored remote id — no calls at all", async () => {
    await seed(baseEntry({ intervalsExport: { status: "synced", workoutId: "555" } }));
    const result = await exportWorkoutLibraryEntry("abcd1234efgh5678");
    expect(result?.intervalsExport).toEqual({ status: "synced", workoutId: "555" });
    expect(mockFindOrCreateFolder).not.toHaveBeenCalled();
    expect(mockFindRemoteWorkout).not.toHaveBeenCalled();
    expect(mockCreateWorkout).not.toHaveBeenCalled();
  });

  it("marks failed with a displayable error on export failure, without deactivating the local entry", async () => {
    await seed(baseEntry());
    mockFindOrCreateFolder.mockResolvedValue(10);
    mockFindRemoteWorkout.mockResolvedValue(null);
    mockCreateWorkout.mockRejectedValue(new Error("Intervals.icu request failed (500) for /athlete/i1/workouts"));

    const result = await exportWorkoutLibraryEntry("abcd1234efgh5678");

    expect(result?.intervalsExport).toEqual({ status: "failed", error: "Intervals.icu request failed (500) for /athlete/i1/workouts" });
    expect(result?.status).toBe("active"); // never deactivated
  });

  it("retries a failed export (not synced, so re-attempted) and finds the crash-orphaned remote workout by deterministic name instead of creating a duplicate", async () => {
    // Simulates a crash between a successful remote POST and the local persist: local state shows
    // "failed"/"pending", but the workout genuinely exists on Intervals.icu already.
    await seed(baseEntry({ intervalsExport: { status: "failed", error: "timed out" } }));
    mockFindOrCreateFolder.mockResolvedValue(10);
    mockFindRemoteWorkout.mockResolvedValue(999); // the prior orphan, found by name
    mockCreateWorkout.mockResolvedValue(-1); // must never be reached

    const result = await exportWorkoutLibraryEntry("abcd1234efgh5678");

    expect(result?.intervalsExport).toEqual({ status: "synced", workoutId: "999" });
    expect(mockCreateWorkout).not.toHaveBeenCalled();
  });

  it("single-flights two concurrent calls for the same entry into exactly one create", async () => {
    await seed(baseEntry());
    mockFindOrCreateFolder.mockResolvedValue(10);
    mockFindRemoteWorkout.mockResolvedValue(null);
    let resolveCreate!: (id: number) => void;
    mockCreateWorkout.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));

    const [first, second] = [exportWorkoutLibraryEntry("abcd1234efgh5678"), exportWorkoutLibraryEntry("abcd1234efgh5678")];
    resolveCreate(777);
    const [a, b] = await Promise.all([first, second]);

    expect(mockCreateWorkout).toHaveBeenCalledTimes(1);
    expect(a?.intervalsExport).toEqual({ status: "synced", workoutId: "777" });
    expect(b?.intervalsExport).toEqual({ status: "synced", workoutId: "777" });
  });

  it("allows a fresh export after a prior single-flight completes (the map entry is cleared)", async () => {
    await seed(baseEntry());
    mockFindOrCreateFolder.mockResolvedValue(10);
    mockFindRemoteWorkout.mockResolvedValue(null);
    mockCreateWorkout.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await exportWorkoutLibraryEntry("abcd1234efgh5678");
    await updateWorkoutLibrary((store) => ({
      ...store,
      entries: store.entries.map((e) => ({ ...e, intervalsExport: { status: "pending" as const } })),
    }));
    await exportWorkoutLibraryEntry("abcd1234efgh5678");

    expect(mockCreateWorkout).toHaveBeenCalledTimes(2);
  });

  it("returns null for an unknown entry id without calling Intervals.icu", async () => {
    await seed(baseEntry());
    const result = await exportWorkoutLibraryEntry("nonexistent");
    expect(result).toBeNull();
    expect(mockFindOrCreateFolder).not.toHaveBeenCalled();
  });
});
