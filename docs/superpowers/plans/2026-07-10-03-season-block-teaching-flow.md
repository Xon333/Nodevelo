# Season ↔ Block Teaching Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Season → Block → goal relationship obvious through UI structure (not walls of text): a continuous flow where the season arc frames block generation, the generator visibly pulls from the current focus period and the athlete's profile, and a no-season state teaches "what a season does" in three steps.

**Architecture:** The pieces already exist and are wired in data (`SeasonRoadmap` renders the focus arc; `currentPeriod`/`filterGoalsByFocus`/`suggestedBlockWeeks` make generation season-aware). The gap is purely presentational: the roadmap sits at the top of `/plan` disconnected from the generator far below, the objective field is one vague input, the "general" focus tag reads as meaningless noise, and there's no guidance when no season exists. This plan closes those gaps with small, surgical UI edits and one honesty relabel — no new engine logic.

**Tech Stack:** TypeScript 5, React 19, Next.js 16 App Router, Tailwind v4, Vitest.

## Global Constraints

- **`npm test`** runs Vitest. Pure-logic helpers get a unit test; pure-JSX/copy changes are verified by `npx tsc --noEmit` + a live visual smoke on `/plan` (`npm run dev`, note the dev server is `dev:preview` on port 3100 per `.claude/launch.json`).
- **No new dependencies.**
- **Data compatibility:** the stored goal `focus` value `"general"` must NOT change (on-disk `athlete.md`/profile data uses it). Only its *display label* changes. Same for all `SeasonFocus` values.
- **Follow existing patterns:** best-effort tiles withhold silently on no-data (SeasonRoadmap already does); degraded fetches render a `LoadFailed` line (S1-3). Match the card/section styling already in `components/dashboard/plan.tsx` and `SeasonRoadmap.tsx`.
- **Text minimalism:** the user explicitly wants the workflow guided by structure, not prose. Every string added here is a label or a ≤1-line hint, never a paragraph.

---

## File Structure

- `lib/season.ts` — **modify.** Add an exported `FOCUS_LABELS` display-label map (honest names, incl. `general → "all phases"`).
- `lib/season.test.ts` — **modify.** Assert the label map covers every focus value.
- `components/SeasonRoadmap.tsx` — **modify.** Render a 3-step teaching stub when there's no season yet (instead of returning `null`); use `FOCUS_LABELS` for period labels.
- `components/SeasonSection.tsx` — **modify.** Scaffold the objective field (clearer label + one-line relationship hint + better placeholder).
- `components/dashboard/BlockGenerator.tsx` — **modify.** Add a "targeting: <focus> · pulling N goals from your profile" context line above the form, and a profile link.
- `components/dashboard/PlanView.tsx` — **modify.** Thread the current focus label + goal count into `BlockGenerator` (already computes `currentPeriod` in `loadSeasonCtx`).

---

### Task 1: Honest focus labels (`FOCUS_LABELS`)

**Files:**
- Modify: `lib/season.ts`
- Test: `lib/season.test.ts`

**Interfaces:**
- Produces: `export const FOCUS_LABELS: Record<SeasonFocus | "general", string>`.

- [ ] **Step 1: Write the failing test**

Add to `lib/season.test.ts`:

```ts
import { FOCUS_LABELS } from "./season";

describe("FOCUS_LABELS", () => {
  it("gives 'general' an honest, non-noise label", () => {
    expect(FOCUS_LABELS.general).toBe("all phases");
  });
  it("covers every focus value", () => {
    for (const f of ["general", "aerobic-base", "threshold", "vo2max", "anaerobic", "durability", "sharpen"] as const) {
      expect(FOCUS_LABELS[f]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- season`
Expected: FAIL — `FOCUS_LABELS` not exported.

- [ ] **Step 3: Add the map**

Add to `lib/season.ts` (near the top-level exports):

```ts
// Display labels for a goal's focus. "general" is not a physiological system — it means "relevant in
// every phase" (filterGoalsByFocus always includes it), so it reads as an intentional "all phases" tag
// rather than the meaningless default it looked like before. Stored values are unchanged; this is display-only.
export const FOCUS_LABELS: Record<SeasonFocus | "general", string> = {
  general: "all phases",
  "aerobic-base": "aerobic base",
  threshold: "threshold",
  vo2max: "VO2max",
  anaerobic: "anaerobic",
  durability: "durability",
  sharpen: "sharpen",
};
```

(Ensure `SeasonFocus` is imported in `season.ts` — it already uses the type.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- season`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): honest focus labels (general → 'all phases')"
```

---

### Task 2: No-season teaching stub in the roadmap slot

**Files:**
- Modify: `components/SeasonRoadmap.tsx:34` (the `if (!plan || plan.periods.length === 0) return null;` early return) and the period label (line 51).

**Interfaces:** none new (pure JSX).

- [ ] **Step 1: Replace the silent no-season return with a 3-step teaching stub**

In `components/SeasonRoadmap.tsx`, replace line 34:

```tsx
  if (!plan || plan.periods.length === 0) return null;
```

with:

```tsx
  // No season yet: instead of vanishing, teach the model in three steps (structure over prose). This is
  // the answer to "what changes once I generate a season?" — shown, not explained in a paragraph.
  if (!plan || plan.periods.length === 0) {
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
          <li className="flex items-baseline gap-1.5"><span className="font-mono text-[#ff49c8]">3</span> Each block auto-targets the current phase &amp; your goals.</li>
        </ol>
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          Add an objective &amp; a target event below to generate your season.
        </p>
      </section>
    );
  }
```

- [ ] **Step 2: Use FOCUS_LABELS for the period label**

Add `FOCUS_LABELS` to the `season` import (line 6). The period card currently shows `p.label` (from `roadmapView`) — leave `p.label` as-is (it is already human phase text), but if `roadmapView` emits a raw `focus` anywhere, wrap it with `FOCUS_LABELS[p.focus]`. Verify by reading `roadmapView` in `lib/season.ts`; if `p.label` already reads well, no change is needed here beyond the import for Task 4 reuse.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Then visual smoke: `npm run dev`, open `http://localhost:3100/plan` with no season saved (or temporarily rename the season data) — confirm the 3-step stub renders where the roadmap would be.

- [ ] **Step 4: Commit**

```bash
git add components/SeasonRoadmap.tsx
git commit -m "feat(plan): teach Season→Block→goals in 3 steps when no season exists"
```

---

### Task 3: Scaffold the objective field

**Files:**
- Modify: `components/SeasonSection.tsx:64-85` (the card intro + objective label/input).

**Interfaces:** none new (copy/JSX).

- [ ] **Step 1: Replace the vague intro + objective label**

In `components/SeasonSection.tsx`, replace the intro paragraph (lines 66-68) and the objective `<label>` block (lines 73-85) with:

```tsx
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Your season is the arc the coach periodizes — one line on what you&apos;re chasing, plus any target
        events. Blocks are generated <span className="font-medium">against</span> it.
      </p>
      {seasonLoadFailed ? (
        <LoadFailed what="your season (objective & events)" retry={() => void loadSeason()} />
      ) : (
        <>
      <label className="block">
        <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
          Objective <span className="font-normal text-zinc-400 dark:text-zinc-500">— the one outcome the whole season serves</span>
        </span>
        <input
          type="text"
          value={objective}
          placeholder="e.g. faster on hilly KOMs — raise FTP + 1–5 min punch"
          onChange={(e) => {
            setObjective(e.target.value);
            if (seasonSaveState.state === "saved") setSeasonSaveState({ state: "idle" });
          }}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
        />
      </label>
```

> Note: this keeps the existing `seasonLoadFailed` conditional and `<>` fragment structure — only the intro copy, the label, and the placeholder change. Verify the closing `</>` / `)}` at the end of the block is untouched.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` then visual smoke on `/plan` — the Season card intro + objective now state the relationship.

- [ ] **Step 3: Commit**

```bash
git add components/SeasonSection.tsx
git commit -m "feat(season): scaffold objective field — states the season↔block relationship inline"
```

---

### Task 4: Generator shows what it's targeting

**Files:**
- Modify: `components/dashboard/PlanView.tsx` — compute the current focus label + goal count in `loadSeasonCtx` and thread them into `BlockGenerator`.
- Modify: `components/dashboard/BlockGenerator.tsx` — add props + a context line.

**Interfaces:**
- Consumes: `FOCUS_LABELS` (Task 1), `currentPeriod`, `filterGoalsByFocus` (already used in `loadSeasonCtx`).
- Produces: `BlockGeneratorProps` gains `focusLabel: string | null` and `goalCount: number`.

- [ ] **Step 1: Add the props to BlockGenerator**

In `components/dashboard/BlockGenerator.tsx`, add to `BlockGeneratorProps` (after `seasonReadout`):

```ts
  focusLabel: string | null; // current season phase this block targets (display label), or null (no season)
  goalCount: number; // how many profile goals are being pulled into this focus
```

Add both to the destructured params. Then, right after the `{seasonReadout && (...)}` block (~line 114), add:

```tsx
          {focusLabel && (
            <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span>Targeting</span>
              <span className="rounded-full bg-[#ff49c8]/10 px-2 py-0.5 font-medium text-[#b8348f] dark:text-[#ff49c8]">{focusLabel}</span>
              {goalCount > 0 && <span>· pulling {goalCount} goal{goalCount === 1 ? "" : "s"} from your profile</span>}
              <a href="/profile" className="text-cyan-700 hover:underline dark:text-[#00d4ff]">edit profile →</a>
            </p>
          )}
```

- [ ] **Step 2: Thread the values in PlanView**

In `components/dashboard/PlanView.tsx`, add two state values near `seasonReadout`:

```ts
  const [focusLabel, setFocusLabel] = useState<string | null>(null);
  const [goalCount, setGoalCount] = useState(0);
```

Import `FOCUS_LABELS`: change the season import (line 7) to include it:

```ts
import { currentPeriod, filterGoalsByFocus, formatSeasonContext, suggestedBlockWeeks, FOCUS_LABELS } from "@/lib/season";
```

In `loadSeasonCtx`, inside the `if (period) {` branch (after `setSeasonReadout(...)`), set:

```ts
        setFocusLabel(FOCUS_LABELS[period.focus]);
        if (rawGoals.length > 0) {
          const filtered = filterGoalsByFocus(rawGoals as Array<{ goal: string; target: string; focus: import("@/lib/types").SeasonFocus | "general" }>, period.focus);
          setGoalCount(filtered.length);
          setGoal(filtered.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
        }
```

(Leave the existing `else if (rawGoals.length > 0)` branch; add `setFocusLabel(null)` in the `catch`/no-period path so a failed/absent season shows no target line.)

Pass to `<BlockGenerator … focusLabel={focusLabel} goalCount={goalCount} />`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` then visual smoke on `/plan` with a season active — the generator now shows "Targeting <phase> · pulling N goals · edit profile →".

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/BlockGenerator.tsx components/dashboard/PlanView.tsx
git commit -m "feat(plan): generator shows the season phase + profile goals it targets"
```

---

## Self-Review Notes

- **Spec coverage:** objective less vague (Task 3); teaches objective↔block↔season (Tasks 2-4); "general" no longer noise (Task 1, consumed here + in Plan 4's goals list); goals↔generation connection made visible (Task 4). The workflow is guided by structure (the roadmap stub, the targeting line), not prose.
- **Not in scope:** changing the periodization engine or `filterGoalsByFocus` behaviour (it already treats "general" correctly as always-included); reworking the events editor. Those aren't broken.
- **Cross-plan:** `FOCUS_LABELS` (Task 1) is also consumed by Plan 4 (goals list). Land Task 1 before Plan 4's goals task, or Plan 4 defines it locally.
