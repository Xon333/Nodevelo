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

**Consequences.** `lib/coach-snapshot.ts` remains the resolved Today UI/state bundle, while deterministic generation reuses its signal resolver without prompt formatting. Active ride-analysis and retrospective prompt builders are pure/offline-testable. The retrospective schema's own comment states the contract: "the math/validation stay in TS; the model only phrases." Historical prompt-assembly costs were removed from generation by FR-5.

**Amendment (2026-08-30, FR-5).** Block generation no longer uses an LLM. `compileTrainingBlock` owns session selection, progression, canonical workout syntax, overview, and publication eligibility. Claude remains only for optional ride-analysis and retrospective language; the old prompt/table/tool-schema consequences above are historical.

---

## ADR-0003 · Generation proposes; write commits

**Context.** A generation can fail, disappoint, or be regenerated several times. Persisting or pushing calendar events on generate would corrupt state and burn Intervals.icu writes on plans the athlete never accepted.

**Decision.** `POST /api/generate` returns a `GeneratedPlan` and persists only the CAS-guarded season re-plan and the best-effort publication-passport verdict record (`data/generation-gate.json`), both after success. Acceptance is explicit: `POST /api/write` pushes calendar events (idempotent upserts, rollback on partial failure), archives the old block's lived days, records interventions, then writes `current-block.json`.

**Consequences.** Regeneration is free and safe. The write route carries the transactional complexity (snapshot → upsert → rollback-or-archive → CAS write → stale-event cleanup). Docs/tools must never assume "generate created the block."

---

## ADR-0004 · Validators warn — they don't rewrite

**Context.** Post-generation checks (protocol bands, spacing, taper, week hours, sequencing, season fit) could silently "fix" the model's plan — but silent mutation destroys the athlete's ability to judge the coach, and a rewrite can be wronger than the warning.

**Decision.** All plan validators append to `warnings[]` and never alter the schedule. Exactly two sanctioned mutations exist, both deterministic and visible: `reconcileDurationMin` (stated duration ↔ true step-sum) and `repairNutrition` (kcal rewritten to the formula's own value, recorded in `repairs`). The narrative critic may rewrite **overview prose** only, never the schedule. (Since 2026-08-23, findings additionally get a publication-time severity classification in one place — see ADR-0015 — but classification is not mutation; this decision's warn-only contract stands.)

**Consequences.** Bad plans surface as informed choices, not silent edits. A structurally invalid tool response is a hard 502 with manual retry — deliberately no self-repair loop for structure. New validators must follow the warn-only contract or argue an ADR change.

**Amendment (2026-08-27).** The narrative critic was removed. `lib/overview-check.ts` now appends deterministic warnings and never rewrites prose; the two repairs above remain the only sanctioned mutations.

**Amendment (2026-08-30, FR-5).** New plans are compiled directly from typed prescriptions, so neither repair is in the active generation path. Generated cycling workouts must render/parse with semantic equality before the warn-only publication gate runs.

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

**Decision.** (a) The system prompt was split `{cached, dynamic}`: the stable prefix (persona + syntax guide + KB) carried `cache_control: ephemeral`; all per-block context followed the breakpoint. A dedicated test enforced that partition. (b) Structured output used forced tool-use (`tool_choice: {type: "tool"}`) against a zod-derived plan schema via the single `tool-schema.ts` bridge; the regex parser (`plan-parser.parsePlan`) was retired. (c) The plan schema declared `weeks` before `overview` so the model committed the schedule before summarizing it.

**Consequences.** Cache economics are real (writes 1.25×, reads 0.1× — tracked in `ai-usage.ts`) and KB edits invalidate the cache by design (fresh knowledge wins). Parsing failures became typed zod errors with a truncation-vs-malformed distinction. Every tool schema lives in one of three known files; field order is load-bearing and must survive schema edits.

**Superseded for block generation (2026-08-30, FR-5).** The block prompt, cache split, forced plan tool, and `PlanToolSchema` were deleted. `retrospective-schema.ts` still uses forced tool output for optional structured reflections; `tool-schema.ts` remains its shared bridge. Historical usage rows and this decision stay as the record of the replaced design.

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
- **pgvector RAG for the knowledge base** — deterministic generation no longer consumes the markdown corpus, so retrieval adds no planning value. Revisit only if a separately approved language/search feature needs semantic retrieval.
- **RxDB reactive-DB rewrite** — contradicts local-first JSON (ADR-0001); the desync it targeted is fixed with refetch-on-sync.
- **SQLite (`better-sqlite3` + Drizzle + `sqlite-vec`) — deferred, not rejected.** Wins are mostly theoretical at single-user scale and its standout unlock (`sqlite-vec`) is gated on semantic RAG (also deferred). Reconsider when semantic RAG is committed or data volume/multi-user justifies it.
- **uPlot / canvas charting** — `buildRideTrace` ([02-scoring-and-learning](systems/02-scoring-and-learning.md)) already downsamples to ~240 points; no chart renders raw 1 Hz data.
- **Cytoscape / knowledge-graph UI** — a heavyweight dependency re-presenting data the app already has.
- **Post-ride structured survey** — RPE/feel already syncs from Intervals.icu (`icu_rpe`); a second manual survey would duplicate a signal that's already objective-adjacent.
- **Subjective-wellness morning sync** — removed 2026-06-26 (latent/dead, un-utilitarian); a wearable gives strictly better objective morning-readiness ([03-daily-loop](systems/03-daily-loop.md)). Spec: `docs/superpowers/specs/2026-06-26-remove-subjective-wellness-manual-flag-design.md`.
- **Hard-failing skeleton conformance on day one — deferred, then taken (ADR-0013 staged it; ADR-0015 resolved it).** A skeleton too rigid on its first real outing would have turned every generation into a 502, so it shipped warn-only; once real generations showed compliance AND findings gained teeth via the publication gate, conformance breaches became blockers (2026-08-23).

**Consequences.** New proposals matching an entry above get a fast, evidence-based no instead of a re-debate. Append new rejections here rather than scattering them across other docs.

---

## ADR-0013 · Composition moves to a deterministic day-slot skeleton; content stays with the LLM

**Context.** ADR-0002 gave deterministic engines the numbers and left the LLM "arrangement and phrasing" — but arrangement turned out to include which day carries which session type and how long it runs, and the model was bad at exactly that. A live-reviewed block's "recovery" week cut volume ~19% against a mandated ~40% and kept all three quality types, merely trimmed (the season tripwire firing, [05-season.md](systems/05-season.md#known-rough-edges)), and loading weeks separately undershot their hour target by 0.5–1.1h because the model had to solve a 7-day allocation problem from a single weekly figure.

**Decision.** `block-skeleton.computeBlockSkeleton` allocates seven typed day-slots per week — session kind, allowed types, a duration envelope, an intensity ceiling — whose nominal durations sum exactly to the week's target by construction. `formatBlockSkeleton` renders it as a per-day table that supersedes the bare hour figure in the prompt; `validateSkeletonConformance` checks what the model actually returned against it. The LLM keeps authoring interval prescriptions, the exact duration inside each envelope, and all prose — composition moved because it was wrong; content stayed because it was right.

**Consequences.** Recovery-week composition and per-week hour targets are now guaranteed by TypeScript rather than requested in prose (measured: loading weeks went from 1/4 inside a 30-min tolerance to 3/4 on the first live run). Two real prescription changes ride along, deliberately: a recovery week's long ride now scales down by the same retention fraction as the rest of the week (180→108 min at default settings) instead of staying full-length, and quality-session envelopes are sized per session type rather than a flat figure (a 5×30s SIT protocol is genuinely ~55 min and cannot fill a flat 75-min slot without artificial padding). Skeleton conformance shipped warn-only, deferred from a hard-fail (above); that staging has since resolved through the publication gate — conformance findings are blockers ([ADR-0015](#adr-0015--the-publication-gate-persists-the-verdict-at-generation-time-and-write-matches-it)). Details, traps, and open items: [06-generation.md § Known rough edges](systems/06-generation.md#known-rough-edges).

---

## ADR-0014 · Reciprocal agent review gates integration

**Status.** Implemented 2026-08-22.

**Context.** Codex and opencode ox alpha can both plan and implement NodeVelo work, but self-review weakens the integration gate and the repository currently identifies only `codex/*` implementation branches. Joint planning is sometimes valuable, but making it mandatory would add ceremony to small, already-clear tasks. The existing docs also disagree about whether `finish:agent-task` is the only integration path or ox should merge directly with `gh`.

**Decision.** Implementation uses isolated `codex/*` or `ox/*` branches. The non-writing agent reviews the current PR head against repository standards/invariants, the originating issue or spec, and verification evidence; approval is a structured PR comment tied to that head SHA, so a new commit requires fresh review. One sanctioned merge helper accepts either that reciprocal approval or an explicit, PR-scoped user merge override recorded on the PR, requires green checks, and squash-merges. Joint planning remains optional: when the user requests it, the receiving agent drafts one GitHub issue/spec, the other agent edits or comments there, and unresolved product or architecture choices return to the user. Independent tickets may run concurrently only when their files are disjoint and neither blocks the other.

**Consequences.** Either agent may plan or write, but never approve its own implementation. Review evidence is auditable and cannot silently survive later commits; the user retains an explicit fast path. `start-agent-task` supports `ox/*`, `finish-agent-task` records the writer and stops, and `merge-agent-task` owns review/override recording, required-check validation, and squash merge.

---

## ADR-0015 · The publication gate persists the verdict at generation time, and write matches it

**Status.** Implemented 2026-08-23.

**Context.** Generation's validators were warn-only: a plan full of red protocol violations and structural hazards published with one click, zero confirmation. The original fix shape — re-run the validators inside `/api/write` — has a hidden trap: the validators read live context (score log, season plan, block settings) that legitimately moves between generate and publish. A plan unchanged since the athlete reviewed it would fail at commit time against data that drifted underneath it — a false blocker on exactly the plan the athlete already saw. Separately, `validateSkeletonConformance`'s severity had been *staged* (warn-only until real runs showed the model complies, [06-generation.md § Known rough edges](systems/06-generation.md#known-rough-edges)); that evidence existed but escalation was meaningless while findings were ignorable warnings.

**Decision.** One pure classifier (`lib/publication-gate.evaluatePublicationGate`) runs every validator **exactly once** and buckets each finding by its emitter into `blockers` (publication refused; no override exists), `preferences` (publishable only via an explicit informed override, stamped as provenance onto `CurrentBlock.publicationOverride`), and `advisories` (informational). Severity is never derived by parsing message strings — validators keep sole ownership of their facts ([INVARIANTS #33](INVARIANTS.md)). `/api/generate` persists the classified verdict server-side (`data/generation-gate.json`, single slot, keyed by `sha256(canonical({days, blockParams}))` over the post-repair days); `/api/write` does not recompute — it matches the submitted plan against that record and refuses anything else with 422, blockers outright, preferences without acknowledgment with `overrideRequired`. All refusals return before any calendar mutation or local write. The staged decision is resolved: skeleton-conformance findings are now blockers.

The one per-finding exception to hard-blocking: with ≥3 configured quality sessions per loading week, the day-slot skeleton's canonical placement is best-effort and can produce back-to-back hard days **by design** — regeneration cannot beat a deterministic placement limit — so adjacency degrades to a preference (informed override) instead of a blocker. Decided in the classifier by emitter + settings; at the default budget it stays a blocker.

**Consequences.** Publication is server-authoritative without write-time revalidation drift; regeneration is the only remedy for blockers. Cost: the verdict is a single slot — generating plan B invalidates plan A's passport (deliberate: latest-wins). Known soft edge, accepted and documented: the hash envelope covers only `{days, blockParams}`, so plan-level fields outside it — chiefly the `overview` prose (plus the `seasonFocus`/`durabilityTemplate` provenance stamps) — are client-tamperable between preview and publish, and `/api/write` stamps them verbatim onto `current-block.json`. These carry no training numbers — every load, duration, and nutrition figure lives inside the hashed `days`/`blockParams` envelope or is recomputed deterministically at write time — so tampering can only deface prose the athlete themselves submits for their own calendar, never corrupt what gets scored or written to Intervals.icu. Revisit if any plan-level field ever becomes a scoring input.

---

## ADR-0016 · FR-1 falsifying evidence advances FR-5 ahead of Phase 2

**Status.** Accepted by owner 2026-08-28.

**Context.** FR-1's attended current-code synthetic generation produced the required evidence but a
blocked publication verdict: duration reconciliation left one loading week 33 minutes short, and
the deterministic skeleton's placement conflicted with the sequencing validator in two weeks.
Repeating paid generation before examining the authority boundary would ask the model to work
around deterministic constraints that FR-5 exists to audit. The roadmap originally gated FR-5 on
Phase 2 completion.

**Decision.** Close FR-1 as an evidence task and use its blocked result as input to FR-5. The owner
explicitly waives FR-5's Phase 2 entry gate for this sequencing only. FR-5 becomes the next READY
package; FR-3 is independently READY but deferred behind it, FR-4 remains blocked on FR-3 evidence,
and FR-6 remains blocked on the FR-5 baseline.

**Consequences.** This exception does not claim Phase 2 is complete, weaken or override publication
blockers, or turn the failed run into structural-validity evidence. FR-5 retains its original exit
evidence, including five consecutive structurally valid varied-input generations. The waiver changes
work order only; publication safety and downstream evidence gates remain intact.
