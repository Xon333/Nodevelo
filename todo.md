# NodeVelo — live punch-list

Short-lived tracker for **incoming bugs and feedback** — things to action soon, not strategy.
Keep it lean: when an item ships, move its one-line record to [ARCHIVE.md](ARCHIVE.md).

- **What's next / strategy** → [ROADMAP.md](ROADMAP.md)
- **Completed work** → [ARCHIVE.md](ARCHIVE.md)
- **Research spikes** → [research.md](research.md)

**Legend** — Status: ☐ todo · ◑ partial · ☑ done · Priority: P1 correctness/data-integrity ·
P2 high-value UX/feature · P3 polish/education · Type: `bug` `ux` `feat` `audit` `edu`

---

## Open

**Post-2026-08-15 debrief audit (NV-1…NV-14).** External audit of the self-directed debrief path,
ground-truthed against live code + `data/*.json` on 2026-08-15 — **~93% accurate**, unusually high for
an external review. Every item below is code-confirmed; NV-5/NV-7 were routed narrower than claimed,
NV-3 was already a tracked deferral. NV-9/NV-10/NV-11/NV-13 shipped 2026-08-15 → [ARCHIVE.md](ARCHIVE.md).
NV-1/NV-4 shipped 2026-08-15 (PR #58) → [ARCHIVE.md](ARCHIVE.md). NV-2 shipped 2026-08-15 (PR #60) →
[ARCHIVE.md](ARCHIVE.md); its own residual gap (zone claims aren't terrain/phase-scoped) is now a
documented rough edge in [02-scoring-and-learning.md](docs/systems/02-scoring-and-learning.md#known-rough-edges),
live-confirmed the same day, not yet its own ticket.

- ☐ P2 `bug` **NV-3 — compound interval labels create false terrain matches.** `hasLabelHint` uses
  substring inclusion ([intent-scoring.ts:575](lib/intent-scoring.ts:575)) and label is the primary
  signal, bypassing the gradient floor — so `Rolling climb/descents` graded as a pure descent. Live
  proof: stored evidence `"15.9 min descent (labelled) — avg -0.6%, max 10.4%, VI 1.08"`. Already a
  documented deferral ([02-scoring-and-learning.md:160](docs/systems/02-scoring-and-learning.md:160),
  P3c Gap A) because the 25-payload gate found no trough-gradient field. **New angle that needs no new
  data:** a label matching *both* terrain vocabularies is compound by its own text — detect that
  deterministically and exclude it, which P3c's "compound exclusion does not apply to a labelled lap"
  decision never considered (it reasoned about a lap labelled plainly "Climb").
- ☐ P2 `feat` **NV-7 + NV-5 + NV-6 — evidence-bound prose and descending safety.** The prose prompt
  ([anthropic-prompts.ts:508](lib/anthropic-prompts.ts:508)) has no rule classifying a claim as
  measured / inferred / athlete-reported / not-measurable, and no safety constraint of any kind.
  Live proof 2026-08-15: `intervalComparison: null`, prompt carried only aggregate zones + whole-ride
  cadence + the raw note, yet the note asserted "the aero position discipline and constant-pressure
  approach are **clearly working** as a durability tool" — an athlete-reported *method* stated as a
  measured cause. (The audit's own cited example, "likely the puncher and some terrain", is actually
  hedged in the stored note — the aero sentence is the real defect.) Terrain/phase causality stays
  *inferred* unless timestamped segment evidence exists; posture and skill quality can never become
  *measured*. **NV-5 narrowed:** today's −2.9% decoupling was legitimately supplied (237/288 = 0.82,
  VI 1.058 → passes [aerobic.ts:116](lib/aerobic.ts:116)); the only gap is claim strength — one
  negative-decoupling result is a good on-the-day durability read, not proof of durable adaptation.
  **NV-6:** descending advice needs an explicit safety constraint — coasting and braking are correct
  in corners, traffic, poor surfaces and technical descents
  ([British Cycling descending guidance](https://www.britishcycling.org.uk/knowledge/training/article/izn20180117-Get-Started-Descending---Top-10-tips-0)),
  so a low coasting figure must never become unconditional "no coasting" advice.
- ☐ P2 `feat` **NV-14 — interval speed as evidence (never as a graded target).** `fetchIntervals`
  retains power/HR/cadence/gradient but maps no speed
  ([intervals-api.ts:192](lib/intervals-api.ts:192)), so a speed-at-power outcome can't be stated.
  **Verified 2026-08-15 that this does NOT reopen Phase 2c's locked decision**
  ([p2c plan:2079-2086](docs/superpowers/plans/2026-08-12-adaptive-coach-p2c-debrief-ui.md:2079)):
  that decision bans a distance/GPS *position-locator system*, while its bullet 4 admits "metrics
  already attached to each curated interval" — which `average_speed` is. Follows Task 11's own
  precedent exactly (`avgCadence` was dropped for having no consumer, then correctly added in P3b when
  one existed). **Locked scope 2026-08-15 (athlete's call): evidence-only.** Add `avgSpeedKph` to
  `ExecutedInterval` and attach it to the matched-lap evidence string alongside gradient/VAM; do
  **not** add speed to `TargetSchema`, so no objective is ever scored on it — speed is confounded by
  wind, drafting, surface and tyres, and grading it would score the athlete on weather. Aero-position
  claims stay `qualitative` ("no sensor can establish skill quality"), which is already correct.
  **Gate it on a live payload check first** — `average_speed`'s presence is an assumption, and
  `Maxgradient`'s casing surprise proves this payload can't be assumed. Absent → don't invent it.
- ☐ P3 `bug` **NV-8 — prose completion is not audited.** `analyseRide` uses a fixed `max_tokens: 280`
  and returns only concatenated text, discarding `stop_reason`
  ([anthropic-api.ts:147](lib/anthropic-api.ts:147)) — the code cannot tell a finished answer from a
  token-limit cutoff. The pattern already exists next door: `GenerationResult` carries `stopReason` and
  `truncated` for the tool path; apply it here.
- ☐ P3 `bug` **NV-12 — off-plan tempo is stored as "Threshold".** `inferWorkoutType` maps every IF
  from 0.75 to 0.89 into that bucket ([ride-classify.ts:13](lib/ride-classify.ts:13)); both 2026-08-14
  (IF 0.78) and 2026-08-15 (IF 0.82) persist as `inferredType: "Threshold"` while the visible output
  correctly calls the latter tempo. Deliberately broad — the file header already scopes it "never for
  adherence judgement" — but the *name* can leak into trend labels and hard-session/fueling logic.
  Rename to a neutral band, or replace with intent-derived type once interpretation succeeds.

**Block-generation architecture follow-ons.** Shipped work → [ARCHIVE.md](ARCHIVE.md). Known gaps →
[docs/systems/05-season.md § Known rough edges](docs/systems/05-season.md#known-rough-edges).

- ☐ P3d–e, P6 `feat` — queued. P3d/e deliberately deferred (need new forward-projection code / new
  regen infrastructure, and no live evidence yet justifies either). P6 not yet scoped to
  file/function detail.

**Block-generation live verification.** Phases A + B shipped → [ARCHIVE.md](ARCHIVE.md). One check remains:

- ☐ P2 `bug` **Confirm loading weeks now hit their hour target.** Phase B took them from 1/4 inside
  the 30-min tolerance to 3/4 (measured −20/−34/−10 min vs 12h; recovery week −4). The residual cause
  — a flat quality-slot size that flagged correct ~55min SIT sessions every week — was fixed *after*
  that measurement, and replaying the last run's plan against the corrected skeleton drops its
  conformance warnings 3→0. **Unverified for hours:** needs one live 4-week generation to confirm the
  freed minutes actually land. If a week still misses, read the `SKELETON:` warnings first — they name
  the exact day and slot.

**Post-2026-08-03: hybrid Claude + Codex workflow — shipped but not exercised live yet.** Sequential
handoff is proven (3 Codex PRs landed 2026-08-03, zero regressions); the concurrency half of the
design has not been exercised.

- ☐ `audit` Two-agent concurrency dry run — deliberately run Claude and Codex at the same time on
  disjoint files, and separately exercise the same-file writer/reviewer fallback once, before relying
  on either under real time pressure.

---

**Post-2026-07-22-audit: shipped but not exercised live yet.** Not bugs — just never run against real
data/hardware in the sweep that shipped them. Try when convenient, then check off.

- ☐ `audit` Cross-tab guard (UXA-24) — open Plan in two tabs on the same block, mutate in one, try
  the same action in the other. Expect a "changed in another tab, reload" message, not a silent
  overwrite.
- ☐ `audit` Keyboard shortcuts (UXA-48) — `1`–`7` nav, `s` sync, `?` legend, from a real keyboard;
  decide if they're worth a touch equivalent on mobile/tablet (currently just absent there).
- ☐ `audit` Unconfigured-Intervals.icu branch (UXA-2) — Today's "not connected yet" copy, live.
- ☐ `audit` The 9 newly-`<form>`-wrapped forms (UXA-21) — Enter-to-submit, with real values.
- ☐ `audit` Nutrition range hints (UXA-51) — confirm the Profile "Edit" disclosure numbers read
  sensibly against your own real values.
- ☐ `ux` P3 Nutrition input bounds (UXA-51) — narrowed: `baseCalories`/`restDayTarget` are deprecated
  and no longer athlete-editable, and `buffer` was retired entirely, so only `targetWeightKg` still has
  a floor of 0 and no ceiling. `targetRateKgPerWeek` is already bounded (±1.5).

---

- ☐ decide `i-have-adhd/`: delete or properly install (untracked clone at repo root since 2026-06-25)
- ☐ `audit` Nutrition follow-ups — none blocking; magnitudes in
  [09-nutrition § known rough edges](docs/systems/09-nutrition.md#known-rough-edges). `weeklyEnergy`
  remains approximate because NodeVelo does not yet persist the final prescription for every calendar
  day; do not reconstruct old buffers or stamp rides only (rest days would be absent). Derived route
  coverage, coach-snapshot local-date fallback, and conditional RMR-floor transparency are closed.
- ☐ P3 `feat` Nutrition Phase 4 — daily carbohydrate target (spec §9). Protein deliberately out (the
  athlete already covers it); within-day timing out (needs meal-level logging they've declined);
  wearables out.
- ☐ `ux` Phase 3a no-block Today layout — revisit whether the fused `AthleteStateCard` (Zone 1,
  `lib/athlete-state.ts`) should eventually be replaced/merged with design §10's three-stream
  Load/Recovery/Execution read for the no-block case, rather than keeping the fused score permanent and
  adding §10's read as Zone 2 supplementary text. Chose the lower-risk option for v1 (2026-08-12,
  athlete's explicit call); flagged to reconsider once the no-block section has shipped and been used.

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).
