import { beforeEach, describe, expect, it, vi } from "vitest";

// Route test for POST /api/import (destructive-route sweep, extends SUB-3) — the highest-risk route in
// the app: it can overwrite the entire data/ + knowledge-base/ source of truth from an uploaded file.
// Both IO boundaries are mocked (writeJsonFile for data/, raw fs for knowledge-base/, since KB_DIR has
// no NODEVELO_DATA_DIR-style env override to redirect to a throwaway dir) so no test touches real disk.
// The property under test that matters most: safeResolve's path-traversal guard — a malicious `rel` in
// the bundle must never escape data/ or knowledge-base/, relative or absolute.
vi.mock("@/lib/json-store", () => ({ writeJsonFile: vi.fn() }));
vi.mock("fs", () => ({ promises: { mkdir: vi.fn(), writeFile: vi.fn() } }));

import { promises as fsp } from "fs";
import { writeJsonFile } from "@/lib/json-store";
import { POST } from "@/app/api/import/route";

const writeJsonMock = () => writeJsonFile as ReturnType<typeof vi.fn>;
const mkdirMock = () => fsp.mkdir as ReturnType<typeof vi.fn>;
const writeFileMock = () => fsp.writeFile as ReturnType<typeof vi.fn>;

const bundle = (over: Record<string, unknown> = {}) => ({
  app: "nodevelo",
  kind: "backup",
  version: 1,
  exportedAt: "2026-01-01T00:00:00Z",
  data: {},
  knowledgeBase: {},
  ...over,
});
const post = (body: unknown) => POST(new Request("http://x/api/import", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  writeJsonMock().mockResolvedValue(undefined);
  mkdirMock().mockResolvedValue(undefined);
  writeFileMock().mockResolvedValue(undefined);
});

describe("POST /api/import — envelope validation", () => {
  it("rejects an invalid JSON body", async () => {
    const res = await POST(new Request("http://x/api/import", { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
    expect(writeJsonMock()).not.toHaveBeenCalled();
  });

  it("rejects a body missing the app/kind markers", async () => {
    for (const bad of [{}, { app: "other-app", kind: "backup" }, { app: "nodevelo", kind: "not-a-backup" }]) {
      const res = await post(bad);
      expect(res.status).toBe(400);
    }
    expect(writeJsonMock()).not.toHaveBeenCalled();
  });
});

describe("POST /api/import — data/ restore", () => {
  it("restores a well-formed data file through writeJsonFile", async () => {
    const res = await post(bundle({ data: { "athlete.json": JSON.stringify({ ok: true }) } }));
    const json = await res.json();
    expect(writeJsonMock()).toHaveBeenCalledWith("athlete.json", { ok: true });
    expect(json).toEqual({ ok: true, restored: 1, skipped: [] });
  });

  it("skips a non-.json filename without calling writeJsonFile", async () => {
    const res = await post(bundle({ data: { "athlete.txt": "{}" } }));
    const json = await res.json();
    expect(writeJsonMock()).not.toHaveBeenCalled();
    expect(json.skipped).toEqual(["athlete.txt"]);
  });

  it("skips malformed JSON content without writing", async () => {
    const res = await post(bundle({ data: { "athlete.json": "{not valid json" } }));
    const json = await res.json();
    expect(writeJsonMock()).not.toHaveBeenCalled();
    expect(json.skipped).toEqual(["athlete.json"]);
  });

  it("blocks a relative path-traversal key from ever reaching writeJsonFile", async () => {
    const res = await post(bundle({ data: { "../../etc/evil.json": "{}" } }));
    const json = await res.json();
    expect(writeJsonMock()).not.toHaveBeenCalled();
    expect(json.skipped).toEqual(["../../etc/evil.json"]);
  });

  it("blocks an absolute-path key from ever reaching writeJsonFile", async () => {
    const res = await post(bundle({ data: { "/etc/evil.json": "{}" } }));
    const json = await res.json();
    expect(writeJsonMock()).not.toHaveBeenCalled();
    expect(json.skipped).toEqual(["/etc/evil.json"]);
  });
});

describe("POST /api/import — knowledge-base/ restore", () => {
  it("restores a well-formed KB file, creating nested dirs first", async () => {
    const res = await post(bundle({ knowledgeBase: { "block-retrospectives/2026-01-01.md": "# Retro" } }));
    const json = await res.json();
    expect(mkdirMock()).toHaveBeenCalled();
    expect(writeFileMock()).toHaveBeenCalledWith(
      expect.stringContaining("block-retrospectives"),
      "# Retro",
      "utf-8"
    );
    expect(json).toEqual({ ok: true, restored: 1, skipped: [] });
  });

  it("skips a non-.md filename without writing", async () => {
    const res = await post(bundle({ knowledgeBase: { "notes.txt": "hi" } }));
    const json = await res.json();
    expect(writeFileMock()).not.toHaveBeenCalled();
    expect(json.skipped).toEqual(["notes.txt"]);
  });

  it("blocks a path-traversal KB key from ever reaching fs.writeFile", async () => {
    const res = await post(bundle({ knowledgeBase: { "../../etc/evil.md": "pwned" } }));
    const json = await res.json();
    expect(writeFileMock()).not.toHaveBeenCalled();
    expect(json.skipped).toEqual(["../../etc/evil.md"]);
  });

  it("skips (not throws) when fs.writeFile rejects", async () => {
    writeFileMock().mockRejectedValueOnce(new Error("disk full"));
    const res = await post(bundle({ knowledgeBase: { "nutrition.md": "content" } }));
    const json = await res.json();
    expect(json).toEqual({ ok: true, restored: 0, skipped: ["nutrition.md"] });
  });
});

describe("POST /api/import — mixed bundle counts", () => {
  it("tallies restored vs skipped independently across data/ and knowledgeBase/", async () => {
    const res = await post(
      bundle({
        data: { "athlete.json": "{}", "../evil.json": "{}" },
        knowledgeBase: { "nutrition.md": "ok", "evil.txt": "no" },
      })
    );
    const json = await res.json();
    expect(json.restored).toBe(2);
    expect(json.skipped.sort()).toEqual(["../evil.json", "evil.txt"]);
  });
});
