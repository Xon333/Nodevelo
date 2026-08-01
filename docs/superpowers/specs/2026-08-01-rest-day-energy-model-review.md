# Rest-Day Energy Model — Research & Architecture Review

**Date:** 2026-08-01
**Status:** Research complete. Architecture proposed, **not implemented** — this is a review, not a build.
**Requested by:** the athlete, questioning whether `Maintenance = k × RMR` under-predicts true rest-day
need after heavy training.
**Ties to:** [09-nutrition.md](../../systems/09-nutrition.md) (the model this reviews),
[accuracy design](2026-07-30-day-to-day-nutrition-accuracy-design.md) (where `k`-calibration was built).

---

## Bottom line

**The current model is not wrong, but it is incomplete in a specific, now-measured way — and the fix is
not the one first proposed.**

Two falsification tests were run against this athlete's own 6-month synced dataset (79 intake-logged
days, 191 activities). One found a real, statistically strong effect; the other found none:

| Test | Question | Result |
|---|---|---|
| **A — same-day** | Does a flat `k` fit rest days and training days equally well? | **No.** Rest-day implied `k` is ~0.31 higher than training-day implied `k` (**t ≈ 6.2**, dose-responsive: rest > easy-training > hard-training, monotonic) |
| **B — lagged** | Does *yesterday's* training load predict *today's* rest-day intake? | **No detectable effect.** r = 0.25, not significant (t ≈ 0.73, n = 10) |

So: the athlete's intuition that "something is missing" is **empirically correct**. But the literature and
the data together point to a **same-day, day-type effect on the background multiplier** — not a
**decaying multi-day "residual recovery" term** stacked on top of the existing formula. Those are different
architectures with different evidence behind them, and only one is supported here.

**Recommendation:** extend the existing calibration machinery to solve `k` per day-type (rest vs. training),
confidence-gated exactly like the current single-`k` calibration, rather than adding a new physiological
term. Detailed in §8. **Not shipped yet** — the rest-day sample (n=10) is real and significant but small;
§7 lays out the gate before this goes live.

---

## Evidence-quality tiers

Used throughout. Weight given accordingly — Tier 1 findings override Tier 3/4 opinion wherever they conflict.

| Tier | What | Examples used here |
|---|---|---|
| **1** | Peer-reviewed primary research, meta-analyses, systematic reviews | EPOC systematic review, Pontzer DLW studies, next-day RMR crossover trial |
| **2** | Position stands, textbook physiology, named researchers' published work | ACSM/ISSN position stands, Jeukendrup's carbohydrate-periodization papers |
| **3** | Named coaches' public writing/podcasts (not peer-reviewed, but expert practitioner judgment) | Couzens, San Millán, Podlogar interviews and blog posts |
| **4** | Forums, community discussion — signal about *practitioner consensus*, not evidence of *mechanism* | TrainerRoad forum, Intervals.icu forum |
| **This athlete's data** | n=1 observational, free-living, correlational — cannot establish causation alone, but is the only *individual-level* evidence available | Tests A and B below |

---

## 1. Is `Maintenance = k × RMR` correct as currently framed?

**Partially.** The formula's *shape* is right — RMR from a validated equation, times a NEAT+TEF
multiplier, is the standard sports-nutrition decomposition. What's incomplete is the assumption that
**`k` is a single constant across all day types.**

The clearest Tier-1 evidence against a flat constant is Pontzer's constrained-total-energy-expenditure
model: across five populations measured by doubly labeled water, "total energy expenditure was positively
correlated with physical activity but the relationship was markedly stronger over the lower range of
physical activity, with total energy expenditure plateauing for subjects in the upper range of physical
activity" ([Pontzer et al., *Current Biology*](https://www.cell.com/fulltext/S0960-9822(15)01577-8)). In
exercise-intervention studies specifically, "total daily energy expenditure increased by only approximately
30% of the change expected from additive models" — i.e. a fully additive model (`RMR × constant + full
measured burn`) is expected, from controlled trials, to **overshoot** true TDEE on high-activity days by a
wide margin.

That is the opposite direction from what "add a recovery term" would fix. It predicts under-prediction on
**rest days relative to a flat average**, not under-prediction from a missing recovery cost — because the
flat average gets dragged down by systematically over-crediting training days. This is exactly the shape
Test A found in this athlete's own data (§3).

**Countervailing finding, also Tier 1:** a 2024 replication found "no evidence for metabolic adaptation
during exercise-related energy compensation" at the level of measured 24h/sleep/resting expenditure
components, even though ~48% of subjects showed compensation averaging 308 kcal/day
([iScience](https://www.cell.com/iscience/fulltext/S2589-0042(24)01064-2)). The consensus is **not settled**
— compensation is real in aggregate and heterogeneous by individual, and the mechanism is not fully
resolved (it may be behavioral/appetite-driven rather than a true metabolic-rate suppression). This matters
for §8's architecture choice: we can act on the *pattern* without needing to resolve *why* it happens.

## 2. Does recovery have a genuine energy cost? Mechanism by mechanism

| Mechanism | Magnitude | Duration | Workout-type dependent? | Already in `activeBurnKcal`? | Already in `k` (NEAT+TEF)? | Evidence tier |
|---|---|---|---|---|---|---|
| **EPOC** | 6–15% of session cost; ~66 kcal (HIIT) vs ~54 kcal (moderate) per 30-min bout ([Panissa et al. 2021 systematic review](https://onlinelibrary.wiley.com/doi/abs/10.1111/obr.13099)) | Resolves largely **same-day**. Directly tested: elevated only 08:00–12:00 on the exercise day, no significant difference at 23h (p=0.12) ([whole-room calorimeter study, PMC3841058](https://pmc.ncbi.nlm.nih.gov/articles/PMC3841058/)) | Yes — intensity-dependent, exponential with intensity above ~50–60% VO₂max | Uncertain — depends on the head unit's own algorithm; the app cannot verify this | No | 1 |
| **Elevated next-day RMR** | **Not statistically detectable** for moderate sessions: 21 ± 227 kcal/day, p=0.74, Cohen's d=0.09 (negligible), n=13 male endurance athletes, 111±71 min self-regulated sessions ([PMC12244387, 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC12244387/)) | N/A — the null result *is* the finding | Authors explicitly caveat: **"caution is still warranted for high-intensity exercise within 48h"** — untested by this study | N/A | Partially, by construction of the null | 1 |
| **Glycogen resynthesis (metabolic overhead of storage, not the stored energy itself)** | ~0.21–0.36 kcal per gram stored (theoretical vs. measured); consistent with the general 5–10% thermic effect of carbohydrate | Resynthesis itself takes 20–24h to normalize after extreme depletion (5–6 mmol·kg⁻¹·h⁻¹), but the **overhead cost** is paid as it's eaten, not held over | Yes — scales with carbohydrate deficit | No — this is separate from the ride's own burn | **Yes** — it is proportional to intake, so it's inside TEF, which `k` already includes by design | 1–2 |
| **Muscle protein synthesis (baseline turnover)** | ~4.3 kcal/kg/day, ~20% of BMR ([Waterlow & Millward, cited in NCBI Bookshelf NBK224633](https://www.ncbi.nlm.nih.gov/books/NBK224633/)) | Continuous, every day | No — baseline, not exercise-specific | N/A | **Yes** — this is baseline turnover, already inside RMR itself | 2 |
| **MPS, post-exercise elevation specifically** | Localized estimate only: ~108 kcal in one leg following an amino-acid stimulus ([NBK224633](https://www.ncbi.nlm.nih.gov/books/NBK224633/)). **No whole-body incremental figure found.** | Elevated ~24–48h post-training (well-established qualitatively) | Likely — resistance/high-eccentric-load work more than steady Z2 | No | Uncertain — genuine gap | 2, with an unresolved gap |
| **Connective tissue repair** | **No kcal figure found in this search.** | Days, qualitatively | Presumably load/impact-dependent | No | Unknown | Gap — no citable source |
| **Immune activation / inflammation** | Qualitatively "energetically demanding" ([exercise immunology reviews](https://pmc.ncbi.nlm.nih.gov/articles/PMC7498623/)); **no kcal figure found** | Hours to ~1–2 days | Yes, intensity-dependent | No | Unknown | Gap — no citable source |
| **Mitochondrial biogenesis** | Reasoned to be small (low mitochondrial protein mass turned over per day even in an adaptive phase) — **not directly sourced in this search**, flagged as inference | Days to weeks | Yes | No | Probably, marginally | Reasoned, not cited — treat as unconfirmed |
| **Autonomic recovery (HRV normalization etc.)** | Regulatory/signaling, not itself materially energy-costly | Hours to ~1–2 days | Yes | N/A | N/A | Reasoned |
| **Hormone production** | Trivial directly (hormone mass is micrograms); its *downstream* effects (appetite, MPS signaling) are captured elsewhere in this table, not as an independent term | N/A | N/A | N/A | Indirectly, via other rows | Reasoned |

**Reading this table honestly:** the components with hard numbers (EPOC, glycogen-storage overhead,
baseline MPS turnover) are either already captured by the existing design or resolve same-day. The
components that *could* plausibly explain a multi-day residual — connective-tissue repair, immune
activation, incremental post-exercise MPS — have **no quantified whole-body kcal figure in the literature**
that this search surfaced. That is a genuine gap, not a false negative on my part; it means anyone claiming
a specific number for these (e.g. "add 300 kcal for recovery") is asserting a heuristic, exactly what the
brief asked to avoid.

## 3. Is recovery energy already hiding inside the calibrated `k`?

**Yes, partially — and this athlete's own data shows it, cleanly.**

**Test A (same-day compensation).** For every logged day, computed a "local k" = `(intake − activeBurn) /
RMR`, split by whether that day had any activity burn:

```
REST days  (burn=0):     n=10  mean local-k = 1.5335  sd=0.154  se=0.049
TRAINING days (burn>0):  n=69  mean local-k = 1.2198  sd=0.109  se=0.013
difference (rest − training) = 0.3137  →  ~512 kcal/day equivalent
Welch t ≈ 6.21
```

Sub-split training days by load (tertile cut on active-burn kcal):

```
HARD training days (top tertile):  n=23  mean local-k = 1.1597
EASY training days:                 n=46  mean local-k = 1.2499
```

**`rest (1.534) > easy (1.250) > hard (1.160)` — monotonic.** This is exactly the Pontzer-shaped
signature: a single average `k` (currently 1.2584, `source: "derived"`, adopted live) sits *between* the
rest-day and hard-training-day true rates, systematically under-serving the rest days and over-crediting
the hard ones, because the calibration procedure is only asked to balance the *aggregate* window, not each
day-type separately.

**This does not resolve the mechanism.** Two explanations fit the same pattern equally well, and this
single-subject observational dataset cannot distinguish them:

1. **Physiological compensation** (Pontzer): true energy need on hard days doesn't rise 1:1 with measured
   burn — some of it is offset elsewhere in the body's expenditure — so `activeBurnKcal` is over-credited
   on the hardest days, dragging the fitted average down.
2. **Behavioral/appetite-lag**: intake simply doesn't scale with burn in real time. A Tier-1 pilot study
   found exactly this pattern directly: "aerobic exercise appears to increase overall appetite while
   simultaneously enabling individuals to more effectively control intake" — perceived hunger rose ~14%
   but **measured energy intake did not differ** from the sedentary condition over a 3-day window
   ([PMC11427932](https://pmc.ncbi.nlm.nih.gov/articles/PMC11427932/)). If this generalizes to hard
   training days specifically, the athlete may simply be **under-eating relative to true need on hard
   days** — a genuine deficit, not a compensated one.

Both explanations produce the same measured pattern; they imply different fixes (§8 discusses this).
**What can be said with confidence: the flat single-`k` model's specific failure mode — under-serving
rest days — is real, large (t≈6.2), and matches the athlete's own stated intuition exactly.**

## 4. Should recovery be a separate physiological term?

**Not the decaying multi-day term originally proposed.** Test B looked for exactly that:

```
rest day AFTER a training day:   n=10  mean intake = 2501  sd=251
rest day AFTER another rest day: n=0   (this athlete has NEVER had two rest days in a row
                                         in the synced history — a real data limitation, not
                                         a null finding; Scenario B literally hasn't occurred)
Pearson r(prior-day burn, today's rest-day intake) = 0.249   n=10
t ≈ 0.73  (not significant at this sample size)
```

No detectable relationship between yesterday's training load and today's rest-day intake. This is
**underpowered, not disproven** (n=10) — but it means there is currently **no positive evidence** to
justify building a decaying residual-load term. Building one now would be exactly the kind of
evidence-free heuristic the brief explicitly asked to avoid.

**The distinction that matters:** Test A found a real **same-day, day-type** effect. Test B found no
detectable **lagged, multi-day** effect. Those are architecturally different claims — "today's target
should know whether today is a rest day" (supported) vs. "today's target should know how hard yesterday
was" (not supported, here). §8 recommends building only the first.

## 5. How should recovery demand be estimated?

Given §3–4's findings, the right question isn't "which load metric estimates a decaying recovery debt" —
no metric is justified until Test-B-style evidence supports one. The right question is **which day-type
signal to condition `k` on**, which is much simpler:

| Candidate | Verdict | Why |
|---|---|---|
| **Today's own `activeBurnKcal` == 0 vs > 0** | **Recommended** | Already computed, already the model's own definition of "rest day" (D1/D7 in the accuracy design), directly what Test A validated |
| Yesterday's kJ / TSS / training load | Not supported by Test B (yet) | No detectable lagged effect at current n |
| HRSS / TRIMP / IF | Same data gap as above, plus not currently synced | Would need new data capture before it could even be tested |
| Zone distribution | Same gap | Interesting for *quality* of the session, not tested for energy demand |
| Glycogen-depletion estimate | Not directly measurable | Would require its own model (CHO burned vs. stored) — new complexity with no validated payoff yet |
| Muscle-damage estimate (CK, eccentric load) | Not measurable from synced data | NodeVelo has no eccentric-load or CK signal |
| Rolling/decaying training load (Bannister ATL, τ≈7d) | Plausible *if* Test B had shown a lagged effect | The infrastructure exists in principle (this is literally what `readiness.ts`/ATL already track), but there's no positive evidence yet that it predicts recovery *energy* need specifically, as opposed to fatigue |

**The clean answer: split by today's own burn status. Everything else is either unsupported by this
athlete's data or requires new data capture with no current justification.**

## 6. Is "rest day" a meaningful concept?

**Yes — for this athlete, empirically (Test A), not just by definition.** The mean local-`k` difference
between rest and training days is large and highly significant. Rest days behave differently from training
days in a way the current flat model doesn't represent.

The specific scenario posed (Monday: 5h ride, Tuesday: rest vs. Monday: rest, Tuesday: rest — should the
two Tuesdays differ) is a **lagged** question, which is Test B's territory, and Test B found nothing
detectable. Compounding that: **this athlete has never had two consecutive rest days in the synced
history**, so Scenario B has literally never occurred for them — there is no historical comparison to draw
on even in principle. The literature (§1, §2) suggests any such lagged difference, if real, is modest
(next-day RMR: not significant for moderate sessions) and most likely to matter for the *hardest* efforts
specifically, which the moderate-intensity RMR study didn't cover. **Honest answer: plausible in theory,
untested and undetected in this athlete's actual data, and not something to build a model term around yet.**

## 7. Validation strategy

Requested: compare true isolated rest days, compare after high-TSS rides, compare consecutive recovery
days, compare against weight trend, check for systematic bias, and determine whether the apparent problem
is psychological rather than physiological. Executed against this athlete's real synced data (read-only,
`data/last-sync.json` + `data/athlete.json`):

- ✅ **True isolated rest days vs. training days** — Test A, above. Real, large, significant.
- ✅ **Comparison after high-TSS rides specifically** — the hard/easy training sub-split in Test A shows
  the effect *scales* with load (monotonic dose-response), not just present/absent.
- ⚠️ **Consecutive recovery days** — cannot be tested; this athlete has none in the record. Flagged as a
  genuine data gap rather than papered over.
- ✅ **Against observed weight trend** — full-history trend is **−0.23 kg/7d** (mildly negative, consistent
  with the athlete having a *gain* goal that isn't being met — matches the streak-alert and buffer findings
  from the shipped Phase 2/3 work, not a new contradiction).
- ✅ **Systematic bias check** — this *is* Test A: a systematic, directional, dose-responsive bias exists.
- ⚠️ **Psychological vs. physiological** — genuinely **not resolvable from this dataset alone** (§3). Both
  candidate mechanisms produce identical aggregate signatures. Flagged honestly rather than picking one.

**Attempted falsification, not confirmation, as instructed.** The hypothesis "the model is fine as-is" was
the null being tested; it did not survive Test A (t≈6.2 is not a coin flip). The hypothesis "there's a
decaying multi-day recovery cost" was also tested on its own terms (Test B) and **did not survive either**
— which is exactly why the recommendation below is narrower than the question that prompted this review.

**Ongoing validation, once any change ships:** re-run Test A/B on a rolling basis as more data accrues,
particularly watching for a first genuine back-to-back rest-day pair to finally test Scenario A vs B
directly.

## 8. Architecture options

All options below share the same non-negotiables from the brief: physically interpretable, no unjustified
magic constants, no double-counting, explainable, integrates with the derivation panel.

### Option 1 — Do nothing (keep flat `k`)

**Rejected.** Test A found a real, large, statistically strong effect. "No evidence the model is missing
anything" is not the honest conclusion here, unlike some of the individual mechanisms in §2's table.

### Option 2 — Additive decaying recovery term (the originally-proposed architecture)

```
Daily Target = (k × RMR) + Today's Exercise + ResidualRecoveryCost(t) + Goal Buffer
```

**Rejected, on current evidence.** This is precisely what Test B looked for and did not find. Building it
now would mean inventing a decay function, a load-input metric, and a magnitude — three unjustified
constants — to fit a signal that isn't demonstrated to exist. It would also risk **double-counting**
against Option 3 below, since both are trying to explain the same underlying Test-A pattern from different
angles.

### Option 3 — Day-type-conditioned `k` (recommended)

```
Daily Target = (k_dayType × RMR) + Today's Exercise + Goal Buffer

k_dayType = k_rest   if today's activeBurnKcal == 0
          = k_train  otherwise
```

Both `k_rest` and `k_train` solved by the **same existing `calibrateNeat` machinery**, just partitioned by
day type before solving, with **independent confidence gates** (rest-day sample is much smaller than
training-day sample, and must be gated separately — see §9). No new physiological term, no new magic
constant: it reuses the exact energy-balance identity already built, split along the one dimension Test A
validated.

**Pros:** zero new invented mechanism; directly reuses `calibrateNeat`, `NeatCalibration`, and the
confidence-tier pattern the derivation panel already renders; mathematically it's still additive and
interpretable (`k` just becomes day-type-aware instead of a single scalar); cannot double-count against
anything, since it *replaces* the flat `k`, not adds to it.

**Cons:** the rest-day sample will always be smaller than the training-day sample for any cyclist (fewer
true rest days than training days), so `k_rest` will chronically sit at a lower confidence tier than
`k_train`; needs its own gate (§9) to avoid shipping an under-powered rest-day multiplier.

### Option 4 — Diminishing marginal credit on `activeBurnKcal` at high load

```
Daily Target = k × RMR + f(activeBurnKcal) + Goal Buffer,   f concave (f'(x) < 1 at high x)
```

Directly implements the Pontzer interpretation of Test A (over-crediting hard days, rather than
under-crediting rest days). **Not recommended over Option 3**, for one clean reason: it requires inventing
a *shape* for `f` (what curve, what inflection point) with no data to fit it against beyond the same three
data points already summarized as `k_rest / k_easy / k_hard`. Option 3 captures the same signal with two
numbers this athlete's own data can already estimate directly, rather than a curve shape with no basis.

### Option 5 — Rolling/decaying training-load-weighted `k`

A continuous version of Option 3 (`k(t)` as a smooth function of recent training load rather than a
binary rest/train split). **Deferred, not rejected.** This is the natural next step *if* a future,
larger dataset shows Option 3's binary split is too coarse (e.g. if `k_train` itself turns out to vary
meaningfully with load, beyond what the hard/easy sub-split already hints at). Revisit once Option 3 has
enough data to evaluate whether it's under-fitting.

## 9. Recommended design and rollout gate

**Ship Option 3, gated, not immediately.**

```ts
export interface NeatCalibrationByType {
  rest: NeatCalibration;   // same shape as today's NeatCalibration
  train: NeatCalibration;
}

export const REST_K_MIN_LOGGED_DAYS = 15; // vs. the general calibration's existing floor — this
                                            // athlete's real rest-day sample is currently 10; the gate
                                            // must clear before day-type k is adopted for the rest side
```

- `k_train` calibrates the same way the current single `k` does today — the training-day subset is
  already large enough (n=69 here).
- `k_rest` calibrates independently, with its **own** confidence tier, gated at a higher minimum sample
  than the existing floor, because n=10 — while statistically compelling here — is small in absolute
  terms and this athlete has zero redundancy (every rest day counts once).
- **Until `k_rest` clears its gate, fall back to the current flat `k`** — exactly the same
  "insufficient data → default" pattern `calibrateNeat` already uses. No new failure mode, no regression.
- The derivation panel gains one more row: which `k` is active today and why, following the same
  `source`/`confidence` pattern already shown for the single-`k` case.
- **Out of scope, explicitly:** Options 2, 4, 5 above. If a genuine lagged/decaying signal is later found
  (re-running Test B as data accrues), that becomes its own future review — not folded into this one.

This is a **research recommendation, not an implementation**. Confirm before it's built.
