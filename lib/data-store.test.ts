import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { applyGoalsMigration, appendBlockHistory, mergeCurrentBlockDays, readBlockHistory, readCurrentBlock, updateBlockHistory, updateCurrentBlock, writeCurrentBlock } from "./data-store";
import type { AthleteProfile, BlockHistoryEntry, CurrentBlock } from "./types";

const baseProfile = (over: Partial<AthleteProfile> = {}): AthleteProfile => ({
  performance: { ftp: 200, maxHr: 190, thresholdHr: 170, weightKg: 75, weeklyHoursMin: 6, weeklyHoursMax: 10 },
  goals: [],
  weakpoints: [],
  nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 75 },
  goalsMigratedAt: null,
  updatedAt: "",
  ...over,
});

describe("applyGoalsMigration", () => {
  it("seeds goals/weakpoints from markdown on first run and sets the flag", async () => {
    const parseMd = async () => ({
      goals: [{ goal: "FTP", target: "300W", focus: "general" as const }],
      weakpoints: [{ weakpoint: "Cornering", detail: "" }],
    });
    const result = await applyGoalsMigration(baseProfile(), parseMd);
    expect(result.goals).toEqual([{ goal: "FTP", target: "300W", focus: "general" }]);
    expect(result.weakpoints).toEqual([{ weakpoint: "Cornering", detail: "" }]);
    expect(result.goalsMigratedAt).not.toBeNull();
  });

  it("never re-runs once the flag is set, even if the markdown parse would return different data", async () => {
    const already = baseProfile({ goalsMigratedAt: "2026-01-01T00:00:00.000Z", goals: [{ goal: "Old", target: "", focus: "general" }] });
    const parseMd = async () => ({ goals: [{ goal: "New", target: "", focus: "general" as const }], weakpoints: [] });
    const result = await applyGoalsMigration(already, parseMd);
    expect(result).toEqual(already); // byte-identical — parseMd never called, nothing changed
  });

  it("does not overwrite existing non-empty data even if the flag is somehow still null (defensive)", async () => {
    const inconsistent = baseProfile({ goalsMigratedAt: null, goals: [{ goal: "Existing", target: "", focus: "general" }] });
    const parseMd = async () => ({ goals: [{ goal: "FromMarkdown", target: "", focus: "general" as const }], weakpoints: [] });
    const result = await applyGoalsMigration(inconsistent, parseMd);
    expect(result.goals).toEqual([{ goal: "Existing", target: "", focus: "general" }]); // existing data wins
    expect(result.goalsMigratedAt).not.toBeNull(); // flag still gets set
  });

  it("seeds empty arrays and still sets the flag when the file has no goals/weakpoints", async () => {
    const parseMd = async () => ({ goals: [], weakpoints: [] });
    const result = await applyGoalsMigration(baseProfile(), parseMd);
    expect(result.goals).toEqual([]);
    expect(result.weakpoints).toEqual([]);
    expect(result.goalsMigratedAt).not.toBeNull();
  });

  it("treats a missing goalsMigratedAt (a real on-disk profile written before this field existed) the same as null", async () => {
    // readJsonFile does a raw JSON.parse with no schema normalization, so a pre-existing athlete.json
    // predating this field yields `undefined` here, not `null` — a strict `!== null` guard would wrongly
    // treat that as "already migrated" and skip it forever.
    const legacy = baseProfile();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructuring the field away is the point (simulates a legacy on-disk profile missing the key entirely)
    const { goalsMigratedAt: _drop, ...withoutFlag } = legacy;
    const parseMd = async () => ({
      goals: [{ goal: "FTP", target: "300W", focus: "general" as const }],
      weakpoints: [{ weakpoint: "Cornering", detail: "" }],
    });
    const result = await applyGoalsMigration(withoutFlag as AthleteProfile, parseMd);
    expect(result.goals).toEqual([{ goal: "FTP", target: "300W", focus: "general" }]);
    expect(result.weakpoints).toEqual([{ weakpoint: "Cornering", detail: "" }]);
    expect(result.goalsMigratedAt).not.toBeNull();
  });
});

// Point the store at a throwaway dir so tests never touch real ledger data.
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
  // Wipe between tests so filenames can be reused without bleed-through.
  for (const f of await fs.readdir(dir)) await fs.rm(p(f), { force: true });
});

describe("updateBlockHistory", () => {
  const entry = (id: string, overrides: Partial<BlockHistoryEntry> = {}): BlockHistoryEntry => ({
    id,
    goal: "Build FTP",
    startDate: "2026-06-01",
    endDate: "2026-06-28",
    lengthWeeks: 4,
    overview: "",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  });

  it("mutates and persists the block-history array", async () => {
    await appendBlockHistory(entry("a"));
    const out = await updateBlockHistory((entries) => entries.map((e) => (e.id === "a" ? { ...e, retrospective: "done" } : e)));
    expect(out.find((e) => e.id === "a")?.retrospective).toBe("done");
    expect((await readBlockHistory()).find((e) => e.id === "a")?.retrospective).toBe("done");
  });

  it("defaults to an empty array when block-history.json doesn't exist yet", async () => {
    const out = await updateBlockHistory((entries) => entries);
    expect(out).toEqual([]);
  });
});

describe("appendBlockHistory", () => {
  const entry = (id: string, overrides: Partial<BlockHistoryEntry> = {}): BlockHistoryEntry => ({
    id,
    goal: "Build FTP",
    startDate: "2026-06-01",
    endDate: "2026-06-28",
    lengthWeeks: 4,
    overview: "",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  });

  it("dedupes by id — appending an entry whose id already exists leaves only one copy, the new one", async () => {
    await appendBlockHistory(entry("a", { overview: "first" }));
    await appendBlockHistory(entry("a", { overview: "second" }));
    const history = await readBlockHistory();
    expect(history.filter((h) => h.id === "a")).toHaveLength(1);
    expect(history.find((h) => h.id === "a")?.overview).toBe("second");
  });

  it("does not lose concurrent appends (the lost-update race a previously-unlocked read allowed)", async () => {
    // Mirrors json-store.test.ts's "does not lose updates when concurrent read-modify-writes
    // interleave": with the old unlocked-read appendBlockHistory, every concurrent call's read
    // raced ahead of the others' writes, so only the last write to acquire the lock survived and
    // every other entry was silently lost. Routing through updateBlockHistory (one locked
    // critical section per append) means every call's mutate sees the immediately-prior state.
    await Promise.all(Array.from({ length: 25 }, (_, n) => appendBlockHistory(entry(`h${n}`))));
    const history = await readBlockHistory();
    expect(history).toHaveLength(25);
    expect(new Set(history.map((h) => h.id)).size).toBe(25);
  });

  it("does not lose an append racing a concurrent updateBlockHistory mutate", async () => {
    await updateBlockHistory(() => [entry("existing")]);
    await Promise.all([
      appendBlockHistory(entry("new")),
      updateBlockHistory((entries) => entries.map((e) => (e.id === "existing" ? { ...e, retrospective: "done" } : e))),
    ]);
    const history = await readBlockHistory();
    expect(history.find((h) => h.id === "new")).toBeTruthy();
    expect(history.find((h) => h.id === "existing")?.retrospective).toBe("done");
  });
});

describe("mergeCurrentBlockDays", () => {
  const block = (overrides: Partial<CurrentBlock> = {}): CurrentBlock => ({
    goal: "Build FTP",
    lengthWeeks: 4,
    startDate: "2026-06-01",
    endDate: "2026-06-28",
    overview: "",
    createdAt: "2026-06-01T00:00:00.000Z",
    days: [
      { date: "2026-06-01", name: "Threshold", type: "Threshold", durationMin: 60 },
      { date: "2026-06-02", name: "Rest", type: "Rest", durationMin: 0 },
    ],
    ...overrides,
  });

  it("merges only the touched days onto the fresh on-disk block, leaving other days untouched", async () => {
    await writeCurrentBlock(block());
    const touched = { date: "2026-06-02", name: "Z2 (moved)", type: "Z2" as const, durationMin: 60 };
    const result = await mergeCurrentBlockDays([touched]);
    expect(result?.days.find((d) => d.date === "2026-06-02")).toEqual(touched);
    expect(result?.days.find((d) => d.date === "2026-06-01")?.name).toBe("Threshold"); // untouched
  });

  it("HR-31: does NOT resurrect a concurrently-deleted block — returns null instead of writing touched days onto nothing", async () => {
    // The real sequence: a writer (e.g. a reschedule move) reads the block, starts a slow network
    // round-trip (Intervals.icu), and during that window the athlete deletes the block — the on-disk
    // file is now null. The writer's merge must respect the delete, not resurrect a block to merge onto.
    await writeCurrentBlock(null); // simulates the concurrent delete having already landed
    const touched = { date: "2026-06-02", name: "Z2 (moved)", type: "Z2" as const, durationMin: 60 };
    const result = await mergeCurrentBlockDays([touched]);
    expect(result).toBeNull();
    expect(await readCurrentBlock()).toBeNull(); // and the disk state must stay deleted, not resurrected
  });

  it("still merges correctly in the common, non-race case", async () => {
    await writeCurrentBlock(block());
    const touched = { date: "2026-06-01", name: "Threshold (re-scheduled)", type: "Threshold" as const, durationMin: 75 };
    const result = await mergeCurrentBlockDays([touched]);
    expect(result?.days.find((d) => d.date === "2026-06-01")?.name).toBe("Threshold (re-scheduled)");
  });

  it("HR-35: no-ops when a second write replaced the block in the window between read and merge, instead of merging touched days onto the wrong generation", async () => {
    await writeCurrentBlock(block()); // this writer's own stale read of createdAt: 2026-06-01T00:00:00.000Z
    // Simulates a second mutation (e.g. a write/replace) landing first, during this writer's own
    // network round-trip — a genuinely new block, different createdAt, on the same dates.
    const replaced = block({ createdAt: "2026-06-02T00:00:00.000Z", days: [{ date: "2026-06-01", name: "Endurance", type: "Z2", durationMin: 90 }] });
    await writeCurrentBlock(replaced);
    const touched = { date: "2026-06-01", name: "Threshold (stale move)", type: "Threshold" as const, durationMin: 75 };
    const result = await mergeCurrentBlockDays([touched], "2026-06-01T00:00:00.000Z");
    expect(result).toEqual(replaced); // unchanged — the stale merge was rejected
    expect(await readCurrentBlock()).toEqual(replaced); // and disk reflects the newer block, not the stale merge
  });

  it("still merges when expectedCreatedAt matches what's actually on disk", async () => {
    await writeCurrentBlock(block());
    const touched = { date: "2026-06-01", name: "Threshold (re-scheduled)", type: "Threshold" as const, durationMin: 75 };
    const result = await mergeCurrentBlockDays([touched], "2026-06-01T00:00:00.000Z");
    expect(result?.days.find((d) => d.date === "2026-06-01")?.name).toBe("Threshold (re-scheduled)");
  });
});

describe("updateCurrentBlock", () => {
  const block = (overrides: Partial<CurrentBlock> = {}): CurrentBlock => ({
    goal: "Build FTP",
    lengthWeeks: 4,
    startDate: "2026-06-01",
    endDate: "2026-06-28",
    overview: "",
    createdAt: "2026-06-01T00:00:00.000Z",
    days: [{ date: "2026-06-01", name: "Threshold", type: "Threshold", durationMin: 60 }],
    ...overrides,
  });

  it("HR-35: an expectedCreatedAt mismatch no-ops — mutate is never called and disk is untouched", async () => {
    await writeCurrentBlock(block());
    let mutateCalled = false;
    const result = await updateCurrentBlock((cur) => {
      mutateCalled = true;
      return cur;
    }, "some-other-createdAt");
    expect(mutateCalled).toBe(false);
    expect(result).toEqual(block());
    expect(await readCurrentBlock()).toEqual(block());
  });

  it("runs mutate normally when expectedCreatedAt matches", async () => {
    await writeCurrentBlock(block());
    const result = await updateCurrentBlock(() => null, "2026-06-01T00:00:00.000Z");
    expect(result).toBeNull();
    expect(await readCurrentBlock()).toBeNull();
  });

  it("skips the version check entirely when expectedCreatedAt is undefined (caller sent no version)", async () => {
    await writeCurrentBlock(block());
    const result = await updateCurrentBlock(() => null);
    expect(result).toBeNull();
  });
});
