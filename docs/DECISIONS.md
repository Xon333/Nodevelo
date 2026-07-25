# Decisions

Why NodeVelo is built the way it is — standing architectural decisions in one scrollable file (recorded retrospectively 2026-07-25 from code, commits, and ARCHIVE closeouts). Each: context → decision → consequences. The *how* lives in [systems/](systems/); this file is the *why*. New decision? Append the next ADR number in the same shape.

## ADR-0001 · Local-first JSON files, no database

**Context.** Single athlete, single machine, no multi-user requirements. The data is small (caps: 400 ledger entries, 200 block-history entries) and the athlete must be able to read, back up, and hand-edit their own state.

**Decision.** All state lives as JSON files in `data/` (and markdown in `knowledge-base/`), accessed through `lib/json-store.ts` (atomic tmp+rename writes, `.bak` rotation for critical stores, per-file promise-chain locks) with typed accessors in `lib/data-store.ts`. No ORM, no SQLite, no external store.

**Consequences.** Crash-safety and lost-update prevention had to be built by hand — and were, across ~25 hostile-review fixes (HR-31..59): transactional `updateJsonFile`, corruption-aware recovery, CAS guards. Everything assumes **single-process** (locks and dedupe are in-memory). Backup/restore is a file-bundle concern (`/api/export`, `/api/import`, auto-snapshots). Third-party DB abstractions are explicitly out (CLAUDE.md).

---

## ADR-0002 · Deterministic numbers; the LLM only arranges and phrases

**Context.** LLMs confabulate numbers. A coach whose figures can't be trusted teaches the athlete to ignore it.

**Decision.** Every number — nutrition targets, week hours, zones, readiness, execution scores, calibration values — is computed by TypeScript engines. The model receives them as facts (the nutrition reference table it must *copy from*, the coach snapshot, exact week targets) and contributes only session arrangement and prose. Post-hoc, deterministic checks verify the model respected the numbers (`nutrition-validate` even auto-repairs the kcal figure it copied wrong).

**Consequences.** `lib/coach-snapshot.ts` exists so all LLM surfaces read *one* resolved bundle and can't disagree. Prompt builders are pure/offline-testable. The retrospective schema's own comment states the contract: "the math/validation stay in TS; the model only phrases." Cost: large prompt-assembly code and the three-copy protocol-band sync burden ([INVARIANTS #17](INVARIANTS.md)).

---

## ADR-0003 · Generation proposes; write commits

**Context.** A generation can fail, disappoint, or be regenerated several times. Persisting or pushing calendar events on generate would corrupt state and burn Intervals.icu writes on plans the athlete never accepted.

**Decision.** `POST /api/generate` returns a `GeneratedPlan` and persists nothing (except the season re-plan, CAS-guarded, only after success — HR-58). Acceptance is explicit: `POST /api/write` pushes calendar events (idempotent upserts, rollback on partial failure), archives the old block's lived days, records interventions, then writes `current-block.json`.

**Consequences.** Regeneration is free and safe. The write route carries the transactional complexity (snapshot → upsert → rollback-or-archive → CAS write → stale-event cleanup). Docs/tools must never assume "generate created the block."

---

## ADR-0004 · Validators warn — they don't rewrite

**Context.** Post-generation checks (protocol bands, spacing, taper, week hours, sequencing, season fit) could silently "fix" the model's plan — but silent mutation destroys the athlete's ability to judge the coach, and a rewrite can be wronger than the warning.

**Decision.** All plan validators append to `warnings[]` (quality-type protocol breaches surface separately as `protocolViolations`) and never alter the schedule. Exactly two sanctioned mutations exist, both deterministic and visible: `reconcileDurationMin` (stated duration ↔ true step-sum) and `repairNutrition` (kcal rewritten to the formula's own value, recorded in `repairs`). The narrative critic may rewrite **overview prose** only, never the schedule.

**Consequences.** Bad plans surface as informed choices, not silent edits. A structurally invalid tool response is a hard 502 with manual retry — deliberately no self-repair loop for structure. New validators must follow the warn-only contract or argue an ADR change.

---

## ADR-0005 · Fast sync; deferred LLM analysis

**Context.** Sync must be quick and reliable — it's the app's heartbeat. An Anthropic timeout inside sync would hold every store update hostage to a third-party API.

**Decision.** `POST /api/sync` computes everything deterministic (scores, zones, PRs, interval match) and writes `today-analysis.json` without a coach note, returning `analysisPending: true`. The client then calls `POST /api/analyze`, which makes the one LLM call and writes the note back (idempotent; `force` regenerates; optional auto-post to Intervals.icu).

**Consequences.** Sync latency is independent of Claude. An LLM failure degrades to "no note yet," not a failed sync. The client owns the follow-up trigger (re-entrancy-guarded in `SyncProvider`). Grep-for-LLM-callers naïvely flags `sync/route.ts` (it only imports the config check). Dev iteration on today's ride = `npm run reset:today` + re-sync.

---

## ADR-0006 · Effective-dated physiology store

**Context.** FTP and zones change over a season. Scoring a June ride against September's FTP silently rewrites history; so does re-deriving old scores after a zone update.

**Decision.** `lib/physiology.ts` keeps an effective-dated history (`data/physiology.json`), reconciled from Intervals.icu sport settings on each sync. Consumers resolve values *as of a date* (`physiologyAsOf`); the ledger additionally freezes `ftpUsed` onto each entry at scoring time.

**Consequences.** Past rides stay judged by the rules that were live then — the ledger's immutability (ADR-0007, below) is meaningful because its inputs are pinned too. `physiology.json` is the FTP/zones source of truth; `athlete.json`'s performance numbers are an overlay at read time, and the KB markdown is prose, not the source.

---

## ADR-0007 · Append-only execution ledger with provenance stamps

**Context.** The learning loop (athlete model, calibration, interventions) is only honest if its evidence can't shift under it. If improving the scorer retro-scored history, every trend would be an artifact of the latest code.

**Decision.** `data/score-log.json` is append-only: one entry per date, frozen once the day passes, stamped with the exact inputs used (see [02-scoring-and-learning](systems/02-scoring-and-learning.md) § The ledger). Scoring changes apply forward. Named invariants LEDGER-1 (a rebuild can never un-plan a frozen entry) and LEDGER-2 (append-only merge) are enforced in `score-log.ts`; the one-shot corrective rebuild is gated by `data/ledger-rebuild.json` (truthy check) and was run once, with a manual pre-rebuild snapshot kept on disk.

**Consequences.** Trends are comparable across scorer versions; "compromised" dispositions exclude entries from teaching without erasing them. Cost: schema evolution needs idempotent backfills (`sync-ledger.ts`) instead of rewrites, and old entries carry old logic's scores forever — by design.

---

## ADR-0008 · Prompt-cache split + forced tool use

**Context.** Block generation ships a huge prompt (full KB + syntax guide + per-block context) on every call; and free-text plan output required a brittle regex parser.

**Decision.** (a) The system prompt is split `{cached, dynamic}`: the stable prefix (persona + syntax guide + KB) carries `cache_control: ephemeral`; all per-block context goes after the breakpoint. `system-prompt.test.ts` is the executable contract that per-block data never enters the cached half. (b) Structured output is forced tool-use (`tool_choice: {type: "tool"}`) against zod-derived schemas via the single `tool-schema.ts` bridge; the regex parser (`plan-parser.parsePlan`) is retired. (c) `PlanToolSchema` declares `weeks` before `overview` so the model commits the schedule before summarizing it.

**Consequences.** Cache economics are real (writes 1.25×, reads 0.1× — tracked in `ai-usage.ts`) and KB edits invalidate the cache by design (fresh knowledge wins). Parsing failures became typed zod errors with a truncation-vs-malformed distinction. Every tool schema lives in one of three known files; field order is load-bearing and must survive schema edits.

---

## ADR-0009 · Flat `lib/` with colocated tests

**Context.** The engine layer grew to ~68 modules. Deep folder taxonomies force premature categorization and constant re-filing as concepts evolve; colocated tests keep the contract next to the code.

**Decision.** `lib/` stays flat; every module ships `<name>.test.ts` beside it (only `types.ts`, `workout-types.ts`, `tool-schema.ts`, `block-version.ts`, `client-api.ts` go without). Modules stay small and single-purpose; big routes extract pure logic into lib for testability (`ride-analysis.ts` is the pattern). Naming leans on suffix families (`-validate`, `-schema`, `-api`, `-store`, `-score`) rather than folders.

**Consequences.** Discovery relies on naming + documentation instead of hierarchy — which is why [FILE_INDEX.md](FILE_INDEX.md) and the [glossary's naming traps](GLOSSARY.md#naming-traps) exist and must stay current. The flat listing makes the two look-alike pairs (`durability*`, `athlete-*`) and the two misleading names (`loading`, `trace`) everyone's problem; the docs, not restructuring, carry that load.

---

## ADR-0010 · Calibration precedence: override > derived > default

**Context.** Sports-science constants (ACWR bands, TSB edges, decoupling cutoffs, carb optima) are population averages. Personalizing them from the athlete's own data is the app's keystone — but a naive fit calibrates to habit ("you always fail threshold at TSB −20, so −20 must be fine") or to noise.

**Decision.** One precedence rule, implemented once (`calibration.trustedCalibration`): **manual override** (athlete says so) beats **derived** (only when the ledger honestly *discriminates* — the derived edge must separate failures from successes by a margin, via `correlation.ts`'s guarded derivers) beats **population default**. Non-discriminating signals fall back to the default rather than pretending. Import direction is one-way: calibration consumes correlation, never the reverse.

**Consequences.** Every calibrated parameter carries confidence/provenance and is contestable in the UI (`CalibrationPanel`). New "magic numbers" should enter as calibratable parameters through this path, not as fresh literals. The derivations re-run on each sync from the frozen ledger (ADR-0007, above), so they're reproducible.

---

## ADR-0011 · Design tooling stays workflow-level, DESIGN.md is canonical

**Context.** External design tooling (idea-kits, browser-verify MCP servers, a11y/quality skills) is useful for catching issues and proposing directions, but the app already has an opinionated, hand-tuned visual language ([DESIGN.md](../DESIGN.md)) — an external kit's generic suggestion could quietly drag the UI toward a templated default.

**Decision.** Design tooling is adopted **workflow-level only** — it never becomes an app runtime dependency. **Source-of-truth rule:** DESIGN.md is canonical; external kits *propose*, DESIGN.md *disposes* — any conflicting token/aesthetic suggestion is rejected. **Revert trigger:** on request, drop the idea-kits from config; the app itself doesn't change, because nothing from them ever entered the app.

**Consequences.** Tooling can be added/removed freely without an app migration. A tool's suggestion is only ever a starting point for a DESIGN.md-conformant implementation, never applied verbatim.

---

## ADR-0012 · Rejected alternatives (a running log)

**Context.** Recurring proposals (a database, a vector store, a reactive-DB layer, various UI libraries) keep resurfacing without new evidence. A standing rejection log stops the re-litigation.

**Decision.** Each entry below was evaluated and rejected; revisit only on the stated trigger, not by default.

- **Postgres/Supabase + RLS · blob KB storage · auth middleware** — assumed a multi-tenant SaaS; NodeVelo is local-first single-user (ADR-0001), so `fs`/JSON *is* the store. Revisit only on a deliberate hosted pivot.
- **pgvector RAG for the knowledge base** — small markdown files fit cheaply in the prompt; the context-dump ([04-knowledge](systems/04-knowledge.md)) is intentional, not a scaling compromise.
- **RxDB reactive-DB rewrite** — contradicts local-first JSON (ADR-0001); the desync it targeted is fixed with refetch-on-sync.
- **SQLite (`better-sqlite3` + Drizzle + `sqlite-vec`) — deferred, not rejected.** Wins are mostly theoretical at single-user scale and its standout unlock (`sqlite-vec`) is gated on semantic RAG (also deferred). Reconsider when semantic RAG is committed or data volume/multi-user justifies it.
- **uPlot / canvas charting** — `buildRideTrace` ([02-scoring-and-learning](systems/02-scoring-and-learning.md)) already downsamples to ~240 points; no chart renders raw 1 Hz data.
- **Cytoscape / knowledge-graph UI** — a heavyweight dependency re-presenting data the app already has.
- **Post-ride structured survey** — RPE/feel already syncs from Intervals.icu (`icu_rpe`); a second manual survey would duplicate a signal that's already objective-adjacent.
- **Subjective-wellness morning sync** — removed 2026-06-26 (latent/dead, un-utilitarian); a wearable gives strictly better objective morning-readiness ([03-daily-loop](systems/03-daily-loop.md)). Spec: `docs/superpowers/specs/2026-06-26-remove-subjective-wellness-manual-flag-design.md`.

**Consequences.** New proposals matching an entry above get a fast, evidence-based no instead of a re-debate. Append new rejections here rather than scattering them across other docs.

