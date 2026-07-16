# Season Coverage-Floor Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the season engine's build-focus selection with a scored selector — goal-relevance × trainability × decay-urgency × execution-quality — that reasons about real generated sessions instead of its own past labels, plus a focus-vs-sessions season-fit check and a real `achievedTssFor` wired into the generate route.

**Architecture:** All scoring lands as pure, deterministic additions to `lib/season.ts` (`scoreFocusCandidates` + `selectBuildFocus`, a drop-in for the macro-structure sibling's `pickBuildFocus` seam); the route feeds it a `FocusSignals` bundle (goal text, real session exposure from block history, per-type execution EWMA from the intervention loop) via a new optional `SeasonDraftInput.focusSignals`. **Live-file finding (2026-07-15, `lib/season.ts` @ `3c0a978`):** NEITHER sibling has executed — `nextBuildFocus` (lines 61–73) is still the ORIGINAL two-state version (`order.find((f) => f !== last)` fallback; no LRU, no `pickBuildFocus`, and `assignLoadTargets` still carries the deload branch the critical-fixes plan removes) — so this plan replaces the original selector directly, with explicit conditional steps for the case where the critical-fixes LRU or macro-structure's `pickBuildFocus` lands first. Research finding (athlete-approved, cite in code): "train the weakest system" and "train the system that unlocks the goal" diverge for this athlete — his weakest system (sprint/anaerobic) is durable and slow-to-respond (multi-season, strength-anchored gains), while his actual FTP constraint is the aerobic ceiling (FTP/5-min-power ≈ 85%, already high fractional utilization — further FTP gains need a higher ceiling via VO2max/threshold work, not better utilization; Odden et al. 2024 shows threshold and VO2max work both raise VO2max). A pure deficit-greedy selector systematically mis-selects for goal-driven athletes; the scorer makes goal-relevance an explicit, dominant factor and demotes the confident-limiter rule from "always wins" to a weighted bonus.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Vitest.

## Global Constraints

- This plan may land after `2026-07-15-season-critical-fixes.md` has already shipped a recency-based fallback in `nextBuildFocus` — this plan REPLACES that fallback with the fuller scored selector described below. Check the live `lib/season.ts` (not just plan files) before assuming which version of `nextBuildFocus` you're modifying (Task 4 Step 0 does this); as of writing it is the ORIGINAL two-state version — see Architecture.
- `2026-07-15-season-macro-structure.md`'s Task 1 expects a reusable scored-selector function as a drop-in for `backwardScheduleFromEvent`'s rotation: its `pickBuildFocus(limiter: SeasonDraftInput["limiter"], recentFocuses: SeasonFocus[]): SeasonFocus` contract (most-recent-last history in, one build focus out) is exactly `selectBuildFocus`'s first two parameters — the third (`signals`) is optional, so `selectBuildFocus(limiter, recentFocuses)` is directly callable by their delegation step. `scoreFocusCandidates`'s name deliberately matches their Step 0 detection grep (`scoreFocus|selectFocus|coverage`). Verified by hand-trace: every assertion their Task 1 pins (limiter preference incl. medium-confidence durability, never-repeat-last, anaerobic reachable from `["threshold","vo2max","durability"]`, empty-history tie-break → threshold, event-runway reaches anaerobic, confident limiter lands nearest the peak) passes under this scorer — no mismatch to note.
- Guard any new `fooMigratedAt`-style field with a truthy check, never `=== null`. (No migration flags are expected here; if one creeps in, this rule applies.)
- Use `localToday()` / `resolveToday()` for user-facing "what day is it" logic — never inline UTC `new Date().toISOString()` for that question. (The route already resolves `today` once at line 96; all new code takes `today`/`asOf` as a parameter.)
- Run everything with `npm` (`npm test` = `vitest run`; full gate = `npm run check`). Commit on `main`, small and atomic; stage ONLY files you touched (`git add <path>...`, never `git add -A`) — a concurrent agent session shares this checkout.
- Do not pin test fixtures whose pre-rounding value sits on a `.x5` float boundary (repo memory: IEEE rounding flips them). Score assertions below use ordering + `toBeCloseTo(…, 6)`, never exact rounded equality on derived floats.
- Line numbers below verified 2026-07-15 against `3c0a978`; a sibling plan landing first WILL shift them — re-read the live region before every edit.

---

### Task 1: Goal-relevance scoring — `goalRelevanceForFocus` (reusing session-requirements' negation-aware matching)

Does the athlete's stated goal/weakpoint text plausibly gate on a focus? Follow `deriveSessionRequirements`'s tag/keyword pattern (`lib/session-requirements.ts:20-58`) rather than inventing new NLP: the same clause-scoped negation matcher (`tagPresent`), new focus-weighted patterns. Key research-grounded choice baked into the FTP pattern's weights: an FTP/TTE goal makes BOTH `threshold` (1.0) and `vo2max` (0.8) goal-relevant — Odden et al. 2024, both session types meaningfully raise VO2max, and at this athlete's ~85% fractional utilization the ceiling is what gates further FTP — not just literal threshold sessions. No detected pattern → neutral 0.5 for every focus (absence of a goal must not distort the other factors).

**Files:**
- Modify: `lib/session-requirements.ts:51` (add `export` to `tagPresent` — one word, no behavior change)
- Modify: `lib/season.ts` (add imports at top; add `GOAL_PATTERNS` + `goalRelevanceForFocus` after `defaultBuildOrder`, ~line 36)
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: `tagPresent(haystack: string, re: RegExp): boolean` from `lib/session-requirements.ts` (newly exported).
- Produces: `export function goalRelevanceForFocus(goalText: string | undefined, focus: SeasonFocus): number` — 0..1, neutral 0.5 when text is absent/undetected. Task 3's scorer consumes it.

- [ ] **Step 1: Write the failing tests**

In `lib/season.test.ts`, add `goalRelevanceForFocus` to the named-import list from `"./season"` (line 2). Append at the end of the file:

```ts
describe("goalRelevanceForFocus — goal text gates focus relevance", () => {
  it("an FTP goal weights threshold AND vo2max high (Odden 2024: both raise the ceiling), anaerobic zero", () => {
    const goal = "Raise my FTP from 280 to 300 W and hold it longer";
    expect(goalRelevanceForFocus(goal, "threshold")).toBe(1);
    expect(goalRelevanceForFocus(goal, "vo2max")).toBe(0.8);
    expect(goalRelevanceForFocus(goal, "durability")).toBe(0.3);
    expect(goalRelevanceForFocus(goal, "anaerobic")).toBe(0);
  });
  it("a sprint goal weights anaerobic, a long-event goal weights durability", () => {
    expect(goalRelevanceForFocus("win the town-sign sprint", "anaerobic")).toBe(1);
    expect(goalRelevanceForFocus("finish a 200km gran fondo strong", "durability")).toBe(1);
    expect(goalRelevanceForFocus("finish a 200km gran fondo strong", "threshold")).toBe(0.5);
  });
  it("neutral 0.5 for every focus when text is empty, absent, or matches nothing", () => {
    for (const f of ["threshold", "vo2max", "anaerobic", "durability"] as const) {
      expect(goalRelevanceForFocus(undefined, f)).toBe(0.5);
      expect(goalRelevanceForFocus("", f)).toBe(0.5);
      expect(goalRelevanceForFocus("just ride and have fun", f)).toBe(0.5);
    }
  });
  it("negation in the same clause suppresses a pattern (session-requirements' clause matcher)", () => {
    expect(goalRelevanceForFocus("no FTP targets this year, just consistency", "threshold")).toBe(0.5);
    // negation in an EARLIER clause does not reach across — the FTP tag stands
    expect(goalRelevanceForFocus("no racing, but raise my FTP", "threshold")).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: FAIL — the new describe's tests fail with `TypeError: goalRelevanceForFocus is not a function` (missing export → `undefined`). All pre-existing tests still pass.

- [ ] **Step 3: Implement**

In `lib/session-requirements.ts` line 51, change `function tagPresent(` to `export function tagPresent(` (the doc comment above it stays).

In `lib/season.ts`, extend the import block at the top (currently lines 3–4) to:

```ts
import type { FocusPeriod, PlannedDay, SeasonEvent, SeasonFocus, SeasonPhase, SeasonPlan } from "./types";
import { DEFAULT_ACWR_BANDS } from "./calibration";
import { tagPresent } from "./session-requirements";
```

Then insert after `defaultBuildOrder` (after line 35):

```ts
// ---------- Coverage selector, factor 1: goal relevance ----------
// (2026-07-15-season-coverage-selector) Does the stated goal/weakpoint text plausibly gate on a focus?
// Same negation-aware clause matching as deriveSessionRequirements (lib/session-requirements.ts) — no
// new NLP. Research-grounded weight choice: an FTP/TTE goal makes BOTH threshold and vo2max relevant
// (Odden et al. 2024 — threshold and VO2max sessions raise VO2max comparably; at high fractional
// utilization the aerobic ceiling gates further FTP), so a goal-driven athlete is steered to the
// ceiling, not to a deficit-greedy "weakest system" pick. Regexes are lowercase-only (haystack is
// lowercased); a focus a fired pattern doesn't mention scores 0 (deliberately penalised vs neutral).
const GOAL_PATTERNS: Array<{ re: RegExp; weights: Partial<Record<SeasonFocus, number>> }> = [
  { re: /\b(ftp|tte|time.?trial|sustained|steady.?state|threshold)\b/, weights: { threshold: 1, vo2max: 0.8, durability: 0.3 } },
  { re: /\b(sprint|sprints|kick|snap|jump|neuromuscular)\b/, weights: { anaerobic: 1 } },
  { re: /\b(fondo|century|endurance|ultra|all.?day|long ride|long rides|kom|climb|climbs|climbing)\b/, weights: { durability: 1, threshold: 0.5 } },
];

// 0..1 relevance of a focus to the athlete's goal text. Neutral 0.5 when there is no text or no
// pattern fires (absence of a goal must not distort the other scoring factors). When patterns fire,
// the max weight across fired patterns wins; an unmentioned focus scores 0.
export function goalRelevanceForFocus(goalText: string | undefined, focus: SeasonFocus): number {
  const haystack = (goalText ?? "").toLowerCase();
  if (!haystack.trim()) return 0.5;
  const fired = GOAL_PATTERNS.filter((p) => tagPresent(haystack, p.re));
  if (fired.length === 0) return 0.5;
  return Math.max(...fired.map((p) => p.weights[focus] ?? 0));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts lib/session-requirements.test.ts`

Expected: PASS — new tests green; the session-requirements suite (if present) unaffected by the added `export`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/season.ts lib/season.test.ts lib/session-requirements.ts
git commit -m "feat(season): goal-relevance scoring — FTP goals weight threshold+vo2max, negation-aware

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Decay-urgency signals — `labelExposureWeeks` + `exposureFromSessions` (real sessions, not the plan's own labels)

Currently `replanSeasonArc`'s `recentFocuses` (`lib/season.ts:223`, `[...frozen, ...current].slice(-4).map(p => p.focus)`) is a closed loop over the plan's OWN period labels — the engine reasons about what it said, not what was generated. This task adds the reality-based signal: weeks since each focus last had MEANINGFUL exposure, computed from actual generated session types (`CurrentBlockDay.type` from `readCurrentBlock`/`readBlockHistory` days), with the label-derived estimate kept as the fallback for foci with no real session data in the window. Durability exposure is a Z2/Recovery ride that actually carries embedded threshold+ work (`carriesEmbeddedIntensity`, `lib/prescription.ts:67-77`) or a durability-template stamp — a plain easy spin is not durability training.

**Files:**
- Modify: `lib/season.ts` (import `carriesEmbeddedIntensity` + `WorkoutType`; add `labelExposureWeeks` + `SessionSample` + `exposureFromSessions` after `goalRelevanceForFocus`)
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: `SEASON_CONSTANTS.weeks` (`lib/season.ts:9`), `carriesEmbeddedIntensity(workoutText: string | undefined, ftp: number, embeddedHardPct?: number): boolean` from `lib/prescription.ts`.
- Produces:
  - `export function labelExposureWeeks(recentFocuses: SeasonFocus[], focus: SeasonFocus): number | null` — estimated weeks since `focus` last ended in a label history (most recent last); `0` when it is the last label; `null` = never appeared.
  - `export interface SessionSample { date: string; type: WorkoutType; durationMin: number; workoutText?: string; durabilityTemplate?: string }` — structurally satisfied by `CurrentBlockDay` and `PlannedDay`.
  - `export function exposureFromSessions(days: SessionSample[], ftp: number, asOf: string): Partial<Record<SeasonFocus, number>>` — whole weeks since the latest qualifying session per focus; a focus with no qualifying session is ABSENT from the record (so the selector falls back to labels for it). Tasks 3 and 7 consume both.

- [ ] **Step 1: Write the failing tests**

Add `labelExposureWeeks, exposureFromSessions` to the import list from `"./season"` in `lib/season.test.ts` line 2. Append:

```ts
describe("decay-urgency signals — label fallback + real-session exposure", () => {
  it("labelExposureWeeks: weeks since the focus last ended, KB default weeks per label", () => {
    expect(labelExposureWeeks(["aerobic-base", "threshold"], "threshold")).toBe(0); // it IS the last label
    expect(labelExposureWeeks(["threshold", "vo2max"], "threshold")).toBe(4); // one vo2max period (4 wk) since
    expect(labelExposureWeeks(["anaerobic", "threshold", "vo2max"], "anaerobic")).toBe(8); // 4 + 4
    expect(labelExposureWeeks(["threshold", "vo2max"], "durability")).toBeNull(); // never appeared
    expect(labelExposureWeeks([], "threshold")).toBeNull();
  });
  it("exposureFromSessions: weeks since the latest qualifying REAL session per focus", () => {
    const days = [
      { date: "2026-06-17", type: "Threshold" as const, durationMin: 75 }, // 2 whole weeks before asOf
      { date: "2026-06-10", type: "SIT" as const, durationMin: 45 }, // 3 weeks
      { date: "2026-05-20", type: "Threshold" as const, durationMin: 75 }, // older — latest wins
    ];
    const exp = exposureFromSessions(days, 280, "2026-07-01");
    expect(exp.threshold).toBe(2);
    expect(exp.anaerobic).toBe(3); // SIT is the anaerobic session type
    expect(exp.vo2max).toBeUndefined(); // no real VO2max session → absent → caller falls back to labels
  });
  it("durability exposure requires embedded intensity or a template stamp — a plain Z2 spin does not count", () => {
    const plain = { date: "2026-06-24", type: "Z2" as const, durationMin: 120, workoutText: "- 2h 65%" };
    const loaded = { date: "2026-06-17", type: "Z2" as const, durationMin: 180, workoutText: "Main Set 3x\n- 8m 92%" };
    const stamped = { date: "2026-06-10", type: "Z2" as const, durationMin: 180, durabilityTemplate: "C" };
    expect(exposureFromSessions([plain], 280, "2026-07-01").durability).toBeUndefined();
    expect(exposureFromSessions([plain, loaded], 280, "2026-07-01").durability).toBe(2);
    expect(exposureFromSessions([plain, stamped], 280, "2026-07-01").durability).toBe(3);
  });
  it("ignores zero-duration days and days after asOf", () => {
    const days = [
      { date: "2026-07-05", type: "VO2max" as const, durationMin: 60 }, // future vs asOf
      { date: "2026-06-17", type: "VO2max" as const, durationMin: 0 }, // rest-shaped placeholder
    ];
    expect(exposureFromSessions(days, 280, "2026-07-01").vo2max).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: FAIL — `TypeError: labelExposureWeeks is not a function` / `exposureFromSessions is not a function`. Everything else passes.

- [ ] **Step 3: Implement**

In `lib/season.ts`, change the types import (line 3) to include `WorkoutType`:

```ts
import type { FocusPeriod, PlannedDay, SeasonEvent, SeasonFocus, SeasonPhase, SeasonPlan, WorkoutType } from "./types";
```

and add below the `tagPresent` import:

```ts
import { carriesEmbeddedIntensity } from "./prescription";
```

Insert after `goalRelevanceForFocus` (Task 1's block):

```ts
// ---------- Coverage selector, factor 3 inputs: decay urgency ----------
// Estimated weeks since `focus` last ENDED in a label history (most recent last) — the fallback
// signal when no real session data covers a focus. The history carries no per-period week counts,
// so KB default weeks per label are the estimate. null = never appeared (maximally dark).
export function labelExposureWeeks(recentFocuses: SeasonFocus[], focus: SeasonFocus): number | null {
  const idx = recentFocuses.lastIndexOf(focus);
  if (idx === -1) return null;
  return recentFocuses.slice(idx + 1).reduce((sum, f) => sum + SEASON_CONSTANTS.weeks[f], 0);
}

// A generated session day, structurally satisfied by CurrentBlockDay and PlannedDay — the REAL
// exposure record, closing the "engine reasons about its own past labels, not reality" gap.
export interface SessionSample {
  date: string; // YYYY-MM-DD
  type: WorkoutType;
  durationMin: number;
  workoutText?: string;
  durabilityTemplate?: string;
}

// Whole weeks since the latest MEANINGFUL session per build focus, from actual generated days
// (block history + current block). Mapping: threshold←Threshold, vo2max←VO2max, anaerobic←SIT
// (mirrors mapSystemToFocus's vocabulary in app/api/generate/route.ts), durability←a Z2/Recovery
// ride that actually carries embedded threshold+ work (carriesEmbeddedIntensity) or a durability-
// template stamp — a plain easy spin is not durability training. A focus with no qualifying session
// is ABSENT from the result: the selector falls back to label-derived exposure for it, so real data
// wins where it exists and labels only fill the gaps.
export function exposureFromSessions(
  days: SessionSample[],
  ftp: number,
  asOf: string
): Partial<Record<SeasonFocus, number>> {
  const latest: Partial<Record<SeasonFocus, string>> = {};
  const note = (focus: SeasonFocus, date: string) => {
    if (!latest[focus] || date > latest[focus]!) latest[focus] = date;
  };
  for (const d of days) {
    if (d.date > asOf || d.durationMin <= 0) continue;
    if (d.type === "Threshold") note("threshold", d.date);
    else if (d.type === "VO2max") note("vo2max", d.date);
    else if (d.type === "SIT") note("anaerobic", d.date);
    else if ((d.type === "Z2" || d.type === "Recovery") && (d.durabilityTemplate || carriesEmbeddedIntensity(d.workoutText, ftp))) {
      note("durability", d.date);
    }
  }
  const out: Partial<Record<SeasonFocus, number>> = {};
  for (const [focus, date] of Object.entries(latest) as Array<[SeasonFocus, string]>) {
    out[focus] = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(date)) / (7 * 86_400_000)));
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: PASS. (The `loaded` fixture's `Main Set 3x\n- 8m 92%` yields 3×480 s = 1440 s ≥ the 300 s embedded-dose floor at ≥88% FTP; the `plain` fixture's 65% step is below the 80% work threshold — verified against `lib/prescription.ts` parsing.)

- [ ] **Step 5: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): real-session decay-urgency signal + label fallback for the coverage selector

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: The scorer + selector — `scoreFocusCandidates` / `selectBuildFocus` (+ execution factor from the intervention loop)

The core replacement. Score every candidate in `BUILD_FOCI` (`lib/season.ts:53`, `["threshold", "vo2max", "anaerobic", "durability"]`) as a weighted sum of five labeled parts; the selector drops the most recent focus (KB variety, preserved from every prior version) and returns the top scorer. The confident-limiter rule is demoted from "always wins" to a bonus term — with an FTP goal, a slow-trainability anaerobic limiter no longer dominates every slot. Execution quality (spec item 4) enters here as an explicit, separately-labeled fourth factor via the intervention loop's own accessor `execFor` (`lib/intervention.ts:32-36`, newly exported): a focus whose recent execution EWMA is poor is a weaker candidate for MORE emphasis right now.

Weights and constants (design decisions, stated once here and encoded as `SELECTOR_WEIGHTS`):
- goal 0.35, urgency 0.30, trainability 0.20, execution 0.15, limiter bonus 0.20 (high confidence; ×0.6 for medium; 0 for low).
- `FOCUS_TRAINABILITY`: threshold 1.0, vo2max 0.9, durability 0.6, anaerobic 0.3 — a fixed constant per focus (spec: don't over-engineer); sprint/anaerobic responds slowly (multi-season, strength-anchored per the research), threshold/vo2max respond within a mesocycle.
- Urgency saturates at 12 weeks (`min(weeks/12, 1)`); a NEVER-seen focus scores 1.3 (`NEVER_SEEN_URGENCY`) — beyond saturation, so total darkness always outranks "seen long ago". This exact constant is what makes the scorer satisfy the macro-structure sibling's pinned LRU-style tests without edits (hand-traced in this plan's prep).
- Physiology floor (spec): stated as `WEEKLY_INTENSITY_FLOOR = 1` with a citation comment — intensity EXPOSURE, not any label, is what must persist (Hickson et al. 1985: intensity preserved adaptations under a 2/3 volume cut; Odden et al. 2024: threshold and VO2max sessions raise VO2max comparably), and threshold/VO2max/anaerobic/sharpen quality all satisfy it. The selector deliberately has NO "literal `vo2max` label every N weeks" rule — forcing the label would fight goal-relevance while adding nothing physiological; the weekly quality floor itself is already enforced downstream by `BlockSettings.qualitySessionsPerLoadingWeek`.

**Files:**
- Modify: `lib/intervention.ts:30-36` (add `export` to `execFor`; extend its doc comment)
- Modify: `lib/season.ts` (imports; constants + `FocusSignals` + `FocusScore` + `scoreFocusCandidates` + `selectBuildFocus` + `execQualityByFocus`, inserted directly above `nextBuildFocus`, currently line 60)
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: Task 1's `goalRelevanceForFocus`, Task 2's `labelExposureWeeks`; `execFor(model: AthleteModel, dimension: string): number | null` from `lib/intervention.ts` (newly exported); `AthleteModel` type from `lib/types.ts`.
- Produces (Tasks 4 and 7 + the macro-structure sibling consume these):
  - `export interface FocusSignals { goalText?: string; exposure?: Partial<Record<SeasonFocus, number>>; execQuality?: Partial<Record<SeasonFocus, number>> }`
  - `export interface FocusScore { focus: SeasonFocus; score: number; parts: { goal: number; urgency: number; trainability: number; execution: number; limiter: number } }` (parts are the WEIGHTED contributions; they sum to `score`)
  - `export function scoreFocusCandidates(limiter: SeasonDraftInput["limiter"], recentFocuses: SeasonFocus[], signals?: FocusSignals): FocusScore[]` — all four build foci, sorted best-first, deterministic tie-break by `BUILD_FOCI` order
  - `export function selectBuildFocus(limiter: SeasonDraftInput["limiter"], recentFocuses: SeasonFocus[], signals?: FocusSignals): SeasonFocus` — never returns the most recent focus; with `signals` omitted it degrades to labels-only (the macro-structure sibling's drop-in call shape)
  - `export function execQualityByFocus(model: AthleteModel): Partial<Record<SeasonFocus, number>>`
  - `export const FOCUS_TRAINABILITY`, `export const WEEKLY_INTENSITY_FLOOR = 1`

- [ ] **Step 1: Write the failing tests**

Add `scoreFocusCandidates, selectBuildFocus, execQualityByFocus, FOCUS_TRAINABILITY, WEEKLY_INTENSITY_FLOOR, type FocusSignals` to the import list from `"./season"` in `lib/season.test.ts` line 2, and add `AthleteModel` to the type import from `"./types"` (line 3). Append:

```ts
describe("scoreFocusCandidates / selectBuildFocus — goal × trainability × urgency × execution", () => {
  const noLimiter = { system: null, confidence: "low" as const };
  const anHigh = { system: "anaerobic" as const, confidence: "high" as const };

  it("encodes the trainability constants and the intensity floor (Hickson 1985 / Odden 2024)", () => {
    expect(FOCUS_TRAINABILITY).toEqual({ threshold: 1.0, vo2max: 0.9, durability: 0.6, anaerobic: 0.3 });
    expect(WEEKLY_INTENSITY_FLOOR).toBe(1); // ≥1 quality session/wk at high %FTP — satisfiable by ANY quality label
  });

  it("returns all four build foci with labeled parts summing to the score", () => {
    const scored = scoreFocusCandidates(noLimiter, []);
    expect(scored.map((s) => s.focus).sort()).toEqual(["anaerobic", "durability", "threshold", "vo2max"]);
    for (const s of scored) {
      const { goal, urgency, trainability, execution, limiter } = s.parts;
      expect(goal + urgency + trainability + execution + limiter).toBeCloseTo(s.score, 6);
    }
    // empty history, no signals: neutral goal/exec, never-seen urgency for all → trainability decides
    expect(scored[0].focus).toBe("threshold");
    expect(scored[0].score).toBeCloseTo(0.35 * 0.5 + 0.3 * 1.3 + 0.2 * 1.0 + 0.15 * 0.5, 6); // 0.84
  });

  it("(a) an FTP goal ranks threshold and vo2max above a confident anaerobic limiter — goal-driven, not deficit-greedy", () => {
    const scored = scoreFocusCandidates(anHigh, ["aerobic-base"], { goalText: "Raise my FTP from 280 to 300 W" });
    expect(scored.map((s) => s.focus)).toEqual(["threshold", "vo2max", "anaerobic", "durability"]);
    expect(scored[0].score).toBeCloseTo(1.015, 6); // 0.35·1 + 0.3·1.3 + 0.2·1 + 0.15·0.5
    expect(scored[2].parts.limiter).toBeCloseTo(0.2, 6); // the limiter bonus is visible — just outweighed
  });

  it("(b) decay-urgency surfaces whichever focus has been dark longest", () => {
    const scored = scoreFocusCandidates(noLimiter, [], { exposure: { threshold: 1, vo2max: 2, anaerobic: 1, durability: 26 } });
    expect(scored[0].focus).toBe("durability"); // 26 weeks dark beats every trainability advantage
  });

  it("(c) breaks the two-state oscillation: confident anaerobic limiter, growing history — vo2max AND durability surface", () => {
    // Same reproduction scenario as the critical-fixes sibling: the old selector alternated
    // anaerobic → threshold forever; vo2max and durability were structurally unreachable.
    const recent: import("./types").SeasonFocus[] = ["aerobic-base"];
    const picks: import("./types").SeasonFocus[] = [];
    for (let i = 0; i < 6; i++) {
      const f = selectBuildFocus(anHigh, recent);
      picks.push(f);
      recent.push(f);
    }
    expect(picks).not.toEqual(["anaerobic", "threshold", "anaerobic", "threshold", "anaerobic", "threshold"]);
    expect(picks).toContain("vo2max");
    expect(picks).toContain("durability");
    expect(picks).toEqual(["anaerobic", "threshold", "vo2max", "durability", "anaerobic", "threshold"]); // hand-traced
  });

  it("(d) trainability keeps a slow-responding limiter from dominating every slot", () => {
    const recent: import("./types").SeasonFocus[] = ["aerobic-base"];
    const picks: import("./types").SeasonFocus[] = [];
    for (let i = 0; i < 6; i++) {
      const f = selectBuildFocus(anHigh, recent);
      picks.push(f);
      recent.push(f);
    }
    // Old behavior: anaerobic in every other slot (3 of 6). Scored: emphasis, not monopoly.
    expect(picks.filter((f) => f === "anaerobic").length).toBeLessThanOrEqual(2);
  });

  it("never returns the most recent focus — even the limiter", () => {
    expect(selectBuildFocus(anHigh, ["anaerobic"])).not.toBe("anaerobic");
  });

  it("poor execution on a focus hands a marginal FTP-goal slot to the alternative (explicit fourth factor)", () => {
    const goal = { goalText: "Raise my FTP from 280 to 300 W" };
    expect(selectBuildFocus(noLimiter, ["aerobic-base"], goal)).toBe("threshold");
    const flipped = selectBuildFocus(noLimiter, ["aerobic-base"], { ...goal, execQuality: { threshold: 2, vo2max: 9 } });
    expect(flipped).toBe("vo2max"); // threshold's recent execution is poor → weaker candidate for MORE emphasis
  });

  it("execQualityByFocus maps workout-type execution EWMAs onto build foci", () => {
    const stat = (type: import("./types").WorkoutType, execEwma: number) =>
      ({ type, n: 5, execEwma, complianceEwma: 90, trend: "flat" as const });
    const model: AthleteModel = {
      byType: [stat("Threshold", 3.2), stat("Z2", 7.1)],
      overallExecEwma: 6, overallTrend: "flat", sampleSize: 10,
      behaviour: { totalRides: 10, plannedRides: 8, unplannedRides: 2, offPlanPct: 20, unplannedAvgQuality: null, weeklyHours: 7 },
      behaviourAllTime: { totalRides: 40, plannedRides: 30, unplannedRides: 10, offPlanPct: 25, unplannedAvgQuality: null, weeklyHours: 7 },
    };
    expect(execQualityByFocus(model)).toEqual({ threshold: 3.2, durability: 7.1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: FAIL — every test in the new describe fails with `TypeError: scoreFocusCandidates is not a function` (and siblings for the other missing exports). Tasks 1–2 tests and all pre-existing tests still pass.

- [ ] **Step 3: Export `execFor` from the intervention loop**

In `lib/intervention.ts`, replace lines 30–36 (the comment + private function):

```ts
// Per-dimension execution quality (EWMA), the same number the model already tracks.
function execFor(model: AthleteModel, dimension: string): number | null {
  if (dimension === "Overall") return model.overallExecEwma || null;
  const t = model.byType.find((x) => x.type === dimension);
  return t ? t.execEwma : null;
}
```

with:

```ts
// Per-dimension execution quality (EWMA), the same number the model already tracks. Exported for the
// season coverage selector (lib/season.ts execQualityByFocus): focus selection reads the SAME accessor
// the validation loop scores against, so the two can't drift.
export function execFor(model: AthleteModel, dimension: string): number | null {
  if (dimension === "Overall") return model.overallExecEwma || null;
  const t = model.byType.find((x) => x.type === dimension);
  return t ? t.execEwma : null;
}
```

- [ ] **Step 4: Implement the scorer + selector in `lib/season.ts`**

Add to the imports (below the Task 2 `carriesEmbeddedIntensity` line):

```ts
import { execFor } from "./intervention";
import type { AthleteModel } from "./types";
```

(Or fold `AthleteModel` into the existing `./types` type-import line — either is fine; one import statement per module is the file's style, so prefer folding it in.)

Insert directly ABOVE `nextBuildFocus` (currently `lib/season.ts:60`; below `BUILD_FOCI` at line 53 and `needsBaseGate`):

```ts
// ---------- Coverage selector (2026-07-15-season-coverage-selector) ----------
// Scored build-focus selection: goal-relevance × decay-urgency × trainability × execution quality,
// with the confident limiter demoted from "always wins" to a bonus. Research grounding (athlete-
// approved): "train the weakest system" and "train the system that unlocks the goal" diverge — this
// athlete's weakest system (sprint/anaerobic) is durable and slow-to-respond, while his FTP constraint
// is the aerobic ceiling (FTP/5-min ≈ 85% fractional utilization), so a deficit-greedy selector
// systematically mis-selects. Physiology floor (Hickson et al. 1985; Odden et al. 2024): what must
// persist is INTENSITY EXPOSURE — ≥ WEEKLY_INTENSITY_FLOOR quality session(s)/week at a high fraction
// of FTP/VO2max, satisfiable by threshold, VO2max, anaerobic OR sharpen work — NOT any particular
// label, so there is deliberately no "literal vo2max every N weeks" rule here (it would fight
// goal-relevance while adding nothing physiological; the weekly floor itself is enforced downstream
// by BlockSettings.qualitySessionsPerLoadingWeek).
export const WEEKLY_INTENSITY_FLOOR = 1;

// Fixed responsiveness-per-week constant per focus (deliberately not modeled further): threshold/
// vo2max respond within a mesocycle; durability is slower; sprint/anaerobic gains are multi-season
// and strength-anchored.
export const FOCUS_TRAINABILITY: Record<"threshold" | "vo2max" | "anaerobic" | "durability", number> = {
  threshold: 1.0,
  vo2max: 0.9,
  durability: 0.6,
  anaerobic: 0.3,
};

const SELECTOR_WEIGHTS = { goal: 0.35, urgency: 0.3, trainability: 0.2, execution: 0.15, limiterBonus: 0.2 } as const;
const URGENCY_SATURATION_WEEKS = 12; // exposure this old (or older) is maximally urgent…
const NEVER_SEEN_URGENCY = 1.3; // …except NEVER seen, which outranks even saturated staleness.

// Optional reality signals for the selector. All absent → the selector degrades to label-only
// urgency with neutral goal/execution — the exact call shape the macro-structure sibling's
// pickBuildFocus delegation uses.
export interface FocusSignals {
  goalText?: string; // objective + block goal + goals/weakpoints, joined
  exposure?: Partial<Record<SeasonFocus, number>>; // weeks since real exposure (exposureFromSessions)
  execQuality?: Partial<Record<SeasonFocus, number>>; // execution EWMA 1–10 (execQualityByFocus)
}

export interface FocusScore {
  focus: SeasonFocus;
  score: number;
  parts: { goal: number; urgency: number; trainability: number; execution: number; limiter: number }; // weighted; sums to score
}

// Score all four build foci, best first. Each part is its WEIGHTED contribution so a caller (or a
// debug log) can read exactly why a focus won. Deterministic: ties break by BUILD_FOCI order.
export function scoreFocusCandidates(
  limiter: SeasonDraftInput["limiter"],
  recentFocuses: SeasonFocus[],
  signals?: FocusSignals
): FocusScore[] {
  const confBonus = limiter.confidence === "high" ? 1 : limiter.confidence === "medium" ? 0.6 : 0;
  return BUILD_FOCI.map((focus, i) => {
    // Urgency: real session exposure wins where it exists; the plan's own labels only fill the gaps.
    const weeks = signals?.exposure?.[focus] ?? labelExposureWeeks(recentFocuses, focus);
    const urgency = weeks === null || weeks === undefined ? NEVER_SEEN_URGENCY : Math.min(weeks / URGENCY_SATURATION_WEEKS, 1);
    const execEwma = signals?.execQuality?.[focus];
    const execution = execEwma === undefined ? 0.5 : Math.min(Math.max((execEwma - 1) / 9, 0), 1);
    const parts = {
      goal: SELECTOR_WEIGHTS.goal * goalRelevanceForFocus(signals?.goalText, focus),
      urgency: SELECTOR_WEIGHTS.urgency * urgency,
      trainability: SELECTOR_WEIGHTS.trainability * FOCUS_TRAINABILITY[focus as keyof typeof FOCUS_TRAINABILITY],
      execution: SELECTOR_WEIGHTS.execution * execution,
      limiter: focus === limiter.system ? SELECTOR_WEIGHTS.limiterBonus * confBonus : 0,
    };
    return { focus, i, score: parts.goal + parts.urgency + parts.trainability + parts.execution + parts.limiter, parts };
  })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ focus, score, parts }) => ({ focus, score, parts }));
}

// The selector: top-scored candidate that isn't the most recent focus (KB variety — never repeat
// back-to-back, preserved from every prior selector version). `signals` optional by design: this is
// the drop-in seam the macro-structure sibling's pickBuildFocus delegates to.
export function selectBuildFocus(
  limiter: SeasonDraftInput["limiter"],
  recentFocuses: SeasonFocus[],
  signals?: FocusSignals
): SeasonFocus {
  const last = recentFocuses[recentFocuses.length - 1] ?? null;
  return scoreFocusCandidates(limiter, recentFocuses, signals).filter((s) => s.focus !== last)[0].focus;
}

// Execution EWMA per build focus, via the intervention loop's own accessor (execFor) so focus
// selection and intervention validation read the SAME number. Durability's execution dimension is
// Z2 — durability rides are typed Z2 and scored there. Only foci with data appear.
export function execQualityByFocus(model: AthleteModel): Partial<Record<SeasonFocus, number>> {
  const dims: Array<[SeasonFocus, string]> = [
    ["threshold", "Threshold"],
    ["vo2max", "VO2max"],
    ["anaerobic", "SIT"],
    ["durability", "Z2"],
  ];
  const out: Partial<Record<SeasonFocus, number>> = {};
  for (const [focus, dim] of dims) {
    const e = execFor(model, dim);
    if (e !== null) out[focus] = e;
  }
  return out;
}
```

Note: `SeasonDraftInput` is declared at line 42 — ABOVE this insertion point — so the `SeasonDraftInput["limiter"]` references resolve. `BUILD_FOCI` (line 53) is also above. Do not move either.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts lib/intervention.test.ts`

Expected: PASS — all new scorer tests green (the hand-traced sequence in test (c) is `[anaerobic, threshold, vo2max, durability, anaerobic, threshold]`); the intervention suite (if present) unaffected by the `execFor` export.

- [ ] **Step 6: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/season.ts lib/season.test.ts lib/intervention.ts
git commit -m "feat(season): scored coverage selector — goal x trainability x urgency x execution, limiter demoted to a bonus

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire the selector into the draft loop — `SeasonDraftInput.focusSignals`, `nextBuildFocus` delegation, sibling conditionals

`draftSeasonArc`'s build loop (currently `lib/season.ts:105-114`) calls the old selector; this task routes it through `selectBuildFocus` with the new optional `focusSignals`, and turns `nextBuildFocus` into a thin delegating wrapper (kept exported — existing tests and any sibling code reference it; signature unchanged, so the critical-fixes plan's "no signature changes" contract holds even if it landed first).

**Files:**
- Modify: `lib/season.ts:42-51` (`SeasonDraftInput` — add optional field), `lib/season.ts:60-73` (`nextBuildFocus` — replace body with delegation; if the critical-fixes LRU landed first this region is ~30 lines instead of 14 — replace the whole function either way), `lib/season.ts:105-114` (`draftSeasonArc` loop — one call-site change)
- Possibly modify: `lib/season.test.ts` (one pinned-sequence test IF the critical-fixes sibling landed first — Step 0)
- Possibly modify: `lib/season.ts` `pickBuildFocus` (IF the macro-structure sibling landed first — Step 0)
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: Task 3's `selectBuildFocus` + `FocusSignals`.
- Produces: `SeasonDraftInput.focusSignals?: FocusSignals` (optional ⇒ every existing caller/fixture compiles unchanged); `nextBuildFocus(limiter, recentFocuses)` now = `selectBuildFocus(limiter, recentFocuses)` (labels-only). `replanSeasonArc` needs NO edit — its `draftSeasonArc({ ...input, recentFocuses }, draftStart)` spread forwards `focusSignals` automatically. Task 7 populates the field from the route.

- [ ] **Step 0: Detect which sibling code is live (decides two conditional sub-steps below)**

Run: `cd "/Users/otis/Cycling App" && grep -n "lastIndexOf\|pickBuildFocus" lib/season.ts && grep -n "not a two-state trap" lib/season.test.ts`

- As of plan-writing: no output from either grep — the original two-state `nextBuildFocus` is live, no `pickBuildFocus`, no pinned LRU test. Steps 4b/4c below are then SKIPPED.
- `lastIndexOf` inside `nextBuildFocus` and/or the test-grep hit ⇒ the critical-fixes LRU landed → Step 4b applies.
- `pickBuildFocus` present ⇒ the macro-structure sibling landed → Step 4c applies.

- [ ] **Step 1: Write the failing tests**

Append to `lib/season.test.ts` (uses the existing `baseInput` helper, lines 29–32):

```ts
describe("draftSeasonArc — scored coverage selection (replaces the two-state/LRU selector)", () => {
  const anHigh = { system: "anaerobic" as const, confidence: "high" as const };
  it("one horizon reaches all four build systems under a confident anaerobic limiter (hand-traced)", () => {
    // baseInput's recentFocuses = ["aerobic-base", "threshold"] → base gate silent → 4 builds + sharpen.
    const arc = draftSeasonArc(baseInput({ limiter: anHigh }), "2026-07-01");
    const builds = arc.filter((p) => p.phase === "build" && p.focus !== "sharpen").map((p) => p.focus);
    expect(builds).toEqual(["anaerobic", "vo2max", "durability", "threshold"]);
  });
  it("focusSignals flow through the draft: an FTP goal leads the arc with threshold/vo2max, not the anaerobic limiter", () => {
    const arc = draftSeasonArc(
      baseInput({ limiter: anHigh, recentFocuses: ["aerobic-base"], focusSignals: { goalText: "Raise my FTP from 280 to 300 W" } }),
      "2026-07-01"
    );
    const builds = arc.filter((p) => p.phase === "build" && p.focus !== "sharpen").map((p) => p.focus);
    expect(builds.slice(0, 2)).toEqual(["threshold", "vo2max"]);
    expect(builds[0]).not.toBe("anaerobic");
  });
  it("nextBuildFocus delegates to the scored selector (labels-only) — old contracts hold", () => {
    expect(nextBuildFocus({ system: "vo2max", confidence: "high" }, ["threshold"])).toBe("vo2max"); // limiter bonus wins
    expect(nextBuildFocus({ system: null, confidence: "low" }, ["threshold"])).toBe("vo2max"); // trainability tie-break
    expect(nextBuildFocus({ system: "threshold", confidence: "high" }, ["threshold"])).not.toBe("threshold"); // never repeat
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected:
- Against the ORIGINAL two-state selector: the first test fails with `expected [ 'anaerobic', 'threshold', 'anaerobic', 'threshold' ] to deeply equal [ 'anaerobic', 'vo2max', 'durability', 'threshold' ]`; the second fails at compile-or-assert (`focusSignals` not yet a `SeasonDraftInput` property — `Object literal may only specify known properties`, surfaced by vitest as a transform/type error — or, with a lax transform, `builds[0]` is `"anaerobic"`). The delegation test's three assertions pass by coincidence on old code — that is fine; the first two tests carry the red.
- Against the critical-fixes LRU (if landed): same failure shapes, different actual sequences.

- [ ] **Step 3: Implement**

In `SeasonDraftInput` (`lib/season.ts:42-51`), add after `heavyFatigue: boolean;`:

```ts
  // Optional reality signals for the scored coverage selector (goal text, real session exposure,
  // execution EWMAs). Absent → labels-only selection (every pre-existing caller/fixture unchanged).
  focusSignals?: FocusSignals;
```

Replace `nextBuildFocus` — the ENTIRE comment + function, whichever version is live (original two-state at lines 60–73, or the critical-fixes LRU version) — with:

```ts
// Thin wrapper kept for existing call sites/tests: labels-only scored selection. The scored selector
// (selectBuildFocus, above) replaced both the original "first non-last of defaultBuildOrder()" fallback
// and the interim least-recently-used fallback (2026-07-15-season-critical-fixes) — the limiter is now
// a weighted bonus, not an unconditional winner.
export function nextBuildFocus(
  limiter: SeasonDraftInput["limiter"],
  recentFocuses: SeasonFocus[]
): SeasonFocus {
  return selectBuildFocus(limiter, recentFocuses);
}
```

In `draftSeasonArc`'s build loop (currently line 106; if the macro-structure sibling restructured the loop around `pushReset()`/arc caps, the same one-line call is inside its while-loop), change:

```ts
    const focus = nextBuildFocus(input.limiter, recent);
```

to:

```ts
    const focus = selectBuildFocus(input.limiter, recent, input.focusSignals);
```

Touch nothing else in the loop — the rationale branches, `recent.push(focus)`, cursor advance (and any sibling-added arc-cap logic) stay as they are.

- [ ] **Step 4a: Run tests**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: PASS if Step 0 found no sibling code. Otherwise one or both conditional steps below fix the remaining reds, then re-run.

- [ ] **Step 4b (CONDITIONAL — only if Step 0 found the critical-fixes tests): update the superseded pinned sequence**

The critical-fixes plan's Task 2 added `it("confident-limiter rotation eventually surfaces every build focus — not a two-state trap", ...)` pinning the LRU sequence `["anaerobic", "threshold", "anaerobic", "vo2max", "anaerobic", "durability"]`. The scored selector produces `["anaerobic", "threshold", "vo2max", "durability", "anaerobic", "threshold"]` for the same scenario (hand-traced; Task 3's test (c) pins it). In that test, replace ONLY the final `expect(picks).toEqual([...])` line with:

```ts
    expect(picks).toEqual(["anaerobic", "threshold", "vo2max", "durability", "anaerobic", "threshold"]); // scored selector (coverage plan) — supersedes the interim LRU sequence
```

The test's other assertions (`not.toEqual` the trap, `toContain("vo2max")`, `toContain("durability")`) stay — they specify behavior both selectors satisfy. The critical-fixes `REGRESSION: the fallback is least-recently-used…` test passes UNCHANGED under the scorer (hand-verified: `["threshold","anaerobic"]` → vo2max 0.82 top; `["threshold","vo2max","anaerobic"]` → durability 0.76 top) — do not touch it.

- [ ] **Step 4c (CONDITIONAL — only if Step 0 found `pickBuildFocus`): delegate the event-path seam**

Replace `pickBuildFocus`'s body (keep its signature and doc comment, appending one line to the comment):

```ts
// Delegated to the scored coverage selector (2026-07-15-season-coverage-selector) — same contract.
export function pickBuildFocus(
  limiter: SeasonDraftInput["limiter"],
  recentFocuses: SeasonFocus[]
): SeasonFocus {
  return selectBuildFocus(limiter, recentFocuses);
}
```

The macro-structure plan's `pickBuildFocus` tests pass unchanged under the scorer (hand-verified during plan prep: anaerobic-high/`["threshold"]` → anaerobic 0.90; durability-medium/`[]` → durability 0.88 vs threshold 0.84; `["threshold","vo2max","durability"]` → anaerobic 0.70 vs threshold 0.625; empty-history tie-break → threshold; the event-runway tests reach anaerobic and land the confident limiter nearest the peak). If any assertion still fails, STOP and re-trace before editing their tests — the deviation must be understood, not suppressed.

- [ ] **Step 5: Run the full season suite green**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: PASS — including the pre-existing `replanSeasonArc` idempotency tests (the scorer is deterministic over unchanged inputs, so fixed-point replans are preserved) and `drafts base(if gated) → rotating build periods → a realize week` (shape-based assertions only).

- [ ] **Step 6: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): draft loop selects via the scored coverage selector; nextBuildFocus delegates

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Season-fit focus-match validation — `validateFocusMatch`

`validateSeasonFit` (`lib/season.ts:339-366`) only checks intensity share vs a period's split — never whether a period's generated session types match its own `focus` label. Add a COMPANION validator (a separate function, so `validateSeasonFit`'s pinned-wording tests stay untouched) flagging a build-focus period whose block days include zero sessions of the implied `WorkoutType`. Mapping (the reverse of `mapSystemToFocus` in `app/api/generate/route.ts:48-59`, in spirit): `vo2max`→`VO2max`, `threshold`→`Threshold`, `anaerobic`→`SIT`, `durability`→a `Z2`/`Recovery` day carrying embedded intensity (`carriesEmbeddedIntensity`) or a durability-template stamp. Only fires when the block's days give the period a fair chance: the bucket must span ≥ 7 calendar days (a period the block brushes for a weekend can't owe it a quality session). Warning text matches the existing `"Season fit: ..."` phrasing.

**Files:**
- Modify: `lib/season.ts` (add `validateFocusMatch` directly after `validateSeasonFit`, ~line 366)
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: `periodForDate` (line 252), `carriesEmbeddedIntensity` (imported in Task 2), `PlannedDay` (has `workoutText`; no `durabilityTemplate` — the stamp check uses the optional property via `(d as { durabilityTemplate?: string })` — NO: keep it clean, `PlannedDay` lacks the stamp so the durability matcher uses `carriesEmbeddedIntensity` only; noted in the code comment).
- Produces: `export function validateFocusMatch(days: PlannedDay[], plan: SeasonPlan, ftp: number): string[]` — Task 7 calls it from the route next to `validateSeasonFit`.

- [ ] **Step 1: Write the failing tests**

Add `validateFocusMatch` to the import list from `"./season"` (line 2). Append (reuses the file's existing `planWith` helper, line 148, and the `day` fixture pattern from the `validateSeasonFit` describe):

```ts
describe("validateFocusMatch — a period's label must match its generated sessions", () => {
  const day = (date: string, type: PlannedDay["type"], durationMin: number, workoutText = ""): PlannedDay =>
    ({ date, weekNumber: 1, weekTheme: "", name: type, type, durationMin, workoutText, description: "" });
  const vo2Period = { focus: "vo2max" as const, phase: "build" as const, startDate: "2026-08-02", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 450, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "high" as const };
  const duraPeriod = { ...vo2Period, focus: "durability" as const };

  it("flags a vo2max period whose block days carry zero VO2max sessions", () => {
    const days = [
      day("2026-08-03", "Z2", 120), day("2026-08-05", "Threshold", 75), day("2026-08-07", "Z2", 120),
      day("2026-08-10", "Threshold", 75), day("2026-08-12", "Z2", 120),
    ];
    const w = validateFocusMatch(days, planWith([vo2Period]), 280);
    expect(w.length).toBe(1);
    expect(w[0]).toContain("Season fit:");
    expect(w[0]).toContain("vo2max period");
    expect(w[0]).toContain("VO2max");
  });
  it("stays silent when the implied session type is present", () => {
    const days = [
      day("2026-08-03", "Z2", 120), day("2026-08-05", "VO2max", 60), day("2026-08-07", "Z2", 120),
      day("2026-08-10", "Threshold", 75), day("2026-08-12", "Z2", 120),
    ];
    expect(validateFocusMatch(days, planWith([vo2Period]), 280)).toEqual([]);
  });
  it("durability: a plain-Z2 week fails, an embedded-intensity Z2 week passes (carriesEmbeddedIntensity)", () => {
    const plain = [
      day("2026-08-03", "Z2", 150, "- 2h 65%"), day("2026-08-05", "Z2", 120, "- 2h 65%"),
      day("2026-08-10", "Z2", 180, "- 3h 65%"),
    ];
    expect(validateFocusMatch(plain, planWith([duraPeriod]), 280).length).toBe(1);
    const loaded = [
      day("2026-08-03", "Z2", 150, "- 2h 65%"),
      day("2026-08-10", "Z2", 180, "Warmup\n- 15m 55%\n\nMain Set 3x\n- 8m 92%"), // real durability insert
    ];
    expect(validateFocusMatch(loaded, planWith([duraPeriod]), 280)).toEqual([]);
  });
  it("does not fire when the block only brushes the period (< 7 calendar days of overlap)", () => {
    const days = [day("2026-08-03", "Z2", 120), day("2026-08-05", "Z2", 120)]; // 3-day span
    expect(validateFocusMatch(days, planWith([vo2Period]), 280)).toEqual([]);
  });
  it("ignores base/sharpen periods, rest/strength days, and uncovered dates", () => {
    const base = { ...vo2Period, focus: "aerobic-base" as const, phase: "base" as const };
    const days = [
      day("2026-08-03", "Z2", 120), day("2026-08-05", "Rest", 0), day("2026-08-07", "Strength", 45),
      day("2026-08-12", "Z2", 120), day("2026-09-20", "Z2", 120), // last date: no covering period
    ];
    expect(validateFocusMatch(days, planWith([base]), 280)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: FAIL — `TypeError: validateFocusMatch is not a function` across the new describe. All else green.

- [ ] **Step 3: Implement**

Insert directly after `validateSeasonFit`'s closing brace (~line 366):

```ts
// Companion to validateSeasonFit (same non-blocking "Season fit: ..." contract): does a build period's
// actual generated training match its own focus LABEL? Intensity-share can pass while the label lies —
// a "vo2max" period full of threshold work is a plan/label disagreement worth surfacing. Mapping is the
// reverse of the route's mapSystemToFocus vocabulary: vo2max→VO2max, threshold→Threshold, anaerobic→SIT,
// durability→a Z2/Recovery ride actually carrying embedded threshold+ work (carriesEmbeddedIntensity —
// PlannedDay carries no durability-template stamp, so the parsed prescription is the evidence). Only
// fires when the block gives the period a fair chance: the period's bucket must span ≥ 7 calendar days.
// aerobic-base/sharpen imply no specific quality type and are skipped.
export function validateFocusMatch(days: PlannedDay[], plan: SeasonPlan, ftp: number): string[] {
  const matchers: Partial<Record<SeasonFocus, { label: string; match: (d: PlannedDay) => boolean }>> = {
    vo2max: { label: "VO2max", match: (d) => d.type === "VO2max" },
    threshold: { label: "Threshold", match: (d) => d.type === "Threshold" },
    anaerobic: { label: "SIT (anaerobic)", match: (d) => d.type === "SIT" },
    durability: {
      label: "durability-loaded Z2 (embedded threshold+ work)",
      match: (d) => (d.type === "Z2" || d.type === "Recovery") && carriesEmbeddedIntensity(d.workoutText, ftp),
    },
  };
  const warnings: string[] = [];
  const buckets = new Map<FocusPeriod, PlannedDay[]>();
  for (const d of days) {
    if (d.type === "Rest" || d.type === "Strength") continue;
    const p = periodForDate(plan, d.date);
    if (!p) continue;
    const rides = buckets.get(p);
    if (rides) rides.push(d);
    else buckets.set(p, [d]);
  }
  for (const [p, rides] of buckets) {
    const m = matchers[p.focus];
    if (!m) continue;
    const dates = rides.map((d) => d.date).sort();
    const spanDays = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000;
    if (spanDays < 6) continue; // the block only brushes this period — it doesn't owe it a session
    if (rides.some(m.match)) continue;
    warnings.push(
      `Season fit: ${dates[0]} → ${dates[dates.length - 1]} sits in a ${p.focus} period but carries zero ${m.label} sessions — the period's focus label and its prescribed training disagree.`
    );
  }
  return warnings;
}
```

Note: `periodForDate` (line 252) is declared BELOW this insertion point in the current file — that is fine (hoisted function declarations), matching how `validateSeasonFit` already calls it from line 347.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: PASS — including every pre-existing `validateSeasonFit` test (untouched function).

- [ ] **Step 5: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): validateFocusMatch — flag periods whose sessions contradict their focus label

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Close the achievedTss loop — `achievedTssForPeriod`

`replanSeasonArc` freezes elapsed periods with `p.achievedTss ?? achievedTssFor(p)` (`lib/season.ts:208`), but the route wires `achievedTssFor` to `() => null` (`app/api/generate/route.ts:245`) — achieved load is never actually stamped. Source decision: the SCORE-LOG LEDGER (`RideScoreEntry.tss`, `lib/types.ts:464+`), NOT `SyncData.activities[].trainingLoad`. Rationale: the ledger is immutable and accumulates across blocks ("accumulates over time so the trends view can chart execution quality across blocks"), while `last-sync.json` is a rolling ~45-day window — a period replanned late could have aged out of the sync window entirely, whereas its ledger entries persist. Every synced ride (planned AND off-plan) gets a ledger entry with `tss: number | null`, so the sum is complete where TSS existed at all.

**Files:**
- Modify: `lib/season.ts` (types import + `achievedTssForPeriod` inserted directly after `replanSeasonArc`, ~line 231)
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: module-private `periodEnd` (line 189), `RideScoreEntry` type from `lib/types.ts`.
- Produces: `export function achievedTssForPeriod(entries: Array<Pick<RideScoreEntry, "date" | "tss">>, period: FocusPeriod): number | null` — rounded sum of ledger TSS inside `[startDate, periodEnd)`; `null` when no entry in range carries a non-null tss (no data ≠ zero load). Task 7 wires it as the route's `achievedTssFor`.

- [ ] **Step 1: Write the failing tests**

Add `achievedTssForPeriod` to the import list from `"./season"` (line 2). Append:

```ts
describe("achievedTssForPeriod — real achieved load from the score-log ledger", () => {
  const period: FocusPeriod = {
    focus: "threshold", phase: "build", startDate: "2026-06-01", plannedWeeks: 3, intensitySplit: "80/20",
    targetWeeklyTss: 420, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
  }; // covers 2026-06-01 → 2026-06-22 (exclusive)
  it("sums ledger tss inside [startDate, periodEnd) — end-exclusive, matching periodForDate", () => {
    const entries = [
      { date: "2026-06-01", tss: 80 }, // first day: in
      { date: "2026-06-10", tss: 100.4 },
      { date: "2026-06-21", tss: 50 }, // last covered day: in
      { date: "2026-06-22", tss: 999 }, // period end: OUT (exclusive)
      { date: "2026-05-31", tss: 999 }, // before: out
    ];
    expect(achievedTssForPeriod(entries, period)).toBe(230); // round(80 + 100.4 + 50)
  });
  it("skips null-tss entries but still sums the rest", () => {
    expect(achievedTssForPeriod([{ date: "2026-06-05", tss: null }, { date: "2026-06-06", tss: 120 }], period)).toBe(120);
  });
  it("returns null (not 0) when no in-range entry carries tss — no data is not zero load", () => {
    expect(achievedTssForPeriod([], period)).toBeNull();
    expect(achievedTssForPeriod([{ date: "2026-06-05", tss: null }], period)).toBeNull();
    expect(achievedTssForPeriod([{ date: "2026-07-05", tss: 300 }], period)).toBeNull(); // outside the range
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: FAIL — `TypeError: achievedTssForPeriod is not a function`. All else green.

- [ ] **Step 3: Implement**

Add `RideScoreEntry` to the type import from `"./types"` in `lib/season.ts` (the line Task 2/3 extended). Insert directly after `replanSeasonArc`'s closing brace (~line 231):

```ts
// Real achieved load for a period, summed from the score-log ledger (RideScoreEntry.tss) — the
// immutable, long-lived record (last-sync.json is a rolling ~45-day window that can age a period
// out before it's stamped; the ledger can't). End-EXCLUSIVE range, matching periodForDate's
// straddling definition. null when no in-range entry carries a tss: "no data" must stay
// distinguishable from "zero load" (replanSeasonArc stamps achievedTss once, ?? keeps retrying
// null until data exists). Wired as the route's achievedTssFor (closes the `() => null` gap).
export function achievedTssForPeriod(
  entries: Array<Pick<RideScoreEntry, "date" | "tss">>,
  period: FocusPeriod
): number | null {
  const end = periodEnd(period);
  const inRange = entries.filter((e) => e.date >= period.startDate && e.date < end && e.tss !== null);
  if (inRange.length === 0) return null;
  return Math.round(inRange.reduce((sum, e) => sum + (e.tss as number), 0));
}
```

Note: `periodEnd` is a module-private `const` arrow function at line 189, declared ABOVE `replanSeasonArc` — this insertion point sits below it, so the reference resolves at module init.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): achievedTssForPeriod — real achieved load from the score-log ledger

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Route wiring — feed real signals, real achieved TSS, and the focus-match check into `/api/generate`

Everything the selector needs is ALREADY read in the route's parallel load (`app/api/generate/route.ts:100-114`: `scoreLog`, `currentBlock`, `blockHistory`, `profile`) and `athleteModel` is built at line 162 — this task only wires it through. Three changes: (1) the replan input gains `focusSignals`, (2) `() => null` becomes the real `achievedTssForPeriod` closure, (3) `validateFocusMatch` joins the warnings pass next to `validateSeasonFit`. No new "today" logic — everything anchors on the already-resolved `today` (`resolveToday`, line 96), satisfying the local-today constraint.

**Files:**
- Modify: `app/api/generate/route.ts` (import line 39; replan call ~lines 241–247; warnings line ~337)

**Interfaces:**
- Consumes: `exposureFromSessions`, `execQualityByFocus`, `achievedTssForPeriod`, `validateFocusMatch` (Tasks 2, 3, 5, 6); route locals `existingSeason`, `blockParams`, `profile`, `currentBlock`, `blockHistory`, `scoreLog`, `athleteModel`, `today`, `replannedSeason`.
- Produces: nothing new — the season replan now persists real `achievedTss` stamps and selects with real signals; generation warnings may now include focus-match lines.

- [ ] **Step 1: Extend the season import**

Change `app/api/generate/route.ts:39` from:

```ts
import { formatSeasonContext, replanSeasonArc, validateSeasonFit } from "@/lib/season";
```

to:

```ts
import { achievedTssForPeriod, execQualityByFocus, exposureFromSessions, formatSeasonContext, replanSeasonArc, validateFocusMatch, validateSeasonFit } from "@/lib/season";
```

(If the macro-structure sibling landed first, the line also carries `formatRetestNote` — keep it; merge alphabetically.)

- [ ] **Step 2: Wire signals + achieved TSS into the replan call**

Replace the `replanSeasonArc` call (currently lines 241–247) — the surrounding try/catch, `writeSeasonPlan`, and `formatSeasonContext` lines stay byte-identical:

```ts
      const replanned = replanSeasonArc(
        existingSeason,
        { objective: existingSeason.objective, events: existingSeason.events, ctl: sync?.fitness.ctl ?? null, ftp: profile.performance.ftp, recentWeeklyTss: baselines.avgTss90d != null ? Math.round(baselines.avgTss90d * 7) : null, limiter, recentFocuses: [], // ignored — replanSeasonArc derives this itself from the plan's frozen+current periods
          heavyFatigue: !!(signals.loadRamp?.triggered),
          // Coverage selector signals: what the athlete SAYS they want (goal text), what was REALLY
          // generated (session exposure from the current block + archived block days — not the plan's
          // own period labels), and how execution has actually been going per system.
          focusSignals: {
            goalText: [
              existingSeason.objective,
              blockParams.goal,
              ...blockParams.weakpoints,
              ...profile.goals.map((g) => `${g.goal} ${g.target}`),
              ...profile.weakpoints.map((w) => `${w.weakpoint} ${w.detail}`),
            ].join(" \n "),
            exposure: exposureFromSessions(
              [...(currentBlock?.days ?? []), ...blockHistory.flatMap((h) => h.days ?? [])].filter((d) => d.date <= today),
              profile.performance.ftp,
              today
            ),
            execQuality: execQualityByFocus(athleteModel),
          } },
        (p) => achievedTssForPeriod(scoreLog.entries, p),
        today
      );
```

- [ ] **Step 3: Add the focus-match warnings pass**

Directly after the existing `validateSeasonFit` line (currently line 337):

```ts
    if (replannedSeason) warnings.push(...validateSeasonFit(days, replannedSeason, profile.performance.ftp));
```

add:

```ts
    // Coverage plan: flag a period whose focus LABEL and generated session types disagree (a "vo2max"
    // period with zero VO2max sessions) — intensity-share alone can pass while the label lies.
    if (replannedSeason) warnings.push(...validateFocusMatch(days, replannedSeason, profile.performance.ftp));
```

- [ ] **Step 4: Typecheck + full unit suite**

Run: `cd "/Users/otis/Cycling App" && npm run check`

Expected: PASS — `tsc --noEmit` clean (proves `CurrentBlockDay[]` structurally satisfies `SessionSample[]` and the closure matches `achievedTssFor: (period: FocusPeriod) => number | null`), eslint clean, all vitest suites green. The route has no test harness — the pure functions are fully covered by Tasks 1–6; this wiring is verified by the typecheck now and the live run in Task 8. Concurrent-agent rule: a failure in a file this plan never touched → `git status --short <file>` first; uncommitted = the other session's WIP; wait ~30s, retry once, report if it persists.

- [ ] **Step 5: Commit**

```bash
cd "/Users/otis/Cycling App"
git add app/api/generate/route.ts
git commit -m "feat(generate): wire coverage-selector signals, real achievedTss, and focus-match warnings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Integration — full gate + live smoke run (REQUIRED, not skippable)

**Files:**
- Verify (no planned edits): `lib/season.ts`, `lib/season.test.ts`, `lib/intervention.ts`, `lib/session-requirements.ts`, `app/api/generate/route.ts`. Fix-forward anything surfaced, committing per the rules above.

**Interfaces:**
- Consumes: everything Tasks 1–7 landed.
- Produces: a verified, shippable state.

- [ ] **Step 1: Full static + test gate**

Run: `cd "/Users/otis/Cycling App" && npm run check`

Expected: PASS — `tsc --noEmit` clean, eslint clean, every vitest suite green (including `lib/intervention.test.ts` and `lib/session-requirements.test.ts` if present — both files gained only an `export` keyword).

- [ ] **Step 2: Confirm the sibling seam is discoverable**

Run: `cd "/Users/otis/Cycling App" && grep -n "scoreFocus\|selectFocus\|coverage" lib/season.ts | head -5`

Expected: hits on `scoreFocusCandidates` and the coverage-selector comments — this is the exact grep the macro-structure sibling's Task 1 Step 0 runs to detect that the scored selector exists; it MUST find something, or that plan will hand-roll a duplicate selector.

- [ ] **Step 3: Live smoke run (MANDATORY per AGENTS.md — LLM-backed path)**

Unit tests + a green build only prove the deterministic scaffolding; block generation is the LLM-backed path that exercises the replan → selector → validation chain for real. Run it once against the live API and read the actual output:

1. Start the dev server (`npm run dev`, or the `.claude/launch.json` `nodevelo` config if present) and open `/plan`.
2. Generate a real block (a real Anthropic call — expected and required).
3. Read `data/season-plan.json` after generation and confirm:
   - **Selector escapes the trap:** the drafted future periods are NOT a strict anaerobic/threshold alternation — with this athlete's confident anaerobic limiter, `vo2max` and/or `durability` periods appear in the drafted horizon (the hand-trace says all four systems appear within one horizon).
   - **Goal steering:** if the athlete's objective/goals mention FTP (they do — check `data/athlete.json` goals), the leading drafted build periods skew threshold/vo2max, not anaerobic.
   - **achievedTss stamps:** any period that has already ended carries a numeric `achievedTss` (not absent) — the `() => null` gap is closed. If every period is still current/future, force the check: temporarily note the values and re-verify on the next natural replan instead of fabricating a past period.
4. Re-generate (or re-plan by generating again the next day) at least once more and confirm the drafted tail rotates rather than repeating — a few replans should surface VO2max/durability periods, per the plan's goal.
5. **Focus-match warning, both directions:** confirm via the generation response's `warnings` array (visible in the UI and in the returned plan JSON):
   - **Silent on a matched block:** the freshly generated block, whose sessions should match its period's focus, produces NO `"…focus label and its prescribed training disagree"` warning.
   - **Fires on a deliberately-mismatched fixture:** run the deterministic check directly (no second paid generation needed) — `npx vitest run lib/season.test.ts -t "flags a vo2max period"` re-confirms the firing path; then, for the LIVE path, temporarily edit `data/season-plan.json`'s current period `focus` to a system the just-generated block does NOT train (e.g. `"anaerobic"` when the block has no SIT), regenerate once, confirm the warning appears in the response, then let the replan restore the drafted periods (or revert the edit).
6. If anything reads wrong, fix forward with a targeted commit — do not ship on green units alone.

- [ ] **Step 4: Push**

```bash
cd "/Users/otis/Cycling App"
git push
```

Expected: all task commits land on `main`. Nothing else staged or swept up.

---

## Requirement coverage map (self-review)

| Spec requirement | Task |
|---|---|
| 1. Scored selector: goal-relevance (session-requirements pattern reuse, FTP→threshold+vo2max per Odden 2024) | Task 1 (patterns + `goalRelevanceForFocus`), Task 3 (weight 0.35) |
| 1. Trainability-per-week fixed constant (`Record<SeasonFocus, number>`, no over-engineering) | Task 3 (`FOCUS_TRAINABILITY`) |
| 1. Decay-urgency from REAL generated sessions (block history/current block), label fallback only where data is missing | Task 2 (`exposureFromSessions` + `labelExposureWeeks`), Task 3 (merge: `signals.exposure[f] ?? labelExposureWeeks`), Task 7 (route feeds real days) |
| 1. Physiology floor as an explicit design constant citing Hickson 1985 + Odden 2024; explicitly NO literal-`vo2max`-label rule, with the "why not" stated | Task 3 (`WEEKLY_INTENSITY_FLOOR` + comment; Architecture) |
| 1. TDD (a) goal-relevance weights FTP-goal focuses | Task 1 tests + Task 3 test "(a)" |
| 1. TDD (b) decay-urgency surfaces the darkest focus | Task 3 test "(b)" (+ Task 2 unit tests) |
| 1. TDD (c) full scorer breaks the two-state oscillation (same repro as critical-fixes; vo2max AND durability surface) | Task 3 test "(c)", Task 4 arc-level test |
| 1. TDD (d) trainability stops a low-trainability limiter dominating every slot | Task 3 test "(d)" |
| Replaces the critical-fixes LRU fallback if it landed first (live-file check, stated finding) | Architecture (finding: NOT landed, original two-state live @ 3c0a978); Task 4 Steps 0/3/4b |
| Macro-structure Task 1 drop-in: exported selector callable as `(limiter, recentFocuses)`; their detection grep must hit | Task 3 (`selectBuildFocus` optional 3rd param; `scoreFocusCandidates` name), Task 4 Step 4c (delegation if theirs landed first), Task 8 Step 2 (grep check); Global Constraints (hand-trace: their pinned tests pass — no mismatch to note) |
| 2. Season-fit focus-match validation (focus→WorkoutType map incl. durability via `carriesEmbeddedIntensity`; "Season fit: …" phrasing) | Task 5, wired in Task 7 Step 3 |
| 3. Close the achievedTss loop (real per-ride TSS; source decision stated: score-log ledger over rolling sync window) | Task 6, wired in Task 7 Step 2 |
| 4. Wire `lib/intervention.ts` execution quality in as an explicit, separately-labeled fourth factor | Task 3 (`execFor` export, `execQualityByFocus`, `parts.execution`, flip test), Task 7 (route feeds `athleteModel`) |
| Update `app/api/generate/route.ts` call sites for signature changes | Task 7 (only external call site; `replanSeasonArc`/`validateSeasonFit` signatures unchanged — additions only) |
| Final integration: `npm run check` clean + live verification (selector rotation over replans; focus-match fires on mismatch, silent on match) as a REQUIRED manual step per AGENTS.md | Task 8 |
| Global constraints (migration-flag truthy checks; localToday/resolveToday; float-boundary fixtures) | Header; no new migration flags or "today" computations introduced (all new code takes `today`/`asOf` as parameters); score assertions use ordering/`toBeCloseTo` |

**Placeholder scan (done):** no TBD/TODO/"appropriate handling"/"similar to Task N" anywhere; every test step carries full code and every implementation step carries the complete function bodies; expected failure messages are stated per red step.

**Signature consistency (done):** `selectBuildFocus(limiter: SeasonDraftInput["limiter"], recentFocuses: SeasonFocus[], signals?: FocusSignals)` is identical in Tasks 3 (definition), 4 (draft-loop + `nextBuildFocus`/`pickBuildFocus` delegation), and the Global Constraints contract; `FocusSignals` field names (`goalText`/`exposure`/`execQuality`) match between Task 3's interface and Task 7's route literal; `achievedTssForPeriod(entries, period)` matches Task 7's `(p) => achievedTssForPeriod(scoreLog.entries, p)` against `replanSeasonArc`'s `achievedTssFor: (period: FocusPeriod) => number | null`; `validateFocusMatch(days, plan, ftp)` matches Task 7's call; `exposureFromSessions(days, ftp, asOf)` matches Task 7's `(…, profile.performance.ftp, today)`.




