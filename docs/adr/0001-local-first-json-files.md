# ADR-0001 · Local-first JSON files, no database

**Context.** Single athlete, single machine, no multi-user requirements. The data is small (caps: 400 ledger entries, 200 block-history entries) and the athlete must be able to read, back up, and hand-edit their own state.

**Decision.** All state lives as JSON files in `data/` (and markdown in `knowledge-base/`), accessed through `lib/json-store.ts` (atomic tmp+rename writes, `.bak` rotation for critical stores, per-file promise-chain locks) with typed accessors in `lib/data-store.ts`. No ORM, no SQLite, no external store.

**Consequences.** Crash-safety and lost-update prevention had to be built by hand — and were, across ~25 hostile-review fixes (HR-31..59): transactional `updateJsonFile`, corruption-aware recovery, CAS guards. Everything assumes **single-process** (locks and dedupe are in-memory). Backup/restore is a file-bundle concern (`/api/export`, `/api/import`, auto-snapshots). Third-party DB abstractions are explicitly out (CLAUDE.md).
