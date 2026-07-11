# HRRc — Heart-Rate-Recovery Trends Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface HRRc (heart-rate recovery after a sustained hard effort) as a new Trends-page chart — a second HR-derived engine signal alongside Pw:HR, but scoped ONLY to Trends, never folded into the Today Athlete-State score.

**Architecture:** intervals.icu already computes HRRc server-side per activity — the largest HR drop in 60 seconds after ≥1 continuous minute (or ≥10 cumulative minutes) at/above threshold (Z5). It complements Pw:HR structurally: Pw:HR only reads on easy Z2 rides, HRRc only reads on hard/interval rides — together they cover both ends of the intensity spectrum from the same HR strap, no new hardware. Sync it as a new `ActivitySummary` field (defensively multi-keyed, since the exact API field name is unconfirmed — mirrors how `decoupling` already hedges two possible keys), add a pure `hrrcSeries()` transform mirroring `efSeries()`, wire it into `/api/trends`, and render a **neutral, unscored sparkline** — no up/down "improving" verdict badge, because the research doesn't support one.

**Why this stays out of the fusion (do not add it to `lib/athlete-state.ts` in this plan):** functional-overreaching research found HRR **rises** (not falls) during a deliberate, well-tolerated overload block — the opposite of the "faster recovery = fresher" intuition. A metric whose "good" direction flips depending on training-phase intent cannot safely cap a daily readiness score without also knowing whether the athlete is intentionally mid-overload — the app doesn't have that disambiguation logic today (it would need to read Season phase/focus, which is real scope, not a tweak). Trends-only, trend-only, no verdict — same treatment this plan applies to Pw:HR, which carries an identical "read the trend, not the point" caveat for the same reason (see `2026-07-10-02-today-daily-read-signals.md`'s three-layer Pw:HR caution).

**Tech Stack:** TypeScript 5, Vitest (`npm test`), Next.js 16 App Router (Route Handlers), React 19.

## Global Constraints

- **`npm test`** runs Vitest.
- **No new dependencies.**
- **Unconfirmed API field name — hedge, don't assume.** Nobody has confirmed the exact intervals.icu JSON key for HRRc against a live response. This codebase has been burned by this before — see `lib/intervals-api.ts`'s own comment on `decoupling`: "The old keys read null on every ride." Task 1 hedges with a defensive multi-key `??` chain (matching the `decoupling` precedent exactly) and REQUIRES a live-sync verification step before calling the feature done — do not skip Task 1 Step 6.
- **No score, no verdict, no color-coded "better/worse" on this metric anywhere in the UI.** This is a hard constraint, not a style preference — see Architecture above for why.
- **Follow existing patterns:** mirror `efSeries()` (`lib/trends.ts`) and its `Card`/`Sparkline` rendering in `Trends.tsx` structurally, but do NOT reuse `trendDir()` for this metric (its "improving"/"declining" framing asserts a good/bad direction this metric doesn't support).

---

## File Structure

- `lib/types.ts` — **modify.** Add `hrrc: number | null` to `ActivitySummary`.
- `lib/intervals-api.ts` — **modify.** Parse HRRc defensively (multi-key fallback) in `fetchActivities`.
- `lib/intervals-api.test.ts` — **modify.** Parse tests mirroring the existing decoupling multi-key test.
- `lib/trends.ts` — **modify.** Add `hrrcSeries()`.
- `lib/trends.test.ts` — **modify.** Unit test for `hrrcSeries()`.
- `components/trends/types.ts` — **modify.** Add `hrrc: Point[]` to `TrendsData`.
- `app/api/trends/route.ts` — **modify.** Compute `hrrc` and include it in the response.
- `components/Trends.tsx` — **modify.** Render the neutral HRRc sparkline card in the Engine section.

---

### Task 1: Sync HRRc defensively + verify the real field name

**Files:**
- Modify: `lib/types.ts` — `ActivitySummary` (~line 90, after `hrZoneTimes`).
- Modify: `lib/intervals-api.ts` — `fetchActivities` (~line 246, after `powerHrZ2Mins`).
- Test: `lib/intervals-api.test.ts`

**Interfaces:**
- Produces: `ActivitySummary.hrrc: number | null` — the ride's heart-rate-recovery value (bpm dropped in 60s after a qualifying hard effort), or `null` when the ride had no qualifying effort or the field wasn't present.

- [ ] **Step 1: Write the failing tests**

Add to `lib/intervals-api.test.ts`, using the exact `globalThis.fetch` mock pattern the existing decoupling test uses (~line 115-130):

```ts
it("maps HRRc off the primary key (icu_hrrc)", async () => {
  const raw = [{
    id: "1", start_date_local: "2026-06-15T08:00:00", type: "Ride", name: "Threshold intervals",
    moving_time: 3600, icu_average_watts: 220, icu_weighted_avg_watts: 230,
    icu_hrrc: 28, average_heartrate: 155, max_heartrate: 178,
  }];
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
  ) as unknown as typeof fetch;
  const [a] = await fetchActivities("2026-06-01", "2026-06-23");
  expect(a.hrrc).toBe(28);
});

it("falls back to icu_hrr when icu_hrrc is absent", async () => {
  const raw = [{
    id: "2", start_date_local: "2026-06-16T08:00:00", type: "Ride", name: "VO2max reps",
    moving_time: 2700, icu_average_watts: 210, icu_weighted_avg_watts: 240,
    icu_hrr: 24, average_heartrate: 160, max_heartrate: 182,
  }];
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
  ) as unknown as typeof fetch;
  const [a] = await fetchActivities("2026-06-01", "2026-06-23");
  expect(a.hrrc).toBe(24);
});

it("is null when no HRRc field is present (e.g. an easy ride with no qualifying hard effort)", async () => {
  const raw = [{
    id: "3", start_date_local: "2026-06-17T08:00:00", type: "Ride", name: "Z2 endurance",
    moving_time: 5400, icu_average_watts: 160, icu_weighted_avg_watts: 165,
    average_heartrate: 128, max_heartrate: 140,
  }];
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
  ) as unknown as typeof fetch;
  const [a] = await fetchActivities("2026-06-01", "2026-06-23");
  expect(a.hrrc).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- intervals-api`
Expected: FAIL — `a.hrrc` is `undefined` (property doesn't exist on the returned object / type).

- [ ] **Step 3: Add the field to `ActivitySummary`**

In `lib/types.ts`, in `interface ActivitySummary`, add after `hrZoneTimes` (~line 90):

```ts
  // Heart-rate recovery: the largest HR drop in 60s after a sustained hard effort (≥1 continuous min, or
  // ≥10 cumulative min, at/above threshold — intervals.icu's own "HRRc" gate). null on rides with no
  // qualifying hard effort (e.g. pure Z2 days) or when intervals.icu didn't compute one. The exact API key
  // is unconfirmed (community-documented, not in official API docs as of this writing) — fetchActivities
  // hedges with a multi-key fallback; see the comment there before trusting a single key name.
  hrrc: number | null;
```

- [ ] **Step 4: Parse it defensively in `fetchActivities`**

In `lib/intervals-api.ts`, in `fetchActivities`, add after the `powerHrZ2Mins` line (~line 247):

```ts
      // HRRc (heart-rate recovery): UNCONFIRMED field name — hedge across the plausible keys, same
      // pattern as `decoupling` above (which was previously silently null on every ride from a wrong key
      // guess). Verify against a live sync (see the parse test + Task 1 Step 6) and prune dead fallbacks
      // once the real key is confirmed.
      hrrc: numLoose(a.icu_hrrc) ?? numLoose(a.icu_hrr) ?? numLoose(a.hrrc),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- intervals-api`
Expected: PASS.

- [ ] **Step 6: Live-verify the real field name (required — do not skip)**

This field's name is not confirmed against a real API response. Before treating this task as done:

1. Temporarily add `console.log(JSON.stringify(a, null, 2))` at the top of the `fetchActivities` `.map()` callback in `lib/intervals-api.ts`.
2. Run `npm run dev` (dev server is `dev:preview` on port 3100) and trigger a real sync that includes at least one hard/threshold+ ride (a ride with sustained time above threshold — a pure Z2 day won't have HRRc).
3. In the server log output, find that ride's raw JSON and search (case-insensitive) for any key containing `hrr`.
4. Remove the `console.log`.
5. If the real key differs from `icu_hrrc`/`icu_hrr`/`hrrc`, add it to the `??` chain in Step 4 (put the confirmed real key FIRST in the chain). If none of the three guessed keys ever populate on a ride that should have HRRc, that's a signal intervals.icu doesn't expose this via the activities-list endpoint at all — stop and report this back rather than shipping a field that will always read null.
6. If the real key DOES match one of the three guesses, you may prune the other two dead fallbacks for clarity (optional cleanup, not required).

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/intervals-api.ts lib/intervals-api.test.ts
git commit -m "feat(sync): pull HRRc (heart-rate recovery) defensively, verified against a live sync"
```

---

### Task 2: Pure transform — `hrrcSeries()`

**Files:**
- Modify: `lib/trends.ts` (add near `efSeries`, ~line 46-55).
- Test: `lib/trends.test.ts`

**Interfaces:**
- Consumes: `ActivitySummary.hrrc` (Task 1).
- Produces: `hrrcSeries(activities: ActivitySummary[]): { date: string; value: number }[]`.

- [ ] **Step 1: Write the failing test**

Add to `lib/trends.test.ts`:

```ts
import { hrrcSeries } from "./trends";

describe("hrrcSeries", () => {
  it("returns outdoor rides with a non-null HRRc, sorted by date", () => {
    const activities = [
      { date: "2026-06-20", type: "Ride", hrrc: 22 } as any,
      { date: "2026-06-10", type: "Ride", hrrc: 30 } as any,
      { date: "2026-06-15", type: "Ride", hrrc: null } as any, // no qualifying effort
      { date: "2026-06-18", type: "VirtualRide", hrrc: 25 } as any, // indoor — excluded
    ];
    const series = hrrcSeries(activities);
    expect(series).toEqual([
      { date: "2026-06-10", value: 30 },
      { date: "2026-06-20", value: 22 },
    ]);
  });
  it("returns [] when no rides qualify", () => {
    expect(hrrcSeries([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- trends`
Expected: FAIL — `hrrcSeries` is not exported.

- [ ] **Step 3: Implement it**

Add to `lib/trends.ts`, near `efSeries`:

```ts
// Heart-rate recovery (HRRc) per ride — outdoor only, same environmental-confound rationale as
// isSteadyEnduranceRide (indoor/no wind cooling distorts HR-derived signals). No steady-endurance-band
// gate here (unlike efSeries): HRRc only ever populates on a ride with a qualifying hard effort, so its
// presence is already the qualifying signal — intervals.icu's own Z5 gate did the filtering upstream.
export function hrrcSeries(activities: ActivitySummary[]): { date: string; value: number }[] {
  return activities
    .filter((a) => a.type === "Ride" && a.hrrc !== null && a.hrrc > 0)
    .map((a) => ({ date: a.date, value: a.hrrc as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- trends`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/trends.ts lib/trends.test.ts
git commit -m "feat(trends): add hrrcSeries — outdoor rides with a qualifying HRRc reading"
```

---

### Task 3: Wire into `/api/trends`

**Files:**
- Modify: `components/trends/types.ts` — `TrendsData` (~line 61-79).
- Modify: `app/api/trends/route.ts` — import (line 14), computation (near line 37), response object (near line 139).

**Interfaces:**
- Consumes: `hrrcSeries` (Task 2).
- Produces: `TrendsData.hrrc: Point[]`.

- [ ] **Step 1: Add the field to `TrendsData`**

In `components/trends/types.ts`, in `interface TrendsData` (~line 61), add after `ef: Point[];`:

```ts
  hrrc: Point[]; // heart-rate recovery per qualifying hard ride — context only, no verdict (see the plan's Architecture note)
```

- [ ] **Step 2: Compute it in the route**

In `app/api/trends/route.ts`, change the import (line 14):

```ts
import { efSeries, mondayOf, weeklyEnergy } from "@/lib/trends";
```

to:

```ts
import { efSeries, hrrcSeries, mondayOf, weeklyEnergy } from "@/lib/trends";
```

After the `const ef = efSeries(sync?.activities ?? [], ftp);` line (~line 37), add:

```ts
  // HRRc — heart-rate recovery on hard/threshold+ rides. Trends-only (see the plan): its "good" direction
  // depends on training-phase intent (functional overreaching raises it), so it's shown as a trend, never
  // scored or fused into Athlete State.
  const hrrc = hrrcSeries(sync?.activities ?? []);
```

- [ ] **Step 3: Include it in the response**

In `app/api/trends/route.ts`, in the `return NextResponse.json({ ... })` object (~line 138-140), add `hrrc,` after `ef,`:

```ts
  return NextResponse.json({
    ef,
    hrrc,
    ctl,
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: clean (no missing-field errors on `TrendsData`).

- [ ] **Step 5: Commit**

```bash
git add components/trends/types.ts app/api/trends/route.ts
git commit -m "feat(trends): wire HRRc series into /api/trends"
```

---

### Task 4: Render the neutral HRRc sparkline

**Files:**
- Modify: `components/Trends.tsx` — the "Engine" section (~lines 127-165).

**Interfaces:**
- Consumes: `data.hrrc` (Task 3), the existing `Sparkline` component and `Card` (both already imported in `Trends.tsx`).

- [ ] **Step 1: Add the card, without `trendDir` and without a colored verdict**

In `components/Trends.tsx`, inside the "Engine" section's grid (~line 130, `<div className="grid items-stretch gap-3 lg:grid-cols-2">`), the grid currently holds the Pw:HR card and the CTL card. Add a third card after the CTL card (before the section's closing `</div>` at ~line 163), and widen the grid to accommodate three cards on large screens:

Change the grid class (~line 130) from:

```tsx
              <div className="grid items-stretch gap-3 lg:grid-cols-2">
```

to:

```tsx
              <div className="grid items-stretch gap-3 lg:grid-cols-2 xl:grid-cols-3">
```

Then add, after the CTL `<Card>` block and before the section's closing `</div>` (~line 163):

```tsx
                {data.hrrc.length >= 3 && (
                  <Card className="h-full" title="HRRc — heart-rate recovery" hint={`${data.hrrc.length} hard rides`}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">context only</span>
                      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        latest {data.hrrc[data.hrrc.length - 1].value.toFixed(0)} bpm
                      </span>
                    </div>
                    <Sparkline
                      points={data.hrrc}
                      format={(v) => `${v.toFixed(0)} bpm`}
                      strokeClass="stroke-teal-400 dark:stroke-teal-300"
                      dotClass="fill-teal-500 dark:fill-teal-300"
                      tipTextClass="fill-zinc-800 dark:fill-teal-200"
                      tipAccentClass="stroke-zinc-300 dark:stroke-teal-400/40"
                    />
                    <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                      HR drop in the 60s after your hardest effort each ride, on threshold+ days. Deliberately
                      unscored: rising OR falling can both be normal depending on where you are in a training
                      block — read the trend alongside how the block is going, not as a verdict on its own.
                    </p>
                  </Card>
                )}
```

> Note the deliberate omission: no `trendDir(data.hrrc, …)` call, no green/red "improving"/"declining" label — that's the point (see the plan's Architecture section). The "context only" text label replaces where a colored trend badge would normally sit on this page's other Engine cards.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`, then `npm run dev`, open `http://localhost:3100/trends`, scroll to "Engine". Confirm: with ≥3 qualifying hard rides synced, the HRRc card renders with a sparkline, no colored verdict badge, and the caveat caption. With fewer than 3, the card doesn't render (matches the `data.ef.length >= 3` precedent already used for Pw:HR).

- [ ] **Step 3: Commit**

```bash
git add components/Trends.tsx
git commit -m "feat(trends): render HRRc as a neutral, unscored sparkline in Engine"
```

---

## Self-Review Notes

- **Spec coverage:** HRRc added as a Trends signal (Tasks 1-4); explicitly kept out of the Athlete State fusion with a stated reason (Architecture section); Pw:HR-adjacent "flaky metric" caution carried over via the no-verdict constraint on this new signal too, not just the existing one.
- **Not in scope:** any fusion/scoring use of HRRc; disambiguating "planned overload" vs "drifting into overtraining" (would need to read Season phase — real scope, a future plan if the trend line proves useful enough to act on).
- **Field-name risk is real and handled, not hand-waved:** Task 1 doesn't assume a field name — it hedges (matching the codebase's own `decoupling` precedent) and makes live verification a required, concrete step (exact debug code, exact thing to grep for), not an afterthought.
- **Type consistency:** `hrrc` flows as `number | null` on `ActivitySummary` → filtered to `number` by `hrrcSeries` → `Point[]` (`{date, value}`) on `TrendsData`, matching `ef`'s shape exactly at each stage.
