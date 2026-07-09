# UX v2 Wave 3 — Trends Rebuild Implementation Plan (+ Task 0 lint fix)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute UX-MASTERPLAN v2 Wave 3 — Trends stops being a chart pile: fold-1 becomes a one-sentence three-axis verdict (engine · delivery · fueling, each honestly derived and linking to its group) plus the ranked coach insights with validation marks; the nine equal sections become four named groups (ENGINE / DELIVERY / LOAD & FUEL / MILESTONES) with the Delivery merge (per-session bars ↔ per-type planned-vs-actual as one card with a toggle); the "Last 7 days" tile row and the mission-statement intro die. Task 0 (independent): fix the pre-existing `react-hooks/set-state-in-effect` lint error in `SeasonRoadmap.tsx` so `npm run check` is green for every wave gate.

**Architecture:** Client-side only — `/api/trends` and its payload are untouched (every axis derives from series the payload already carries). One new pure lib module (`lib/trends-verdict.ts`, TDD) computes the verdict; one new component file (`components/trends/verdict.tsx`) renders fold-1; `components/trends/sections.tsx` gains the merged `DeliveryCard` and a collapsed `BlockTimeline`; `components/Trends.tsx` is rewritten as the grouped page. Spec: `UX-MASTERPLAN.md` §5 + §7.3.

**Tech Stack:** Next.js 16 App Router · React 19 · Tailwind v4 · TypeScript 5 · Vitest.

## Global Constraints

- **Run commands with `npm`** (`npm test` = `vitest run`, `npm run build`, `npm run check` = tsc + lint + test).
- **This checkout is shared with a concurrent agent session.** Stage only files you touched (`git add <path>...`), never `git add -A` / `git add .`. Before editing a file, `git status --short <file>` — uncommitted foreign changes: wait ~30s, re-check once, else STOP and report BLOCKED. A build error in a file you did NOT edit: status-check it first; uncommitted = other agent mid-edit (wait, retry once, else stop and report).
- **Commit directly on `main`** (trunk-based; no branch).
- **This Next.js version differs from training data.** Read `node_modules/next/dist/docs/` before writing code if any App Router API question arises.
- **No API/payload changes.** `TrendsData` (components/trends/types.ts) and `app/api/trends/route.ts` stay untouched — the wave is presentation + one pure client lib.
- **The strip must never disagree with the per-chart labels:** the verdict's halves-comparison uses the same midpoint/epsilon shape as `trendDir` (components/trends/sections.tsx:9-21).
- **Float-boundary fixtures:** don't pin expectations whose pre-rounding value sits ON a .x5 boundary (IEEE floats flip them) — pick fixture numbers that land clear of rounding edges.
- **Verification model:** Task 1 is TDD. Everything else is JSX — gates are `npm run check` (now green thanks to Task 0), `npm run build`, and the controller's live preview walk (dark first). No LLM path changes (AGENTS.md smoke rule not triggered).
- **Out of scope (later waves):** Plan hero/week strip (W5), Profile dossier and Model groups (W4), any mobile restructure. The `zones` and `behaviour` payload fields stay unused by the page — leave them.

---

### Task 0: Fix `react-hooks/set-state-in-effect` in SeasonRoadmap (repo-wide lint green)

**Files:**
- Modify: `components/ui.tsx` (extend `useMountLoad`)
- Modify: `components/SeasonRoadmap.tsx`

**Interfaces:**
- Produces: `useMountLoad(load: () => Promise<void>, refreshKey?: number)` — optional second param; existing single-arg callers are unaffected.

**Why this fix:** the rule flags `void load()` called directly in an effect because it can statically trace `load`'s `setState` calls; the codebase's own convention (`useMountLoad` in ui.tsx — state touched only after the first `await`) is the sanctioned pattern, and the hook's parameter indirection is exactly why every other loader passes the rule. Extending the hook with a `refreshKey` keeps SeasonRoadmap's re-fetch-on-save behavior identical.

- [ ] **Step 1: Extend the hook**

In `components/ui.tsx`, replace the `useMountLoad` function (keeping its comment block, appending one sentence to it):

```tsx
// Fetch-on-mount for a best-effort loader that owns a visible failed state — the other half of the
// LoadFailed convention below. `load` must be a stable useCallback that touches state only after
// its first await (post-microtask), so the effect never sets state synchronously; the same `load`
// doubles as LoadFailed's retry. An optional `refreshKey` re-runs the fetch when it changes (e.g.
// a parent bumps it after a save) — same rules, not just the initial mount.
export function useMountLoad(load: () => Promise<void>, refreshKey?: number) {
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
}
```

- [ ] **Step 2: Use it in SeasonRoadmap**

In `components/SeasonRoadmap.tsx`:
1. Change the react import to `import { useCallback, useState } from "react";` (drop `useEffect`).
2. Change the ui import to `import { LoadFailed, useMountLoad } from "./ui";`.
3. Replace the plain effect (the `// Plain effect (not useMountLoad) …` comment and the `useEffect(() => { void load(); }, [load, refreshKey]);` block) with:

```tsx
  // useMountLoad's refreshKey re-runs the fetch after a Season save bumps it, not just on mount.
  useMountLoad(load, refreshKey);
```

- [ ] **Step 3: Verify**

Run: `npx eslint components/SeasonRoadmap.tsx components/ui.tsx` → no errors. Run: `npm run check` → tsc clean, lint clean repo-wide, all tests pass. Run: `npm run build` → clean.

- [ ] **Step 4: Commit**

```bash
git add components/ui.tsx components/SeasonRoadmap.tsx
git commit -m "fix(lint): route SeasonRoadmap fetch through useMountLoad(refreshKey) — set-state-in-effect"
```

---

### Task 1: `lib/trends-verdict.ts` — the three-axis derivation (TDD)

**Files:**
- Create: `lib/trends-verdict.ts`, `lib/trends-verdict.test.ts`

**Interfaces:**
- Consumes: `eaLevel(kcalPerKg): "low" | "adequate" | "ample"` from `@/lib/nutrition` (bands <25 / <40 / ≥40, body-weight basis).
- Produces: `deriveTrendsVerdict(input): TrendsVerdict` where input is `{ ctl: {value}[], ef: {value}[], scores: {executionScore}[], energy: {burnKcal, intakeKcal, weightKg}[] }` (structural subsets of the `TrendsData` fields) and `TrendsVerdict = { word: "Improving"|"Holding"|"Mixed"|"Slipping"|null, axes: VerdictAxis[] }`, `VerdictAxis = { key: "engine"|"delivery"|"fueling", label: string, dir: "up"|"steady"|"down"|null, derivation: string }`. Task 2 consumes.

- [ ] **Step 1: Write the failing tests**

Create `lib/trends-verdict.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveTrendsVerdict } from "./trends-verdict";

const pts = (...values: number[]) => values.map((value) => ({ value }));
const scores = (...s: number[]) => s.map((executionScore) => ({ executionScore }));
// One complete logged week: intake/burn totals against a median weight.
const week = (intakeKcal: number, burnKcal: number, weightKg: number) => ({ intakeKcal, burnKcal, weightKg });

describe("deriveTrendsVerdict — axes", () => {
  it("engine ↑ when CTL and Pw:HR both rise", () => {
    const v = deriveTrendsVerdict({ ctl: pts(50, 52, 58, 62), ef: pts(1.2, 1.22, 1.3, 1.34), scores: [], energy: [] });
    const engine = v.axes.find((a) => a.key === "engine")!;
    expect(engine.dir).toBe("up");
    expect(engine.label).toBe("engine ↑");
  });
  it("engine steady when the two signals disagree", () => {
    const v = deriveTrendsVerdict({ ctl: pts(50, 52, 58, 62), ef: pts(1.4, 1.38, 1.3, 1.26), scores: [], energy: [] });
    expect(v.axes.find((a) => a.key === "engine")!.dir).toBe("steady");
  });
  it("engine uses the one signal that exists when the other is thin", () => {
    const v = deriveTrendsVerdict({ ctl: pts(50, 52, 58, 62), ef: pts(1.3), scores: [], energy: [] });
    expect(v.axes.find((a) => a.key === "engine")!.dir).toBe("up");
  });
  it("delivery carries the average and direction of the last 24 scores", () => {
    const v = deriveTrendsVerdict({ ctl: [], ef: [], scores: scores(5, 5, 5, 5, 8, 8, 8, 8), energy: [] });
    const d = v.axes.find((a) => a.key === "delivery")!;
    expect(d.dir).toBe("up");
    expect(d.label).toBe("delivery ↑ (avg 6.5/10)");
  });
  it("fueling bands via the weekly EA proxy — adequate reads on target", () => {
    // (17500 − 3500) / 7 / 70 = 28.6 kcal/kg/day → adequate
    const v = deriveTrendsVerdict({ ctl: [], ef: [], scores: [], energy: [week(17500, 3500, 70)] });
    const f = v.axes.find((a) => a.key === "fueling")!;
    expect(f.dir).toBe("steady");
    expect(f.label).toBe("fueling on target");
  });
  it("fueling low reads running low with dir down", () => {
    // (10500 − 3500) / 7 / 70 = 14.3 → low
    const v = deriveTrendsVerdict({ ctl: [], ef: [], scores: [], energy: [week(10500, 3500, 70)] });
    const f = v.axes.find((a) => a.key === "fueling")!;
    expect(f.dir).toBe("down");
    expect(f.label).toBe("fueling running low");
  });
  it("weeks missing either series are excluded from the fueling read", () => {
    const v = deriveTrendsVerdict({
      ctl: [], ef: [], scores: [],
      energy: [{ intakeKcal: null, burnKcal: 3500, weightKg: 70 }, week(24500, 3500, 70)], // 21000/7/70 = 42.9 → ample
    });
    expect(v.axes.find((a) => a.key === "fueling")!.label).toBe("fueling ample");
  });
});

describe("deriveTrendsVerdict — the word", () => {
  const goodEngine = { ctl: pts(50, 52, 58, 62), ef: pts(1.2, 1.22, 1.3, 1.34) };
  const flatScores = scores(7, 7, 7, 7, 7, 7);
  it("Improving: engine up, delivery steady, fueling fine", () => {
    const v = deriveTrendsVerdict({ ...goodEngine, scores: flatScores, energy: [week(17500, 3500, 70)] });
    expect(v.word).toBe("Improving");
  });
  it("low fueling drags Improving down to Holding, never lifts", () => {
    const v = deriveTrendsVerdict({ ...goodEngine, scores: flatScores, energy: [week(10500, 3500, 70)] });
    expect(v.word).toBe("Holding");
  });
  it("Slipping: engine and delivery both falling", () => {
    const v = deriveTrendsVerdict({
      ctl: pts(62, 58, 52, 48), ef: pts(1.34, 1.3, 1.22, 1.18),
      scores: scores(8, 8, 8, 8, 5, 5, 5, 5), energy: [],
    });
    expect(v.word).toBe("Slipping");
  });
  it("Mixed: engine down but delivery up lands between", () => {
    const v = deriveTrendsVerdict({
      ctl: pts(62, 58, 52, 48), ef: pts(1.34, 1.3, 1.22, 1.18),
      scores: scores(5, 5, 5, 5, 8, 8, 8, 8), energy: [],
    });
    expect(v.word).toBe("Mixed");
  });
  it("no verdict at all without an engine or delivery read", () => {
    const v = deriveTrendsVerdict({ ctl: pts(50), ef: [], scores: [], energy: [week(17500, 3500, 70)] });
    expect(v.word).toBeNull();
    expect(v.axes.find((a) => a.key === "engine")!.label).toBe("engine — no read yet");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/trends-verdict.test.ts`
Expected: FAIL — `lib/trends-verdict.ts` does not exist.

- [ ] **Step 3: Implement**

Create `lib/trends-verdict.ts`:

```ts
// The Trends fold-1 verdict (UX v2 §5): three axes — engine, delivery, fueling — each honestly
// derived from series the /api/trends payload already carries, combined into one page verdict.
// Pure and deterministic so the derivation is testable and each axis tip can state it plainly
// (Constitution §5: every number answers "where did this come from?").

import { eaLevel } from "./nutrition";

export type AxisDir = "up" | "steady" | "down";

export interface VerdictAxis {
  key: "engine" | "delivery" | "fueling";
  // Strip chip text, e.g. "engine ↑" · "delivery → (avg 7.4/10)" · "fueling on target".
  label: string;
  dir: AxisDir | null; // null = not enough data; the chip renders muted, honestly "no read yet"
  derivation: string; // the tip naming the derivation (Constitution §5)
}

export interface TrendsVerdict {
  // The one-word page answer; null = not enough data for any verdict (the strip renders a quiet
  // empty-state line instead of pretending).
  word: "Improving" | "Holding" | "Mixed" | "Slipping" | null;
  axes: VerdictAxis[];
}

// First-half vs second-half mean comparison — the same midpoint/epsilon shape as trendDir
// (components/trends/sections.tsx) so the strip never disagrees with the per-chart labels.
function halvesDir(values: number[]): AxisDir | null {
  if (values.length < 4) return null;
  const mid = Math.floor(values.length / 2);
  const a = values.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
  const b = values.slice(mid).reduce((s, v) => s + v, 0) / (values.length - mid);
  const eps = Math.max(0.02, Math.abs(a) * 0.02);
  if (Math.abs(b - a) < eps) return "steady";
  return b - a > 0 ? "up" : "down";
}

const ARROW: Record<AxisDir, string> = { up: "↑", steady: "→", down: "↓" };

export function deriveTrendsVerdict(input: {
  ctl: Array<{ value: number }>;
  ef: Array<{ value: number }>;
  scores: Array<{ executionScore: number }>;
  energy: Array<{ burnKcal: number | null; intakeKcal: number | null; weightKg: number | null }>;
}): TrendsVerdict {
  // ENGINE — CTL slope + Pw:HR trend, both higher-is-better. Both must agree to move the axis
  // (disagreement is honestly "steady"); a one-signal read uses the signal that exists.
  const ctlDir = halvesDir(input.ctl.map((p) => p.value));
  const efDir = halvesDir(input.ef.map((p) => p.value));
  const engineDir: AxisDir | null =
    ctlDir === null ? efDir : efDir === null ? ctlDir : ctlDir === efDir ? ctlDir : "steady";

  // DELIVERY — execution average + direction over the last 24 scored sessions (the payload's
  // scores already exclude legacy + compromised rides).
  const recent = input.scores.slice(-24).map((s) => s.executionScore);
  const deliveryTrend = halvesDir(recent);
  const avg = recent.length >= 2 ? Math.round((recent.reduce((s, v) => s + v, 0) / recent.length) * 10) / 10 : null;
  const deliveryDir: AxisDir | null = deliveryTrend ?? (avg !== null ? "steady" : null);

  // FUELING — the weekly EA proxy: (weekly intake − weekly ride burn) ÷ 7 ÷ median weight,
  // banded by the same eaLevel bands as Today's EA tile (body-weight basis, non-clinical),
  // averaged over the last ≤4 complete weeks where both series were logged.
  const fuelWeeks = input.energy
    .filter((e) => e.burnKcal !== null && e.intakeKcal !== null && e.weightKg !== null && e.weightKg > 0)
    .slice(-4);
  let fuelingDir: AxisDir | null = null;
  let fuelingLabel = "fueling — no read yet";
  if (fuelWeeks.length > 0) {
    const perKg =
      fuelWeeks.reduce(
        (s, e) => s + ((e.intakeKcal as number) - (e.burnKcal as number)) / 7 / (e.weightKg as number),
        0
      ) / fuelWeeks.length;
    const level = eaLevel(perKg);
    fuelingDir = level === "low" ? "down" : "steady";
    fuelingLabel = level === "low" ? "fueling running low" : level === "ample" ? "fueling ample" : "fueling on target";
  }

  const axes: VerdictAxis[] = [
    {
      key: "engine",
      label: engineDir ? `engine ${ARROW[engineDir]}` : "engine — no read yet",
      dir: engineDir,
      derivation:
        "CTL slope (fitness trajectory) and the Pw:HR trend on steady outdoor rides, first half of each series vs the second. Both rising = the motor is getting bigger; disagreement reads as steady.",
    },
    {
      key: "delivery",
      label:
        deliveryDir && avg !== null
          ? `delivery ${ARROW[deliveryDir]} (avg ${avg}/10)`
          : "delivery — no read yet",
      dir: deliveryDir,
      derivation:
        "Execution-score average and direction over your last 24 matched sessions (compromised and pre-block rides excluded) — do you deliver what's prescribed?",
    },
    {
      key: "fueling",
      label: fuelingLabel,
      dir: fuelingDir,
      derivation:
        "Weekly logged intake minus ride burn, per kg body weight per day, over the last complete logged weeks — the same energy-availability bands as Today's EA tile. Under-logged intake reads low.",
    },
  ];

  // The word: engine carries double weight (the page question is adaptation); low fueling can
  // drag the word down but never lift it. No engine AND no delivery read → no verdict at all.
  if (engineDir === null && deliveryDir === null) return { word: null, axes };
  const val = (d: AxisDir | null) => (d === "up" ? 1 : d === "down" ? -1 : 0);
  const score = 2 * val(engineDir) + val(deliveryDir) + (fuelingDir === "down" ? -1 : 0);
  const word = score >= 2 ? "Improving" : score >= 0 ? "Holding" : score >= -2 ? "Mixed" : "Slipping";
  return { word, axes };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lib/trends-verdict.test.ts` → all pass. Run: `npm test` → full suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/trends-verdict.ts lib/trends-verdict.test.ts
git commit -m "feat(trends): three-axis verdict derivation lib (UX v2 W3)"
```

---

### Task 2: `components/trends/verdict.tsx` — VerdictStrip + InsightsFold

**Files:**
- Create: `components/trends/verdict.tsx`

**Interfaces:**
- Consumes: `deriveTrendsVerdict` (Task 1); `Card`, `InfoDot` from `../ui`; `Insight` from `@/lib/types`; `TrendsData` from `./types`.
- Produces: `VerdictStrip({ data: TrendsData })` and `InsightsFold({ insights, validation, recentInterventions })` — Task 4's page consumes both. Axis chips link to `#group-engine` / `#group-delivery` / `#group-fuel` (Task 4 must give the groups those ids).

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useMemo } from "react";
import { deriveTrendsVerdict, type VerdictAxis } from "@/lib/trends-verdict";
import type { Insight } from "@/lib/types";
import { Card, InfoDot } from "../ui";
import type { TrendsData } from "./types";

// Fold-1 of /trends (UX v2 §5): the one-sentence three-axis verdict — each axis linking to its
// group below, derivation stated per axis (Constitution §5) — then the ranked coach insights
// with their validation marks: top 3 visible, the rest (and the track record) one disclosure away.

const DIR_CLS: Record<string, string> = {
  up: "text-green-600 dark:text-emerald-400",
  steady: "text-zinc-600 dark:text-zinc-300",
  down: "text-amber-600 dark:text-amber-400",
};

const WORD_CLS: Record<string, string> = {
  Improving: "text-green-600 dark:text-emerald-400",
  Holding: "text-zinc-800 dark:text-zinc-100",
  Mixed: "text-amber-600 dark:text-amber-400",
  Slipping: "text-red-600 dark:text-red-400",
};

const AXIS_GROUP: Record<VerdictAxis["key"], string> = {
  engine: "#group-engine",
  delivery: "#group-delivery",
  fueling: "#group-fuel",
};

export function VerdictStrip({ data }: { data: TrendsData }) {
  const verdict = useMemo(
    () => deriveTrendsVerdict({ ctl: data.ctl, ef: data.ef, scores: data.scores, energy: data.energy }),
    [data]
  );
  if (!verdict.word) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
        Not enough history for a verdict yet — it appears once a few weeks of rides and scores accumulate.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
      <span className={`text-xl font-bold ${WORD_CLS[verdict.word]}`}>{verdict.word}</span>
      <span aria-hidden className="text-zinc-400 dark:text-zinc-500">—</span>
      {verdict.axes.map((axis, i) => (
        <span key={axis.key} className="flex items-baseline gap-1 text-sm">
          {axis.dir ? (
            <a href={AXIS_GROUP[axis.key]} className={`font-medium hover:underline ${DIR_CLS[axis.dir]}`}>
              {axis.label}
            </a>
          ) : (
            <span className="text-zinc-500 dark:text-zinc-400">{axis.label}</span>
          )}
          <InfoDot text={axis.derivation} align={axis.key === "fueling" ? "right" : "left"} />
          {i < verdict.axes.length - 1 && <span aria-hidden className="ml-1 text-zinc-300 dark:text-zinc-600">·</span>}
        </span>
      ))}
    </div>
  );
}

// Ranked: alert (act) first, then watch, then good — stable within a severity.
const SEV_RANK: Record<Insight["severity"], number> = { alert: 0, watch: 1, good: 2 };

export function InsightsFold({
  insights,
  validation,
  recentInterventions,
}: {
  insights: Insight[];
  validation: TrendsData["validation"];
  recentInterventions: TrendsData["recentInterventions"];
}) {
  if (insights.length === 0) return null;
  const ranked = [...insights].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const top = ranked.slice(0, 3);
  const rest = ranked.slice(3);
  // Validation mark: this dimension's matured hit rate, when any insight of its kind has been
  // evaluated (Constitution §5: has this kind of advice been right before?).
  const mark = (dimension: string) => {
    const d = validation?.byDimension.find((x) => x.dimension === dimension);
    return d && d.hitRate !== null ? d : null;
  };
  const row = (ins: Insight, i: number) => {
    const dot = ins.severity === "alert" ? "bg-red-500" : ins.severity === "watch" ? "bg-amber-500" : "bg-green-500";
    const m = mark(ins.dimension);
    return (
      <li key={`${ins.dimension}-${i}`} className="flex items-start gap-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
            {ins.title}
            {m && (
              <span
                title={`How often acting on matured ${ins.dimension} insights proved right (${m.validated} validated of ${m.validated + m.refuted + m.inconclusive} evaluated).`}
                className="ml-1.5 font-mono text-[10px] font-normal text-green-700 dark:text-emerald-400"
              >
                ✓ {m.hitRate}%
              </span>
            )}
          </p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {ins.evidence} <span className="text-zinc-700 dark:text-zinc-300">→ {ins.suggestion}</span>
          </p>
        </div>
      </li>
    );
  };
  // Narrowed const (not a bare boolean) so TypeScript keeps the non-null type inside the JSX.
  const track = validation !== null && (validation.evaluated > 0 || validation.pending > 0) ? validation : null;
  return (
    <Card title="Coach insights" hint="ranked · learned from your execution history">
      <ul className="space-y-1.5">{top.map(row)}</ul>
      {(rest.length > 0 || track !== null) && (
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {rest.length > 0 ? `${rest.length} more · track record` : "Track record"}
          </summary>
          {rest.length > 0 && <ul className="mt-2 space-y-1.5">{rest.map((ins, i) => row(ins, top.length + i))}</ul>}
          {track && (
            <div className="mt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Insight track record · {track.evaluated} evaluated · {track.pending} pending
              </p>
              {recentInterventions.length > 0 ? (
                <ul className="mt-1.5 space-y-1.5">
                  {recentInterventions.map((iv, i) => {
                    const ivDot =
                      iv.verdict === "validated" ? "bg-green-500" : iv.verdict === "refuted" ? "bg-red-500" : "bg-zinc-400";
                    const deltas = [
                      iv.execDelta != null ? `exec ${iv.execDelta > 0 ? "+" : ""}${iv.execDelta}` : null,
                      iv.physDelta != null ? `${iv.physMetric} ${iv.physDelta > 0 ? "+" : ""}${iv.physDelta}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li key={i} className="flex items-start gap-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${ivDot}`} />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-zinc-800 dark:text-zinc-100">{iv.title}</p>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            <span className="uppercase tracking-wide">{iv.verdict}</span>
                            {deltas ? ` · ${deltas}` : ""} · since {iv.firedAt}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-1.5 rounded-md bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  {track.pending} intervention{track.pending === 1 ? "" : "s"} recorded — outcomes evaluate after ~4 weeks.
                </p>
              )}
              <p className="mt-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                Whether acting on each past insight actually moved execution or a physiological marker — the closed learning loop.
              </p>
            </div>
          )}
        </details>
      )}
      <p className="mt-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">These also steer the next block you generate.</p>
    </Card>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run build` → clean (file compiles; no caller yet, page unchanged). Run: `npm run check` → green.

- [ ] **Step 3: Commit**

```bash
git add components/trends/verdict.tsx
git commit -m "feat(trends): verdict strip + ranked insights fold components (UX v2 W3)"
```

---

### Task 3: sections.tsx — the Delivery merge card + collapsed block history

**Files:**
- Modify: `components/trends/sections.tsx`

**Interfaces:**
- Consumes: existing `ScoreBars`, `PlanVsActual` (both stay exported, now rendered through the new card); `Card` from `../ui`.
- Produces: `DeliveryCard({ scores, planVsActual, ftpRetest })` — one card, two zoom levels of one question (the §5 Delivery merge). `BlockTimeline` keeps its signature but collapses its list behind a `<details>`.

- [ ] **Step 1: Make the file a client module and extend imports**

At the top of `components/trends/sections.tsx`, add `"use client";` as the first line (the new card holds toggle state), and change the ui import to `import { Card, CyberFrame } from "../ui";` plus add `import { useState } from "react";`.

- [ ] **Step 2: Add `DeliveryCard`** (after `PlanVsActual`):

```tsx
// The §5 Delivery merge: per-session execution bars and per-type planned-vs-actual are the same
// question ("do I ride what's prescribed?") at two zoom levels, so they share one card with a
// toggle instead of two rival sections.
export function DeliveryCard({
  scores,
  planVsActual,
  ftpRetest,
}: {
  scores: ScoreEntry[];
  planVsActual: TrendsData["planVsActual"];
  ftpRetest: TrendsData["ftpRetest"];
}) {
  const [view, setView] = useState<"sessions" | "types">("sessions");
  const hasSessions = scores.length >= 2;
  const hasTypes = planVsActual.length > 0;
  if (!hasSessions && !hasTypes) return null;
  const shown = view === "types" && hasTypes ? "types" : hasSessions ? "sessions" : "types";
  return (
    <Card
      title="Execution quality"
      hint={shown === "sessions" ? "per-ride completion score" : "by session type · last 90 days"}
      tip={
        shown === "sessions"
          ? "How completely you delivered each session (1–10): duration × power against the plan, over your last 24 matched rides. Taller / greener = better execution; the immutable score the coach and trends read from."
          : "Prescription vs delivery for each planned session type over the trailing 90 days: the FTP-derived target IF band, your mean ridden IF, completion and execution. Consistently delivering above the band at high completion triggers the FTP re-test advisory."
      }
      action={
        hasSessions && hasTypes ? (
          <div className="flex gap-1">
            {(["sessions", "types"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={shown === v}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  shown === v
                    ? "bg-zinc-900 text-white dark:bg-[#00d4ff]/15 dark:text-[#00d4ff] dark:ring-1 dark:ring-[#00d4ff]/40"
                    : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                }`}
              >
                {v === "sessions" ? "Sessions" : "By type"}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      {shown === "sessions" ? <ScoreBars scores={scores} /> : <PlanVsActual rows={planVsActual} ftpRetest={ftpRetest} />}
    </Card>
  );
}
```

- [ ] **Step 3: Collapse the block-history list**

In `BlockTimeline`, keep the section shell, heading, sub-line, and empty state exactly as they are; wrap ONLY the populated `<ol>…</ol>` in a disclosure (masterplan §5: block history stays collapsed at the bottom):

```tsx
      ) : (
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Show {blocks.length} block{blocks.length === 1 ? "" : "s"}
          </summary>
          <ol className="mt-3 space-y-2.5">
            {/* …existing <li> mapping, unchanged… */}
          </ol>
        </details>
      )}
```

- [ ] **Step 4: Verify**

Run: `npm run check` → green. Run: `npm run build` → clean (page still renders the old layout; `DeliveryCard` has no caller yet).

- [ ] **Step 5: Commit**

```bash
git add components/trends/sections.tsx
git commit -m "feat(trends): Delivery merge card + collapsed block history (UX v2 W3)"
```

---

### Task 4: Trends.tsx — the grouped page (rewrite + cuts)

**Files:**
- Modify: `components/Trends.tsx` (full rewrite below)

**Interfaces:**
- Consumes: `VerdictStrip`, `InsightsFold` (Task 2); `DeliveryCard`, `BlockTimeline`, `WeeklyVolumeBars`, `baselineCards`, `trendDir` (Task 3 / existing); `SectionDivider`, `Card`, `StatTile`, skeleton primitives from `./ui`.
- Cuts executed here: the "Last 7 days" tile row (weight/trend/intake move into the Load & fuel card header; 7-day load dies — its week story already lives on Plan's "This week" card until the W5 week strip); the standalone "Coach insights" + "Insight track record" cards (absorbed by `InsightsFold`); the "not a duplicate of intervals.icu" intro (the page question replaces it).

- [ ] **Step 1: Rewrite `components/Trends.tsx`**

Full replacement file:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { api, timeAgo } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import Sparkline from "./Sparkline";
import MultiSparkline, { type MultiSeries } from "./MultiSparkline";
import { Card, SectionDivider, Skeleton, SkeletonScreen, StatTile } from "./ui";
import { useSync } from "./SyncProvider";
import type { TrendsData } from "./trends/types";
import { BlockTimeline, DeliveryCard, WeeklyVolumeBars, baselineCards, trendDir } from "./trends/sections";
import { InsightsFold, VerdictStrip } from "./trends/verdict";

// The /trends page — a fetch-and-lay-out shell over ./trends/* (RV-8 split). UX v2 §5 layout:
// verdict strip + ranked insights fold-1, then four named groups (ENGINE / DELIVERY / LOAD & FUEL /
// MILESTONES), group gap 2× the card gap. The old "Last 7 days" tile row is gone — its tenants
// live in the Load & fuel card (weight/intake) and on Plan's week panel (7-day load).
export default function Trends() {
  // Keyed on the last sync time so it re-fetches whenever a sync completes; TanStack Query also
  // refetches on tab focus / reconnect and dedups/retries — same data layer as the main sync state.
  const { state } = useSync();
  const syncedAt = state?.lastSync?.syncedAt ?? null;
  const { data, error } = useQuery({
    queryKey: ["trends", syncedAt],
    queryFn: () => api<TrendsData>(`/api/trends?today=${localToday()}`),
  });

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        {error instanceof Error ? error.message : "Failed to load trends"}
      </div>
    );
  }
  if (!data) {
    // S3-1: mirrors the loaded scaffold (title → verdict strip → insights → grouped chart cards).
    return (
      <SkeletonScreen className="space-y-6">
        <div>
          <Skeleton className="h-6 w-28" />
          <Skeleton className="mt-1.5 h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-14" />
        <Skeleton className="h-36" />
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
        <Skeleton className="h-56" />
      </SkeletonScreen>
    );
  }

  const noData = !data.syncedAt;
  const efTrend = trendDir(data.ef, true);
  const ctlTrend = trendDir(data.ctl, true);
  const cards = baselineCards(data.baselines, data.recent?.wkgAtThreshold ?? null, data.recent?.wkgStale ?? false);

  const kcal = (v: number) => `${Math.round(v).toLocaleString()} kcal`;
  const energySeries: MultiSeries[] = [
    {
      label: "Burn",
      strokeClass: "stroke-amber-500 dark:stroke-amber-400",
      fillClass: "fill-amber-500 dark:fill-amber-400",
      swatchClass: "bg-amber-500 dark:bg-amber-400",
      textClass: "text-amber-600 dark:text-amber-400",
      format: kcal,
      points: data.energy.filter((e) => e.burnKcal != null).map((e) => ({ date: e.date, value: e.burnKcal as number })),
    },
    {
      label: "Intake",
      strokeClass: "stroke-sky-500 dark:stroke-[#00d4ff]",
      fillClass: "fill-sky-500 dark:fill-[#00d4ff]",
      swatchClass: "bg-sky-500 dark:bg-[#00d4ff]",
      textClass: "text-sky-600 dark:text-[#00d4ff]",
      format: kcal,
      points: data.energy.filter((e) => e.intakeKcal != null).map((e) => ({ date: e.date, value: e.intakeKcal as number })),
    },
    {
      label: "Weight",
      strokeClass: "stroke-emerald-500 dark:stroke-[#ff49c8]",
      fillClass: "fill-emerald-500 dark:fill-[#ff49c8]",
      swatchClass: "bg-emerald-500 dark:bg-[#ff49c8]",
      textClass: "text-emerald-600 dark:text-[#ff49c8]",
      format: (v) => `${v.toFixed(1)} kg`,
      points: data.energy.filter((e) => e.weightKg != null).map((e) => ({ date: e.date, value: e.weightKg as number })),
    },
  ];
  const energyHasData = energySeries.some((s) => s.points.length >= 2);
  // The killed tile row's surviving tenants, as a quiet stat line inside the Load & fuel card.
  const fuelStats = [
    data.recent?.latestWeightKg != null ? `weight ${data.recent.latestWeightKg.toFixed(1)} kg` : null,
    data.recent?.weightTrend7Day != null
      ? `${data.recent.weightTrend7Day > 0 ? "+" : ""}${data.recent.weightTrend7Day.toFixed(1)} kg/7d`
      : null,
    data.recent?.lastKcalConsumed != null ? `last intake ${data.recent.lastKcalConsumed} kcal` : null,
  ].filter((s): s is string => s !== null);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Trends</h1>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Am I improving?</p>
        </div>
        {data.syncedAt && (
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">synced {timeAgo(data.syncedAt)}</span>
        )}
      </div>

      {noData ? (
        <p className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          No synced data yet. Sync from the dashboard to populate trends.
        </p>
      ) : (
        <>
          {/* Fold-1: the page answer, then the ranked insights (top 3 + disclosure). */}
          <div className="space-y-3">
            <VerdictStrip data={data} />
            <InsightsFold
              insights={data.insights}
              validation={data.validation}
              recentInterventions={data.recentInterventions}
            />
          </div>

          {(data.ef.length >= 3 || data.ctl.length >= 3) && (
            <section id="group-engine" className="scroll-mt-4 space-y-3">
              <SectionDivider label="Engine — is the motor getting bigger?" />
              <div className="grid items-stretch gap-3 lg:grid-cols-2">
                {data.ef.length >= 3 && (
                  <Card className="h-full" title="Pw:HR — power-to-heart-rate" hint={`${data.ef.length} outdoor rides · ≥45 min`}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className={`text-xs font-medium ${efTrend.cls}`}>{efTrend.label}</span>
                      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        latest {data.ef[data.ef.length - 1].value.toFixed(2)}
                      </span>
                    </div>
                    <Sparkline points={data.ef} format={(v) => v.toFixed(2)} />
                    <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                      Power-to-HR on steady endurance rides. Rising = more output at the same HR = better aerobic base.
                    </p>
                  </Card>
                )}
                {data.ctl.length >= 3 && (
                  <Card className="h-full" title="Fitness trajectory — CTL" hint="last ~6 months">
                    <div className="mb-1 flex items-center justify-between">
                      <span className={`text-xs font-medium ${ctlTrend.cls}`}>{ctlTrend.label}</span>
                      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        now {data.ctl[data.ctl.length - 1].value.toFixed(1)}
                      </span>
                    </div>
                    <Sparkline
                      points={data.ctl}
                      format={(v) => v.toFixed(1)}
                      strokeClass="stroke-purple-400 dark:stroke-[#00d4ff]/70"
                      dotClass="fill-purple-500 dark:fill-[#00d4ff]"
                      tipTextClass="fill-zinc-800 dark:fill-[#00d4ff]"
                      tipAccentClass="stroke-zinc-300 dark:stroke-[#00d4ff]/40"
                    />
                  </Card>
                )}
              </div>
            </section>
          )}

          {(data.scores.length >= 2 || data.planVsActual.length > 0) && (
            <section id="group-delivery" className="scroll-mt-4 space-y-3">
              <SectionDivider label="Delivery — do I ride what's prescribed?" />
              <DeliveryCard scores={data.scores} planVsActual={data.planVsActual} ftpRetest={data.ftpRetest} />
            </section>
          )}

          {(energyHasData || data.weeklyHours.length >= 2) && (
            <section id="group-fuel" className="scroll-mt-4 space-y-3">
              <SectionDivider label="Load & fuel — am I feeding the work?" />
              <div className="grid items-stretch gap-3 lg:grid-cols-[1.7fr_1fr]">
                {energyHasData && (
                  <Card
                    className="h-full"
                    title="Fueling & weight"
                    hint="complete weeks · tap to isolate"
                    action={
                      fuelStats.length > 0 ? (
                        <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{fuelStats.join(" · ")}</span>
                      ) : undefined
                    }
                  >
                    <MultiSparkline series={energySeries} />
                    <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                      Per complete week: total ride burn (kJ≈kcal) and total intake against the week&apos;s median weight, each on its own scale. The current in-progress week is excluded until it closes. Tap a legend chip to show/hide; isolating one fills the area.
                    </p>
                  </Card>
                )}
                {data.weeklyHours.length >= 2 && (
                  <Card
                    className="h-full"
                    title="Weekly volume"
                    hint="context"
                    tip="Total ride hours per complete week over the last ~16 weeks (the in-progress week is excluded). Bar height and blue shade both track weekly training volume — consistency and ramp at a glance."
                  >
                    <WeeklyVolumeBars weeks={data.weeklyHours} />
                  </Card>
                )}
              </div>
            </section>
          )}

          {(cards.length > 0 || data.blocks.length > 0) && (
            <section id="group-milestones" className="scroll-mt-4 space-y-3">
              <SectionDivider label="Milestones" />
              {cards.length > 0 && (
                <Card title="Recent baselines" hint="rolling 90 days">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {cards.map((c) => (
                      <StatTile key={c.label} label={c.label} value={c.value} />
                    ))}
                  </div>
                </Card>
              )}
              <BlockTimeline blocks={data.blocks} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run check` → green. Run: `npm run build` → clean.
Greps (success measures, expect empty): `grep -rn "Last 7 days" components/ app/ --include="*.tsx"` · `grep -rn "not a duplicate of intervals" components/ --include="*.tsx"`.
Controller runs the live preview walk after review (dark 1440×900: verdict sentence first; axis links scroll to their groups; delivery toggle flips; block history collapsed; light + 375px spot checks).

- [ ] **Step 3: Commit**

```bash
git add components/Trends.tsx
git commit -m "feat(trends): verdict-first grouped page — engine/delivery/load-and-fuel/milestones (UX v2 W3)"
```

---

### Task 5: Wave gate — DESIGN.md §8, masterplan bookkeeping, final sweep

**Files:**
- Modify: `DESIGN.md` (per-page table, Trends row)
- Modify: `UX-MASTERPLAN.md` (§7 Wave 3 shipped + header line)

- [ ] **Step 1: DESIGN.md §8 — Trends row**

Replace the Trends row of the per-page table with (ONE table line):

```markdown
| **Trends** | "Am I improving?" | Verdict strip (engine · delivery · fueling, derivations in tips) + ranked coach insights (top 3) | four named groups: ENGINE (Pw:HR · CTL) · DELIVERY (execution bars ↔ per-type planned-vs-actual, one card, toggled) · LOAD & FUEL (fueling & weight + volume context) · MILESTONES (baselines) | remaining insights + track record → `<details>`; block history list → `<details>` at the bottom |
```

- [ ] **Step 2: UX-MASTERPLAN bookkeeping**

1. §7 item 3 becomes (mirroring the Wave 1/2 shipped format, with today's date):

```markdown
3. **Wave 3 — Trends rebuild.** ✅ shipped 2026-07-09 (plan
   `docs/superpowers/plans/2026-07-09-ux-v2-wave-3-trends-rebuild.md`). Verdict strip (three
   honestly-derived axes, client-side over the existing payload) + ranked insights fold +
   the four groups + the Delivery merge; cut: "Last 7 days" tiles, mission-statement intro.
```

2. Header line 3: "Waves 1–2 shipped 2026-07-08 (§7), Waves 3–5 open" → "Waves 1–3 shipped 2026-07-08/09 (§7), Waves 4–5 open".

- [ ] **Step 3: Final sweep**

```bash
npm run check && npm run build
grep -rn "Last 7 days" components/ app/ --include="*.tsx"      # expect: nothing
grep -rn "not a duplicate" components/ --include="*.tsx"        # expect: nothing
grep -rn "Wave 3" ROADMAP.md todo.md                             # expect: nothing forward-looking
```

- [ ] **Step 4: Commit**

```bash
git add DESIGN.md UX-MASTERPLAN.md
git commit -m "docs(ux): DESIGN §8 + masterplan wave state for UX v2 Wave 3"
```
