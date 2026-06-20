# CONTINUE — session handoff

A living "resume here" note. Point a fresh session at this file: _"read CONTINUE.md and continue."_
The canonical backlog is [ROADMAP.md](ROADMAP.md); completed work is in [ARCHIVE.md](ARCHIVE.md);
how the app works is [README.md](README.md). Update or clear this file as work moves.

_Last updated: after P4 streaming shipped (3/4 P4 items done; only generation caching left, blocked)._

---

## Working principle (the user's directive)
**Dial in the backend / second-brain logic / schemas FIRST, before adding new features.** So favour
the Platform & performance (P-series) + correctness items over the coaching-feature items for now.

## Shipped this session
- **P5** (`00b754f`) — deterministic schedule validator (`lib/schedule-validate.ts`): flags
  back-to-back hard days + weekly over-budget as generation `warnings[]`. Quality set =
  Threshold/VO2max/SIT/RaceSim.
- **P6** — reliability quick-wins (5 items): `app/error.tsx` + `app/global-error.tsx` boundaries
  (Next 16 uses `unstable_retry`, not `reset`); model+`promptVersion` provenance stamping across
  `GeneratedPlan`/`TodayAnalysis`/`BlockHistoryEntry`/`CurrentBlock`; export/import backup
  (`/api/export`+`/api/import`, no-dep JSON bundle, Settings card); per-file write mutex in
  `lib/json-store.ts` (+ `NODEVELO_DATA_DIR` test override); manual re-analyse (`addCoachNote(force)`
  + `SyncProvider.reAnalyse` + Today button).
- Prior sessions: **P1** (`e357ca3`) prompt caching + singleton client; **P2** (`3d49b27`)
  structured tool-use generation; **P3** (`0de91b5`) decoupled `/api/sync` from the LLM coach note.

## Latest: P4 progress (2 of 4 shipped) + spec fold
- **P4 token/cost tracker** (`b87a122`) — `lib/ai-usage.ts` `recordUsage` after every Anthropic call
  (4 sites), per-model pricing + cache read/write multipliers, `AiUsageCard` on the `force-dynamic`
  Settings page.
- **P4 coach-accuracy %** (this commit) — `overallCoachAccuracy` rolls the validation loop into one
  hit-rate; `/api/sync` GET → `AppState.coachAccuracy` → compact line in the Today Trend-pulse zone
  (hidden until a decisive % or pending interventions exist).
- **Roadmap fold** (`f41a866`) — the external "second brain" spec mapped onto the backlog
  (durability taxonomy, fueling correlation engine added; #1/#2/#4/#6 annotated). **Decisions made:**
  FTP gap → *flag-only, suggest a re-test* (never write `physiology.json` FTP); durability template
  selection → *limiter-driven, else rotate*. User wants the **rest of P4 finished before** the new
  spec items.
- **P4 streaming** (this commit) — `streamAskCoach` async generator → route returns a plain-text
  `ReadableStream`; `AskCoach` reads `res.body` incrementally. tsc/build/lint clean; live token path
  unexercised (needs a real Anthropic key — would be a billed call).
- **Only generation caching left in P4** — blocked on the regenerate-for-variation product question.
  Once resolved (or skipped), **P4 is done** → next is the spec work (user wants P4 finished first):
  start with the **fueling correlation engine** or the **calibration framework** (see ROADMAP).

## State of the tree
- **205 tests pass** (`npm test`), **`npx tsc --noEmit` clean**, **`npm run build` clean**.
- **Lint is pre-existing dirty** (~11 problems: React-compiler strictness, `prefer-const` in
  `calibration.ts`/`plan-parser.ts`, an unused `numArr` in `intervals-api.ts`, a `Today's`
  unescaped-entity). These predate this session and the build tolerates them — **don't attribute
  them to recent work or fix them inside an unrelated commit.**

## Next up (suggested order — backend first)
1. **P4 — Observability + generation caching**: generate-result cache (skip Claude when the prompt
   is byte-identical to a recent one), stream `/api/ask`, surface intervention coach-accuracy %,
   token/cost tracker in Settings. (Provenance stamping from P6 pairs well with the cost tracker.)
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
