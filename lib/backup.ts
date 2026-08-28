// Off-machine backup (ROADMAP SUB-4). Same bundle GET /api/export produces (data/ + knowledge-base/),
// auto-written to NODEVELO_BACKUP_DIR after every sync. Unset, this is a deliberate no-op rather than a
// same-disk default — a backup that never leaves the machine wouldn't buy anything the existing
// .bak/manual-export coverage doesn't already give. Point it at whatever already leaves this machine
// (a Dropbox/iCloud/Drive-synced folder, a mounted NAS) and that sync carries it the rest of the way.

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { isCriticalJsonFile } from "./json-store";
import { withExclusivePersistence } from "./persistence-gate";

const MAX_SNAPSHOTS = 14; // rotate old snapshots so a synced folder doesn't grow unbounded

function dataDir(): string {
  return process.env.NODEVELO_DATA_DIR || path.join(process.cwd(), "data");
}

function kbDir(): string {
  return process.env.NODEVELO_KB_DIR || path.join(process.cwd(), "knowledge-base");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function safeJoin(root: string, rel: string): string {
  const full = path.resolve(root, rel);
  const relative = path.relative(root, full);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes restore root: ${rel}`);
  }
  return full;
}

function assertSafeDataPath(rel: string): void {
  if (!rel || rel.includes("\0") || rel.includes("\\") || path.isAbsolute(rel) || rel !== path.basename(rel) || !rel.endsWith(".json")) {
    throw new BackupValidationError(`Invalid data path: ${rel}`);
  }
  if (rel === "." || rel === "..") {
    throw new BackupValidationError(`Invalid data path: ${rel}`);
  }
  safeJoin("/restore-root", rel);
}

function assertSafeKnowledgePath(rel: string): void {
  if (!rel || rel.includes("\0") || rel.includes("\\") || path.isAbsolute(rel) || !rel.endsWith(".md")) {
    throw new BackupValidationError(`Invalid knowledge base path: ${rel}`);
  }
  const parts = rel.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new BackupValidationError(`Invalid knowledge base path: ${rel}`);
  }
  safeJoin("/restore-root", rel);
}

function validateTimestamp(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new BackupValidationError("Backup exportedAt must be a string.");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new BackupValidationError("Backup exportedAt must be a canonical UTC timestamp.");
  }
}

function validateStringMap(
  label: string,
  value: unknown,
  validatePath: (rel: string) => void,
  validateContent?: (content: string, rel: string) => void
): Record<string, string> {
  if (!isPlainRecord(value)) {
    throw new BackupValidationError(`Backup ${label} must be a plain object.`);
  }
  const out: Record<string, string> = {};
  for (const [rel, content] of Object.entries(value)) {
    validatePath(rel);
    if (typeof content !== "string") {
      throw new BackupValidationError(`Backup ${label} entry ${rel} must be a string.`);
    }
    validateContent?.(content, rel);
    out[rel] = content;
  }
  return out;
}

// Collect every file under `dir` matching `keep`, keyed by path relative to `dir` (so nested KB dirs
// like block-retrospectives/ round-trip). Missing dir → empty map, never throws.
async function collect(dir: string, keep: (rel: string) => boolean): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(current: string): Promise<void> {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return; // dir doesn't exist
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(dir, full);
        if (keep(rel)) out[rel] = await fs.readFile(full, "utf-8");
      }
    }
  }
  await walk(dir);
  return out;
}

async function pathExists(target: string, io: Pick<typeof fs, "stat">): Promise<boolean> {
  try {
    await io.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function cleanupPath(target: string, io: Pick<typeof fs, "rm">, warnings: string[]): Promise<void> {
  try {
    await io.rm(target, { recursive: true, force: true });
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }
}

async function cleanupRecoveryPaths(
  targets: string[],
  io: Pick<typeof fs, "rm">,
  warnings: string[]
): Promise<void> {
  await Promise.all(targets.map((target) => cleanupPath(target, io, warnings)));
}

async function writeStageTree(
  root: string,
  entries: Record<string, string>,
  io: Pick<typeof fs, "mkdir" | "writeFile">
): Promise<void> {
  await io.mkdir(root, { recursive: true });
  for (const [rel, raw] of Object.entries(entries)) {
    const full = safeJoin(root, rel);
    await io.mkdir(path.dirname(full), { recursive: true });
    await io.writeFile(full, raw, "utf-8");
  }
}

async function writeStageJsonTree(
  root: string,
  entries: Record<string, string>,
  io: Pick<typeof fs, "mkdir" | "writeFile">
): Promise<void> {
  await io.mkdir(root, { recursive: true });
  for (const [rel, raw] of Object.entries(entries)) {
    const full = safeJoin(root, rel);
    const pretty = JSON.stringify(JSON.parse(raw), null, 2) + "\n";
    await io.mkdir(path.dirname(full), { recursive: true });
    await io.writeFile(full, pretty, "utf-8");
    if (isCriticalJsonFile(rel)) {
      await io.writeFile(`${full}.bak`, pretty, "utf-8");
    }
  }
}

type CommitAction =
  | { type: "moved-live"; live: string; previous: string }
  | { type: "promoted-stage"; live: string; stage: string };

async function rollbackActions(
  actions: CommitAction[],
  io: Pick<typeof fs, "rename" | "stat">,
  failures: string[]
): Promise<void> {
  for (const action of [...actions].reverse()) {
    try {
      if (action.type === "promoted-stage") {
        if (await pathExists(action.live, io)) {
          await io.rename(action.live, action.stage);
        }
      } else if (await pathExists(action.previous, io)) {
        await io.rename(action.previous, action.live);
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
}

async function existingRecoveryPaths(
  candidates: string[],
  io: Pick<typeof fs, "stat">
): Promise<string[]> {
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await pathExists(candidate, io)) existing.push(candidate);
  }
  return existing;
}

export interface BackupBundle {
  app: "nodevelo";
  kind: "backup";
  version: 1;
  exportedAt: string;
  data: Record<string, string>;
  knowledgeBase: Record<string, string>;
}

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupValidationError";
  }
}

export class BackupRestoreError extends Error {
  recoveryConfirmed: boolean;
  recoveryPaths: string[];

  constructor(message: string, recoveryConfirmed: boolean, recoveryPaths: string[] = []) {
    super(message);
    this.name = "BackupRestoreError";
    this.recoveryConfirmed = recoveryConfirmed;
    this.recoveryPaths = recoveryPaths;
  }
}

export function validateBackupBundle(value: unknown): BackupBundle {
  if (!isPlainRecord(value)) {
    throw new BackupValidationError("Backup bundle must be a plain object.");
  }

  const keys = Object.keys(value).sort();
  const expected = ["app", "data", "exportedAt", "kind", "knowledgeBase", "version"];
  if (keys.length !== expected.length || keys.some((key, i) => key !== expected[i])) {
    throw new BackupValidationError("Backup bundle has unexpected top-level keys.");
  }
  if (value.app !== "nodevelo" || value.kind !== "backup" || value.version !== 1) {
    throw new BackupValidationError("Backup bundle must be a NodeVelo version-1 backup.");
  }

  validateTimestamp(value.exportedAt);
  const data = validateStringMap("data", value.data, assertSafeDataPath, (content, rel) => {
    try {
      JSON.parse(content);
    } catch {
      throw new BackupValidationError(`Backup data entry ${rel} is not valid JSON.`);
    }
  });
  const knowledgeBase = validateStringMap("knowledgeBase", value.knowledgeBase, assertSafeKnowledgePath);

  return {
    app: "nodevelo",
    kind: "backup",
    version: 1,
    exportedAt: value.exportedAt,
    data,
    knowledgeBase,
  };
}

// The same bundle shape GET /api/export downloads and POST /api/import restores from.
export async function buildBackupBundle(): Promise<BackupBundle> {
  return withExclusivePersistence(async () => {
    const [data, knowledgeBase] = await Promise.all([
      collect(dataDir(), (rel) => rel.endsWith(".json")),
      collect(kbDir(), (rel) => rel.endsWith(".md")),
    ]);
    return {
      app: "nodevelo",
      kind: "backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      data,
      knowledgeBase,
    };
  });
}

export type SnapshotResult = { ok: true; path: string } | { ok: false; reason: string };

export async function restoreBackupBundle(
  bundle: unknown,
  options?: {
    roots?: { dataDir: string; knowledgeBaseDir: string };
    fs?: Pick<typeof fs, "mkdir" | "writeFile" | "rename" | "rm" | "stat">;
  }
): Promise<{ restored: number; cleanupWarnings: string[] }> {
  const validated = validateBackupBundle(bundle);
  const roots = options?.roots ?? { dataDir: dataDir(), knowledgeBaseDir: kbDir() };
  const io = options?.fs ?? fs;
  const dataStage = `${roots.dataDir}.stage-${randomUUID()}`;
  const kbStage = `${roots.knowledgeBaseDir}.stage-${randomUUID()}`;
  const dataPrevious = `${roots.dataDir}.previous-${randomUUID()}`;
  const kbPrevious = `${roots.knowledgeBaseDir}.previous-${randomUUID()}`;
  const stagePaths = [dataStage, kbStage];

  try {
    await writeStageJsonTree(dataStage, validated.data, io);
    await writeStageTree(kbStage, validated.knowledgeBase, io);
  } catch {
    await Promise.all(stagePaths.map((target) => io.rm(target, { recursive: true, force: true }).catch(() => {})));
    throw new BackupRestoreError("Restore staging failed. Your current data was not changed.", true);
  }

  const cleanupWarnings: string[] = [];
  const recoveryCandidates = [kbStage, kbPrevious, dataStage, dataPrevious];

  try {
    await withExclusivePersistence(async () => {
      const actions: CommitAction[] = [];
      try {
        if (await pathExists(roots.knowledgeBaseDir, io)) {
          await io.rename(roots.knowledgeBaseDir, kbPrevious);
          actions.push({ type: "moved-live", live: roots.knowledgeBaseDir, previous: kbPrevious });
        }
        await io.rename(kbStage, roots.knowledgeBaseDir);
        actions.push({ type: "promoted-stage", live: roots.knowledgeBaseDir, stage: kbStage });

        if (await pathExists(roots.dataDir, io)) {
          await io.rename(roots.dataDir, dataPrevious);
          actions.push({ type: "moved-live", live: roots.dataDir, previous: dataPrevious });
        }
        await io.rename(dataStage, roots.dataDir);
        actions.push({ type: "promoted-stage", live: roots.dataDir, stage: dataStage });

        await cleanupPath(kbPrevious, io, cleanupWarnings);
        await cleanupPath(dataPrevious, io, cleanupWarnings);
        await cleanupPath(kbStage, io, cleanupWarnings);
        await cleanupPath(dataStage, io, cleanupWarnings);
      } catch {
        const rollbackFailures: string[] = [];
        await rollbackActions(actions, io, rollbackFailures);
        if (rollbackFailures.length > 0) {
          throw new BackupRestoreError(
            "Restore could not confirm recovery. Keep the uploaded backup and recover manually.",
            false,
            await existingRecoveryPaths(
              recoveryCandidates,
              io
            )
          );
        }
        await cleanupRecoveryPaths(recoveryCandidates, io, []);
        throw new BackupRestoreError("Restore failed. Your previous data was put back.", true);
      }
    });
  } catch (error) {
    if (error instanceof BackupRestoreError) throw error;
    throw new BackupRestoreError(
      "Restore could not confirm recovery. Keep the uploaded backup and recover manually.",
      false,
      await existingRecoveryPaths(recoveryCandidates, io)
    );
  }

  return {
    restored: Object.keys(validated.data).length + Object.keys(validated.knowledgeBase).length,
    cleanupWarnings,
  };
}

// Best-effort — never throws. Callers (the sync route) should treat a failure as non-fatal.
export async function snapshotBackup(): Promise<SnapshotResult> {
  const dir = process.env.NODEVELO_BACKUP_DIR;
  if (!dir) return { ok: false, reason: "not configured" };

  try {
    await fs.mkdir(dir, { recursive: true });
    const bundle = await buildBackupBundle();
    // Colons stripped from the timestamp — the destination is often a cross-platform synced folder.
    const file = path.join(dir, `nodevelo-backup-${bundle.exportedAt.replace(/[:.]/g, "-")}.json`);
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(bundle, null, 2) + "\n", "utf-8");
    await fs.rename(tmp, file);

    const snapshots = (await fs.readdir(dir))
      .filter((f) => f.startsWith("nodevelo-backup-") && f.endsWith(".json"))
      .sort(); // ISO-ish timestamps in the filename sort chronologically
    const stale = snapshots.slice(0, Math.max(0, snapshots.length - MAX_SNAPSHOTS));
    await Promise.all(stale.map((f) => fs.unlink(path.join(dir, f)).catch(() => {})));

    return { ok: true, path: file };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
