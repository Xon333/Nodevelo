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
| [DESIGN.md](DESIGN.md) | Design source of truth — tokens, type ladder, per-page hierarchy |
| [UX-CONSTITUTION.md](UX-CONSTITUTION.md) | UX decision rules (verdict hierarchy, trust/provenance, disclosure limits) — governs UX-MASTERPLAN.md |
| [UX-MASTERPLAN.md](UX-MASTERPLAN.md) | Evidence-ranked UX audit + backlog, sequenced into waves (all 5 waves shipped) |
| `AGENTS.md` · `CLAUDE.md` | Operating constraints for AI coding agents |
| [WORKFLOW.md](WORKFLOW.md) | Personal cheat sheet — daily commands, session workflow |
| `CONTINUE.md` | Session-handoff note — written only via `/handoff`, read to resume; may lag reality between handoffs |

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

> **Bound to localhost — there is no auth.** `npm run dev`/`npm start` bind `127.0.0.1` only: this
> app has no login (single-user, local-first by design), and its routes spend Anthropic credits
> (`/api/generate`) and can overwrite the athlete's data (`/api/import`) or Intervals.icu calendar
> (`/api/write`), so leaving it open on `0.0.0.0` would let any device on the same network drive-by
> those routes with plain `curl`. `npm run dev:lan` opts back into LAN access (e.g. to check the app
> from a phone) — only run it on a network you trust.

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
| `athlete.json` | data-store | Nutrition settings + non-synced profile defaults + `goals`/`weakpoints` (structured, editable on `/profile`) |
| `season-plan.json` | data-store | `SeasonPlan`: athlete's objective + target events + the macro-periodization engine's derived focus periods (see "Season & macro-periodization" below) |
| `physiology.json` | physiology | **Source of truth** for FTP, zones, threshold/max HR — effective-dated |
| `last-sync.json` | data-store | Cached raw Intervals.icu pull (~6-month / 182-day window) |
| `current-block.json` | data-store | The active training block (frozen prescriptions) |
| `score-log.json` | data-store | Immutable per-ride execution ledger (the learning corpus) |
| `dispositions.json` | data-store | Athlete attribution per session (completed/partial/compromised) — only `compromised` changes scoring |
| `intervention-log.json` | data-store | Coaching directives fired per block + their validated/refuted outcomes |
| `rolling-baselines.json` | data-store | 90-day baselines (CTL, decoupling, cadence, TSS) |
| `today-analysis.json` | data-store | Latest ride analysis + coach note + interval comparison + power PRs |
| `block-history.json` | data-store | Completed blocks + retrospectives |
| `block-settings.json` | data-store | Volume/structure knobs + platform toggles |
| `calibration.json` | data-store | Per-athlete `CalibratedParameter`s (value/source/confidence/lock/override) — ROADMAP #2 |
| `athlete-quirks.json` | data-store | Recurring patterns extracted from ride/coach notes (e.g. "cramp", "indoor aversion"), frequency-ranked |
| `morning-check.json` | data-store | Log of proactive pre-session check-in decisions (proceed/downgrade) |
| `loading-log.json` | data-store | Athlete's day-before loading attributions per durability ride |
| `ledger-rebuild.json` | data-store | One-shot marker guarding the opt-in score-log rebuild (never re-runs automatically) |
| `ai-usage.json` | ai-usage | Best-effort Anthropic token/cost telemetry per call site — regenerable, no `.bak` |

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
| Examples | goals, weakpoints, season objective/events, personal data, all-time PRs, coaching notes | FTP, power/HR zones, weight, CTL/ATL/TSB |
| Owner | the athlete | Intervals.icu (one-way pull) |
| Home | `data/athlete.json` (goals/weakpoints) · `data/season-plan.json` (objective/events) · `knowledge-base/athlete_profile.md` (PRs, notes) | `data/physiology.json` |
| Edited via | `/profile` forms (add/edit/delete) | never hand-edited; always reconciled to source |
| Nature | slow-changing, non-computable | time-varying, must be effective-dated |
| Rule | the **only** thing typed by hand | never hand-edited; always reconciled to source |

Goals/weakpoints used to live only in hand-edited `athlete_profile.md` tables — that's gone. They're
now structured `AthleteProfile.goals`/`weakpoints` (`{goal, target, focus}` / `{weakpoint, detail}`),
edited through a real add/edit/delete form on `/profile`, with a one-time migration that seeded them
from whatever was in the markdown file the first time this shipped. `focus` (a `SeasonFocus` tag or
`"general"`) is what lets the block generator narrow the goal pre-fill to the season's current focus
(see "Season & macro-periodization" below).

### Knowledge base (`knowledge-base/*.md`)

Markdown files are read fresh on every generation (never cached in memory), so edits apply to
the very next block. `lib/kb-loader.ts` concatenates them into the prompt context.

- `cycling_database.md`, `training_knowledge.md`, `nutrition_knowledge.md` — reference
  knowledge (training science, fueling), injected verbatim into generation.
- `athlete_profile.md` — **manual input only.** Personal data, all-time power PRs, and coaching
  notes. Goals and weakpoints used to live here too but are now edited on `/profile` (above) —
  this file's GOALS/WEAKPOINTS tables are stripped before the prompt sees them
  (`stripGoalsWeakpointsSections`) so a stale markdown copy can never leak alongside the live
  JSON data. FTP, zones, weight and the rolling power curve are *not* stored here — the file
  header flags this explicitly so a new editor never confuses what is synced from where.
- `block-retrospectives/` — one markdown file per completed block. Not injected wholesale; only
  the latest file's `next_block_seeds:` list flows into the next generation.

### Ingesting non-computable data

`parseAthleteMd()` extracts the remaining structured tables (all-time PRs) from
`athlete_profile.md`. Goals/weakpoints are no longer parsed from markdown at read time — they live
in `athlete.json`, injected into generation as `goalsContext`/`weakpointsContext`
(`app/api/generate/route.ts`) and read straight from `/api/profile` by the Profile form. Because
they are intent (not measurements), none of this is ever reconciled or recomputed — it changes only
when the athlete edits it.

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

Ledger entries for planned interval days are now born interval-aware too, not just the ephemeral
"today" analysis. On sync, a bounded birth-time fetch (capped at 6 dates, newest first; best-effort —
any per-date failure falls back silently to coarse whole-ride scoring) picks up rides that synced a
day or more late, so a Threshold/VO2max/SIT/RaceSim day isn't frozen coarse forever just because the
athlete didn't sync same-day. The adherence signal that scored an entry is frozen onto it
(`RideScoreEntry.intervals`), so a later ledger rebuild can re-score from the frozen stamp without
re-fetching. The durability exception stands: Track B templates (B–E) and Z2/Recovery days are still
graded by their own system and never reach this path.

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
NodeVelo never writes FTP or zones back to Intervals.icu — physiology is a one-way pull. Planned-
workout calendar events are a separate concern: since §7's reschedule/calendar-mirror slice, every
app-initiated move (manual, reactive make-up, proactive downgrade/swap) mirrors outbound to the
athlete's real Intervals.icu calendar, and calendar-side moves reconcile inbound at sync time
(`lib/calendar-mirror.ts`) — physiology itself stays strictly one-way; the two sync directions are
never conflated. The challenge is that FTP and zones change over time, so the system
**effective-dates** them and anchors every historical analysis to the values that were live when
each ride happened.

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

## 5. Season & macro-periodization

Below the block sits one more layer: **Season** is the general "why" (the objective, target events,
and a rolling macrocycle of focus periods); **Block** is the specific "what" (2–8 weeks of prescribed
sessions), now generated *informed by* the season rather than in isolation.

```ts
SeasonPlan { objective: string; events: SeasonEvent[]; periods: FocusPeriod[]; updatedAt }
FocusPeriod {
  focus: SeasonFocus;        // aerobic-base | threshold | vo2max | anaerobic | durability | sharpen
  phase: "base" | "build" | "peak" | "taper";
  startDate: string; plannedWeeks: number; deloadWeek: boolean;
  intensitySplit: string; targetWeeklyTss: number | null; rationale: string;
  source: "derived" | "override"; confidence: "low" | "medium" | "high";
}
```

`lib/season.ts` runs two macro-periodization modes, chosen by whether the athlete has a future
A/B/C-priority event on their season:

- **Mode C — rolling cycle (the live default).** No event on the calendar → a repeating
  base→build→realize cycle (`replanSeasonArc`), with deload cadence and an ACWR-capped load ramp
  between periods. This is what runs today for every athlete without a race entered.
- **Event-anchored mode (built, dormant).** A future event schedules *backward* from its date —
  taper → peak → build. Fully built and tested, but nothing writes a `SeasonEvent` until the
  athlete adds one on `/profile`'s Season section (objective field + add/edit/delete event list,
  `PUT /api/season`) — it activates automatically the moment a future A-event exists.

**Feeding the block generator.** `POST /api/generate` re-plans the arc (`replanSeasonArc` +
`validateSeasonFit`) and folds a one-line `SEASON CONTEXT` (objective + phase + focus + week-of +
rationale, `formatSeasonContext`) into the prompt. On `/plan`, `suggestedBlockWeeks` pre-fills the
generator's length selector (now **2/4/6/8** weeks, not just 2/4) by ceiling-rounding the current
period's remaining weeks; `filterGoalsByFocus` narrows the goal textarea pre-fill to goals tagged
with the period's current focus plus every `"general"`-tagged goal — both are pre-fills the athlete
can still freely override before generating, never locked.

**Block-completion prompt.** Once a block's `endDate` has passed, `/today`'s planned-session card
proactively nudges the athlete to generate the next one (`isBlockFinished`, a pure date check) —
instead of silently sitting on stale "no session planned" copy until they happen to notice.

---

## 6. Streamlined block-creation workflow

The legacy workflow required hand-editing FTP and zone tables in `athlete_profile.md` before
generating. That is gone: physiology is synced and injected automatically, so block creation is
a minimal, utilitarian loop with no manual markdown step.

```
1. Sync        POST /api/sync → fresh activities + reconciled physiology + re-scored ledger
2. Configure   /plan → length (2/4/6/8 wk, pre-filled from the season's current period), start date,
                 goal (focus-filtered from profile), weakpoints — all pre-filled but freely overridable
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
| `/today` (default) | Auto-switches on whether a synced ride matches today's local date — never an athlete-picked tab. **Pre-ride:** readiness verdict + a promoted session-prescription card (name/type/duration/full prescription) + inline morning check-in. **Post-ride:** compressed one-line verdict strip + a debrief hero (execution score, planned-vs-actual, IF/NP/avg, a ≤3-sentence coach takeaway with the full note behind a disclosure) + an "Eat today" fuel card. TrendPulse and the old viewport-lock scrolling are gone; the page scrolls naturally |
| `/plan` | Active-block hero: week orientation (week N of M + a volume-derived week "character," honestly disclosed as not real per-week periodization) + an in-hero week strip (hours vs. target · load · top session, replacing the old standalone "This week" panel) + a "next session" pointer — alongside the calendar, collapsible block generator, and season card |
| `/trends` | Verdict-first: fold-1 is a one-sentence three-axis verdict (engine/delivery/fueling, each with a derivation tip) + ranked coach insights. Below it, four named groups — ENGINE, DELIVERY (execution bars and planned-vs-actual merged into one toggled card), LOAD & FUEL, MILESTONES — replace the old flat pile of 9 equal sections |
| `/profile` | Read-first dossier: the rider read (power curve/phenotype/current-performance/synced weight), zones & effort bands, goals & weakpoints, nutrition formula. Goals and nutrition show a compact read view with the edit form behind an inline disclosure, never visible until opened. Season objective/events moved to `/plan` |
| `/model` | Three stacked groups: NOW (fused-state ranked drivers as signed magnitude bars), LEARNED (per-athlete calibration, one card per parameter with provenance/confidence/contest-correct override), STANDING GUIDANCE (directives rendered from their structured source, grouped by dimension, evidence behind a "why" disclosure, validated/proven-poor track marks) — replacing the old single synthesized text blob |
| `/settings` | Two labeled groups: GENERATION (weekly volume targets, weekly structure, training philosophy) and PLATFORM (platform behavior toggles, AI usage & cost, backup & restore) — platform behavior no longer mis-grouped under GENERATION |
| `/knowledge` | In-place markdown editor for the knowledge base + retrospectives, now with a one-line always-visible provenance header above the file list (which files feed generation vs. reference-only vs. manual vs. seed) |

| Route | Method | Role |
|---|---|---|
| `/api/sync` | GET / POST / DELETE | Read cached state / full sync + analysis / clear active block |
| `/api/generate` | POST | Assemble prompt → Claude → parsed plan (not yet written) |
| `/api/write` | POST | Write a generated block to Intervals.icu, set as active block |
| `/api/trends` | GET | Long-term derived analytics + learned insights |
| `/api/profile` | GET / PUT | Profile snapshot (physiology projected, goals/weakpoints) / save nutrition settings and/or goals/weakpoints |
| `/api/season` | GET / PUT | Read the season plan / update the athlete's objective + target events |
| `/api/calibration` | GET / POST | Read calibrated parameters / set or clear a manual override (e.g. `decouplingGood`) |
| `/api/knowledge` | GET / PUT | List & edit knowledge-base / retrospective files |
| `/api/settings` | GET / PUT | Block-generation settings + platform toggles |
| `/api/ask` | POST | Low-token "ask coach" spot-check — reads the resolved CoachSnapshot (block, today's execution, form + TSB modifier, fuel, directives, morning check, disposition) + the next planned session; not the full ledger |
| `/api/analyze` | POST | Generate (or force-regenerate) today's AI coach note — deferred out of `/api/sync` so the fast deterministic path isn't blocked on the LLM |
| `/api/disposition` | GET / POST | Read/set a session's athlete attribution (completed/partial/compromised); re-stamps the ledger immediately |
| `/api/export` / `/api/import` | GET / POST | Download a full `data/` + `knowledge-base/` backup bundle / restore one (path-traversal-guarded, self-identifying) |
| `/api/morning-check` | GET / POST / PUT | Proactive check-in: UI state / submit + deterministic decision / apply the downgrade + reschedule |
| `/api/reschedule` | GET / POST / PUT | Reactive suggestion / confirm the make-up move / manual move (§7) — all three mirror to Intervals.icu |
| `/api/retrospective`, `/api/history`, `/api/note` | — | Block retro generation, block history, manual note write-back |

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
| `score-log.ts` | Build + immutably merge the per-ride execution ledger + interval-adherence stamps at birth |
| `disposition.ts` | Apply athlete session attributions (compromised excluded from metrics) onto the ledger |
| `ride-classify.ts` | Infer a ride's workout type from its intensity/structure |
| `pr.ts` | Power-PR detection — freshly-synced curve vs the previous sync's curve |
| `athlete-model.ts` | EWMA model + trend detection + insight derivation |
| `power-profile.ts` | Rider-type classification from the power-curve *shape* + "easy win" weak point (Track A) |
| `aerobic.ts` | Z2-isolated Pw:HR (`icu_power_hr_z2`) — intent-independent aerobic read vs the athlete's baseline |
| `durability-score.ts` | Grade a long ride against its durability template's expected signal (Track B) |
| `synthesis.ts` | Rank model insights into one coaching-directive block for generation |
| `intervention.ts` | Snapshot directives at block-write, validate/refute them after maturity |
| `correlation.ts` | Shared guarded-regression engine (`deriveExecutionEdge`) for auto-derived calibration edges (#2/Track C) |
| `calibration.ts` | Auto-tuned EWMA alpha + ACWR bands + per-athlete edge resolvers |
| `readiness.ts` | ACWR, intensity distribution, fatigue/load-ramp signals |
| `reschedule.ts` | Reschedule missed/compromised quality sessions (reactive) + proactive downgrade/swap onto a rest-or-easy day |
| `calendar-mirror.ts` | Bidirectional Intervals.icu calendar mirror (§7): outbound event payloads for every app-initiated move (manual/reactive/proactive) + inbound reconciliation of calendar-side moves at sync time |
| `athlete-state.ts` | §5 signal fusion: one 0–100 athlete-state score + drivers from the fused signals |
| `coach-snapshot.ts` | Resolved-numbers bundle fed to Ask-Coach + generation so the LLM can't invent figures (#1) |
| `morning-check.ts` | Proactive check-in decision — subjective strain + objective form → proceed/downgrade (#3) |
| `session-requirements.ts` | Goal/weakpoint → required session types (terrain/race ⇒ RaceSim), injected + validated (Track B) |
| `durability.ts` | Durability template taxonomy (A–E) + deterministic, limiter-driven/rotated selection (Track B) |
| `season.ts` | Macro-periodization engine (see "Season & macro-periodization" above): `replanSeasonArc`, `currentPeriod`/`formatSeasonContext`, `suggestedBlockWeeks`, `filterGoalsByFocus` |
| `plan-week-character.ts` | Derives the Plan hero's volume-derived per-week character label (no per-week phase exists in the data model) |
| `zones.ts` | Re-bucket power/HR streams into the athlete's own zones |
| `ride-analysis.ts` | Build today's analysis from a synced activity — metrics, IF, execution, trace (pure; route does IO) |
| `sync-analysis.ts` | The single LLM step of a sync (coach note), split out so `/api/sync` returns the deterministic analysis fast |
| `nutrition.ts` | Deterministic calorie/carb/protein formula + energy-availability proxy |
| `loading.ts` | Pre-ride loading loop: target, prompt, power-only effect assessment (Track C) |
| `kb-loader.ts` | Knowledge-base + retrospective IO and parsing |
| `trends.ts` | Trends time-series transforms (outdoor-only Pw:HR, complete-week energy) |
| `trends-verdict.ts` | Derives Trends' fold-1 three-axis verdict (engine/delivery/fueling) from existing signals |
| `trace.ts` | Downsampled + 30s-smoothed ride streams + interval bands for the power chart |
| `text.ts` | `splitLeadSentences`: truncates the Today coach note to its lead sentences (≤3-sentence-visible rule) |

---

## Nutrition is code, not AI

`lib/nutrition.ts` deterministically computes daily targets (base + session kJ + buffer; flat
target on rest days) plus pre/in/post-ride carbs and protein. The buffer self-adjusts ±150 kcal
against the synced 7-day weight trend (capped 0–600). The AI receives these as a reference table
and only phrases them in natural language — it never calculates nutrition. The weekly
intake-vs-need ratio (§6) is the same discipline applied to a full week: computed day-matched
against the app's own prescribed targets, and only ever phrased by the LLM, never calculated by it.

Same pattern extends to logging, not just targets: `lib/fuel-prompt.ts`'s `deriveFuelPrompt()` is a
pure, unit-tested decision — no LLM, no I/O — that runs once per sync against today's ride. On a
qualifying ride (≥90 min, or a Threshold/VO2max/SIT/RaceSim day) with no logged `carbsIngestedG`, it
nudges the athlete to log in-ride carbs (a logged `0` is a real "fasted" data point, not an omission,
so it never nudges). Once the athlete's own derived `carbsOptimum` is trustworthy (confidence medium
or high — never a population default masquerading as personalized), it instead surfaces the gap
between what they logged and that optimum. Deterministic thresholds, LLM only phrases: the prompt's
existence and copy are pure code, and the coach note may mention it in one sentence using the
pre-computed numbers verbatim — it never invents or recomputes them.

The pre-ride loading loop (`lib/loading.ts`) follows the same pattern: deterministic prescription (7 g/kg
day-before) plus athlete attribution; delivery-grade outcome (power-only), no HR proxy.

---

## Development

```bash
npm test       # vitest (877 tests across 74 suites: physiology, scoring, interval match, athlete model, interventions, nutrition, energy-availability, plan schema, trends, PR detection, trace, coach-snapshot, morning-check, durability, session-requirements, season, planned-vs-actual, fuel-prompt, trends verdict, week-character derivation, …)
npm run lint
npm run build
```

- **Tests are the contract for the deterministic core.** Pure logic (physiology
  parse/resolve/reconcile, execution scoring, the athlete model, nutrition, plan parsing) is
  unit-tested; keep new pure logic testable and covered.
- **Verification loop for changes:** `npx tsc --noEmit && npm run lint && npm run build && npm test`.
