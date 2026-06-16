import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { readJsonFile, writeJsonFile } from "./json-store";

// Throwaway filename so the test never touches real ledger data.
const FILE = "__jsonstore_test__.json";
const full = path.join(process.cwd(), "data", FILE);

afterEach(async () => {
  await Promise.all([
    fs.rm(full, { force: true }),
    fs.rm(`${full}.bak`, { force: true }),
    fs.rm(`${full}.tmp`, { force: true }),
  ]);
});

describe("json-store (atomic + recovery)", () => {
  it("round-trips and leaves no temp file behind", async () => {
    await writeJsonFile(FILE, { entries: ["v1"], updatedAt: "a" });
    expect(await readJsonFile(FILE, null)).toEqual({ entries: ["v1"], updatedAt: "a" });
    await expect(fs.access(`${full}.tmp`)).rejects.toBeDefined();
  });

  it("recovers from a corrupt live file via the .bak", async () => {
    await writeJsonFile(FILE, { v: "good" });
    await fs.copyFile(full, `${full}.bak`); // a prior good backup exists
    await fs.writeFile(full, "{ this is not valid json", "utf-8"); // live file goes corrupt
    expect(await readJsonFile(FILE, { v: "DEFAULT" })).toEqual({ v: "good" });
  });

  it("falls back to the default when both live and backup are unusable", async () => {
    await fs.writeFile(full, "{ broken", "utf-8");
    expect(await readJsonFile(FILE, { v: "DEFAULT" })).toEqual({ v: "DEFAULT" });
  });
});
