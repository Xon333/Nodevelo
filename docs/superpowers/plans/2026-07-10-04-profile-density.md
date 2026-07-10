# Profile Page Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the Profile page's redundancy and bulk — compact the oversized Effort Bands card, stop the Rider-profile card from re-listing watts the Power-PRs card already shows, and make Goals & Weakpoints scannable at a glance instead of a flat list.

**Architecture:** All changes live in two presentational components (`AthleteProfileForm.tsx`, `IfBandOffsets.tsx`). No data or API changes. The guiding cut: each "current numbers" surface should answer a *different* question — Power PRs = your power-duration curve, Rider profile = your phenotype (the label + where you're strong/weak), Current performance = the canonical FTP/HR/weight. Where two surfaces show the same watts, one loses them.

**Tech Stack:** TypeScript 5, React 19, Tailwind v4, Vitest.

## Global Constraints

- **`npm test`** runs Vitest. These are presentational changes: verify with `npx tsc --noEmit` + visual smoke on `/profile` (`npm run dev`, dev server `dev:preview` on port 3100). Add a unit test only for extracted pure logic (Task 3's grouping helper).
- **No new dependencies. No data/API changes.** Do not alter what `/api/profile` returns or the `athlete.md` schema.
- **Preserve the synced/owned split** (the existing `Section` component's `synced` vs `editHref` distinction) — a synced number is never made editable and vice-versa.
- **Depends on** Plan 3's `FOCUS_LABELS` export (`lib/season.ts`) for the goals list. If Plan 3 hasn't landed, define the same map locally in this component.
- **Accessibility:** keep the existing `<ul>`/`<li>` semantics for goals; grouping must not drop list roles.

---

## File Structure

- `components/IfBandOffsets.tsx` — **modify.** Wrap the effort-bands table in a collapsed `<details>` disclosure (reference data, not daily-use) with a one-line summary of the key numbers.
- `components/AthleteProfileForm.tsx` — **modify.** (a) Trim per-system watts from the Rider-profile card (dedupe vs Power PRs), keeping phenotype + %-vs-expected. (b) Regroup the Goals list by focus with clearer hierarchy, using `FOCUS_LABELS`.
- `lib/profile-goals.ts` — **create.** A tiny pure `groupGoalsByFocus` helper (so the grouping is testable).
- `lib/profile-goals.test.ts` — **create.** Unit test for the grouping.

---

### Task 1: Compact the Effort Bands card into a disclosure

**Files:**
- Modify: `components/IfBandOffsets.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Read the component**

Read `components/IfBandOffsets.tsx` fully to find the outer wrapper and the rows it renders (`rows: IfBandOffsetRow[]`).

- [ ] **Step 2: Wrap the table body in a collapsed disclosure with a summary line**

Keep the card header/title. Replace the always-open table body with a `<details>` whose `<summary>` shows a one-line digest (e.g. the count of adjusted zones or "your zone edges vs population"), and whose open content is the existing table. Concretely, wrap the existing rows markup:

```tsx
<details>
  <summary className="cursor-pointer select-none text-xs text-zinc-500 dark:text-zinc-400">
    Your IF bands vs population defaults{adjustedCount > 0 ? ` · ${adjustedCount} shifted to your zones` : " · using population defaults"}
  </summary>
  <div className="mt-2">
    {/* the existing rows table markup, unchanged */}
  </div>
</details>
```

Where `adjustedCount` = number of rows whose offset ≠ 0 (compute from `rows` with `rows.filter(r => r.offset !== 0).length` — match the actual field name on `IfBandOffsetRow`; read `lib/calibration.ts` `IfBandOffsetRow` to confirm).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` then visual smoke on `/profile` — the Effort Bands card is now a compact one-liner that expands on click.

- [ ] **Step 4: Commit**

```bash
git add components/IfBandOffsets.tsx
git commit -m "feat(profile): collapse Effort Bands into a compact disclosure (reference data)"
```

---

### Task 2: De-duplicate the Rider-profile watts against Power PRs

**Files:**
- Modify: `components/AthleteProfileForm.tsx:274-300` (the `riderProfileSection` systems grid).

**Interfaces:** none new.

- [ ] **Step 1: Confirm the overlap**

The Power-PRs card (lines 304-355) already lists watts at 5s/1min/5min/20min etc. The Rider-profile systems grid (lines 274-300) re-lists `s.watts` + `s.wattsPerKg` for the same durations. The phenotype label + `% vs expected` (relative strength) is the Rider-profile card's unique value; the raw watts are the duplication.

- [ ] **Step 2: Drop the duplicated watts, keep the signal**

In the `riderProfileSection` systems `.map` (lines 275-299), remove the two watt lines and keep the system label + the relative-strength read. Replace the inner card body:

```tsx
              <div key={s.system} className="rounded bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{SYSTEM_LABELS[s.system]}</p>
                <p
                  className={
                    strong
                      ? "mt-0.5 text-sm font-semibold text-cyan-700 dark:text-[#00d4ff]"
                      : weak
                        ? "mt-0.5 text-sm font-semibold text-amber-700 dark:text-amber-400"
                        : "mt-0.5 text-sm font-medium text-zinc-600 dark:text-zinc-300"
                  }
                >
                  {pct > 0 ? "+" : ""}{pct}%
                </p>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500">vs expected</p>
              </div>
```

This keeps the phenotype's *meaning* (where you're strong/weak relative to your engine) and drops the raw watts that Power PRs owns. The `s.watts`/`s.wattsPerKg` reads are removed; `pct`, `strong`, `weak` are already computed above the return.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` then visual smoke on `/profile` — Rider profile now shows phenotype + strengths only; watts appear once (Power PRs).

- [ ] **Step 4: Commit**

```bash
git add components/AthleteProfileForm.tsx
git commit -m "feat(profile): de-duplicate Rider-profile watts (Power PRs owns the numbers)"
```

---

### Task 3: Group Goals by focus for scannability

**Files:**
- Create: `lib/profile-goals.ts`, `lib/profile-goals.test.ts`
- Modify: `components/AthleteProfileForm.tsx:466-481` (the goals `<ul>` read-view).

**Interfaces:**
- Produces: `groupGoalsByFocus<T extends { focus: SeasonFocus | "general" }>(goals: T[]): Array<{ focus: SeasonFocus | "general"; goals: T[] }>` — stable focus order, only non-empty groups.

- [ ] **Step 1: Write the failing test**

Create `lib/profile-goals.test.ts`:

```ts
import { groupGoalsByFocus } from "./profile-goals";

describe("groupGoalsByFocus", () => {
  it("groups goals under their focus in a stable order, skipping empty groups", () => {
    const goals = [
      { goal: "raise FTP", target: "300W", focus: "threshold" as const },
      { goal: "lose 3kg", target: "", focus: "general" as const },
      { goal: "5min power", target: "", focus: "vo2max" as const },
      { goal: "hold threshold longer", target: "", focus: "threshold" as const },
    ];
    const groups = groupGoalsByFocus(goals);
    expect(groups.map((g) => g.focus)).toEqual(["threshold", "vo2max", "general"]);
    expect(groups[0].goals).toHaveLength(2); // two threshold goals together
  });
  it("returns [] for no goals", () => {
    expect(groupGoalsByFocus([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- profile-goals`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `lib/profile-goals.ts`:

```ts
import type { SeasonFocus } from "./types";

// Stable display order for goal groups: physiological systems in periodization order, then "all phases".
const FOCUS_ORDER: Array<SeasonFocus | "general"> = [
  "aerobic-base", "threshold", "vo2max", "anaerobic", "durability", "sharpen", "general",
];

// Group goals under their focus, in FOCUS_ORDER, skipping empty groups. Pure — for a scannable,
// system-clustered goals view (vs a flat list where every row carried a redundant focus chip).
export function groupGoalsByFocus<T extends { focus: SeasonFocus | "general" }>(
  goals: T[]
): Array<{ focus: SeasonFocus | "general"; goals: T[] }> {
  return FOCUS_ORDER.map((focus) => ({ focus, goals: goals.filter((g) => g.focus === focus) })).filter(
    (grp) => grp.goals.length > 0
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- profile-goals`
Expected: PASS.

- [ ] **Step 5: Render grouped goals**

In `components/AthleteProfileForm.tsx`, import at top:

```ts
import { groupGoalsByFocus } from "@/lib/profile-goals";
import { FOCUS_LABELS } from "@/lib/season";
```

Replace the goals read-view `<ul>` (lines 466-481) with a grouped view — a focus heading per group, goals under it, and NO per-row chip (the group heading carries the classification now):

```tsx
            <div className="space-y-2.5">
              {groupGoalsByFocus(goals).map((grp) => (
                <div key={grp.focus}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    {FOCUS_LABELS[grp.focus]}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {grp.goals.map((g, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">{g.goal || "—"}</span>
                        {g.target && (
                          <>
                            <span aria-hidden className="text-zinc-400 dark:text-zinc-500">→</span>
                            <span className="text-zinc-600 dark:text-zinc-300">{g.target}</span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
```

> The weakpoints `<ul>` just below (lines 482-492) stays as-is. The edit-mode `<details>` form (with the focus `<select>`) is unchanged — grouping is a read-view concern only.

- [ ] **Step 6: Verify**

Run: `npm test -- profile-goals` then `npx tsc --noEmit`, then visual smoke on `/profile` — goals cluster under focus headings, chips gone, each goal reads as `goal → target`.

- [ ] **Step 7: Commit**

```bash
git add lib/profile-goals.ts lib/profile-goals.test.ts components/AthleteProfileForm.tsx
git commit -m "feat(profile): group goals by focus for scannability; drop redundant per-row chips"
```

---

## Self-Review Notes

- **Spec coverage:** Effort Bands smaller (Task 1); "current ability" duplication cut where it's real — Rider-profile watts vs Power PRs (Task 2); Goals scannable, "General" noise removed via grouping + honest label (Task 3). 
- **Honest scope correction:** the Profile "Current performance" tiles (FTP · threshold HR · max HR · weight) and the Trends "Recent baselines" tiles (w/kg@threshold · weekly hours · rides/week · avg load) mostly show *different* things — the only genuine overlap is w/kg@threshold. So there is no large Current-Performance↔Recent-Baselines de-dup to do here; the real intra-page duplication was Rider-profile↔Power-PRs (Task 2). Any framing-of-baselines-as-a-trend change belongs to the Trends layout work (Plan 5), not here.
- **Type consistency:** `groupGoalsByFocus` and `FOCUS_LABELS` share the `SeasonFocus | "general"` union; `FOCUS_ORDER` in the helper and `FOCUS_LABELS` in season.ts must cover the same keys.
