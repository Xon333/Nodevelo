# NodeVelo

**A personal cycling coach that learns from how you actually train.** NodeVelo sits on top of
[Intervals.icu](https://intervals.icu): it pulls your physiology and ride history, scores every
session against what was prescribed, learns your strengths and weak points, and generates the next
structured training block with `claude-sonnet-4-6` — then writes it back to your Intervals.icu
calendar.

Intervals.icu stays the **system of record** for day-to-day training. NodeVelo is the **thinking
layer on top**: it decides *what to do next* and explains *how you executed* — the judgement a
coach adds that a data platform doesn't.

This README is the architectural manual. Start with **the core idea**; the numbered sections go
deep on each pillar.

---

## The core idea

Five design decisions define the whole app — everything else follows from them:

1. **A layer, not a replacement.** NodeVelo never re-skins Intervals.icu's charts. It adds the
   coaching judgement on top — analysis, learning, generation — and defers to Intervals.icu as the
   source of truth for physiology. *(§1, §4)*

2. **Deterministic core, generative shell.** All the math — scoring, zones, load, nutrition,
   readiness — is plain, unit-tested TypeScript. The LLM only does language: it phrases plans and
   analysis from numbers the code already computed. **The AI never owns arithmetic or physiological
   limits**, so it cannot hallucinate your FTP or invent a calorie target. *(§3, "Nutrition is code")*

3. **Two kinds of memory, treated oppositely.** *Owned intent* (goals, weak points, notes — what
   only you know) is hand-written and never recomputed. *Synced physiology* (FTP, zones, weight,
   fitness — what Intervals.icu measures) is a one-way pull and never hand-edited. Conflating the
   two is the classic coaching-app bug; here the split is enforced structurally. *(§2)*

4. **An immutable execution ledger.** Every ride is scored once, against the FTP that was live that
   day, then frozen. The coach learns from this append-only history (recency-weighted), so trends
   reflect *real adaptation* — not a moving FTP denominator quietly rewriting the past. *(§3, §4)*

5. **Local-first, single-user.** Persistence is plain JSON (`data/`) and markdown
   (`knowledge-base/`) on your machine — the filesystem *is* the database. No accounts, no cloud DB,
   no multi-tenant surface. A deliberate constraint, not a missing feature (see ROADMAP "Decided
   against"). *(§1)*

## Documentation map

| File | What it's for |
|---|---|
| `README.md` (this) | How the app works — the architectural manual |
| [FEATURES.md](FEATURES.md) | Capability catalogue — what the app can do, by area |
| [ROADMAP.md](ROADMAP.md) | Forward backlog: what's next, prioritized |
| [ARCHIVE.md](ARCHIVE.md) | Completed work, grouped by theme |
| [research.md](research.md) | Exploratory spikes — findings, not build commitments |
| [todo.md](todo.md) | Lean live punch-list for incoming bugs / feedback |
| `AGENTS.md` · `CLAUDE.md` | Operating constraints for AI coding agents |

---

## Setup

```bash
cp .env.local.example .env.local   # fill in the three keys below
npm install
npm run dev                        # http://localhost:3000  (redirects to /today)
```

| Variable | Source |
|---|---|
| `INTERVALS_API_KEY` | Intervals.icu → Settings → Developer |
| `INTERVALS_ATHLETE_ID` | Your athlete id, format `i12345` (visible in Intervals.icu URLs) |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |

> **Local-first by design.** All persistence is plain JSON under `data/` and markdown under
> `knowledge-base/`. The filesystem _is_ the database. This will **not** run on an ephemeral
> serverless filesystem (e.g. Vercel) — run it locally with `npm run dev`, or
> `npm run build && npm start`.

> **Stack note for new contributors.** This is Next.js 16 (App Router) / React 19 /
> TypeScript / Tailwind v4. APIs and conventions differ from older Next.js — see `AGENTS.md`
> and read the bundled guides in `node_modules/next/dist/docs/` before changing routing or
> server/client boundaries.

---

## 1. Internal architecture

NodeVelo is a layered, local-first Next.js app. External data enters through a single API
client, is reconciled and cached as JSON, derived into analytical artifacts, and surfaced to
the UI through one React context. Nothing in the UI talks to Intervals.icu directly.

```
                          ┌─────────────────────────────────────────┐
   Intervals.icu  ──────► │  lib/intervals-api.ts  (the ONLY caller) │
   (system of record)     │  activities · wellness · power curve     │
                          │  sport-settings (FTP/zones) · intervals  │
                          └───────────────────┬─────────────────────┘
                                              │  POST /api/sync  (write path)
                                              ▼
        ┌───────────────────────────────────────────────────────────────────┐
        │  Server route handlers (app/api/*)                                  │
        │  reconcile physiology · re-bucket zones · score rides · run Claude  │
        └───────────────────┬───────────────────────────────────────────────┘
                            │  reads/writes
                            ▼
        ┌───────────────────────────────────────────────────────────────────┐
        │  Local JSON stores (data/*.json) — the persistence layer            │
        │  cached raw sync · physiology · current block · score ledger · …    │
        └───────────────────┬───────────────────────────────────────────────┘
                            │  GET /api/sync, /api/trends, /api/profile …
                            ▼
        ┌───────────────────────────────────────────────────────────────────┐
        │  components/SyncProvider.tsx  (single React context)                │
        │  owns AppState + doSync(); the nav rail and every page read it       │
        └───────────────────┬───────────────────────────────────────────────┘
                            ▼
                Today · Plan · Trends · Profile · Knowledge · Settings
```

**Read vs. write contract.** `GET /api/sync` is pure — it returns the cached app state and
**never** hits Intervals.icu. `POST /api/sync` is the only path that fetches from
Intervals.icu, reconciles physiology, re-derives analytics, and persists. This keeps page
loads instant and makes every network call explicit and user-triggered (or gated by the
`autoSyncOnOpen` setting).

### Persistence layer (`data/*.json`)

All file IO is centralized in `lib/data-store.ts` (plus `lib/physiology.ts` for the physiology
store). Each file has one responsibility:

| File | Owner module | Contents |
|---|---|---|
| `athlete.json` | data-store | Nutrition settings + non-synced profile defaults |
| `physiology.json` | physiology | **Source of truth** for FTP, zones, threshold/max HR — effective-dated |
| `last-sync.json` | data-store | Cached raw Intervals.icu pull (~6-month / 182-day window) |
| `current-block.json` | data-store | The active training block (frozen prescriptions) |
| `score-log.json` | data-store | Immutable per-ride execution ledger (the learning corpus) |
| `dispositions.json` | data-store | Athlete attribution per session (completed/partial/compromised) — only `compromised` changes scoring |
| `intervention-log.json` | data-store | Coaching directives fired per block + their validated/refuted outcomes |
| `compliance-memory.json` | data-store | Rolling per-workout-type compliance |
| `rolling-baselines.json` | data-store | 90-day baselines (CTL, decoupling, cadence, TSS) |
| `today-analysis.json` | data-store | Latest ride analysis + coach note + interval comparison + power PRs |
| `block-history.json` | data-store | Completed blocks + retrospectives |
| `block-settings.json` | data-store | Volume/structure knobs + platform toggles |

### Sync window & recency

A full sync pulls **182 days (~6 months)** of activities and wellness. That depth is
deliberate: CTL has a 42-day time constant (so a fitness *trajectory* needs months to read),
the rolling baselines are genuinely 90-day, and the second brain gets several blocks of history
to learn from. It is also cheap — the wider window is just a larger JSON list, **not** more
requests: per-activity stream fetches happen only for *today's* ride. To keep generation
anchored to current form, the "last 8 weeks" summary in the prompt is scoped to the most recent
56 days even though the cache holds six months.

---

## 2. The "second brain": owned intent vs. synced physiology

The core principle is a strict split between **two kinds of memory**, treated oppositely:

| | **Durable intent** (manual) | **Synced physiology** (computed) |
|---|---|---|
| Examples | goals, weakpoints, personal data, all-time PRs, coaching notes | FTP, power/HR zones, weight, CTL/ATL/TSB |
| Owner | the athlete | Intervals.icu (one-way pull) |
| Home | `knowledge-base/athlete_profile.md` | `data/physiology.json` |
| Nature | slow-changing, non-computable | time-varying, must be effective-dated |
| Rule | the **only** thing typed by hand | never hand-edited; always reconciled to source |

### Knowledge base (`knowledge-base/*.md`)

Markdown files are read fresh on every generation (never cached in memory), so edits apply to
the very next block. `lib/kb-loader.ts` concatenates them into the prompt context.

- `cycling_database.md`, `training_knowledge.md`, `nutrition_knowledge.md` — reference
  knowledge (training science, fueling), injected verbatim into generation.
- `athlete_profile.md` — **manual input only.** Personal data, all-time power PRs, weakpoints,
  goals, and coaching notes. FTP, zones, weight and the rolling power curve are *not* stored
  here — the file header and the in-app Knowledge editor both flag this explicitly so a new
  editor never confuses what is synced from where.
- `block-retrospectives/` — one markdown file per completed block. Not injected wholesale; only
  the latest file's `next_block_seeds:` list flows into the next generation.

### Ingesting non-computable data

`parseAthleteMd()` extracts the structured tables (goals, weakpoints, PRs) from
`athlete_profile.md`. These feed two places: the prompt's `BLOCK PARAMETERS` /
knowledge-base context, and the Profile UI. Because they are intent (not measurements), they
are never reconciled or recomputed — they change only when the athlete edits the file.

---

## 3. Coaching intelligence & trend analysis

The coach learns from an **immutable execution ledger** and turns it into directives that shape
future blocks. The pipeline is fully deterministic except for the final natural-language step.

```
   ride synced ──► computeExecutionScore() ──► RideScoreEntry{ …, ftpUsed }
   (1–10, no AI)    interval adherence | duration         │
                    + IF + decoupling + RPE + pacing       │ append-only, immutable
                                                            ▼
                                          score-log.json  (per-ride ledger)
                                                            │
                                  buildAthleteModel()  ◄────┘
                                  EWMA per workout type (α=0.35) + split-half trend
                                                            │
                                  deriveInsights()  ─────────► Insight[]  (alert/watch/good)
                                                            │
                  synthesizeCoachingDirectives() ───────────► injected into generation
```

### Execution scoring (`lib/execution-score.ts`)

Each completed ride that matches a planned day is scored 1–10. On interval days, **power-target
adherence** (`lib/interval-match.ts`, comparing the prescription against the intervals curated
in Intervals.icu) is the primary signal; on steady rides, duration compliance is used instead.
Intensity appropriateness, aerobic decoupling, RPE-vs-intensity, and pacing (variability index)
adjust the score. No AI is involved.

The interval matcher is deliberately defensive about detection noise:

- **Adherence reads average watts, not NP.** Normalized power overstates short/variable efforts
  by 20%+; average power is what the athlete actually held, so it's the honest adherence number.
  (NP is still used to *filter* warm-up/recovery laps out of the work band.)
- **Duration-aware completion.** A rep nailed on watts but cut short is not a full rep — only
  reps that held ≥90% of the prescribed duration count as "completed."
- **Structural-mismatch guard.** When every rep ran ~half its prescribed length yet power was
  on target and the rep count matched, that's a plan-definition-vs-detection mismatch (e.g. a
  SIT day stored as 1-min reps but ridden as 30s) — *not* a bail. Scoring drops the untrustworthy
  duration penalty and falls back to power + decoupling, and the UI explains why.
- **Extras.** Work efforts beyond the prescribed count (a mid-ride added interval) are surfaced
  as bonus context rather than silently dropped.

### Breakthrough (power-PR) recognition (`lib/pr.ts`)

On each sync, the freshly-synced power curve is compared against the curve as it stood on the
**previous sync**, per standard duration (5/15/30 s, 1/5/20 min). A duration that rose is a genuine
new best — the only new data since last sync is the latest ride — and the delta is the true watts
gained. Both sides use Intervals.icu's own curve math, so there's no stream-mean-max-vs-curve
mismatch (that had manufactured fake "+1 W" PRs). New PRs are stored on `today-analysis.json`, fed
to the coach note (told to call out a breakthrough first), and shown as a 🏆 banner on the Today
card with the gain over the prior best.

### The athlete model (`lib/athlete-model.ts`)

`buildAthleteModel()` reduces the ledger to a recency-weighted profile per workout type:

- **EWMA (α = 0.35)** of execution and compliance — recent rides dominate, so the model adapts.
- **Trend detection** — a split-half mean comparison with an epsilon band classifies each type
  `up` / `down` / `flat`. A minimum of 3 observations is required before any pattern fires.

`deriveInsights()` translates the model into ranked, actionable observations
(`alert` / `watch` / `good`) — e.g. "VO2max is a weak point: execution averaging 4.8/10 across
5 sessions → ease the prescription and progress gradually." `synthesizeCoachingDirectives()`
(`lib/synthesis.ts`) ranks these into a single directive block injected into the generation
prompt, so the next block concretely responds to where the athlete is under- or over-performing.
Directives are snapshotted at block-write time (`lib/intervention.ts`) and later marked
**validated** or **refuted** once enough time has passed to judge whether acting on each insight
actually worked — closing the learning loop.

### Readiness & polarization (`lib/readiness.ts`)

Computed at sync time and surfaced on the Today/Trends views. HRV is **excluded by default** — there's
no overnight HRV source in the loop, so it must not move readiness until one exists. The suppression
check is retained in code and opt-in (`computeReadiness(..., { useHrv: true })`), ready to switch on
once an overnight strap is worn:

- **ACWR** — acute (7-day) vs. chronic (28-day) average daily TSS; banded
  `low / optimal / high / danger` (sweet spot ≈ 0.8–1.3, danger > 1.5).
- **Intensity distribution** — share of time `easy (<0.75 IF) / moderate / hard (>0.90 IF)`,
  the polarization check.
- **TSB / fitness** — CTL, ATL, and form pulled from Intervals.icu wellness.

ACWR and TSB carry in-app tooltips (what they are, the calc basis, and the good/concerning bands)
so the numbers are self-explanatory.

### Session disposition (`lib/disposition.ts`, `data/dispositions.json`)

The one thing the system can't infer is *why* a session went how it did. The athlete attributes
each session — **completed / partial / compromised** — on the ride card. Only `compromised`
(equipment, sickness, weather) changes anything: the ride stays in the ledger as history but is
excluded from the execution metric and the learning model, so a fluke can't be misread as
under-recovery. This attribution flows to the Plan calendar, which distinguishes a *compromised*
ride (ridden, excluded from scoring) from a genuinely *missed* day rather than conflating them,
and labels a *partial* session for what it was instead of a flat "completed."

---

## 4. Data sync & reconciliation — the single source of truth

**Intervals.icu is authoritative for physiology; the athlete is authoritative for intent.**
NodeVelo never writes FTP or zones back to Intervals.icu — physiology is a one-way pull. The
challenge is that FTP and zones change over time, so the system **effective-dates** them and
anchors every historical analysis to the values that were live when each ride happened.

### The physiology store (`lib/physiology.ts`, `data/physiology.json`)

```
PhysiologyStore {
  current: PhysiologySnapshot          // the FTP/zones in effect now
  history: PhysiologySnapshot[]        // superseded snapshots, each with its own effectiveFrom
}
```

Zones are stored the way Intervals.icu models them — **power zones as % of FTP**, HR zones as
raw bounds — and resolved to absolute watts/bpm on demand (`resolvePowerZones`/`resolveHrZones`).
A single FTP change therefore updates every zone coherently; drift between the FTP scalar and
the zone table is structurally impossible.

### Discrepancy detection & reconciliation

On each `POST /api/sync`:

1. `fetchSportSettings()` pulls the current Ride sport-settings (FTP, `power_zones`, `lthr`,
   `max_hr`, `hr_zones`) from `/athlete/{id}/sport-settings`.
2. `reconcile(prev, incoming, today)` compares it to the stored `current`:
   - **No change** → keep the existing `effectiveFrom` (just refresh metadata).
   - **FTP or zones changed** → archive the old snapshot into `history` and start the incoming
     one effective today. This is the discrepancy the athlete sees as
     *"FTP changed 288 → 300W on 2026-06-10 — zones updated automatically."*

```
   Intervals.icu sport-settings ─► reconcile() ─► physiology.json
        FTP 300, zones %                │
                                        ├─ unchanged ─► keep effectiveFrom
                                        └─ changed   ─► archive old, current.effectiveFrom = today
```

### Anchoring history to the right physiology

`physiologyAsOf(store, date)` returns the snapshot in effect on a given ride date (dates before
the earliest snapshot anchor to the earliest). Two consequences keep the coaching model honest:

- **Coach analysis (today's ride)** is judged against `current` — today's fitness.
- **The score ledger is immutable.** `buildRideScores()` anchors each ride to the FTP that was live
  when it happened — preferring the ride's own `icu_ftp` (Intervals.icu's own per-activity record of
  the FTP it applied, which is exact even when an FTP change wasn't synced for days) and falling back
  to `physiologyAsOf(rideDate)` when the activity carries none. `mergeScoreLog()` then freezes existing
  dates (fresh entries only fill new dates). A threshold ride logged at IF 0.94 stays 0.94 forever, even
  after an FTP bump — so trends reflect real adaptation, not a redefinition of the FTP denominator.

FTP-independent markers (Pw:HR / efficiency factor, decoupling, raw power-curve PRs) are the
backbone of long-term progression precisely because they survive FTP redefinition. The Pw:HR
trend (`lib/trends.ts`) is deliberately like-for-like: **outdoor** rides only (indoor/virtual
rides have a distorted power:HR from cardiac drift and ERG-flattened power), in the steady
endurance band, and ≥45 min. The fueling/weight graph aggregates **complete weeks only** — the
in-progress week's running totals are always misleadingly low, so it's dropped until it closes.

---

## 5. Streamlined block-creation workflow

The legacy workflow required hand-editing FTP and zone tables in `athlete_profile.md` before
generating. That is gone: physiology is synced and injected automatically, so block creation is
a minimal, utilitarian loop with no manual markdown step.

```
1. Sync        POST /api/sync → fresh activities + reconciled physiology + re-scored ledger
2. Configure   /plan → length (2/4 wk), start date, goal, weakpoints (pre-filled from profile)
3. Generate    POST /api/generate → assembles: knowledge base + live physiology zones + athlete-model
                 insights + retrospective seeds + CoachSnapshot form/fuel + Track-B session
                 requirements & durability template + deterministic nutrition table
                 → claude-sonnet-4-6 (structured tool-use) → validated PlannedDay[]
4. Preview     PlanPreview renders every day (workout steps + nutrition). Nothing is written yet.
5. Write       POST /api/write → each day POSTed to Intervals.icu; prescriptions parsed and
                 frozen into current-block.json (with the FTP used) as the active block.
```

The generator pulls the **latest** zones from the physiology store at generation time
(`resolvePowerZones`), so workout power targets are always calibrated to the current FTP without
anyone editing a file. Generation context is also enriched with the athlete-model insights and
the previous block's carry-forward seeds.

**KB-grounded protocol validation.** `lib/workout-validate.ts` checks every generated workout
against the knowledge base's interval protocols (SIT = 4–6 × 20–30 s all-out at 130–200% FTP;
VO2max = 3–8 min at 106–120%; threshold = 88–105%) and surfaces a warning if generation drifts
(e.g. SIT prescribed as 1-min efforts). The same protocols are stated as hard rules in the prompt,
so the guard works on both ends — generation *and* validation.

**Execution cues in descriptions.** Each generated day can carry a one-line `Execution` cue
grounded in the KB and the athlete's weakpoints — e.g. govern long hilly Z2 by the HR ceiling
rather than watts (grey-zone drift is a known leak), stay seated for sprints, or use descents as
deliberate cornering practice.

---

## Pages & API routes

| Page | Purpose |
|---|---|
| `/today` (default) | Fused athlete-state + readiness tiles (CTL/ATL/TSB, ACWR, polarization), proactive morning check-in, today's session & fuel, smoothed power trace, PR trophy banner, trend pulse, coach note, ask-coach spot-check |
| `/plan` | Active block calendar, collapsible block generator + preview, goals vs. this week, history |
| `/trends` | Last-7-day snapshot, learned insights, paired graphs (Pw:HR ‖ CTL, execution ‖ compliance), fueling & weight, block history |
| `/profile` | Synced performance (FTP, threshold/max HR), all-time PRs, goals, weakpoints, nutrition settings |
| `/knowledge` | In-place markdown editor for the knowledge base + retrospectives |
| `/settings` | Volume/structure knobs, training philosophy, platform toggles |

| Route | Method | Role |
|---|---|---|
| `/api/sync` | GET / POST / DELETE | Read cached state / full sync + analysis / clear active block |
| `/api/generate` | POST | Assemble prompt → Claude → parsed plan (not yet written) |
| `/api/write` | POST | Write a generated block to Intervals.icu, set as active block |
| `/api/trends` | GET | Long-term derived analytics + learned insights |
| `/api/profile` | GET / PUT | Profile snapshot (physiology projected) / save nutrition settings |
| `/api/knowledge` | GET / PUT | List & edit knowledge-base / retrospective files |
| `/api/settings` | GET / PUT | Block-generation settings + platform toggles |
| `/api/ask` | POST | Low-token "ask coach" spot-check — reads the resolved CoachSnapshot (block, today's execution, form + TSB modifier, fuel, directives, morning check, disposition) + the next planned session; not the full ledger |
| `/api/disposition` | GET / POST | Read/set a session's athlete attribution (completed/partial/compromised); re-stamps the ledger immediately |
| `/api/morning-check` | GET / POST / PUT | Proactive check-in: UI state / submit + deterministic decision / apply the downgrade + reschedule |
| `/api/retrospective`, `/api/history`, `/api/note`, `/api/reschedule` | — | Block retro generation, block history, manual note write-back, auto-reschedule |

---

## Module map (`lib/`)

| Module | Responsibility |
|---|---|
| `intervals-api.ts` | The only Intervals.icu HTTP client (reads + write-back) |
| `physiology.ts` | Physiology store: parse sport-settings, resolve zones, effective-dating, reconcile |
| `data-store.ts` | All other JSON persistence; overlays physiology onto the profile |
| `anthropic-api.ts` | Prompt assembly + Claude calls (always `claude-sonnet-4-6`) |
| `plan-schema.ts` | Structured tool-use schema → validated `PlannedDay[]` |
| `plan-parser.ts` | `planDayToEvent`: a `PlannedDay` → an Intervals.icu event payload |
| `prescription.ts` | Parse workout syntax into structured target intervals |
| `workout-validate.ts` | KB-grounded protocol validation of generated workouts (SIT/VO2max/threshold bands) |
| `interval-match.ts` | Prescription vs. executed-interval adherence (avg-watts, duration-aware, structural-mismatch + extras) |
| `execution-score.ts` | Deterministic 1–10 ride quality score |
| `score-log.ts` | Build + immutably merge the per-ride execution ledger |
| `disposition.ts` | Apply athlete session attributions (compromised excluded from metrics) onto the ledger |
| `ride-classify.ts` | Infer a ride's workout type from its intensity/structure |
| `pr.ts` | Power-PR detection — freshly-synced curve vs the previous sync's curve |
| `athlete-model.ts` | EWMA model + trend detection + insight derivation |
| `synthesis.ts` | Rank model insights into one coaching-directive block for generation |
| `intervention.ts` | Snapshot directives at block-write, validate/refute them after maturity |
| `calibration.ts` | Auto-tuned EWMA alpha + ACWR bands |
| `readiness.ts` | ACWR, intensity distribution, fatigue/load-ramp signals |
| `reschedule.ts` | Reschedule missed/compromised quality sessions (reactive) + proactive downgrade/swap onto a rest-or-easy day |
| `athlete-state.ts` | §5 signal fusion: one 0–100 athlete-state score + drivers from the fused signals |
| `coach-snapshot.ts` | Resolved-numbers bundle fed to Ask-Coach + generation so the LLM can't invent figures (#1) |
| `morning-check.ts` | Proactive check-in decision — subjective strain + objective form → proceed/downgrade (#3) |
| `session-requirements.ts` | Goal/weakpoint → required session types (terrain/race ⇒ RaceSim), injected + validated (Track B) |
| `durability.ts` | Durability template taxonomy (A–E) + deterministic, limiter-driven/rotated selection (Track B) |
| `zones.ts` | Re-bucket power/HR streams into the athlete's own zones |
| `nutrition.ts` | Deterministic calorie/carb/protein formula |
| `kb-loader.ts` | Knowledge-base + retrospective IO and parsing |
| `trends.ts` | Trends time-series transforms (outdoor-only Pw:HR, complete-week energy) |
| `trace.ts` | Downsampled + 30s-smoothed ride streams + interval bands for the power chart |

---

## Nutrition is code, not AI

`lib/nutrition.ts` deterministically computes daily targets (base + session kJ + buffer; flat
target on rest days) plus pre/in/post-ride carbs and protein. The buffer self-adjusts ±150 kcal
against the synced 7-day weight trend (capped 0–600). The AI receives these as a reference table
and only phrases them in natural language — it never calculates nutrition.

---

## Development

```bash
npm test       # vitest (252 tests across 33 suites: physiology, scoring, interval match, athlete model, interventions, nutrition, plan schema, trends, PR detection, trace, coach-snapshot, morning-check, durability, session-requirements, …)
npm run lint
npm run build
```

- **Tests are the contract for the deterministic core.** Pure logic (physiology
  parse/resolve/reconcile, execution scoring, the athlete model, nutrition, plan parsing) is
  unit-tested; keep new pure logic testable and covered.
- **Verification loop for changes:** `npx tsc --noEmit && npm run build && npm test`.
