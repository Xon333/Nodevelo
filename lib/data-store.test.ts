import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { applyGoalsMigration, appendBlockHistory, DEFAULT_PROFILE, mergeCurrentBlockDays, readAthleteProfile, readBlockHistory, readBlockSettings, readCurrentBlock, readInterventionLog, readSeasonPlan, shapeMergeProfile, updateAthleteProfile, updateBlockHistory, updateBlockSettings, updateCurrentBlock, updateInterventionLog, updateSeasonPlan, writeAthleteProfile, writeCurrentBlock, writeSeasonPlan } from "./data-store";
import { DEFAULT_BLOCK_SETTINGS } from "./types";
import type { AthleteProfile, BlockHistoryEntry, CurrentBlock, InterventionRecord, SeasonPlan } from "./types";

const defaultNeat = {
  multiplier: 1.2, confidence: "low" as const, source: "default" as const,
  windowDays: null, loggedDays: null, weighIns: null, solvedAt: null, imbalance: null, stale: false,
  // Mirrors DEFAULT_PROFILE: the population prior belongs to the net burn basis (see data-store.ts).
  basis: "net" as const,
};

const baseProfile = (over: Partial<AthleteProfile> = {}): AthleteProfile => ({
  performance: { ftp: 200, maxHr: 190, thresholdHr: 170, weightKg: 75, weeklyHoursMin: 6, weeklyHoursMax: 10, dateOfBirth: null, heightCm: null, sex: null },
  goals: [],
  weakpoints: [],
  nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 75, targetRateKgPerWeek: null, neat: defaultNeat, dayTypeNeat: null },
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

  it("HR-37: a bare archive (DELETE/write-replace) landing AFTER a retrospective's rich entry for the same id does not wipe it", async () => {
    // The real sequence: a retrospective's LLM calls finish and it archives its rich entry (narrative,
    // structured reflections, compliance, seeds) for this block's id. A DELETE that read the SAME
    // block earlier (before the retro cleared it) then lands its bare archive — same id — afterward.
    await appendBlockHistory(
      entry("shared-id", {
        retrospective: "Solid block overall.",
        structuredReflections: [{ dimension: "Threshold", hypothesis: "h", observation: "o", root_cause: "r", adjusted_strategy: "a" }],
        complianceByType: { Threshold: 90 },
        actualHours: 10,
        plannedHours: 11,
        ctlGain: 5,
        nextBlockSeeds: ["Progress load"],
      })
    );
    await appendBlockHistory(entry("shared-id", { overview: "bare DELETE archive" })); // no retrospective
    const history = await readBlockHistory();
    expect(history.filter((h) => h.id === "shared-id")).toHaveLength(1);
    const survivor = history.find((h) => h.id === "shared-id")!;
    expect(survivor.retrospective).toBe("Solid block overall.");
    expect(survivor.structuredReflections).toHaveLength(1);
    expect(survivor.complianceByType).toEqual({ Threshold: 90 });
    expect(survivor.nextBlockSeeds).toEqual(["Progress load"]);
  });

  it("still replaces normally when the incoming entry ALSO carries a retrospective (both rich — last write wins)", async () => {
    await appendBlockHistory(entry("shared-id", { retrospective: "First pass." }));
    await appendBlockHistory(entry("shared-id", { retrospective: "Regenerated retro." }));
    const history = await readBlockHistory();
    expect(history.find((h) => h.id === "shared-id")?.retrospective).toBe("Regenerated retro.");
  });

  it("still replaces normally when the EXISTING entry has no retrospective yet (a bare archive, later completed by a retro)", async () => {
    await appendBlockHistory(entry("shared-id", { overview: "bare" }));
    await appendBlockHistory(entry("shared-id", { retrospective: "Now complete." }));
    const history = await readBlockHistory();
    expect(history.find((h) => h.id === "shared-id")?.retrospective).toBe("Now complete.");
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

describe("updateInterventionLog", () => {
  const record = (id: string, overrides: Partial<InterventionRecord> = {}): InterventionRecord => ({
    id,
    firedAt: "2026-06-01",
    blockStartDate: "2026-06-01",
    dimension: "Threshold",
    severity: "watch",
    title: "Threshold compliance watch",
    horizonDays: 14,
    baselineExecEwma: 0.8,
    baselinePhys: 250,
    physMetric: "5-min power",
    outcome: null,
    ...overrides,
  });

  it("defaults to an empty log when intervention-log.json doesn't exist yet", async () => {
    const out = await updateInterventionLog((log) => log);
    expect(out).toEqual({ records: [], updatedAt: new Date(0).toISOString() });
  });

  it("mutates and persists the intervention log", async () => {
    await updateInterventionLog(() => ({ records: [record("a")], updatedAt: "2026-06-01T00:00:00.000Z" }));
    const out = await updateInterventionLog((log) => ({
      records: log.records.map((r) => (r.id === "a" ? { ...r, title: "Updated" } : r)),
      updatedAt: "2026-06-02T00:00:00.000Z",
    }));
    expect(out.records.find((r) => r.id === "a")?.title).toBe("Updated");
    expect((await readInterventionLog()).records.find((r) => r.id === "a")?.title).toBe("Updated");
  });

  it("HR-36: does not lose a concurrent write's merge racing a concurrent sync's validation pass — both land instead of last-writer-wins", async () => {
    // Mirrors json-store.test.ts's concurrent-update coverage: with the old unlocked
    // read-then-write (readInterventionLog + writeInterventionLog), two concurrent callers both read
    // the same stale base and whichever wrote last silently discarded the other's change.
    await updateInterventionLog(() => ({ records: [record("existing")], updatedAt: "2026-06-01T00:00:00.000Z" }));
    await Promise.all([
      // A block write merging in a freshly-fired intervention.
      updateInterventionLog((log) => ({ records: [...log.records, record("new")], updatedAt: new Date().toISOString() })),
      // A sync's validation pass maturing the existing one.
      updateInterventionLog((log) => ({
        records: log.records.map((r) => (r.id === "existing" ? { ...r, outcome: { evaluatedAt: "2026-06-15", execNow: 0.9, physNow: 260, execDelta: 0.1, physDelta: 10, verdict: "validated" } } : r)),
        updatedAt: new Date().toISOString(),
      })),
    ]);
    const log = await readInterventionLog();
    expect(log.records.find((r) => r.id === "new")).toBeTruthy();
    expect(log.records.find((r) => r.id === "existing")?.outcome?.verdict).toBe("validated");
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

describe("shapeMergeProfile", () => {
  // The net-of-resting migration hinges on this: a pre-migration `neat` (fit against GROSS burn, no
  // `basis` key) must come back with `basis` STILL undefined, so resolveNutritionModel keeps netting
  // off and the record stays paired with the burn basis it was actually solved against. If the
  // `nutrition` merge ever became a deep merge, DEFAULT_PROFILE's `basis: "net"` would be injected into
  // that record and silently under-feed by the netted amount (~130 kcal on a 2 h ride).
  it("does NOT inject a default calibration basis into an existing pre-migration neat record", () => {
    const preMigration = {
      performance: { ftp: 250, maxHr: 195, thresholdHr: 175, weightKg: 70, weeklyHoursMin: 5, weeklyHoursMax: 9 },
      nutrition: {
        ...baseProfile().nutrition,
        neat: { multiplier: 1.2749, confidence: "high", source: "derived", windowDays: 42, loggedDays: 39, weighIns: 20, solvedAt: null, imbalance: null, stale: false },
      },
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    const merged = shapeMergeProfile(preMigration);
    expect(merged.nutrition.neat.basis).toBeUndefined();
    expect(merged.nutrition.neat.multiplier).toBe(1.2749);
  });

  it("supplies the net basis for a profile that has no neat record at all", () => {
    const merged = shapeMergeProfile({ performance: { ftp: 250 }, updatedAt: "2026-08-01T00:00:00.000Z" });
    expect(merged.nutrition.neat.basis).toBe("net");
  });

  it("HR-43: fills in missing fields from an old-format profile (predating goals/weakpoints/nutrition) instead of leaving them undefined", () => {
    const oldFormat = { performance: { ftp: 250, maxHr: 195, thresholdHr: 175, weightKg: 70, weeklyHoursMin: 5, weeklyHoursMax: 9 }, updatedAt: "2025-01-01T00:00:00.000Z" };
    const merged = shapeMergeProfile(oldFormat);
    expect(merged.goals).toEqual([]);
    expect(merged.weakpoints).toEqual([]);
    expect(merged.nutrition).toEqual(baseProfile().nutrition);
    expect(merged.goalsMigratedAt).toBeNull(); // still gates the migration to run
    expect(merged.performance.ftp).toBe(250); // real data preserved, not clobbered by defaults
  });

  it("preserves already-present fields untouched", () => {
    const current = baseProfile({ goals: [{ goal: "FTP", target: "300W", focus: "general" }], goalsMigratedAt: "2026-01-01T00:00:00.000Z" });
    const merged = shapeMergeProfile(current);
    expect(merged).toEqual(current);
  });

  it("handles a totally empty/malformed object without crashing", () => {
    expect(() => shapeMergeProfile({})).not.toThrow();
    expect(() => shapeMergeProfile(null)).not.toThrow();
    const merged = shapeMergeProfile({});
    expect(merged.performance).toEqual(baseProfile().performance);
  });

  it("HR-49: never returns DEFAULT_PROFILE's own performance/nutrition/goals/weakpoints references — every field is a fresh object/array, even when merging the fallback itself", () => {
    const merged = shapeMergeProfile(DEFAULT_PROFILE);
    expect(merged.performance).not.toBe(DEFAULT_PROFILE.performance);
    expect(merged.nutrition).not.toBe(DEFAULT_PROFILE.nutrition);
    expect(merged.goals).not.toBe(DEFAULT_PROFILE.goals);
    expect(merged.weakpoints).not.toBe(DEFAULT_PROFILE.weakpoints);
    // Mutating the result must never reach the shared module-level default.
    merged.performance.ftp = 999;
    expect(DEFAULT_PROFILE.performance.ftp).toBe(200);
  });
});

describe("readAthleteProfile", () => {
  it("HR-43: reads an old-format athlete.json (predating goals/weakpoints) without crashing, and self-heals the migration", async () => {
    await fs.writeFile(
      p("athlete.json"),
      JSON.stringify({ performance: { ftp: 260, maxHr: 192, thresholdHr: 172, weightKg: 72, weeklyHoursMin: 6, weeklyHoursMax: 10 }, updatedAt: "2025-01-01T00:00:00.000Z" }),
      "utf-8"
    );
    const profile = await readAthleteProfile();
    expect(profile.performance.ftp).toBe(260); // real data survives the shape-merge
    expect(profile.goalsMigratedAt).not.toBeNull(); // migration ran instead of crashing on profile.goals.length
    const onDisk = JSON.parse(await fs.readFile(p("athlete.json"), "utf-8"));
    expect(onDisk.goalsMigratedAt).not.toBeNull(); // self-healed — persisted, not just in-memory
  });

  it("HR-42: does not self-heal-write when athlete.json is corrupt with no .bak to recover from — returns a usable in-memory profile but leaves the corrupt file untouched", async () => {
    await fs.writeFile(p("athlete.json"), "{ not valid json at all", "utf-8");
    const profile = await readAthleteProfile();
    // Still usable in-memory (the migration ran against the DEFAULT_PROFILE fallback)...
    expect(profile.goalsMigratedAt).not.toBeNull();
    // ...but NOT persisted — the corrupt file on disk is untouched, not silently overwritten with
    // factory defaults (which would permanently discard whatever was actually recoverable).
    const onDisk = await fs.readFile(p("athlete.json"), "utf-8");
    expect(onDisk).toBe("{ not valid json at all");
  });

  it("still self-heals normally (persists the migration) on a legitimate first-ever read — no file is not corruption", async () => {
    const profile = await readAthleteProfile();
    expect(profile.goalsMigratedAt).not.toBeNull();
    const onDisk = JSON.parse(await fs.readFile(p("athlete.json"), "utf-8"));
    expect(onDisk.goalsMigratedAt).not.toBeNull(); // persisted this time — ENOENT isn't corruption
  });

  it("HR-49: overlaying physiology FTP data onto a fallback read never mutates the shared module-level DEFAULT_PROFILE", async () => {
    // No athlete.json at all → readAthleteProfile's internal read hits the DEFAULT_PROFILE fallback.
    await fs.writeFile(
      p("physiology.json"),
      JSON.stringify({
        current: {
          effectiveFrom: "2026-01-01",
          capturedAt: "2026-01-01T00:00:00.000Z",
          source: "intervals",
          ftp: 333,
          lthr: 180,
          maxHr: 195,
          powerZonePct: [],
          hrZones: [],
          hrZonesAreBpm: true,
          powerZoneNames: [],
          hrZoneNames: [],
        },
        history: [],
      }),
      "utf-8"
    );
    const profile = await readAthleteProfile();
    expect(profile.performance.ftp).toBe(333); // the overlay applied to THIS call's result...
    expect(DEFAULT_PROFILE.performance.ftp).toBe(200); // ...but never touched the shared module-level default
    expect(DEFAULT_PROFILE.performance.thresholdHr).toBe(170);
    expect(DEFAULT_PROFILE.performance.maxHr).toBe(190);

    // A second call (also hitting the fallback) must see the SAME untouched defaults, not whatever
    // the first call's overlay happened to leave behind — proving there's no cross-call pollution.
    await readAthleteProfile();
    expect(DEFAULT_PROFILE.performance.ftp).toBe(200);
  });
});

describe("updateAthleteProfile", () => {
  it("HR-50: mutates and persists onto athlete.json's RAW stored shape, not a live-overlaid read", async () => {
    await writeAthleteProfile(baseProfile({ nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 75, targetRateKgPerWeek: null, neat: defaultNeat, dayTypeNeat: null } }));
    const result = await updateAthleteProfile((profile) => ({
      ...profile,
      nutrition: { ...profile.nutrition, baseCalories: 2500 },
    }));
    expect(result.nutrition.baseCalories).toBe(2500);
    const onDisk = await readAthleteProfile();
    expect(onDisk.nutrition.baseCalories).toBe(2500);
  });

  it("does not lose a concurrent update — two mutates against the same file both land", async () => {
    await writeAthleteProfile(baseProfile());
    await Promise.all([
      updateAthleteProfile((profile) => ({ ...profile, nutrition: { ...profile.nutrition, baseCalories: 2400 } })),
      updateAthleteProfile((profile) => ({ ...profile, goals: [{ goal: "New goal", target: "", focus: "general" }] })),
    ]);
    const onDisk = await readAthleteProfile();
    expect(onDisk.nutrition.baseCalories).toBe(2400);
    expect(onDisk.goals).toEqual([{ goal: "New goal", target: "", focus: "general" }]);
  });

  // readAthleteProfile's goals self-heal used to be an UNLOCKED read-modify-write: the read takes no
  // lock, and the old writeAthleteProfile locked only the byte-write. A concurrent LOCKED writer
  // landing in that gap was silently discarded — and since the self-heal rewrites the whole document,
  // it discarded the WHOLE profile. Measured before the fix: a freshly derived NEAT calibration lost,
  // and a manual override lost after the UI had already shown "Saved".
  it("does not discard a concurrent locked write while self-healing the goals migration", async () => {
    // Un-migrated on disk (goalsMigratedAt falsy) so readAthleteProfile takes the self-heal path.
    await writeAthleteProfile(baseProfile({ goalsMigratedAt: null }));

    // A concurrent writer persists something irreplaceable — a derived calibration — at the same time.
    const [, healed] = await Promise.all([
      updateAthleteProfile((profile) => ({
        ...profile,
        nutrition: {
          ...profile.nutrition,
          neat: { ...profile.nutrition.neat, multiplier: 1.2584, source: "derived", confidence: "high" },
        },
      })),
      readAthleteProfile(),
    ]);

    const onDisk = await readAthleteProfile();
    // The migration still ran...
    expect(onDisk.goalsMigratedAt).toBeTruthy();
    expect(healed.goalsMigratedAt).toBeTruthy();
    // ...and the concurrent calibration survived it. Before the fix this read 1.2 / "default".
    expect(onDisk.nutrition.neat.multiplier).toBe(1.2584);
    expect(onDisk.nutrition.neat.source).toBe("derived");
  });

  it("shape-merges an old-format on-disk file before handing it to mutate, so an old file doesn't crash the caller", async () => {
    await fs.writeFile(
      p("athlete.json"),
      JSON.stringify({ performance: { ftp: 240, maxHr: 190, thresholdHr: 165, weightKg: 70, weeklyHoursMin: 6, weeklyHoursMax: 10 }, updatedAt: "2025-01-01T00:00:00.000Z" }),
      "utf-8"
    );
    const result = await updateAthleteProfile((profile) => ({ ...profile, goals: [...profile.goals, { goal: "g", target: "", focus: "general" as const }] }));
    expect(result.goals).toEqual([{ goal: "g", target: "", focus: "general" }]);
    expect(result.performance.ftp).toBe(240); // real data preserved through the shape-merge
  });
});

describe("updateBlockSettings", () => {
  it("HR-52: mutates and persists onto block-settings.json, stamping updatedAt centrally", async () => {
    await updateBlockSettings(() => ({ ...DEFAULT_BLOCK_SETTINGS, restDaysPerWeek: 1 }));
    // mutate leaves updatedAt at the DEFAULT_BLOCK_SETTINGS epoch placeholder — the wrapper must
    // overwrite it with a real, fresh timestamp regardless.
    const result = await updateBlockSettings((current) => ({ ...current, restDaysPerWeek: 2 }));
    expect(result.restDaysPerWeek).toBe(2);
    expect(result.updatedAt).not.toBe(DEFAULT_BLOCK_SETTINGS.updatedAt);
    const onDisk = await readBlockSettings();
    expect(onDisk.restDaysPerWeek).toBe(2);
  });

  it("does not lose a concurrent update — two mutates against the same file both land", async () => {
    await updateBlockSettings(() => ({ ...DEFAULT_BLOCK_SETTINGS }));
    await Promise.all([
      updateBlockSettings((current) => ({ ...current, restDaysPerWeek: 2 })),
      updateBlockSettings((current) => ({ ...current, autoSyncOnOpen: false })),
    ]);
    const onDisk = await readBlockSettings();
    expect(onDisk.restDaysPerWeek).toBe(2);
    expect(onDisk.autoSyncOnOpen).toBe(false);
  });

  it("propagates a thrown validation error without writing (lock still releases for the next caller)", async () => {
    await updateBlockSettings(() => ({ ...DEFAULT_BLOCK_SETTINGS, restDaysPerWeek: 1 }));
    await expect(
      updateBlockSettings(() => {
        throw new Error("invalid range");
      })
    ).rejects.toThrow("invalid range");
    expect((await readBlockSettings()).restDaysPerWeek).toBe(1); // unchanged
    // Chain not poisoned — a subsequent update still lands.
    await updateBlockSettings((current) => ({ ...current, restDaysPerWeek: 3 }));
    expect((await readBlockSettings()).restDaysPerWeek).toBe(3);
  });

  it("HR-54(d): heals a missing autoSyncOnOpen/polarisedApproach (old file predating the field) back to their true default, not undefined-as-falsy", async () => {
    // Simulates an old on-disk file written before these fields existed — they parse back as
    // `undefined`, not `false`. A plain truthy check anywhere downstream would silently disable them.
    const { updatedAt: _u, autoSyncOnOpen: _a, polarisedApproach: _p, ...oldFormat } = DEFAULT_BLOCK_SETTINGS;
    await fs.writeFile(p("block-settings.json"), JSON.stringify(oldFormat), "utf-8");

    const read = await readBlockSettings();
    expect(read.autoSyncOnOpen).toBe(true);
    expect(read.polarisedApproach).toBe(true);

    // updateBlockSettings' own internal read must heal it too, not just readBlockSettings — a mutate
    // that preserves "whatever current already has" must not silently carry the undefined forward.
    const updated = await updateBlockSettings((current) => ({ ...current, restDaysPerWeek: 2 }));
    expect(updated.autoSyncOnOpen).toBe(true);
    expect(updated.polarisedApproach).toBe(true);
  });
});

describe("updateSeasonPlan", () => {
  const plan = (overrides: Partial<SeasonPlan> = {}): SeasonPlan => ({
    objective: "Century in September",
    events: [],
    periods: [],
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  });

  it("HR-58: mutates and persists onto season-plan.json, stamping updatedAt centrally", async () => {
    await writeSeasonPlan(plan());
    const result = await updateSeasonPlan((current) => ({ ...current, objective: "New goal" }));
    expect(result.objective).toBe("New goal");
    expect(result.updatedAt).not.toBe(plan().updatedAt);
    expect((await readSeasonPlan()).objective).toBe("New goal");
  });

  it("HR-58: an expectedUpdatedAt mismatch no-ops — mutate is never called and disk is untouched", async () => {
    await writeSeasonPlan(plan());
    let mutateCalled = false;
    const result = await updateSeasonPlan((current) => {
      mutateCalled = true;
      return { ...current, objective: "Should never land" };
    }, "some-other-timestamp");
    expect(mutateCalled).toBe(false);
    expect(result.objective).toBe("Century in September");
    expect((await readSeasonPlan()).objective).toBe("Century in September");
  });

  it("HR-58: runs mutate normally when expectedUpdatedAt matches the live value", async () => {
    // writeSeasonPlan stamps its own fresh updatedAt on write — read back the real on-disk value
    // instead of assuming the fixture's own `plan().updatedAt` survived the write.
    await writeSeasonPlan(plan());
    const onDisk = await readSeasonPlan();
    const result = await updateSeasonPlan(
      (current) => ({ ...current, objective: "Matched" }),
      onDisk.updatedAt
    );
    expect(result.objective).toBe("Matched");
  });

  it("does not lose a concurrent update — two mutates against the same file both land", async () => {
    await writeSeasonPlan(plan());
    await Promise.all([
      updateSeasonPlan((current) => ({ ...current, objective: "From A" })),
      updateSeasonPlan((current) => ({ ...current, events: [{ name: "Fondo", date: "2026-09-01", priority: "A" }] })),
    ]);
    const onDisk = await readSeasonPlan();
    expect(onDisk.events).toEqual([{ name: "Fondo", date: "2026-09-01", priority: "A" }]);
  });
});
