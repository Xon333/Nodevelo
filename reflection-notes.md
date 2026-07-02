# Reflection notes — transcript analysis, 2026-07-02

Diagnosis of all 26 prior sessions in `~/.claude/projects/-Users-otis-Cycling-App` (Jun 12 → Jul 2, ~106MB).
Method: 4 extraction subagents pulled per-session signals (user messages read exhaustively, assistant text sampled, command/error/edit aggregates via jq); batch Jun 25–Jul 2 extracted directly after its agent hit the session limit. Signals clustered here; each cluster carries its evidence (session IDs are first-8-char prefixes). **V** = verified in transcripts/repo; **A** = assumption/inference.

Ranked most leverage first. Verdict per cluster: **skill** / **automation-or-fix** / **convention** / **nothing**.

---

## 1. Session-continuity tax → `/handoff` skill (skill; build cost: low; recurrence: every long session)

The single biggest recurring loss. Session limits and context exhaustion break work mid-flight, and the recovery is manual every time.

**Evidence (V):**
- ~30 session-limit hits across the corpus; 10+ compactions. Worst: `5d13f265` (8 limit strings, ended mid-refactor, uncommitted), `c20e6a4c` (4 limits + 1 compaction), `4c07e126` (5 limits).
- Founding session `7397255e`: 7 compactions, 3 limit kills, and a verbatim re-paste ritual (full project brief re-pasted; a bug list pasted 3× into the limit wall unanswered).
- `2f1b8adc`: the user's final ask *"Just update the continue.md so i can continue in another session"* was itself killed by the limit → next session (`1bfffdc6`) opened with a hand-pasted findings table.
- `f67635fe`: user's design feedback sent 3×, never processed — lost across the boundary.
- "Continue where you left off" is the most common opener/resume phrase in the corpus (20+ uses).
- `34ac1c2e`: *"where can i call upon this plan in another session since this one is approaching the context limit"* — and the plan file (`docs/superpowers/plans/…`) **worked** as the handoff into `466a55e4`. That's the proven pattern to generalize.
- Even this analysis session: 3 of 4 subagents were killed by the session limit mid-report.

**Recommendation:** a tiny project skill `/handoff` that does, in one cheap invocation: update CONTINUE.md from current state (active task, next step, uncommitted files), commit + push, print the one-line resume prompt. Run it at natural stopping points and when context is getting long — before the limit, not after. For feature work, keep using plan files as the handoff (already proven). This respects the existing rule that CONTINUE.md is only touched on request — the skill *is* the request.

## 2. Three trivial fixes with outsized recurring payoff (automation-or-fix; build cost: minutes each)

a. **`npm run check` script.** The chain `npx tsc --noEmit` + `vitest run` (+ eslint) was re-typed ~60× in the founding session and ~10×/session since (`b3b0dc69`, `84a66856`, `5d13f265`…). **V:** package.json today has only separate `test`/`lint`/`build` — no combined script. One line in package.json ends the churn and gives subagents a single canonical verify command.

b. **vitest exclude for stale worktrees.** `aafc69ac` predicted it: root `vitest run` globs test files inside `.claude/worktrees/*` → false failures. Left unfixed out of concurrent-agent deference; it then bit the user in `84a66856` (4 FAILs pasted by hand from `ui-research`/`ui-fixes` worktrees). **V:** vitest.config.ts still has no `exclude` today. Add `exclude: ['**/.claude/**', '**/node_modules/**']`.

c. **Preview port separation.** 6+ "port in use"/stale-server incidents blocked preview across ≥5 sessions (PID 63383 on :3001 recurring in `aafc69ac`+`bc4d9d3e`, PID 12068, 22226, 28457 on :3000; "Another next dev server is already running"; preview MCP can't attach to a foreign server). **V:** launch.json pins port 3000 — the same port the user's own `npm run dev` uses (**A:** that attribution; PIDs weren't identified, but the collision pattern is consistent). Fix: a `dev:preview` script on a dedicated port (e.g. 3100) + launch.json pointing at it.

## 3. Hostile-review → todo pipeline → `/hostile-review` skill (skill; build cost: low; recurrence: 7+)

The user's signature ritual: *"act like a senior dev who HATES this implementation / what edge cases am I missing"*, findings get stable IDs, get routed into todo.md, then burned down with atomic commits.

**Evidence (V):** run in `1bfffdc6` (CR-1..16), `c20e6a4c` (RR-1..12), `f67635fe` (CR-A..H), `b3b0dc69` (pasted formula, CS-1..8), `84a66856` (/code-review xhigh + same framing, 7 finder agents), `5d13f265` (RV-1..9 + "rate the app"), `4c07e126` ("what is reduntant, what is making the app innacurate"), variants in `34ac1c2e` ("senior app dev and pro cycling coach, be strict") and `466a55e4` (due-diligence mega-prompt). The routing step is where quality leaks: in `1bfffdc6` Claude silently dropped 1 of 16 findings while copying its own review into todo.md — caught only by the user's "double check you included everything" habit.

**Recommendation:** a project skill that wraps the whole pipeline: run the review (delegating to `/code-review` at chosen effort), assign stable IDs in the established style, write todo.md entries in the house format, verify count(review findings) == count(todo entries), propose burn-down order. The prompt text itself is stable — codify it instead of re-typing it.

## 4. "What should we work on next" dispatcher → `/next` skill (skill; build cost: low; recurrence: 10+)

**Evidence (V):** grep across transcripts finds the opener in 8+ phrasings ("check roadmap", "not ui", "HIghest leverage on improving the things that actually matter", "Give suggestions", "Suggest 1 for you to work on and one so there other…", "this session and the other session. Give instructions to the other session aswell"). Sessions `b3b0dc69`, `aafc69ac`, `84a66856`, `12bdf625`, `34ac1c2e`, `4c07e126`, `2f1b8adc` all run the loop: pick numbered roadmap item → build → "commit and push" → ask again. `/brainstorming` was even invoked once with args "What should we do next" (`4c07e126`).

**Recommendation:** a `/next` skill encoding the house rules: read ROADMAP.md (stable IDs #1–4, tracks A–C) + todo.md, rank open items by leverage against the app's stated goals, and — because the dual-session split is explicitly requested 4–5 times — offer a two-lane split (this session / other session, with relay instructions ready to paste).

## 5. Doc-sweep ritual → `/docs-sweep` skill (skill; build cost: low-medium; recurrence: 5+ standalone asks, upkeep every session)

**Evidence (V):** standalone sweeps: `12bdf625` (roadmap restructure that created the Tracks structure), `c20e6a4c` ("recstructure roadmap", 434→134 lines), `b3b0dc69` ("remove stuff that has shipped… to archive. I want to actually see exactly what has to be done"), `466a55e4` ("general but thorough sweep of the whole repos documentation" — README edited 15×), `a2985bf8` (Task2 doc overhaul). Ongoing upkeep: ROADMAP/ARCHIVE/todo/README absorb a large share of edits in nearly every session (measured 45/211 edits in `2f1b8adc`; ROADMAP edited 12–24×/session; todo 8–16×). One drift incident: shipped "generation caching" still listed open (`12bdf625`).

**Recommendation:** encode the now-stable conventions (forward-only ROADMAP, shipped→ARCHIVE, stable cross-ref IDs, lean todo, README doc-map, CONTINUE.md hands-off) into a `/docs-sweep` skill so any session applies the same rules — today those conventions live partly in auto-memory, which subagents and fresh tools don't see.

## 6. Recurring bug classes → promote to AGENTS.md conventions (convention; build cost: minutes; recurrence: 2–3 each)

**Evidence (V):**
- **Stale-persisted-JSON assumptions** — 3 incidents: founding-session crash (`analysis.intensityFactor is undefined` on old on-disk JSON), `5029deb8` extras-render crash (`intervalComparison.extras is undefined`), and the migration-flag gotcha already saved to auto-memory.
- **UTC-vs-local "today"** — fixed in `5029deb8`, re-found as P1 finding CR-3 in `1bfffdc6`.
- **Live-LLM paths ship unexercised** — recurring honest caveat ("verified by unit tests + build… but not exercised against the live Anthropic API"), `e0c06a91` and later.

**Recommendation:** AGENTS.md currently contains only the Next.js warning. Add 3 short bullets (migration-flag truthy checks; always use the local-date helper, never `toISOString().slice(0,10)` for "today"; new LLM-path features need one live smoke run before "done"). Rationale: auto-memory is invisible to subagents, and subagent-driven development is now the primary implementation mode (`34ac1c2e`, `466a55e4`) — repo-level docs are the only channel that reaches every worker.

## 7. External-audit triage → `/triage-audit` skill (skill; build cost: low; recurrence: 7+; marginal — existing behavior is already good)

**Evidence (V):** the user regularly pastes large externally-authored AI audits/reviews for ground-truthing: 4 pastes in `5029deb8` alone, a 1040-line doc in `2f1b8adc`, repomix-based review in `722cfa22` (Claude's verdict: "~70% accurate… analysing the repo it expected, not the one you have"), ~10 mega-prompts in the founding session (which referenced nonexistent PDFs/repos and re-specified shipped work), due-diligence prompt in `466a55e4`. The verify-then-route behavior is already consistently good; a skill would standardize the output (claim-by-claim verdict table, route accepted items to ROADMAP/todo with IDs) and pin the known failure modes (external doc re-specifies done work; cites artifacts that don't exist). Build only if the ritual continues weekly.

## 8. Real-ride QA loop (mixed; mostly product work already on the roadmap)

**Evidence (V):** production riding is the regression suite — post-ride bug lists with screenshots in `7397255e` (morning bug lists, 346 attachments), `aafc69ac` (3 defects in one message; root cause was an icu field-mapping error found after a wrong first hypothesis), `5d13f265` (5 screenshots; interval-order misanalysis), `4c07e126` (recovery-ride misclassification; interval-detection picked the wrong interval again). Two support items recur and are cheap:
- **Dev reset affordance** — user asked twice in the founding session to manually wipe today's analysis to re-test sync ("erase the todays page analysis so i can resync", "reset again"). A tiny dev-only script/route ends that.
- **Interval-source ambiguity** (Wahoo laps vs intervals.icu selections) surfaced in both `5d13f265` and `4c07e126`/`a2985bf8` and was resolved as a product decision (use intervals.icu one-click laps) — no tooling needed, just don't reopen it.

## 9. Concurrent-session coordination — mostly solved; keep the residue small (convention; build cost: near-zero)

**Evidence (V):** the bad era: mixed commit `46a0c64` swept 8 of the other session's staged files (documented from both sides — `c20e6a4c`, `f67635fe`); push-rejected rebase dances (`b3b0dc69`); user as message-bus ("Give instructions to the other session aswell", "Other session — instructions to relay", "I can confirm it is not working on anything"); stale-worktree cleanup by request (`84a66856`); ghost-session confusion (`34ac1c2e`: "i dont know why this appaered"). The user-authored CLAUDE.md policy (worktrees/pathspec-staging/wait-30s) already fixed the commit-collision class — no new incident after Jun 22. What remains is covered by cluster 2b/2c (vitest exclude, ports). A heavier coordination system (mailbox file, session registry) is **not** justified: recurrence of the remaining pain is low and the dual-session pattern itself seems to be fading in favor of subagent-driven development.

## 10. Explicit do-nothings

- **Manual `/model` switching (39×, V)** — deliberate cost/quality steering; the delegation preferences the user added to CLAUDE.md (`34ac1c2e`, `466a55e4`) already encode the durable part. No build.
- **Opus-classifier outages (V: 29 blocked tool calls in `84a66856`, 10 more strings in `4c07e126`)** — infrastructure, not fixable locally. Only mitigation is the allowlist idea below.
- **Brainstorming one-token answer loops (V: ~25 "A"/"yes" in `34ac1c2e`)** — by-design elicitation, works well.
- **External-validation asks** (YC, Claude Max application, Stitch prompts) — human judgment calls, not automatable.

## One-offs — flagged, not patterns (each observed once)

- **Secrets in transcript (high severity):** on Jun 13 a live Anthropic `sk-ant-…` key and Intervals.icu key+athlete-ID were pasted into chat; they sit permanently in `7397255e-….jsonl` on disk. If those keys were never rotated, rotate them. (**A:** rotation status unknown.)
- **`i-have-adhd/` clone** untracked in the repo root since Jun 25 (`99c4fb5a`: "do not install yet") — decide install-or-delete.
- **Graphify** adopted and ripped out the same day (`185846f7`) — resolved; noting so it isn't re-adopted from memory.
- **Permission-prompt reduction:** the `/fewer-permission-prompts` skill exists in this environment and was never run; given the auto-mode classifier stalls, a read-only allowlist could help. Single data point, so listed here rather than ranked.

## Meta: what's already working (don't touch)

The superpowers pipeline (brainstorm → writing-plans → subagent-driven-development → whole-branch review → finishing-a-development-branch) ran cleanly twice (`34ac1c2e`, `466a55e4`) and plan files double as session handoffs. The verify-before-accept posture toward external reviews (`722cfa22`) and the review→todo→burn-down discipline are strengths; the skills above codify them rather than change them.
