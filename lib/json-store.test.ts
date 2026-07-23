import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { readJsonFile, updateJsonFile, writeJsonFile } from "./json-store";

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

describe("json-store (atomic + recovery)", () => {
  it("round-trips and leaves no temp file behind", async () => {
    await writeJsonFile("rt.json", { entries: ["v1"], updatedAt: "a" });
    expect(await readJsonFile("rt.json", null)).toEqual({ entries: ["v1"], updatedAt: "a" });
    await expect(fs.access(p("rt.json.tmp"))).rejects.toBeDefined();
  });

  it("recovers from a corrupt live file via the .bak", async () => {
    await writeJsonFile("rec.json", { v: "good" });
    await fs.copyFile(p("rec.json"), p("rec.json.bak")); // a prior good backup exists
    await fs.writeFile(p("rec.json"), "{ this is not valid json", "utf-8"); // live file goes corrupt
    expect(await readJsonFile("rec.json", { v: "DEFAULT" })).toEqual({ v: "good" });
  });

  it("falls back to the default when both live and backup are unusable", async () => {
    await fs.writeFile(p("broken.json"), "{ broken", "utf-8");
    expect(await readJsonFile("broken.json", { v: "DEFAULT" })).toEqual({ v: "DEFAULT" });
  });

  it("returns a legitimately-null live value instead of resurrecting a stale .bak", async () => {
    // Mirrors current-block.json's real delete flow: a block existed (so a .bak snapshot exists
    // from that write), then it's deleted by writing a literal `null` — a real, intentional value,
    // not a corrupt/missing file. Reading it back must see the delete, not the pre-delete block.
    await writeJsonFile("current-block.json", { id: "the-block" });
    await writeJsonFile("current-block.json", null); // the delete — snapshots {id:"the-block"} to .bak first
    expect(await readJsonFile("current-block.json", "SHOULD_NOT_SEE_DEFAULT")).toBeNull();
  });

  it("snapshots a .bak before overwriting a CRITICAL store", async () => {
    await writeJsonFile("score-log.json", { v: 1 }); // first write — no prior to back up
    await writeJsonFile("score-log.json", { v: 2 }); // backs up {v:1}
    expect(JSON.parse(await fs.readFile(p("score-log.json.bak"), "utf-8"))).toEqual({ v: 1 });
  });

  it("HR-41: skips .bak rotation (preserves the existing backup) when the live file is already corrupt, instead of overwriting it with corrupt bytes", async () => {
    await writeJsonFile("score-log.json", { v: "good" }); // a real .bak snapshot exists after this
    await writeJsonFile("score-log.json", { v: "good2" }); // .bak now holds {v:"good"}
    await fs.writeFile(p("score-log.json"), "{ not valid json", "utf-8"); // live file goes corrupt
    await writeJsonFile("score-log.json", { v: "new" }); // must not blindly rotate the corrupt live file into .bak
    expect(JSON.parse(await fs.readFile(p("score-log.json.bak"), "utf-8"))).toEqual({ v: "good" });
    expect(await readJsonFile("score-log.json", null)).toEqual({ v: "new" }); // the new write still lands
  });

  it("HR-41: rethrows a genuine .bak copy failure instead of silently swallowing it", async () => {
    await writeJsonFile("score-log.json", { v: "good" }); // a live file now exists to snapshot
    // Make the .bak PATH itself a directory, so writing to it fails with something other than ENOENT
    // (simulates a real disk-level failure, e.g. EACCES/ENOSPC, rather than "no prior file yet").
    await fs.mkdir(p("score-log.json.bak"));
    try {
      await expect(writeJsonFile("score-log.json", { v: "new" })).rejects.toThrow();
    } finally {
      // afterEach's cleanup uses a plain (non-recursive) rm — remove the directory ourselves so it
      // doesn't break subsequent tests.
      await fs.rm(p("score-log.json.bak"), { recursive: true, force: true });
    }
  });
});

describe("json-store concurrent writes (the per-file mutex)", () => {
  it("serializes concurrent writes to the same file without corruption (last-write-wins)", async () => {
    await Promise.all(Array.from({ length: 25 }, (_, n) => writeJsonFile("race.json", { n })));
    // Must be valid JSON (no interleaved/truncated write) and hold the last queued value.
    const raw = await fs.readFile(p("race.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(await readJsonFile<{ n: number }>("race.json", { n: -1 })).toEqual({ n: 24 });
  });

  it("does not block writes to different files", async () => {
    await Promise.all([writeJsonFile("a.json", { id: "A" }), writeJsonFile("b.json", { id: "B" })]);
    expect(await readJsonFile("a.json", null)).toEqual({ id: "A" });
    expect(await readJsonFile("b.json", null)).toEqual({ id: "B" });
  });

  it("a failed write does not poison the chain for the next write", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular; // throws inside JSON.stringify
    await expect(writeJsonFile("chain.json", circular)).rejects.toThrow();
    await writeJsonFile("chain.json", { ok: true });
    expect(await readJsonFile("chain.json", null)).toEqual({ ok: true });
  });
});

describe("json-store transactional update (read-modify-write under the lock)", () => {
  it("does not lose updates when concurrent read-modify-writes interleave", async () => {
    // Each updater appends its own id. With a plain read→write this races and loses entries;
    // updateJsonFile reads INSIDE the lock so every append survives (the CR-A guarantee).
    await writeJsonFile("ledger.json", { ids: [] as number[] });
    await Promise.all(
      Array.from({ length: 30 }, (_, n) =>
        updateJsonFile<{ ids: number[] }>("ledger.json", { ids: [] }, (cur) => ({ ids: [...cur.ids, n] }))
      )
    );
    const final = await readJsonFile<{ ids: number[] }>("ledger.json", { ids: [] });
    expect(final.ids).toHaveLength(30);
    expect([...final.ids].sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, n) => n));
  });

  it("a plain writeJsonFile and an updateJsonFile to the same file do not interleave", async () => {
    await writeJsonFile("mixed.json", { ids: [1] });
    await Promise.all([
      updateJsonFile<{ ids: number[] }>("mixed.json", { ids: [] }, (cur) => ({ ids: [...cur.ids, 2] })),
      writeJsonFile("mixed.json", { ids: [99] }),
      updateJsonFile<{ ids: number[] }>("mixed.json", { ids: [] }, (cur) => ({ ids: [...cur.ids, 3] })),
    ]);
    // Whatever the final value, it must be one coherent state — never a torn/partial object.
    const raw = await fs.readFile(p("mixed.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(Array.isArray(JSON.parse(raw).ids)).toBe(true);
  });

  it("returns the written value and uses the fallback when the file is absent", async () => {
    const next = await updateJsonFile<{ n: number }>("fresh.json", { n: 0 }, (cur) => ({ n: cur.n + 5 }));
    expect(next).toEqual({ n: 5 });
    expect(await readJsonFile("fresh.json", null)).toEqual({ n: 5 });
  });

  it("a throwing mutator rejects without writing and frees the lock for the next caller", async () => {
    await writeJsonFile("guard.json", { v: "intact" });
    await expect(
      updateJsonFile("guard.json", { v: "intact" }, () => {
        throw new Error("mutator blew up");
      })
    ).rejects.toThrow("mutator blew up");
    expect(await readJsonFile("guard.json", null)).toEqual({ v: "intact" }); // unchanged
    await updateJsonFile<{ v: string }>("guard.json", { v: "intact" }, () => ({ v: "next" }));
    expect(await readJsonFile("guard.json", null)).toEqual({ v: "next" }); // chain not poisoned
  });

  it("HR-42: refuses to write when a CRITICAL store's fallback is born from genuine corruption (both live and .bak unreadable)", async () => {
    await fs.writeFile(p("score-log.json"), "{ not valid json", "utf-8"); // corrupt, and no .bak exists
    await expect(
      updateJsonFile<{ entries: unknown[] }>("score-log.json", { entries: [] }, (cur) => ({ entries: [...cur.entries, "new"] }))
    ).rejects.toThrow(/corrupt or unreadable/);
    // Refused before ever calling atomicWrite — the corrupt file is untouched, not overwritten with an
    // empty-ledger fallback that a later read would then treat as real.
    expect(await fs.readFile(p("score-log.json"), "utf-8")).toBe("{ not valid json");
  });

  it("HR-42: still writes normally for a CRITICAL store's legitimate first-ever fallback (file simply doesn't exist yet)", async () => {
    const next = await updateJsonFile<{ entries: unknown[] }>("score-log.json", { entries: [] }, (cur) => ({
      entries: [...cur.entries, "first"],
    }));
    expect(next).toEqual({ entries: ["first"] });
  });

  it("HR-42: does not refuse for a non-CRITICAL store even when its fallback is corrupt (no backup guarantee to protect)", async () => {
    await fs.writeFile(p("not-critical.json"), "{ not valid json", "utf-8");
    const next = await updateJsonFile<{ n: number }>("not-critical.json", { n: 0 }, (cur) => ({ n: cur.n + 1 }));
    expect(next).toEqual({ n: 1 });
  });
});
