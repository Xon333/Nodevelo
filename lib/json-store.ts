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
import { withPersistenceAccess } from "./persistence-gate";

// Resolved per call (not a module const) so tests can point at a throwaway directory via
// NODEVELO_DATA_DIR without re-importing, and so the app always reads the env in force at runtime.
function dataDir(): string {
  return process.env.NODEVELO_DATA_DIR || path.join(process.cwd(), "data");
}

export const CRITICAL_JSON_FILES = [
  "score-log.json",
  "intervention-log.json",
  "physiology.json",
  // markedObsoleteAt is an athlete safety assertion, not regenerable telemetry.
  "physiology-status.json",
  "current-block.json",
  "block-history.json",
  "athlete.json",
  "block-settings.json",
  "dispositions.json",
  // An approved overlay carries a human review decision (Phase 4) that a fresh sync cannot re-derive —
  // exactly this set's criterion. Losing one would silently revert a correction to its original score.
  "intent-overlays.json",
  // An athlete-promoted workout library entry (evidence, provenance, export state) is exactly as
  // irreplaceable as the ledgers above — nothing re-derives it from a fresh sync.
  "workout-library.json",
  "ledger-rebuild.json",
  "morning-check.json",
  "loading-log.json",
  "season-plan.json",
  "calibration.json",
  "weekly-envelope.json",
] as const;

const CRITICAL = new Set<string>(CRITICAL_JSON_FILES);

export function isCriticalJsonFile(file: string): boolean {
  return CRITICAL.has(file);
}

// HR-42: like readJsonFile, but also signals WHY the fallback fired — specifically, whether at least
// one candidate (live or `.bak`) actually existed but was unreadable/unparseable (`corruptFallback:
// true`), as opposed to neither ever having been written at all (plain ENOENT on both — the ordinary
// first-write case, not corruption). Callers that might self-heal by writing the fallback/derived value
// back to disk need this distinction: persisting a fallback born from a genuine double-corruption would
// permanently enshrine that data loss as the new on-disk truth, whereas persisting one born from "this
// store has simply never existed yet" is exactly the normal, desired first-write behavior.
async function readJsonFileWithStatusUnlocked<T>(
  file: string,
  fallback: T
): Promise<{ value: T; corruptFallback: boolean; enoent: boolean; liveCorrupt: boolean }> {
  const full = path.join(dataDir(), file);
  let enoent = true;
  let liveCorrupt = false;
  for (const [index, candidate] of [full, `${full}.bak`].entries()) {
    try {
      const raw = await fs.readFile(candidate, "utf-8");
      enoent = false;
      // A successful parse is trusted as-is, even when the value is `null` — that's the real,
      // intentional content for some stores (current-block.json's "no active block" after a
      // delete). Treating a legitimate `null` as a failed read fell through to `.bak`, which
      // always holds the pre-write snapshot — resurrecting the block a delete had just cleared.
      // Only a genuine read/parse failure (missing file, corrupt JSON) should reach `.bak`.
      return { value: JSON.parse(raw) as T, corruptFallback: false, enoent, liveCorrupt };
    } catch (err) {
      // ENOENT (this candidate was never written) is not corruption; anything else — a parse
      // failure (SyntaxError) or a real read error (EACCES/EIO) — means something existed but is broken.
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
        enoent = false;
        if (index === 0) liveCorrupt = true;
      }
    }
  }
  return { value: fallback, corruptFallback: !enoent, enoent, liveCorrupt };
}

export function readJsonFileWithStatus<T>(
  file: string,
  fallback: T
): Promise<{ value: T; corruptFallback: boolean; enoent: boolean; liveCorrupt: boolean }> {
  return withPersistenceAccess(() => readJsonFileWithStatusUnlocked(file, fallback));
}

export function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  return withPersistenceAccess(async () => (await readJsonFileWithStatusUnlocked(file, fallback)).value);
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
  return withPersistenceAccess(() => withFileLock(file, () => atomicWrite(file, value)));
}

// Read → transform → write as ONE critical section. The read happens while the lock is held, so two
// concurrent updaters (or an updater racing a plain write) can never both read the same base and
// clobber each other's changes. `mutate` may be async. Returns the value actually written. If
// `mutate` throws, nothing is written and the lock is released for the next caller.
export function updateJsonFile<T>(
  file: string,
  fallback: T,
  mutate: (
    current: T,
    readStatus: { corruptFallback: boolean; enoent: boolean; liveCorrupt: boolean }
  ) => T | Promise<T>
): Promise<T> {
  return withPersistenceAccess(() =>
    withFileLock(file, async () => {
      const { value: current, corruptFallback, enoent, liveCorrupt } = await readJsonFileWithStatusUnlocked(
        file,
        fallback
      );
      // HR-42: refuse to persist a CRITICAL store's fallback born from genuine corruption (both the
      // live file and its `.bak` unreadable) as though it were real, legitimate content. `mutate`
      // deriving from a bare fallback (e.g. an empty ledger) and writing that back would silently
      // enshrine the data loss as the new on-disk truth — a routine sync would then treat "no history"
      // as real from that point on. Throwing here surfaces it loudly instead (the caller's own error
      // handling — e.g. a sync's 502 — reports it rather than a routine operation silently nuking data).
      if (corruptFallback && isCriticalJsonFile(file)) {
        throw new Error(
          `${file}: both the live file and its .bak are corrupt or unreadable — refusing to write a fallback value as truth. Manual recovery required.`
        );
      }
      const nextValue = await mutate(current, { corruptFallback, enoent, liveCorrupt });
      // A mutate that hands back the exact same reference it was given (e.g. a CAS no-op, or
      // resolveWeeklyEnvelope's `wrote: false` path) has nothing new to persist — skip the write
      // instead of rewriting identical content to disk on every call.
      if (nextValue !== current) await atomicWrite(file, nextValue);
      return nextValue;
    })
  );
}

async function atomicWrite(file: string, value: unknown): Promise<void> {
  // HR-54(b): JSON.stringify(undefined) returns the JS value `undefined`, not a string — the `+ "\n"`
  // below would silently coerce it to the literal 4 characters `undefined\n`, not valid JSON. No
  // current caller passes `undefined`, but fail loudly here rather than writing unparseable garbage a
  // future caller wouldn't notice until the next read fell back to `.bak`/default.
  if (value === undefined) {
    throw new Error(`${file}: refusing to write undefined — JSON.stringify(undefined) is not valid JSON.`);
  }
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const full = path.join(dir, file);

  if (isCriticalJsonFile(file)) {
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
