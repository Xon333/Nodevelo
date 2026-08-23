# Phase 1 publication gate — hard-block malformed structure, informed override for coaching concerns

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status: SHIPPED 2026-08-23** (Tasks 1–6 complete; branch ox/publication-gate).
> Live-smoke acceptance evidence (attended, isolated worktree data copy, primary data untouched):
> three real 4-week generations against the live Anthropic API — run 1 returned HTTP 200 with
> findings.blockers = [SKELETON: 2026-09-19 is 164 min, outside its 165–195 min slot] (gate caught a
> real envelope miss); tampered-days replay to /api/write → 422 unknown-plan, zero writes; exact-plan
> replay → 422 {error, blockers} non-overridable, zero writes; run 3 returned zero SKELETON findings,
> satisfying the acceptance gate (run 1's miss was a one-off near-miss, not systematic). Local writes
> during the smoke limited to ai-usage.json, season-plan.json (CAS re-plan), generation-gate.json;
> nothing published, calendar untouched. Browser inspection of preview panels deferred: Anthropic
> credit exhausted after run 3; panel states covered by the component-test matrix.

**Goal:** Repair Phase 1's first trust contract ([ROADMAP](../../../ROADMAP.md) Phase 1 bullet 1):
publication of a generated block is hard-blocked on malformed structure, clear protocol hazards,
spacing/sequencing hazards, and load-envelope/hour-budget hazards. Only lower-confidence coaching
preferences may pass, and only through an explicit informed athlete override. An override can never
bypass a structural, integrity, protocol, spacing, or safety hazard.

**Architecture:** One new pure module (`lib/publication-gate.ts`) owns classification. It runs every
existing validator once and buckets their outputs into `blockers` (publication-refusing) vs
`preferences` (override-eligible) — severity is a property of the validator's fact, decided in one
place, never by parsing message strings. `/api/generate` returns the classified result on the plan
(`plan.findings`) alongside slimmed informational-only `warnings`. The verdict is **persisted
server-side** (`data/generation-gate.json` via json-store, keyed by a canonical hash of
`days + blockParams`); `/api/write` looks the submitted plan up against that persisted verdict and
refuses anything else. This makes the gate server-authoritative without re-running validators at
write time against drifted context (score log / season plan move between generate and publish; a
recompute would raise false blockers on an unchanged plan — see Global Constraints). `/api/write`
gains three refusal paths that all fire **before any Intervals.icu calendar write**, plus an
override-provenance stamp on `CurrentBlock`. `lib/workout-validate.ts` splits embedded-intensity
envelope breaches out of `advisories` into a new `hazards` bucket (they are protocol hazards, not
preferences). No prompt text changes, therefore no PROMPT_VERSION bump.

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript 5, Vitest + Testing Library,
node:crypto for the canonical hash. No new dependencies.

---

## Current-state trace (verified 2026-08-23 against this worktree)

### Publication flow today

1. `POST /api/generate` (`app/api/generate/route.ts`): pre-gates on settings feasibility
   (`checkBlockFeasibility` → 400), assembles context, one Claude call, zod parse of
   `PlanToolSchema` (failure → thrown → 502, route.ts:446–461). Then deterministic repairs
   (`reconcileDurationMin` route.ts:466, `repairNutrition` :470), then **twelve warn-only validator
   push sites** (:483–521) appending to flat `warnings[]`, plus `protocol.violations` carried separately
   as `plan.protocolViolations` (:547). Response is 200 with the plan regardless of what the
   validators found (:570). Truncation and day-count mismatch are warnings (:473–476, :523–525).
2. Preview: `components/dashboard/PlanView.tsx` posts to `/api/generate`, holds the plan in state,
   renders `<PlanPreview>` (:440–457). `components/PlanPreview.tsx` shows `protocolViolations` red
   (:141–150, "…Regenerate, or write anyway if deliberate:" :144) and `warnings` amber (:152–159),
   but the Write button's disabled condition is only `writing || written || !intervalsConfigured`
   (:195) — validation state plays no role.
3. Publish: `PlanView.write()` (:271–303) posts `{ plan, expectedBlockCreatedAt, today }`. The
   server (`app/api/write/route.ts`) checks only per-day field shapes (:23–42) and concurrency
   (409s), then **writes calendar events first** (:94–108) and stamps retrospective
   `protocolFindings` audit data afterwards (:222–225). Nothing gates.

**Headline defect:** a plan full of red violations and amber warnings publishes with one click, zero
confirmation, and no server-side refusal under any structural circumstance. There is no override
mechanism anywhere in the path; the violation banner's "write anyway if deliberate" invites a
choice the software does not implement or record.

### Existing validator ownership (unchanged by this plan — INVARIANTS #33)

| Owner (file:function) | Fact it owns | Today |
|---|---|---|
| `route.ts` day-count check | flattened day count ≠ lengthWeeks × 7 | warning |
| `route.ts` `truncated` flag | token-limit cutoff, incomplete plan | warning |
| `plan-schema.ts` zod | required fields/enums/bounds | hard throw (502) — stays |
| `workout-validate.splitPlanProtocol` `.violations` | quality-day KB intensity/duration band breach | red, non-gating |
| `splitPlanProtocol` `.advisories` (embedded-insert half) | durability-insert envelope breach on Z2/Recovery day | amber, non-gating |
| `splitPlanProtocol` `.advisories` (duration-consistency half) | stated duration ↔ step-sum gap (dead in generate path post-reconcile) | amber, non-gating |
| `schedule-validate.validateSchedule` | back-to-back hard days; loading-week quality budget | warning |
| `schedule-validate.validateEventTaper` | hard session ≤2 days before B/C event; >1 other quality in event week | warning |
| `block-skeleton.validateWeekHours` | weekly total off target (>±30 min) | warning |
| `schedule-validate.validateSkeletonConformance` | missing day; type outside slot; duration outside envelope | warning (**staged decision**, see below) |
| `schedule-validate.validateRecoveryWeekDensity` | embedded work in recovery long ride; >1 quality in recovery week | warning |
| `schedule-validate.validateWeekSequencing` | freshness-dependent quality after fatigue-tolerant | warning |
| `session-requirements.validateSessionRequirements` | terrain/race goal ⇒ ≥1 RaceSim | warning |
| `season.ts` fit/focus family (`validateSeasonFit`, `validateFocusMatch`, `validateBlockFocus`, `validatePrimaryQualityCadence`) | intensity share / focus-label disagreement vs season structure | warning |
| `nutrition-validate.repairNutrition` | kcal/carb figures auto-corrected to formula | visible repairs notes |
| narrative critic | overview prose ↔ schedule mismatch | best-effort overview rewrite + note |

**Staged decision being resolved:** `validateSkeletonConformance` is warn-only *by staged decision*
(`docs/systems/06-generation.md` Known rough edges; comment at `lib/schedule-validate.ts:275–277`):
escalation was deferred until real runs showed compliance. The supporting evidence is strong but
**not yet confirmed by a post-fix live run**: Phase B's replay of the last real plan against the
corrected per-type skeleton dropped SKELETON warnings 3 → 0 (2026-07-29 ledger), but
`docs/systems/06-generation.md:89` still records the hour-target fix as "improved, not confirmed
closed". This plan escalates all three SKELETON branches to blockers **unconditionally** — the
spec's load-envelope category is non-negotiable, so there is no severity fallback. Task 6's live
smoke carries an acceptance gate instead: the real generation must produce zero SKELETON findings;
if it does not, that is a BLOCKED escalation back to the human (possible skeleton regression),
never a silent downgrade of the gate.

## Classification (the contract)

**BLOCKERS — publication refused; no override exists for any of these.**

- *Structural/integrity:* day-count mismatch; truncated response; duplicate or non-contiguous dates
  (new minimal integrity check — duplicate dates silently overwrite each other on the calendar
  because events are keyed `nodevelo-<date>`, INVARIANTS #9); SKELETON missing day; SKELETON wrong
  type; SKELETON duration outside envelope.
- *Protocol:* quality-session KB band breaches (today's `protocolViolations`); embedded-intensity
  envelope breaches on Z2/Recovery days (moved from advisories to a new `hazards` bucket);
  RECOVERY DENSITY embedded threshold/VO2 in the recovery long ride.
- *Spacing/sequencing:* back-to-back hard days; freshness-first sequencing inversion; EVENT TAPER
  hard session within 2 days before a B/C priority event; EVENT TAPER event-week quality cap.
  **Documented exception (ADR-recorded):** with `qualitySessionsPerLoadingWeek >= 3`, the skeleton's
  canonical placement is best-effort and may produce adjacency by design
  (`docs/systems/06-generation.md` Known rough edges) — regeneration cannot beat a deterministic
  placement limit, so in that configuration the back-to-back finding is bucketed as a **preference**
  (informed override), not a blocker. At the default budget (≤2) it stays a hard blocker.
  Implementing this without string-parsing requires `validateSchedule` to stop returning one flat
  `string[]`: Task 1 splits it into a typed result `{ spacing: string[]; budget: string[] }`
  (adjacency vs quality-budget findings), updating its only production call site and tests.
- *Load envelope / hour budget:* HOURS week off target; loading-week quality budget overrun;
  RECOVERY DENSITY extra quality session in a recovery week.

**PREFERENCES — lower-confidence heuristics; publishable only via explicit informed override.**

- GOAL: terrain/race-driven goal without a RaceSim session (`validateSessionRequirements` — tag-
  based detection, KB-suggested rather than safety-critical).
- PRIMARY QUALITY cadence (`validatePrimaryQualityCadence`).
- Season-fit family: `validateSeasonFit`, `validateFocusMatch`, `validateBlockFocus`.

**INFORMATIONAL — displayed, never gating, never requiring acknowledgment:** season-degraded
warnings, nutrition repair notes, duration-consistency advisories (dead in the generate path),
narrative-critic overview correction note.

## Server-authoritative verdict persistence (why not write-time recompute)

Re-running validators inside `/api/write` would need week targets, the block skeleton, recovery-week
indices, focus choice, and season events — all reconstructed from live stores. Those inputs move
between generate and publish (a ride syncing shifts `weeksSinceRecovery`; the season replan
persists at generate success). A recompute can therefore raise **false blockers on a byte-identical
plan**, which trains the athlete to distrust the gate — the exact failure this phase repairs.
Instead:

- `/api/generate` computes the verdict once, in context, and persists
  `{ verdictHash, blockers, preferences, model, promptVersion, createdAt }` to
  `data/generation-gate.json` (single slot, latest generation wins) through json-store
  (INVARIANTS #2). `verdictHash = sha256(canonical(days) + canonical(blockParams))` where
  `canonical` sorts object keys recursively (tiny helper in the gate module) so client round-trip
  key-order differences cannot false-mismatch.
- `/api/write` hashes the submitted `days + blockParams` and compares. Match → apply the persisted
  verdict. No match (tampered days, stale tab across a regenerate, hand-built payload, pre-feature
  plan) → **422 "this exact plan didn't come from your generator — regenerate"** regardless of any
  client-supplied findings or flags. Fail-safe direction: losing the verdict file blocks
  publication until a regeneration, never the reverse.
- Consequence, documented as intended: the server enforces blockers absolutely; the *requirement*
  to acknowledge preferences is enforced against the persisted server-side preference list (the UI
  checkbox drives `overrideAcknowledged`, and the server refuses without it when its own list is
  non-empty). The checkbox state itself is UX honesty, not a security boundary — the boundary is
  that blockers are non-bypassable and the preference list is server-owned.

## User-visible behavior after this plan

- Blockers present → red panel "**Publication blocked** — these defects make this plan unsafe to
  publish. Regenerate." Write button disabled. Copy states explicitly there is no override for
  these.
- Preferences present (no blockers) → amber panel listing each concern + a required checkbox:
  "I have read the concerns above — publish anyway." Write stays disabled until checked. Checking
  it and publishing stamps provenance.
- Informational warnings → amber "Notes" panel, non-gating.
- On successful override publish, `CurrentBlock.publicationOverride` records
  `{ findings: string[], acknowledgedAt: ISO }` — the "written despite a known concern" trail the
  write route already pioneered with `protocolFindings`, extended to the override decision.

---

## Global Constraints

Every task inherits these; reviewers are handed them verbatim.

- **Blockers are absolute.** No request field, flag, or client state can publish a plan whose
  persisted verdict carries blockers. The override path and the blocker refusal path share no code
  branch that could let one reach the other.
- **The gate fires before any calendar write.** All three `/api/write` refusal paths (unknown
  plan/verdict, blockers present, preferences without acknowledgment) return before the
  `createEvent` loop and before the old-block archive step. A refused write leaves zero
  Intervals.icu mutations and zero local writes.
- **Severity is decided once, in `lib/publication-gate.ts`, by emitter — never by parsing message
  strings.** Validators remain the owners of their facts (INVARIANTS #33); the gate only buckets
  their outputs. No validator's wording changes except where a task explicitly says so.
- **One fact, one warning owner survives the refactor.** The generate route must not double-run a
  validator (once for warnings, once for the gate) — the gate's output feeds both display buckets.
- **All new persisted fields are additive and optional; every read uses a truthy check**
  (INVARIANTS #3). `plan.findings`, `CurrentBlock.publicationOverride`, and the verdict record are
  absent in older data and must parse back cleanly as `undefined`.
- **No prompt text changes → no PROMPT_VERSION bump** (INVARIANTS #16/54 considered, documented
  decision not to bump; the model sees nothing new). `GENERATION_MODEL`/stamping untouched.
- **Persistence goes through json-store** (INVARIANTS #2): the verdict store gets atomic-write +
  lock treatment via `updateJsonFile`-style helpers in `lib/data-store.ts`, following the existing
  per-file conventions (decide CRITICAL-set membership by matching how similar ephemeral state is
  treated; document the choice inline).
- **"Today"/dates:** no new date math beyond reusing existing helpers; the canonical hash is
  byte-level and timezone-free.
- **Test counts are not checksums.** Add the tests each task names; do not delete coverage to hit
  a number; unrelated suites breaking is a bug to fix, not a count to rebalance.
- **Docs and pointer hygiene:** `docs/systems/06-generation.md`'s pipeline diagram, warn-only
  validator list, and "Known rough edges" staged-decision entry MUST be updated (AGENTS.md stale-
  pointer rule — that entry resolves this plan). INVARIANTS gains the publication-gate contract;
  DECISIONS gains an ADR recording the staged-decision resolution + verdict-persistence choice;
  FILE_INDEX gains the new files. RECIPES' add-a-validator row mentions the gate.
- **Live smoke is attended, backed up, and reversible** (Task 6): backup `data/` first; refusal-path
  evidence comes from calls that provably cannot mutate the calendar (they return before any
  write); a full real publish happens only after the user-visible panels inspect clean.

---

## Task 1: `lib/publication-gate.ts` — hazards split + classifier

**Files:**
- Modify: `lib/workout-validate.ts` (`ProtocolFindings` gains `hazards: string[]`; `splitPlanProtocol`
  routes embedded-intensity envelope findings there; duration-consistency stays in `advisories`)
- Modify: `lib/schedule-validate.ts` (`validateSchedule` returns `{ spacing: string[]; budget:
  string[] }` instead of one flat array — the typed split that lets the gate bucket adjacency and
  budget findings differently without parsing strings; update call sites/tests)
- Modify: `lib/types.ts` (add `PlanFindings { blockers: string[]; preferences: string[] }`; ADD
  optional `findings?: PlanFindings` to `GeneratedPlan`. Do NOT remove `protocolViolations` here —
  its only code reader (`components/PlanPreview.tsx:112`) isn't updated until Task 5, and removing
  it now would break the build for Tasks 1–4. Task 5 removes the field together with its reader.)
- Create: `lib/publication-gate.ts`
- Tests: update `lib/workout-validate.test.ts`, `lib/schedule-validate.test.ts`; create
  `lib/publication-gate.test.ts`

- [ ] `canonical(value)` helper: recursive key-sort + `JSON.stringify`, exported for reuse. The
      verdict hash is `sha256(canonical({ days, blockParams }))` — a single canonical stringify of
      a key-sorted wrapper object, over the post-`reconcileDurationMin`/`repairNutrition` `days`
      array exactly as placed in the response.
- [ ] `evaluatePublicationGate(args)` where args carry everything the route already computed:
      `{ days, truncated, expectedDayCount, ftp, envelope, blockSettings, weekTargets, blockSkeleton,
      events, requirements, seasonContext }` with
      `seasonContext: { mode: "event-anchored"; plan: SeasonPlan } | { mode: "rolling"; focus:
      SeasonFocus } | null`. Returns `{ blockers, preferences, advisories }`.
- [ ] Structural checks inside the gate: day-count mismatch; `truncated`; duplicate dates;
      non-contiguous date sequence (sorted dates step exactly +1 day). Messages follow existing
      prefix style (e.g. `STRUCTURE: …`).
- [ ] Bucketing exactly per the Classification section: call each validator ONCE, assign whole
      arrays by owner (`validateSchedule`'s `spacing`/`budget` halves, `validateEventTaper`,
      `validateWeekHours`, `validateSkeletonConformance`, `validateRecoveryWeekDensity`,
      `validateWeekSequencing`, `protocol.violations`, `protocol.hazards`, recovery-density →
      blockers; `validateSessionRequirements`, season family → preferences; `protocol.advisories`
      returned as informational so the route folds them into `warnings` without re-running anything).
      Sole per-finding exception: the back-to-back finding from `validateSchedule.spacing` is
      bucketed as a preference when `blockSettings.qualitySessionsPerLoadingWeek >= 3`
      (Classification section's ADR-recorded exception) — decided by emitter+settings in the gate,
      never by parsing strings.
- [ ] ⚠️ `splitPlanProtocol` hazards split is **per source, per day**, not per day: today
      `lib/workout-validate.ts:153` routes everything from one day into one bucket, including its
      `validateDurationConsistency` finding. Restructure so each finding is bucketed by its own
      source: quality-day insert findings → `violations` (unchanged); endurance/Recovery-day insert
      findings → new `hazards`; duration-consistency → `advisories` (always). No message-string
      filtering — Global Constraints forbid it; this is why the split must happen at emission.
- [ ] Event-anchored season branch evaluated only when `mode === "event-anchored"`; rolling branch
      only when `mode === "rolling"`; `null` skips the season family (mirrors today's route flags).
- [ ] Tests: one per category boundary — each validator's sample output lands in its bucket;
      structural checks fire (wrong count, truncated, duplicate date, gap in dates) and pass on a
      contiguous correct-length fixture; season branches respect the mode flag; the back-to-back
      adjacency exception flips blocker→preference exactly at `qualitySessionsPerLoadingWeek >= 3`
      and not below; `hazards` vs `advisories` split in `workout-validate.test.ts` (embedded-intensity
      finding → `hazards`; duration-consistency → `advisories`, including on a day that also produced
      an insert finding; violations unchanged).

## Task 2: Verdict store

**Files:**
- Modify: `lib/data-store.ts` (+ whatever store-type declarations it owns) —
  `readGenerationVerdict()` / `saveGenerationVerdict(record)` over `data/generation-gate.json`,
  single-slot latest-wins, following the file's existing store patterns exactly
- Test: `lib/data-store.test.ts`

- [ ] Record shape: `{ verdictHash: string; blockers: string[]; preferences: string[]; model?:
      string; promptVersion?: number; createdAt: string }`.
- [ ] Round-trip test incl. absent-file → `null`, corrupt-file behavior consistent with sibling
      stores, and concurrent-save safety via the same locking helpers neighbors use.

## Task 3: Wire `/api/generate`

**Files:**
- Modify: `app/api/generate/route.ts`
- Tests: `app/api/generate/route.test.ts`

- [ ] Replace the eleven scattered `warnings.push(...validator...)` calls with ONE
      `evaluatePublicationGate` call feeding: `plan.findings` (when either array non-empty),
      `warnings = [...seasonDegradedWarnings, ...nutritionRepair.repairs, ...gate.advisories]` +
      critic note. Day-count/truncation messages move INTO the gate (delete the inline versions at
      :473–476/:523–525; the critic skip condition keeps using the raw values).
- [ ] Stop emitting `protocolViolations` (field removed in Task 1); violations now surface via
      `findings.blockers`.
- [ ] After building the plan: compute `verdictHash` over canonical `plan.days + plan.blockParams`,
      save the verdict (best-effort like the season persist — a save failure logs and proceeds BUT
      the response then carries no publishable verdict; verify write-side refusal message covers
      this), and include nothing client-facing about the hash.
- [ ] Route tests: findings present and correctly populated on a warning-bearing fixture;
      truncated → blocker in findings and NOT in warnings; day-count mismatch → blocker; clean
      fixture → `findings` undefined-or-empty and warnings informational-only; verdict persisted
      (assert store contents); verdict-save failure → generation still succeeds (best-effort) and
      the store stays absent/stale, i.e. the plan will refuse at write; season branch selection
      unchanged.

## Task 4: Gate `/api/write`

**Files:**
- Modify: `app/api/write/route.ts`, `lib/types.ts` (`CurrentBlock.publicationOverride?`)
- Tests: `app/api/write/route.test.ts`

- [ ] After `validatePlan` + version guard, BEFORE `existingDescByDate` fetch and the event loop:
      hash the submitted `plan.days + plan.blockParams`; load the verdict. Mismatch/absent → 422
      `{ error }` ("This exact plan didn't come from your generator — regenerate."). Blockers
      non-empty → 422 `{ error, blockers }`. Preferences non-empty and
      `body.overrideAcknowledged !== true` → 422 `{ error, preferences, overrideRequired: true }`.
- [ ] Request body accepts optional `overrideAcknowledged: boolean` and records
      `publicationOverride: { findings: <the persisted preference strings>, acknowledgedAt: new
      Date().toISOString() }` on the `CurrentBlock` when publishing with acknowledgment.
- [ ] Remove the now-redundant per-day protocol-violation stamping? **No — keep it**: it freezes
      findings against the FTP/calibration live at write time and stays queryable; leave :220–236
      untouched except adapting to the `hazards` split if its imports changed.
- [ ] ⚠️ Existing `app/api/write/route.test.ts:21–34` replaces `@/lib/data-store` wholesale. Once
      the route imports `readGenerationVerdict`, every existing test needs the mock extended —
      returning `null` reproduces the verdict-less refusal, so those tests' expectations must be
      updated deliberately (most now expect the 422 unknown-plan refusal unless a verdict fixture
      is provided). Handle this explicitly; don't discover it as mysterious breakage.
- [ ] Route tests (mock intervals-api like existing tests): each refusal path asserted to perform
      ZERO `createEvent` calls AND zero local writes (`updateCurrentBlock`, `appendBlockHistory`
      never invoked); ack path writes, saves the block, stamps
      `publicationOverride`; non-ack path with preferences → `overrideRequired`; tampered days →
      unknown-plan refusal even when the body claims `overrideAcknowledged: true`; verdict-less plan
      → refusal; clean plan unchanged behavior.

## Task 5: UI — blocked / override / notes panels

**Files:**
- Modify: `components/PlanPreview.tsx`, `components/dashboard/PlanView.tsx`, `lib/types.ts`
  (NOW remove `GeneratedPlan.protocolViolations` together with its last reader)
- Tests: `components/PlanPreview.test.tsx`, `components/dashboard/PlanView.test.tsx`

- [ ] PlanPreview: render blockers (red, Write disabled, explicit "cannot be overridden"),
      preferences (amber + the acknowledgment checkbox gating Write), informational warnings
      (amber notes). A plan without `findings` (truthy check) renders no blocker/preference panels —
      informational warnings only; the old protocolViolations banner and its "write anyway if
      deliberate" copy are deleted along with the field.
- [ ] PlanView: hold `overrideAcknowledged` state (reset on regenerate/new plan), send it in the
      write POST; handle `overrideRequired`/blocker 422 responses with readable messages.
- [ ] Component tests: disabled/enabled matrix (clean → enabled; preferences unchecked → disabled;
      checked → enabled; blockers → disabled regardless); payload assertions; 422 handling.

## Task 6: Docs, ADR, full verification, live smoke

**Files:**
- Modify: `docs/systems/06-generation.md` (pipeline diagram step J → gate; validator table gains
  severity column; "Known rough edges": rewrite the staged-decision entry as resolved, keep the
  event-date exclusion entry), `docs/INVARIANTS.md` (new numbered item(s) under Generation
  contracts: blockers non-bypassable + verdict persistence + severity-by-emitter; **and amend #22**
  — "persists nothing but the CAS-guarded season re-plan" must gain the publication-gate verdict
  record or the law file contradicts this feature), `docs/DECISIONS.md` (ADR: staged-decision
  resolution; persist-not-recompute rationale; the ≥3-quality adjacency exception),
  `docs/RECIPES.md` (add/change-a-validator row), `docs/FILE_INDEX.md` (new files),
  `ROADMAP.md` untouched (phase bullet stays until phase completes)

- [ ] `npm run check` green; focused suites green; full `npm test` green.
- [ ] Pointer sweep: grep for links into `06-generation.md#known-rough-edges`, for the
  staged-decision wording, AND for `protocolViolations` — at minimum check
  `docs/systems/07-ai-layer.md:59`, `docs/systems/05-season.md:114` ("Reopen trigger"),
  `docs/RECIPES.md:80`, `docs/DECISIONS.md` ADR-0004 sentence, and `lib/workout-validate.ts:140`'s
  comment; fix every reference the removal strands (INVARIANTS #31, AGENTS.md rule).
- [ ] **Live smoke (attended):** back up `data/`; start dev server; POST a real 4-week generation;
    READ the actual returned JSON (jq the `findings`/`warnings` arrays) and the preview panels in
    the browser. **Acceptance gate:** the live plan must carry zero SKELETON findings — if it does
    not, that is a BLOCKED escalation to the human (suspected skeleton regression), never a
    downgrade of the gate's severity. Then, without
    publishing: replay the SAME plan to `/api/write` with one day's `durationMin` tampered → expect
    the unknown-plan 422 and confirm zero calendar mutations; restore the untampered plan and (if
    preferences exist) POST without `overrideAcknowledged` → expect `overrideRequired` 422, again
    zero calendar mutations. Full real publish only if the user asks for it afterward (it burns
    real calendar writes). Record acceptance evidence: findings rendered readable, refusal statuses
    observed, calendar untouched.

---

## Explicit non-goals

- No generation-quality rewrite, no prompt changes, no auto-regenerate loop (malformed output
  remains a visible manual retry, per the systems doc's tradeoff line).
- No physiology-freshness gating (Phase 1 bullet 2 — separate task).
- No change to `checkBlockFeasibility`, the narrative critic, nutrition repair semantics, or the
  write-time `protocolFindings` audit stamp (beyond the hazards-split import adaptation).
- No redesign of warning prose; validators keep their messages.
