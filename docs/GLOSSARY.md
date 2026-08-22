# Glossary

Repo-specific meanings. Where a term has a common sports-science meaning, the entry states how NodeVelo's usage differs.

## Training-load & physiology terms

| Term | Meaning here |
|---|---|
| **FTP** | Functional Threshold Power. Source of truth is the effective-dated `data/physiology.json` store (synced from Intervals.icu sport settings) — past rides score against the FTP that was live *then* (`physiologyAsOf`). |
| **TSB** (form) | Training Stress Balance = CTL − ATL, Intervals.icu's end-of-day figure, always read from the **prior** day so today's ride never leaks into "form going in". |
| **CTL / ATL** | Chronic/Acute Training Load from Intervals.icu's PMC model — synced, never recomputed locally. |
| **TSS** | Training Stress Score (Intervals.icu `trainingLoad`). Feeds weekly targets, deload cadence, ACWR. |
| **ACWR** | Acute:Chronic Workload Ratio — 7-day ÷ 28-day average daily TSS (`readiness.computeAcwr`), banded low/optimal/high/danger; bands are calibratable. |
| **IF** | Intensity Factor = NP ÷ FTP (falls back to avg power). The primary "how hard vs type" signal in execution scoring. |
| **NP / VI** | Normalized Power; Variability Index = NP ÷ avg power (~1.0 = steady). VI contributes ±1 on steady/threshold sessions only. |
| **Pw:HR** | Power-per-heartbeat, computed **Z2-only** (`lib/aerobic.ts`) — the app's preferred aerobic-efficiency marker. Higher = fresher. Inverse polarity to decoupling. |
| **Decoupling** | Whole-ride Pw:HR drift. **Demoted** from execution scoring (2026-06-25, ride-structure artifact); retained only as a durability reference via calibration. |
| **EF / HRRc** | Efficiency Factor and Heart-Rate Recovery series shown on Trends (`lib/trends.ts`). |
| **EWMA** | Exponentially-weighted moving average — the smoothing used everywhere; `calibration.autoEwmaAlpha` adapts the factor to history depth. |

## Planning terms

| Term | Meaning here |
|---|---|
| **Block** | The unit the athlete generates and trains through: 2/4/6/8 weeks, one season focus, exact per-week hour targets, day-by-day prescriptions. Stored in `data/current-block.json`. |
| **Focus period / mesocycle** | `season.ts`'s `FocusPeriod` — 1–4 weeks, the season engine's unit. A block can span or sit inside periods. |
| **Season focus** | One of aerobic-base / threshold / vo2max / anaerobic / durability / sharpen. |
| **Rolling mode** | No upcoming A-event: each block's focus is chosen fresh by the scored coverage selector — see [05-season § coverage selector](systems/05-season.md#the-coverage-selector). |
| **Event-anchored mode** | An A-priority event exists: taper→peak→build are backward-scheduled from race day. Currently **feature-flagged off** (`SEASON_SHAPES_GENERATION = false` in `lib/season.ts`, since 2026-07-16). |
| **Deload / recovery week** | ~60% of loading-week hours, due every 3–4 weeks — derived from *real ride history* (`realWeeksSinceLastRecovery`), not a counter. |
| **Durability template (A–E)** | Five hardwired long-ride structures (`lib/durability.ts`), each training a different fatigue-resistance mechanism; selected deterministically per block. |
| **RaceSim** | A race-simulation session type; goal/terrain text can make ≥1 per block a hard requirement (`lib/session-requirements.ts`). |
| **Prescription** | A day's workout text in Intervals.icu syntax, parsed to structured intervals by `lib/prescription.ts` — the intent execution is judged against. |
| **Limiter / easy win** | The athlete's weakest energy system, auto-derived from the FTP-normalized power curve (`lib/power-profile.ts`); biases (never overrides) focus selection. |
| **Week character** | Presentational load/build/peak/taper label derived client-side from relative volume (`lib/plan-week-character.ts`) — there is no per-week phase in the data model. |

## Scoring & learning terms

| Term | Meaning here |
|---|---|
| **Execution score** | The deterministic 1–10 quality grade for every ride (`lib/execution-score.ts`) — interval adherence, intensity-vs-type bands, easy-day discipline, durability delivery, pacing, RPE gap. |
| **Compliance** | Duration completed ÷ prescribed, **capped by execution** (the trust guarantee: a sub-5/10 session can never show 100%). |
| **Adherence** | Interval-day specific: average rep power vs prescribed target (`lib/interval-match.ts`, matched by duration to resist surge false-matches). |
| **Ledger** | The append-only `RideScoreEntry[]` in `data/score-log.json`. Past entries are frozen with provenance stamps — see [02-scoring](systems/02-scoring-and-learning.md); only today keeps re-deriving. |
| **Athlete model** | Slow-moving learned model from the whole ledger (`lib/athlete-model.ts`): per-type EWMA execution quality, trends, behaviour → ranked `Insight[]`. |
| **Athlete state** | Fast "right now" 0–100 fused score (`lib/athlete-state.ts`): TSB + ACWR + execution EWMA + aerobic efficiency + behaviour, with a lived-signal override that caps a fresh-looking score when corroborated fatigue contradicts it. Spec: [specs/athlete-state.md](specs/athlete-state.md). |
| **Coach snapshot** | The one resolved-numbers bundle (`lib/coach-snapshot.ts`) every LLM surface reads, so Ask-Coach and generation can't disagree and the model never invents a number. |
| **Calibration** | Per-athlete parameter derivation (`lib/calibration.ts`): population default until the ledger *discriminates* (derived value must separate failures from successes by a margin); manual override always wins. |
| **Intervention** | An insight-driven directive whose effect is measured after a 28-day horizon (`lib/intervention.ts`): validated / refuted / inconclusive → a coaching hit-rate that can demote repeat-failing directives. |
| **Disposition** | Post-hoc self-attribution of a session (completed/partial/missed/**compromised**); only "compromised" changes what teaches the model. |
| **Morning check** | Pre-ride, same-day ill/extreme-fatigue/injury flag with a deterministic downgrade decision. Injury always → rest (motion is the hazard); metabolic flags downgrade quality days. |
| **Quirks** | Recurring patterns mined from ride-note free text (`lib/quirks.ts`, NLP + lexicon, needs ≥2 distinct rides) — injected into prompts as *hints*, never facts. |
| **Seeds vs reflections** | The two feedback channels from a block retrospective into the next generation: `next_block_seeds` (athlete-editable YAML in the retrospective markdown — steer generation only once `seeds_approved: true`, set by adopting on Plan) and `structuredReflections` (persisted on `BlockHistoryEntry`). See [systems/04-knowledge.md](systems/04-knowledge.md). |

## Naming traps

- **`lib/loading.ts`** = carb-loading (nutrition), not training load.
- **`lib/trace.ts`** = ride power-chart data, not LLM tracing.
- **`durability.ts`** selects the template; **`durability-score.ts`** grades its delivery.
- **`session-requirements.ts`** = block-level requirements (does this block need a RaceSim?); **`prescription.ts`** = parsing one day's workout text.
- **`trends.ts`** = raw time series; **`trends-verdict.ts`** = the one-word conclusion (computed client-side from the `/api/trends` payload).
- **"Envelope" is overloaded — three unrelated meanings by file.** `block-skeleton.ts`'s envelope is a
  per-slot duration leeway inside a generated week; `calibration.ts`'s durability-insert envelope is
  the KB §12 embedded-hard-effort bound for a durability template; `weekly-envelope.ts`'s
  `WeeklyEnvelope` (`data/weekly-envelope.json`) is the no-block Today weekly TSS range. Check the
  importing module before assuming which one a comment or variable means.
- **HR-nn / UXA-nn / P1–P7 / SUB-n / LEDGER-n / S#-#** in comments and docs are stable finding/plan IDs from hostile reviews, UX audits, and redesign plans — grep ARCHIVE.md for their closeout records.
