# NodeVelo maintainer audit — 2026-09-05

The strongest confirmed defect was an interval-provider outage being saved as a completed intent decision. This audit fixes that narrow path with an HTTP-adapter regression. Integrated main passes its deterministic gate and build. FR-6 needs two corrections before merge; the obsolete workflow PR has been closed. No performance optimization is justified by the small scratch-route timings alone.

## 1. Repository and GitHub state

- Integrated baseline: `f53374886f2e19df769a9173e40134be9650b771`, matching freshly fetched `origin/main`. Recent shipments include FR-4 retrospective windows, deterministic FR-5, and FR-2 restore honesty.
- Primary checkout: `main`, with 23 modified tracked files and four untracked documents at opening. These are **unshipped** workflow/rationale/plan changes. Preserved throughout; no sync, branch switch, reset, cleanup, or staging in that checkout.
- Audit implementation: isolated `codex/maintainer-audit-2026-09-05`, created through `start:agent-task` from current origin/main. Its only runtime change is MA-1 below.
- Open issues: zero at inspection. Open PRs initially: #109 and #91; #91 closed during this audit. The current owner instruction supersedes historical Ox/Claude review gates.
- FR-6 remains the active package; PR #109 already owns its implementation. FR-7/8 remain blocked, FR-9 is attended evidence, and real-event work remains dormant.

## 2. Findings, ordered by severity

### MA-1 — P1 — HTTP outages become durable intent decisions — fixed in this change

**Location:** `lib/intent-runner.ts:94`, `lib/intervals-api.ts:212`; prior adapter catch at baseline lines 244–245. **Evidence:** supported note `-Effort 1 (10m)` with a mocked HTTP 503 through the actual adapter returned `processed: 1`, `remaining: 0`, `failedIds: []`. That writes an overlay for the same fingerprint, suppressing ordinary later retries. **Why missed:** `lib/intent-runner.test.ts` mocked a rejection from `fetchIntervals`; the real implementation swallowed it. **Smallest fix:** opt into throwing at the intent caller while keeping the existing empty-array fallback for sync callers. **Verification:** the new regression failed before the fix, then passed; it checks no overlay on outage and successful retry of the unchanged note. The targeted suites pass 61 tests; full gate passes 2,512. Independent review found no regressions. Genuine successful empty responses remain absent evidence. Existing affected overlays are not rewritten; any historical repair needs a separately reviewed scope.

### MA-2 — P2 — Null Profile sections throw instead of returning 400 — open

**Location:** `app/api/profile/route.ts:275–277` and `:329–332`. **Evidence:** both development and production scratch servers return HTTP 500 for `PUT /api/profile` with `{"nutrition":null}` or `{"performance":null}` and a valid same-origin header. **Why missed:** tests cover field values and malformed JSON but not null section containers; TypeScript assertions do not narrow runtime JSON. **Smallest fix:** reject non-object/null/array section values before reading their fields. **Verification:** table-driven route tests for null, primitive and array containers; assert 400 and no persistence calls, then repeat the HTTP reproduction.

### MA-3 — P2 — Builds trace private runtime roots — open

**Location:** `next.config.ts:3–5`, with runtime roots at `lib/json-store.ts:21–22` and `lib/kb-loader.ts:187`. **Evidence:** add synthetic `data/audit-canary.json` and `knowledge-base/audit-canary.md` to the isolated worktree and build: 52 trace references include those files, including both Profile and Settings manifests. This reproduces even while runtime environment roots point to scratch directories outside the checkout. Existing primary artifacts, inspected by path category only, contain 858 data and 156 knowledge-base references. Their build head is unknown, so they are corroboration, not the fresh baseline. **Why missed:** CI runs `npm run check`, which neither builds nor asserts manifest contents. A clean worktree without private roots misleadingly yields zero such references. **Smallest fix:** narrow output-file-tracing exclusions for runtime personal roots, retaining shipped KB defaults and required assets. **Verification:** build with synthetic canaries, assert they are absent from all traces, then run production with external runtime roots and verify store/KB reads. This is a packaging/privacy gap; no HTTP disclosure or deployment was demonstrated.

### MA-4 — P2 — FR-6 treats unknown usage as measured $0 — PR #109 needs changes

**Location at PR head `b5e1aa3169b94435da9386d604cfafd91a06f7f1`:** `scripts/fr6-language-experiment.ts:886–894`; usage normalization at `scripts/fr6-language-providers.ts:488–495`. **Evidence:** six valid mocked Anthropic responses without usage produce six `status: ok`, `costAccounting: reserved-unknown`, `costUsd: 0` rows. `evaluateHardGates` returns `{passed:true, projectedCostUsd:0, failures:[]}` and six outputs reach blind review. Independently reproduced offline, without provider requests. **Why missed:** tests cover unknown-cost failed requests but omit successful output without usage. **Smallest fix:** require complete measured usage for a cost projection; retain unknown-spend reservations. **Verification:** missing/partial usage on successful prose and structured responses must make the projection unavailable and block cost eligibility.

### MA-5 — P2 — FR-6 excludes viable independent category winners — PR #109 needs changes

**Location at the same PR head:** `scripts/fr6-language-experiment.ts:989–1001`; approved design `docs/superpowers/specs/2026-09-01-fr6-language-provider-cost-experiment-design.md:118`. **Evidence:** eligibility groups all six cases by provider/model and requires the entire model to pass. The design explicitly makes decisions independent by call category. A failed structured case excludes that provider's valid ride/prose cases, preventing a mixed winner even if its combined cost fits the budget. **Why missed:** tests mirror model-wide eligibility rather than a mixed-category selection. **Smallest fix:** validate complete category arms, then evaluate combined eleven-plus-two cost for proposed selections. **Verification:** two providers with complementary passing categories must produce a budget-eligible mixed selection; incomplete category evidence must still fail closed.

### MA-6 — P2 — Pending cleanup rewrites immutable plans — unshipped

**Location in primary diff:** `docs/superpowers/plans/2026-07-08-preride-loading-loop.md:243`, `2026-07-08-reschedule-calendar-mirror.md:358`, and `2026-07-12-01-z2-aerobic-baseline-merge.md:111`. **Evidence:** `git diff` shows edits to historical plan prose and embedded code despite invariant 27. **Why missed:** link checks explicitly exempt plans and no diff guard enforces immutability. **Smallest fix:** the owning cleanup task should exclude those edits from its commit, preserving its working files until reconciled. **Verification:** its staged diff contains no historical-plan modifications. This audit did not revert user work.

### MA-7 — P3 — Pending comment cleanup deletes useful rationale — unshipped

**Location in primary diff:** `lib/aerobic.ts:68–71`, `lib/block-compiler.ts:130–133`, `lib/loading.ts:69–72`. **Evidence:** deleted comments explain the accepted bounded quadratic baseline computation, the three-slot bound justifying exhaustive search, and why binary loading flags cannot use the continuous correlation engine. Those are constraints and revisit triggers, not restatements. **Why missed:** executable tests cannot detect lost design rationale. **Smallest fix:** retain the reasoning while removing unwanted wording. **Verification:** review the final diff against the original rationale; no runtime test changes are needed.

### MA-8 — P3 — Navigation counts are stale — open documentation maintenance

**Location:** `app/README.md:6`, `lib/README.md:8`, `docs/systems/01-sync-and-data.md:32`. **Evidence:** the README says 22 routes, while `app/api/**/route.ts` has 24; types are described as 999 lines but have 1,499 at baseline; sync is described as 905 lines but has 1,216. **Why missed:** link validation checks destinations, not content freshness. **Smallest fix:** remove volatile line counts and use FILE_INDEX for navigation, or generate them. **Verification:** recount routes from tracked source and check references; no new test infrastructure needed.

## 3. Slop decisions

| Candidate | Decision | Evidence and protected behavior |
|---|---|---|
| Existing ledger, CAS, backup and publication tests | Keep | Protect historical immutability, recovery and external write ordering; visual repetition is no deletion evidence. |
| Intent outage mock | Strengthen | Existing test covers unsupported-note/no-fetch behavior; retain it. Added HTTP-adapter regression covers the previously missing contract. No tests deleted. |
| `reconcileDurationMin` / `repairNutrition` | Defer deletion | No active app callers found, but invariants explicitly retain them as compatibility helpers. Delete only with a compatibility decision and an inventory of historical consumers. |
| Large nutrition/types/intent modules | Keep structure | Size alone does not show a shallow interface. No measured reason to mechanically split them. |
| Rationale comments | Keep | MA-7: they hide the reasoning a maintainer otherwise has to reconstruct. |
| Duplicate season ownership | Simplify later | Share authoritative query data while preserving editable draft state, save invalidation and visible load failures. The deletion test is removal of the second fetch/load/error owner, not creation of wrapper cards. |
| Stale counts | Simplify | MA-8: remove frequently drifting counts rather than adding elaborate synchronization machinery. |

## 4. Performance hypotheses and measured results

Measurements are single local runs on this machine, not comparative optimization claims. Route samples use empty/synthetic state, never the athlete's database.

| Measurement | Result |
|---|---|
| Baseline `npm run check` | 15.29 s; 118 files / 2,511 tests passed |
| Baseline Vitest portion | 4.52 s wall time |
| Separate TypeScript / zero-warning lint samples | 3.66 s / 5.21 s |
| Baseline `npm run build` | 7.32 s, exit 0 |
| Post-fix full check | 11.68 s; 118 files / 2,512 tests passed |
| Clean isolated production traces | 38 files; 974,518 bytes; 16,768 entries; largest trace 668 entries |
| All production JS chunks together | 955,732 bytes raw / 280,169 gzip; this is not per-page transferred JS |
| Production scratch GET sync | Six samples: 2.29–7.84 ms; median 3.23 ms; 1,568 bytes |
| Production scratch GET season | Six samples: 1.84–2.45 ms; median 2.11 ms; 645 bytes |

- **Duplicate season reads confirmed:** production Plan mount makes one `/api/season` request from `components/SeasonSection.tsx:27` and one date-qualified request from `components/dashboard/PlanView.tsx:138–141`. Development makes three total due to the mount-effect path running twice. One sync GET was observed on each initial mount. No sync POST occurred.
- **No performance change made:** removing one ~2 ms scratch request is lower priority than correctness. A future shared-query change needs production before/after counts plus save/refetch/error tests. Warm-cache effects explain why the second check can be faster; it is not attributed to the fix.
- **Interval duplication not established:** sync fetches today's intervals for a prescription; intent processing excludes prescribed ledger rows. Their mere import of the same adapter is not proof of duplicated provider calls. No global cache added.
- **Tracing hypothesis confirmed as privacy/packaging gap:** MA-3. No exclusion performance gain claimed before a tested change exists.
- **Backup flakiness remains a hypothesis:** full suite passed. `lib/backup.test.ts:85–91` polls up to 50 zero-delay timers; prefer an explicit rename-entry promise if failure is reproduced. Do not delete concurrency coverage.
- **JSON reads, large components, contention, provider payload cost:** no athlete-sized profile or live provider count collected. Defer caching/memoization/abstraction pending evidence and refresh/error semantics.

## 5. Agent DX and verification

The strongest immediate improvement was testing the actual adapter contract rather than an imaginary rejection. Next: synthetic manifest canaries in a build check, primitive/container validation at route seams, and a minimal browser smoke capturing request counts and failed requests. Existing write tests already cover stable event IDs and CAS changes, sync tests mock Anthropic disabled, and date tests cover supplied local dates; these are not wholly absent capabilities.

The remaining gaps are integrated browser/provider evidence: real stable-ID concurrent publication; real provider failures; populated responsive/keyboard/screen-reader behavior; and attended backup recovery. Deterministic restore/barrier coverage exists and passed. No permanent E2E framework was added for a two-page scratch smoke.

The primary merge helper reads `headRefOid` but does not pass it to `gh pr merge` (`scripts/merge-agent-task.sh:23–27`). Pinning the reviewed head with `--match-head-commit`, and testing failed checks/closed PR/wrong branch, is a small workflow-hardening follow-up. Required CI still applies; no bypass is justified.

## 6. PR and issue triage

- [PR #109](https://github.com/Xon333/Nodevelo/pull/109): **Needs changes**, MA-4 standards axis and MA-5 spec axis. Its current required `check` is green (71 seconds), but the offline reproduction disproves the cost gate. [Review comment](https://github.com/Xon333/Nodevelo/pull/109#issuecomment-5553020291) records both findings. The incomplete live matrix and owner scoring are honestly documented; production language routes are unchanged.
- [PR #91](https://github.com/Xon333/Nodevelo/pull/91): **Superseded workflow, conflicting branch; closed with rationale.** Its green 65-second historical check does not make the obsolete Ox gate relevant. Unique historical nutrition/workout-library review content remains recoverable in the closed PR; no branch deletion or history rewrite was performed. HR-66's archival decision remains separate.
- No open GitHub issues. Repository backlog is updated with MA-2 through MA-8; MA-1 is recorded in the archive.

## 7. Stuck-work opportunities

FR-6's commit sequence repeatedly hardened grounding and spend handling, while its model-wide filter prevents the design's category-specific comparison. Preserve its corpus, spend ledger and failed-output evidence; correct the two gates before spending again. A broad provider expansion does not resolve those defects. Do not discard the current branch: its isolated adapters and accounting contain useful work.

The obsolete reciprocal-review wait is no longer an owner gate. Closing #91 removes that stale queue item without merging it. Primary workflow changes should be completed separately, retaining reasoning and excluding immutable plans. Stale local worktrees were inventoried but not pruned because the shared checkout is dirty.

## 8. Recommended execution order

1. Integrate the reviewed MA-1 retry correction through required checks.
2. Fix MA-4/5 on FR-6 before further paid experiments; then complete its attended scoring and disposition evidence.
3. Fix MA-3 with canary build assertions, and MA-2 as a separate small route-validation change.
4. Finish primary workflow cleanup with MA-6/7 resolved; update MA-8 counts/pointers in the owning docs.
5. Measure a shared season-query change on representative scratch data before implementing it.
6. Continue FR-9 evidence; keep FR-7/8 and real-event gates intact.

## 9. Files changed

Runtime: `lib/intervals-api.ts`, `lib/intent-runner.ts`. Regression: `lib/intent-runner.test.ts`. Owning system description: `docs/systems/02-scoring-and-learning.md`. Audit/evidence/backlog: this report, `todo.md`, `ARCHIVE.md`. No production provider, prompt, dependency, data schema, ledger, or calendar change.

## 10. Commands and actual outcomes

- Read-only opening: status/branch/log/remotes/diffs, `git fetch origin`, SHA comparison and worktree inventory succeeded. `gh pr list/view/diff/checks` inspected both actual PR diffs; `gh issue list` returned `[]`.
- `npm run start:agent-task -- codex maintainer-audit-2026-09-05`: isolated current-main worktree created. `npm ci --ignore-scripts`: exit 0.
- Baseline `npm run check` and `npm run build`: exit 0, counts/timings above.
- `npx vitest run lib/intent-runner.test.ts -t 'HTTP outage'`: expected pre-fix failure, processed 1 instead of 0.
- `npx vitest run lib/intent-runner.test.ts lib/intervals-api.test.ts`: 61 passed, independently repeated by reviewer.
- Post-fix `npm run check`: exit 0, 2,512 tests. Canary build: exit 0, 52 synthetic private-root references.
- Headless Chromium via `with_server.py`, both `npm run dev:preview` and `npm run start -- -p 3100`: Plan at 1440px and Today at 390px inspected. Zero Plan page/console errors; development no failed requests. Production logged four aborted Profile/Settings RSC prefetches, no failed API requests. These aborts were recorded, not treated as a demonstrated user-visible defect. Today had no horizontal overflow and correctly showed unconfigured physiology/blocked generation. Profile negative tests returned 500 as above. Both servers stopped afterward.
- Primary `npm run test:agent-workflow` and `npm run check-links`: passed (151 markdown files); isolated link check passed (147 before this report). `git diff --check`: clean.
- FR-6 missing-usage reproduction: offline, six unknown-cost rows incorrectly eligible. `gh pr comment 109` and `gh pr close 91 --comment ...`: succeeded.

## 11. Explicitly unverified

This was a risk-based whole-repository sweep, not proof of every branch. No live Intervals.icu request, calendar mutation, paid Anthropic request, personal fixture copying, backup import of athlete data, or historical overlay repair occurred. The changed path is deterministic and does not require an LLM smoke; real HTTP failure behavior still needs provider evidence beyond the injected 503. Device/Wahoo acceptance, populated keyboard/screen-reader journeys, athlete-sized latency, provider fetch counts/payload sizes, full multi-tab publication and prospective training usefulness remain unverified here. Existing historical smoke records were not promoted into fresh evidence.
