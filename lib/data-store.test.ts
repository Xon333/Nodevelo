import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { applyGoalsMigration, appendBlockHistory, readBlockHistory, updateBlockHistory } from "./data-store";
import type { AthleteProfile, BlockHistoryEntry } from "./types";

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
