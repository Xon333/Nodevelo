import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs", () => ({
  promises: {
    readdir: vi.fn(),
    readFile: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
  },
}));

import path from "path";
import { promises as fsp } from "fs";
import { buildBackupBundle, snapshotBackup } from "./backup";

const DATA_DIR = path.join(process.cwd(), "data");
const KB_DIR = path.join(process.cwd(), "knowledge-base");
const BACKUP_DIR = "/fake/backup-dir";

const readdirMock = () => fsp.readdir as ReturnType<typeof vi.fn>;
const readFileMock = () => fsp.readFile as ReturnType<typeof vi.fn>;
const writeFileMock = () => fsp.writeFile as ReturnType<typeof vi.fn>;
const unlinkMock = () => fsp.unlink as ReturnType<typeof vi.fn>;

function dirent(name: string): import("fs").Dirent {
  return { name, isDirectory: () => false, isFile: () => true } as import("fs").Dirent;
}

// Flat one-file-each tree for data/ and knowledge-base/. `opts` distinguishes collect()'s
// withFileTypes walk from snapshotBackup's plain rotation listing of the (mocked) backup dir.
function mockSourceTree() {
  readdirMock().mockImplementation(async (dir: string, opts?: unknown) => {
    if (!opts) return [];
    if (dir === DATA_DIR) return [dirent("athlete.json")];
    if (dir === KB_DIR) return [dirent("nutrition.md")];
    return [];
  });
  readFileMock().mockImplementation(async (file: string) => {
    if (file === path.join(DATA_DIR, "athlete.json")) return '{"ftp":250}';
    if (file === path.join(KB_DIR, "nutrition.md")) return "# Nutrition";
    throw new Error(`unexpected readFile ${file}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSourceTree();
  (fsp.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  writeFileMock().mockResolvedValue(undefined);
  (fsp.rename as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  unlinkMock().mockResolvedValue(undefined);
  delete process.env.NODEVELO_BACKUP_DIR;
});

describe("buildBackupBundle", () => {
  it("collects data/*.json and knowledge-base/*.md into one bundle", async () => {
    const bundle = await buildBackupBundle();
    expect(bundle.app).toBe("nodevelo");
    expect(bundle.kind).toBe("backup");
    expect(bundle.data["athlete.json"]).toBe('{"ftp":250}');
    expect(bundle.knowledgeBase["nutrition.md"]).toBe("# Nutrition");
  });
});

describe("snapshotBackup", () => {
  it("is a no-op when NODEVELO_BACKUP_DIR isn't set", async () => {
    const result = await snapshotBackup();
    expect(result).toEqual({ ok: false, reason: "not configured" });
    expect(writeFileMock()).not.toHaveBeenCalled();
  });

  it("writes a timestamped snapshot via write-then-rename when configured", async () => {
    process.env.NODEVELO_BACKUP_DIR = BACKUP_DIR;
    readdirMock().mockImplementation(async (dir: string, opts?: unknown) => {
      if (opts) return dir === DATA_DIR ? [dirent("athlete.json")] : dir === KB_DIR ? [dirent("nutrition.md")] : [];
      return dir === BACKUP_DIR ? ["nodevelo-backup-2026-01-01T00-00-00-000Z.json"] : [];
    });

    const result = await snapshotBackup();
    expect(result.ok).toBe(true);
    expect(fsp.mkdir).toHaveBeenCalledWith(BACKUP_DIR, { recursive: true });
    expect(writeFileMock()).toHaveBeenCalledWith(expect.stringContaining(".tmp"), expect.any(String), "utf-8");
    expect(fsp.rename).toHaveBeenCalled();
  });

  it("rotates beyond the retention cap, deleting only the oldest", async () => {
    process.env.NODEVELO_BACKUP_DIR = BACKUP_DIR;
    const existing = Array.from(
      { length: 16 },
      (_, i) => `nodevelo-backup-2026-01-${String(i + 1).padStart(2, "0")}T00-00-00-000Z.json`
    );
    readdirMock().mockImplementation(async (dir: string, opts?: unknown) => {
      if (opts) return dir === DATA_DIR ? [dirent("athlete.json")] : dir === KB_DIR ? [dirent("nutrition.md")] : [];
      return dir === BACKUP_DIR ? existing : [];
    });

    await snapshotBackup();
    // Cap is 14; 16 in the (stubbed) listing → the 2 oldest are unlinked, newest kept.
    expect(unlinkMock()).toHaveBeenCalledTimes(2);
    expect(unlinkMock()).toHaveBeenCalledWith(path.join(BACKUP_DIR, existing[0]));
    expect(unlinkMock()).toHaveBeenCalledWith(path.join(BACKUP_DIR, existing[1]));
  });

  it("surfaces a write failure instead of throwing", async () => {
    process.env.NODEVELO_BACKUP_DIR = BACKUP_DIR;
    writeFileMock().mockRejectedValue(new Error("ENOSPC"));
    const result = await snapshotBackup();
    expect(result).toEqual({ ok: false, reason: "ENOSPC" });
  });
});
