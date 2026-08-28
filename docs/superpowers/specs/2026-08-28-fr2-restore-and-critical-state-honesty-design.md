# FR-2 Restore and Critical-State Honesty Design

**Status:** Approved for implementation planning on 2026-08-28

## Purpose

NodeVelo backs up every `data/*.json` file and every `knowledge-base/**/*.md` file, but restore currently writes files one at a time, skips invalid or failed entries, and can report success after a partial restore. Knowledge-base writes also bypass the atomic write pattern used by JSON stores, and the documented `CRITICAL` set omits several athlete-owned or safety-relevant stores.

FR-2 makes the recovery promise precise: a valid version-1 backup replaces the current athlete-owned snapshot exactly; invalid bundles change nothing; ordinary filesystem failures roll back; and the UI and documentation state the remaining crash boundary without implying transactional guarantees NodeVelo does not have.

## Goals

- Restore only a fully valid NodeVelo backup with `version: 1`.
- Replace `data/` and `knowledge-base/` with the exact backup snapshot, removing managed files absent from the bundle.
- Stage complete replacement trees before changing live state.
- Roll back both live trees when an ordinary swap operation fails and rollback succeeds.
- Prevent same-process JSON or knowledge-base access from observing or mutating the swap window.
- Give every restored critical JSON file a fresh `.bak` containing the same restored value.
- Make knowledge-base and retrospective mutations atomic through temporary-file, `fsync`, and rename.
- Record a complete recovery classification for all persisted stores.
- Make API responses, Settings copy, runbooks, and feature claims match the real guarantee.

## Non-goals

- A database migration or general transaction engine.
- A durable restore journal or automatic recovery after process or machine loss during the final swaps.
- Multi-process coordination, hosted backup, authentication, or automatic off-machine configuration.
- Semantic validation of every historical store shape beyond the readers' existing shape-healing contracts.
- Restoring Intervals.icu calendar state; the bundle restores NodeVelo's local source of truth only.

## User-visible contract

Restore has exact-snapshot semantics:

1. The uploaded JSON must identify itself as a NodeVelo backup and use exactly `version: 1`.
2. The complete envelope and every entry are validated before live state is touched.
3. Files currently present under the managed `data/` or `knowledge-base/` trees but absent from the backup are removed by replacement of the complete trees.
4. An ordinary staging or swap failure either leaves the original snapshot unchanged or returns a distinct error saying recovery could not be confirmed.
5. Success is reported only after both replacement trees are live.
6. The uploaded backup file remains the recovery source. Restored `.bak` files mirror the restored critical JSON values; they are corruption fallbacks, not an undo of the restore.

The accepted limitation is explicit: without a durable journal, process or machine loss during a directory rename can leave a missing or mixed snapshot that requires manual recovery from the uploaded backup or retained swap directories.

## Bundle validation

Validation is pure and completes before any filesystem mutation. The envelope must be a plain object containing:

- `app: "nodevelo"`
- `kind: "backup"`
- `version: 1`
- an ISO timestamp string `exportedAt` accepted by `Date.parse`
- plain-object `data` and `knowledgeBase` maps

Every map value must be a string. Data paths must be flat `.json` filenames because `data-store.ts` owns a flat store. Knowledge-base paths may be nested and must end in `.md` so block retrospectives round-trip. Both path classes reject empty names, absolute paths, `.` or `..` segments, backslashes, NUL bytes, and any resolved path outside the intended root. Every JSON string must parse successfully. One invalid entry rejects the entire bundle; there is no `skipped` result.

Validation checks structure and parseability, not every store's evolving TypeScript shape. Existing read boundaries remain responsible for shape merging and compatibility with older version-1 snapshots.

## Restore architecture

`lib/backup.ts` remains the deep module that owns the bundle format, export collection, snapshots, validation, staging, and restore orchestration. The route calls one restore function and maps typed failures to HTTP responses. No class, factory, dependency, or transaction framework is added.

The service resolves the live data root at call time so `NODEVELO_DATA_DIR` remains testable and correct. Each staging and previous-tree directory is a unique sibling of its live root, keeping renames on the same filesystem.

### Staging

The service builds complete staging trees from the validated maps before acquiring exclusive persistence access:

- JSON strings are parsed and written in canonical pretty-printed form.
- Each critical JSON file also gets `<file>.bak` with identical bytes.
- Non-critical JSON gets no `.bak`.
- Missing critical files get neither a live file nor a `.bak`.
- Nested knowledge-base directories are created as needed.

Any staging failure removes only generated staging paths and leaves live state unchanged.

### Persistence barrier

A small in-process shared/exclusive barrier coordinates persistence:

- Normal JSON and knowledge-base reads and writes run as shared operations.
- Restore's live directory swaps run as one exclusive operation.
- A pending exclusive operation prevents new shared operations, waits for current ones to finish, then releases all waiters after commit or rollback.
- `updateJsonFile` uses private unlocked read helpers while already inside the barrier and per-file lock, avoiding nested-lock deadlocks.

This barrier matches NodeVelo's existing single-process assumption. It does not claim safety across multiple Node processes.

Export and automatic snapshot collection use exclusive access while reading both trees so a produced bundle is one consistent filesystem snapshot. The sync route keeps its existing best-effort snapshot behavior.

### Swap and rollback

The commit order is knowledge-base first, then data. This minimizes the harmful crash case: new history referring to missing retrospective Markdown is worse than temporarily having new Markdown beside old JSON.

For each root, the service records whether a live directory existed, renames it to its unique previous path, and promotes the staged directory to the live path. Every successful rename is recorded.

If any promotion fails, rollback unwinds successful operations in reverse order:

1. Move a promoted replacement out of the live path.
2. Restore the previous live directory when one existed.
3. Restore the originally absent state when no live directory existed.

Rollback success returns an ordinary restore failure that states the previous snapshot was put back. Rollback failure returns a separate unconfirmed-state error and retains all unique previous/staging paths for manual recovery. The implementation must never delete those paths after an unconfirmed rollback.

After both promotions succeed, the restore is committed. Cleanup of previous and unused staging paths is best-effort; cleanup failure is logged as a warning and never rolls back a committed restore.

## Persistence invariant exception

Ordinary per-file JSON persistence continues to go through `json-store.ts`. Validated whole-tree restore is the sole exception: it stages and swaps complete directories under the shared persistence barrier while reusing `json-store.ts`'s critical-file predicate. `docs/INVARIANTS.md` will state this narrow exception rather than weakening the normal rule.

Exact restore is likewise the sole destructive recovery exception to frozen-ledger mutation rules. Routine sync, rebuild, scoring, and migration behavior remains unchanged.

## Critical-state coverage

`CRITICAL` means loss changes a decision/safety state or erases athlete-owned input that normal sync cannot honestly reconstruct. These files receive one-deep `.bak` rotation during normal writes and a matching fresh `.bak` during restore.

| Recovery class | Stores | Reason |
|---|---|---|
| Critical, already protected | `athlete.json`, `physiology.json`, `physiology-status.json`, `current-block.json`, `block-history.json`, `block-settings.json`, `score-log.json`, `intent-overlays.json`, `dispositions.json`, `intervention-log.json`, `workout-library.json` | Athlete input, frozen ledgers/history, safety assertions, active plans, or reviewed decisions |
| Critical, add protection | `ledger-rebuild.json`, `morning-check.json`, `loading-log.json`, `season-plan.json`, `calibration.json`, `weekly-envelope.json` | Destructive-operation guard; athlete flags/attributions/objectives/events/manual overrides; reduction-only midweek safety state |
| Regenerable | `last-sync.json`, `today-analysis.json`, `rolling-baselines.json`, `athlete-quirks.json` | Re-fetched or deterministically rebuilt from current upstream/local evidence |
| Fail-closed | `generation-gate.json` | Loss prevents publication until regeneration |
| Telemetry | `ai-usage.json` | Best-effort spend counters; loss does not alter coaching decisions |
| Athlete-authored Markdown | All `knowledge-base/**/*.md`, including retrospectives | Atomic per-file writes plus full snapshot recovery; no per-file `.bak` layer |

`workout-library.json`, currently absent from `docs/FILE_INDEX.md`, is added to the inventory. Stale source comments describing calibration as wholly derived or weekly-envelope as disposable are corrected.

## API and Settings behavior

`POST /api/import` becomes a thin boundary:

- malformed request JSON or bundle validation failure: `400 { error }`
- committed restore: `200 { ok: true, restored: number }`
- operational failure with confirmed rollback: `500 { error: "Restore failed. Your previous data was put back." }`
- failed or unconfirmed rollback: `500` with a distinct error instructing the athlete to keep the uploaded backup and retry/manual-recover; never claim unchanged state

The response no longer contains `skipped`.

The Settings confirmation states that restore replaces all current training data and knowledge-base files with the exact backup, removes files absent from it, validates before changes, and can be interrupted by process or machine loss during the final swap. The destructive action reads **Replace with backup**. Success reports the complete file count and reloads. Failure does not reload and never uses partial-success wording.

## Knowledge-base atomicity

`lib/kb-loader.ts` gets one private atomic Markdown writer reused by:

- `writeKnowledgeFile`
- `writeRetrospective`
- `markRetroSeedsApproved`

It writes a unique sibling temporary file, syncs the handle, closes it, and renames over the target. A failure before rename leaves the prior file intact; temporary cleanup is best-effort. No new general storage abstraction or Markdown `.bak` format is introduced.

## Test seams

Tests exercise public behavior, not private helpers:

- `validateBackupBundle` / `restoreBackupBundle`: strict envelope/version/map/path/content rejection; one invalid entry causes zero live mutation; nested Markdown accepted.
- Restore integration in temporary directories: exact removal of omitted files, nested retrospective round-trip, matching `.bak` for all critical restored JSON, none for non-critical JSON, initially missing roots, and successful cleanup.
- Injected filesystem operations at the restore seam: staging failure, each rename position, reverse rollback, rollback failure with retained recovery paths, and cleanup failure after commit.
- Persistence barrier: active shared work delays restore; restore blocks new JSON and knowledge-base access until both trees are committed or rolled back.
- `json-store`: table-driven `.bak` rotation and double-corrupt refusal across the complete critical list, plus representative non-critical files.
- `kb-loader`: atomic replacement and failure-before-rename preservation across the three mutation call sites.
- Import route: parse/validation mapping, success shape, confirmed-rollback error, and unconfirmed-state error.
- `BackupRestore`: exact-snapshot confirmation, success-only reload, and failure copy without partial-success language.

Focused verification runs the affected Vitest files, followed by `npm run check`. No live Anthropic smoke run is required because FR-2 changes no AI-backed path.

## Documentation and closeout

Implementation updates:

- `docs/systems/01-sync-and-data.md`: complete recovery table, exact restore flow, knowledge-base atomicity, barrier, and crash limitation.
- `docs/FILE_INDEX.md`: backup/import/kb-loader ownership and the complete 23-store recovery inventory.
- `docs/RECIPES.md`: exact restore instructions and recovery cautions.
- `docs/INVARIANTS.md`: narrow staged whole-tree restore exception.
- `FEATURES.md`: truthful validated exact-snapshot guarantee and limitation.
- `ROADMAP.md` / `ARCHIVE.md`: move FR-2 from open work to shipped history without renumbering the stable ID; FR-3 remains blocked on FR-1.

Headings referenced elsewhere remain unchanged; link verification is part of `npm run check`.

## Acceptance criteria

- No invalid version-1 bundle can mutate live data.
- Successful restore exactly matches both bundle maps and removes omitted managed state.
- All 17 critical JSON stores are classified in one code-owned list and receive correct `.bak` behavior.
- An injected ordinary swap failure restores both original trees byte-for-byte when rollback operations succeed.
- Rollback uncertainty is distinguishable and never reported as success or unchanged state.
- Same-process JSON and Markdown access cannot enter the swap window.
- Knowledge-base mutation failures before rename preserve the prior file.
- UI and documentation contain no `skipped`/partial-success promise and disclose the accepted crash window.
- Focused tests and `npm run check` pass.
