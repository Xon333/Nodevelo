# PR #3 review — day-type NEAT calibration + nutrition safety + workout library

Reviewed 2026-08-05. Covers `b93a3af feat: integrate nutrition safety and proven workout library (#3)`
plus a pass over the whole nutrition system (`lib/nutrition.ts`, `lib/nutrition-validate.ts`,
`docs/systems/09-nutrition.md`) it slots into. `npx tsc --noEmit` clean, `npm test` 94 files / 1644
tests green at review time.

**Status: item 1 (gross-vs-net active burn) is RESOLVED and SHIPPED** on branch
`claude/net-of-resting-active-burn` (2026-08-05). The athlete initially disagreed; the disagreement was
settled on the definition of *gross* metabolic efficiency — see §1 below for what actually decided it.
Items 2.1–2.6 and §3 remain open.

## Verdict

Engineering is unusually good: the day-type resolver is threaded through every call site including two
the brief didn't name, `solveAndClampK` was extracted so the pooled and split paths can't diverge, the
validator/reference-table mismatch was caught and fixed rather than deferred, and the `weeklyEnergy`
ratio numerator/denominator mismatch was corrected in passing. No crashes, no migration-flag
regressions, `undefined`-vs-`null` discipline holds throughout.

The physiology is where the pushback belongs. I replicated the day-type solve against the athlete's own
`data/last-sync.json` / `data/athlete.json` rather than reasoning from the code alone — see §1.

---

## 1. The rest/train k gap — RESOLVED (partly measurement error)

Reproduced the app's exact classification over `[today-90, lastLogged]` against `data/last-sync.json`
and matched the persisted record exactly (rest `loggedDays: 6`, train `loggedDays: 69`):

| | n logged | mean intake | mean burn | raw k |
|---|---|---|---|---|
| Rest | 6 | 2508 | 0 | 1.5375 |
| Train | 69 | 3268 | 1272 | 1.2237 |

Raw gap = 0.314 × RMR 1631 = 512 kcal/day.

**Original claim (mine, 2026-08-05):** `activeBurnKcal` from Intervals.icu/Wahoo is *gross* metabolic
energy expenditure for the ride — it already includes the resting-equivalent metabolic cost for the
ride's duration, because Wahoo derives kcal from mechanical kJ via ~23.9% *gross* efficiency
(`kcal = kJ / 0.239 / 4.184 ≈ kJ`, confirmed against 161 real activities: median cal/kJ ratio = 0.997).
Since `k × RMR` is also computed as a 24-hour figure that includes ride hours, adding gross
`activeBurnKcal` on top double-pays the resting-metabolic portion of ride hours: mean training day is
1.83h → 1.83 × RMR/24 ≈ 124 kcal/day of double count, ~24% of the 512 kcal/day gap. Remainder (~388
kcal/day) sits at an ~11.9% relative under-log on a 3268 kcal training day — inside the 20–30%
athlete-under-reporting range `solveAndClampK`'s own candidate list already cites.

**How it was settled.** The athlete pushed back twice, and both rounds sharpened the case rather than
weakening it. The decisive point was not Wahoo's documentation but the definition of the term Wahoo names
its constant after. Zoladz et al. 2023 (*J Physiol Pharmacol* 74(5)) states the decomposition explicitly:

> "In case of GE assessment, the total V'O2 used for its calculation includes three components:
> (i) resting metabolic rate, (ii) the cost of unloaded cycling ('internal work') and (iii) the cost of
> generation of a given external power output."

and defines the pair: "'gross' efficiency (GE) = mechanical work output/energy expenditure; 'net'
efficiency = mechanical work output/energy expenditure **above rest**". So RMR is component (i) of gross
efficiency's own denominator, by definition.

The athlete's strongest counter-argument — that Wahoo's formula takes only watts and time, with no
weight/age/height, so it *cannot* be doing anything with RMR — turned out to argue the same way:
computing a genuinely net figure would REQUIRE those inputs (you must know a personal resting rate and a
duration to subtract them). A formula with no biometric inputs can only apply one population-average
constant to mechanical work, which is precisely what "gross" means. Corroborating: 23.9% sits mid-range
in the literature's cited 18–28% gross-efficiency band, and a TrainerRoad thread the athlete surfaced had
someone independently reverse-engineer Wahoo's output to "18% gross mechanical efficiency that includes
work plus baseline metabolic needs."

**Shipped fix:** `exerciseBurn(a, restingKcalPerHour)` nets `hours x RMR/24`, floored at 0;
`activeBurn()` stays verbatim for day-type classification. `NeatCalibration.basis` keeps a gross-fit `k`
paired with gross burn until the next sync re-solves, so there is no under-feeding window (verified:
today's target byte-identical at 3600 kcal until re-solve). Measured effect on real data: rest/train gap
157 -> 109 kcal/day; after re-solve, today -10 kcal, rest days +80 kcal.

**My original claim was too strong** and is corrected in the shipped docs: I said the whole 512 kcal/day
raw gap was measurement error with zero real NEAT difference. Netting accounts for ~30% of the effective
gap; ~109 kcal/day survives and still needs a candidate explanation (see next paragraph) rather than
being asserted as physiology in either direction.

**Structural point, independent of the gross-vs-net question:** `calibrateNeatByDayType` forces a single
shared `perDayDriftKg` (weight-trend-derived) across both subsets, so there is no per-day-type Δmass
anchor keeping the split honest the way the pooled solve's own Δmass term does. Confirmed synthetically:
a fixture with true `k` identical (1.30) on both day types and *only* training-day logging biased by 200
kcal/day manufactures `k_rest = 1.2495` vs `k_train = 1.1797` — the raw gap always equals
`underlog / RMR`, regardless of true NEAT. Any day-type-specific bias in logging or burn measurement is
attributed 100% to NEAT with nothing to catch it.

**Doc claim needing correction regardless of the above:** `docs/systems/09-nutrition.md` describes the
1.55 (this shipped solve) vs. 1.53 (the original review's independent finding) agreement as "convergent
evidence the signal is real, not a window artifact." That's true only for *window* artifacts — it is not
independent evidence against a *logging-habit* artifact, since both windows share the same athlete, the
same logging behavior, and the same gross-burn field. `t≈6.2` measures consistency of the bias, not its
cause.

---

## 2. Correctness findings (severity order, independent of §1) — ALL SHIPPED 2026-08-06

### 2.1 Live rest-day imbalance finding is computed, persisted, and shown nowhere — high — ✅ FIXED (PR #14)
`data/athlete.json` currently has `dayTypeNeat.rest.imbalance = { direction: "intake-above-model",
estimatedKcalPerDay: 60 }` (the raw rest solve ~1.587 was clamped at `NEAT_PLAUSIBLE_MAX` 1.55). But
`app/api/sync/route.ts:186` ships `neatImbalance: profile.nutrition.neat?.imbalance ?? null` — the
**pooled** record, which is null. The one live out-of-band solve this athlete has is invisible to the UI.
Fix: surface `dayTypeNeat.{rest,train}.imbalance` alongside the pooled one.
**Shipped:** `resolveNeatImbalance` picks whichever split is active today, tagged `dayType: "rest" |
"train" | null`, threaded through `SyncProvider`/`EnergyAvailabilityTile`. Verified against this
athlete's real `dayTypeNeat.rest.imbalance` end-to-end before the fix landed.

### 2.2 Day-type path bypasses both confidence gates — high — ✅ FIXED (PR #15)
`resolveNutritionModel` (`lib/nutrition.ts:513`) reads `dayTypeNeat.rest.multiplier` with no confidence
check. Live, a `confidence: "low"`, clamped, n=6 record drives the rest-day target; shrinkage (w=0.33) is
the only mitigation. `dayTypeConfidence()` is computed and persisted but read by nothing, including the
derivation panel. Either gate on it or remove it — a computed-but-unconsulted confidence field is a trap.
**Decided:** gate on confidence (not remove). **Shipped:** `trustedDayTypeSplit()` — one shared helper
consumed by both `resolveNutritionModel` (the real prescription) and the profile route/derivation panel
(what's bolded as "active today"), so the two can never diverge. Falls back to pooled when the active
side is "low" confidence; mirrors `calibrationIsTrustworthy`'s existing medium/high tier boundary. Live
consequence on this athlete's real data: rest-day target now uses pooled `k`, not the split, until the
rest-day sample clears 12 logged days.

### 2.3 Resetting a NEAT override doesn't clear the day-type split — high, real bug — ✅ FIXED (PR #12)
`app/api/profile/route.ts` re-derives `neat` on reset (~line 377) but never touches `dayTypeNeat` in the
same mutate callback (~line 404), and `resolveNutritionModel`'s override guard only checks
`neat.source === "override"`. Result: reset to default → `neat` becomes population-default →
`dayTypeNeat` (stale, pre-override) still drives the target, with `stale: false` hardcoded so nothing
reports it. Self-heals on next sync, but the window is materially wrong. Same defect class
`nonDerivedNeatCalibration` was written to eliminate, reintroduced one layer up.
**Shipped:** `dayTypeNeat: neatOverride === undefined ? current.nutrition.dayTypeNeat : null` alongside
the existing `neat:` ternary — nulls rather than re-derives inline (the next sync's
`calibrateNeatByDayType` call already does that correctly).

### 2.4 `calibrateNeatByDayType` misreports its own staleness — medium — ✅ FIXED (PR #13)
`lib/nutrition.ts:1098` comments `stale: false, // staleness already gated via pooled returning null` —
false: `calibrateNeat` returns a *non-null* sentinel when stale (`source: "default"`, `stale: true`), and
the `pooled === null` check at line 1007 doesn't catch it. Confirmed directly: 40-day-stale synthetic
data returns `{ rest: { multiplier: 1.3226, source: "derived", stale: false } }`. Nothing ships today
only because `app/api/sync/route.ts` independently checks `dayTypeResult.pooled.source === "derived"` —
an external guard for a contract the function itself misstates. Fix: `if (pooled.source !== "derived")
return null;` at the top of `calibrateNeatByDayType`.
**Shipped** exactly as diagnosed, plus a test reproducing the stale-pooled scenario directly.

### 2.5 Nutrition validator doesn't validate carbs, despite claiming to — medium — ✅ FIXED (PR #18), claim partly corrected
`lib/nutrition-validate.ts` header claims fixing "the kcal/carb prose was trusted on the model's word
alone," but `parseDailyIntakeKcal` only parses daily kcal — pre-ride grams and in-ride g/hr are still
unchecked.
**Correction (2026-08-06):** the "3× disagreement" claim below was overstated. Re-reading the KB, the
"90–120 g/hr non-negotiable" line is scoped to hard-session days in Build phase, not a blanket rule —
`inRideCarbTarget`'s hard/>90min value (105 g/hr) already sits inside that range. The only real gap was a
hard session *under* 90 minutes (formula: 75 g/hr), where the formula is very likely *more* correct than
the KB's blanket phrasing, not a bug. ~~`knowledge-base/nutrition_knowledge.md:64` tells the model "90–120
g/hr in-ride is non-negotiable" while `inRideCarbTarget` returns 38 g/hr for an easy ≤90min ride — a 3×
disagreement neither validator nor repair catches.~~ **Shipped anyway** on its own merits — the generator
prompt's `DESCRIPTION FORMAT` already has fixed `Pre-ride:`/`In-ride:` lines to parse, so extending the
kcal-only validator was a clean, low-risk mirror of the existing pattern regardless of the KB-phrasing
question. **Known residual, documented in code:** both carb formulas step at the 90-minute duration
threshold, and the prompt's own "pick the closest-duration row" instruction can legitimately land the AI
one bucket off near that boundary; the shipped tolerance does not bridge that full bucket jump (doing so
would make the check nearly toothless against genuine invention).

### 2.6 Shrinkage math — window-anchor mismatch ✅ FIXED (PR #19); partition-identity framing corrected
Unshrunk, `k_rest`/`k_train` are an exact weighted partition of pooled `k` (weekly energy conserved).
~~Asymmetric shrinkage weights (w_rest 0.33 vs w_train 0.85 live), a window mismatch (subsets solve over
90 days but shrink toward a 42-day pooled anchor — confirmed day-mix-dependent in the PR's own test
fixture), and per-subset clamping all break that. Measured on synthetic data: ±60–130 kcal/week vs.
pooled, uncontrolled by the buffer.~~
**Correction (2026-08-06):** the "exact partition identity" framing wasn't quite right even as a
baseline — each subset imputes missing days at *its own* logged mean (deliberately, and correctly), so
`rest`+`train` combined never exactly equals a same-window pooled solve regardless of shrinkage. Two
separable issues, not one: **(a) window-anchor mismatch** — real, fixable, shipped: `calibrateNeatByDayType`
now solves an internal-only `windowPooled` over the *same* 90-day window the subsets use, and shrinks
toward that instead of calibrateNeat's own 42-day call, falling back to the old anchor when the wider
solve isn't available. `DayTypeNeat.pooled` (the publicly-exposed field, matching `profile.nutrition.neat`
everywhere else) is deliberately untouched. Real effect on this athlete's data: `k_rest` 1.4120→1.4415,
`k_train` 1.3470→1.3536. **(b) shared `perDayDriftKg`** — not a weighting bug, a genuine identifiability
limit (no independent Δmass evidence separates a real rest/train NEAT gap from a day-type-specific logging
bias, confirmed synthetically). Not fixable by better weighting; documented as an accepted known rough edge
in `docs/systems/09-nutrition.md` rather than re-attempted.

### 2.7 "Today's target" derivation-panel caveat was dropped — low, user-facing — ✅ FIXED (PR #21)
Old copy explained the figure was "shown here for a rest day; training days add today's burn on top."
New copy always shows whichever model `isRestDayToday` resolves — before a ride syncs, that's the
rest-day figure with no caveat that it'll change post-upload.
**Shipped:** copy now reads "maintenance + buffer — reads as a rest day for now; complete and sync a
ride today and this rises to include its burn" specifically when `isRestDayToday`. Verified live on the
real profile page.

### 2.8 `weeklyEnergy`/coach narrative pairs a mismatched intake with the ratio — low — ✅ FIXED (PR #21), diagnosis corrected
~~`needKcal` now correctly excludes unresolved-burn days; `intakeKcal` doesn't. 5 such dates exist in the
live 90-day window.~~ **Correction (2026-08-06):** this framing was wrong — `intakeKcal` deliberately
never drops real logged intake (a test is literally named for it: "excludes unknown-burn activity days
from balance without dropping their intake total"), and changing that would have been a regression, not
a fix. The **real** bug, found by tracing where these numbers render: `WeeklyEnergyPoint.ratio`'s own
doc comment claimed `intakeKcal / needKcal`, but the code actually computes `balanceIntake / needKcal`
— and `balanceIntake` was never exposed. Both `components/Trends.tsx`'s summary sentence and
`lib/coach-snapshot.ts`'s **AI-facing fueling narrative** ("last week X kcal vs Y needed (ratio Z)")
showed `intakeKcal` next to a ratio computed from a smaller, different sum — so X/Y didn't actually equal
Z whenever a week had an unresolved-burn day, in a sentence read by both the athlete and the AI coach.
**Shipped:** `balanceIntakeKcal` exposed on `WeeklyEnergyPoint`/`WeeklyEnergyBalance`; both consumers
switched to it. Also fixed: historical need read the deprecated, frozen `NutritionSettings.buffer` field
— switched to a literal `0` (pure maintenance), since a frozen arbitrary number is worse than a neutral
baseline. Verified live: Trends page now shows "21,838 kcal eaten vs 22,280 needed — 98% of target",
21838/22280 actually equals 98%.

---

## 3. The nutrition system as a whole (nutrition-practitioner read)

- **Safety floor is on the wrong quantity — ✅ ADDRESSED as a warning (PR #20), not a hard floor by
  design.** RMR floor guards a formula fault, not the actual clinical risk (energy availability).
  Computed EA at `BUFFER_MIN_KCAL`: `(1.2749×1631 − 500)/56 ≈ 28.2 kcal/kg FFM` — below the 30 kcal/kg
  LEA threshold — and the RMR floor doesn't catch it. **Decision (2026-08-06, see
  `docs/superpowers/specs/2026-08-06-prescribed-ea-warning-design.md`):** reviewed a hard EA-based floor
  and explicitly rejected it — no body-fat data exists anywhere in the app, and a hard override built on
  an approximation could move real calories on a guess. Shipped instead as `planEaKcalPerKg` +
  `PlanEaWarningBanner`, reusing the existing `eaLevel()` bands unchanged, informational only, visible on
  the Today dashboard whenever the prescribed target itself is already low-EA by construction.
- **No protein floor in the deterministic layer — closed, not needed.** `grep protein lib/` returns
  nothing; it's AI-prose only (`knowledge-base/nutrition_knowledge.md`, correct figures 1.6–2.0 g/kg).
  Athlete confirmed (2026-08-06) protein intake isn't a concern for them (gym background) — scoped out of
  this work rather than built speculatively.
- **`inRideCarbTarget` 105 g/hr for hard >90min needs conditions attached.** Physiologically defensible
  with glucose:fructose ratio + gut-training progression; the bare number carries neither, and the AI can
  render it without caveats to an untrained gut.
- **Calibration RMR uses latest single weigh-in across a 90-day window** — window-mean weight would be
  more correct for the calibration RMR specifically (keep latest weight for today's target). Minor (~2%
  bias on `k`), worse at 90 days than the pooled 42.
- Checked and fine: the 90-day window sits inside `SYNC_WINDOW_DAYS=182` (no phantom-day truncation), and
  the subset solve is scale-invariant in `loggableDays` so activity-history length alone can't move `k`
  — only coverage, which nothing gates on.

---

## 4. `lib/workout-library.ts`

**Dead code as shipped** — zero references outside its own test file across `app/`, `components/`,
`lib/`, `data/`. No store, route, or UI wiring. Fine as a staged domain-first delivery, but should be
labeled as such rather than read as complete.

- **Fingerprint collision on recovery intervals**: `normalizedStructuredSteps` only emits a step when a
  `%` target is present, so `"4x30s@150%, 30s recovery"` and `"4x30s@150%, 4min recovery"` — genuinely
  different sessions (lactate-tolerance vs. neuromuscular) — fingerprint identically. Evidence would pool
  across different protocols once wired up.
- **`recentUses` is a tiebreak, not a filter**: fourth sort key in `selectLibraryWorkout`, behind best
  evidence/evidence count/duration proximity — the top-scoring entry wins almost every time, producing
  the same session repeatedly. Want it as an exclusion filter (last N days) instead.
- Minor: `applyEvidence` promotes candidate→active on two sessions ≥6 with no minimum spacing — two
  consecutive good days can promote off one block of form.

---

## 5. Suggested order of operations — FINAL STATUS (2026-08-06)

1. ✅ **§1 resolved with the athlete** (gross-vs-net active burn) — `exerciseBurn()` nets resting cost,
   PR #11. Settled on the definition of *gross* metabolic efficiency (Zoladz et al. 2023), not on Wahoo's
   docs alone.
2. ✅ **EA-based warning shipped** (PR #20) — informational, not a hard floor; hard floor explicitly
   rejected (no body-fat data to build one on).
3. ✅ **`dayTypeNeat.*.imbalance` surfaced** (§2.1, PR #14).
4. ✅ **`dayTypeNeat` cleared on override set and reset** (§2.3, PR #12).
5. ✅ **Staleness self-report fixed** (§2.4, PR #13).
6. **Protein floor — closed, not needed.** Athlete confirmed intake isn't a concern for them.
7. ✅ **Validator extended to carbs** (§2.5, PR #18) — shipped on its own merits after the "3× disagreement"
   claim that motivated it was found to be overstated on re-reading the KB.
8. ✅ **"Convergent evidence" doc claim corrected** (PR #11's commit to `docs/systems/09-nutrition.md`).

**Also shipped beyond the original list:**
- §2.2 (day-type confidence gate) — PR #15, via `trustedDayTypeSplit()`.
- §2.6a (shrinkage window-anchor mismatch) — PR #19. §2.6b (shared-`perDayDriftKg` identifiability limit)
  documented as an accepted rough edge, not attempted — not fixable by better weighting.

**Also fixed (2026-08-06, PR #21):**
- §2.7 (derivation-panel "today's target" caveat) — restored, worded for the specific ambiguous case.
- §2.8 (mismatched intake-vs-ratio pairing, deprecated buffer field) — diagnosis corrected during the
  fix (the original "shrink intakeKcal" framing would have broken a deliberately-tested behavior); real
  bug was an unexposed `balanceIntake` feeding a doc-comment-contradicting `ratio`, affecting both the
  Trends UI and the AI coach's own fueling narrative.

**Still open, deliberately deferred:**
- §4 workout-library findings (fingerprint collision, recency-as-tiebreak) — deferred by the athlete's own
  choice; the module remains unwired/dead code with no live effect until it's actually wired up.

**Everything else from this review is closed.**
