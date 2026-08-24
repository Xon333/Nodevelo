# 01 · Sync & data — how ride data enters and where everything lives

**Why this exists:** the whole loop starts here — Intervals.icu owns the athlete's physiological truth, and this layer pulls it in safely, reconciles it, and persists everything as crash-safe JSON on disk (the filesystem *is* the database — see [DECISIONS](../DECISIONS.md) ADR-0001). **Where it sits:** the pipeline's intake; everything downstream ([02-scoring](02-scoring-and-learning.md) onward) reads what this layer wrote. **Tradeoff:** crash-safety and concurrency had to be hand-built (atomic writes, locks, CAS) instead of inherited from a database.

Per-file inventory: [../FILE_INDEX.md](../FILE_INDEX.md#data-files).

## The read/write contract

`GET /api/sync` is **pure** — it returns cached app state and never hits Intervals.icu. `POST /api/sync` is the **only** path that fetches from Intervals.icu, reconciles, re-derives, and persists. Page loads stay instant; every network call is explicit and athlete-triggered (or gated by `autoSyncOnOpen`).

**The window:** a full sync pulls **182 days** of activities/wellness — deliberate depth (CTL has a 42-day time constant; baselines are 90-day; the learning loop wants several blocks of history) and cheap (a wider window is a longer JSON list, not more requests — per-activity stream fetches happen only for *today's* ride). The generation prompt's "last 8 weeks" summary is scoped to 56 days regardless, so plans anchor to current form, not the whole cache.

## The persistence substrate (`lib/json-store.ts`)

Four mechanisms, all load-bearing (hardened by ~25 hostile-review fixes, HR-31..59):

1. **Atomic write**: serialize → `<file>.tmp` → fsync → `rename()` (POSIX atomic). A crash can never produce truncated JSON. `updateJsonFile` skips the write entirely when `mutate` hands back the exact same reference it was given (a CAS no-op, or a `wrote: false` resolver path) — nothing changed, nothing to persist.
2. **`.bak` rotation** — only for the `CRITICAL` set (score-log, intervention-log, physiology, current-block, block-history, athlete, block-settings, dispositions): current live content is copied to `.bak` before each write, *skipped if the live file doesn't parse* (a good `.bak` is never clobbered by corruption). Derived stores (baselines, calibration, quirks, ai-usage) get atomic writes but no `.bak` — they're re-derived on the next sync.
3. **Recovery on read** (`readJsonFileWithStatus`): live → `.bak` → caller default, distinguishing "never written" (ENOENT) from corruption (`corruptFallback`) — self-healing callers refuse to persist a fallback born from double-corruption.
4. **Per-file locking** (`withFileLock`): a promise chain serializes same-file operations; `updateJsonFile` reads *inside* the lock → genuinely transactional read-modify-write. This is what closes the sync-vs-disposition lost-update races.

`lib/data-store.ts` layers typed `read*/write*/update*` accessors on top, stamping `updatedAt` and shape-merging drifted files over defaults (`shapeMergeProfile` etc.) so an old file can't crash readers.

**Rules:** new persisted stores go through json-store, never raw `fs`. New migration flags use **truthy checks, not `=== null`** (pre-existing files parse back as `undefined`). Concurrent mutations of the same store go through `updateJsonFile`, not read-then-write.

## Sync flow (`POST /api/sync`, 905 lines — the orchestrator)

```mermaid
flowchart TD
  UI[SyncProvider.doSync - sends browser local date] --> SYNC[POST /api/sync]
  SYNC --> FETCH[intervals-api.runFullSync: 182-day window\nactivities + wellness + both power curves, parallel]
  FETCH --> GUARD{isSuspectEmptySync?}
  GUARD -->|"empty when previous had data"| REFUSE[502 — keep previous data]
  GUARD -->|ok| LS[(last-sync.json)]
  LS --> P[physiology.reconcile vs sport settings → physiology.json]
  LS --> B[rolling baselines → rolling-baselines.json]
  LS --> C[calibration re-derive → calibration.json]
  LS --> Q[quirks extraction → athlete-quirks.json]
  LS --> IN[calendar-mirror.reconcileInboundMoves\n(athlete moved an event on Intervals.icu)]
  LS --> SCORE[score-log.buildRideScores + backfill → score-log.json]
  SCORE --> EX[backfillExecutionOntoDays → current-block + history]
  SCORE --> IV[intervention.validateInterventions → intervention-log.json]
  LS --> T{ride today?}
  T -->|yes| TA[ride-analysis.buildTodayAnalysis → today-analysis.json\nresponse: analysisPending=true]
  TA --> AN[client then POSTs /api/analyze → LLM coach note]
  LS --> BK[backup.snapshotBackup → NODEVELO_BACKUP_DIR, best-effort, keeps 14]
```

Safety properties worth knowing: every Intervals.icu request has a 20s abort timeout; the all-time power curve merges **monotonically** so a partial fetch can't false-report a PR drop; a suspect-empty sync is refused, not written; the LLM step is deferred to `/api/analyze` so sync stays fast and an Anthropic hiccup is isolated ([ADR-0005](../DECISIONS.md)).

### Physiology freshness

Physiology is tracked in two files on purpose: `physiology.json` holds the effective-dated snapshot, while `physiology-status.json` holds sync bookkeeping plus the athlete's obsolete marker. That split keeps the last confirmed date available even when the latest check fails.

`lib/physiology-freshness.ts` reduces those files plus "today" to one of seven states. The table below is the ship-time contract for both the profile panel and the generation gate.

| State | Meaning | Athlete tone | Generation |
|---|---|---|---|
| `fresh` | Recent confirmation and a consistent current snapshot | ok | allowed |
| `sync-failed` | The latest physiology check failed, but the last confirmed values are still recent | warn | allowed |
| `stale` | The last confirmation is too old, or freshness tracking never recorded one | warn | allowed |
| `obsolete` | The athlete marked physiology obsolete | block | blocked |
| `inconsistent` | The current snapshot fails self-consistency checks | block | blocked |
| `malformed` | The physiology store or freshness file is unreadable or unusable | block | blocked |
| `missing` | No usable physiology store exists yet | block | blocked |

Only `sync-failed` and `stale` warn; `fresh` allows generation, while `missing`, `malformed`, `inconsistent`, and `obsolete` hard-block it. That is deliberate: generation can keep using the last confirmed physiology when the latest sync merely failed, but it must stop when the store is missing, malformed, inconsistent, or explicitly obsolete. See the accepted adversarial review's physiology-ownership rationale in [Intervals.icu ownership, privacy, and recovery](../reviews/2026-08-20-nodevelo-adversarial-investment-review.md#intervalsicu-ownership-privacy-and-recovery).

## Calendar mirror (`lib/calendar-mirror.ts`)

Invariant: **one NodeVelo-owned event per block date**, keyed `external_id = nodevelo-<date>` (idempotent upserts), tracked via `CurrentBlockDay.eventId`.

- **Outbound** (reschedule, morning-check downgrade, block write): `persistMirroredMove` commits the local move first, then best-effort mirrors — a mirror failure is surfaced, never rolled back. Moved events carry their original description forward (it lives only on the calendar).
- **Inbound** (during sync): `reconcileInboundMoves` detects athlete-initiated moves made directly on Intervals.icu and reconciles them **before scoring**. Deliberately conservative: future-only, single moves onto rest/empty days only; a pairwise swap or vanished event surfaces as a warning, never an automatic delete.
- **Block write** (`/api/write`): snapshot old descriptions → upsert every day → on any failure, roll back created events; on success archive lived days, CAS-write `current-block.json`, delete orphaned future events of the replaced block.

## Concurrency guards

Every block-mutating route (`write`, `sync` DELETE, `reschedule`, `retrospective`) uses compare-and-swap on the block's `createdAt` (`lib/block-version.ts` → 409). Known accepted exception: `/api/morning-check` PUT (same-day scope, documented in code).

The version token is `CurrentBlock.createdAt` itself, not a dedicated version/etag field — cheap and sufficient in practice, but a manual edit to `current-block.json` (e.g. via a backup restore) that doesn't touch `createdAt` wouldn't be detected as "changed." Unlikely in practice, worth knowing before debugging a stale-write mystery.

## Cross-cutting

- **CSRF** (`lib/csrf.ts` via root `proxy.ts` — Next 16's renamed middleware): same-origin guard on all `/api/*` writes. This is the app's **only** request-level defense — there is no auth; the app binds to localhost.
- **Backup**: `/api/export` (bundle download: all `data/*.json` + `knowledge-base/**/*.md`), `/api/import` (path-traversal-guarded restore through json-store), `snapshotBackup` auto-snapshots on sync when `NODEVELO_BACKUP_DIR` is set.
- **Logging**: `lib/log.ts` — one JSON line per error/warn with `{route, step, status}`; no framework.
- **Client fetch**: `lib/client-api.ts` (`api<T>()` unwraps `{error}` payloads into thrown Errors).

## Known rough edges

- `block-settings.json` / `loading-log.json` may not exist — code falls back to defaults until first write (this is the migration-flag `undefined` case in the wild).
- `score-log.json.pre-rebuild-<epoch>.bak` — a **manual** pre-migration snapshot; no code writes this pattern.
- `data/*.md` don't exist — the markdown corpus lives in `knowledge-base*/` ([04-knowledge.md](04-knowledge.md)).

## Common modifications

| Change | Where |
|---|---|
| New persisted store | `lib/data-store.ts` + `json-store.ts` — decide CRITICAL (`.bak`) or derived |
| New sync pipeline stage | `app/api/sync/route.ts`; extract pure logic into `lib/` for testability |
| Calendar behavior | `lib/calendar-mirror.ts` |
