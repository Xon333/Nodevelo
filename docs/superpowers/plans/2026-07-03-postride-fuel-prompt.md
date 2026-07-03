# Post-Ride Fuel Prompt — Implementation Plan (Track C accumulation flywheel)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the `carbs_ingested` fill-rate — the gating input for `carbsOptimum` (currently derived from **1 data point**, confidence `low`; only 23/117 ledger entries carry a `fuel` stamp) and for every future Track C edge. A deterministic post-ride prompt on the Today card nudges the athlete to log in-ride carbs on qualifying rides, and — once the derived optimum is trustworthy — surfaces the gap between logged intake and their own optimum. This is the ROADMAP Track C item "Contextual post-ride prompts (deterministic thresholds, LLM phrases the number) — also the nudge that gets `carbs_ingested` filled in."

**Why this shape:** pure accumulation play. The correlation engine (`deriveOptimum`) is built and dormant for lack of data; the cheapest way to more data is a well-timed nudge on the exact rides that teach the model. Deterministic core: thresholds and numbers are code; the LLM at most *mentions* the prompt in the coach note — it never computes a gram.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Vitest, Tailwind v4.

## Global Constraints

- **No LLM in the decision path.** `deriveFuelPrompt` is pure and unit-tested. v1 prompt text is deterministic strings; the coach note merely receives it as one context line.
- **Never fires on rest days.** At most **one** prompt per day. Silence is the default — an over-chatty nudge trains the athlete to ignore it (trust over complexity).
- **Respect calibration honesty:** the gap variant only fires when `carbsOptimum.confidence` is at least `medium` AND not manually overridden to something it contradicts — resolve through the existing calibration resolver, never read the raw store value directly.
- **Concurrent checkout:** stage only files you touched; commit on `main`.
- **Verification loop:** `npx tsc --noEmit && npm run lint && npm test && npm run build`.

---

### Task 1: Pure decision module

**Files:**
- Create: `lib/fuel-prompt.ts`, `lib/fuel-prompt.test.ts`
- Reference (do not modify): `lib/score-log.ts:44-49` (`fuelStampFor` — the g/h normalisation to mirror), `lib/calibration.ts` (resolver), `lib/types.ts` (`ActivitySummary.carbsIngestedG`, `movingTimeSec`)

**Interfaces:**
```ts
export type FuelPrompt =
  | { kind: "log-nudge"; reason: "long-ride" | "interval-day"; durationMin: number }
  | { kind: "gap"; loggedGPerH: number; optimumGPerH: number; deltaGPerH: number };

export function deriveFuelPrompt(input: {
  activity: ActivitySummary;            // today's ride
  plannedType: WorkoutType | null;      // from today's planned day, null off-plan
  carbsOptimum: { value: number; confidence: "low" | "medium" | "high" } | null; // RESOLVED (override-aware)
}): FuelPrompt | null;
```

**Decision rules (exactly these, all thresholds as named consts):**
- Ride **qualifies** iff `movingTimeSec ≥ 90*60` OR `plannedType ∈ {Threshold, VO2max, SIT, RaceSim}`. Not qualifying → `null`.
- Qualifying + `carbsIngestedG == null` → `log-nudge` (reason picks whichever qualified it; long-ride wins ties). A logged `0` is a real data point (fasted — FUEL-1), **not** a nudge case.
- Qualifying + logged + `carbsOptimum` present at confidence ≥ `medium` + `loggedGPerH < optimum − 20` (`GAP_UNDER_G_PER_H = 20`; under-fueling only in v1 — over-fueling has no validated harm signal) → `gap`.
- Everything else → `null`.

**Steps:**
- [ ] Implement + tests: each rule above, both boundary sides (89 vs 90 min; logged-0 no-nudge; confidence `low` → no gap; delta exactly 20 → no gap [beware float-boundary fixtures — don't pin a pre-rounding `.x5`]; off-plan long ride → still qualifies via duration).

### Task 2: Wire into sync analysis + Today card

**Files:**
- Modify: `lib/types.ts` (`TodayAnalysis` — add `fuelPrompt?: FuelPrompt | null`), `app/api/sync/route.ts` (compute once in the today-analysis block, where activity + plannedDay + resolved calibration are all in hand), the Today card component (find where fuel/coach-note chips render — likely `components/` Today area; match DESIGN.md tokens + existing chip idiom)
- Modify: `lib/sync-analysis.ts` (coach-note context: one line, e.g. `FUEL PROMPT: rode 2h05 with no carbs logged — remind to log in-ride carbs in Intervals.icu` / `FUEL PROMPT: logged 35 g/h vs derived optimum 69 g/h`) so the note can mention it naturally — the LLM phrases, never computes.

**Steps:**
- [ ] Compute `deriveFuelPrompt` in the sync route's today path; persist on `today-analysis.json`. Absent/null → key omitted (stale-persisted-JSON class: the card must render fine when the field is missing on old files — truthy-check, never `=== null`).
- [ ] Today card: a single quiet chip/banner. `log-nudge`: "Log your in-ride carbs on Intervals.icu — [duration/interval] rides teach your fueling optimum." `gap`: "You logged **X g/h**; your derived optimum is **Y g/h** (n rides)." Copy states provenance in the house calibrated-honesty style.
- [ ] Coach-note context line in `sync-analysis.ts` with an instruction that it may be mentioned in one sentence, numbers verbatim only.

### Task 3: Documentation

- [ ] `README.md`: one paragraph under "Nutrition is code, not AI" (the prompt is deterministic; LLM only phrases).
- [ ] `ROADMAP.md`: mark the Track C "Contextual post-ride prompts" bullet shipped → move to `ARCHIVE.md` with the standard shipped record; note the pre-ride loading loop stays open.
- [ ] `FEATURES.md`: one line under the nutrition/fueling area.

## Acceptance criteria

1. Long unlogged ride → nudge on Today card after sync; short unlogged ride → nothing.
2. Logged 0 g (fasted) → no nudge (it's data, not an omission).
3. Gap variant only with resolved confidence ≥ medium (impossible today — n=1 low; test with fixture).
4. Old `today-analysis.json` without the field renders cleanly.
5. Live smoke run (AGENTS.md): one real sync on a qualifying ride day, read the actual coach note + card.
6. Full verification loop green.

## Edge cases

- Rest day / no ride today → today path never computes a prompt (existing guard).
- Two rides in a day → the today path's activity (the one analyzed) decides; no aggregation in v1.
- Manual override on `carbsOptimum` → resolver already folds it in; the gap compares against the resolved value.

## Success metric (check after ~3 weeks)

`fuel`-stamped share of new planned/qualifying ledger entries: baseline ~20% (23/117 overall) → target **≥60%** of qualifying rides. `carbsOptimum.dataPoints`: 1 → ≥8. If fill-rate doesn't move, the nudge placement failed — revisit surfacing before adding any more Track C machinery.
