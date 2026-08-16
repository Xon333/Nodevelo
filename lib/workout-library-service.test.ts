import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { readAthleteProfile, updateAthleteProfile, updateBlockHistory, updateCurrentBlock, updateDispositions, updateScoreLog } from "./data-store";
import { promoteWorkoutManually, readWorkoutLibrary, recordAcceptedLibraryUses, setWorkoutLibraryStatus, updateWorkoutLibrary } from "./workout-library-service";
import type { BlockHistoryEntry, CurrentBlock, CurrentBlockDay, RideScoreEntry } from "./types";

const FTP = 280;
const THRESHOLD_TEXT = "Warmup\n- 10m 60%\n\nMain Set 2x\n- 20m 95%\n- 8m 50%\n\nCooldown\n- 10m 50%";

function day(overrides: Partial<CurrentBlockDay> = {}): CurrentBlockDay {
  return {
    date: "2026-08-01",
    name: "Threshold",
    type: "Threshold",
    durationMin: 70,
    workoutText: THRESHOLD_TEXT,
    ...overrides,
  };
}

function block(days: CurrentBlockDay[]): CurrentBlock {
  return {
    goal: "Build FTP",
    lengthWeeks: 4,
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    overview: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    days,
  };
}

async function setFtp() {
  const profile = await readAthleteProfile();
  await updateAthleteProfile(() => ({ ...profile, performance: { ...profile.performance, ftp: FTP } }));
}

async function scoreDay(date: string, executionScore: number, overrides: Partial<RideScoreEntry> = {}) {
  await updateScoreLog((entries) => [
    ...entries,
    {
      date, executionScore, plannedType: "Threshold", inferredType: "Threshold", planned: true, legacy: false,
      compliancePct: 100, intensityFactor: 0.9, ftpUsed: FTP, durationMin: 70, tss: 60,
      ...overrides,
    },
  ]);
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
  for (const f of await fs.readdir(dir)) await fs.rm(p(f), { force: true });
});

describe("promoteWorkoutManually", () => {
  it("promotes a completed, scored day found in the live block", async () => {
    await setFtp();
    await updateCurrentBlock(() => block([day()]));
    await scoreDay("2026-08-01", 8);
    const result = await promoteWorkoutManually("2026-08-01");
    expect(result).toMatchObject({ ok: true, entry: { status: "active", promotedBy: "manual", workoutType: "Threshold" } });
    if (result.ok) expect(result.entry.evidence).toEqual([{ date: "2026-08-01", executionScore: 8 }]);
  });

  it("falls back to archived block-history days when not in the live block", async () => {
    await setFtp();
    await updateCurrentBlock(() => null);
    const historyEntry: BlockHistoryEntry = {
      id: "old-block", goal: "Build FTP", startDate: "2026-07-01", endDate: "2026-07-28",
      lengthWeeks: 4, overview: "", createdAt: "2026-07-01T00:00:00.000Z", days: [day({ date: "2026-07-15" })],
    };
    await updateBlockHistory(() => [historyEntry]);
    await scoreDay("2026-07-15", 8);
    const result = await promoteWorkoutManually("2026-07-15");
    expect(result.ok).toBe(true);
  });

  it("rejects a date with no day record anywhere", async () => {
    await setFtp();
    await updateCurrentBlock(() => null);
    await updateBlockHistory(() => []);
    const result = await promoteWorkoutManually("2026-08-01");
    expect(result).toEqual({ ok: false, reason: "day-not-found" });
  });

  it("rejects a day that hasn't been scored yet", async () => {
    await setFtp();
    await updateCurrentBlock(() => block([day()]));
    const result = await promoteWorkoutManually("2026-08-01");
    expect(result).toEqual({ ok: false, reason: "not-scored" });
  });

  it("is eligible with NO disposition entry at all — most rides never get one, and absence must not read as rejection", async () => {
    await setFtp();
    await updateCurrentBlock(() => block([day()]));
    await scoreDay("2026-08-01", 8);
    await updateDispositions(() => []); // explicit: no entries
    const result = await promoteWorkoutManually("2026-08-01");
    expect(result.ok).toBe(true);
  });

  it("rejects a ride explicitly tagged partial, even though it carries a real score", async () => {
    await setFtp();
    await updateCurrentBlock(() => block([day()]));
    await scoreDay("2026-08-01", 8);
    await updateDispositions(() => [{ date: "2026-08-01", disposition: "partial", reason: null, setAt: "" }]);
    const result = await promoteWorkoutManually("2026-08-01");
    expect(result).toEqual({ ok: false, reason: "not-completed" });
  });

  it("rejects a ride tagged missed", async () => {
    await setFtp();
    await updateCurrentBlock(() => block([day()]));
    await scoreDay("2026-08-01", 8);
    await updateDispositions(() => [{ date: "2026-08-01", disposition: "missed", reason: null, setAt: "" }]);
    expect(await promoteWorkoutManually("2026-08-01")).toEqual({ ok: false, reason: "not-completed" });
  });

  it("rejects a ride tagged compromised", async () => {
    await setFtp();
    await updateCurrentBlock(() => block([day()]));
    await scoreDay("2026-08-01", 8);
    await updateDispositions(() => [{ date: "2026-08-01", disposition: "compromised", reason: "sickness", setAt: "" }]);
    expect(await promoteWorkoutManually("2026-08-01")).toEqual({ ok: false, reason: "not-completed" });
  });

  it("accepts an explicit completed disposition", async () => {
    await setFtp();
    await updateCurrentBlock(() => block([day()]));
    await scoreDay("2026-08-01", 8);
    await updateDispositions(() => [{ date: "2026-08-01", disposition: "completed", reason: null, setAt: "" }]);
    expect((await promoteWorkoutManually("2026-08-01")).ok).toBe(true);
  });

  it("rejects an unsupported workout type (Z2)", async () => {
    await setFtp();
    await updateCurrentBlock(() => block([day({ type: "Z2", workoutText: "- 60m 65%" })]));
    await scoreDay("2026-08-01", 8);
    expect(await promoteWorkoutManually("2026-08-01")).toEqual({ ok: false, reason: "unsupported-type" });
  });

  it("rejects a protocol-invalid prescription", async () => {
    await setFtp();
    await updateCurrentBlock(() => block([day({ workoutText: "Main Set 3x\n- 10m 120%\n- 5m 50%" })]));
    await scoreDay("2026-08-01", 8);
    expect(await promoteWorkoutManually("2026-08-01")).toEqual({ ok: false, reason: "protocol-invalid" });
  });

  it("is a no-op, not a duplicate, when the day's prescription is already active", async () => {
    await setFtp();
    await updateCurrentBlock(() => block([day()]));
    await scoreDay("2026-08-01", 8);
    const first = await promoteWorkoutManually("2026-08-01");
    const second = await promoteWorkoutManually("2026-08-01");
    expect(second.ok).toBe(true);
    const store = await readWorkoutLibrary();
    expect(store.entries).toHaveLength(1);
    if (first.ok && second.ok) expect(second.entry.id).toBe(first.entry.id);
  });

  it("folds new evidence into an existing entry when the same fingerprint recurs on a later date", async () => {
    await setFtp();
    await updateCurrentBlock(() => block([day({ date: "2026-08-01" }), day({ date: "2026-08-08" })]));
    await scoreDay("2026-08-01", 8);
    await scoreDay("2026-08-08", 9);
    await promoteWorkoutManually("2026-08-01");
    const result = await promoteWorkoutManually("2026-08-08");
    expect(result.ok).toBe(true);
    const store = await readWorkoutLibrary();
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].evidence).toEqual([
      { date: "2026-08-01", executionScore: 8 },
      { date: "2026-08-08", executionScore: 9 },
    ]);
  });

  it("rejects re-promoting a retired entry's fingerprint instead of silently reactivating it", async () => {
    await setFtp();
    await updateCurrentBlock(() => block([day({ date: "2026-08-01" }), day({ date: "2026-08-08" })]));
    await scoreDay("2026-08-01", 8);
    await scoreDay("2026-08-08", 9);
    const first = await promoteWorkoutManually("2026-08-01");
    if (first.ok) await setWorkoutLibraryStatus(first.entry.id, "retired");
    const result = await promoteWorkoutManually("2026-08-08");
    expect(result).toEqual({ ok: false, reason: "retired" });
  });

  it("refuses to persist a double-corrupt workout-library.json fallback as truth (CRITICAL-set protection)", async () => {
    await fs.writeFile(p("workout-library.json"), "{ not valid json", "utf-8"); // corrupt, no .bak
    await expect(updateWorkoutLibrary((s) => s)).rejects.toThrow(/corrupt or unreadable/);
  });
});

describe("setWorkoutLibraryStatus", () => {
  it("retires then restores an entry", async () => {
    await setFtp();
    await updateCurrentBlock(() => block([day()]));
    await scoreDay("2026-08-01", 8);
    const promoted = await promoteWorkoutManually("2026-08-01");
    if (!promoted.ok) throw new Error("setup failed");
    const retired = await setWorkoutLibraryStatus(promoted.entry.id, "retired");
    expect(retired?.status).toBe("retired");
    const restored = await setWorkoutLibraryStatus(promoted.entry.id, "active");
    expect(restored?.status).toBe("active");
  });

  it("returns null for an unknown id", async () => {
    expect(await setWorkoutLibraryStatus("nonexistent", "retired")).toBeNull();
  });
});

describe("recordAcceptedLibraryUses", () => {
  it("increments useCount and appends the date to recentUses for each distinct id", async () => {
    await setFtp();
    await updateCurrentBlock(() => block([day()]));
    await scoreDay("2026-08-01", 8);
    const promoted = await promoteWorkoutManually("2026-08-01");
    if (!promoted.ok) throw new Error("setup failed");
    await recordAcceptedLibraryUses([{ id: promoted.entry.id, date: "2026-08-15" }]);
    const store = await readWorkoutLibrary();
    const entry = store.entries.find((e) => e.id === promoted.entry.id);
    expect(entry?.useCount).toBe(1);
    expect(entry?.recentUses).toEqual(["2026-08-15"]);
  });

  it("caps recentUses at 10 accepted dates", async () => {
    await setFtp();
    await updateCurrentBlock(() => block([day()]));
    await scoreDay("2026-08-01", 8);
    const promoted = await promoteWorkoutManually("2026-08-01");
    if (!promoted.ok) throw new Error("setup failed");
    for (let i = 1; i <= 12; i++) {
      await recordAcceptedLibraryUses([{ id: promoted.entry.id, date: `2026-09-${String(i).padStart(2, "0")}` }]);
    }
    const store = await readWorkoutLibrary();
    const entry = store.entries.find((e) => e.id === promoted.entry.id);
    expect(entry?.useCount).toBe(12);
    expect(entry?.recentUses).toHaveLength(10);
    expect(entry?.recentUses[9]).toBe("2026-09-12");
  });
});
