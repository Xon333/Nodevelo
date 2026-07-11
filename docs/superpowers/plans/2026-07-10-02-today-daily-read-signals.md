# Today Daily-Read Signals — De-Noise the Verdict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the two noisiest signals in the Today "Athlete State" verdict — a scientifically-discredited ACWR and a single-ride Pw:HR — from manufacturing false fatigue, by demoting ACWR and smoothing the aerobic-efficiency read.

**Architecture:** Two moves inside the existing signal-fusion framework (`lib/athlete-state.ts` + `lib/calibration.ts`). (1) **Demote ACWR** to a minor nudge — TSB and the separate load-ramp readiness check already carry the "you ramped load fast" story, and ACWR is redundant and unreliable for endurance readiness (Impellizzeri et al.). (2) **De-noise the aerobic-efficiency "now" signal**, treated as a genuinely flaky metric (heat/hydration/caffeine/sleep all move Pw:HR — see `lib/aerobic.ts`'s own deadband comment) with THREE layers of caution, not one: a smoothed mean of the last few qualifying rides instead of one latest ride; a minimum-sample floor so a lone ride in the window is never silently treated as "smoothed"; and a stricter, separate threshold before a dip is allowed to count as a corroborating "lived negative" toward the fatigue-override — a modest dip can still nudge the score a little, but only a confidently large one can help cap it. Both signals are weight/adapter edits to a pure fusion function; the AI never computes the state.

**HRV is deferred.** HRV would be the best daily-readiness signal, but the athlete has no wearable that measures it consistently yet, so wiring an HRV evaluator into the fusion now would be dead code (it would only ever return "unavailable"). The opt-in HRV path already in `lib/readiness.ts` is left untouched for when a wearable lands — see the Deferred section at the end for the exact add-back.

**Tech Stack:** TypeScript 5, Vitest (`npm test`), pure functions (no IO in the fusion).

## Global Constraints

- **`npm test`** runs Vitest. Fusion tests live in `lib/athlete-state.test.ts`, weights in `lib/calibration.test.ts`.
- **No new dependencies.** Everything here operates on data already on `SyncData`.
- **Purity:** `computeAthleteState` and evaluators stay pure functions of `(inputs, weights)`. `athleteStateInputsFrom` may read the passed `sync`/`model` but performs no IO.
- **Graceful absence:** every signal returns `null` (sits out) when its data is missing. Never fabricate a signal from thin data.
- **Calibration discipline:** any changed weight default must stay within its existing `[min,max]` bound in `ATHLETE_STATE_WEIGHT_BOUNDS`, or the resolver clamps it (CAL-1). The demoted ACWR defaults below all sit inside the current bounds, so **no bounds edit is needed** — verify this rather than widening bounds. The NEW `aerobicEff.livedAt` leaf (Task 2) DOES need a new bound entry — that one is a genuinely new leaf, not a value change.
- **Pw:HR is flaky — treat it accordingly.** It's confounded by heat, hydration, caffeine, sleep, and time of day (see the research cited in the design review). Every change to it in this plan should make it LESS able to single-handedly move the verdict, never more. When in doubt on a threshold, pick the more conservative (harder to trigger) value.

---

## File Structure

- `lib/calibration.ts` — **modify.** Demote the `acwr` default magnitudes in `DEFAULT_ATHLETE_STATE_WEIGHTS`; widen the `aerobicEff` deadband default; add the new `aerobicEff.livedAt` leaf + bound.
- `lib/athlete-state.ts` — **modify.** Smooth the aerobic-efficiency numerator with a minimum-sample floor in `athleteStateInputsFrom`; split "nudges the score" from "counts as a lived negative" in `evalAerobicEff` + `isLivedNegative`.
- `lib/athlete-state.test.ts` — **modify.** Tests for the smoothed aerobic numerator, the minimum-sample floor, the demoted ACWR's non-dominance, and the two-tier lived-negative threshold.
- `lib/calibration.test.ts` — **modify.** Assert the demoted ACWR defaults and the new `livedAt` leaf.
- `lib/types.ts` — **modify.** Add an optional `livedNegative` field to `SignalContribution`.

---

### Task 1: Demote the ACWR defaults

**Files:**
- Modify: `lib/calibration.ts` — `DEFAULT_ATHLETE_STATE_WEIGHTS.acwr` (~line 151).
- Test: `lib/calibration.test.ts`

**Interfaces:**
- Produces: new (smaller-magnitude) `acwr` defaults. No type or bounds change.

- [ ] **Step 1: Write the failing test**

Add to `lib/calibration.test.ts`:

```ts
import { DEFAULT_ATHLETE_STATE_WEIGHTS, resolveAthleteStateWeights } from "./calibration";

describe("athlete-state weights: ACWR demoted", () => {
  it("demotes ACWR so it can no longer dominate the score", () => {
    // Was danger −20 / optimal +4 — a hammer. Now a nudge; TSB carries the load story.
    expect(Math.abs(DEFAULT_ATHLETE_STATE_WEIGHTS.acwr.danger)).toBeLessThanOrEqual(8);
    expect(DEFAULT_ATHLETE_STATE_WEIGHTS.acwr.optimal).toBeLessThanOrEqual(2);
  });
  it("keeps TSB the dominant load signal (its cap outweighs ACWR danger)", () => {
    expect(DEFAULT_ATHLETE_STATE_WEIGHTS.tsb.cap).toBeGreaterThan(
      Math.abs(DEFAULT_ATHLETE_STATE_WEIGHTS.acwr.danger)
    );
  });
  it("the demoted defaults survive the resolver unchanged (inside bounds)", () => {
    const w = resolveAthleteStateWeights(null);
    expect(w.acwr.danger).toBe(DEFAULT_ATHLETE_STATE_WEIGHTS.acwr.danger); // not clamped
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- calibration`
Expected: FAIL — `acwr.danger` still −20, `optimal` still 4.

- [ ] **Step 3: Demote the defaults**

In `lib/calibration.ts`, in `DEFAULT_ATHLETE_STATE_WEIGHTS`, replace the `acwr` line (~line 151):

```ts
  acwr: { optimal: 4, low: -2, high: -10, danger: -20 },
```

with:

```ts
  // ACWR demoted (redundant with TSB + the load-ramp readiness check, and unreliable for endurance
  // readiness — Impellizzeri et al.): a minor nudge now, not a dominant hammer. TSB carries the load story.
  // Bounds unchanged so a coach could re-weight it; only the DEFAULT is demoted.
  acwr: { optimal: 2, low: -1, high: -4, danger: -8 },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- calibration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/calibration.ts lib/calibration.test.ts
git commit -m "feat(state): demote ACWR to a minor nudge (TSB carries the load story)"
```

---

### Task 2: De-noise the aerobic-efficiency "now" signal — three layers of caution

**Files:**
- Modify: `lib/types.ts` — add `livedNegative?: boolean` to `SignalContribution` (~line 719-725).
- Modify: `lib/calibration.ts` — `AthleteStateWeights.aerobicEff` type + `DEFAULT_ATHLETE_STATE_WEIGHTS.aerobicEff` + `ATHLETE_STATE_WEIGHT_BOUNDS.aerobicEff` (~lines 141, 153, 173).
- Modify: `lib/athlete-state.ts` — `athleteStateInputsFrom`'s `aerobicEffLatest` computation (~lines 162-165), `evalAerobicEff` (~lines 68-81), `isLivedNegative` (~lines 90-92).
- Test: `lib/athlete-state.test.ts`, `lib/calibration.test.ts`

**Interfaces:**
- Consumes: `sync.activities` (Pw:HR), `qualifyingPwHr`, `AEROBIC_RECENCY_DAYS`, `round2` (all already imported in `athlete-state.ts`).
- Produces:
  - `athleteStateInputsFrom` returns a smoothed `aerobicEffLatest` (mean of the last ≤3 qualifying rides in the recency window), but ONLY when at least 2 rides back it — a single ride in the window still returns `null`, never a disguised "smoothed" value of 1.
  - `AthleteStateWeights.aerobicEff` gains a `livedAt: number` leaf — the (larger) relPct magnitude a dip must clear to count as a corroborating lived negative, separate from `deadband` (the smaller magnitude that produces ANY score effect at all).
  - `SignalContribution.livedNegative?: boolean` — set by `evalAerobicEff` only; other evaluators leave it `undefined`.

Rationale for three separate layers, not one: Pw:HR is confounded by heat/hydration/caffeine/sleep (this is well-documented, not a hunch — see the design review). Smoothing alone still trusts a single ride when only one qualifies in the window; a small deadband still lets marginal noise register as "signal"; and — critically, now that HRV is deferred — `execution` and `aerobicEff` are the ONLY two candidate "lived negatives" left, and the override needs just 2 to cap the whole score at 40. Without a stricter bar, a middling aerobic reading could pair with a middling execution reading and falsely cap a fresh athlete's score. Each layer closes one specific gap the others don't.

- [ ] **Step 1: Write the failing tests**

Add to `lib/athlete-state.test.ts` (reuse the file's existing sync/model fixture builder; the shape shorthand below stands in for the real `ActivitySummary`/`SyncData`/`AthleteModel`/`AthleteStateInputs` fields the functions read — fill them to match):

```ts
import { athleteStateInputsFrom, computeAthleteState, type AthleteStateInputs } from "./athlete-state";

describe("aerobic efficiency: smoothing + minimum-sample floor", () => {
  it("smooths aerobic efficiency over the last few rides, not one noisy latest", () => {
    // Two normal rides then one outlier-low latest (a hot/caffeinated day) inside the recency window.
    const activities = [
      { date: "2026-07-01", type: "Ride", powerHrZ2: 2.0, powerHrZ2Mins: 60 /* + other ActivitySummary fields */ },
      { date: "2026-07-03", type: "Ride", powerHrZ2: 2.0, powerHrZ2Mins: 60 },
      { date: "2026-07-08", type: "Ride", powerHrZ2: 1.2, powerHrZ2Mins: 60 }, // outlier
    ];
    const inputs = athleteStateInputsFrom(
      { activities, wellness: [], fitness: { tsb: 0 } } as any,
      { sampleSize: 10, overallExecEwma: 6, overallTrend: "flat", behaviour: { offPlanPct: 0 } } as any,
      null,
      "2026-07-09"
    );
    // Smoothed latest = mean(2.0, 2.0, 1.2) ≈ 1.73, NOT the raw 1.2 — one hot day can't cap the state alone.
    expect(inputs.aerobicEffLatest).toBeGreaterThan(1.5);
  });

  it("does NOT trust a single ride even disguised as 'smoothed' — needs ≥2 in the window", () => {
    const activities = [
      { date: "2026-07-08", type: "Ride", powerHrZ2: 1.2, powerHrZ2Mins: 60 }, // only one qualifying ride
    ];
    const inputs = athleteStateInputsFrom(
      { activities, wellness: [], fitness: { tsb: 0 } } as any,
      { sampleSize: 10, overallExecEwma: 6, overallTrend: "flat", behaviour: { offPlanPct: 0 } } as any,
      null,
      "2026-07-09"
    );
    expect(inputs.aerobicEffLatest).toBeNull(); // sits out entirely rather than reporting a lone ride
  });
});

describe("aerobic efficiency: a modest dip nudges but doesn't alone corroborate fatigue", () => {
  const base: Omit<AthleteStateInputs, "aerobicEffLatest"> = {
    tsb: 20, acwrLevel: "optimal", execEwma: 4.5, execTrend: "down", execSampleSize: 10,
    aerobicEffBaseline: 2.0, offPlanPct: 0,
  };

  it("a modest ~5% dip (past deadband, short of livedAt) nudges the score but does not cap it", () => {
    // relPct = (1.9-2.0)/2.0*100 = -5%. deadband=3 (past it → real effect), livedAt=6 (short → not "lived").
    const result = computeAthleteState({ ...base, aerobicEffLatest: 1.9 })!;
    expect(result.drivers.find((d) => d.key === "aerobicEff")?.livedNegative).not.toBe(true);
    expect(result.score).toBeGreaterThan(40); // only 1 confirmed lived negative (execution) — no cap
  });

  it("a severe ~10% dip (past livedAt) DOES corroborate — now 2 lived negatives cap the score", () => {
    // relPct = (1.8-2.0)/2.0*100 = -10%, past livedAt=6 → counts as a lived negative.
    const result = computeAthleteState({ ...base, aerobicEffLatest: 1.8 })!;
    expect(result.drivers.find((d) => d.key === "aerobicEff")?.livedNegative).toBe(true);
    expect(result.score).toBeLessThanOrEqual(40); // override.scoreCap — execution + aerobicEff both lived
  });
});
```

> Implementer: match the real `ActivitySummary` shape — `qualifyingPwHr` reads `type`, `powerHrZ2`, `powerHrZ2Mins`. The `as any` casts are shorthand; fill the fields the functions actually touch. Reuse any fixture factory already in `athlete-state.test.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- athlete-state`
Expected: FAIL — `aerobicEffLatest` is still the raw single latest ride (no min-sample floor); `livedNegative` doesn't exist on the driver; the 1.9 and 1.8 cases produce the same (wrong) capping behavior since `isLivedNegative` still keys off `dir === "down"` alone.

- [ ] **Step 3: Add the `livedNegative` field to the shared type**

In `lib/types.ts`, in `interface SignalContribution` (~line 719), add after `note`:

```ts
  // Stricter-than-`dir` flag: true only when this signal is confidently real enough to corroborate the
  // fatigue override (isLivedNegative), not merely outside its deadband. Currently only set by
  // evalAerobicEff — Pw:HR is a flaky metric (heat/hydration/caffeine/sleep), so a modest dip should nudge
  // the score without alone helping trigger the hard score-cap. Undefined for every other signal (their
  // `dir === "down"` IS their strict bar).
  livedNegative?: boolean;
```

- [ ] **Step 4: Add the `livedAt` weight leaf**

In `lib/calibration.ts`, in `interface AthleteStateWeights`, change the `aerobicEff` line (~line 141):

```ts
  aerobicEff: { perPct: number; cap: number; deadband: number }; // Pw:HR-Z2 vs baseline (higher = fresher)
```

to:

```ts
  // Pw:HR-Z2 vs baseline (higher = fresher). `livedAt` (relPct magnitude) is a SEPARATE, stricter bar than
  // `deadband`: below deadband → no effect; between deadband and livedAt → nudges the score via perPct/cap
  // but does not corroborate the fatigue override; past livedAt → counts as a lived negative. Flaky metric,
  // so the bar to "confidently real" is deliberately higher than the bar to "any signal at all".
  aerobicEff: { perPct: number; cap: number; deadband: number; livedAt: number };
```

In `DEFAULT_ATHLETE_STATE_WEIGHTS` (~line 153), replace the `aerobicEff` line:

```ts
  aerobicEff: { perPct: 1.5, cap: 9, deadband: 2 }, // effect = relative %Δ from baseline × perPct, capped
```

with:

```ts
  // deadband widened 2→3 (a smoothed ±3% is a genuine move; ±2% is still noise). livedAt=6 is the new,
  // stricter "counts as a lived negative" bar — roughly double the deadband, so only a confidently large
  // dip can help corroborate fatigue via the override.
  aerobicEff: { perPct: 1.5, cap: 9, deadband: 3, livedAt: 6 },
```

In `ATHLETE_STATE_WEIGHT_BOUNDS` (~line 173), replace the `aerobicEff` bounds line:

```ts
  aerobicEff: { perPct: [0, 6], cap: [0, 30], deadband: [0, 8] },
```

with:

```ts
  aerobicEff: { perPct: [0, 6], cap: [0, 30], deadband: [0, 8], livedAt: [0, 15] },
```

- [ ] **Step 5: Add the minimum-sample floor + smooth the numerator**

In `lib/athlete-state.ts`, near the `AEROBIC_RECENCY_DAYS` constant (~line 144), add:

```ts
const AEROBIC_MIN_RECENT_SAMPLES = 2; // never trust a single ride's Pw:HR alone — even "smoothed" over 1
// sample is just that one ride. Flaky metric (heat/hydration/caffeine/sleep); the smoothing in
// athleteStateInputsFrom only counts as smoothing once ≥2 rides actually back it.
```

Then replace the `qualifying`/`latestQual`/`aerobicEffLatest` block (~lines 162-165):

```ts
  const qualifying = acts.filter((a) => qualifyingPwHr(a) != null);
  const latestQual = [...qualifying].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const aerobicEffLatest =
    latestQual && latestQual.date >= daysAgo(AEROBIC_RECENCY_DAYS) ? latestQual.powerHrZ2 : null;
```

with:

```ts
  const qualifying = acts.filter((a) => qualifyingPwHr(a) != null);
  // Smooth the "now" read over the last few qualifying rides in the recency window rather than trusting a
  // single latest ride — per-ride Pw:HR is dominated by heat/hydration/caffeine, so one bad day shouldn't
  // cap the state. The baseline below (older than the recency window) is unchanged, so no overlap.
  const recentQual = [...qualifying]
    .filter((a) => a.date >= daysAgo(AEROBIC_RECENCY_DAYS))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);
  const aerobicEffLatest =
    recentQual.length >= AEROBIC_MIN_RECENT_SAMPLES
      ? round2(recentQual.reduce((s, a) => s + (a.powerHrZ2 as number), 0) / recentQual.length)
      : null; // fewer than 2 rides in the window → sit out rather than report a lone ride as "smoothed"
```

- [ ] **Step 6: Split "nudges the score" from "counts as a lived negative" in the evaluator**

In `lib/athlete-state.ts`, replace `evalAerobicEff` (~lines 68-81):

```ts
function evalAerobicEff(i: AthleteStateInputs, C: AthleteStateWeights): SignalContribution | null {
  if (i.aerobicEffLatest === null || i.aerobicEffBaseline === null || i.aerobicEffBaseline <= 0) return null;
  // Z2-isolated Pw:HR (intervals.icu's icu_power_hr_z2) vs the athlete's recent baseline — HIGHER = more
  // power per heartbeat = fresher/fitter (the inverse of decoupling's polarity). Relative %Δ so the signal
  // is scale-free across athletes. Below baseline = aerobic system under strain → a "lived negative".
  const relPct = ((i.aerobicEffLatest - i.aerobicEffBaseline) / i.aerobicEffBaseline) * 100;
  if (Math.abs(relPct) < C.aerobicEff.deadband) {
    return { key: "aerobicEff", label: "Aerobic efficiency", dir: "flat", effect: 0, note: `Aerobic efficiency near baseline` };
  }
  const effect = round(clamp(relPct * C.aerobicEff.perPct, -C.aerobicEff.cap, C.aerobicEff.cap));
  const dir = relPct > 0 ? "up" : "down"; // "up" = efficiency rising = better
  const note = dir === "up" ? `Aerobic efficiency ${relPct.toFixed(0)}% above baseline` : `Aerobic efficiency ${(-relPct).toFixed(0)}% below baseline`;
  return { key: "aerobicEff", label: "Aerobic efficiency", dir, effect, note };
}
```

with:

```ts
function evalAerobicEff(i: AthleteStateInputs, C: AthleteStateWeights): SignalContribution | null {
  if (i.aerobicEffLatest === null || i.aerobicEffBaseline === null || i.aerobicEffBaseline <= 0) return null;
  // Z2-isolated Pw:HR (intervals.icu's icu_power_hr_z2) vs the athlete's recent baseline — HIGHER = more
  // power per heartbeat = fresher/fitter (the inverse of decoupling's polarity). Relative %Δ so the signal
  // is scale-free across athletes. Below baseline = aerobic system under strain → a "lived negative".
  const relPct = ((i.aerobicEffLatest - i.aerobicEffBaseline) / i.aerobicEffBaseline) * 100;
  if (Math.abs(relPct) < C.aerobicEff.deadband) {
    return { key: "aerobicEff", label: "Aerobic efficiency", dir: "flat", effect: 0, note: `Aerobic efficiency near baseline` };
  }
  const effect = round(clamp(relPct * C.aerobicEff.perPct, -C.aerobicEff.cap, C.aerobicEff.cap));
  const dir = relPct > 0 ? "up" : "down"; // "up" = efficiency rising = better
  const note = dir === "up" ? `Aerobic efficiency ${relPct.toFixed(0)}% above baseline` : `Aerobic efficiency ${(-relPct).toFixed(0)}% below baseline`;
  // Flaky metric — a modest dip (between deadband and livedAt) still nudges `effect` above, but only a
  // confidently large one (past livedAt) is trusted enough to corroborate the fatigue override below.
  const livedNegative = dir === "down" && relPct <= -C.aerobicEff.livedAt;
  return { key: "aerobicEff", label: "Aerobic efficiency", dir, effect, note, livedNegative };
}
```

- [ ] **Step 7: Update `isLivedNegative` to use the stricter bar for aerobicEff**

In `lib/athlete-state.ts`, replace `isLivedNegative` (~lines 90-92):

```ts
function isLivedNegative(c: SignalContribution): boolean {
  return (c.key === "execution" && c.dir === "down") || (c.key === "aerobicEff" && c.dir === "down");
}
```

with:

```ts
function isLivedNegative(c: SignalContribution): boolean {
  // execution's own "down" IS its strict bar. aerobicEff — a flaky, confound-prone metric — needs the
  // separate, stricter `livedNegative` flag (past `livedAt`, not just past the smaller `deadband`).
  return (c.key === "execution" && c.dir === "down") || (c.key === "aerobicEff" && c.livedNegative === true);
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- athlete-state calibration`
Expected: all four new tests PASS.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: all green. If a pre-existing test pinned a state score that shifts because ACWR is demoted, the deadband widened, or the lived-negative bar tightened, recompute the exact new expected value by hand (don't loosen the assertion to a range just to pass).

- [ ] **Step 10: Live smoke**

Run: `npm run dev` (dev server is `dev:preview` on port 3100), open `/today`, and confirm: (a) a single recent hot-day ride no longer flips the Athlete State verdict to "strained" on its own, (b) the ACWR driver (if present in "Supporting signals") reads as a small contribution rather than dominating, and (c) if aerobic efficiency shows a modest dip alongside a middling execution trend, the state does NOT read "strained/depleted" from that pairing alone.

- [ ] **Step 11: Commit**

```bash
git add lib/types.ts lib/calibration.ts lib/athlete-state.ts lib/athlete-state.test.ts lib/calibration.test.ts
git commit -m "feat(state): three-layer Pw:HR caution — smooth, min-sample floor, stricter lived-negative bar"
```

---

## Self-Review Notes

- **Spec coverage:** ACWR demoted (Task 1); single-ride Pw:HR de-noised with three independent caution layers — smoothing, minimum-sample floor, and a stricter lived-negative bar (Task 2). The *display* of these in the Today "Supporting signals" disclosure updates automatically (it renders `state.drivers`); the `livedNegative` field is internal to the override logic and not itself rendered.
- **Depends on Plan 1:** the execution driver feeding `execEwma` should be honest first — land `2026-07-10-01-execution-scoring-hr-leniency` before tuning the fusion around it.
- **Not in scope:** removing ACWR entirely, or merging the three load-ramp signals — demotion is the reversible, low-risk move. And HRV (deferred, below).
- **Minimal type churn:** `AthleteStateInputs` is unchanged (no new field). `SignalContribution` gains one optional field (`livedNegative`) that only `evalAerobicEff` sets — every other evaluator's return object is untouched and still compiles (optional fields default to `undefined`).
- **Why not just raise `deadband` instead of adding `livedAt`?** Considered and rejected: `deadband` also controls whether the signal contributes *any* score effect at all. Raising it to the "confidently real" threshold would make small-but-real Pw:HR movements invisible to the score entirely, when the goal is narrower — keep the score responsive to modest signal, just don't let modest signal alone trigger the hard override. Two separate thresholds is the smallest change that gets both right.

---

## Deferred: HRV (add back when a wearable is available)

The athlete has no consistent HRV source today, so this is intentionally NOT built. When a wearable that syncs HRV to intervals.icu wellness is in place, HRV becomes the strongest daily-readiness signal and should join the fusion as a corroborating "lived" signal. The exact add-back at that point:

1. Add an `hrv` weight leaf to `AthleteStateWeights` + `DEFAULT_ATHLETE_STATE_WEIGHTS` (`{ perPct: 0.8, cap: 12, deadband: 4, suppressAt: -8 }`) and a matching `[min,max]` bound in `ATHLETE_STATE_WEIGHT_BOUNDS`.
2. Add `hrvSuppressionPct: number | null` to `AthleteStateInputs`; compute it in `athleteStateInputsFrom` by reusing the baseline/staleness logic in `lib/readiness.ts` (latest non-stale reading ≤2 days old vs the prior-7-day mean, today excluded).
3. Add an `evalHrv` evaluator (mirror `evalAerobicEff`), register it in the `evaluators` array, and add `"hrv"` to both `isLivedNegative` (dir "down" when suppressed past `suppressAt`) and `CORE_KEYS`.

This is a pointer, not a stub — nothing is scaffolded now.
