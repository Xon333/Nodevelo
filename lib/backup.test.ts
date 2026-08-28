import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  BackupRestoreError,
  BackupValidationError,
  buildBackupBundle,
  restoreBackupBundle,
  snapshotBackup,
  validateBackupBundle,
} from "./backup";
import { updateJsonFile, writeJsonFile } from "./json-store";
import { writeKnowledgeFile } from "./kb-loader";

type RestoreFs = {
  mkdir: typeof fs.mkdir;
  writeFile: typeof fs.writeFile;
  rename: typeof fs.rename;
  rm: typeof fs.rm;
  stat: typeof fs.stat;
};

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function mkdtemp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function seedFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf-8");
}

async function treeSnapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        out[path.relative(root, full)] = await fs.readFile(full, "utf-8");
      }
    }
  }
  try {
    await walk(root);
  } catch {
    return {};
  }
  return out;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

async function removeWorkspace(workspace: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY" || attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

async function waitForCondition(check: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

function makeRestoreFs(
  overrides: Partial<{
    failRenameAt: number[];
    pauseRenameAt: number;
    pauseGate: { promise: Promise<void> };
    failWriteAt: number[];
    failRmAt: number[];
  }> = {}
): RestoreFs & {
  renameCalls: Array<{ src: string; dest: string }>;
  writeFileCalls: Array<{ file: string; data: string }>;
  rmCalls: Array<string>;
} {
  const renameCalls: Array<{ src: string; dest: string }> = [];
  const writeFileCalls: Array<{ file: string; data: string }> = [];
  const rmCalls: Array<string> = [];
  let renameCount = 0;
  let writeCount = 0;
  let rmCount = 0;
  const failRenameAt = new Set(overrides.failRenameAt ?? []);
  const failWriteAt = new Set(overrides.failWriteAt ?? []);
  const failRmAt = new Set(overrides.failRmAt ?? []);

  return {
    renameCalls,
    writeFileCalls,
    rmCalls,
    mkdir: fs.mkdir,
    stat: fs.stat,
    rename: async (src, dest) => {
      renameCount += 1;
      renameCalls.push({ src: String(src), dest: String(dest) });
      if (overrides.pauseRenameAt === renameCount) {
        await overrides.pauseGate?.promise;
      }
      if (failRenameAt.has(renameCount)) {
        throw new Error(`rename-${renameCount}`);
      }
      return fs.rename(src, dest);
    },
    writeFile: async (file, data, ...rest) => {
      writeCount += 1;
      writeFileCalls.push({ file: String(file), data: String(data) });
      if (failWriteAt.has(writeCount)) {
        throw new Error(`write-${writeCount}`);
      }
      return fs.writeFile(file, data, ...rest);
    },
    rm: async (target, ...rest) => {
      rmCount += 1;
      rmCalls.push(String(target));
      if (failRmAt.has(rmCount)) {
        throw new Error(`rm-${rmCount}`);
      }
      return fs.rm(target, ...rest);
    },
  };
}

beforeEach(() => {
  vi.useRealTimers();
  delete process.env.NODEVELO_DATA_DIR;
  delete process.env.NODEVELO_KB_DIR;
  delete process.env.NODEVELO_BACKUP_DIR;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.NODEVELO_DATA_DIR;
  delete process.env.NODEVELO_KB_DIR;
  delete process.env.NODEVELO_BACKUP_DIR;
});

describe("validateBackupBundle", () => {
  const valid = {
    app: "nodevelo",
    kind: "backup",
    version: 1,
    exportedAt: "2026-08-28T00:00:00.000Z",
    data: {
      "athlete.json": '{"ftp":250}',
    },
    knowledgeBase: {
      "block-retrospectives/retro.md": "# ok",
    },
  };

  it("accepts a plain version-1 envelope and rejects the shaped edge cases from the plan", () => {
    expect(() =>
      validateBackupBundle({
        ...valid,
        data: { "athlete.json": '{"ftp":250}', "last-sync.json": '{"ok":true}' },
      })
    ).not.toThrow();
    expect(() => validateBackupBundle({ ...valid, version: 2 })).toThrow(BackupValidationError);
    expect(() => validateBackupBundle({ ...valid, extra: true } as Record<string, unknown>)).toThrow(
      BackupValidationError
    );
    expect(() => validateBackupBundle({ ...valid, exportedAt: "2026-08-28" })).toThrow(BackupValidationError);
    expect(() => validateBackupBundle({ ...valid, data: { "../escape.json": "{}" } })).toThrow(
      BackupValidationError
    );
    expect(() => validateBackupBundle({ ...valid, data: { "nested/store.json": "{}" } })).toThrow(
      BackupValidationError
    );
    expect(() =>
      validateBackupBundle({ ...valid, knowledgeBase: { "block-retrospectives/retro.md": "# ok" } })
    ).not.toThrow();
    expect(() => validateBackupBundle({ ...valid, data: { "athlete.json": "{bad" } })).toThrow(
      BackupValidationError
    );
    expect(() => validateBackupBundle({ ...valid, data: new Date() })).toThrow(BackupValidationError);
    expect(() =>
      validateBackupBundle(Object.assign(Object.create({ inherited: true }), valid))
    ).toThrow(BackupValidationError);
  });
});

describe("buildBackupBundle", () => {
  it("collects data/*.json and knowledge-base/**/*.md into one versioned bundle", async () => {
    const workspace = await mkdtemp("fr2-backup-build-");
    const dataDir = path.join(workspace, "data");
    const kbDir = path.join(workspace, "knowledge-base");
    process.env.NODEVELO_DATA_DIR = dataDir;
    process.env.NODEVELO_KB_DIR = kbDir;

    try {
      await seedFile(path.join(dataDir, "athlete.json"), '{"ftp":250}');
      await seedFile(path.join(dataDir, "last-sync.json"), '{"synced":true}');
      await seedFile(path.join(kbDir, "nutrition.md"), "# Nutrition");
      await seedFile(path.join(kbDir, "block-retrospectives", "2026-08-28_retro.md"), "# Retro");

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-28T12:34:56.789Z"));

      const bundle = await buildBackupBundle();
      expect(bundle.app).toBe("nodevelo");
      expect(bundle.kind).toBe("backup");
      expect(bundle.version).toBe(1);
      expect(bundle.exportedAt).toBe("2026-08-28T12:34:56.789Z");
      expect(bundle.data).toEqual({
        "athlete.json": '{"ftp":250}',
        "last-sync.json": '{"synced":true}',
      });
      expect(bundle.knowledgeBase).toEqual({
        "block-retrospectives/2026-08-28_retro.md": "# Retro",
        "nutrition.md": "# Nutrition",
      });
    } finally {
      await removeWorkspace(workspace);
    }
  });
});

describe("snapshotBackup", () => {
  it("is a no-op when NODEVELO_BACKUP_DIR isn't set", async () => {
    const workspace = await mkdtemp("fr2-backup-snapshot-noop-");
    const dataDir = path.join(workspace, "data");
    const kbDir = path.join(workspace, "knowledge-base");
    const backupDir = path.join(workspace, "backups");
    process.env.NODEVELO_DATA_DIR = dataDir;
    process.env.NODEVELO_KB_DIR = kbDir;

    try {
      await seedFile(path.join(dataDir, "athlete.json"), '{"ftp":250}');
      await seedFile(path.join(kbDir, "nutrition.md"), "# Nutrition");

      const result = await snapshotBackup();
      expect(result).toEqual({ ok: false, reason: "not configured" });
      expect(await exists(backupDir)).toBe(false);
    } finally {
      await removeWorkspace(workspace);
    }
  });

  it("writes a timestamped snapshot via write-then-rename when configured", async () => {
    const workspace = await mkdtemp("fr2-backup-snapshot-write-");
    const dataDir = path.join(workspace, "data");
    const kbDir = path.join(workspace, "knowledge-base");
    const backupDir = path.join(workspace, "backups");
    process.env.NODEVELO_DATA_DIR = dataDir;
    process.env.NODEVELO_KB_DIR = kbDir;
    process.env.NODEVELO_BACKUP_DIR = backupDir;

    try {
      await seedFile(path.join(dataDir, "athlete.json"), '{"ftp":250}');
      await seedFile(path.join(kbDir, "nutrition.md"), "# Nutrition");

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-16T00:00:00.000Z"));

      const result = await snapshotBackup();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.path).toBe(path.join(backupDir, "nodevelo-backup-2026-01-16T00-00-00-000Z.json"));
        expect(await exists(result.path)).toBe(true);
      }
    } finally {
      await removeWorkspace(workspace);
    }
  });

  it("rotates beyond the retention cap, deleting only the oldest", async () => {
    const workspace = await mkdtemp("fr2-backup-snapshot-rotate-");
    const dataDir = path.join(workspace, "data");
    const kbDir = path.join(workspace, "knowledge-base");
    const backupDir = path.join(workspace, "backups");
    process.env.NODEVELO_DATA_DIR = dataDir;
    process.env.NODEVELO_KB_DIR = kbDir;
    process.env.NODEVELO_BACKUP_DIR = backupDir;

    try {
      await seedFile(path.join(dataDir, "athlete.json"), '{"ftp":250}');
      await seedFile(path.join(kbDir, "nutrition.md"), "# Nutrition");
      await fs.mkdir(backupDir, { recursive: true });
      const existing = Array.from(
        { length: 16 },
        (_, i) => `nodevelo-backup-2026-01-${String(i + 1).padStart(2, "0")}T00-00-00-000Z.json`
      );
      await Promise.all(existing.map((file) => fs.writeFile(path.join(backupDir, file), "{}", "utf-8")));

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-16T00:00:00.000Z"));

      await snapshotBackup();
      const files = (await fs.readdir(backupDir)).filter((file) => file.startsWith("nodevelo-backup-"));
      expect(files).toHaveLength(14);
      expect(files).not.toContain(existing[0]);
      expect(files).not.toContain(existing[1]);
      expect(files).toContain("nodevelo-backup-2026-01-16T00-00-00-000Z.json");
    } finally {
      await removeWorkspace(workspace);
    }
  });

  it("surfaces a write failure instead of throwing", async () => {
    const workspace = await mkdtemp("fr2-backup-snapshot-failure-");
    const dataDir = path.join(workspace, "data");
    const kbDir = path.join(workspace, "knowledge-base");
    const backupDir = path.join(workspace, "backups");
    process.env.NODEVELO_DATA_DIR = dataDir;
    process.env.NODEVELO_KB_DIR = kbDir;
    process.env.NODEVELO_BACKUP_DIR = backupDir;

    try {
      await seedFile(path.join(dataDir, "athlete.json"), '{"ftp":250}');
      await seedFile(path.join(kbDir, "nutrition.md"), "# Nutrition");

      const original = fs.writeFile;
      const writeFile = vi.fn(async (...args: Parameters<typeof fs.writeFile>) => {
        throw new Error("ENOSPC");
      });
      vi.spyOn(fs, "writeFile").mockImplementation(writeFile as typeof fs.writeFile);

      const result = await snapshotBackup();
      expect(result).toEqual({ ok: false, reason: "ENOSPC" });
      expect(writeFile).toHaveBeenCalled();
      fs.writeFile = original;
    } finally {
      await removeWorkspace(workspace);
      vi.restoreAllMocks();
    }
  });
});

describe("restoreBackupBundle", () => {
  function restoreRoots(workspace: string) {
    return {
      dataDir: path.join(workspace, "data"),
      knowledgeBaseDir: path.join(workspace, "knowledge-base"),
    };
  }

  function useRestoreRoots(roots: { dataDir: string; knowledgeBaseDir: string }) {
    process.env.NODEVELO_DATA_DIR = roots.dataDir;
    process.env.NODEVELO_KB_DIR = roots.knowledgeBaseDir;
  }

  async function writeLiveState(roots: { dataDir: string; knowledgeBaseDir: string }) {
    await seedFile(path.join(roots.dataDir, "athlete.json"), '{"ftp":250,"goals":["keep"]}');
    await seedFile(path.join(roots.dataDir, "last-sync.json"), '{"synced":false}');
    await seedFile(path.join(roots.dataDir, "legacy.json"), '{"legacy":true}');
    await seedFile(path.join(roots.knowledgeBaseDir, "nutrition.md"), "# Old nutrition");
    await seedFile(path.join(roots.knowledgeBaseDir, "block-retrospectives", "old-retro.md"), "# Old retro");
    await seedFile(path.join(roots.knowledgeBaseDir, "obsolete.md"), "# stale");
  }

  function backupBundle() {
    return validateBackupBundle({
      app: "nodevelo",
      kind: "backup",
      version: 1,
      exportedAt: "2026-08-28T00:00:00.000Z",
      data: {
        "athlete.json": '{"ftp":260,"goals":["new"]}',
        "last-sync.json": '{"synced":true}',
        "morning-check.json": '{"ok":true}',
      },
      knowledgeBase: {
        "block-retrospectives/new-retro.md": "# New retro",
        "nutrition.md": "# New nutrition",
      },
    });
  }

  it("replaces the complete trees and restores critical .bak files", async () => {
    const workspace = await mkdtemp("fr2-backup-restore-exact-");
    const roots = restoreRoots(workspace);
    useRestoreRoots(roots);
    await writeLiveState(roots);

    try {
      const result = await restoreBackupBundle(backupBundle(), { roots, fs });
      expect(result).toEqual({ restored: 5, cleanupWarnings: [] });
      expect(await treeSnapshot(roots.dataDir)).toEqual({
        "athlete.json": '{\n  "ftp": 260,\n  "goals": [\n    "new"\n  ]\n}\n',
        "athlete.json.bak": '{\n  "ftp": 260,\n  "goals": [\n    "new"\n  ]\n}\n',
        "last-sync.json": '{\n  "synced": true\n}\n',
        "morning-check.json": '{\n  "ok": true\n}\n',
        "morning-check.json.bak": '{\n  "ok": true\n}\n',
      });
      expect(await treeSnapshot(roots.knowledgeBaseDir)).toEqual({
        "block-retrospectives/new-retro.md": "# New retro",
        "nutrition.md": "# New nutrition",
      });
      expect(await exists(path.join(roots.dataDir, "legacy.json"))).toBe(false);
      expect(await exists(path.join(roots.knowledgeBaseDir, "obsolete.md"))).toBe(false);
      expect(await exists(path.join(roots.dataDir, "last-sync.json.bak"))).toBe(false);
      expect(await exists(path.join(roots.knowledgeBaseDir, "block-retrospectives", "old-retro.md"))).toBe(false);
      expect(await fs.readdir(workspace)).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/\.stage-/),
          expect.stringMatching(/\.previous-/),
        ])
      );
    } finally {
      await removeWorkspace(workspace);
    }
  });

  it("creates both roots when they are initially absent", async () => {
    const workspace = await mkdtemp("fr2-backup-restore-empty-");
    const roots = restoreRoots(workspace);
    useRestoreRoots(roots);

    try {
      const result = await restoreBackupBundle(backupBundle(), { roots, fs });
      expect(result.restored).toBe(5);
      expect(await exists(roots.dataDir)).toBe(true);
      expect(await exists(roots.knowledgeBaseDir)).toBe(true);
      expect(await exists(path.join(roots.dataDir, "athlete.json"))).toBe(true);
      expect(await exists(path.join(roots.knowledgeBaseDir, "block-retrospectives", "new-retro.md"))).toBe(true);
    } finally {
      await removeWorkspace(workspace);
    }
  });

  it("leaves originals byte-identical when staging fails", async () => {
    const workspace = await mkdtemp("fr2-backup-restore-stage-fail-");
    const roots = restoreRoots(workspace);
    useRestoreRoots(roots);
    await writeLiveState(roots);
    const beforeData = await treeSnapshot(roots.dataDir);
    const beforeKb = await treeSnapshot(roots.knowledgeBaseDir);
    const io = makeRestoreFs({ failWriteAt: [1] });

    try {
      await expect(restoreBackupBundle(backupBundle(), { roots, fs: io })).rejects.toMatchObject({
        recoveryConfirmed: true,
        message: "Restore staging failed. Your current data was not changed.",
      });
      expect(await treeSnapshot(roots.dataDir)).toEqual(beforeData);
      expect(await treeSnapshot(roots.knowledgeBaseDir)).toEqual(beforeKb);
    } finally {
      await removeWorkspace(workspace);
    }
  });

  it.each([1, 2, 3, 4])("rolls back cleanly when commit rename %s fails", async (failurePoint) => {
    const workspace = await mkdtemp(`fr2-backup-restore-rollback-${failurePoint}-`);
    const roots = restoreRoots(workspace);
    useRestoreRoots(roots);
    await writeLiveState(roots);
    const beforeData = await treeSnapshot(roots.dataDir);
    const beforeKb = await treeSnapshot(roots.knowledgeBaseDir);
    const io = makeRestoreFs({ failRenameAt: [failurePoint] });

    try {
      await expect(restoreBackupBundle(backupBundle(), { roots, fs: io })).rejects.toMatchObject({
        recoveryConfirmed: true,
        message: "Restore failed. Your previous data was put back.",
      });
      expect(io.rmCalls.some((target) => target.includes(".stage-"))).toBe(true);
      expect(io.rmCalls.some((target) => target.includes(".previous-"))).toBe(true);
      expect(await treeSnapshot(roots.dataDir)).toEqual(beforeData);
      expect(await treeSnapshot(roots.knowledgeBaseDir)).toEqual(beforeKb);
      expect(await fs.readdir(workspace)).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/\.stage-/),
          expect.stringMatching(/\.previous-/),
        ])
      );
    } finally {
      await removeWorkspace(workspace);
    }
  });

  it("tries every recorded rollback rename before reporting unconfirmed recovery", async () => {
    const workspace = await mkdtemp("fr2-backup-restore-rollback-aggregate-");
    const roots = restoreRoots(workspace);
    useRestoreRoots(roots);
    await writeLiveState(roots);
    const io = makeRestoreFs({ failRenameAt: [4, 5] });

    try {
      await expect(restoreBackupBundle(backupBundle(), { roots, fs: io })).rejects.toMatchObject({
        recoveryConfirmed: false,
      });
      expect(io.renameCalls).toHaveLength(7);
      expect(io.renameCalls[4]?.dest).toBe(roots.dataDir);
      expect(io.renameCalls[5]?.dest).toContain(".stage-");
      expect(io.renameCalls[6]?.dest).toContain("knowledge-base");
    } finally {
      await removeWorkspace(workspace);
    }
  });

  it("retains recovery paths when rollback itself cannot be confirmed", async () => {
    const workspace = await mkdtemp("fr2-backup-restore-unconfirmed-");
    const roots = restoreRoots(workspace);
    useRestoreRoots(roots);
    await writeLiveState(roots);
    const io = makeRestoreFs({ failRenameAt: [4, 5] });

    try {
      await expect(restoreBackupBundle(backupBundle(), { roots, fs: io })).rejects.toMatchObject({
        recoveryConfirmed: false,
      });
      try {
        await restoreBackupBundle(backupBundle(), { roots, fs: io });
      } catch (error) {
        expect(error).toBeInstanceOf(BackupRestoreError);
        if (error instanceof BackupRestoreError) {
          expect(error.recoveryConfirmed).toBe(false);
          expect(error.recoveryPaths.length).toBeGreaterThan(0);
          expect(error.recoveryPaths.some((candidate) => candidate.includes(".stage-") || candidate.includes(".previous-"))).toBe(true);
          for (const candidate of error.recoveryPaths) {
            expect(await exists(candidate)).toBe(true);
          }
        }
      }
    } finally {
      await removeWorkspace(workspace);
    }
  });

  it("returns cleanup warnings after a committed restore", async () => {
    const workspace = await mkdtemp("fr2-backup-restore-cleanup-");
    const roots = restoreRoots(workspace);
    useRestoreRoots(roots);
    await writeLiveState(roots);
    const io = makeRestoreFs({ failRmAt: [1] });

    try {
      const result = await restoreBackupBundle(backupBundle(), { roots, fs: io });
      expect(result.restored).toBe(5);
      expect(result.cleanupWarnings).toHaveLength(1);
      expect(result.cleanupWarnings[0]).toContain("rm-1");
    } finally {
      await removeWorkspace(workspace);
    }
  });

  it("waits for shared writes to finish before it enters the commit phase, then blocks new writes until rollback or commit ends", async () => {
    const workspace = await mkdtemp("fr2-backup-restore-barrier-");
    const roots = restoreRoots(workspace);
    useRestoreRoots(roots);
    await writeLiveState(roots);
    const updateHold = deferred<void>();
    const commitHold = deferred<void>();
    const events: string[] = [];
    const io = makeRestoreFs({ pauseRenameAt: 1, pauseGate: commitHold });

    try {
      const sharedUpdate = updateJsonFile("athlete.json", { ftp: 250, goals: ["keep"] }, async (current) => {
        events.push("update-start");
        await updateHold.promise;
        events.push("update-end");
        return current;
      });

      await Promise.resolve();
      const restore = restoreBackupBundle(backupBundle(), { roots, fs: io });
      await Promise.resolve();
      expect(io.renameCalls).toHaveLength(0);

      updateHold.resolve();
      await sharedUpdate;
      await waitForCondition(() => io.renameCalls.length === 1, "restore never reached the commit rename");
      expect(io.renameCalls).toHaveLength(1);
      events.push("rename-held");

      const jsonWrite = writeJsonFile("morning-check.json", { ok: false }).then(() => events.push("json-write"));
      const kbWrite = writeKnowledgeFile("nutrition.md", "# Updated").then(() => events.push("kb-write"));
      await Promise.resolve();
      expect(events).toContain("rename-held");
      expect(events).not.toContain("json-write");
      expect(events).not.toContain("kb-write");

      commitHold.resolve();
      await restore;
      await Promise.all([jsonWrite, kbWrite]);
      expect(events).toContain("json-write");
      expect(events).toContain("kb-write");
    } finally {
      await removeWorkspace(workspace);
    }
  });

  it("releases blocked writers only after rollback completes when commit fails", async () => {
    const workspace = await mkdtemp("fr2-backup-restore-barrier-fail-");
    const roots = restoreRoots(workspace);
    useRestoreRoots(roots);
    await writeLiveState(roots);
    const commitHold = deferred<void>();
    const events: string[] = [];
    const io = makeRestoreFs({ pauseRenameAt: 1, pauseGate: commitHold, failRenameAt: [1] });

    try {
      const restore = restoreBackupBundle(backupBundle(), { roots, fs: io }).catch((error: unknown) => {
        events.push("restore-failed");
        throw error;
      });
      await waitForCondition(() => io.renameCalls.length === 1, "restore never reached the failing commit rename");
      const jsonWrite = writeJsonFile("morning-check.json", { ok: false }).then(() => events.push("json-write"));
      const kbWrite = writeKnowledgeFile("nutrition.md", "# Updated").then(() => events.push("kb-write"));
      await Promise.resolve();
      expect(events).not.toContain("json-write");
      expect(events).not.toContain("kb-write");

      commitHold.resolve();
      await expect(restore).rejects.toMatchObject({ recoveryConfirmed: true });
      await Promise.all([jsonWrite, kbWrite]);
      expect(events).toContain("restore-failed");
      expect(events).toContain("json-write");
      expect(events).toContain("kb-write");
    } finally {
      await removeWorkspace(workspace);
    }
  });
});
