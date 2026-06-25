# Athlete State — design spec (ROADMAP §5: signal fusion)

_Status: v1 foundations. Long-term feature — weights/thresholds will be tuned; this records the
framework + the tunable knobs, not final numbers._

## Purpose

One **glanceable, deterministic "what does the second brain think of my state right now"** metric —
Whoop-recovery-style. It **fuses** the brain's parallel signals (which today surface separately and
can contradict each other) into one reconciled read. It does **not** replace the individual metrics
(readiness, execution, aerobic efficiency…); it sits above them as the summary glance.

The headline is a **0–100 score**; the band label + the drivers are revealed **on hover**.

## Shape (`lib/athlete-state.ts`)

```ts
interface SignalContribution {
  key: string;        // "tsb" | "acwr" | "execution" | "aerobicEff" | "rpe" | "behaviour"
  label: string;      // human label for the hover
  dir: "up" | "down" | "flat";   // relative to the athlete's baseline/expected
  effect: number;     // signed points added to the score (− = worse state)
  note: string;       // one-line plain-English reason
}
interface AthleteState {
  score: number;      // 0–100, clamped — the glance
  band: "primed" | "ready" | "steady" | "strained" | "depleted";
  recommendation: "push" | "proceed" | "soften" | "recover";
  confidence: "low" | "medium" | "high";   // # of signals present + sample size
  drivers: SignalContribution[];            // sorted by |effect| — what moved the score
  headline: string;                         // deterministic one-liner; AI may rephrase
}
export function computeAthleteState(inputs: AthleteStateInputs): AthleteState | null;
```

`null` when there isn't enough data to say anything (no fitness + <N scored rides).

## Architecture — signal evaluators (the extensibility point)

The fusion is a **list of evaluators**, one per signal. Each takes the resolved inputs and returns a
`SignalContribution | null` (null = signal unavailable). The score is:

```
score = BASE + Σ contribution.effect   (then clamp 0–100, then apply the lived-signal override)
```

**Adding a signal later (e.g. energy-availability / fueling) = add one evaluator** — no change to the
combiner. This is the "leave space for other metrics" requirement.

### v1 evaluators (core 5 + behaviour)

Each maps a deviation-from-baseline to a signed `effect`. Directions only — magnitudes are tunable
constants (see below). Positive effect = better state.

- **tsb** — from `fitness.tsb`. Fresh (TSB ↑) → +; deep negative → −. (Load-model freshness.)
- **acwr** — from `computeAcwr().level`. Optimal → ~0; high → −; danger → −−.
- **execution** — from `AthleteModel.overallExecEwma` (1–10) + `overallTrend`. Above mid + trending up
  → +; below mid + trending down → −. (How well recent sessions are actually being executed.)
- **aerobicEff** — latest ride's Z2-isolated Pw:HR (`icu_power_hr_z2`, intervals.icu) vs the athlete's
  recent baseline, both gated to rides with ≥15 min of Z2. Higher than baseline → + (fresher/fitter);
  below → − (aerobic strain). Z2-isolated by intervals.icu, so it's clean even on an interval day —
  no whole-ride-decoupling ride-structure confound. Absent (signal sits out) when no qualifying ride.
- **rpe** — recent mean session RPE vs a longer baseline mean. Higher-than-baseline → −. (Perceived
  cost.)
- **behaviour** — `AthleteModel.behaviour.offPlanPct`. Light input: very high off-plan drift → small −.

### Lived-signal override (the reconciliation rule)

The load model (tsb/acwr) can read "fresh" while the body is wrecked. So: **if ≥2 of the lived signals
{execution-down, aerobicEff-down, rpe-up} corroborate strongly, cap the score down** (and force
`band ≤ strained`, `recommendation ≤ soften`) even when tsb/acwr are positive. The ≥2 threshold guards
against one noisy reading flipping the conclusion.

### Score → band → recommendation

Tunable thresholds (one block):

| score | band | recommendation |
|------:|------|----------------|
| 80–100 | primed | push |
| 65–79 | ready | proceed |
| 45–64 | steady | proceed |
| 25–44 | strained | soften |
| 0–24 | depleted | recover |

### Confidence

`high` when most evaluators fired with adequate sample size (`AthleteModel.sampleSize`, presence of
fitness + a recent ride); `low` when few signals are available. Down-weights a score built on thin
data — ties to the calibration-confidence theme (ROADMAP §1).

## Consumers (all three)

- **Today** — a compact `AthleteStateCard`: the 0–100 score (ring/number) + a one-line headline;
  **hover reveals the band + the top drivers**. Computed in the `/api/sync` GET handler, carried on
  `AppState.athleteState`.
- **Generation** — the state + top drivers fold into the synthesised directives so a new block
  respects current systemic state.
- **Ask-Coach** — the state + drivers added to the coach context (grounded, can't be invented).

## AI containment

`score`, `band`, `recommendation`, `drivers` are **all deterministic**. The AI only ever phrases the
`headline` / coach wording from them — it never computes or overrides the state.

## Tunable knobs (one constants block in `athlete-state.ts`)

`BASE`, each evaluator's effect magnitudes + deviation thresholds, the band cutoffs, the lived-override
threshold (≥2) and its cap. All named, all in one place — retuning is editing constants, not logic.

## Tests (`athlete-state.test.ts`)

Pin the **directional logic, not the exact numbers** (so weights stay free to tune):
- All-good inputs (fresh tsb, optimal acwr, high execution, high aerobic efficiency, normal rpe) → high band.
- Corroborated fatigue (execution-down + aerobicEff-down + rpe-up) → low band **even with a fresh tsb**
  (the override fires).
- A single bad lived signal does **not** flip a fresh tsb (override needs ≥2).
- Missing signals → lower `confidence`, still returns a value; no signals at all → `null`.
- `drivers` are sorted by `|effect|` and name the contributing signals.

## Out of scope (v1)

Energy-availability evaluator (hook only — separate roadmap item), per-athlete calibrated weights
(uses conservative population defaults now; the calibration framework in §1 will personalise later),
and any trend chart of the score over time.
