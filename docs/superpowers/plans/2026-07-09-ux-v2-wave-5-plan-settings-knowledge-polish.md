# UX v2 Wave 5 — Plan hero orientation + Settings grouping + Knowledge header + density polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the final wave of the UX v2 zero-based redesign — Plan's calendar hero gains week orientation + an in-hero week strip, Settings splits into GENERATION/PLATFORM groups, Knowledge gets a provenance header, and the Waves 3–4 density-polish backlog (driver-bar colour, Trends a11y, Profile empty-state/double-labels, calibration confidence adjacency) is cleared.

**Architecture:** Presentation-layer wave. One small pure, unit-tested helper (`lib/plan-week-character.ts`) supplies the honest per-week character label (there is no per-week phase in the data model — see Task 1's decision note); everything else is JSX edits over existing components. No `/api/*` route changes. One new client component (`PlatformBehaviorForm`) is extracted so Settings' Platform behavior card can physically sit under the PLATFORM divider. All doc duty (DESIGN.md §8 + §2, UX-MASTERPLAN §6/§7, header bump) lands in the final wave-gate task, exactly as Waves 1–4 did.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind v4, TypeScript 5, Vitest.

## Decisions embedded in this plan (rationale a future engineer needs)

1. **Per-week "character" label — DERIVE it, option (a), do not cut.** `CurrentBlock` (`lib/types.ts`) carries a single whole-block `seasonPhase?: string`; there is **no** per-week phase in the data model. Spreading the one whole-block value across weeks would misrepresent it (Constitution §5 provenance — dishonest to the athlete). Instead Task 1 adds a pure, deterministic `weekCharacters(weeklyMinutes)` helper that characterises each week purely by its **planned volume relative to the block** — the same category of client-side derivation Wave 3 used for `trendDir`/`halvesDir`. The hero labels it with a derivation tip ("characterised by this week's planned volume relative to the block — not a prescribed periodization phase") so provenance is honest. `weeklyMinutes` is already computed inside `BlockCalendar` today, so no new data is needed. Because option (a) is chosen, **no masterplan scope-cut amendment is required** — only a provenance clarification (Task 8).

2. **Week strip "hours vs target" — keep it, computed over the aligned block-week window.** The masterplan names "hours vs target · load · top session". Task 2 computes **both** actual (from `sync.activities`) and target (planned) over the **same** current-block-week date window (the 7-day slice `weeks[weekOfBlock-1]`), so the two numbers share one window and don't trip ban-list §10.7 (two windows, near-identical labels). This replaces the old `WeeklyDebrief`'s Monday-anchored "this week" computation.

3. **Avg HRV / avg sleep — DROP from the merged strip.** The masterplan's strip list is "hours · load · top session" and never mentions them. Their canonical home is Today's readiness verdict / drivers (recovery inputs answer M1's "can I go hard?", not Plan's M3 "where am I in the block?"). Keeping them on Plan is the "metric answering another page's question" anti-pattern (Constitution §4, court rule 1). So they leave with `WeeklyDebrief`; this is compliance with the masterplan, recorded as a one-line §6 note in Task 8.

4. **Negative driver-bar colour — UNIFY on RED.** `StateDriversCard`'s bar paints a **negative** effect amber while the numeric value in the same row uses `driverEffectClass` = **red**, and every other "declining/negative" signal in the app (`trendDir`, `BlockTimeline` CTL loss, `ScoreBars` low band) uses red. DESIGN.md §2 already codifies red = danger/negative and amber = caution/warning — two distinct registers. The amber bar is the drift: it shows two severity colours for one signal inside a single row. Task 5 repaints the negative bar red (`bg-red-500/80 dark:bg-red-400/70`), matching the emerald-positive pattern, and Task 8 adds a one-line DESIGN.md §2 clarification so it can't recur. No new hex token is introduced (red is already sanctioned) — this is aligning to existing tokens, not adding one.

5. **Truncated driver notes (touch-reachability) — switch `truncate` → `line-clamp-2`, keep `title` as a desktop accelerator.** The driver note is decision-supporting context; Constitution §2/§6 forbid it being *only* reachable on hover. `line-clamp-2` makes the note touch-readable without any hover dependency, keeps layout tight, and the native `title` remains a mouse accelerator (DESIGN.md §7 sanctions `title` for dense per-datum detail). Cheapest honest fix; done in Task 5.

## Global Constraints

Every task's requirements implicitly include this section.

- **Commands:** run with `npm`. `npm test` = `vitest run`; `npm run build`; `npm run check` = tsc + lint + test. `npm run check` is green at HEAD — keep it green.
- **This checkout is shared with a concurrent agent session on the same machine.** Stage only the files this task touched (`git add <path>...`), **never** `git add -A` / `git add .`. Before editing a file, run `git status --short <file>`: if it shows uncommitted foreign changes, wait ~30s and re-check once; if still dirty, **STOP and report BLOCKED** to the controller. If a build/lint error surfaces in a file this task did **not** touch, status-check it first — uncommitted = the other agent mid-edit, do not "fix" it.
- **Commit directly on `main`** (trunk-based; no branches, no worktrees).
- **This Next.js version differs from training data** — read the relevant guide in `node_modules/next/dist/docs/` before writing any App Router code that feels uncertain (App Router page/component conventions differ from pre-training templates).
- **No `/api/*` route changes and no new lib logic files** except the single pure, unit-tested `lib/plan-week-character.ts` helper in Task 1 (matching the Wave 3 `trendDir`/`halvesDir` derivation pattern). This wave is presentation-layer.
- **Fix-wave gating:** any commit whose job is fixing review findings must gate on `npm run check` (not just `npm test`). A prior wave (W3 Task 0) shipped a lint regression because a fix-commit ran only tests + build. This is explicit.
- **Verification model (JSX-heavy wave):** per-task gate = `npm run check` + `npm run build`. The human controller — not the implementer — runs a live Playwright preview walk against the running dev server after the wave's tasks land, **dark-mode-first**, and reports results back into the SDD process. Do **not** write browser-automation steps into any task.
- **Commit-trailer convention:** end each commit message with a `Co-Authored-By:` line crediting the model that actually authored the commit (repo convention — do not blanket-credit a plan-authoring model). The trailer shown in each task is a placeholder; the executor substitutes the real authoring model.

---

### Task 1: Plan hero orientation — `weekCharacters` helper + header/week-row labels + next-session pointer

**Files:**
- Create: `lib/plan-week-character.ts`
- Test: `lib/plan-week-character.test.ts`
- Modify: `components/dashboard/plan.tsx` (module-level `relDay` helper; `BlockCalendar` gains `weeks`/`characters` props and drops internal chunking; `CurrentBlockSection` lifts chunking, computes character + next session, augments the header)

**Interfaces:**
- Produces: `weekCharacters(weeklyMinutes: number[]): string[]` — pure, returns one of `"load" | "build" | "peak" | "taper"` per week (as `string`). Task 2 relies on `CurrentBlockSection` already computing `weeks: CurrentBlock["days"][]` and `weeklyMinutes: number[]` in its body (Task 2 reuses both).
- Consumes: existing `CurrentBlock` / `CurrentBlockDay` types from `@/lib/types`; `InfoDot` from `../ui`.

- [ ] **Step 1: Write the failing test**

Create `lib/plan-week-character.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { weekCharacters } from "./plan-week-character";

describe("weekCharacters", () => {
  it("labels a classic ramp+deload block: load → build → peak → taper", () => {
    // avg = 330; peak week = index 2 (420); final week (240) is below avg → taper.
    expect(weekCharacters([300, 360, 420, 240])).toEqual(["load", "build", "peak", "taper"]);
  });

  it("does not label the final week 'taper' when it is the block's biggest week", () => {
    // avg = 300; peak = final week (400) which is >= avg → 'peak', not 'taper'.
    expect(weekCharacters([200, 300, 400])).toEqual(["load", "build", "peak"]);
  });

  it("handles a flat block deterministically (first week reads peak, rest build)", () => {
    // all equal → nothing is below avg; peakIdx defaults to 0.
    expect(weekCharacters([300, 300, 300])).toEqual(["peak", "build", "build"]);
  });

  it("returns a single 'peak' for a one-week block and [] for empty", () => {
    expect(weekCharacters([200])).toEqual(["peak"]);
    expect(weekCharacters([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- plan-week-character`
Expected: FAIL — `Cannot find module './plan-week-character'` (or `weekCharacters is not a function`).

- [ ] **Step 3: Write the helper**

Create `lib/plan-week-character.ts`:

```ts
// Presentational per-week "character" for the Plan hero's week rows. There is NO per-week phase in the
// data model — CurrentBlock carries a single whole-block seasonPhase, and spreading that one value across
// weeks would misrepresent it (Constitution §5 provenance). Instead we characterise each week purely by
// its planned volume relative to the block: an honest, deterministic read the hero labels as
// volume-derived (same category of client-side derivation as Wave 3's trendDir/halvesDir).
//
// Rule: below-average non-final weeks read "load"; above-average weeks read "build"; the single
// biggest-volume week reads "peak"; the final week reads "taper" only when it is below the block average
// (a real deload). A flat block has no week below average, so its peak defaults to week 0 — acceptable
// given the derivation tip the hero shows alongside it.
export function weekCharacters(weeklyMinutes: number[]): string[] {
  const n = weeklyMinutes.length;
  if (n === 0) return [];
  const avg = weeklyMinutes.reduce((s, m) => s + m, 0) / n;
  let peakIdx = 0;
  for (let i = 1; i < n; i++) if (weeklyMinutes[i] > weeklyMinutes[peakIdx]) peakIdx = i;
  return weeklyMinutes.map((m, i) => {
    if (i === n - 1 && m < avg) return "taper";
    if (i === peakIdx) return "peak";
    return m < avg ? "load" : "build";
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- plan-week-character`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the helper + `relDay` + `InfoDot` into `plan.tsx` imports**

In `components/dashboard/plan.tsx`, the current ui import reads:

```tsx
import { Card, StatTile, CyberFrame } from "../ui";
```

Change it to add `InfoDot`:

```tsx
import { Card, StatTile, CyberFrame, InfoDot } from "../ui";
```

Immediately below the existing imports (before the `BlockOverview` component), add a module-level relative-day formatter:

```tsx
// Relative label for the "next: <session>, <when>" pointer. Parse with an explicit local midnight so
// the weekday doesn't drift a day via UTC. `date` is always strictly after `today` at the call site.
function relDay(date: string, today: string): string {
  const diff = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  if (diff <= 1) return "tomorrow";
  if (diff < 7) return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" });
  return date;
}
```

- [ ] **Step 6: Move week-chunking out of `BlockCalendar` and give it `weeks` + `characters` props**

In `BlockCalendar`, replace the current signature and internal chunking. The current code is:

```tsx
function BlockCalendar({ block, scores, compromisedDates, partialDates }: { block: CurrentBlock; scores: RideScoreEntry[]; compromisedDates: string[]; partialDates: string[] }) {
```

…with (further down) these three lines that build the weeks and minutes internally:

```tsx
  const weeks: CurrentBlock["days"][] = [];
  const sorted = [...block.days].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < sorted.length; i += 7) weeks.push(sorted.slice(i, i + 7));

  const weeklyMinutes = weeks.map((week) =>
    week.reduce((s, d) => s + d.durationMin, 0)
  );
```

Change the signature to accept `weeks` and `characters` and drop the now-unused `block` prop:

```tsx
function BlockCalendar({ weeks, characters, scores, compromisedDates, partialDates }: { weeks: CurrentBlock["days"][]; characters: string[]; scores: RideScoreEntry[]; compromisedDates: string[]; partialDates: string[] }) {
```

Delete the three chunking lines quoted above and replace them with just the minutes derivation over the incoming `weeks` (the `sorted`/`weeks` build now lives in `CurrentBlockSection`):

```tsx
  const weeklyMinutes = weeks.map((week) =>
    week.reduce((s, d) => s + d.durationMin, 0)
  );
```

- [ ] **Step 7: Render the per-week character label in the calendar's left gutter**

In `BlockCalendar`'s week `.map`, the current left-gutter span is:

```tsx
            <span className="w-10 shrink-0 text-right text-[10px] font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
```

Replace it with a stacked gutter showing hours over the character:

```tsx
            <span className="flex w-14 shrink-0 flex-col items-end leading-tight">
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
              {characters[i] && (
                <span className="text-[9px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{characters[i]}</span>
              )}
            </span>
```

The legend row below currently indents with `pl-12`:

```tsx
      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 pl-12">
```

Bump it to `pl-14` to align under the widened gutter:

```tsx
      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 pl-14">
```

- [ ] **Step 8: In `CurrentBlockSection`, lift chunking, compute character + next session, and augment the header**

Add the `weekCharacters` import at the top of `plan.tsx` (with the other `@/lib` imports):

```tsx
import { weekCharacters } from "@/lib/plan-week-character";
```

In `CurrentBlockSection`, after the existing `sessionsToGo` computation (the block ending `.length;`), add:

```tsx
  // Chunking lifted here (was inside BlockCalendar) so the header + week strip and the calendar all read
  // from one source. weeklyMinutes drives both the volume-derived week character and the strip's target.
  const sortedDays = [...block.days].sort((a, b) => a.date.localeCompare(b.date));
  const weeks: CurrentBlock["days"][] = [];
  for (let i = 0; i < sortedDays.length; i += 7) weeks.push(sortedDays.slice(i, i + 7));
  const weeklyMinutes = weeks.map((w) => w.reduce((s, d) => s + d.durationMin, 0));
  const characters = weekCharacters(weeklyMinutes);
  const character = characters[weekOfBlock - 1] ?? "";
  const nextSession = sortedDays.find((d) => d.date > today && d.durationMin > 0) ?? null;
  const nextWhen = nextSession ? relDay(nextSession.date, today) : "";
```

Then replace the existing single date/progress `<p>` block:

```tsx
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {block.startDate} → {block.endDate} ·{" "}
              {daysRemaining > 0
                ? `Week ${weekOfBlock} of ${block.lengthWeeks} · ${sessionsToGo} session${sessionsToGo === 1 ? "" : "s"} to go`
                : "finished"}
            </p>
```

…with a date line, a week-orientation line (character + derivation tip), and the next-session pointer:

```tsx
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {block.startDate} → {block.endDate}
            </p>
            {daysRemaining > 0 ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <span>Week {weekOfBlock} of {block.lengthWeeks}</span>
                {character && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="uppercase tracking-wide text-zinc-600 dark:text-zinc-300">{character}</span>
                    <InfoDot text="Characterised by this week's planned volume relative to the block — not a prescribed periodization phase." />
                  </>
                )}
                <span aria-hidden>·</span>
                <span>{sessionsToGo} session{sessionsToGo === 1 ? "" : "s"} to go</span>
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">finished</p>
            )}
            {nextSession && (
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                next: <span className="text-zinc-700 dark:text-zinc-300">{nextSession.name}</span>, {nextWhen}
              </p>
            )}
```

- [ ] **Step 9: Update the `BlockCalendar` call site**

In `CurrentBlockSection`, the current render is:

```tsx
        <BlockCalendar block={block} scores={scores} compromisedDates={compromisedDates} partialDates={partialDates} />
```

Replace with (drops `block`, adds `weeks` + `characters`):

```tsx
        <BlockCalendar weeks={weeks} characters={characters} scores={scores} compromisedDates={compromisedDates} partialDates={partialDates} />
```

- [ ] **Step 10: Verify**

Run: `npm run check && npm run build`
Expected: tsc clean, lint clean, all tests pass (including the 4 new `weekCharacters` tests), build succeeds. In particular there must be **no** "declared but never used" error for the removed `block` param.

- [ ] **Step 11: Commit**

```bash
git add lib/plan-week-character.ts lib/plan-week-character.test.ts components/dashboard/plan.tsx
git commit -m "feat(plan): hero week orientation — volume-derived character + next-session pointer (UX v2 W5)

weekCharacters() pure helper labels each block week by planned volume relative to the
block (no per-week phase exists in the data model; the single whole-block seasonPhase is
never spread per-week — Constitution §5). Header gains 'week N of M · <character>' with a
derivation tip and a 'next: <session>, <when>' pointer; calendar rows label each week.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Merge the week strip into the hero + retire `WeeklyDebrief`

**Files:**
- Modify: `components/dashboard/plan.tsx` (`CurrentBlockSection` gains a `sync` prop + renders the in-hero week strip; delete the `WeeklyDebrief` export; drop the now-unused `isoDaysAgo` import)
- Modify: `components/dashboard/PlanView.tsx` (pass `sync` into `CurrentBlockSection`; remove the standalone `WeeklyDebrief` render + import)

**Interfaces:**
- Consumes: from Task 1, `CurrentBlockSection` already computes `weeks`, `weeklyMinutes`, and `weekOfBlock` in its body.
- Produces: `CurrentBlockSection` signature gains `sync?: SyncData | null`.

- [ ] **Step 1: Give `CurrentBlockSection` a `sync` prop**

In `components/dashboard/plan.tsx`, the current `CurrentBlockSection` signature is:

```tsx
export function CurrentBlockSection({
  block,
  onDelete,
  scores,
  compromisedDates,
  partialDates,
}: {
  block: CurrentBlock | null;
  onDelete?: () => void;
  scores: RideScoreEntry[];
  compromisedDates: string[];
  partialDates: string[];
}) {
```

Add `sync`:

```tsx
export function CurrentBlockSection({
  block,
  onDelete,
  scores,
  compromisedDates,
  partialDates,
  sync,
}: {
  block: CurrentBlock | null;
  onDelete?: () => void;
  scores: RideScoreEntry[];
  compromisedDates: string[];
  partialDates: string[];
  sync?: SyncData | null;
}) {
```

(`SyncData` is already imported in `plan.tsx`.)

- [ ] **Step 2: Compute the current-week aggregates (aligned window)**

In `CurrentBlockSection`, immediately after the Task 1 block (the line `const nextWhen = ...`), add:

```tsx
  // Week strip (masterplan §6): actual vs planned over the SAME current-block-week window (the 7-day
  // slice), so hours-vs-target share one window and don't trip ban-list §10.7. Avg HRV / avg sleep from
  // the old "This week" panel are intentionally dropped — their home is Today's readiness (Constitution §4).
  const curWeek = weeks[weekOfBlock - 1] ?? [];
  const winStart = curWeek[0]?.date;
  const winEnd = curWeek[curWeek.length - 1]?.date;
  const weekActs =
    sync && winStart && winEnd ? sync.activities.filter((a) => a.date >= winStart && a.date <= winEnd) : [];
  const weekActualHours = weekActs.reduce((s, a) => s + a.movingTimeSec, 0) / 3600;
  const weekPlannedHours = (weeklyMinutes[weekOfBlock - 1] ?? 0) / 60;
  const weekLoad = weekActs.reduce((s, a) => s + (a.trainingLoad ?? 0), 0);
  const weekTop = [...weekActs].sort((a, b) => (b.trainingLoad ?? 0) - (a.trainingLoad ?? 0))[0];
```

- [ ] **Step 3: Render the strip inside the hero**

In `CurrentBlockSection`'s returned JSX, the block overview + calendar currently render as:

```tsx
        {block.overview && <BlockOverview text={block.overview} />}
        <BlockCalendar weeks={weeks} characters={characters} scores={scores} compromisedDates={compromisedDates} partialDates={partialDates} />
```

Insert the week strip between the overview and the calendar:

```tsx
        {block.overview && <BlockOverview text={block.overview} />}
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">This week</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <StatTile label="Hours vs target" value={`${weekActualHours.toFixed(1)} / ${weekPlannedHours.toFixed(1)} h`} />
            {weekLoad > 0 && <StatTile label="Load" value={String(Math.round(weekLoad))} />}
          </div>
          {weekTop && (
            <div className="mt-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Top session</p>
              <p className="mt-0.5 text-sm font-medium leading-snug text-zinc-800 dark:text-zinc-100">{weekTop.name}</p>
              {weekTop.trainingLoad != null && (
                <p className="mt-0.5 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{weekTop.trainingLoad} Load</p>
              )}
            </div>
          )}
        </div>
        <BlockCalendar weeks={weeks} characters={characters} scores={scores} compromisedDates={compromisedDates} partialDates={partialDates} />
```

- [ ] **Step 4: Delete the `WeeklyDebrief` component**

In `components/dashboard/plan.tsx`, delete the entire `WeeklyDebrief` export — from its section comment through its closing brace:

```tsx
// ---------- Weekly debrief ----------

export function WeeklyDebrief({ sync }: { sync: SyncData }) {
  ...
}
```

(The whole function, lines beginning `export function WeeklyDebrief` down to its final `}`.)

- [ ] **Step 5: Drop the now-unused `isoDaysAgo` import**

`isoDaysAgo` was used only by `WeeklyDebrief`. The current date import in `plan.tsx` is:

```tsx
import { isoDaysAgo, localToday as todayIso } from "@/lib/date";
```

Change it to:

```tsx
import { localToday as todayIso } from "@/lib/date";
```

- [ ] **Step 6: Update `PlanView.tsx` — pass `sync`, remove the standalone panel + import**

In `components/dashboard/PlanView.tsx`, the current import from `./plan` is:

```tsx
import {
  BlockHistory,
  CurrentBlockSection,
  RetroSection,
  WeeklyDebrief,
} from "./plan";
```

Remove `WeeklyDebrief`:

```tsx
import {
  BlockHistory,
  CurrentBlockSection,
  RetroSection,
} from "./plan";
```

The current render has the section then a separate debrief panel:

```tsx
      {!retroResult && <CurrentBlockSection block={state.currentBlock} onDelete={deleteBlock} scores={state.scores} compromisedDates={state.compromisedDates} partialDates={state.partialDates} />}

      {state.lastSync && <WeeklyDebrief sync={state.lastSync} />}
```

Replace both lines with the section alone, now threaded `sync`:

```tsx
      {!retroResult && <CurrentBlockSection block={state.currentBlock} onDelete={deleteBlock} scores={state.scores} compromisedDates={state.compromisedDates} partialDates={state.partialDates} sync={state.lastSync ?? null} />}
```

- [ ] **Step 7: Verify**

Run: `npm run check && npm run build`
Expected: tsc clean, lint clean (no unused `isoDaysAgo`, no unused `WeeklyDebrief`/`SyncData`), tests pass, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add components/dashboard/plan.tsx components/dashboard/PlanView.tsx
git commit -m "feat(plan): week strip in-hero (hours vs target · load · top session); retire WeeklyDebrief panel (UX v2 W5)

Merges the standalone 'This week' panel into the block hero, computing actual-vs-planned
hours over the aligned current-block-week window. Avg HRV/avg sleep drop (canonical home is
Today readiness, Constitution §4). Masterplan §6 amendment recorded in the wave-gate task.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Settings — split into GENERATION / PLATFORM groups (extract `PlatformBehaviorForm`)

**Files:**
- Create: `components/PlatformBehaviorForm.tsx`
- Modify: `components/BlockSettingsForm.tsx` (export `ToggleRow`; remove the "Platform behavior" card; shrink the skeleton to 3 blocks)
- Modify: `app/settings/page.tsx` (relabel dividers "Generation"/"Platform"; render `PlatformBehaviorForm` under the Platform divider, before AI usage + backup)

**Interfaces:**
- Produces: `export function ToggleRow(...)` from `BlockSettingsForm.tsx`; `export default function PlatformBehaviorForm()`.
- Note: `/api/settings` PUT **merges** each field against fresh on-disk settings (`b[key] ?? current[key] ?? default`; booleans fall back to `current`). So `PlatformBehaviorForm` may PUT **only** `{ autoSyncOnOpen, autoPostCoachNote }` without clobbering generation settings, and vice-versa. This merge behaviour is why the split is safe — **do not** change the route.

- [ ] **Step 1: Export `ToggleRow` from `BlockSettingsForm.tsx`**

In `components/BlockSettingsForm.tsx`, the current declaration is:

```tsx
function ToggleRow({
```

Add `export`:

```tsx
export function ToggleRow({
```

- [ ] **Step 2: Remove the "Platform behavior" card from `BlockSettingsForm`**

Delete this entire block from `BlockSettingsForm`'s returned JSX:

```tsx
      {/* Platform behavior */}
      <Card title="Platform behavior">
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">How Nodevelo handles syncing and write-back.</p>
        <div className="space-y-2">
          <ToggleRow
            label="Auto-sync on open"
            hint="When you open Today and the data is stale, pull from Intervals.icu automatically."
            checked={settings.autoSyncOnOpen}
            onChange={(v) => set("autoSyncOnOpen", v)}
          />
          <ToggleRow
            label="Auto-post coach note to Intervals.icu"
            hint="After each analysis, write the coach note back to your Intervals.icu calendar automatically."
            checked={settings.autoPostCoachNote}
            onChange={(v) => set("autoPostCoachNote", v)}
          />
        </div>
      </Card>
```

- [ ] **Step 3: Shrink the loading skeleton to 3 cards**

The skeleton previously reserved four cards (volume / structure / philosophy / platform). Its current body is:

```tsx
      <SkeletonScreen className="space-y-6">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
      </SkeletonScreen>
```

With the platform card gone there are three (volume / structure / philosophy) — update the comment above it and drop one block:

```tsx
      <SkeletonScreen className="space-y-6">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-44" />
      </SkeletonScreen>
```

Also update the preceding comment `// S3-1: one placeholder per settings card (volume / structure / philosophy / platform) ...` to drop `/ platform`:

```tsx
    // S3-1: one placeholder per settings card (volume / structure / philosophy) so the
    // page below the "Settings" h1 holds its height while the form loads.
```

- [ ] **Step 4: Create `PlatformBehaviorForm.tsx`**

Create `components/PlatformBehaviorForm.tsx`. It loads settings, mutates only the two toggles, and PUTs only those two fields (merge-safe per the route):

```tsx
"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { Card, Skeleton, SkeletonScreen } from "./ui";
import { ToggleRow } from "./BlockSettingsForm";
import type { BlockSettings } from "@/lib/types";

// The PLATFORM half of Settings, split out of BlockSettingsForm so it renders under the page's PLATFORM
// divider (UX v2 §6 Settings) instead of visually sitting inside the GENERATION group. Loads the full
// settings but PUTs only the two platform toggles — the /api/settings PUT merges each field against
// fresh on-disk state, so this never clobbers the generation knobs saved by BlockSettingsForm.
export default function PlatformBehaviorForm() {
  const [settings, setSettings] = useState<Pick<BlockSettings, "autoSyncOnOpen" | "autoPostCoachNote"> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<BlockSettings>("/api/settings")
      .then((s) => setSettings({ autoSyncOnOpen: s.autoSyncOnOpen, autoPostCoachNote: s.autoPostCoachNote }))
      .catch(() => setError("Failed to load platform settings."));
  }, []);

  const set = (key: "autoSyncOnOpen" | "autoPostCoachNote", value: boolean) => {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setSaved(false);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      await api<BlockSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <SkeletonScreen>
        <Skeleton className="h-44" />
      </SkeletonScreen>
    );
  }

  return (
    <Card title="Platform behavior">
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">How Nodevelo handles syncing and write-back.</p>
      <div className="space-y-2">
        <ToggleRow
          label="Auto-sync on open"
          hint="When you open Today and the data is stale, pull from Intervals.icu automatically."
          checked={settings.autoSyncOnOpen}
          onChange={(v) => set("autoSyncOnOpen", v)}
        />
        <ToggleRow
          label="Auto-post coach note to Intervals.icu"
          hint="After each analysis, write the coach note back to your Intervals.icu calendar automatically."
          checked={settings.autoPostCoachNote}
          onChange={(v) => set("autoPostCoachNote", v)}
        />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm text-green-700 dark:text-green-400">Saved.</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </Card>
  );
}
```

- [ ] **Step 5: Update `app/settings/page.tsx` — dividers + placement**

The current body is:

```tsx
import BlockSettingsForm from "@/components/BlockSettingsForm";
import BackupRestore from "@/components/BackupRestore";
import AiUsageCard from "@/components/AiUsageCard";
import { readAiUsage } from "@/lib/ai-usage";
import { SectionDivider } from "@/components/ui";

// Read the usage store at request time (it changes as AI calls accrue).
export const dynamic = "force-dynamic";

// h1 "Settings" (S2-5): the old "Block generation settings" undersold the page — it also owns AI
// usage/cost and backup. The generation/platform split now lives in the section dividers instead.
export default async function SettingsPage() {
  const usage = await readAiUsage();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">Block generation, AI usage, and backup.</p>
      </div>
      <SectionDivider label="Block generation" />
      <BlockSettingsForm />
      <SectionDivider label="Platform" />
      <AiUsageCard usage={usage} />
      <BackupRestore />
    </div>
  );
}
```

Replace it with (SectionDivider CSS-uppercases the label, so the source strings read "Generation"/"Platform"; `PlatformBehaviorForm` renders first under the Platform divider, then AI usage, then backup — masterplan order):

```tsx
import BlockSettingsForm from "@/components/BlockSettingsForm";
import PlatformBehaviorForm from "@/components/PlatformBehaviorForm";
import BackupRestore from "@/components/BackupRestore";
import AiUsageCard from "@/components/AiUsageCard";
import { readAiUsage } from "@/lib/ai-usage";
import { SectionDivider } from "@/components/ui";

// Read the usage store at request time (it changes as AI calls accrue).
export const dynamic = "force-dynamic";

// h1 "Settings" (S2-5): the page owns generation knobs, platform behaviour, AI usage/cost, and backup.
// The GENERATION / PLATFORM split lives in the section dividers (UX v2 §6 Settings); "Platform behavior"
// now renders under the PLATFORM divider (was mis-grouped inside the generation form).
export default async function SettingsPage() {
  const usage = await readAiUsage();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">Block generation, platform behaviour, AI usage, and backup.</p>
      </div>
      <SectionDivider label="Generation" />
      <BlockSettingsForm />
      <SectionDivider label="Platform" />
      <PlatformBehaviorForm />
      <AiUsageCard usage={usage} />
      <BackupRestore />
    </div>
  );
}
```

- [ ] **Step 6: Verify**

Run: `npm run check && npm run build`
Expected: tsc clean, lint clean, tests pass, build succeeds. Confirm `Card` is still imported/used in `BlockSettingsForm.tsx` (the volume/structure/philosophy cards still use it).

- [ ] **Step 7: Commit**

```bash
git add components/BlockSettingsForm.tsx components/PlatformBehaviorForm.tsx app/settings/page.tsx
git commit -m "feat(settings): split GENERATION / PLATFORM — move Platform behavior under its own divider (UX v2 W5)

Platform-behavior toggles move out of BlockSettingsForm into a new PlatformBehaviorForm that
renders under the PLATFORM divider (before AI usage + backup). Both forms PUT /api/settings,
which merges per-field, so neither clobbers the other. Divider labels now read Generation/Platform.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Knowledge — one-line provenance header above the file list

**Files:**
- Modify: `components/KnowledgeBaseEditor.tsx`

**Interfaces:** none new (self-contained JSX addition).

- [ ] **Step 1: Add the provenance header**

In `components/KnowledgeBaseEditor.tsx`, the current header block is the `<h1>` + the selection-dependent intro `<p>`:

```tsx
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Knowledge</h1>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {isRetro
          ? "Block retrospectives. Editing the next_block_seeds list steers the next generated block."
          : "Injected into every generation prompt. Edits apply immediately to the next generation."}
      </p>
```

Insert a static, always-visible provenance line between the `<h1>` and the selection-dependent `<p>` (it summarises the same generation-feeds-vs-reference-vs-manual-vs-seed taxonomy the per-file `FILE_HINTS` banners already encode — visible immediately, before any file is selected):

```tsx
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Knowledge</h1>
      <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        Reference files (cycling / training / nutrition) feed every generation prompt; <span className="font-medium text-zinc-600 dark:text-zinc-300">athlete_profile.md</span> is your manual context — your physiology syncs from Intervals.icu and is edited on Profile, not here; block retrospectives seed the next block.
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {isRetro
          ? "Block retrospectives. Editing the next_block_seeds list steers the next generated block."
          : "Injected into every generation prompt. Edits apply immediately to the next generation."}
      </p>
```

- [ ] **Step 2: Verify**

Run: `npm run check && npm run build`
Expected: tsc clean, lint clean, tests pass, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/KnowledgeBaseEditor.tsx
git commit -m "feat(knowledge): one-line provenance header above the file list (UX v2 W5)

States which files feed generation vs. reference-only vs. manual vs. seed — visible before any
file is selected, mirroring the taxonomy FILE_HINTS already encodes per file.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Model cards density polish — driver-bar colour + touch-reachable notes + calibration confidence adjacency

**Files:**
- Modify: `components/StateDriversCard.tsx` (negative bar → red; `truncate` → `line-clamp-2`)
- Modify: `components/CalibrationPanel.tsx` (gate the inline confidence tier on the learned value actually being shown)

**Interfaces:** none new. (The DESIGN.md §2 colour-register clarification for this change lands in Task 8, per the wave's doc-duty convention.)

- [ ] **Step 1: Repaint the negative driver bar red**

In `components/StateDriversCard.tsx`, the bar fill currently is:

```tsx
                        <span
                          className={`h-full rounded-full ${positive ? "bg-emerald-500/80 dark:bg-emerald-400/70" : "bg-amber-500/80 dark:bg-amber-400/70"}`}
                          style={{ width: `${pct}%` }}
                        />
```

Change the negative arm from amber to red so the bar matches the row's numeric value (`driverEffectClass` = red) and the app-wide "declining/negative" register:

```tsx
                        <span
                          className={`h-full rounded-full ${positive ? "bg-emerald-500/80 dark:bg-emerald-400/70" : "bg-red-500/80 dark:bg-red-400/70"}`}
                          style={{ width: `${pct}%` }}
                        />
```

- [ ] **Step 2: Make the driver note touch-readable**

The driver note currently hard-truncates with a hover-only `title`:

```tsx
                    <span title={d.note} className="min-w-0 truncate text-xs text-zinc-600 dark:text-zinc-300">
                      {DIR[d.dir]} {d.note}
                    </span>
```

Switch `truncate` → `line-clamp-2` so the note wraps and stays readable by tap/keyboard (Constitution §2/§6); keep `title` as a desktop accelerator:

```tsx
                    <span title={d.note} className="min-w-0 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-300">
                      {DIR[d.dir]} {d.note}
                    </span>
```

- [ ] **Step 3: Gate the calibration confidence tier on the learned value being shown**

In `components/CalibrationPanel.tsx`, the inline confidence tier currently renders whenever a non-default param isn't high-confidence — including the "learning but not yet trusted" state where the number shown is the **default**, not the learned value, so the tier misleadingly describes an unused value:

```tsx
        {param && param.source !== "default" && param.confidence !== "high" && (
          <span
            className={`ml-2 align-middle font-sans text-[10px] font-medium ${
              param.confidence === "low" ? "text-amber-600 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {param.confidence} confidence
          </span>
        )}
```

Add `effective === param.value` so the tier only shows when the value on screen **is** the learned value it describes (in the learning-not-trusted state the `detail()` line already explains why the default is in use):

```tsx
        {param && param.source !== "default" && effective === param.value && param.confidence !== "high" && (
          <span
            className={`ml-2 align-middle font-sans text-[10px] font-medium ${
              param.confidence === "low" ? "text-amber-600 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {param.confidence} confidence
          </span>
        )}
```

- [ ] **Step 4: Verify** (fix-wave — gate on `npm run check`, not just tests)

Run: `npm run check && npm run build`
Expected: tsc clean, lint clean, tests pass, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/StateDriversCard.tsx components/CalibrationPanel.tsx
git commit -m "fix(model): driver-bar negative→red (match driverEffectClass), touch-readable notes, honest confidence adjacency (UX v2 W5)

Negative driver bar was amber while its own numeric value + every other declining signal use
red — one row, two registers. Unify on red (DESIGN §2 note in wave-gate). Driver notes wrap
(line-clamp-2) instead of hover-only truncate. Calibration confidence tier now shows only when
the learned value is the one on screen, not beside the default in the learning-not-trusted state.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Trends density polish — DeliveryCard toggle a11y + InsightsFold empty-state hint

**Files:**
- Modify: `components/trends/sections.tsx` (`DeliveryCard` toggle: `type="button"` + `role="group"`/label)
- Modify: `components/trends/verdict.tsx` (`InsightsFold` card hint reads correctly when only the track record shows)

**Interfaces:** none new.

- [ ] **Step 1: Add `type="button"` + group semantics to the DeliveryCard toggle**

In `components/trends/sections.tsx`, the DeliveryCard toggle is:

```tsx
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
```

Add `role="group"` + `aria-label` to the wrapper and `type="button"` to each toggle (they're inert view-switchers with no form ancestor — the explicit type prevents any future accidental submit and names the control group for assistive tech):

```tsx
      action={
        hasSessions && hasTypes ? (
          <div className="flex gap-1" role="group" aria-label="Execution quality view">
            {(["sessions", "types"] as const).map((v) => (
              <button
                key={v}
                type="button"
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
```

- [ ] **Step 2: Fix the InsightsFold card hint for the track-record-only state**

In `components/trends/verdict.tsx`, `InsightsFold` renders the card when `insights.length === 0 && track === null` is false — so it can render with **no** current insights (only a track record), yet the hint always claims "ranked · learned from your execution history". The current card open is:

```tsx
  return (
    <Card title="Coach insights" hint="ranked · learned from your execution history">
```

Make the hint reflect what's actually shown:

```tsx
  return (
    <Card title="Coach insights" hint={insights.length > 0 ? "ranked · learned from your execution history" : "track record"}>
```

- [ ] **Step 3: Verify** (fix-wave — gate on `npm run check`)

Run: `npm run check && npm run build`
Expected: tsc clean, lint clean, tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/trends/sections.tsx components/trends/verdict.tsx
git commit -m "fix(trends): DeliveryCard toggle type=button + role=group; InsightsFold hint honest when only track record shows (UX v2 W5)

Closes two W3-deferred polish items: the execution-quality view toggle gains explicit button
type + a labelled group; the Coach-insights card hint reads 'track record' (not 'ranked · learned…')
when there are no current insights.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Profile density polish — rider-read empty-state + weight-tile gating + drop double labels

**Files:**
- Modify: `components/AthleteProfileForm.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Un-nest the synced weight tile + add a rider-read empty-state**

In `components/AthleteProfileForm.tsx`, the "The rider read" section currently ends with a Current-performance block that hides entirely when `performanceData` is empty — taking a synced weight down with it — and the whole section can render with nothing under the divider on a thin account. The current block is:

```tsx
        {/* Current performance (FTP · threshold HR · max HR) — canonical home per UX v2 §2 ledger;
            moved from Plan's goals card. Values live in knowledge-base athlete.md, edited there. */}
        {athleteMd.performanceData && Object.keys(athleteMd.performanceData).length > 0 && (
          <Section title="Current performance" editHref="/knowledge">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(athleteMd.performanceData).map(([k, v]) => (
                <div key={k} className="rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900">
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{k}</p>
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{v}</p>
                </div>
              ))}
              {latestWeightKg != null && (
                <div className="rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900">
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Weight <span className="text-cyan-700 dark:text-[#00d4ff]">· synced</span>
                  </p>
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{latestWeightKg.toFixed(1)} kg</p>
                </div>
              )}
            </div>
          </Section>
        )}
      </section>
```

Replace it so the Current-performance card renders when there are perf keys **or** a synced weight (the weight tile no longer hides behind `performanceData`), and add an onboarding empty-state (Constitution §8) when the rider read has nothing at all:

```tsx
        {/* Current performance (FTP · threshold HR · max HR) — canonical home per UX v2 §2 ledger;
            moved from Plan's goals card. Values live in knowledge-base athlete.md, edited there. The
            synced weight tile renders even when performanceData is empty (it's synced, not manual). */}
        {(hasPerf || latestWeightKg != null) && (
          <Section title="Current performance" editHref="/knowledge">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {hasPerf &&
                Object.entries(athleteMd.performanceData!).map(([k, v]) => (
                  <div key={k} className="rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900">
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{k}</p>
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{v}</p>
                  </div>
                ))}
              {latestWeightKg != null && (
                <div className="rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900">
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Weight <span className="text-cyan-700 dark:text-[#00d4ff]">· synced</span>
                  </p>
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{latestWeightKg.toFixed(1)} kg</p>
                </div>
              )}
            </div>
          </Section>
        )}

        {!hasRiderRead && (
          <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            No rider data yet — sync with Intervals.icu (top bar) to pull your power curve, PRs, and current numbers.
          </p>
        )}
      </section>
```

- [ ] **Step 2: Compute the `hasPerf` / `hasRiderRead` guards**

The `riderProfileSection` and `powerPRsSection` consts are computed just before the `return (`. Immediately after `powerPRsSection` is assigned (before `return (`), add:

```tsx
  const hasPerf = !!(athleteMd.performanceData && Object.keys(athleteMd.performanceData).length > 0);
  const hasRiderRead = !!riderProfileSection || !!powerPRsSection || hasPerf || latestWeightKg != null;
```

- [ ] **Step 3: Drop the double labels on Goals & Weakpoints + Nutrition formula**

Each of these two groups renders a `SectionDivider` immediately above a `Section` whose title near-duplicates it. Remove the redundant Card titles so the divider is the sole label (matching Model's divider-over-differently-titled-card pattern).

For Goals & Weakpoints, the current wrapper is:

```tsx
        <SectionDivider label="Goals & weakpoints" />
        <Section title="Goals & Weakpoints">
```

Change the `Section` to a plain `Card` (no title):

```tsx
        <SectionDivider label="Goals & weakpoints" />
        <Card>
```

…and its matching closing tag — the `</Section>` that pairs with it (the one immediately before `</section>` that closes the Goals group) becomes `</Card>`:

```tsx
        </Card>
      </section>
```

For Nutrition formula, the current wrapper is:

```tsx
        <SectionDivider label="Nutrition formula" />
        <Section title="Nutrition formula">
```

Change to:

```tsx
        <SectionDivider label="Nutrition formula" />
        <Card>
```

…and its matching closing `</Section>` (immediately before the final `</section>`) becomes `</Card>`:

```tsx
        </Card>
      </section>
```

(`Card` is already imported in this file; `Section` remains used by the rider/power/current-performance sections, so keep its import.)

- [ ] **Step 4: Verify** (fix-wave — gate on `npm run check`)

Run: `npm run check && npm run build`
Expected: tsc clean, lint clean, tests pass, build succeeds. Confirm the two `Card` open tags each pair with a `Card` close (no orphaned `</Section>`), and `Section` is still imported and used elsewhere.

- [ ] **Step 5: Commit**

```bash
git add components/AthleteProfileForm.tsx
git commit -m "fix(profile): rider-read empty-state, un-nest synced weight tile, drop double labels (UX v2 W5)

The rider read no longer renders an empty divider on thin accounts (onboarding empty-state added,
Constitution §8); the synced weight tile renders even when performanceData is empty; the
Goals & Weakpoints and Nutrition formula cards drop their titles so the section divider is the
sole label (matching Model's pattern).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Wave gate — DESIGN.md §2/§8 + UX-MASTERPLAN §6/§7 + header bump

**Files:**
- Modify: `DESIGN.md` (§2 colour-register note; §8 per-page table — Plan / Settings rows updated, Knowledge row added, Model row colour note)
- Modify: `UX-MASTERPLAN.md` (header line bump; §6 Plan provenance/HRV note; §7 item 5 marked shipped)

**Interfaces:** none (docs). This is the final task; the controller runs the Fable 5 whole-wave review + the dark-mode-first Playwright walk after it lands (per Global Constraints).

- [ ] **Step 1: DESIGN.md §2 — signed-magnitude bar colour register**

In `DESIGN.md` §2, after the line:

```markdown
**Status:** emerald/green = good · amber = warning/caution · red & rose = error/danger.
```

Add:

```markdown
**Signed-magnitude bars** (StateDriversCard drivers; block CTL-gain figures): emerald = positive
effect, **red** = negative — the same register as `driverEffectClass` / `trendDir`. Amber stays
reserved for caution / mid-band (e.g. ScoreBars 5–6.9), never directional-negative, so a single row
never shows two severity colours for one signal.
```

- [ ] **Step 2: DESIGN.md §8 — update Plan + Settings rows, add Knowledge row, note Model bars**

In the §8 per-page table, replace the current **Plan** row:

```markdown
| **Plan** | "What's my block, and what's next?" | Active block hero (calendar + progress) | this-week debrief · season (objective/events) · "this block targets" line | Block history → `<details>`; generation form collapses while a block is active (expanded, it shows a season-context readout above the length/goal/weakpoint fields) |
```

with:

```markdown
| **Plan** | "What's my block, and what's next?" | Active block hero: calendar + week orientation (week N of M · volume-derived character) · in-hero week strip (hours vs target · load · top session) · "next: session, when" pointer | season (objective/events) · "this block targets" line | Block history → `<details>`; generation form collapses while a block is active (expanded, it shows a season-context readout above the length/goal/weakpoint fields) |
```

Replace the current **Settings** row:

```markdown
| **Settings** | "Tune generation + platform behaviour" | Block-generation knobs | AI usage · backup | — |
```

with:

```markdown
| **Settings** | "Tune generation + platform behaviour" | GENERATION group — weekly volume · structure · philosophy | PLATFORM group — platform behavior · AI usage · backup | — |
```

Add a **Knowledge** row immediately after the Settings row (there was none):

```markdown
| **Knowledge** | "What context does the coach read — and where does each file go?" | Provenance header (reference-vs-manual-vs-seed taxonomy) + file rail | selected file's editor pane + per-file guidance banner | block retrospectives list (they seed the next block) → collapsed at the rail's bottom |
```

In the **Model** row, append the bar colour convention to its Leads cell — the current cell is:

```markdown
| **Model** | "What does the brain know about me — and why?" | NOW — fused score + ranked drivers as signed magnitude bars |
```

Change to:

```markdown
| **Model** | "What does the brain know about me — and why?" | NOW — fused score + ranked drivers as signed magnitude bars (emerald +, red −; see §2) |
```

- [ ] **Step 3: UX-MASTERPLAN.md — header bump**

The current status line reads:

```markdown
> **Status: designed 2026-07-08 · Waves 1–4 shipped 2026-07-08/09 (§7), Wave 5 open.** Produced by the moment-first zero-based
```

Change to:

```markdown
> **Status: designed 2026-07-08 · Waves 1–5 shipped 2026-07-08/09 (§7).** Produced by the moment-first zero-based
```

- [ ] **Step 4: UX-MASTERPLAN.md — §6 Plan provenance + HRV note**

In §6, the "Week strip inside the hero" bullet currently reads:

```markdown
- **Week strip inside the hero** (the separate "This week" panel dies): hours vs target · load ·
  top session — one glance answers "where am I" and "how's the week going."
```

Append the provenance + drop notes (recording the Wave 5 decisions honestly):

```markdown
- **Week strip inside the hero** (the separate "This week" panel dies): hours vs target · load ·
  top session — one glance answers "where am I" and "how's the week going." *(W5:* hours-vs-target is
  computed over the aligned current-block-week window; the week-row character is derived from planned
  weekly volume relative to the block — there is **no** per-week phase in the data model, and the single
  whole-block `seasonPhase` is never spread per-week, so the hero labels the character as volume-derived
  per Constitution §5. Avg HRV / avg sleep from the old panel dropped — their home is Today's readiness,
  Constitution §4.)*
```

- [ ] **Step 5: UX-MASTERPLAN.md — §7 item 5 marked shipped**

The current §7 item 5 reads:

```markdown
5. **Wave 5 — Plan hero orientation + Settings grouping + Knowledge header + density polish.**
```

Change to (the executor fills the real commit range once the wave's commits exist):

```markdown
5. **Wave 5 — Plan hero orientation + Settings grouping + Knowledge header + density polish.**
   ✅ shipped 2026-07-09 (plan `docs/superpowers/plans/2026-07-09-ux-v2-wave-5-plan-settings-knowledge-polish.md`).
   Plan hero: volume-derived week character + in-hero week strip (hours vs target · load · top session,
   WeeklyDebrief retired) + next-session pointer. Settings: GENERATION/PLATFORM split (Platform behavior
   moved to its own component under the PLATFORM divider). Knowledge: provenance header. Density polish:
   driver bar negative→red (DESIGN §2), touch-readable driver notes, calibration confidence adjacency,
   DeliveryCard toggle a11y, InsightsFold empty-state hint, Profile rider-read empty-state + weight-tile
   gating + double-label removal.
```

- [ ] **Step 6: Verify**

Run: `npm run check`
Expected: green (docs-only edits don't affect tsc/lint/tests, but confirm nothing regressed). Re-read the two doc diffs to confirm no table column mis-count and no stale "Wave 5 open" reference remains.

- [ ] **Step 7: Commit**

```bash
git add DESIGN.md UX-MASTERPLAN.md
git commit -m "docs(ux): DESIGN §2/§8 + masterplan §6/§7 for UX v2 Wave 5 (wave gate)

DESIGN §2 signed-bar colour register; §8 Plan/Settings rows updated, Knowledge row added, Model
bar-colour note. Masterplan header bumped to Waves 1–5 shipped; §6 Plan records the volume-derived
week character + HRV/sleep drop; §7 item 5 marked shipped.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (masterplan §6 Plan/Settings/Knowledge + §7 density-polish backlog):**
- Plan hero — week N of M · character (Task 1), week-row labels (Task 1), next-session pointer (Task 1), week strip in-hero / WeeklyDebrief retired (Task 2). ✅
- Settings GENERATION/PLATFORM split incl. the real Platform-behavior misplacement (Task 3). ✅
- Knowledge provenance header + DESIGN §8 Knowledge row (Task 4 + Task 8). ✅
- Density polish backlog: driver-bar colour + truncated notes (Task 5), calibration confidence adjacency (Task 5), DeliveryCard `type=button`/`role=group` (Task 6), InsightsFold empty-hint (Task 6), Profile rider-read empty-state + weight nesting + double-labels (Task 7). ✅
- Doc duty (DESIGN §8 + §2, masterplan §6/§7 + header) in the final task (Task 8). ✅
- Every judgment call (week-character derive vs cut; HRV/sleep fate; hours-vs-target window; colour unify; truncated-note fix) is stated with rationale in the Decisions preamble / Task notes. ✅

**Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows complete code; the only intentional fill-in is the §7 commit-range in Task 8 Step 5 (flagged explicitly for the executor, since commits don't exist yet).

**Type/signature consistency:** `weekCharacters(number[]): string[]` used identically in Task 1 helper, test, and `CurrentBlockSection`. `weeks: CurrentBlock["days"][]` and `characters: string[]` props match between `BlockCalendar`'s new signature and both call sites. `CurrentBlockSection`'s new `sync?: SyncData | null` prop matches the `sync={state.lastSync ?? null}` call site. `ToggleRow` exported from `BlockSettingsForm` and imported by `PlatformBehaviorForm` with matching props (`label`, `hint`, `checked`, `onChange`). `PlatformBehaviorForm` PUTs a `Pick<BlockSettings, "autoSyncOnOpen" | "autoPostCoachNote">`, safe against the merge-PUT. `hasPerf`/`hasRiderRead` defined before the `return` that uses them.
