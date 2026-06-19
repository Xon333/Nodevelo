# CONTINUE — session handoff

A living "resume here" note. Point a fresh session at this file: _"read CONTINUE.md and continue."_
The canonical backlog is [ROADMAP.md](ROADMAP.md); completed work is in [ARCHIVE.md](ARCHIVE.md);
how the app works is [README.md](README.md). Update or clear this file as work moves.

_Last updated: after P3 shipped (commit `0de91b5`)._

---

## Working principle (the user's directive)
**Dial in the backend / second-brain logic / schemas FIRST, before adding new features.** So favour
the Platform & performance (P-series) + correctness items over the coaching-feature items for now.

## Shipped this session
- **P1** (`e357ca3`) — prompt caching + singleton Anthropic client (`lib/anthropic-api.ts`).
- **P2** (`3d49b27`) — structured generation via tool-use; one shared zod schema (`lib/plan-schema.ts`);
  regex `plan-parser.ts` kept as a one-release fallback; `zod` v4 added.
- **P3** (`0de91b5`) — decoupled `/api/sync` (fast deterministic path) from the LLM coach note
  (`/api/analyze` + `lib/sync-analysis.ts`); `warnings[]` surfaced in the nav rail.
- Earlier: UTC/local "today" fix (`c76ad34`), all-time PRs (`f50014d`), and the docs restructure
  (README core-idea + doc map, ARCHIVE, research.md).

## State of the tree
- **182 tests pass** (`npm test`), **`npx tsc --noEmit` clean**, **`npm run build` clean**.
- **Lint is pre-existing dirty** (~11 problems: React-compiler strictness, `prefer-const` in
  `calibration.ts`/`plan-parser.ts`, an unused `numArr` in `intervals-api.ts`, a `Today's`
  unescaped-entity). These predate this session and the build tolerates them — **don't attribute
  them to recent work or fix them inside an unrelated commit.**

## Next up (suggested order — backend first)
1. **P4 — Observability + generation caching**: generate-result cache (skip Claude when the prompt
   is byte-identical to a recent one), stream `/api/ask`, surface intervention coach-accuracy %,
   token/cost tracker in Settings.
2. **P5 — Deterministic schedule validator**: flag back-to-back hard days post-generation
   (`workout-validate` checks protocol, not placement — the open gap from block creation).
3. **P6 — Reliability quick-wins**: `error.tsx` boundary, model+prompt-version stamping,
   export/import backup, `json-store` async mutex, re-analyse-today.
- Then bigger platform: P7 (TanStack Query client), P8 (logging + AI-route rate-limit), P9 (PWA +
  streamed generation).
- Coaching features (after backend): **Weak-Point Optimizer ⭐**, **Goal-driven session selection ⭐**,
  per-athlete execution bands (#1), Second-brain learning upgrades, signal fusion (#5). Note: the
  user is researching the goal-driven-session-selection heuristics and will provide findings.

## Open threads / gotchas
- **`knowledge-base/` and `data/` are gitignored** (local user content). KB edits (e.g. the PW-1/3/9
  §10/§11 rules) live only on this machine; the generation-prompt rules that reference them ARE
  committed.
- **P2 fallback**: `plan-parser.ts` (regex) is retained for one release as the tool-use fallback —
  safe to delete once tool-use is proven in real generations.
- **P3 scope note**: the deterministic ride analysis is still gated on `isAnthropicConfigured()`
  (matches prior behaviour). Could be loosened later so metrics/PRs show even without Anthropic.
- **P1 caching economics**: only generation has a cache breakpoint; it nets out positive on the
  regenerate-loop / multiple-blocks-in-a-session, slight write premium on a true one-and-done.

## Verify before claiming done
`npx tsc --noEmit && npm run build && npm test` — and keep new pure logic unit-tested.
