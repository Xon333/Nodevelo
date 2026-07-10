# Layout Density — Plan Calendar & Trends Dead-Space Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Plan page's block calendar real visual weight (it's the primary artifact and reschedule surface, but currently sits last and only 28px tall) and eliminate the Trends "Weekly volume" card's dead air (49% empty).

**Architecture:** Two presentational edits, each grounded in measured pixel geometry (viewport 1280×800, DOM `getBoundingClientRect`). On `/plan`: the Active-block card stacks header → overview → "This week" → calendar, so 393px of text/stats sit above a 153px calendar — the calendar reads secondary. Fix: hoist the calendar directly under the header, push the long overview to the bottom, and raise the day-cell height from 28px to a proper drag/tap target for rescheduling. On `/trends`: the "Weekly volume" card is force-stretched (`items-stretch`) to match its taller sibling but its 56px bar chart only fills half, leaving ~109px empty — fix by making the volume bars tall enough to use the space.

**Tech Stack:** TypeScript 5, React 19, Tailwind v4. No logic, no tests — verify by visual smoke + DOM measurement.

## Global Constraints

- **No unit tests** (pure layout/styling). Verify each task with `npx tsc --noEmit` + a live check: `npm run dev` (dev server is `dev:preview` on **port 3100** per `.claude/launch.json`), open the page, and confirm the geometry with the browser (or the preview tools' `inspect`).
- **No data/API/logic changes.** Only JSX order and Tailwind classes / inline heights.
- **Reschedule context:** the day-cell `MoveDay` popover (plan.tsx:317) is the reschedule action — taller cells directly serve the shipping reschedule feature. Do NOT move the `RescheduleBanner` (it's a top-of-page alert; alerts stay high — Constitution §4).
- **Measured baselines to beat:** `/plan` calendar 992-wide card, cells 122×**28px**, calendar starts at y≈425 (393px of content above it). `/trends` Weekly-volume card 363×223px with only ~114px of content → ~109px dead air.
- **Grounded correction:** the Trends "Recent baselines" row is a tidy, tight 4-tile row (234×53px tiles, minimal padding) — it is **fine as-is**. Do not restructure it; the real Trends offender is the Weekly-volume card only.

---

## File Structure

- `components/dashboard/plan.tsx` — **modify.** Reorder `CurrentBlockSection` body (calendar up, overview down); raise `BlockCalendar` day-cell height (h-7 → h-10).
- `components/trends/sections.tsx` — **modify.** Raise `WeeklyVolumeBars` chart height (56 → 130) to fill the card.

---

### Task 1: Hoist the calendar and give it drag-target height

**Files:**
- Modify: `components/dashboard/plan.tsx` — `CurrentBlockSection` body (lines 500-526) and the day-cell className (line 256).

**Interfaces:** none (JSX order + class change).

- [ ] **Step 1: Reorder the card body — calendar directly under the header**

In `components/dashboard/plan.tsx`, the current order inside `<div className="relative z-10">` is: header block (ends line 499) → `{block.overview && <BlockOverview…>}` (500) → "This week" block (501-518) → `<BlockCalendar…>` (519-526).

Reorder to: header → **calendar** → "This week" → **overview**. Concretely:

1. Cut the `<BlockCalendar … />` element (lines 519-526) and paste it immediately after the header block's closing `</div>` (line 499), i.e. directly before `{block.overview && <BlockOverview text={block.overview} />}`.
2. Cut `{block.overview && <BlockOverview text={block.overview} />}` (line 500) and paste it at the very end of the `z-10` div, after the "This week" `{daysRemaining > 0 && (…)}` block (after line 518, before the closing `</div>` on line 527).

Resulting body order:
```tsx
        {/* header block … (unchanged, lines 410-499) */}
        <BlockCalendar
          weeks={weeks}
          characters={characters}
          scores={scores}
          compromisedDates={compromisedDates}
          partialDates={partialDates}
          blockEndDate={block.endDate}
        />
        {daysRemaining > 0 && (
          <div className="mt-3">
            {/* "This week" stats + top session … (unchanged, lines 502-517) */}
          </div>
        )}
        {block.overview && <BlockOverview text={block.overview} />}
```

Add a `mt-3` wrapper to the calendar if it doesn't already carry top spacing (BlockCalendar's outer div — check line ~230; if its root lacks a top margin, wrap the element: `<div className="mt-3"><BlockCalendar … /></div>`).

- [ ] **Step 2: Raise the day-cell height**

In `components/dashboard/plan.tsx`, the day-cell wrapper (line 256) has `flex h-7 w-full items-center …`. Change `h-7` to `h-10` (28px → 40px — a real drag/tap target for `MoveDay` reschedules):

```tsx
                      className={`flex h-10 w-full items-center justify-center rounded text-[10px] font-medium ${TYPE_STYLES[day.type].cell} ${
```

- [ ] **Step 3: Verify geometry**

Run: `npx tsc --noEmit`, then `npm run dev` and open `http://localhost:3100/plan`. Confirm: the calendar now starts high in the card (directly under the header, not after 393px of prose/stats), day cells are ~40px tall, and the block overview sits at the card bottom. Measure a day cell's height via the browser (`getBoundingClientRect().height ≈ 40`).

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/plan.tsx
git commit -m "feat(plan): hoist the block calendar under the header + taller cells for reschedule"
```

---

### Task 2: Fill the Trends "Weekly volume" dead space

**Files:**
- Modify: `components/trends/sections.tsx:152` (the `WeeklyVolumeBars` chart height).

**Interfaces:** none.

- [ ] **Step 1: Raise the volume-bar chart height**

In `components/trends/sections.tsx`, `WeeklyVolumeBars` renders its bars in `<div className="flex items-end gap-px" style={{ height: 56 }}>` (line 152). Raise the height so the chart fills the card (which is stretched to ~223px next to "Fueling & weight"):

```tsx
      <div className="flex items-end gap-px" style={{ height: 130 }}>
```

> Do NOT touch the visually-identical `style={{ height: 56 }}` on line 114 — that belongs to `DeliveryCard`'s execution-score bars, a different card that is correctly sized. Only line ~152 (inside `WeeklyVolumeBars`) changes.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`, then `npm run dev`, open `http://localhost:3100/trends`, scroll to "Load & fuel". Confirm the "Weekly volume" bar cluster now fills most of the card (dead air below the caption reduced from ~109px to a small remainder) and the two cards in that row read as balanced. Measure the volume card's chart height ≈ 130.

- [ ] **Step 3: Commit**

```bash
git add components/trends/sections.tsx
git commit -m "feat(trends): fill the Weekly-volume card — taller bars, less dead air"
```

---

## Self-Review Notes

- **Spec coverage:** calendar emphasized + sized for reschedule (Task 1); Weekly-volume dead space used (Task 2). The "Recent baselines stretched" concern was measured and is a non-issue — deliberately left alone (see Global Constraints).
- **Not in scope:** moving `RescheduleBanner` (alerts stay high); the Engine sparkline cards' padding (minor, and the thin-SVG look is intentional). If the user wants the calendar taller still (e.g. h-11/44px) or the overview collapsed into a `<details>`, those are one-line follow-ups after eyeballing Task 1.
- **Measurement, not guessing:** all pixel targets came from a DOM inspection pass at 1280×800; re-measure after each task rather than trusting a screenshot (the capture pipeline scaled the JPEG — DOM geometry is authoritative).
