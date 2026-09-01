# FR-3 core-journey task audit

**Date:** 2026-09-01
**Scope:** Today → Plan → ride execution → closeout/retrospective → adaptive week
**Status:** Complete; evidence only, no product changes

## Method

- Read the FR-3 decision surface, invariants, and daily-loop, season, and frontend system docs.
- Walked `/today` and `/plan` in the local app using a temporary copy of the current athlete data and
  knowledge base. The real `data/`, knowledge base, active block, and Intervals.icu calendar were not
  mutated.
- Exercised a sandbox early closeout on the current two-week block, inspected the saved history and
  retrospective, compared `/api/season` before and after, generated a replacement preview, navigated
  away and back, refreshed, and checked browser warnings/errors.
- Inspected the scoped route and adaptive selector plus their current tests. No external UX sources
  were needed; every conclusion below is direct NodeVelo evidence or an identified code trace.

Evidence tags: **Live** = observed in the local UI/API; **Code** = traced in the named source;
**Test** = checked against the current automated coverage.

## Ranked findings

| Rank | ID | Failure | Correctness / trust | Completion failure | Repeated friction | Latency | Disposition |
|---:|---|---|---|---|---|---|---|
| 1 | FR3-01 | Early-end narrative grades the unlived future | **High** | **High** | Turnover-only | 6.93 s closeout, not causal | **FR-4 candidate** |
| 2 | FR3-02 | Adaptive focus remains stale until refresh after early closeout | **High** | Medium | Turnover-only | None | Evidenced failure, not selected |
| 3 | FR3-03 | In-app navigation silently drops an unaccepted plan preview | Low | Medium | Occasional | Regeneration measured at 293 ms | Evidenced failure, not selected |
| 4 | FR3-04 | Ride debrief repeats already-visible evidence in a 194-word note | Low | Low | **Every debrief** | None | Observation only |

The ordering is lexicographic: correctness/trust first, then task completion, repeated friction, and
latency. No aesthetic preference is ranked.

### FR3-01 — early-end narrative grades the unlived future

**Route/page:** Plan → `End block early…` → `POST /api/retrospective`.

**Reproduction:**

1. Open the active block dated 2026-08-31 → 2026-09-13 on 2026-09-01.
2. Choose `End block early…`, enter a reason, and close the sandbox block.
3. Compare the deterministic `closeout` payload with the returned and persisted narrative.

**Expected:** The confirmation says, “The remaining scheduled sessions won't count against you.”
Every retrospective fact should therefore use the effective closeout date. This is also the contract
in [INVARIANT 59](../INVARIANTS.md#block-closeout--acknowledgement): days after an early closeout are
excluded entirely and never reported as missed.

**Observed:** **Live** deterministic evidence correctly reported `0/1` scored sessions and one missed
session. The narrative instead began by evaluating `0` completed hours against the full `19.2`
planned hours, called the result “a two-week pause,” and said the athlete “simply treaded water.” The
block had existed for one lived day. The false narrative was saved in block history.

**Cause evidence:** **Code** `app/api/retrospective/route.ts:95-108` computes `plannedHours` from every
day in `block.days`, while only `buildCloseoutEvidence` receives the effective closeout date. The
untruncated hours are passed to `generateRetrospective` at lines 155-169. **Test** the existing early-end
case asserts that deterministic `closeout.plannedSessions` excludes the future, but does not assert the
model's `plannedHours` input.

**Impact:** This is a correctness and trust failure, not tone polish. The closeout presents two
contradictory histories in one completed task: the deterministic record honors the early end while the
prominent narrative blames the athlete for sessions that did not yet exist. It directly breaks the
athlete-confirmed closeout promise at the moment NodeVelo is supposed to establish the next block's
evidence.

**Contract check:** conflicts with INVARIANT 59 and the daily-loop rule that debrief evidence is the
trusted post-ride/turnover surface. It does not violate FR-5's deterministic planning-authority
boundary because the prose cannot shape compilation, but that does not make the false saved account
acceptable.

### FR3-02 — adaptive focus remains stale until refresh after early closeout

**Route/page:** Plan closeout → Season roadmap and generator prefill; adaptive selector in
`lib/season.ts`.

**Reproduction:**

1. Load Plan before early closeout. The live roadmap's first projected focus was `vo2max`.
2. Close the sandbox block on 2026-09-01. Its history correctly retained only the lived rest day and
   threshold day; future SIT, durability, and other sessions were removed.
3. Query `/api/season` again or refresh Plan.

**Expected:** The successful closeout should immediately recompute the adaptive result from the newly
settled evidence.

**Observed:** **Live** the server's first focus changed from `vo2max` before closeout to `anaerobic`
after closeout. **Code** `PlanView.generateRetro` clears `currentBlock` and reloads history, but does not
refetch or invalidate `seasonQuery` (`components/dashboard/PlanView.tsx:345-376`). The already-rendered
roadmap and goal prefill therefore retain `vo2max` until a refresh; after refresh the UI showed
`anaerobic — your most depressed system relative to your engine`.

**Impact:** The immediate next-block recommendation can be stale at the exact turnover boundary. The
athlete can begin editing or generate from a focus that no longer matches the server's evidence. A
refresh repairs it, so this ranks below the persisted false narrative.

**Contract check:** conflicts with the frontend's “invalidation over optimism” rule and with
`docs/systems/05-season.md`, where real exposure and `gatherFocusInputs` are the authority for a fresh
focus choice. It does not corrupt persisted season data.

### FR3-03 — in-app navigation silently drops an unaccepted plan preview

**Route/page:** Plan preview → Today → Plan.

**Reproduction:**

1. Generate the prefilled four-week adaptive block.
2. Confirm that the 28-session `Plan preview` is present.
3. Use the in-app `Today` link, then return with the in-app `Plan` link.

**Expected:** Preserve the unaccepted preview or warn before discarding it.

**Observed:** **Live** the preview disappeared with no warning. **Code** the existing guard explicitly
covers only `beforeunload`; its comment notes that Next.js links do not unload the page
(`components/dashboard/PlanView.tsx:208-219`).

**Impact:** The athlete must regenerate and re-review. This is a real lost-state completion failure,
but it ranks third because FR-5 made the observed regeneration fast (293 ms) and nothing persisted or
published incorrectly.

**Contract check:** no hard invariant is violated. It is a frontend state-loss exception to the
core-journey requirement and the frontend system's explicit-failure-state bias.

### FR3-04 — ride debrief repeats already-visible evidence in a 194-word note

**Route/page:** Today → `Last debrief · 2026-08-23`.

**Reproduction:** Open the stored last debrief and compare the intent-result list with `Coach takeaway`.

**Expected:** Verdict first, with concise explanation that adds a decision rather than restating the
visible segment table.

**Observed:** **Live** the intent list already showed each of four segments, duration, power, and
precision. The immediately following 194-word note repeated all four segments and most of the same
numbers before reaching the one actionable sentence about recovery.

**Impact:** Repeated cognitive load in the daily debrief, but no task was blocked and one stored note
does not establish that shorter wording would improve decisions. This is observation only.

**Contract check:** the deterministic score remains authoritative and the note is clearly under
`Coach takeaway`; no invariant is broken. The density works against `docs/systems/08-frontend.md`'s
verdict-first/evidence-behind-disclosures intent and FR-3's restrained-prose criterion.

## Task-by-task result

| Task | Result |
|---|---|
| Today pre-ride | Completed without failure. Readiness, physiology freshness, the 45-minute threshold prescription, and the next action were visible together. |
| Plan comprehension | Completed. The active block, current week, next session, target, calendar, and safe early-end entry point were findable. The active block's anaerobic focus versus its threshold goal is explainable by the selector, but the roadmap itself does not expose that explanation; observation only. |
| Ride execution/debrief | A stored real ride was inspectable and disposition controls were available. FR3-04 records the prose density; no scoring or action failure was observed. |
| Closeout/retrospective | Failed trustfully under early end: FR3-01. The reason gate and deterministic closeout otherwise behaved correctly. |
| Adaptive week | Actionable after refresh: the focus, rationale, length choices, goal/weakpoint prefill, and Generate action were present. Immediate post-closeout state is wrong until refresh: FR3-02. |
| Refresh/cross-tab | Refresh corrected the adaptive result. No polling or live cross-tab propagation exists; stale block mutations are CAS-guarded in the scoped route/tests. A live calendar write/delete race was not run because the sandbox intentionally had no Intervals.icu credentials. |
| Latency/loading | No measured journey latency justified work: warm `/today` 29 ms, `/plan` 20 ms, `/api/sync` 14 ms, `/api/season` 7 ms; deterministic generation 293 ms. The live retrospective took 6.93 s and showed a closing state; its content, not its wait, was the failure. No browser warnings or errors were recorded. |

## FR-4 candidate — exactly one

**Select FR3-01: early-end narrative grades the unlived future.**

It outranks FR3-02 because its false account is persisted and shown as the completed retrospective,
whereas the adaptive focus becomes correct on refresh. It outranks FR3-03 because it damages trust and
the closeout record rather than costing a fast regeneration. It outranks FR3-04 because the latter is
prose friction without an observed wrong decision. FR3-01 is also the narrowest root cause supported by
both a live reproduction and a hard invariant: one retrospective input boundary disagrees with the
already-correct deterministic boundary.

This selection is evidence only. FR-4 brainstorming/design has not been created here.

## Observations only — no implementation justified

- FR3-04's 194-word debrief note is dense, but one note did not block completion or prove a better
  wording rule.
- The post-refresh adaptive result was understandable and actionable at the decision level: named
  focus, short rationale, editable prefill, and a direct Generate action. Exposing the full selector
  score breakdown would add detail without observed need.
- The adaptive goal prefill contained eight mostly `general` goals and many weakpoints. It looked broad
  beside the single `anaerobic` target, but the fields were editable and generation still completed;
  no implementation is justified from this one snapshot.
- Early closeout required a nonblank reason, disabled confirmation until provided, retained only lived
  days, recorded the reason, and cleared the block last. Those safeguards worked.
- Basic browser checks found a skip link, labelled controls, no duplicate IDs, no unnamed interactive
  controls, and no console warnings/errors on the audited path.

## Blocked observations

- A new real ride could not be manufactured without changing Intervals.icu; the ride step used the
  latest stored real debrief instead.
- Calendar publication/delete and a real two-tab mutation race were not executed because the isolated
  app deliberately omitted external credentials. The route's stale-version behavior was checked in
  code and its existing tests, but this is not fresh attended calendar evidence.
- No mobile hardware or screen-reader session was run. No claim is made about those surfaces.
