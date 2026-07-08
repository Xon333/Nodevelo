# Pre-Ride Loading Loop (Track C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prescribe a deterministic day-before carb-loading target ahead of long durability rides, record whether the athlete actually loaded (one-tap attribution), stamp both onto the immutable ledger, and learn whether loading improves late-ride effort delivery — stopping the prescription if it provably doesn't.

**Architecture:** Pure decision module (`lib/loading.ts`) + a small athlete-attribution store (`data/loading-log.json`, same pattern as dispositions/morning-check) + two new frozen ledger stamps (`preLoad`, `durabilityDelivery`) + one GET/POST route + one Today chip. **Outcome signal is power-only:** the Track B delivery grade (`gradeDurabilityDelivery`) on templates B–E — did the prescribed late-ride efforts land? Decoupling is deliberately absent everywhere: this codebase already demoted it from fueling outcomes as a ride-structure artifact (see the comment block above `deriveCarbsOptimum` in `lib/calibration.ts`). No LLM path is touched anywhere in this plan, so the AGENTS.md live-smoke-run rule does not trigger.

**Tech Stack:** Next.js 16 (App Router) route handlers, React 19 client components, TypeScript 5, Vitest. No new dependencies.

## Global Constraints

- Run everything with `npm`. Full verify: `npx tsc --noEmit && npm run lint && npm run build && npm test` (or `npm run check`).
- "Today" is always the client's local date: routes call `resolveToday(...)` (`lib/date.ts`), client components send `localToday()`. Never `new Date().toISOString().slice(0,10)` for "what day is it for the athlete".
- Sparse-field convention: optional ledger/analysis fields are **omitted** when absent, never persisted as `null`. Read sites truthy-check, never `=== null` (AGENTS.md migration-flag rule).
- The ledger is immutable-by-convention: new stamps are provenance added at birth (or the existing today-patch); never rewrite historical entries.
- Concurrent-agent repo: commit on `main`, stage **only** the files you touched (`git add <path>...`, never `git add -A`).
- Tailwind v4, dark mode first (`DESIGN.md`): zinc surfaces, accents only `#ff49c8` (action) / `#00d4ff` (synced/info) as arbitrary literals.
- Test fixtures: avoid expected values whose pre-rounding sits on a `.x5` float boundary.

## File Structure

| File | Responsibility |
|---|---|
| Create `lib/loading.ts` | All loading-loop decisions: target grams, prompt derivation (pre-ask / retro-ask), effect assessment + verdict |
| Create `lib/loading.test.ts` | Unit tests for the above |
| Modify `lib/types.ts` | `RideScoreEntry.preLoad` + `RideScoreEntry.durabilityDelivery` stamps; `LoadingEntry` / `LoadingLogStore` |
| Modify `lib/data-store.ts` | `readLoadingLog` / `writeLoadingLog` (`loading-log.json`) |
| Modify `lib/score-log.ts` | `buildRideScores` gains an optional `preLoadForDate` lookup; stamps `preLoad` on durability-day entries |
| Modify `lib/score-log.test.ts` | Stamp coverage |
| Modify `app/api/sync/route.ts` | Build `preLoadForDate` from the loading log; today-patch adds the `durabilityDelivery` stamp |
| Create `app/api/loading/route.ts` + `route.test.ts` | GET prompt/assessment · POST response |
| Create `components/LoadingPrompt.tsx` | Today chip (pre-ask / retro-ask, two buttons) |
| Modify `components/dashboard/TodayView.tsx` | Mount the chip |
| Modify `FEATURES.md`, `README.md`, `ROADMAP.md`, `ARCHIVE.md` | Docs |

---

### Task 1: `lib/loading.ts` — pure decision module

**Files:**
- Create: `lib/loading.ts`
- Test: `lib/loading.test.ts`

**Interfaces:**
- Consumes: `CurrentBlock`, `CurrentBlockDay`, `RideScoreEntry` from `./types`; `EXPECTS_EMBEDDED_EFFORTS` from `./durability-score`.
- Produces (later tasks rely on these exact names):
  - `preLoadTargetG(weightKg: number): number`
  - `type LoadingPrompt = { kind: "pre-ask" | "retro-ask"; rideDate: string; template: string; targetG: number }`
  - `deriveLoadingPrompt(block: CurrentBlock | null, today: string, weightKg: number, responded: Set<string>): LoadingPrompt | null`
  - `type LoadingEffect = { verdict: "unproven" | "helps" | "no-effect"; nLoaded: number; nUnloaded: number; loadedRate: number | null; unloadedRate: number | null }`
  - `assessLoadingEffect(entries: RideScoreEntry[]): LoadingEffect`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/loading.test.ts
import { describe, expect, it } from "vitest";
import { assessLoadingEffect, deriveLoadingPrompt, preLoadTargetG } from "./loading";
import type { CurrentBlock, RideScoreEntry } from "./types";

function block(days: Array<{ date: string; type?: string; durationMin?: number; durabilityTemplate?: string }>): CurrentBlock {
  return {
    goal: "g", lengthWeeks: 4, startDate: days[0]?.date ?? "2026-07-01", endDate: days[days.length - 1]?.date ?? "2026-07-28",
    overview: "", createdAt: "2026-07-01T00:00:00Z",
    days: days.map((d) => ({ date: d.date, name: "Ride", type: (d.type ?? "Z2") as CurrentBlock["days"][number]["type"], durationMin: d.durationMin ?? 180, ...(d.durabilityTemplate ? { durabilityTemplate: d.durabilityTemplate } : {}) })),
  };
}

function entry(over: Partial<RideScoreEntry>): RideScoreEntry {
  return {
    date: "2026-07-01", executionScore: 7, plannedType: "Z2", inferredType: "Z2", planned: true, legacy: false,
    compliancePct: 100, intensityFactor: 0.65, ftpUsed: 300, durationMin: 180, tss: 120, ...over,
  };
}

describe("preLoadTargetG", () => {
  it("is 7 g/kg rounded to 10 g", () => {
    expect(preLoadTargetG(70)).toBe(490);
    expect(preLoadTargetG(72)).toBe(500); // 504 → 500
  });
});

describe("deriveLoadingPrompt", () => {
  const b = block([
    { date: "2026-07-09", type: "Threshold", durationMin: 75 },
    { date: "2026-07-10", durabilityTemplate: "C" },
  ]);

  it("pre-asks the day before a durability day", () => {
    expect(deriveLoadingPrompt(b, "2026-07-09", 70, new Set())).toEqual({
      kind: "pre-ask", rideDate: "2026-07-10", template: "C", targetG: 490,
    });
  });

  it("retro-asks on the durability day itself when unanswered", () => {
    expect(deriveLoadingPrompt(b, "2026-07-10", 70, new Set())).toEqual({
      kind: "retro-ask", rideDate: "2026-07-10", template: "C", targetG: 490,
    });
  });

  it("retro-ask wins when today AND tomorrow are both durability days", () => {
    const b2 = block([{ date: "2026-07-10", durabilityTemplate: "B" }, { date: "2026-07-11", durabilityTemplate: "C" }]);
    expect(deriveLoadingPrompt(b2, "2026-07-10", 70, new Set())?.rideDate).toBe("2026-07-10");
  });

  it("stays silent once the ride date has a response, on a plain day, and with no block", () => {
    expect(deriveLoadingPrompt(b, "2026-07-09", 70, new Set(["2026-07-10"]))).toBeNull();
    expect(deriveLoadingPrompt(b, "2026-07-07", 70, new Set())).toBeNull();
    expect(deriveLoadingPrompt(null, "2026-07-09", 70, new Set())).toBeNull();
  });

  it("ignores a zero-duration durability entry", () => {
    const b3 = block([{ date: "2026-07-10", durabilityTemplate: "C", durationMin: 0 }]);
    expect(deriveLoadingPrompt(b3, "2026-07-09", 70, new Set())).toBeNull();
  });
});

describe("assessLoadingEffect", () => {
  const durEntry = (loaded: boolean, delivered: boolean, i: number, template = "C"): RideScoreEntry =>
    entry({
      date: `2026-06-${String(i + 1).padStart(2, "0")}`,
      durabilityTemplate: template,
      preLoad: { loaded, targetG: 490 },
      durabilityDelivery: { signal: delivered ? 2 : -2 },
    } as Partial<RideScoreEntry>);

  it("is unproven below 3 observations per side", () => {
    const entries = [durEntry(true, true, 0), durEntry(true, true, 1), durEntry(false, false, 2)];
    expect(assessLoadingEffect(entries).verdict).toBe("unproven");
  });

  it("reports helps when loaded delivery rate clears the margin", () => {
    const entries = [
      ...[0, 1, 2].map((i) => durEntry(true, true, i)),
      ...[3, 4, 5].map((i) => durEntry(false, false, i)),
    ];
    const r = assessLoadingEffect(entries);
    expect(r.verdict).toBe("helps");
    expect(r.loadedRate).toBe(1);
    expect(r.unloadedRate).toBe(0);
  });

  it("reports no-effect at n≥5/side with no separation", () => {
    const entries = [
      ...[0, 1, 2, 3, 4].map((i) => durEntry(true, i < 3, i)), // 3/5 delivered
      ...[5, 6, 7, 8, 9].map((i) => durEntry(false, i < 8, i)), // 3/5 delivered
    ];
    expect(assessLoadingEffect(entries).verdict).toBe("no-effect");
  });

  it("excludes template A, compromised, legacy, and unstamped entries", () => {
    const noise = [
      durEntry(true, true, 10, "A"),
      { ...durEntry(true, true, 11), compromised: true },
      { ...durEntry(true, true, 12), legacy: true },
      entry({ date: "2026-06-20", durabilityTemplate: "C" }), // no stamps
    ];
    const r = assessLoadingEffect(noise);
    expect(r.nLoaded).toBe(0);
    expect(r.nUnloaded).toBe(0);
    expect(r.verdict).toBe("unproven");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/loading.test.ts`
Expected: FAIL — `Cannot find module './loading'` (and type errors on `preLoad`/`durabilityDelivery` until Task 2; that's fine — write Step 3 and Task 2's type additions together if the compiler blocks, but keep the commits separate as written).

- [ ] **Step 3: Implement `lib/loading.ts`**

```ts
// Track C — pre-ride loading loop. Deterministic, pure: prescribe a day-before carb-loading target
// ahead of a long durability ride, and assess whether loading actually improves late-ride effort
// delivery for THIS athlete. Outcome is POWER-ONLY (the Track B delivery grade) — decoupling/Pw:HR is
// deliberately absent, per the demotion rationale documented above deriveCarbsOptimum (calibration.ts).

import { EXPECTS_EMBEDDED_EFFORTS } from "./durability-score";
import type { CurrentBlock, CurrentBlockDay, RideScoreEntry } from "./types";

// Day-before loading target: 7 g/kg — midpoint of the KB's 6–8 g/kg high-fueling-day band for a hard
// training day (NOT the 10–12 g/kg race carb-load; that's 6a's territory). Population default; a
// per-athlete derivation is a later Track C leg once actual grams (not just loaded/skipped) accrue.
export const PRELOAD_G_PER_KG = 7;

export function preLoadTargetG(weightKg: number): number {
  return Math.round((PRELOAD_G_PER_KG * weightKg) / 10) * 10;
}

export interface LoadingPrompt {
  kind: "pre-ask" | "retro-ask";
  rideDate: string;
  template: string;
  targetG: number;
}

// Pure day-math (not "what day is it now") — UTC-anchored arithmetic is fine here per AGENTS.md;
// `today` arrives already resolved to the athlete's local date.
function nextDay(date: string): string {
  return new Date(Date.parse(date) + 86_400_000).toISOString().slice(0, 10);
}

function durabilityDayAt(block: CurrentBlock | null, date: string): CurrentBlockDay | null {
  const day = block?.days.find((d) => d.date === date) ?? null;
  return day && day.durabilityTemplate && day.durationMin > 0 ? day : null;
}

// The one prompt the Today page may show. Retro-ask (today IS the durability day, response missing)
// outranks pre-ask (tomorrow is) — attribution for a ride that's happening beats prep for one that isn't
// yet. All templates (A–E) get the prescription — loading before any 3h+ ride is sound practice; only
// B–E feed the learning (template A has no prescribed efforts, so no honest outcome — see assess below).
export function deriveLoadingPrompt(
  block: CurrentBlock | null,
  today: string,
  weightKg: number,
  responded: Set<string>
): LoadingPrompt | null {
  const targetG = preLoadTargetG(weightKg);
  const todayDur = durabilityDayAt(block, today);
  if (todayDur && !responded.has(today)) {
    return { kind: "retro-ask", rideDate: today, template: todayDur.durabilityTemplate as string, targetG };
  }
  const tomorrow = nextDay(today);
  const tomorrowDur = durabilityDayAt(block, tomorrow);
  if (tomorrowDur && !responded.has(tomorrow)) {
    return { kind: "pre-ask", rideDate: tomorrow, template: tomorrowDur.durabilityTemplate as string, targetG };
  }
  return null;
}

export interface LoadingEffect {
  verdict: "unproven" | "helps" | "no-effect";
  nLoaded: number;
  nUnloaded: number;
  loadedRate: number | null; // share of loaded rides where the prescribed efforts were delivered
  unloadedRate: number | null;
}

const MIN_PER_SIDE = 3; // below this, any rate difference is noise
const HELPS_MARGIN = 0.25; // loaded delivery rate must beat unloaded by ≥ this to credit loading
const NO_EFFECT_MIN_PER_SIDE = 5; // don't declare futility on a thin sample
const NO_EFFECT_BAND = 0.1; // at n≥5/side, a diff below this (incl. negative) = loading isn't moving the signal

// ponytail: heuristic delivered-rate comparison, not the correlation engine — loaded/skipped is binary,
// deriveOptimum/deriveExecutionEdge need a continuous signal. Migrate onto a correlation-engine spec
// when actual day-before grams (not just the flag) are logged.
export function assessLoadingEffect(entries: RideScoreEntry[]): LoadingEffect {
  const obs = entries.filter(
    (e) =>
      e.planned &&
      !e.legacy &&
      !e.compromised &&
      e.durabilityTemplate != null &&
      EXPECTS_EMBEDDED_EFFORTS.has(e.durabilityTemplate) &&
      e.preLoad != null &&
      e.durabilityDelivery != null
  );
  const loaded = obs.filter((e) => e.preLoad!.loaded);
  const unloaded = obs.filter((e) => !e.preLoad!.loaded);
  const rate = (xs: RideScoreEntry[]) =>
    xs.length === 0 ? null : xs.filter((e) => e.durabilityDelivery!.signal === 2).length / xs.length;
  const loadedRate = rate(loaded);
  const unloadedRate = rate(unloaded);

  let verdict: LoadingEffect["verdict"] = "unproven";
  if (loaded.length >= MIN_PER_SIDE && unloaded.length >= MIN_PER_SIDE && loadedRate !== null && unloadedRate !== null) {
    const diff = loadedRate - unloadedRate;
    if (diff >= HELPS_MARGIN) verdict = "helps";
    else if (loaded.length >= NO_EFFECT_MIN_PER_SIDE && unloaded.length >= NO_EFFECT_MIN_PER_SIDE && diff < NO_EFFECT_BAND)
      verdict = "no-effect";
  }
  return { verdict, nLoaded: loaded.length, nUnloaded: unloaded.length, loadedRate, unloadedRate };
}
```

- [ ] **Step 4: Add the type fields Task 1's code compiles against** (they belong to Task 2 conceptually, but `tsc` needs them now; Task 2 still owns the store types + tests)

In `lib/types.ts`, inside `interface RideScoreEntry` directly after the `intervals?` block (after its closing `};` around line 507), add:

```ts
  // Track B / Track C: durability-template ride outcomes + inputs, frozen as provenance.
  // durabilityDelivery = the gradeDurabilityDelivery signal that judged THIS ride (+2 delivered ·
  // 0 mis-placed · -2 absent). Stamped by the sync today-patch (the only path that fetches the ride's
  // executed intervals). preLoad = the athlete's day-before carb-loading attribution (loading-log.json)
  // + the target prescribed. Neither feeds executionScore here; they are the loading loop's corpus.
  // ponytail: a durability ride synced ≥1 day late gets no delivery stamp (the birth-time fetch
  // deliberately excludes template days) — extend that fetch if the loading corpus starves.
  durabilityDelivery?: { signal: number };
  preLoad?: { loaded: boolean; targetG: number };
```

Note `durabilityTemplate?: string` already exists on `RideScoreEntry`? **Verify:** `grep -n "durabilityTemplate" lib/types.ts` — it is stamped via spread in `score-log.ts:183` but confirm the interface declares it; if it's missing from the interface (stamped through a cast), add `durabilityTemplate?: string;` alongside the two fields above.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/loading.test.ts`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add lib/loading.ts lib/loading.test.ts lib/types.ts
git commit -m "feat(loading): deterministic pre-ride loading prompts + power-only effect assessment (Track C)"
```

---

### Task 2: Loading-log store + ledger `preLoad` stamp

**Files:**
- Modify: `lib/types.ts` (store types)
- Modify: `lib/data-store.ts`
- Modify: `lib/score-log.ts` (+ its test file `lib/score-log.test.ts`)

**Interfaces:**
- Consumes: `readJson`/`writeJson` helpers already imported in `data-store.ts`.
- Produces:
  - `LoadingEntry { rideDate: string; targetG: number; response: "loaded" | "skipped"; respondedAt: string }`
  - `LoadingLogStore { entries: LoadingEntry[] }`
  - `readLoadingLog(): Promise<LoadingLogStore>` / `writeLoadingLog(store: LoadingLogStore): Promise<void>`
  - `buildRideScores(..., preLoadForDate?: ((date: string) => { loaded: boolean; targetG: number } | null) | null)` — appended as the **last** optional parameter, after `adherenceForDate`.

- [ ] **Step 1: Add store types to `lib/types.ts`** (near `MorningCheckEntry` / the other small athlete-attribution stores)

```ts
// ---------- Pre-ride loading log (data/loading-log.json, Track C) ----------
// Athlete attribution: did they actually carb-load the day before a durability long ride? Only the
// athlete knows — same owned-input philosophy as dispositions/morning-check. An absent entry means
// UNKNOWN (never assumed unloaded); only explicit responses feed the learning loop.
export interface LoadingEntry {
  rideDate: string; // YYYY-MM-DD of the durability RIDE (the loading day is the day before)
  targetG: number; // the target prescribed when asked — frozen for provenance
  response: "loaded" | "skipped";
  respondedAt: string; // ISO timestamp
}
export interface LoadingLogStore {
  entries: LoadingEntry[];
}
```

- [ ] **Step 2: Add read/write to `lib/data-store.ts`** (next to `readMorningChecks`; match local idiom exactly — check that file's morning-check pair and mirror it)

```ts
const DEFAULT_LOADING_LOG: LoadingLogStore = { entries: [] };

export async function readLoadingLog(): Promise<LoadingLogStore> {
  return readJson<LoadingLogStore>("loading-log.json", DEFAULT_LOADING_LOG);
}

export async function writeLoadingLog(store: LoadingLogStore): Promise<void> {
  await writeJson("loading-log.json", store);
}
```

Add `LoadingLogStore` to the existing `import type { ... } from "./types"` at the top.

**Backup-bundle check:** run `grep -rn "\.json" app/api/export/route.ts | head -20`. If the export route enumerates data files by explicit list, add `"loading-log.json"`; if it globs the `data/` dir, no change. State which case you found in the commit body.

- [ ] **Step 3: Write the failing score-log test**

Open `lib/score-log.test.ts`, find how existing tests build a block + activities for `buildRideScores` (there are established fixture helpers — reuse them; do not invent a parallel fixture system). Add:

```ts
it("stamps preLoad on a durability-template day when the lookup has a response, and nothing otherwise", () => {
  // Arrange with the file's existing helpers: one planned day carrying durabilityTemplate: "C"
  // and a matching activity on that date; every other arg as the surrounding tests pass it.
  const preLoadForDate = (date: string) =>
    date === DURABILITY_DATE ? { loaded: true, targetG: 490 } : null;
  const withStamp = buildRideScores(block, activities, ftpForDate, today, null, undefined, undefined, undefined, undefined, preLoadForDate);
  const entry = withStamp.find((e) => e.date === DURABILITY_DATE);
  expect(entry?.preLoad).toEqual({ loaded: true, targetG: 490 });

  // Fresh athlete / no lookup → identical entries, no stamp key at all (sparse-field convention).
  const without = buildRideScores(block, activities, ftpForDate, today, null);
  expect(without.find((e) => e.date === DURABILITY_DATE)?.preLoad).toBeUndefined();
  expect(JSON.stringify(without.find((e) => e.date === DURABILITY_DATE)?.executionScore)).toBe(
    JSON.stringify(withStamp.find((e) => e.date === DURABILITY_DATE)?.executionScore)
  ); // provenance only — never moves the score
});
```

(Adjust the positional-arg count to `buildRideScores`' real signature — count its params in `lib/score-log.ts` and append `preLoadForDate` last. If the file's other tests call it with fewer args, keep their style.)

Run: `npx vitest run lib/score-log.test.ts`
Expected: FAIL — new test only (unknown parameter / `preLoad` undefined).

- [ ] **Step 4: Implement the stamp in `lib/score-log.ts`**

Append the parameter to `buildRideScores` (after `adherenceForDate`):

```ts
  preLoadForDate?: ((date: string) => { loaded: boolean; targetG: number } | null) | null
```

In the planned-entry construction (the object literal that already spreads `...(planned.durabilityTemplate ? { durabilityTemplate: ... } : {})` at ~line 183), add directly below that spread:

```ts
          // Track C: the athlete's day-before loading attribution — provenance for the loading loop,
          // only meaningful on durability days (the prompt only ever asks there).
          ...(planned.durabilityTemplate && preLoadForDate ? (() => {
            const pl = preLoadForDate(act.date);
            return pl ? { preLoad: pl } : {};
          })() : {}),
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run lib/score-log.test.ts && npx tsc --noEmit`
Expected: PASS, clean compile.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/data-store.ts lib/score-log.ts lib/score-log.test.ts
git commit -m "feat(loading): loading-log store + preLoad ledger stamp on durability days"
```

---

### Task 3: Sync wiring — feed the lookup, stamp delivery on today's entry

**Files:**
- Modify: `app/api/sync/route.ts`

**Interfaces:**
- Consumes: `readLoadingLog` (Task 2), `buildRideScores(..., preLoadForDate)` (Task 2). In-scope locals at the today-patch (~line 570): `built` (has `durabilityDelivery: number | null`), `plannedDay`, `today`, `updateScoreLog`.
- Produces: ledger entries for durability days carry `preLoad` (any sync) and `durabilityDelivery` (same-day sync only — the only path that fetches today's executed intervals).

- [ ] **Step 1: Build the lookup and pass it**

Near the `adherenceForDate` construction (~line 406), add:

```ts
      // Track C: day-before loading attribution, stamped at birth on durability-day entries.
      const loadingLog = await readLoadingLog();
      const preLoadForDate = (date: string): { loaded: boolean; targetG: number } | null => {
        const rec = loadingLog.entries.find((l) => l.rideDate === date);
        return rec ? { loaded: rec.response === "loaded", targetG: rec.targetG } : null;
      };
```

Append `preLoadForDate` as the final argument of the existing `buildRideScores(...)` call (the one that already ends with `adherenceForDate`). Add `readLoadingLog` to the `@/lib/data-store` import.

- [ ] **Step 2: Stamp delivery in the today-patch**

In the `updateScoreLog((entries) => entries.map(...))` patch for `e.date === today && !e.legacy`, add alongside the existing conditional `intervals` spread:

```ts
                        // Track C: freeze the delivery grade that judged today's durability ride —
                        // the loading loop's power-only outcome. Only the today path can stamp this
                        // (it alone fetches executed intervals); a late-synced durability ride stays
                        // unstamped and simply doesn't feed the loop.
                        ...(plannedDay?.durabilityTemplate && built.durabilityDelivery != null
                          ? { durabilityDelivery: { signal: built.durabilityDelivery } }
                          : {}),
```

(Confirm the local name — `built` is the `buildTodayAnalysis` result whose `durabilityDelivery` field is the numeric signal, per `lib/ride-analysis.ts:140`. If the patch scope only has `todayAnalysis`, use `todayAnalysis.durabilityDelivery` — same value.)

- [ ] **Step 3: Verify against the existing route suite**

Run: `npx vitest run app/api/sync/route.test.ts && npx tsc --noEmit`
Expected: PASS — existing sync tests must not break. Then extend coverage: find the existing route-test case that exercises a durability/template day (grep the test file for `durabilityTemplate`); if one exists, assert the patched entry gains `durabilityDelivery` when the fixture provides executed intervals, reusing that case's mock setup verbatim. If no such fixture exists, add the assertion to the closest today-path case and note it in the commit body. Unit-level stamp correctness is already covered by Task 2; this route assertion is integration insurance, not the primary net.

- [ ] **Step 4: Commit**

```bash
git add app/api/sync/route.ts app/api/sync/route.test.ts
git commit -m "feat(loading): sync stamps preLoad at ledger birth + durabilityDelivery via today-patch"
```

---

### Task 4: `/api/loading` route

**Files:**
- Create: `app/api/loading/route.ts`
- Test: `app/api/loading/route.test.ts`

**Interfaces:**
- Consumes: `deriveLoadingPrompt`, `assessLoadingEffect`, `preLoadTargetG` (Task 1); `readLoadingLog`/`writeLoadingLog`, `readCurrentBlock`, `readScoreLog`, `readLastSync`, `readAthleteProfile` (data-store); `resolveToday`.
- Produces:
  - `GET /api/loading?today=YYYY-MM-DD` → `{ prompt: LoadingPrompt | null, response: LoadingEntry | null, assessment: LoadingEffect }`
  - `POST /api/loading` body `{ today, rideDate, response: "loaded" | "skipped" }` → `{ entry: LoadingEntry }`; 400 on bad input.

- [ ] **Step 1: Write the failing route test**

Model the mock/setup style on `app/api/morning-check/route.test.ts` (same store-mocking approach — read it first and mirror its `vi.mock` pattern for `@/lib/data-store`). Cases:

```ts
// app/api/loading/route.test.ts — shapes only; use morning-check's mock scaffolding
it("GET pre-asks the day before a durability day and reports the assessment", async () => {
  // block: 2026-07-10 has durabilityTemplate "C", durationMin 180; today=2026-07-09;
  // wellness latest weightKg 70; loading log empty; score log empty
  const res = await GET(new Request("http://x/api/loading?today=2026-07-09"));
  const body = await res.json();
  expect(body.prompt).toEqual({ kind: "pre-ask", rideDate: "2026-07-10", template: "C", targetG: 490 });
  expect(body.assessment.verdict).toBe("unproven");
});

it("GET suppresses the prompt entirely on a no-effect verdict", async () => {
  // score log seeded with 5 loaded + 5 skipped B–E entries, delivery rates equal (Task 1 fixture shape)
  const res = await GET(new Request("http://x/api/loading?today=2026-07-09"));
  expect((await res.json()).prompt).toBeNull();
});

it("POST upserts a response keyed by rideDate and echoes it on GET", async () => {
  const post = await POST(new Request("http://x/api/loading", { method: "POST", body: JSON.stringify({ today: "2026-07-09", rideDate: "2026-07-10", response: "loaded" }) }));
  expect(post.status).toBe(200);
  // GET for 2026-07-09 now returns prompt null (responded) and the stored entry for rideDate 2026-07-10 via GET ?today=2026-07-10
});

it("POST rejects a bad response value and a rideDate that is not a durability day", async () => {
  // response: "yes" → 400 ; rideDate: 2026-07-09 (Threshold day) → 400
});
```

Run: `npx vitest run app/api/loading/route.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement the route**

```ts
// app/api/loading/route.ts — the pre-ride loading loop's surface (Track C).
// GET: the one prompt Today may show (pre-ask / retro-ask), the stored response for that ride,
// and the current effect assessment. POST: record the athlete's one-tap attribution.
import { NextResponse } from "next/server";
import { readAthleteProfile, readCurrentBlock, readLastSync, readLoadingLog, readScoreLog, writeLoadingLog } from "@/lib/data-store";
import { assessLoadingEffect, deriveLoadingPrompt, preLoadTargetG } from "@/lib/loading";
import { resolveToday } from "@/lib/date";
import type { LoadingEntry } from "@/lib/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Latest synced weigh-in, falling back to the profile's target weight — same source order the
// nutrition config uses (weight is synced physiology, never hand-edited).
async function currentWeightKg(): Promise<number> {
  const [sync, profile] = await Promise.all([readLastSync(), readAthleteProfile()]);
  const weighIns = (sync?.wellness ?? []).filter((w) => w.weightKg !== null).sort((a, b) => a.date.localeCompare(b.date));
  return weighIns.length > 0 ? (weighIns[weighIns.length - 1].weightKg as number) : profile.nutrition.targetWeightKg;
}

export async function GET(req: Request) {
  const today = resolveToday(new URL(req.url).searchParams.get("today"));
  const [block, log, scoreLog, weightKg] = await Promise.all([
    readCurrentBlock(),
    readLoadingLog(),
    readScoreLog(),
    currentWeightKg(),
  ]);
  const assessment = assessLoadingEffect(scoreLog.entries);
  // A proven no-effect verdict stops the whole loop — no prescription, no retro-ask.
  // ponytail: /model surfacing of this verdict is deferred; the assessment ships in this payload.
  const prompt =
    assessment.verdict === "no-effect"
      ? null
      : deriveLoadingPrompt(block, today, weightKg, new Set(log.entries.map((l) => l.rideDate)));
  const response = prompt ? null : (log.entries.find((l) => l.rideDate === today) ?? null);
  return NextResponse.json({ prompt, response, assessment });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { rideDate, response } = (body ?? {}) as { rideDate?: unknown; response?: unknown };
  if (typeof rideDate !== "string" || !ISO_DATE.test(rideDate) || (response !== "loaded" && response !== "skipped")) {
    return NextResponse.json({ error: "rideDate (YYYY-MM-DD) and response (loaded|skipped) required" }, { status: 400 });
  }
  const block = await readCurrentBlock();
  const day = block?.days.find((d) => d.date === rideDate) ?? null;
  if (!day?.durabilityTemplate || day.durationMin <= 0) {
    return NextResponse.json({ error: "rideDate is not a durability day in the active block" }, { status: 400 });
  }
  const weightKg = await currentWeightKg();
  const entry: LoadingEntry = { rideDate, targetG: preLoadTargetG(weightKg), response, respondedAt: new Date().toISOString() };
  const log = await readLoadingLog();
  await writeLoadingLog({ entries: [...log.entries.filter((l) => l.rideDate !== rideDate), entry] });
  return NextResponse.json({ entry });
}
```

(`SyncData`'s wellness field name: confirm with `grep -n "wellness" lib/types.ts | head -3` — adjust `sync?.wellness` if it differs.)

- [ ] **Step 3: Run tests**

Run: `npx vitest run app/api/loading/route.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/loading/route.ts app/api/loading/route.test.ts
git commit -m "feat(loading): /api/loading GET prompt+assessment, POST one-tap attribution"
```

---

### Task 5: Today chip

**Files:**
- Create: `components/LoadingPrompt.tsx`
- Modify: `components/dashboard/TodayView.tsx` (mount below `<MorningCheckIn />`, line ~85)

**Interfaces:**
- Consumes: `GET/POST /api/loading` (Task 4), `api` from `@/lib/client-api`, `localToday` from `@/lib/date`, `useMountLoad` from `components/ui.tsx` (mirror `MorningCheckIn.tsx`'s imports — it uses `./ui` relative to `components/`).

- [ ] **Step 1: Implement the component** (no unit test — thin fetch/render shell over tested logic; verified in Step 3 via preview)

```tsx
"use client";

import { useState } from "react";
import { api } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { LoadFailed, useMountLoad } from "./ui";

interface Prompt { kind: "pre-ask" | "retro-ask"; rideDate: string; template: string; targetG: number }
interface State { prompt: Prompt | null }

// Track C loading chip: the day before a durability long ride, prescribe the loading target; on the
// ride day (if unanswered), ask whether loading happened. One tap either way — the answer is the
// loading loop's input. Deterministic copy; no LLM involvement.
export default function LoadingPrompt() {
  const [state, setState] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<"loaded" | "skipped" | null>(null);
  const { failed, retry } = useMountLoad(async () => {
    setState(await api<State>(`/api/loading?today=${localToday()}`));
  });

  if (failed) return <LoadFailed retry={retry} what="loading prompt" />;
  if (done || !state?.prompt) return null; // answered (chip collapses) or nothing to ask
  const p = state.prompt;

  const respond = async (response: "loaded" | "skipped") => {
    setSaving(true);
    try {
      await api(`/api/loading`, { method: "POST", body: JSON.stringify({ today: localToday(), rideDate: p.rideDate, response }) });
      setDone(response);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
      {p.kind === "pre-ask" ? (
        <span>
          Long durability ride tomorrow (template {p.template}) — load today:{" "}
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">~{p.targetG} g carbs</span>. Did you?
        </span>
      ) : (
        <span>Did you carb-load yesterday (~{p.targetG} g) for today's long ride (template {p.template})?</span>
      )}
      <span className="ml-2 inline-flex gap-2">
        <button
          disabled={saving}
          onClick={() => respond("loaded")}
          className="rounded border border-[#ff49c8]/60 px-2 py-0.5 text-[#ff49c8] disabled:opacity-50"
        >
          Loaded ✓
        </button>
        <button
          disabled={saving}
          onClick={() => respond("skipped")}
          className="rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 disabled:opacity-50"
        >
          Didn't
        </button>
      </span>
    </div>
  );
}
```

Before writing, open `components/MorningCheckIn.tsx` and `components/ui.tsx`: mirror `useMountLoad`'s real return shape and `LoadFailed`'s real props (the sketch above assumes `{ failed, retry }` / `retry`+`what` — match reality, they may differ). Also eyeball the fuelPrompt chip at `components/dashboard/today.tsx:179` and reuse its exact container classes if they differ from the above.

Mount in `components/dashboard/TodayView.tsx` right after `<MorningCheckIn />`:

```tsx
        <MorningCheckIn />
        <LoadingPrompt />
```

with `import LoadingPrompt from "../LoadingPrompt";`.

- [ ] **Step 2: Full verify**

Run: `npm run check && npm run build`
Expected: clean.

- [ ] **Step 3: Preview-verify** (dev server on the preview port — `npm run dev:preview` config via the preview tool, never port 3000)

The chip only renders when tomorrow/today is a durability day in `current-block.json`. If the live block has one upcoming, verify visually (dark mode) and click through a response (then delete that test entry from `data/loading-log.json` — it's the athlete's real store). If none is upcoming, verify absence renders nothing and rely on route tests; do not fabricate data in the live store.

- [ ] **Step 4: Commit**

```bash
git add components/LoadingPrompt.tsx components/dashboard/TodayView.tsx
git commit -m "feat(loading): Today chip — day-before target + one-tap loaded/skipped attribution"
```

---

### Task 6: Docs

**Files:**
- Modify: `FEATURES.md` (Nutrition section), `README.md` (module map + data-file table + "Nutrition is code" section), `ROADMAP.md` (Track C), `ARCHIVE.md` (new entry)

- [ ] **Step 1: Update the four docs**

- `FEATURES.md` → Nutrition section, after the post-ride fuel prompt bullet:
  ```md
  - **Pre-ride loading loop** — day-before carb-loading target (7 g/kg) ahead of a durability long
    ride, one-tap loaded/skipped attribution, both frozen onto the ledger; the loop learns whether
    loading improves late-effort delivery (power-only outcome, templates B–E) and stops prescribing
    on a proven no-effect. `lib/loading.ts`, `app/api/loading`
  ```
- `README.md` → add `loading-log.json` row to the persistence table ("Athlete's day-before loading attributions per durability ride"); add `loading.ts` row to the module map ("Pre-ride loading loop: target, prompt, power-only effect assessment (Track C)"); one sentence at the end of "Nutrition is code, not AI" noting the loading loop follows the same pattern (deterministic prescription + athlete attribution; delivery-grade outcome, no HR proxy).
- `ROADMAP.md` → Track C: remove the "Pre-ride loading loop" bullet; note v1 shipped → ARCHIVE (verdict surfacing on `/model` + actual-grams logging remain open slivers).
- `ARCHIVE.md` → entry "Pre-ride loading loop — Track C (2026-07-08)": prescription (7 g/kg day-before, all templates), attribution store, `preLoad`/`durabilityDelivery` ledger stamps, heuristic delivered-rate assessment with `no-effect` kill-switch, power-only rationale (decoupling deliberately excluded per the `deriveCarbsOptimum` demotion), known limits (late-synced rides unstamped; template A prescribed but unlearned; binary loaded/skipped pending actual grams). Plan: `docs/superpowers/plans/2026-07-08-preride-loading-loop.md`.

- [ ] **Step 2: Commit (docs separately, per docs-sweep convention)**

```bash
git add FEATURES.md README.md ROADMAP.md ARCHIVE.md
git commit -m "docs: pre-ride loading loop shipped (Track C) — features, module map, roadmap/archive"
```

---

## Self-review notes (already applied)

- **Spec coverage:** day-before prescription ✓ (Task 1 pre-ask + Task 5 chip) · attribution ✓ (Tasks 2/4/5) · power-only outcome ✓ (`durabilityDelivery` stamp, Task 3) · decoupling excluded ✓ (nowhere in the loop; rationale documented) · "learn whether it helped, stop if not" ✓ (`assessLoadingEffect` + GET gate) · template A prescribed-but-unlearned ✓ (deriveLoadingPrompt comment + assess filter).
- **Known limits (deliberate, commented in code):** late-synced durability rides get no delivery stamp (birth-fetch exclusion stands — extend if the corpus starves); binary loaded/skipped until actual grams are worth logging; `/model` verdict surfacing deferred.
- **Type consistency:** `preLoad?: { loaded, targetG }` and `durabilityDelivery?: { signal }` are defined once (Task 1 Step 4) and consumed with those exact shapes in Tasks 2–4.
