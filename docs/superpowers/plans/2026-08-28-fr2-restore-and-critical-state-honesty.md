# FR-2 Restore and Critical-State Honesty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `agent-orchestration` to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make version-1 backup restore an exact, prevalidated, staged whole-snapshot replacement with confirmed rollback for ordinary failures and truthful recovery boundaries.

**Architecture:** `lib/backup.ts` remains the deep backup/restore module. A small writer-preferring shared/exclusive barrier coordinates normal JSON/Markdown access with KB-first/data-second directory swaps; `json-store.ts` owns the one critical-file list, and `kb-loader.ts` makes Markdown writes atomic. The import route and Settings card become thin, truthful consumers.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Next.js 16 route handlers, React 19, Vitest, Testing Library; no new dependency.

## Global Constraints

- Restore accepts exactly the six-key version-1 envelope: `app`, `kind`, `version`, `exportedAt`, `data`, and `knowledgeBase`; unknown keys are rejected.
- `exportedAt` must parse and serialize back to the identical canonical UTC `toISOString()` value.
- Validation finishes before filesystem mutation; one invalid entry rejects the whole bundle.
- Restore is exact: files absent from the backup disappear from the replaced `data/` and `knowledge-base/` trees.
- Commit order is knowledge-base first, then data; any commit-phase rename failure rolls recorded renames back in reverse order.
- Rollback-confirmed and rollback-unconfirmed failures are distinct; unconfirmed recovery paths are retained.
- The accepted process/machine-crash window is documented; do not add a journal, database, OS lock, or multi-process guarantee.
- All 17 critical JSON filenames have one code owner and receive matching restored `.bak` files; generated `.bak` files do not increment the restored count.
- Each top-level persistence operation acquires the barrier once and uses private unlocked helpers for nested work.
- Ordinary per-file JSON persistence still goes through `json-store.ts`; validated staged whole-tree restore is the only exception.
- Knowledge-base mutations use temporary-file + `fsync` + rename, with no Markdown `.bak` format.
- No AI-backed path changes; no live Anthropic smoke run is required.

---

### Task 1: Add the in-process persistence barrier

**Files:**
- Create: `lib/persistence-gate.ts`
- Create: `lib/persistence-gate.test.ts`

**Interfaces:**
- Produces: `withPersistenceAccess<T>(operation: () => Promise<T>): Promise<T>`
- Produces: `withExclusivePersistence<T>(operation: () => Promise<T>): Promise<T>`
- Contract: shared operations overlap; a queued exclusive blocks new shared work, waits for active shared work, runs alone, and releases waiters after success or failure.

- [ ] **Step 1: Write failing ordering and failure-release tests**

Create `lib/persistence-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { withExclusivePersistence, withPersistenceAccess } from "./persistence-gate";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("persistence gate", () => {
  it("lets active shared work finish, gives queued exclusive priority, then releases later shared work", async () => {
    const hold = deferred();
    const events: string[] = [];
    const first = withPersistenceAccess(async () => {
      events.push("shared-1-start");
      await hold.promise;
      events.push("shared-1-end");
    });
    await Promise.resolve();

    const exclusive = withExclusivePersistence(async () => { events.push("exclusive"); });
    const second = withPersistenceAccess(async () => { events.push("shared-2"); });
    await Promise.resolve();
    expect(events).toEqual(["shared-1-start"]);

    hold.resolve();
    await Promise.all([first, exclusive, second]);
    expect(events).toEqual(["shared-1-start", "shared-1-end", "exclusive", "shared-2"]);
  });

  it("releases queued shared work when exclusive work throws", async () => {
    const events: string[] = [];
    const exclusive = withExclusivePersistence(async () => {
      events.push("exclusive");
      throw new Error("swap failed");
    });
    const shared = withPersistenceAccess(async () => { events.push("shared"); });
    await expect(exclusive).rejects.toThrow("swap failed");
    await shared;
    expect(events).toEqual(["exclusive", "shared"]);
  });

  it("allows a nested shared call to finish while an exclusive call is queued", async () => {
    const outerStarted = deferred();
    const enterInner = deferred();
    const events: string[] = [];
    const outer = withPersistenceAccess(async () => {
      events.push("outer");
      outerStarted.resolve();
      await enterInner.promise;
      await withPersistenceAccess(async () => { events.push("inner"); });
    });
    await outerStarted.promise;
    const exclusive = withExclusivePersistence(async () => { events.push("exclusive"); });
    enterInner.resolve();
    await outer;
    await exclusive;
    expect(events).toEqual(["outer", "inner", "exclusive"]);
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run lib/persistence-gate.test.ts`

Expected: FAIL because `lib/persistence-gate.ts` does not exist.

- [ ] **Step 3: Implement the minimal writer-preferring barrier**

Create `lib/persistence-gate.ts`:

```ts
import { AsyncLocalStorage } from "async_hooks";

// Single-process persistence barrier. Normal store operations share access; whole-tree restore is exclusive.
interface PersistenceScope { mode: "shared" | "exclusive"; active: boolean }
const scope = new AsyncLocalStorage<PersistenceScope>();
let activeShared = 0;
let queuedExclusive = 0;
let exclusiveTail: Promise<unknown> = Promise.resolve();
let sharedWaiters: Array<() => void> = [];
let idleWaiters: Array<() => void> = [];

function waitForIdle(): Promise<void> {
  if (activeShared === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

function releaseSharedWaiters(): void {
  const waiters = sharedWaiters;
  sharedWaiters = [];
  for (const resolve of waiters) resolve();
}

export function withPersistenceAccess<T>(operation: () => Promise<T>): Promise<T> {
  if (scope.getStore()?.active) return operation();
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      const token: PersistenceScope = { mode: "shared", active: true };
      activeShared++;
      void Promise.resolve().then(() => scope.run(token, operation)).then(resolve, reject).finally(() => {
        token.active = false;
        activeShared--;
        if (activeShared === 0) {
          const waiters = idleWaiters;
          idleWaiters = [];
          for (const release of waiters) release();
        }
      });
    };
    if (queuedExclusive === 0) run();
    else sharedWaiters.push(run);
  });
}

export function withExclusivePersistence<T>(operation: () => Promise<T>): Promise<T> {
  if (scope.getStore()?.active) return Promise.reject(new Error("Exclusive persistence cannot be nested."));
  queuedExclusive++;
  const run = exclusiveTail.catch(() => {}).then(async () => {
    await waitForIdle();
    const token: PersistenceScope = { mode: "exclusive", active: true };
    try {
      return await scope.run(token, operation);
    } finally {
      token.active = false;
    }
  });
  exclusiveTail = run;
  void run.catch(() => {}).finally(() => {
    queuedExclusive--;
    if (queuedExclusive === 0) releaseSharedWaiters();
  });
  return run;
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run lib/persistence-gate.test.ts`

Expected: 3 tests pass with no warnings.

- [ ] **Step 5: Commit Task 1**

```bash
git add lib/persistence-gate.ts lib/persistence-gate.test.ts
git commit -m "feat: coordinate whole-store persistence"
```

---

### Task 2: Centralize critical JSON coverage and put json-store behind the barrier

**Files:**
- Modify: `lib/json-store.ts`
- Modify: `lib/json-store.test.ts`
- Modify: `lib/data-store.ts`

**Interfaces:**
- Consumes: `withPersistenceAccess` from Task 1.
- Produces: `CRITICAL_JSON_FILES: readonly string[]`
- Produces: `isCriticalJsonFile(file: string): boolean`
- Preserves: all existing `readJsonFile*`, `writeJsonFile`, and `updateJsonFile` signatures.

- [ ] **Step 1: Add failing complete-inventory tests**

Import `CRITICAL_JSON_FILES` and `isCriticalJsonFile` in `lib/json-store.test.ts`, then add:

```ts
const EXPECTED_CRITICAL = [
  "score-log.json", "intervention-log.json", "physiology.json", "physiology-status.json",
  "current-block.json", "block-history.json", "athlete.json", "block-settings.json",
  "dispositions.json", "intent-overlays.json", "workout-library.json", "ledger-rebuild.json",
  "morning-check.json", "loading-log.json", "season-plan.json", "calibration.json",
  "weekly-envelope.json",
] as const;

describe("critical-state inventory", () => {
  it("has one complete code-owned list", () => {
    expect(CRITICAL_JSON_FILES).toEqual(EXPECTED_CRITICAL);
    for (const file of EXPECTED_CRITICAL) expect(isCriticalJsonFile(file)).toBe(true);
    for (const file of ["last-sync.json", "generation-gate.json", "today-analysis.json", "rolling-baselines.json", "athlete-quirks.json", "ai-usage.json"])
      expect(isCriticalJsonFile(file)).toBe(false);
  });

  it("rotates .bak for every critical store", async () => {
    for (const file of EXPECTED_CRITICAL) {
      await writeJsonFile(file, { version: 1 });
      await writeJsonFile(file, { version: 2 });
      expect(JSON.parse(await fs.readFile(p(`${file}.bak`), "utf-8"))).toEqual({ version: 1 });
    }
  });

  it("refuses double-corrupt fallback updates for every critical store", async () => {
    for (const file of EXPECTED_CRITICAL) {
      await fs.writeFile(p(file), "{ broken", "utf-8");
      await fs.writeFile(p(`${file}.bak`), "{ broken", "utf-8");
      await expect(updateJsonFile(file, {}, () => ({ replaced: true }))).rejects.toThrow(/refusing to write/);
    }
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run lib/json-store.test.ts`

Expected: FAIL because the exports and six new critical members do not exist.

- [ ] **Step 3: Export the inventory and add the six justified stores**

Replace the private `CRITICAL` declaration in `lib/json-store.ts` with:

```ts
export const CRITICAL_JSON_FILES = [
  "score-log.json",
  "intervention-log.json",
  "physiology.json",
  "physiology-status.json",
  "current-block.json",
  "block-history.json",
  "athlete.json",
  "block-settings.json",
  "dispositions.json",
  "intent-overlays.json",
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
```

Replace internal `CRITICAL.has(file)` calls with `isCriticalJsonFile(file)`.

- [ ] **Step 4: Acquire shared access exactly once per public json-store operation**

Import `withPersistenceAccess`. Rename the current read implementation to `readJsonFileWithStatusUnlocked`, then use these public wrappers:

```ts
export function readJsonFileWithStatus<T>(file: string, fallback: T) {
  return withPersistenceAccess(() => readJsonFileWithStatusUnlocked(file, fallback));
}

export function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  return withPersistenceAccess(async () => (await readJsonFileWithStatusUnlocked(file, fallback)).value);
}

export function writeJsonFile(file: string, value: unknown): Promise<void> {
  return withPersistenceAccess(() => withFileLock(file, () => atomicWrite(file, value)));
}

export function updateJsonFile<T>(file: string, fallback: T, mutate: (
  current: T,
  readStatus: { corruptFallback: boolean; enoent: boolean; liveCorrupt: boolean }
) => T | Promise<T>): Promise<T> {
  return withPersistenceAccess(() => withFileLock(file, async () => {
    const { value: current, corruptFallback, enoent, liveCorrupt } =
      await readJsonFileWithStatusUnlocked(file, fallback);
    if (corruptFallback && isCriticalJsonFile(file)) {
      throw new Error(`${file}: both the live file and its .bak are corrupt or unreadable — refusing to write a fallback value as truth. Manual recovery required.`);
    }
    const nextValue = await mutate(current, { corruptFallback, enoent, liveCorrupt });
    if (nextValue !== current) await atomicWrite(file, nextValue);
    return nextValue;
  }));
}
```

Keep `readJsonFileWithStatusUnlocked`, `withFileLock`, and `atomicWrite` private. Do not call a public barrier-wrapped read from inside `updateJsonFile`.

- [ ] **Step 5: Correct stale store-classification comments**

In `lib/data-store.ts`, remove `weekly-envelope.json` from the publication-verdict comment's disposable examples. Change calibration's comment to:

```ts
// Mixed derived + athlete-owned store: sync can regenerate derived values, but manualOverride cannot
// be reconstructed, so calibration.json is CRITICAL-backed.
```

Update the `ledger-rebuild`, morning-check, loading-log, season-plan, and weekly-envelope comments to state why they are CRITICAL-backed.

- [ ] **Step 6: Verify GREEN and regression safety**

Run: `npx vitest run lib/persistence-gate.test.ts lib/json-store.test.ts lib/data-store.test.ts`

Expected: all tests pass with no warnings.

- [ ] **Step 7: Commit Task 2**

```bash
git add lib/json-store.ts lib/json-store.test.ts lib/data-store.ts
git commit -m "fix: protect all critical athlete state"
```

---

### Task 3: Make knowledge-base access barrier-safe and Markdown writes atomic

**Files:**
- Modify: `lib/kb-loader.ts`
- Modify: `lib/kb-loader.test.ts`

**Interfaces:**
- Consumes: `withPersistenceAccess` from Task 1.
- Preserves: existing public KB and retrospective APIs.
- Adds internal test seam: `NODEVELO_KB_DIR` overrides the local KB root; production default remains `<cwd>/knowledge-base`.

- [ ] **Step 1: Establish a non-destructive KB test root before the RED test**

This is test isolation, not the atomic-write behavior. In `lib/kb-loader.ts`, replace the fixed local roots with:

```ts
function kbDir(): string {
  return process.env.NODEVELO_KB_DIR || path.join(process.cwd(), "knowledge-base");
}

function retroDir(): string {
  return path.join(kbDir(), "block-retrospectives");
}
```

Replace existing `KB_DIR`/`RETRO_DIR` reads with those functions. In `lib/kb-loader.test.ts`, merge `afterAll`/`beforeAll` into the existing Vitest import and add:

```ts
import os from "os";

let kbTestDir: string;
const retroDir = () => path.join(kbTestDir, "block-retrospectives");

beforeAll(async () => {
  kbTestDir = await fs.mkdtemp(path.join(os.tmpdir(), "nodevelo-kb-loader-"));
  process.env.NODEVELO_KB_DIR = kbTestDir;
});

afterAll(async () => {
  delete process.env.NODEVELO_KB_DIR;
  await fs.rm(kbTestDir, { recursive: true, force: true });
});
```

Remove the test's fixed worktree `RETRO_DIR` constant and update its uses to `retroDir()`.

Run: `npx vitest run lib/kb-loader.test.ts`

Expected: the unchanged behavior suite passes and no file under the worktree's real `knowledge-base/` is created or modified.

- [ ] **Step 2: Write failing atomic-write tests through public APIs**

Merge `vi` into the Vitest import and add `readKnowledgeFile`, `writeKnowledgeFile`, and `writeRetrospective` to the existing loader imports. Then add:

```ts
describe("atomic knowledge-base writes", () => {
  const core = () => path.join(process.env.NODEVELO_KB_DIR as string, "training_knowledge.md");
  const retro = (name: string) => path.join(retroDir(), name);

  it("replaces an existing knowledge file through a temp rename", async () => {
    await fs.writeFile(core(), "old", "utf-8");
    await writeKnowledgeFile("training_knowledge.md", "new");
    expect(await readKnowledgeFile("training_knowledge.md")).toBe("new");
    expect((await fs.readdir(process.env.NODEVELO_KB_DIR as string)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it.each([
    ["knowledge", async () => writeKnowledgeFile("training_knowledge.md", "lost"), core],
    ["retrospective", async () => writeRetrospective("2099-01-01_atomic.md", "lost"), () => retro("2099-01-01_atomic.md")],
    ["seed approval", async () => markRetroSeedsApproved("2099-01-01_atomic.md"), () => retro("2099-01-01_atomic.md")],
  ])("keeps the prior %s file when rename fails", async (_label, mutate, target) => {
    await fs.mkdir(path.dirname(target()), { recursive: true });
    const original = _label === "seed approval" ? md("seeds_approved: false\nstatus: completed") : "intact";
    await fs.writeFile(target(), original, "utf-8");
    const rename = vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("rename failed"));
    await expect(mutate()).rejects.toThrow("rename failed");
    rename.mockRestore();
    expect(await fs.readFile(target(), "utf-8")).toBe(original);
  });

  it("atomically writes retrospectives and approved seed changes", async () => {
    await writeRetrospective("2099-01-01_atomic.md", md("seeds_approved: false\nstatus: completed"));
    await expect(markRetroSeedsApproved("2099-01-01_atomic.md")).resolves.toBe(true);
    expect(await fs.readFile(retro("2099-01-01_atomic.md"), "utf-8")).toContain("seeds_approved: true");
    expect((await fs.readdir(retroDir())).some((name) => name.endsWith(".tmp"))).toBe(false);
  });
});
```

- [ ] **Step 3: Verify RED safely**

Run: `npx vitest run lib/kb-loader.test.ts`

Expected: FAIL on rename-failure and atomic temp-file assertions, with mutations confined to the temporary KB root.

- [ ] **Step 4: Add one private atomic Markdown writer**

In `lib/kb-loader.ts`, add:

```ts
import { randomUUID } from "crypto";
import { withPersistenceAccess } from "./persistence-gate";

async function atomicWriteMarkdown(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(tmp, "wx");
    await handle.writeFile(content, "utf-8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tmp, file);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}
```

- [ ] **Step 5: Wrap each top-level KB operation once and use private unlocked helpers**

Create private `listKnowledgeFilesUnlocked`, `readKnowledgeFileUnlocked`, `listRetrospectivesUnlocked`, and `readRetrospectiveUnlocked` helpers containing the current raw filesystem logic. Public top-level operations use this pattern:

```ts
export function listKnowledgeFiles(): Promise<string[]> {
  return withPersistenceAccess(listKnowledgeFilesUnlocked);
}

export function readKnowledgeFile(name: string): Promise<string> {
  return withPersistenceAccess(() => readKnowledgeFileUnlocked(name));
}

export function writeKnowledgeFile(name: string, content: string): Promise<void> {
  return withPersistenceAccess(async () => {
    assertSafeName(name);
    if (!(await listKnowledgeFilesUnlocked()).includes(name)) {
      throw new Error(`Unknown knowledge base file: ${name}. Creating new files is not supported.`);
    }
    await atomicWriteMarkdown(path.join(kbDir(), name), content);
  });
}

export function writeRetrospective(name: string, content: string): Promise<void> {
  return withPersistenceAccess(async () => {
    assertSafeName(name);
    await atomicWriteMarkdown(path.join(retroDir(), name), content);
  });
}

export function markRetroSeedsApproved(name: string): Promise<boolean> {
  return withPersistenceAccess(async () => {
    assertSafeName(name);
    const file = path.join(retroDir(), name);
    const content = await fs.readFile(file, "utf-8");
    if (!retroFrontmatterBounds(content)) return false;
    const next = approveSeedsInMarkdown(content);
    if (next !== content) await atomicWriteMarkdown(file, next);
    return true;
  });
}
```

Apply the same one-wrapper/private-helper rule to `parseAthleteMd`, `parseGoalsWeakpointsForMigration`, `loadKnowledgeBaseContext`, `listRetrospectives`, `readRetrospective`, and `latestRetrospectiveSeeds`. Composite functions must call unlocked helpers, never another public wrapper while holding shared access.

Add a regression test that opens an outer `withPersistenceAccess` and signals the test after that scope starts. From the test's outside async context, queue `withExclusivePersistence`; then release the outer callback so it calls the real public `parseGoalsWeakpointsForMigration` through nested `withPersistenceAccess`. Assert the nested KB call finishes and the exclusive callback runs afterward. Never call `withExclusivePersistence` from inside the active shared scope; that is deliberately rejected. This pins the existing JSON-update → Markdown-migration nesting that a non-re-entrant gate deadlocks.

- [ ] **Step 6: Verify GREEN**

Run: `npx vitest run lib/persistence-gate.test.ts lib/kb-loader.test.ts`

Expected: all tests pass; no test writes the real `knowledge-base/` tree.

- [ ] **Step 7: Commit Task 3**

```bash
git add lib/kb-loader.ts lib/kb-loader.test.ts
git commit -m "fix: make knowledge writes atomic"
```

---

### Task 4: Implement strict validation and staged exact restore

**Files:**
- Modify: `lib/backup.ts`
- Rewrite: `lib/backup.test.ts`

**Interfaces:**
- Consumes: `withExclusivePersistence` and `isCriticalJsonFile`.
- Produces: `validateBackupBundle(input: unknown): BackupBundle`.
- Produces: `restoreBackupBundle(input: unknown, options?: RestoreOptions): Promise<RestoreResult>`.
- Produces: `BackupValidationError` and `BackupRestoreError` (`recoveryConfirmed`, `recoveryPaths`).

- [ ] **Step 1: Replace mock-only backup tests with temporary-tree contract tests**

Use real temporary data, KB, and snapshot roots. Add focused tests that assert:

```ts
expect(() => validateBackupBundle({ ...valid, version: 2 })).toThrow(BackupValidationError);
expect(() => validateBackupBundle({ ...valid, extra: true })).toThrow(BackupValidationError);
expect(() => validateBackupBundle({ ...valid, exportedAt: "2026-08-28" })).toThrow(BackupValidationError);
expect(() => validateBackupBundle({ ...valid, data: { "../escape.json": "{}" } })).toThrow(BackupValidationError);
expect(() => validateBackupBundle({ ...valid, data: { "nested/store.json": "{}" } })).toThrow(BackupValidationError);
expect(() => validateBackupBundle({ ...valid, knowledgeBase: { "block-retrospectives/retro.md": "# ok" } })).not.toThrow();
expect(() => validateBackupBundle({ ...valid, data: { "athlete.json": "{bad" } })).toThrow(BackupValidationError);
expect(() => validateBackupBundle({ ...valid, data: new Date() })).toThrow(BackupValidationError);
expect(() => validateBackupBundle(Object.assign(Object.create({ inherited: true }), valid))).toThrow(BackupValidationError);
```

Retain the existing `buildBackupBundle` collection/version test and all four `snapshotBackup` behaviors (unconfigured no-op, atomic configured write, 14-file rotation, and surfaced write failure), rewritten against the temporary roots rather than module-wide filesystem mocks. Add a nested retrospective to the collection assertion.

Add an exact-restore integration test with `athlete.json`, `last-sync.json`, and nested retrospective content. Seed extra live files first; after restore assert extras are gone, restored content matches, `athlete.json.bak` matches restored bytes, `last-sync.json.bak` is absent, `result.restored` counts only the three bundle entries, and no UUID staging/previous sibling remains after successful cleanup. Repeat with both live roots initially absent and assert the two complete roots are created.

Use a wrapped real filesystem with counted calls. Add a staging `writeFile` failure test that asserts both originals are byte-identical. Add `it.each([1, 2, 3, 4])` over every commit rename position (KB live→previous, KB stage→live, data live→previous, data stage→live); each injected failure must throw `BackupRestoreError` with `recoveryConfirmed === true` and restore both original trees byte-for-byte. Add a second call-4 test that also fails the first rollback rename; assert `recoveryConfirmed === false`, every reported `recoveryPath` exists, and at least one retained path contains `.stage-` or `.previous-`. Add a cleanup-`rm` failure test that still returns committed success with one cleanup warning.

Add a real wiring test: hold an `updateJsonFile` mutator open, start `restoreBackupBundle`, and assert no commit rename occurs until the update releases. Then hold the first commit rename open, start both `writeJsonFile` and `writeKnowledgeFile`, and assert neither completes until restore commits. Repeat the latter with an injected commit failure and assert both accesses resume only after rollback releases exclusive scope.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run lib/backup.test.ts`

Expected: FAIL because validation and restore exports do not exist.

- [ ] **Step 3: Add strict validation types and helpers to `lib/backup.ts`**

Add these public types and errors:

```ts
export class BackupValidationError extends Error {}

export class BackupRestoreError extends Error {
  constructor(
    message: string,
    readonly recoveryConfirmed: boolean,
    readonly recoveryPaths: string[] = []
  ) {
    super(message);
  }
}

export interface RestoreRoots { dataDir: string; knowledgeBaseDir: string }
export type RestoreFilesystem = Pick<typeof fs, "mkdir" | "writeFile" | "rename" | "rm" | "stat">;
export interface RestoreOptions { roots?: RestoreRoots; fs?: RestoreFilesystem }
export interface RestoreResult { restored: number; cleanupWarnings: string[] }
```

Implement `validateBackupBundle` with these exact rules:

```ts
const BUNDLE_KEYS = ["app", "kind", "version", "exportedAt", "data", "knowledgeBase"] as const;

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

function validatePath(rel: string, kind: "data" | "knowledgeBase"): void {
  const parts = rel.split("/");
  const extension = kind === "data" ? ".json" : ".md";
  if (!rel || rel.includes("\\") || rel.includes("\0") || path.isAbsolute(rel) ||
      parts.some((part) => !part || part === "." || part === "..") || !rel.endsWith(extension) ||
      (kind === "data" && parts.length !== 1)) {
    throw new BackupValidationError(`Invalid ${kind} path: ${rel}`);
  }
}

function validateMap(value: unknown, kind: "data" | "knowledgeBase"): Record<string, string> {
  if (!plainRecord(value)) throw new BackupValidationError(`${kind} must be an object.`);
  const output: Record<string, string> = {};
  for (const [rel, content] of Object.entries(value)) {
    validatePath(rel, kind);
    if (typeof content !== "string") throw new BackupValidationError(`${rel} must contain text.`);
    if (kind === "data") {
      try { JSON.parse(content); } catch { throw new BackupValidationError(`${rel} contains invalid JSON.`); }
    }
    output[rel] = content;
  }
  return output;
}

export function validateBackupBundle(input: unknown): BackupBundle {
  if (!plainRecord(input) || Object.keys(input).sort().join("|") !== [...BUNDLE_KEYS].sort().join("|"))
    throw new BackupValidationError("Backup envelope does not match version 1.");
  if (input.app !== "nodevelo" || input.kind !== "backup" || input.version !== 1 || !validTimestamp(input.exportedAt))
    throw new BackupValidationError("Not a supported NodeVelo version-1 backup.");
  return {
    app: "nodevelo", kind: "backup", version: 1, exportedAt: input.exportedAt,
    data: validateMap(input.data, "data"),
    knowledgeBase: validateMap(input.knowledgeBase, "knowledgeBase"),
  };
}
```

- [ ] **Step 4: Resolve roots dynamically and make exported bundles point-in-time consistent**

Replace the module-level data/KB constants with `dataDir()` and `knowledgeBaseDir()` functions using `NODEVELO_DATA_DIR` and `NODEVELO_KB_DIR`. Extract the current collector body into `buildBackupBundleUnlocked`, then define:

```ts
export function buildBackupBundle(): Promise<BackupBundle> {
  return withExclusivePersistence(buildBackupBundleUnlocked);
}
```

Keep `snapshotBackup` calling `buildBackupBundle()` once; do not wrap it in another exclusive acquisition.

- [ ] **Step 5: Stage complete trees and generate restored critical backups**

Add private `stageTree`/`stageBundle` helpers. For each JSON entry write:

```ts
const rendered = `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
await io.writeFile(path.join(dataStage, rel), rendered, "utf-8");
if (isCriticalJsonFile(rel)) await io.writeFile(path.join(dataStage, `${rel}.bak`), rendered, "utf-8");
```

Write Markdown bytes unchanged. Create stage paths as UUID-named siblings of each live root. On any staging error, best-effort remove only those generated stage paths and throw `new BackupRestoreError("Restore staging failed. Your current data was not changed.", true)`.

- [ ] **Step 6: Commit KB-first/data-second and roll back every recorded rename**

Represent each root as:

```ts
interface TreeSwap {
  live: string;
  stage: string;
  previous: string;
  hadLive: boolean;
  previousMoved: boolean;
  promoted: boolean;
}
```

Inside one `withExclusivePersistence` call, process `[knowledgeBaseTree, dataTree]`. Before each live-to-previous rename, record `hadLive` using `stat` (ENOENT means false; other errors throw). Set `previousMoved` and `promoted` only after successful renames.

On any commit rename failure, iterate the trees in reverse. For each tree, attempt every applicable rollback action even if an earlier rollback action fails:

```ts
if (tree.promoted) await io.rename(tree.live, tree.stage);
if (tree.previousMoved) await io.rename(tree.previous, tree.live);
```

Collect rollback errors rather than stopping at the first. If none occur, remove generated stages best-effort and throw a confirmed `BackupRestoreError`. If any occur, do no cleanup; `stat` each tree's stage and previous path, retain the ones that still exist, and throw an unconfirmed `BackupRestoreError` whose `recoveryPaths` is that unique existing recovery-candidate list.

After both promotions succeed, return the bundle-entry count. Best-effort remove previous/stage paths; return cleanup error messages in `cleanupWarnings` and do not roll back.

- [ ] **Step 7: Verify GREEN and focused integration**

Run: `npx vitest run lib/persistence-gate.test.ts lib/json-store.test.ts lib/backup.test.ts`

Expected: all tests pass, including exact replacement, critical `.bak`, confirmed rollback, unconfirmed rollback, and committed cleanup-warning cases.

- [ ] **Step 8: Commit Task 4**

```bash
git add lib/backup.ts lib/backup.test.ts
git commit -m "feat: restore exact backup snapshots"
```

---

### Task 5: Replace the partial-success API and Settings flow

**Files:**
- Modify: `app/api/import/route.ts`
- Rewrite: `app/api/import/route.test.ts`
- Modify: `components/BackupRestore.tsx`
- Create: `components/BackupRestore.test.tsx`

**Interfaces:**
- Consumes: `restoreBackupBundle`, `BackupValidationError`, `BackupRestoreError`.
- Produces API: `200 {ok:true, restored}`, validation `400 {error}`, operational/unconfirmed `500 {error}`.
- Removes: `skipped` response and partial-success UI.

- [ ] **Step 1: Write failing route contract tests**

Mock `@/lib/backup` and assert: malformed body returns 400 without calling restore; a `BackupValidationError` maps to 400; success maps to `{ok:true, restored:2}`; confirmed failure says the previous snapshot was restored; unconfirmed failure tells the athlete to keep the backup and does not claim unchanged state.

Use these exact expected messages:

```ts
"Restore failed. Your previous data was put back."
"Restore was interrupted and recovery could not be confirmed. Keep the backup file and restore it again before using NodeVelo."
```

- [ ] **Step 2: Verify route RED**

Run: `npx vitest run app/api/import/route.test.ts`

Expected: FAIL because the route still returns `skipped` partial-success results.

- [ ] **Step 3: Make the import route thin**

Replace `app/api/import/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { BackupRestoreError, BackupValidationError, restoreBackupBundle } from "@/lib/backup";
import { logWarn } from "@/lib/log";

export async function POST(req: Request) {
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const result = await restoreBackupBundle(input);
    for (const warning of result.cleanupWarnings) logWarn("/api/import", "restore-cleanup", warning);
    return NextResponse.json({ ok: true, restored: result.restored });
  } catch (error) {
    if (error instanceof BackupValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof BackupRestoreError && error.recoveryConfirmed) {
      logWarn("/api/import", "restore-failed", error.message);
      return NextResponse.json({ error: "Restore failed. Your previous data was put back." }, { status: 500 });
    }
    if (error instanceof BackupRestoreError) {
      logWarn("/api/import", "restore-unconfirmed", error.message, { recoveryPaths: error.recoveryPaths });
    } else {
      logWarn("/api/import", "restore-unconfirmed", error instanceof Error ? error.message : String(error));
    }
    return NextResponse.json({
      error: "Restore was interrupted and recovery could not be confirmed. Keep the backup file and restore it again before using NodeVelo."
    }, { status: 500 });
  }
}
```

- [ ] **Step 4: Write failing destructive-UI tests**

Create `components/BackupRestore.test.tsx` with jsdom. Select a backup file through the hidden input and assert the confirmation includes both “exact backup snapshot” and “Files not in the backup will be removed.” Mock `fetch` success and `setTimeout`; assert “Restored the complete backup snapshot (2 files). Reloading…” appears. Mock a 500 response; assert the API error appears, no partial-success wording appears, and no reload timer is scheduled. Add a non-JSON response test and assert it says recovery is unconfirmed, tells the athlete to keep the backup, and never says current data was unchanged.

- [ ] **Step 5: Verify component RED**

Run: `npx vitest run components/BackupRestore.test.tsx`

Expected: FAIL because current copy promises skipped-file partial results and the old action label.

- [ ] **Step 6: Update Settings copy and response handling**

In `components/BackupRestore.tsx`, remove `skipped` from the response type and use:

```ts
let json: { error?: string; restored?: number };
try {
  json = (await res.json()) as { error?: string; restored?: number };
} catch {
  throw new Error("Restore status could not be confirmed. Keep the backup file and restore it again before using NodeVelo.");
}
if (!res.ok) throw new Error(json.error || "Restore status could not be confirmed. Keep the backup file and restore it again before using NodeVelo.");
setStatus({ ok: true, msg: `Restored the complete backup snapshot (${json.restored ?? 0} files). Reloading…` });
setTimeout(() => window.location.reload(), 1000);
```

Replace confirmation copy with:

```tsx
<p className="text-xs text-red-800 dark:text-red-300">
  Restore from <span className="font-medium">{pendingFile.name}</span>? This replaces all current
  training data and knowledge-base files with the exact backup snapshot. Files not in the backup
  will be removed. The backup is fully checked before changes begin; an ordinary restore failure
  puts the current snapshot back. Keep the backup file: a process or machine crash during the final
  swap can interrupt restoration.
</p>
```

Change the button label to `Replace with backup`. Keep failure state on screen and do not schedule reload after failure.

- [ ] **Step 7: Verify GREEN**

Run: `npx vitest run app/api/import/route.test.ts components/BackupRestore.test.tsx`

Expected: all route and UI tests pass with no warnings.

- [ ] **Step 8: Commit Task 5**

```bash
git add app/api/import/route.ts app/api/import/route.test.ts components/BackupRestore.tsx components/BackupRestore.test.tsx
git commit -m "feat: expose exact restore contract"
```

---

### Task 6: Make recovery documentation and backlog state truthful

**Files:**
- Modify: `docs/INVARIANTS.md`
- Modify: `docs/systems/01-sync-and-data.md`
- Modify: `docs/FILE_INDEX.md`
- Modify: `docs/RECIPES.md`
- Modify: `FEATURES.md`
- Modify: `ROADMAP.md`
- Modify: `ARCHIVE.md`
- Modify: `docs/superpowers/specs/2026-08-28-fr2-restore-and-critical-state-honesty-design.md`

**Interfaces:**
- Consumes: the shipped contracts and verification evidence from Tasks 1–5.
- Produces: current recovery coverage, runbook, feature claim, stable FR-2 archive record, and FR-3 dependency state.

- [ ] **Step 1: Update the invariant narrowly**

Keep invariant 2's heading and anchor. Change its body to:

```md
2. **Ordinary data persistence goes through `json-store.ts`** — atomic write, `.bak` rotation for the CRITICAL set, per-file locks, and the shared persistence barrier. Concurrent read-modify-writes go through `updateJsonFile`. The sole exception is `/api/import`'s prevalidated whole-tree restore: it stages complete directories and swaps them under exclusive barrier access so exact-snapshot recovery can remove absent files. No other route may write `data/` through raw `fs`.
```

- [ ] **Step 2: Replace stale persistence and backup prose with the shipped contract**

In `docs/systems/01-sync-and-data.md`, replace the incomplete inline critical list with the 17-file table from the design spec. Add the five other recovery classes, Markdown atomicity, exact restore flow, fresh `.bak` behavior, barrier, confirmed/unconfirmed rollback distinction, and the accepted process/machine-crash window under `## Known rough edges`. Preserve all existing headings.

- [ ] **Step 3: Make FILE_INDEX the complete 23-store coverage table**

Update the `backup.ts`, `json-store.ts`, `kb-loader.ts`, and import-route rows. Add a `Recovery class` column to the data-files table, add missing `workout-library.json`, mark the six newly critical files with `.bak` ✅, and label generation gate `fail-closed`, AI usage `telemetry`, and the remaining stores `regenerable` or `critical` exactly as the design table specifies.

- [ ] **Step 4: Update recovery recipes and feature copy**

In `docs/RECIPES.md`, state that import is exact replacement, the source backup must be retained, invalid bundles change nothing, ordinary failures roll back when recovery is confirmed, and a process/machine crash during swaps may require manual re-import. In `FEATURES.md`, replace the existing restore claim with:

```md
- **Validated exact-snapshot backup and restore** — export captures all local JSON state and athlete-authored Markdown; restore accepts only the current version-1 format, validates the whole bundle before mutation, replaces both trees through staged swaps, and rolls ordinary failures back. Automatic snapshots remain optional; a process or machine loss during the final two-root swap is an explicit manual-recovery risk.
```

- [ ] **Step 5: Close FR-2 without renumbering it**

Move FR-2's open roadmap record to a dated `ARCHIVE.md` entry that names the exact-snapshot contract, 17-store coverage, tests, and accepted crash risk. Update ROADMAP state and FR-3 so FR-3 remains blocked only on FR-1. Keep the literal `FR-2` identifier searchable and do not renumber any package.

Stamp the design spec `**Status:** Shipped on 2026-08-28` if implementation completes in this session; otherwise use the actual local completion date.

- [ ] **Step 6: Verify docs and the full repository**

Run: `npm run check`

Expected: TypeScript, lint, all Vitest suites, workflow tests, sync tests, and link checks pass with no warnings.

- [ ] **Step 7: Commit Task 6**

```bash
git add docs/INVARIANTS.md docs/systems/01-sync-and-data.md docs/FILE_INDEX.md docs/RECIPES.md FEATURES.md ROADMAP.md ARCHIVE.md docs/superpowers/specs/2026-08-28-fr2-restore-and-critical-state-honesty-design.md
git commit -m "docs: close FR-2 recovery honesty"
```

---

## Final verification and sanctioned handoff

- [ ] Run focused tests once more:

```bash
npx vitest run lib/persistence-gate.test.ts lib/json-store.test.ts lib/data-store.test.ts lib/kb-loader.test.ts lib/backup.test.ts app/api/import/route.test.ts app/api/sync/route.test.ts components/BackupRestore.test.tsx
```

- [ ] Run `npm run check` and record the pristine output in the implementation report.
- [ ] Use the repository `code-review` skill for one whole-branch skeptical review; fix substantive findings and rerun affected tests.
- [ ] Finish only through `npm run finish:agent-task`; do not manually push or create a PR.
