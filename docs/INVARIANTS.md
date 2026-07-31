# Invariants — what must never break

The contracts that hold NodeVelo together. Some are enforced by code/tests, some only by discipline. Breaking one usually won't fail a build — it corrupts trust, data, or money quietly.

## Data integrity

1. **The ledger is append-only.** Past `score-log.json` entries are frozen with their provenance stamps (FTP-used, calibration, fuel, form state). Only today's entry re-derives. LEDGER-1: a rebuild can never un-plan a frozen entry. LEDGER-2: normal merges never rewrite history. Scoring-logic changes apply forward, never retroactively. Diff check: `score-log.ts` merges must treat past dates as read-only; backfills in `sync-ledger.ts` must be idempotent (fixture: old entries + resync ⇒ byte-identical).
2. **All persistence goes through `json-store.ts`** — atomic write, `.bak` rotation for the CRITICAL set, per-file locks. Never raw `fs` for `data/`. Concurrent read-modify-writes go through `updateJsonFile` (reads inside the lock).
3. **Migration flags use truthy checks, never `=== null`.** A JSON file written before the field existed parses back as `undefined`. (Shipped-bug class; see AGENTS.md.)
4. **A corrupt live file's `.bak` is sacred** — rotation skips when live content doesn't parse; a fallback born from double-corruption is never persisted as truth.
5. **Suspect-empty syncs are refused.** Zero activities + zero wellness after a non-empty sync = upstream hiccup, keep previous data.
6. **The all-time power curve merges monotonically** — a partial fetch can't false-report a PR drop.

## Concurrency

7. **Block mutations are CAS-guarded** on `createdAt` (`block-version.ts` → 409). Accepted exception: morning-check PUT. New block-mutating routes must adopt the guard.
8. **Local commit before calendar mirror** (`persistMirroredMove`): the local move always lands; a mirror failure is surfaced, never rolled back.
9. **Calendar events are keyed `nodevelo-<date>`** — one owned event per block date; upserts are idempotent by design.

## Dates

10. **"Today" is the athlete's local day** — `localToday()`/`resolveToday()` from `lib/date.ts`; the client sends its local date to sync. Never inline `new Date().toISOString().slice(0,10)` for user-facing "today" (UTC drifts near midnight). Pure day-math may stay UTC-anchored.
11. **Form (TSB) is read from the prior day** — today's ride must never leak into "form going in".

## AI output shape

12. **Deterministic numbers, LLM phrasing.** The model never computes a training or nutrition figure; it copies from tables/snapshots the engines built ([DECISIONS](DECISIONS.md) ADR-0002).
13. **Validators warn; they don't rewrite.** The only sanctioned mutations: `reconcileDurationMin` and `repairNutrition` (visible `repairs` note). The narrative critic may rewrite the **overview prose** only.
14. **Per-block data never enters the cached system-prompt half** (`system-prompt.test.ts` is the executable contract).
15. **`weeks` stays declared before `overview`** in `PlanToolSchema` — field order forces the model to commit the schedule before summarizing it.

## AI provenance & cost

16. **Every AI artifact carries `model` + `promptVersion`.** Bump `PROMPT_VERSION` on structural prompt changes.
17. **The three-copy sync**: interval-protocol bands live in KB prose + `buildUserMessage` hard rules + `workout-validate.PROTOCOL`. A change to one is a change to all three.
18. **Model ids are duplicated** in `anthropic-api.ts` and `ai-usage.ts`'s PRICING keys; an unknown id silently records $0 cost.
19. **Changed AI paths get one live smoke run** before being called done (AGENTS.md).

## Architecture directions

20. **`correlation.ts` never imports `calibration.ts`** (calibration consumes correlation; reversing creates a cycle).
21. **Calibration precedence is exactly**: manual override > honestly-derived (must discriminate) > population default — all through `trustedCalibration`.
22. **Generation proposes; `/api/write` commits.** `/api/generate` persists nothing but the CAS-guarded season re-plan, and only after success.
23. **The sync route stays LLM-free** — the coach note is `/api/analyze`'s job (fast sync, isolated Anthropic failures).
24. **CSRF enforcement stays central** in `proxy.ts` — routes must not grow their own opt-outs.
25. **`compliance` is capped by execution** (`resolveCompliance`) — a badly-executed session can never report 100%.

## Documentation & repo process

26. **ROADMAP IDs (#1–4, §5–7, Track A–C) are stable handles** — append, never renumber; "decided against" records survive trims.
27. **`docs/superpowers/plans/` are immutable**; specs get a `Status:` stamp when shipped.
28. **CONTINUE.md is written only by `/handoff`.**
29. **Shared checkout, trunk-based**: stage only files you touched (never `git add -A`); an unexpected build error in a file you didn't edit is probably the other session mid-edit — check `git status --short <file>` before "fixing".
30. **Test fixtures avoid .x5 float boundaries** — pre-rounding values sitting on a boundary flip under IEEE arithmetic.
31. **Markdown anchors are load-bearing.** COMPASS/FILE_INDEX/RECIPES link to `##` headings by slug — renaming a linked heading breaks inbound links silently; grep for the old slug before renaming.

## Generation contracts

32. **A block's day-slot durations sum exactly to its week's hour target**, and every slot satisfies `0 ≤ minMin ≤ nominalMin ≤ maxMin` (`block-skeleton.computeBlockSkeleton`, [06-generation.md](systems/06-generation.md#the-week-skeleton-composition-authority)). Property-swept across settings combinations in `block-skeleton.test.ts`, not just example-tested — the guarantee was broken by inputs no example test tried (an event colliding with the canonical long-ride day; a configured budget that couldn't actually be placed).
33. **One fact, one warning owner.** `validateSkeletonConformance` owns day-level facts, `validateWeekHours` owns the weekly total, `validateRecoveryWeekDensity` owns recovery composition — none may restate another's warning. A recovery week once produced three near-identical warnings for one problem before this was enforced.
