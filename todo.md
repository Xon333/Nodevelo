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
| CR-C | ☐ | P1 | bug | **Silent degradation == data loss.** `icuFetch` → null on 2xx-non-JSON, `fetchActivities` → [] on non-array ⇒ empty dashboard indistinguishable from a real empty; baselines recompute from []. Sync POST always returns 200 behind `warnings[]`. Make upstream-shape failures loud. |
| CR-D | ☑ | P1 | audit | **Same-origin guard — SHIPPED.** Added Next 16 `proxy.ts` (the renamed middleware) matching `/api/:path*`, backed by pure unit-tested `lib/csrf.ts`: state-changing methods must carry a same-origin `Origin` (safe methods + non-browser/no-Origin clients exempt). Verified live — cross-site POST → 403 before the handler, same-origin POST passes, cross-site GET 200. Closes the drive-by `/api/import`/`/api/write` hole. |
| CR-E | ☐ | P2 | bug | **"Immutable" contradictions.** Sync re-patches today's score-log entry after the "frozen-once-scored" merge; `deriveDecouplingGood` locks forever at n≥20 (adaptive knob that stops adapting). Document the today-exception; make calibration recency-windowed. |
| CR-F | ☐ | P2 | audit | **"AI never invents numbers" is prompt-only for nutrition.** Plan protocol/schedule are validated post-gen; the kcal/carb values in each `DESCRIPTION` are free text checked against nothing. Inject from the reference table or diff them. |
| CR-G | ☐ | P2 | audit | **God-route + test gaps.** `/api/sync` POST = ~340 lines, 8 responsibilities, redundant disk reads (readScoreLog ~4×, readAthleteProfile 3×, …). 0 tests on 13/16 routes incl. sync+disposition; 0 component tests. Decompose + cover the seams. |
| CR-H | ☐ | P3 | bug | **Edge cases.** (1) `powerCurveAllTime` falls back to the 84-day curve on fetch failure → breaks the monotonicity PR detection relies on. (2) `physiology.history` uncapped + re-sorted per ride in `physiologyAsOf` (O(rides×history)). (3) Two divergent weight-trend fns feed the same prompt. (4) HR bpm-vs-%LTHR guessed by `max>150`. |

_Design/judgment items live in [ROADMAP.md](ROADMAP.md): power-zone SoT vs personal override; the
"Z2 dialed-in" overstatement; Recent-Baselines content / TSS-vs-Load naming; whether IF should be
replaced rather than annotated. Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md)._
