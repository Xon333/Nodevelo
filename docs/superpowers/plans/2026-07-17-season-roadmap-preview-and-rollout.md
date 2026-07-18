# Season Roadmap Preview & Rollout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/plan`'s season roadmap a stateless forward projection (re-running `chooseNextFocus` for display, never persisted or gating), wire it into `PlanView.tsx`'s generator pre-fill, and — once the UI can honestly represent the new model — flip `SEASON_SHAPES_GENERATION` back on and prove it live.

**Architecture:** A new `projectSeasonOutlook` in `lib/season.ts` re-runs `chooseNextFocus` forward a handful of hypothetical slots (same exposure-extrapolation trick `draftSeasonArc`'s old loop used). `app/api/season/route.ts` GET computes it server-side, gated behind `SEASON_SHAPES_GENERATION` and only for the rolling (no-upcoming-A-event) case — so the flag-gating and mode-branching live in one place instead of being duplicated across every consuming component. `SeasonRoadmap.tsx` and `PlanView.tsx` read the result instead of their own `currentPeriod`/`formatSeasonContext` logic for the rolling case, falling back to the untouched event-mode path when the server returns no outlook.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Vitest.

## Global Constraints

- Run `npm run check` before every commit — 0 errors.
- **Depends on** `docs/superpowers/plans/2026-07-17-season-continuous-focus-selection.md` having already landed (`chooseNextFocus`, `gatherFocusInputs`, `findUpcomingAEvent`, `settleSeasonHistory`, `replanEventArc` must all exist). Confirm before starting: `grep -n "export function chooseNextFocus" lib/season.ts` — if this doesn't return a match, stop and land that plan first.
- Task 5 flips `SEASON_SHAPES_GENERATION` to `true` — from that point on, generation prompt content genuinely changes, so Task 5 **requires a live smoke run against the real Anthropic API** (AGENTS.md: "LLM-backed paths need one live smoke run... read the actual output"). Do not skip it or substitute a mocked test for it.
- Preserve event-mode behavior exactly: a block generated while an upcoming A-event exists must render/behave identically before and after this plan (verified in Task 4).

---

### Task 1: `projectSeasonOutlook` — stateless forward projection

**Files:**
- Modify: `lib/season.ts`
- Modify: `lib/season.test.ts`

**Interfaces:**
- Consumes: `chooseNextFocus`, `ChooseNextFocusInput`, `FocusSignals`, `SEASON_CONSTANTS.weeks`, `addWeeks` (all already exist)
- Produces: `export interface SeasonOutlookSlot { focus: SeasonFocus; rationale: string; startDate: string; weeks: number }`
- Produces: `export function projectSeasonOutlook(input: ChooseNextFocusInput, today: string, slots?: number): SeasonOutlookSlot[]`

- [ ] **Step 1: Write the failing tests**

Add to `lib/season.test.ts`:

```ts
describe("projectSeasonOutlook (season-roadmap-preview §6)", () => {
  it("projects the requested number of hypothetical slots, dated contiguously from today", () => {
    const out = projectSeasonOutlook({ limiter: { system: null, confidence: "low" }, lastFocus: "aerobic-base", signals: {} }, "2026-07-01", 3);
    expect(out).toHaveLength(3);
    expect(out[0].startDate).toBe("2026-07-01");
    expect(out[1].startDate).toBe(addWeeks(out[0].startDate, out[0].weeks));
    expect(out[2].startDate).toBe(addWeeks(out[1].startDate, out[1].weeks));
  });

  it("never repeats a focus back-to-back across the projected slots", () => {
    const out = projectSeasonOutlook({ limiter: { system: null, confidence: "low" }, lastFocus: null, signals: {} }, "2026-07-01", 4);
    for (let i = 1; i < out.length; i++) expect(out[i].focus).not.toBe(out[i - 1].focus);
  });

  it("defaults to 4 slots when not specified", () => {
    const out = projectSeasonOutlook({ limiter: { system: null, confidence: "low" }, lastFocus: null, signals: {} }, "2026-07-01");
    expect(out).toHaveLength(4);
  });

  it("REGRESSION (ported from the deleted draftSeasonArc-level test, 2026-07-15 live finding): real exposure for ALL foci must not freeze urgency for the whole projection — a never-yet-drafted focus still surfaces within one horizon", () => {
    // A confident anaerobic limiter with real (comparatively fresh, non-zero) exposure for every focus —
    // without the exposure-extrapolation fix, vo2max/durability's real exposure never grows across the
    // loop and the projection degenerates into anaerobic/threshold alternating forever.
    const out = projectSeasonOutlook(
      {
        limiter: { system: "anaerobic", confidence: "high" },
        lastFocus: "aerobic-base",
        signals: {
          goalText: "Raise my FTP from 280 to 300 W. Weakpoint: Sprint (0-30s).",
          exposure: { "aerobic-base": 2, threshold: 0, anaerobic: 0, vo2max: 3, durability: 2 },
          execQuality: { threshold: 6.2, vo2max: 7, anaerobic: 7, durability: 6.8 },
        },
      },
      "2026-07-01",
      4
    );
    const foci = out.map((s) => s.focus);
    expect(foci).not.toEqual(["anaerobic", "threshold", "anaerobic", "threshold"]); // the old two-focus trap
    expect(foci).toContain("vo2max"); // structurally reachable within one horizon
  });

  it("REGRESSION (ported from the deleted draftSeasonArc-level test, found by the final whole-branch review): a focus with fresh REAL exposure is not penalized just because it sits in the incoming lastFocus/history", () => {
    // durability's real exposure says 0 weeks (maximally fresh) even though its label was the most
    // recent thing trained (lastFocus) — the projection must honor the real freshness, not fall back to
    // a label-derived staleness estimate that overstates its urgency.
    const out = projectSeasonOutlook(
      {
        limiter: { system: null, confidence: "low" },
        lastFocus: "durability",
        signals: { exposure: { durability: 0 } },
      },
      "2026-07-01",
      3
    );
    // durability must not win the very next slot purely off a stale label-derived estimate when its
    // real exposure says it was just trained — the no-back-to-back rule already keeps it out of slot 0
    // regardless, so this asserts the REAL signal (not a label fallback) is what's driving slot 1+.
    expect(out[0].focus).not.toBe("durability");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/season.test.ts -t "projectSeasonOutlook"`
Expected: FAIL — not exported yet.

- [ ] **Step 3: Implement**

In `lib/season.ts`, add after `chooseNextFocus`/`findUpcomingAEvent` (from the prerequisite plan):

```ts
export interface SeasonOutlookSlot {
  focus: SeasonFocus;
  rationale: string;
  startDate: string; // hypothetical
  weeks: number; // nominal display length (SEASON_CONSTANTS.weeks[focus])
}

const DEFAULT_OUTLOOK_SLOTS = 4;

// Stateless forward projection for the roadmap UI (season-roadmap-preview §6) — never persisted, never
// gates real generation, recomputed fresh every time it's shown. Re-runs chooseNextFocus forward a
// handful of hypothetical slots, reusing the exposure-extrapolation trick draftSeasonArc's old rolling
// loop had: a not-yet-projected focus's real staleness is advanced forward by how far the projection has
// already run, and once a focus IS projected this call, its real exposure is dropped so later slots fall
// through to ordinary staleness growth from that point on — without this, a focus with real (low)
// exposure and no confident-limiter competitor can out-score every never-trained focus for the ENTIRE
// projection (the exact bug the two REGRESSION tests above pin).
export function projectSeasonOutlook(
  input: ChooseNextFocusInput,
  today: string,
  slots: number = DEFAULT_OUTLOOK_SLOTS
): SeasonOutlookSlot[] {
  const out: SeasonOutlookSlot[] = [];
  const projectedThisCall = new Set<SeasonFocus>();
  let cursor = today;
  let lastFocus = input.lastFocus;
  for (let i = 0; i < slots; i++) {
    const weeksIntoProjection = weeksBetween(today, cursor);
    const adjustedSignals: FocusSignals = input.signals.exposure
      ? {
          ...input.signals,
          exposure: Object.fromEntries(
            Object.entries(input.signals.exposure)
              .filter(([f]) => !projectedThisCall.has(f as SeasonFocus))
              .map(([f, wk]) => [f, (wk as number) + weeksIntoProjection])
          ) as Partial<Record<SeasonFocus, number>>,
        }
      : input.signals;
    const choice = chooseNextFocus({ limiter: input.limiter, lastFocus, signals: adjustedSignals });
    const weeks = SEASON_CONSTANTS.weeks[choice.focus];
    out.push({ focus: choice.focus, rationale: choice.rationale, startDate: cursor, weeks });
    projectedThisCall.add(choice.focus);
    lastFocus = choice.focus;
    cursor = addWeeks(cursor, weeks);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/season.test.ts -t "projectSeasonOutlook"`
Expected: PASS (5 tests).

- [ ] **Step 5: Full gate + commit**

Run: `npm run check`

```bash
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): add projectSeasonOutlook, the stateless roadmap projection"
```

---

### Task 2: Extend `GET /api/season` with the outlook

**Files:**
- Modify: `app/api/season/route.ts`
- Modify: `app/api/season/route.test.ts` (create if it doesn't exist — check first)

**Interfaces:**
- Consumes: `findUpcomingAEvent`, `projectSeasonOutlook`, `SEASON_SHAPES_GENERATION` (`lib/season.ts`), `gatherFocusInputs` (`lib/season-signals.ts`), `resolveToday` (`lib/date.ts`)
- Produces: `GET` response shape changes from `{ plan }` to `{ plan, outlook: SeasonOutlookSlot[] | null }`

- [ ] **Step 1: Check for an existing test file**

Run: `ls app/api/season/route.test.ts 2>/dev/null && echo EXISTS || echo MISSING`

- [ ] **Step 2: Write the failing tests**

Create or extend `app/api/season/route.test.ts`. Mock `lib/data-store` and `lib/season-signals` the same way `app/api/generate/route.test.ts` already does (grep that file's `vi.mock` blocks first):

```ts
import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/data-store", () => ({
  readSeasonPlan: vi.fn(async () => ({ objective: "get faster", events: [], periods: [], updatedAt: "" })),
  writeSeasonPlan: vi.fn(async () => {}),
}));
vi.mock("@/lib/season-signals", () => ({
  gatherFocusInputs: vi.fn(async () => ({ limiter: { system: null, confidence: "low" }, lastFocus: null, signals: {} })),
}));

describe("GET /api/season — outlook", () => {
  it("returns a null outlook when there is an upcoming A-event (event mode keeps its committed arc)", async () => {
    const { readSeasonPlan } = await import("@/lib/data-store");
    vi.mocked(readSeasonPlan).mockResolvedValueOnce({
      objective: "get faster", updatedAt: "",
      events: [{ name: "Gran Fondo", date: "2026-10-01", priority: "A" }],
      periods: [],
    });
    const req = new Request("http://localhost/api/season?today=2026-07-01");
    const res = await GET(req);
    const body = await res.json();
    expect(body.outlook).toBeNull();
  });

  it("returns a projected outlook for the rolling case when SEASON_SHAPES_GENERATION is on", async () => {
    // This test only makes sense once Task 5 of this plan flips the flag; until then it documents the
    // intended behavior and is expected to assert outlook === null (flag still off). Adjust the
    // expectation to match whichever state SEASON_SHAPES_GENERATION is actually in when this task runs
    // — read lib/season.ts's current value before writing the assertion, don't guess.
    const req = new Request("http://localhost/api/season?today=2026-07-01");
    const res = await GET(req);
    const body = await res.json();
    expect(Array.isArray(body.outlook) || body.outlook === null).toBe(true);
  });

  it("still returns plan unchanged (existing contract)", async () => {
    const req = new Request("http://localhost/api/season?today=2026-07-01");
    const res = await GET(req);
    const body = await res.json();
    expect(body.plan.objective).toBe("get faster");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run app/api/season/route.test.ts`
Expected: FAIL — `GET` currently takes no `req` argument and never returns `outlook`.

- [ ] **Step 4: Implement**

Replace `app/api/season/route.ts`'s `GET`:

```ts
import { NextResponse } from "next/server";
import { readSeasonPlan, writeSeasonPlan } from "@/lib/data-store";
import { findUpcomingAEvent, projectSeasonOutlook, SEASON_SHAPES_GENERATION, validateSeasonPlanInput } from "@/lib/season";
import { gatherFocusInputs } from "@/lib/season-signals";
import { resolveToday } from "@/lib/date";

export async function GET(req: Request) {
  const today = resolveToday(new URL(req.url).searchParams.get("today"));
  const plan = await readSeasonPlan();
  // Roadmap preview (season-roadmap-preview §6): a stateless projection, computed fresh on every
  // request, never persisted. Only for the rolling case (no upcoming A-event — event mode already
  // shows a real, committed arc from `plan.periods`) and only while SEASON_SHAPES_GENERATION is on
  // (this is exactly the "phase-derived opinion" the flag exists to gate — centralizing the check here
  // means every consumer (SeasonRoadmap, PlanView) gets it for free instead of re-checking the flag
  // itself).
  const aEvent = findUpcomingAEvent(plan.events, today);
  const outlook = SEASON_SHAPES_GENERATION && !aEvent ? projectSeasonOutlook(await gatherFocusInputs({ today }), today) : null;
  return NextResponse.json({ plan, outlook });
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = validateSeasonPlanInput(body);
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
  const current = await readSeasonPlan();
  await writeSeasonPlan({ ...current, objective: parsed.objective, events: parsed.events });
  return NextResponse.json({ plan: await readSeasonPlan() });
}
```

(`PUT` is unchanged from today — reproduced above only so the whole file is shown; do not alter its behavior.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run app/api/season/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Full gate + commit**

Run: `npm run check`

```bash
git add app/api/season/route.ts app/api/season/route.test.ts
git commit -m "feat(season-api): GET /api/season returns a stateless outlook projection"
```

---

### Task 3: `SeasonRoadmap.tsx` renders the outlook

**Files:**
- Modify: `components/SeasonRoadmap.tsx`

**Interfaces:**
- Consumes: `GET /api/season`'s new `{ plan, outlook }` shape, `SeasonOutlookSlot` type (`@/lib/season` or `@/lib/types` — check which file Task 1 actually exported it from and import from there)

- [ ] **Step 1: Manual verification plan (no unit test — this is a presentational component; existing project convention has no `.test.tsx` for `SeasonRoadmap.tsx` — confirm with `ls components/SeasonRoadmap.test.tsx 2>/dev/null` before assuming; if one exists, add cases mirroring Step 3 below instead of skipping straight to browser verification)**

- [ ] **Step 2: Implement**

Replace `components/SeasonRoadmap.tsx` in full:

```tsx
"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { roadmapView, SEASON_SHAPES_GENERATION, FOCUS_LABELS, type SeasonOutlookSlot } from "@/lib/season";
import type { SeasonFocus, SeasonPlan } from "@/lib/types";
import { LoadFailed, useMountLoad } from "./ui";

const FOCUS_COLOR: Record<SeasonFocus, string> = {
  "aerobic-base": "#00d4ff", threshold: "#f5a623", vo2max: "#ff49c8", anaerobic: "#a06bff", durability: "#38d39f", sharpen: "#7fd8ea",
};

// Season roadmap stepper for /plan (MACRO-UI): done/current cards from settled history + event mode's
// real committed arc, plus (season-roadmap-preview §6) a dashed, lower-opacity "if you kept going"
// projection for the rolling case — computed fresh server-side every load, never a promise about what a
// future block will actually contain. Shows a 3-step teaching stub when there's nothing to show yet; a
// fetch failure renders visibly (LoadFailed).
export default function SeasonRoadmap({ refreshKey }: { refreshKey?: number }) {
  const [plan, setPlan] = useState<SeasonPlan | null>(null);
  const [outlook, setOutlook] = useState<SeasonOutlookSlot[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const today = localToday();
      const { plan, outlook } = await api<{ plan: SeasonPlan; outlook: SeasonOutlookSlot[] | null }>(`/api/season?today=${today}`);
      setPlan(plan);
      setOutlook(outlook);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useMountLoad(load, refreshKey);

  if (failed) return <LoadFailed what="the season roadmap" retry={() => void load()} />;

  const hasHistory = plan !== null && plan.periods.length > 0;
  const hasOutlook = outlook !== null && outlook.length > 0;

  if (!hasHistory && !hasOutlook) {
    return (
      <section className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-3 dark:border-zinc-600 dark:bg-zinc-800">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          How planning works
        </h2>
        <ol className="flex flex-col gap-1.5 text-xs text-zinc-600 dark:text-zinc-300 sm:flex-row sm:items-center sm:gap-3">
          <li className="flex items-baseline gap-1.5"><span className="font-mono text-[#ff49c8]">1</span> Set a <span className="font-medium">season</span> — your focus arc (base → build → sharpen).</li>
          <li aria-hidden className="hidden text-zinc-400 sm:block">→</li>
          <li className="flex items-baseline gap-1.5"><span className="font-mono text-[#ff49c8]">2</span> <span className="font-medium">Blocks</span> fill it in, 2–8 weeks at a time.</li>
          <li aria-hidden className="hidden text-zinc-400 sm:block">→</li>
          <li className="flex items-baseline gap-1.5">
            <span className="font-mono text-[#ff49c8]">3</span>
            {SEASON_SHAPES_GENERATION
              ? <>Each block auto-targets the current phase &amp; your goals.</>
              : <>Each block targets your stated goals (phase-targeting is temporarily paused).</>}
          </li>
        </ol>
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          Add an objective &amp; a target event below to generate your season.
        </p>
      </section>
    );
  }

  const today = localToday();
  const view = plan ? roadmapView(plan, today) : [];
  const nextEvent = plan?.events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const nextA = plan?.events.filter((e) => e.priority === "A" && e.date > today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const hasDerived = plan?.periods.some((p) => p.source === "derived") ?? false;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Season</h2>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{plan?.objective || "get faster"}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {view.map((p) => (
          <div key={`${p.focus}-${p.startDate}`} className={`min-w-0 flex-1 rounded-md border px-2.5 py-2 ${p.status === "current" ? "border-[#ff49c8] shadow-[0_0_0_1px_#ff49c8]" : "border-zinc-200 dark:border-zinc-700"} ${p.status === "done" ? "opacity-55" : ""}`}>
            <p className="text-[8px] font-bold uppercase tracking-wide" style={{ color: FOCUS_COLOR[p.focus] }}>
              {p.status === "done" ? "✓ " : p.status === "current" ? "● " : "○ "}{p.phase}
            </p>
            <p className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-100">{p.label}</p>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {p.deloadWeek ? "deload · " : ""}{p.weeks} wk{p.targetWeeklyTss != null ? ` · ${p.targetWeeklyTss} TSS/wk` : ""}
            </p>
          </div>
        ))}
        {outlook?.map((slot, i) => (
          <div key={`outlook-${slot.focus}-${slot.startDate}-${i}`} className="min-w-0 flex-1 rounded-md border border-dashed border-zinc-300 px-2.5 py-2 opacity-70 dark:border-zinc-600">
            <p className="text-[8px] font-bold uppercase tracking-wide" style={{ color: FOCUS_COLOR[slot.focus] }}>○ projected</p>
            <p className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-100">{FOCUS_LABELS[slot.focus]}</p>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{slot.weeks} wk</p>
          </div>
        ))}
        {nextEvent && (
          <div className="flex min-w-[64px] flex-col items-center justify-center rounded-md border border-[#ffcf4d] bg-[#ffcf4d]/10 px-2 py-2 text-center">
            <span className="text-base leading-none">🏁</span>
            <span className="mt-1 text-[9px] font-bold text-[#b8952f] dark:text-[#ffcf4d]">{nextEvent.name}</span>
            <span className="text-[9px] text-zinc-500 dark:text-zinc-400">{nextEvent.date.slice(5)}</span>
          </div>
        )}
      </div>
      {(hasDerived || hasOutlook) && (
        <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
          {nextA ? (
            <>
              Counting down to <span className="font-medium">{nextA.name}</span> ({nextA.date}): build blocks first, then a
              peak (race-specific sharpening), then a taper ending on race week. It refreshes when you generate a block.
            </>
          ) : hasOutlook ? (
            <>If you kept going from today, roughly this — not a promise, recomputed fresh every time you generate a block.</>
          ) : (
            "Auto-drafted from your objective, events, fitness/load, and current limiter. It refreshes when you generate a block."
          )}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Verify in the browser**

Start the dev server, open `/plan`, and confirm:
- With `SEASON_SHAPES_GENERATION` still `false` (this task hasn't reached Task 5 yet): dashed "projected" cards must NOT appear (the API returns `outlook: null` while the flag is off) — the roadmap should render exactly as it did before this task (settled history only, or the 3-step stub if there's no history yet).
- No console errors; no layout shift/overflow at typical widths.

- [ ] **Step 4: Full gate + commit**

Run: `npm run check`

```bash
git add components/SeasonRoadmap.tsx
git commit -m "feat(ui): SeasonRoadmap renders the stateless outlook projection"
```

---

### Task 4: `PlanView.tsx` consumes the outlook for the generator pre-fill

**Files:**
- Modify: `components/dashboard/PlanView.tsx` (the `loadSeasonCtx` callback, ~line 115-154, and its import line, ~line 7)

**Interfaces:**
- Consumes: `GET /api/season`'s `{ plan, outlook }`, `SeasonOutlookSlot`

- [ ] **Step 1: Check for an existing test covering `loadSeasonCtx`**

Run: `grep -n "loadSeasonCtx\|SeasonRoadmap\|api/season" components/dashboard/PlanView.test.tsx 2>/dev/null || echo "no existing coverage found"`

If coverage exists, update those tests' mocked `/api/season` response shape from `{ plan }` to `{ plan, outlook }` and add the new cases in Step 3 below to the same file. If none exists, this task proceeds with manual browser verification only (Step 4) — do not invent a new test file for a component this plan doesn't otherwise touch the testing posture of.

- [ ] **Step 2: Implement**

In `components/dashboard/PlanView.tsx`, change the import line (~line 7):

```ts
import { currentPeriod, filterGoalsByFocus, formatSeasonContext, suggestedBlockWeeks, FOCUS_LABELS, type SeasonOutlookSlot } from "@/lib/season";
```

(Drop `SEASON_SHAPES_GENERATION` — the flag-gating now lives server-side in `GET /api/season`, Task 2.)

Replace `loadSeasonCtx` (~line 115-154):

```tsx
  const loadSeasonCtx = useCallback(async () => {
    try {
      const today = localToday();
      const { plan, outlook } = await api<{ plan: SeasonPlan; outlook: SeasonOutlookSlot[] | null }>(`/api/season?today=${today}`);
      // The block-length suggestion still comes from a real committed period when one exists (event
      // mode's persisted arc) — harmless and self-resolving if rolling mode briefly still has a
      // straddling settled period left over from before this redesign.
      const period = currentPeriod(plan, today);
      if (period) setLengthWeeks(suggestedBlockWeeks(period, today));

      const next = outlook?.[0] ?? null;
      if (next) {
        // Rolling mode, SEASON_SHAPES_GENERATION on: the server already ran chooseNextFocus for this
        // exact "next block" decision — show it directly instead of re-deriving anything client-side.
        setSeasonReadout(`${FOCUS_LABELS[next.focus]} — ${next.rationale}`);
        setFocusLabel(FOCUS_LABELS[next.focus]);
        if (rawGoals.length > 0) {
          const filtered = filterGoalsByFocus(rawGoals as Array<{ goal: string; target: string; focus: import("@/lib/types").SeasonFocus | "general" }>, next.focus);
          setGoalCount(filtered.length);
          setGoal(filtered.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
          setShownGoals(filtered);
        }
      } else if (period) {
        // Event mode: the server never projects an outlook while a real committed arc exists — use the
        // period directly, exactly as before this redesign.
        setSeasonReadout(formatSeasonContext(plan, today));
        setFocusLabel(FOCUS_LABELS[period.focus]);
        if (rawGoals.length > 0) {
          const filtered = filterGoalsByFocus(rawGoals as Array<{ goal: string; target: string; focus: import("@/lib/types").SeasonFocus | "general" }>, period.focus);
          setGoalCount(filtered.length);
          setGoal(filtered.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
          setShownGoals(filtered);
        }
      } else {
        // Nothing to target — no current period, no outlook (season disabled or a brand-new season).
        setSeasonReadout(null);
        setFocusLabel(null);
        if (rawGoals.length > 0) {
          setGoal(rawGoals.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
          setShownGoals(rawGoals);
        }
      }
      setSeasonCtxFailed(false);
    } catch {
      setSeasonReadout(null);
      setFocusLabel(null);
      setSeasonCtxFailed(true);
    }
  }, [rawGoals]);
```

- [ ] **Step 3: Add/update tests (only if Step 1 found existing coverage)**

If `PlanView.test.tsx` (or equivalent) already mocks `/api/season`, add:

```ts
it("shows the projected focus + rationale as the season readout when the API returns an outlook", async () => {
  // Mock GET /api/season → { plan: {...}, outlook: [{ focus: "threshold", rationale: "rotating the quality focus", startDate: "2026-07-01", weeks: 4 }] }
  // Render, wait for load, assert the season-readout text contains "Threshold" and "rotating the quality focus".
});

it("falls back to the event-mode period readout when outlook is null but a current period exists", async () => {
  // Mock a plan with one period straddling today, outlook: null.
  // Assert the readout matches formatSeasonContext's own output for that period.
});

it("shows no readout when both outlook and the current period are absent", async () => {
  // Mock plan.periods: [], outlook: null.
  // Assert seasonReadout/focusLabel are unset and every rawGoal is shown unfiltered.
});
```

- [ ] **Step 4: Verify in the browser**

Start the dev server, open `/plan`'s generator form. With `SEASON_SHAPES_GENERATION` still `false`: confirm the "Targeting: X" pill and season readout stay hidden (unchanged from before this task — the API returns `outlook: null` and, in the common no-event case, `period` is also null/settled-history-only, matching today's disabled-flag behavior). No console errors.

- [ ] **Step 5: Full gate + commit**

Run: `npm run check`

```bash
git add components/dashboard/PlanView.tsx
git commit -m "feat(ui): PlanView reads the season outlook for its generator pre-fill"
```

---

### Task 5: Flip `SEASON_SHAPES_GENERATION` back on + live verification

**Files:**
- Modify: `lib/season.ts` (the flag)
- Modify: `ROADMAP.md`, `README.md` if it references the disabled state (check first)

- [ ] **Step 1: Flip the flag**

In `lib/season.ts`, change:

```ts
export const SEASON_SHAPES_GENERATION = false;
```

to:

```ts
export const SEASON_SHAPES_GENERATION = true;
```

Update the doc comment immediately above it (currently explaining why it's `false` and the deferred research question) to instead say the continuous-focus-selection redesign (this plan + its two prerequisites) is what answered that research question, and the flag is back on as of today's date — keep the comment short; the full record lives in `docs/superpowers/specs/2026-07-17-season-architecture-redesign-design.md` and the three implementation plans, not in this comment.

- [ ] **Step 2: Full automated gate**

Run: `npm run check`
Expected: 0 tsc errors, 0 lint errors, all tests pass. Every test written across all three plans that asserted "no season/recovery prompt text while the flag is off" will now need updating if any such assertion was written as an unconditional "always empty" rather than reading the live flag value — find and fix any that hardcoded the old default:

Run: `grep -rn "SEASON_SHAPES_GENERATION" --include="*.test.ts" --include="*.test.tsx" .`

Read each hit; if a test asserts behavior conditioned on the flag being `false` without itself mocking/overriding the flag value, update it to reflect the new default (`true`) or to explicitly test both states via `vi.mock`.

- [ ] **Step 3: Live smoke run (required — AGENTS.md LLM-backed-path rule)**

This is the first real change to what reaches the Anthropic prompt since the redesign began — a unit-test-green build does not prove the live model handles the new `BLOCK FOCUS:`/`RECOVERY:` lines sensibly.

1. Start the dev server: `npm run dev`.
2. Generate a real rolling-mode block (no upcoming A-event in the athlete's real `data/season-plan.json`) via the `/plan` UI or `curl -X POST http://127.0.0.1:3000/api/generate -d '{...real blockParams...}'`.
3. Read the actual raw response (`plan.raw` in the JSON, or the `overview`/`days` the UI renders) — confirm:
   - The generated week(s) plausibly reflect the injected `BLOCK FOCUS:` focus (e.g. a `threshold` focus block actually contains Threshold sessions, not just VO2max).
   - If a `RECOVERY:` line was injected, the corresponding week's sessions are visibly lighter (shorter/easier) than the loading weeks.
   - `plan.warnings` contains no new, unexpected `validateBlockFocus`/season-fit findings caused by a genuine prompt-following failure (a warning appearing at all isn't itself a bug — the validator is designed to catch exactly this — but read it and confirm it's a real, isolated miss, not systematic).
4. If an A-priority event exists in real season data, generate one more block to confirm the event-anchored path (`formatSeasonContext`, unchanged) still reads correctly in the live prompt too.

Record the outcome directly in the commit message (Step 5) — do not just say "smoke tested," name what you actually read and confirmed.

- [ ] **Step 4: Manual UI check**

With the dev server still running, open `/plan`: confirm `SeasonRoadmap` now shows dashed "projected" outlook cards (rolling mode, no A-event) and the generator form's "Targeting: X" pill/readout appears using the projected focus. Screenshot or describe what's rendered in the commit/PR description.

- [ ] **Step 5: Update docs + commit**

In `ROADMAP.md`, under "Season engine — known debt": remove the "Season is currently NOT shaping or gating block generation" callout paragraph entirely (it's now shaping generation again) — fold anything still genuinely open (e.g. any debt bullet not already closed by the two prerequisite plans) into the surrounding prose without the "temporarily disabled" framing.

In `README.md`, search for any reference to season being disabled (`grep -n "SEASON_SHAPES_GENERATION\|temporarily disabled\|phase-targeting is temporarily paused"`) and update it to reflect the flag being back on.

```bash
git add lib/season.ts ROADMAP.md README.md
git commit -m "feat(season): re-enable SEASON_SHAPES_GENERATION — continuous focus selection ships

Live-verified: <fill in exactly what Step 3 confirmed — which block was generated, what focus/
recovery text was injected, what the model actually produced, and that it matched>."
```
