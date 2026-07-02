// Off-machine backup (ROADMAP SUB-4). Same bundle GET /api/export produces (data/ + knowledge-base/),
// auto-written to NODEVELO_BACKUP_DIR after every sync. Unset, this is a deliberate no-op rather than a
// same-disk default — a backup that never leaves the machine wouldn't buy anything the existing
// .bak/manual-export coverage doesn't already give. Point it at whatever already leaves this machine
// (a Dropbox/iCloud/Drive-synced folder, a mounted NAS) and that sync carries it the rest of the way.

import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = process.env.NODEVELO_DATA_DIR || path.join(process.cwd(), "data");
const KB_DIR = path.join(process.cwd(), "knowledge-base");
const MAX_SNAPSHOTS = 14; // rotate old snapshots so a synced folder doesn't grow unbounded

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
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        const rel = path.relative(dir, full);
        if (keep(rel)) out[rel] = await fs.readFile(full, "utf-8");
      }
    }
  }
  await walk(dir);
  return out;
}

export interface BackupBundle {
  app: "nodevelo";
  kind: "backup";
  version: 1;
  exportedAt: string;
  data: Record<string, string>;
  knowledgeBase: Record<string, string>;
}

// The same bundle shape GET /api/export downloads and POST /api/import restores from.
export async function buildBackupBundle(): Promise<BackupBundle> {
  const [data, knowledgeBase] = await Promise.all([
    collect(DATA_DIR, (rel) => rel.endsWith(".json")),
    collect(KB_DIR, (rel) => rel.endsWith(".md")),
  ]);
  return { app: "nodevelo", kind: "backup", version: 1, exportedAt: new Date().toISOString(), data, knowledgeBase };
}

export type SnapshotResult = { ok: true; path: string } | { ok: false; reason: string };

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
