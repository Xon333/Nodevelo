# NodeVelo — live punch-list

Short-lived tracker for **incoming bugs and feedback** — things to action soon, not strategy.
Keep it lean: when an item ships, move its one-line record to [ARCHIVE.md](ARCHIVE.md).

- **What's next / strategy** → [ROADMAP.md](ROADMAP.md)
- **Completed work** → [ARCHIVE.md](ARCHIVE.md)
- **Research spikes** → [research.md](research.md)

**Legend** — Status: ☐ todo · ◑ partial · ☑ done · Priority: P1 correctness/data-integrity ·
P2 high-value UX/feature · P3 polish/education · Type: `bug` `ux` `feat` `audit` `edu`

---

## Open

Code-review sweep (CR-A..H) — "senior dev who hates it" pass, 2026-06-22.

| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| CR-A | ☑ | P1 | bug | **Ledger read-modify-write race — SHIPPED.** `json-store` serialized byte-writes, not transactions — concurrent `/api/sync` + `/api/disposition` each `read→mutate→write` score-log.json ⇒ lost update. Fix: `updateJsonFile` transactional primitive (read+write inside one per-file lock via `withFileLock`); wired both sync score-log writes + both disposition writes through `updateScoreLog`/`updateDispositions`. (Other ledger touchers — write/ask/trends/reschedule/generate/analyze — are read-only.) Tests: json-store transactional + race cases. |
| CR-B | ☑ | P1 | bug | **External-fetch timeouts — SHIPPED.** Added `AbortSignal.timeout(20s)` to `icuFetch` (maps abort/network failure → `IntervalsApiError`), `timeout:240s`+`maxRetries:2` on the Anthropic client, and `export const maxDuration = 120` on `/api/sync`. Tests: new `intervals-api.test.ts` covers timeout/failure mapping + signal presence. |
| CR-C | ◑ | P1 | bug | **Don't wipe good data on a bad sync — core SHIPPED.** Added `isSuspectEmptySync(prev, fresh)` (pure, tested): a sync returning no activities AND no wellness when the prior had data is refused with a 502 (client shows it) instead of overwriting `last-sync.json` + resetting baselines from []. _Remaining (deferred):_ sub-step failures (quirks/intervention/ride-analysis) still surface via `warnings[]`+200 — intentional (non-fatal), but persistent ones deserve real observability, not a recurring toast. |
| CR-D | ☑ | P1 | audit | **Same-origin guard — SHIPPED.** Added Next 16 `proxy.ts` (the renamed middleware) matching `/api/:path*`, backed by pure unit-tested `lib/csrf.ts`: state-changing methods must carry a same-origin `Origin` (safe methods + non-browser/no-Origin clients exempt). Verified live — cross-site POST → 403 before the handler, same-origin POST passes, cross-site GET 200. Closes the drive-by `/api/import`/`/api/write` hole. |
| CR-E | ☑ | P2 | bug | **Immutability contradictions — SHIPPED.** (1) `deriveDecouplingGood` no longer auto-locks at n≥20 — it re-derives from the 90-day rolling mean every sync (the input is already recency-windowed; a season of getting fitter must move the cutoff), with the confidence gate still guarding noise and last-known-good kept across an empty window (no jitter). (2) `mergeScoreLog` comment now states the real contract: past dates frozen, today deliberately re-derived while live. Tests updated to assert adaptation. |
| CR-F | ◑ | P2 | audit | **Enforce AI nutrition numbers — daily-intake SHIPPED.** New `validateNutrition` recomputes each day's daily-intake kcal from the same deterministic formula the reference table is built from, parses the figure the model wrote, and flags a material deviation (generous tolerance so rounding/closest-row never false-flags). Wired into `/api/generate` beside the protocol/schedule validators. _Deferred:_ per-carb (pre/in/post) checks — the values share a free-text line so parsing which-number-is-which is ambiguous; daily intake is the headline invented-number risk. |
| CR-G | ◑ | P2 | audit | **Decompose sync god-route + first route test — SHIPPED (worktree).** Extracted the today-ride pure logic into `lib/ride-analysis.ts` (`computeRideMetrics`, `computeAdvisedIntake`, `buildTodayAnalysis`) and the ledger schema migration into `lib/sync-ledger.ts` (`backfillLedgerEntries`); the sync route now does I/O + calls the tested pure builders (handler ~130 lines lighter). Added `app/api/disposition/route.test.ts` — first coverage for a mutating route, exercising the CR-A transactional path. Suite 366→384. _Deferred:_ full step-by-step pipeline split, the redundant intra-request reads, and component tests — bigger refactors for their own pass. |
| CR-H | ◑ | P3 | bug | **Edge cases — H1 SHIPPED, rest triaged.** (1) ✅ `resolveAllTimeCurve` merges fresh + prior all-time taking max-per-duration, so the all-time curve stays monotonic even on a missing/partial/regressed fetch (84-day curve only as first-sync last resort); PR detection can't false-drop. (2) _Skip:_ `physiologyAsOf` re-sort is O(rides×history) but history is single-digit (FTP changes are rare) → microseconds, not worth the refactor risk. (3) _Not a bug:_ the 14d + 7d weight trends are an intentional dual display, not divergent duplicates. (4) _Deferred:_ HR bpm-vs-%LTHR `max>150` is an inherent heuristic (no unit flag from Intervals); replacing one heuristic with another is low-value/risk — left documented. |

_Design/judgment items live in [ROADMAP.md](ROADMAP.md): power-zone SoT vs personal override; the
"Z2 dialed-in" overstatement; Recent-Baselines content / TSS-vs-Load naming; whether IF should be
replaced rather than annotated. Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md)._
