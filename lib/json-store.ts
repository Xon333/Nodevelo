// Crash-safe local JSON IO. The filesystem is this app's database, so writes must never leave
// a half-written file and an unrecoverable store must survive a corrupt write:
//
//  - Atomic write: serialise → temp file → fsync → rename. POSIX rename is atomic, so a crash
//    mid-write can never produce a truncated JSON — the old file stays intact until the new
//    one is fully on disk.
//  - Rolling backup: irreplaceable stores (the immutable ledgers, physiology history, blocks,
//    manual settings) snapshot their previous good version to `<file>.bak` before each write.
//  - Recovery on read: if the live file is missing or unparseable, fall back to `.bak`, then
//    to the caller's default — so a single bad write can't wipe the ledger.
//
// Regenerable stores (re-derivable from a fresh Intervals sync) get atomic writes but no
// backup — there's nothing worth recovering.

import { promises as fs } from "fs";
import path from "path";

// Resolved per call (not a module const) so tests can point at a throwaway directory via
// NODEVELO_DATA_DIR without re-importing, and so the app always reads the env in force at runtime.
function dataDir(): string {
  return process.env.NODEVELO_DATA_DIR || path.join(process.cwd(), "data");
}

// Stores that cannot be re-derived from a fresh sync → keep a one-deep backup.
const CRITICAL = new Set([
  "score-log.json",
  "intervention-log.json",
  "physiology.json",
  "current-block.json",
  "block-history.json",
  "athlete.json",
  "block-settings.json",
  "dispositions.json",
]);

export async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  const full = path.join(dataDir(), file);
  for (const candidate of [full, `${full}.bak`]) {
    try {
      const raw = await fs.readFile(candidate, "utf-8");
      // A successful parse is trusted as-is, even when the value is `null` — that's the real,
      // intentional content for some stores (current-block.json's "no active block" after a
      // delete). Treating a legitimate `null` as a failed read fell through to `.bak`, which
      // always holds the pre-write snapshot — resurrecting the block a delete had just cleared.
      // Only a genuine read/parse failure (missing file, corrupt JSON) should reach `.bak`.
      return JSON.parse(raw) as T;
    } catch {
      // missing or unparseable — try the next candidate (.bak), then the default
    }
  }
  return fallback;
}

// Per-file critical section. Two concurrent operations on the same store (e.g. a sync and a
// disposition POST both touching score-log.json) would otherwise interleave and clobber each other.
// Each operation chains onto the previous one for the *same* file so they run one-at-a-time;
// different files stay parallel.
//
// This guards the WHOLE operation, not just the byte-write: `updateJsonFile` reads INSIDE the lock,
// so a read-modify-write transaction can't lose an update to a concurrent writer (CR-A). A plain
// `writeJsonFile` is just the degenerate case — last-write-wins, no read.
const fileLocks = new Map<string, Promise<unknown>>();

function withFileLock<T>(file: string, op: () => Promise<T>): Promise<T> {
  // `.catch` so a prior failed op doesn't poison the chain for the next caller; the returned
  // promise still rejects if *this* op fails (preserving the throw-on-error contract).
  const prev = fileLocks.get(file) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(op);
  fileLocks.set(file, next);
  // Drop the entry once it's settled and still the tail, so the map can't grow unbounded.
  void next.catch(() => {}).finally(() => {
    if (fileLocks.get(file) === next) fileLocks.delete(file);
  });
  return next;
}

export function writeJsonFile(file: string, value: unknown): Promise<void> {
  return withFileLock(file, () => atomicWrite(file, value));
}

// Read → transform → write as ONE critical section. The read happens while the lock is held, so two
// concurrent updaters (or an updater racing a plain write) can never both read the same base and
// clobber each other's changes. `mutate` may be async. Returns the value actually written. If
// `mutate` throws, nothing is written and the lock is released for the next caller.
export function updateJsonFile<T>(
  file: string,
  fallback: T,
  mutate: (current: T) => T | Promise<T>
): Promise<T> {
  return withFileLock(file, async () => {
    const current = await readJsonFile(file, fallback); // readJsonFile takes no lock — safe to nest
    const nextValue = await mutate(current);
    await atomicWrite(file, nextValue);
    return nextValue;
  });
}

async function atomicWrite(file: string, value: unknown): Promise<void> {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const full = path.join(dir, file);

  if (CRITICAL.has(file)) {
    // Snapshot the previous good version before overwriting. HR-41: two failure modes this used to
    // swallow silently via a blanket `.catch(() => {})`:
    //  (a) a real copy failure (EACCES/EIO/ENOSPC during disk pressure) voided the backup guarantee
    //      exactly when it mattered most — only ENOENT (no live file yet, first write) is actually
    //      expected here, so anything else now rethrows.
    //  (b) if the LIVE file is already corrupt (recoverable via `.bak` on read, but not yet fixed on
    //      disk), blindly copying it would overwrite the last known-good `.bak` with those corrupt
    //      bytes — a crash between that copy and this write's own rename then leaves both copies
    //      unusable. Skip rotation (preserve the existing `.bak`) when the live content doesn't parse.
    try {
      const liveRaw = await fs.readFile(full, "utf-8");
      JSON.parse(liveRaw);
      await fs.writeFile(`${full}.bak`, liveRaw, "utf-8");
    } catch (err) {
      const isMissing = (err as NodeJS.ErrnoException).code === "ENOENT";
      const isCorrupt = err instanceof SyntaxError;
      if (!isMissing && !isCorrupt) throw err;
    }
  }

  const tmp = `${full}.tmp`;
  const data = JSON.stringify(value, null, 2) + "\n";
  const handle = await fs.open(tmp, "w");
  try {
    await handle.writeFile(data, "utf-8");
    await handle.sync(); // flush to disk before the rename so the swap is durable
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, full); // atomic swap
}
