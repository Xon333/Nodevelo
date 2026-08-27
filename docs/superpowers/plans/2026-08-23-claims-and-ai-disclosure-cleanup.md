# Claims & AI-disclosure cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove or qualify the unsupported claims and AI surfaces the accepted adversarial investment review dispositions for removal (causal-accuracy language, unqualified injury-risk wording, misleading constraint hardness, Ask Coach, replaceable AI criticism), and add the two required privacy disclosures — without reopening any settled decision and without touching publication-gating or physiology-freshness implementation files.

**Architecture:** This is a copy/removal/disposal pass over existing seams, not new subsystems. Every change either (a) rewords a user-facing string to match what the deterministic evidence actually supports, (b) deletes an already-decided-removed surface at its existing seam, or (c) replaces one best-effort LLM call with a warn-only deterministic validator that reuses the module's own extracted facts. No persisted schema changes, no migration flags, no gate-semantics changes.

## Amendment 2026-08-24 — pre-implementation safety corrections

This plan is a Phase 1 trust-repair slice and is intentionally not the full Phase 3 program to
reduce Claude's generation authority. The provider/model-cost review is a separate measured task;
it does not change this plan's scope, model selection, or provider.

The live repository was rechecked after the publication-gate work shipped:

- `app/api/generate/route.ts` already calls `evaluatePublicationGate`; this plan must not recreate,
  reclassify, or edit publication-gate semantics. Task 3's provenance footer may only consume the
  existing optional `GeneratedPlan.model` and `promptVersion` fields.
- There are currently six Anthropic call sites: block generation, narrative critic, ride analysis,
  prose retrospective, structured retrospective, and Ask Coach. Removing the critic and Ask Coach
  leaves four live call sites, not five or six. Deterministic intent parsing is not an Anthropic
  call site.
- The deterministic replacement must cover the known critic failures, not just generic hour/type
  examples: a false claim of escalating SIT work and a false description of a 190-minute ride as a
  four-hour ride. It remains warn-only and never rewrites the overview.
- The current Plan UI renders retrospective prose in the closeout card. It does not render the
  contents of `structuredReflections`; history currently shows only whether those reflections were
  adopted. Task 6 labels the displayed retrospective prose and adds a test proving structured
  reflections are not accidentally presented as unlabeled conclusions. If a later UI renders the
  reflection text, it must carry the same optional-AI provenance label before shipping.
- Privacy copy must name four remote call categories: block generation, ride-analysis coach note,
  prose retrospective, and structured retrospective. Ride-intent parsing is deterministic and must
  not be described as remote Anthropic processing.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Vitest (+ jsdom component tests), colocated `*.test.ts`.

## Global Constraints

These bind every task. Values are copied verbatim from their sources; every task implicitly includes them.

1. **The adversarial investment review is the authority** ([docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md](../../reviews/2026-08-20-nodevelo-adversarial-investment-review.md)). Do not reopen: "Remove Ask Coach from the active UI during the freeze" (Q52); "Remove false precision and causal `100% right` language; show evidence and sample size" (Q41); "Local persistence and outbound Anthropic processing must be disclosed separately" (Q21); "AI narrative criticism where deterministic prose can state the same facts" is in *Disable/remove/rewrite*; "Claude root causes and adjusted strategies require an explicit turnover approval before reuse" (Q50) — **already shipped**, verify only.
2. **Do not modify:** `app/api/write/route.ts` or any publication-gating logic (separate work stream owns it), `lib/physiology.ts` / physiology-freshness surfaces (separate work stream), ROADMAP.md / ARCHIVE.md / todo.md content policy in this plan's own session, CONTINUE.md, anything under `docs/superpowers/plans/`.
3. **Validators warn; they don't rewrite** ([INVARIANTS](../../../INVARIANTS.md) #13, ADR-0004). The only sanctioned output mutations remain `reconcileDurationMin` and `repairNutrition`. The overview check added by this plan appends to `warnings[]` and never edits prose.
4. **One fact, one warning owner** ([INVARIANTS](../../../INVARIANTS.md) #33). Before adding a warning, confirm no existing validator already states that fact.
5. **`PROMPT_VERSION` semantics** ([INVARIANTS](../../../INVARIANTS.md) #16, #54): bump only for structural changes to prompts that stamp generation/analysis artifacts. Deleting ask-coach and the narrative critic does **not** bump `PROMPT_VERSION` (neither call stamped artifacts; `INTENT_PROMPT_VERSION` untouched).
6. **Changed AI paths get one live smoke run** before "done" (AGENTS.md): after Task 5, run one real `/api/generate`, read the output, and confirm `data/ai-usage.json` recorded exactly the expected calls (generation only — no critic call).
7. **Deterministic core stays useful when Anthropic is unavailable** (review decision Q42). Nothing in this plan may add an Anthropic dependency; Tasks 4–5 strictly remove some.
8. **No general UX redesign.** No layout, navigation-tier, page-set, or information-architecture changes beyond the specific copy/deletions specified here. All seven pages stay (review Q34).
9. **Worktree law:** implement on a fresh worktree via `npm run start:agent-task -- <agent> claims-cleanup`; stage only this plan's files; never `git add -A` (AGENTS.md).
10. **Verification loop:** `npm run check` (tsc + lint + vitest) green at every task boundary.

---

## Part A — Read-only inventory (reconciled against `main` as of 2026-08-23)

Every finding below was located in current code, not inferred from the review's snapshot (`d3dd228`). Classification vocabulary:

- **active UI** — rendered to the athlete today
- **internal-only** — comments, field names, logs; never rendered
- **docs-only** — repository documentation a human reads but the app doesn't render
- **already removed/stale** — the review flagged it; `main` has since fixed it; verify, don't rebuild
- **retained by decision record** — stays, with the review as authority

### A1. Causal-accuracy claims

| # | Finding | Location | Class |
|---|---|---|---|
| A1-1 | Track-record header reads "`{hitRatePct}% right ({evaluated} checked)`" | `components/StandingGuidance.tsx:32` | **active UI** |
| A1-2 | Per-dimension badge tooltip: "Acting on matured … nudges **proved right** X% of the time (N decisive)" + emerald `✓ {pct}%` badge | `components/StandingGuidance.tsx:77-84` | **active UI** |
| A1-3 | Demoted-lever tooltip "Past … nudges **worked only** X% across N decisive blocks" + chip "**proven-poor** lever" | `components/StandingGuidance.tsx:85-92` | **active UI** (demotion behaviour retained by decision record — evidence-honest demotion is review-endorsed; chip label + tooltip reworded, see W2's symmetry note) |
| A1-4 | Insight badge tooltip: "How often acting on matured … insights **proved right** ({validated} validated of {total} evaluated)" + `✓ {pct}%` | `components/trends/verdict.tsx:100-107` | **active UI** |
| A1-5 | FEATURES Model section: "**coach accuracy** — how often matured directives proved right" | `FEATURES.md:194-195` | **docs-only** |
| A1-6 | Comment "How often acting on the coach's matured directives proved right"; payload field `coachAccuracy` | `app/api/sync/route.ts:282`, `lib/intervention.ts:198` | **internal-only** (field name kept for wire compatibility — see Compatibility) |

Root cause of the defect class (systematic-debugging, Phase 1): the hit-rate number is real, but six correlated outcomes over two hypothesis families cannot support a percentage-of-rightness framing. The fix is vocabulary, not math — the validation loop itself stays.

### A2. Individualized injury-risk language

| # | Finding | Location | Class |
|---|---|---|---|
| A2-1 | Load-ramp alert reason: "…well past the ~10% safe ramp. **High overreach/injury risk**; ease the next day or two." (rendered in Today's alert strip) | `lib/readiness.ts:175` | **active UI** |
| A2-2 | Ramp MetricTip: "…a common **injury-risk signal**." | `components/dashboard/today.tsx:96` | **active UI** — already population-framed ("common"); minor reword for consistency |
| A2-3 | ACWR MetricTip: "above 1.5 is a spike with **raised injury risk**." | `components/dashboard/today.tsx:684` | **active UI** — states a band as personal risk; qualify as population convention |
| A2-4 | Morning-check injury guidance ("rest today… pedaling motion can aggravate a strain… see a professional") | `lib/morning-check.ts:35-40`, `components/MorningCheckIn.tsx` | **retained by decision record** — conservative rest-first refusal to program around a self-reported injury is safety-conservative, not a risk prediction (S2-9 design; FEATURES). Untouched. |
| A2-5 | Comments naming ACWR/ramp "injury-risk" heuristics; calibration comment "auto-deriving injury-risk bands isn't possible without injury data" | `lib/types.ts:362,594`, `lib/readiness.ts:137,193`, `lib/calibration.ts:4,61` | **internal-only** — already honest; untouched |

Precedent to follow: `lib/session-suggestion.test.ts:78` already asserts suggestion reasons do NOT match `/injury/i` — same test shape extended to the ramp alert.

### A3. Claims that every plan constraint is hard

| # | Finding | Location | Class |
|---|---|---|---|
| A3-1 | Loop sentence: "Claude writes the training block (the plan) inside **hard numeric constraints**" | `README.md:43` | **docs-only** (landing page) |
| A3-2 | Mental-model line: "Claude only arranges sessions and phrases prose **inside hard constraints**" | `docs/COMPASS.md:7` | **docs-only** |
| A3-3 | Preview labels treat all warnings/violations as one class ("Warnings — review before writing:", violations block offers "write anyway if deliberate") with no distinction between hard hazards and coaching preferences | `components/PlanPreview.tsx:141-159` | **active UI** — **copy-only** fix; the hard-vs-preference *gate* itself belongs to the publication-safety stream and is explicitly out of scope here |

### A4. Automatic reuse of AI-authored root causes

| # | Finding | Location | Class |
|---|---|---|---|
| A4-1 | Retro seeds inject into generation **only** from markdown front-matter stamped `seeds_approved: true` (set solely by POST /api/history adoption); body-line stamps rejected; pre-gate files degrade to `[]` | `lib/kb-loader.ts:307-408`, `app/api/generate/route.ts:159`, tests `kb-loader.test.ts` | **already removed/shipped** (INVARIANT 59) — verification task only |
| A4-2 | Structured reflections (`root_cause`/`adjusted_strategy`) inject **only** from the newest history entry carrying `reflectionsApprovedAt` | `lib/retrospective-schema.ts:51-56` (`latestApprovedReflections`), `app/api/generate/route.ts:168`, `app/api/history/route.ts` | **already removed/shipped** — verification task only |
| A4-3 | Plan-history row shows "Adopted {date} — these notes reach the next block" vs unadopted state | `components/dashboard/plan.tsx:245-247` | **already shipped** (approval UI) — no change |
| A4-4 | Review's finding "suggestions could enter future prompts as clinical notes without explicit athlete approval" | — | **already removed/stale** on `main` |

### A5. Ask Coach routes, buttons, navigation, active UI

| # | Finding | Location | Class |
|---|---|---|---|
| A5-1 | "Ask coach" `<details>` disclosure rendering `<AskCoach bare />` — appears in **both** pre-ride and post-ride Today modes (lines ~183 and ~250 render the same `askCoach` element built at :123-131) | `components/dashboard/TodayView.tsx:123-131,183,250` | **active UI** → remove (review Q52) |
| A5-2 | Streaming client component with its own AbortController | `components/AskCoach.tsx` | becomes dead → delete file |
| A5-3 | `POST /api/ask` route (streaming, CSRF-guarded, spends credits) + integration test | `app/api/ask/route.ts`, `route.test.ts` | delete (dead endpoint keeps the maintenance cap violated; git history preserves it) |
| A5-4 | `askCoach` / `streamAskCoach` call functions + `buildAskCoachPrompt` prompt builder + unit tests | `lib/anthropic-api.ts:358-389`, `lib/anthropic-prompts.ts:714-760ish`, `lib/ask-coach.test.ts` | delete exports + tests |
| A5-5 | Navigation: Nav tiers/keyboard legend have **no** Ask Coach entry | `components/Nav.tsx` | nothing to remove — confirmed |
| A5-6 | AiUsageCard copy: "…across all generation, ride-analysis, **and ask-coach calls**." | `components/AiUsageCard.tsx:46` | **active UI** copy → update |
| A5-7 | Docs listing Ask Coach as live (FEATURES capability line, 08-frontend feature table row, 03-daily-loop mention, FILE_INDEX route row, 07-ai-layer call-site #6) | see Task 7 | **docs-only** → update with the code change |
| A5-8 | `CoachSnapshot` / `coach-snapshot.ts` (shared by sync GET + generation) | `lib/coach-snapshot.ts` | **retained by decision record** — it is generation infrastructure, not an Ask Coach artifact. Untouched except comment mentions of `/api/ask`. |

### A6. AI criticism that deterministic prose can replace

| # | Finding | Location | Class |
|---|---|---|---|
| A6-1 | Narrative critic: second LLM call per generation (haiku), fact-checks overview against deterministically-extracted week facts, rewrites overview prose; best-effort; review evidence: caught one bad overview, missed another | `app/api/generate/route.ts:534` (`critiqueOverview(overview, extractBlockFacts(days, weekTargets))`), `lib/narrative-critic.ts`, `lib/anthropic-api.ts:288-306` | **active pipeline** → remove the LLM call; keep the facts; replace with a deterministic warn-only consistency check (Task 5) |
| A6-2 | `extractBlockFacts` (deterministic week-fact extraction) lives inside `narrative-critic.ts` | `lib/narrative-critic.ts` | moves to the new owner module (facts survive; the critic does not) |
| A6-3 | Retrospective Claude narrative (`generateRetrospective`) + structured reflections | `app/api/retrospective/route.ts:147-180`, closeout card degraded-mode messaging (`narrativeDegraded`) | **retained by decision record** (Q51 keeps deterministic facts / AI narrative / approved seeds separate; "retain and simplify: Claude for … concise, grounded explanation"). Qualification only: label the narrative as optional AI-drafted enrichment where displayed (Task 6). Its prompt already feeds deterministic inputs only. |

### A7/A8. Local-persistence and remote-Anthropic disclosures

| # | Finding | Location | Class |
|---|---|---|---|
| A7-1 | Local persistence is described ("filesystem *is* the database", backup notes) but never as a privacy disclosure of what is stored | `README.md:34-36,77-83`, Settings BackupRestore card | gap → Task 8 |
| A8-1 | Remote processing mentioned only obliquely ("Routes spend Anthropic credits"); never states *that ride data/context is sent to Anthropic*, or which features do it | `README.md:80`, nowhere in-app | gap → Task 8 (decision Q21: disclose separately) |

### A9. Existing provenance/confidence UI to reuse (no new patterns)

| Pattern | Location | Reuse |
|---|---|---|
| Provenance line + confidence tier ("learned · N rides" / override / default) | `components/CalibrationPanel.tsx:110-127,216` | model for count-based evidence lines in Tasks 1–2 |
| IF basis stamp (`· NP` / `· avg`) in the debrief metric strip | `components/dashboard/today.tsx:~231` | precedent for compact inline provenance |
| Amber low-confidence flagging, withhold-below-threshold (`—`) | `components/AthleteStateCard.tsx`, `AthleteProfileForm.tsx:268` | tone template for qualified wording |
| Knowledge provenance header (feeds-generation vs reference-only) | Knowledge page (`KnowledgeBaseEditor`) | precedent for source labeling used in Task 6 |
| `GeneratedPlan.model` / `.promptVersion` fields (optional, already persisted) | `lib/types.ts:338-341` | surfaced for the first time in PlanPreview footer (Task 3) — display-only, optional-safe |

---

## Part B — Wording principles (binding for every changed string)

**W1 · Counts, not verdicts.** Evidence is stated as counts over named denominators ("3 validated · 0 refuted · 2 inconclusive of 5 evaluated"), never as a percentage of rightness, correctness, or accuracy. Sample size always visible; pending counts shown while accruing.

**W2 · Association vocabulary only.** The validation loop's own words — *validated / refuted / inconclusive / evaluated / decisive* — describe what happened after acting on a directive. Forbidden in user-facing strings: "right", "proved", "proven correct"/"proven poor", "accurate", "% right", "works", "success rate". The standard is symmetric: the review rejected "*proved right*" as pseudo-causal on thin correlated evidence, so its negative twin "*proven-poor*" goes too. The demotion **behaviour** (chip + generator-side demotion per `DIRECTIVE_DEMOTE_DEFAULTS`) stays exactly as shipped — review-endorsed — but the chip reads "demoted lever" with count-based tooltip evidence.

**W3 · Population conventions, not personal predictions.** Load bands and ramp guidelines are framed as conventional planning heuristics from population data ("above 1.5 is conventionally treated as a load spike"). Never "you risk injury", "danger for you", or any individualized injury forecast. The morning-check injury path (A2-4) is exempt: it reacts to a self-report, predicts nothing, and stays.

**W4 · Name the enforcement level.** Anything about plan checks says which thing happens: blocks publication vs warns and lets you write anyway vs auto-repairs visibly. No blanket "hard constraints".

**W5 · Label AI-authored text.** Optional Claude prose is labeled as drafted-by-AI enrichment and visually separable from deterministic facts; unapproved AI text never reads as a system conclusion (it already cannot steer generation — INVARIANT 59).

**W6 · Two-sentence privacy split.** Local persistence (what stays on disk) and remote processing (what goes to Anthropic, from which features) are disclosed in separate sentences/bullets, plain language, no hedging — never merged into one paragraph (decision Q21).

---

## Part C — Dispositions summary

| Item | Disposition |
|---|---|
| A1-1..A1-4 | **Qualify** — replace %/rightness copy with counts in validation vocabulary (Tasks 1) |
| A1-5, A1-6 | Docs update (Task 7); internal field name kept (Compatibility) |
| A2-1 | **Qualify/remove** — drop the injury-risk clause, keep the actionable easing advice (Task 2) |
| A2-2, A2-3 | **Qualify** — population-convention framing (Task 2) |
| A2-4 | **Retain** by decision record |
| A3-1, A3-2 | **Reword docs** to enforcement-level honesty (Task 7) |
| A3-3 | **Qualify (copy only)** — preview labels distinguish warn-only vs blocking classes; ⚠️ coordination-gated on the publication-safety stream's PlanPreview rework (Task 3) |
| A4-* | **Verify-only** — already shipped (Task 9 checklist) |
| A5-1..A5-4, A5-6 | **Remove** (Task 4) |
| A5-8 | **Retain** by decision record |
| A6-1, A6-2 | **Remove + replace deterministically** (Task 5) |
| A6-3 | **Retain + label** (Task 6) |
| A7/A8 | **Add disclosures** (Task 8) |

---

## Part D — Cross-cutting behavior definitions

### Provenance & confidence behavior
- Replaced accuracy badges keep their sample-size duty (W1): every replaced string renders the denominator.
- The demotion path stays fully visible (chip + generator-side demotion unchanged — `DIRECTIVE_DEMOTE_DEFAULTS` logic untouched).
- PlanPreview gains a one-line provenance footer reading `plan.model`/`plan.promptVersion` when present (both optional; absent → footer omitted). Display-only; no new data, no schema change.
- No new confidence tier is invented anywhere in this plan; existing tiers (CalibrationPanel, AthleteStateCard) are the only vocabulary.

### Privacy/network disclosure placement
- **README** (repo landing): new `## Data & privacy` section after "Setup", two separate bullets per W6, plus the existing localhost/no-auth note left in place.
- **In-app**: new static server-rendered `DataPrivacyCard` on Settings under the PLATFORM divider, beside AiUsageCard and BackupRestore (`app/settings/page.tsx`). Same two bullets, plus one pointer line to the AI usage card for spend. Static text — no fetch, no toggle.
- Disclosure content names the four remote call categories precisely: block generation, ride
  analysis (coach note), prose retrospectives, and structured retrospectives — each sends ride
  data/context to the Anthropic API. Deterministic ride-intent parsing is explicitly excluded.
  Ask Coach is gone by then and is not listed. Local bullet covers `data/` JSON +
  `knowledge-base/` markdown, export/import, and that nothing syncs to a cloud DB.

### Anthropic-unavailable behavior
- After Task 5, generation's post-model pipeline makes **zero** secondary LLM calls (critic gone); the overview check is pure TypeScript and runs identically offline.
- Retrospective closeout keeps its existing degraded path: `narrativeDegraded: true`, facts + seeds persist, prose absent, card says so (unchanged).
- Today loses its one `anthropicConfigured`-gated Ask branch (removed); coach-note re-analyse gating unchanged.
- Statement of record for reviewers: scoring, nutrition, readiness, reschedule, closeout, export/import all remain fully functional with no API key — this plan reduces, never adds, Anthropic coupling.

---

## Part E — Tasks

> Each task is independently shippable and reviewable. Tasks 1–3 are copy/tests only and touch disjoint files from Tasks 4–5 (code deletion) — but execute serially anyway (subagent-driven-development forbids parallel implementers).

### Task 1: Causal-accuracy copy → validation-vocabulary counts

**Files:**
- Modify: `components/StandingGuidance.tsx:27-37,77-92`
- Modify: `components/trends/verdict.tsx:85-115`
- Test: `components/StandingGuidance.test.tsx` (new — jsdom docblock per house idiom)

**Interfaces:**
- Consumes: existing `TrendsData["validation"]` shape (`byDimension[]` with `hitRate: number | null, validated, refuted, inconclusive`), `state.coachAccuracy` (`hitRatePct: number | null, evaluated, pending`) — **read-only; shapes unchanged**.
- Produces: rendered strings only; no exported symbols change.

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import StandingGuidance from "./StandingGuidance";

// Mock useSync minimal provider input
vi.mock("./SyncProvider", () => ({ useSync: () => ({ state: { lastSync: null, coachAccuracy: { hitRatePct: 67, evaluated: 3, pending: 2 } } }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined, error: null, refetch: vi.fn() }) }));

describe("StandingGuidance track-record wording", () => {
  it("states counts, never a percentage of rightness", async () => {
    render(<StandingGuidance />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("3 evaluated");
    expect(text).toContain("2 pending");
    expect(text).not.toMatch(/% right|proved right|accuracy/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run components/StandingGuidance.test.tsx`
Expected: FAIL — current header renders `67% right (3 checked)`.

- [ ] **Step 3: Reword the three strings**

`StandingGuidance.tsx` track-record action (lines 29-37) becomes:

```tsx
const trackRecord =
  acc && (acc.hitRatePct !== null || acc.pending > 0) ? (
    acc.hitRatePct !== null ? (
      <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
        {acc.evaluated} evaluated · {acc.pending} pending
      </span>
    ) : (
      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">accruing · {acc.pending} pending</span>
    )
  ) : undefined;
```

Per-dimension badge (lines 77-84) — emerald only when the record is at least even; amber-family when refuted outnumbers validated (a green "0/5" still reads as endorsement):

```tsx
{t?.hitRate != null && !demoted && (
  <span
    title={`Matured ${dimension} directives so far: ${t.validated} validated, ${t.refuted} refuted (${decisive} decisive evaluations).`}
    className={`font-mono font-normal normal-case ${
      t.validated >= t.refuted
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-amber-700 dark:text-amber-400"
    }`}
  >
    ✓ {t.validated}/{decisive}
  </span>
)}
```

Demotion chip + tooltip (lines 85-92):

```tsx
{demoted && (
  <span
    title={`Past ${dimension} directives: ${t!.validated} of ${decisive} decisive evaluations validated — the evidence stands; the coach reaches for a different lever.`}
    className="rounded bg-amber-50 px-1.5 font-normal normal-case text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
  >
    demoted lever
  </span>
)}
```

Apply the same two-tone treatment to `trends/verdict.tsx`'s mark (lines 100-107):

```tsx
{m && (
  <span
    title={`Matured ${ins.dimension} directives so far: ${m.validated} validated, ${m.refuted} refuted, ${m.inconclusive} inconclusive.`}
    className={`ml-1.5 font-mono text-[10px] font-normal ${
      m.validated >= m.refuted
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-amber-700 dark:text-amber-400"
    }`}
  >
    ✓ {m.validated}/{m.validated + m.refuted}
  </span>
)}
```

Check the same file's track-record summary (~line 128, `Insight track record · X evaluated · Y pending`) — already count-based; leave.

- [ ] **Step 4: Run tests**

Run: `npx vitest run components/StandingGuidance.test.tsx && npm run check`
Expected: PASS, full check green.

- [ ] **Step 5: Grep sweep for banned phrasing in components/**

Run: `rg -n "proved right|% right|coach accuracy|proven-poor" components/ app/ lib/ --glob '!*.test.*'`
Expected: no matches in rendered strings (comments in `lib/synthesis.ts` / `app/api/sync/route.ts` / `lib/intervention.ts` are internal-only; optionally reword them too — allowed, zero-risk).

- [ ] **Step 6: Commit**

```bash
git add components/StandingGuidance.tsx components/StandingGuidance.test.tsx components/trends/verdict.tsx
git commit -m "fix: replace causal-accuracy copy with validation-vocabulary counts"
```

---

### Task 2: Injury-risk wording → population-convention framing

**Files:**
- Modify: `lib/readiness.ts:175` (one string)
- Modify: `components/dashboard/today.tsx:96,684` (two MetricTip strings)
- Test: `lib/readiness.test.ts` (extend existing assertions)

**Interfaces:**
- Consumes: nothing new. Produces: changed `.reason` text for the load-ramp alert — grep consumers first (`computeLoadRamp` callers render it verbatim; `session-suggestion.ts:2` comment says its own text deliberately avoids that wording — unaffected).

- [ ] **Step 1: Write/extend the failing test**

In `lib/readiness.test.ts`, inside the load-ramp describe:

```ts
it("frames the ramp alert as a heuristic, never an individualized injury forecast", () => {
  const alerts = computeLoadRamp({ /* arrange the existing fixture that fires the alert */ });
  const ramp = alerts.find((a) => a.kind === "ramp");
  expect(ramp?.reason).toMatch(/conventional/i);
  expect(ramp?.reason).not.toMatch(/injur/i);
});
```

(Arrange using the exact fixture the neighboring ramp tests already build — copy it, don't invent values.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/readiness.test.ts`
Expected: FAIL — current reason contains "High overreach/injury risk" and lacks "conventional".

- [ ] **Step 3: Reword the strings**

`lib/readiness.ts:175`:

```ts
reason: `Load jumped ${changePct}% over the previous 7 days (${thisWeekTss} vs ${lastWeekTss} TSS) — well past the ~10% weekly step conventional planning heuristics suggest. Consider easing the next day or two.`,
```

`components/dashboard/today.tsx:96` tip:

```
"Flags when this week's training load jumps well above last week's — rapid ramps are a common overreaching signal in population training data."
```

`components/dashboard/today.tsx:684` ACWR tip:

```
`Acute:chronic workload ratio — your last 7 days of load (${acwr.acute} TSS/day) vs the last 28 (${acwr.chronic} TSS/day). Population data suggests 0.8–1.3; below that tends to come with detraining, above 1.5 is conventionally treated as a load spike.`
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/readiness.test.ts && npm run check`
Expected: PASS. If `today.test.tsx` snapshots pin the old tip strings, update those expectations in the same commit (mechanical).

- [ ] **Step 5: Commit**

```bash
git add lib/readiness.ts lib/readiness.test.ts components/dashboard/today.tsx
git commit -m "fix: frame load-ramp and ACWR wording as population heuristics, not personal risk"
```

---

### Task 3: Constraint-hardness honesty + plan-provenance footer — ⚠️ COORDINATION-GATED

**⛔ Sequencing gate.** The publication-safety stream has shipped its changes to
`components/PlanPreview.tsx`, `components/PlanPreview.test.tsx`, `lib/types.ts`, and the
generation/write gate. Rebase onto that shipped shape before touching PlanPreview. Two
implementers must not hold these files simultaneously (AGENTS.md disjoint-file law). Therefore:

- **Do NOT start this task until the publication-safety PR is present on the implementation base**, or, if that stream absorbs the footer, drop this task entirely.
- Keep only what the shipped tier panels did not deliver — item **3b** (provenance footer), plus any copy correction that preserves its blocker/preference/info taxonomy. Do not reintroduce the old flat warnings header or change gate semantics.

**Files (post-gate):**
- Modify: `components/PlanPreview.tsx` (header copy + provenance footer)
- Test: `components/PlanPreview.test.tsx` (extend)

**Scope fence:** string/label changes and one presentational footer only. No `onWrite` gating, no validator wiring, no `/api/write` contact — the hard-vs-preference gate is the publication-safety stream's deliverable.

**Interfaces:**
- Consumes: `GeneratedPlan.model?: string`, `GeneratedPlan.promptVersion?: number` (already optional in `lib/types.ts:338-341`).
- Produces: none exported.

- [ ] **Step 0: Confirm the gate**

Check open PRs / `git log --oneline origin/main -- components/PlanPreview.tsx` for the publication-safety merge. If it hasn't landed: report BLOCKED for this task, skip to Task 4 (tasks are order-independent from here), and revisit before final review.

- [ ] **Step 1: Write the failing tests**

Provenance footer:

```tsx
it("shows generation provenance when present", () => {
  render(
    <PlanPreview
      plan={{ ...basePlan(), model: "claude-sonnet-4-6", promptVersion: 7 }}
      writing={false}
      results={null}
      writeError={null}
      rollback={null}
      intervalsConfigured={true}
      hasActiveBlock={false}
      onWrite={vi.fn()}
      onDismiss={vi.fn()}
    />
  );
  expect(screen.getByText(/claude-sonnet-4-6 · prompt v7/i)).toBeTruthy();
});
```

(`basePlan()` = the fixture helper the file already uses; extend it with optional `model`/`promptVersion` passthrough.)

- [ ] **Step 2: Verify failure**

Run: `npx vitest run components/PlanPreview.test.tsx`
Expected: FAIL — no such labels/footer yet.

- [ ] **Step 3: Edit the copy**

Provenance footer, directly under the `<h2>Plan preview</h2>` row inside the header div:

```tsx
{(plan.model || plan.promptVersion != null) && (
  <p className="mt-0.5 text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
    {plan.model}{plan.model && plan.promptVersion != null ? " · " : ""}{plan.promptVersion != null ? `prompt v${plan.promptVersion}` : ""}
  </p>
)}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run components/PlanPreview.test.tsx && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/PlanPreview.tsx components/PlanPreview.test.tsx
git commit -m "fix: surface generation provenance in plan preview"
```

---

### Task 4: Remove Ask Coach end-to-end

**Files:**
- Delete: `components/AskCoach.tsx`
- Delete: `app/api/ask/` (route + test)
- Delete: `lib/ask-coach.test.ts`
- Modify: `components/dashboard/TodayView.tsx` (remove import + `askCoach` element + both render sites)
- Modify: `lib/anthropic-api.ts` (remove `askCoach`, `streamAskCoach`, `AskCoachContext` re-export)
- Modify: `lib/anthropic-prompts.ts` (remove `buildAskCoachPrompt` + its context interface)
- Modify: `components/AiUsageCard.tsx:46` (copy)
- Modify (comments only): `components/SyncProvider.tsx:138`, `app/api/sync/route.ts:190,1055` — stale `/api/ask` comment references

**Interfaces:**
- Consumes: nothing downstream consumes any deleted symbol — verify first (Step 1).
- Produces: `/api/ask` no longer exists; LLM call-site count drops 6 → 5 at this task boundary,
  then 5 → 4 after Task 5 removes the narrative critic (docs updated in Task 7).

- [ ] **Step 1: Prove nothing else imports the surface**

Run: `rg -n "AskCoach|buildAskCoachPrompt|streamAskCoach|askCoach|AskCoachContext|api/ask" --glob '!node_modules' --glob '!docs/' --glob '!ARCHIVE.md' --glob '!CONTINUE.md'`
Expected hits: only the files listed above, plus the two comment-only references in `app/api/sync/route.ts:190,1055` (update those comments to point at `/api/generate` in this task — comment-only edits).

- [ ] **Step 2: Remove the UI first (keeps typecheck red-green clean)**

Delete from `TodayView.tsx`: the `import AskCoach` line, the `askCoach` conditional (lines ~123-131), and both `{askCoach}` render expressions. Replace each render site with nothing — the surrounding layout collapses naturally (both sites sit inside existing flex/detail stacks; no spacer shims).

- [ ] **Step 3: Delete route, component, prompt builder, call functions, tests**

```bash
git rm components/AskCoach.tsx app/api/ask/route.ts app/api/ask/route.test.ts lib/ask-coach.test.ts
```

Then in `lib/anthropic-api.ts`: delete `askCoach` (:358-364), `streamAskCoach` (:374-389), and the `buildAskCoachPrompt`/`AskCoachContext` entries from the re-export lists (:16-20, :35-36). In `lib/anthropic-prompts.ts`: delete the `AskCoachContext` interface (:714+) and `buildAskCoachPrompt` (:732+). In `components/SyncProvider.tsx:138`: reword the comment to reference TodayView's former self-guard historically or simply drop the sentence. In `app/api/sync/route.ts:190,1055`: update the "same builder as /api/ask" comments to name `/api/generate`. In `components/AiUsageCard.tsx:46`: `Estimated running Anthropic spend across block generation, ride analysis, prose retrospectives, and structured retrospectives.` (must match Task 8's four remote call categories exactly; deterministic intent parsing is excluded).

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: green (typecheck proves no dangling imports; `app/api/ask/route.test.ts` deletion removes its own suite).

- [ ] **Step 5: Manual smoke**

Run: `npm run dev` → Today page renders pre-ride and post-ride modes with no Ask Coach disclosure and no console errors; `curl -i -X POST http://localhost:3000/api/ask` returns 404.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/TodayView.tsx components/SyncProvider.tsx components/AiUsageCard.tsx app/api/sync/route.ts lib/anthropic-api.ts lib/anthropic-prompts.ts
git commit -m "feat(remove): retire Ask Coach surface, route, and prompt per freeze decision Q52"
```

---

### Task 5: Replace the narrative critic with a deterministic overview check

**Files:**
- Create: `lib/overview-check.ts` (+ `lib/overview-check.test.ts`)
- Modify: `app/api/generate/route.ts` (swap critic call for the check; imports)
- Move: `extractBlockFacts` + `WeekFacts` out of `lib/narrative-critic.ts` into `lib/overview-check.ts`, then **delete** `lib/narrative-critic.ts` and `lib/narrative-critic.test.ts`'s critic halves
- Modify: `lib/anthropic-api.ts` (remove `critiqueOverview`, `buildNarrativeCriticPrompt`/tool re-exports)

**Interfaces:**
- Consumes: `PlannedDay[]`, `weekTargets` (same inputs the critic received at the current
  `app/api/generate/route.ts` seam).
- Produces: `checkOverviewAgainstFacts(overview: string, weeks: WeekFacts[]): string[]` — pure,
  warn-only, offline-testable (ADR-0002 pattern). The function never returns replacement prose.

Design note (codebase-design): the seam stays exactly where the critic's was — one pure function between the model's returned plan and the response assembly. The interface shrinks (no async, no SDK types, no tool schema) while keeping the behaviour callers relied on (overview-vs-schedule disagreements become visible), i.e. deeper, not shallower.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { checkOverviewAgainstFacts, extractBlockFacts, type WeekFacts } from "./overview-check";

const week = (over: Partial<WeekFacts>): WeekFacts => ({
  weekNumber: 1,
  isRecovery: false,
  totalHours: 12,
  qualityCounts: { Threshold: 1 },
  longestRideMinutes: 240,
  ...over,
});

describe("checkOverviewAgainstFacts", () => {
  it("returns [] when the overview agrees with the schedule", () => {
    const warnings = checkOverviewAgainstFacts(
      "Week 1 is a 12-hour week built around a threshold session.",
      [week({})],
    );
    expect(warnings).toEqual([]);
  });

  it("flags a stated hour total that contradicts the scheduled total for that week", () => {
    const warnings = checkOverviewAgainstFacts("Week 1 is a big 16-hour building week.", [week({})]);
    expect(warnings).toEqual([
      "Overview says 16h for week 1, but the scheduled total is 12h.",
    ]);
  });

  it("flags a session type named in a week the schedule does not give it to", () => {
    const weeks = [week({}), week({ weekNumber: 2, totalHours: 10, qualityCounts: { VO2max: 1 } })];
    const warnings = checkOverviewAgainstFacts(
      "Week 1 centers on VO2max work. Week 2 is a 10-hour maintenance week around threshold.",
      weeks,
    );
    expect(warnings).toEqual([
      'Overview names "VO2max" in week 1, but no VO2max session is scheduled that week.',
    ]);
  });

  it("flags the historical false SIT-escalation claim", () => {
    const warnings = checkOverviewAgainstFacts(
      "Week 1 escalates SIT work from one session to two.",
      [week({ qualityCounts: { Threshold: 1 } }), week({ weekNumber: 2, qualityCounts: { Threshold: 1 } })],
    );
    expect(warnings).toContain(
      'Overview claims escalating SIT work in week 1, but no SIT session is scheduled that week.',
    );
  });

  it("flags the historical four-hour description of a 190-minute ride", () => {
    const warnings = checkOverviewAgainstFacts(
      "Week 1 includes a four-hour ride.",
      [week({ longestRideMinutes: 190 })],
    );
    expect(warnings).toContain(
      "Overview describes a 4-hour ride in week 1, but the longest scheduled ride is 190 minutes.",
    );
  });

  it("never mutates the overview — warnings only", () => {
    const overview = "Week 1 is a 12-hour week.";
    checkOverviewAgainstFacts(overview, [week({})]);
    expect(overview).toBe("Week 1 is a 12-hour week.");
  });
});
```

Plus port the existing `extractBlockFacts` tests verbatim from `lib/narrative-critic.test.ts` (they already exist and pass — they move, unchanged, to `overview-check.test.ts`).

- [ ] **Step 2: Verify failure**

Run: `npx vitest run lib/overview-check.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

Move `WeekFacts`, `extractBlockFacts` (verbatim) from `narrative-critic.ts`; add (checks are sentence-scoped so a multi-week overview never compares one week's claim against another week's total):

```ts
import type { WorkoutType } from "./types";

const SENTENCE_RE = /[^.!?]+[.!?]/g;
const CHECKED_TYPES: WorkoutType[] = ["Threshold", "VO2max", "SIT", "RaceSim"];

export function checkOverviewAgainstFacts(overview: string, weeks: WeekFacts[]): string[] {
  const warnings: string[] = [];
  const sentences = overview.match(SENTENCE_RE) ?? [];
  const allTypes = CHECKED_TYPES;

  for (const s of sentences) {
    const lower = s.toLowerCase();
    for (const w of weeks) {
      if (!lower.includes(`week ${w.weekNumber}`)) continue;

      // One fact, one owner: this validator owns overview-vs-schedule agreement only.
      const hourMatch = s.match(/(\d+(?:\.\d+)?)\s*-?\s*hour/i);
      if (hourMatch && Math.abs(parseFloat(hourMatch[1]) - w.totalHours) >= 1) {
        warnings.push(
          `Overview says ${hourMatch[1]}h for week ${w.weekNumber}, but the scheduled total is ${w.totalHours}h.`,
        );
      }

      for (const t of allTypes) {
        if (!lower.includes(t.toLowerCase())) continue;
        if (!(w.qualityCounts[t] ?? 0)) {
          warnings.push(
            `Overview names "${t}" in week ${w.weekNumber}, but no ${t} session is scheduled that week.`,
          );
        }
      }

      const rideHours = s.match(/(?:a|an|one|the)?\s*(\d+(?:\.\d+)?)\s*-?\s*hour ride/i);
      if (rideHours && Number(rideHours[1]) * 60 - w.longestRideMinutes >= 30) {
        warnings.push(
          `Overview describes a ${rideHours[1]}-hour ride in week ${w.weekNumber}, but the longest scheduled ride is ${w.longestRideMinutes} minutes.`,
        );
      }

      for (const t of allTypes) {
        if (!new RegExp(`(?:escalat|progress|increas)[^.!?]*\\b${t}\\b`, "i").test(s)) continue;
        if (!(w.qualityCounts[t] ?? 0)) {
          warnings.push(
            `Overview claims escalating ${t} work in week ${w.weekNumber}, but no ${t} session is scheduled that week.`,
          );
        }
      }
    }
  }
  return warnings;
}
```

(Run the loop body against the real `WeekFacts` field names from the moved code — the moved `extractBlockFacts` is authoritative; adapt field spellings and the hour regex to how overviews actually phrase totals if its fixtures differ.)

- [ ] **Step 4: Wire into the generate route; delete the critic**

`app/api/generate/route.ts`: replace the `critiqueOverview(...)` block (:534 area) with the same
guarded, warn-only seam. Preserve the existing critic guard so incomplete plans do not receive
misleading overview findings:

```ts
let overviewWarnings: string[] = [];
if (!truncated && days.length === expected.length) {
  overviewWarnings = checkOverviewAgainstFacts(
    overview,
    extractBlockFacts(days, weekTargets),
  );
}
```

and append `overviewWarnings` to whatever composes `warnings[]` at response assembly (follow the existing append pattern; they flow to PlanPreview automatically). Update imports: `checkOverviewAgainstFacts, extractBlockFacts` from `@/lib/overview-check`. Delete the `critiqueOverview` import.

`lib/anthropic-api.ts`: delete `critiqueOverview` (:288-306), the `narrative-critic` import line, and the re-export of critic symbols. Then check haiku's remaining consumers: ask-coach (Task 4) and the critic were its only two. If `rg -n "QUICK_MODEL" --glob '!*.test.*'` shows zero remaining references after both tasks, delete the constant. Leave `ai-usage.ts`'s PRICING keys untouched either way — historical rows still deserialize, and INVARIANT 18's duplication rule concerns live models only.

```bash
# after porting the surviving extractBlockFacts tests into lib/overview-check.test.ts:
git rm lib/narrative-critic.ts lib/narrative-critic.test.ts
```

Update `app/api/generate/route.test.ts`: remove the `critiqueOverview` mocks (:33-38, :382-404) and the "critic not called" assertions; add one assertion that a contradictory overview yields the warning in the response's `warnings[]` (reuse the existing mocked-plan fixture, change its overview text).

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: green.

- [ ] **Step 6: LIVE SMOKE RUN (mandatory — AGENTS.md rule; the generation path changed)**

Run: `npm run dev`, trigger one real 2-week block generation, read the overview + warnings in PlanPreview, and confirm `data/ai-usage.json` recorded **exactly one** sonnet call (no haiku critic entry for this request). Record the outcome in the task report.

- [ ] **Step 7: Commit**

```bash
git add lib/overview-check.ts lib/overview-check.test.ts app/api/generate/route.ts app/api/generate/route.test.ts lib/anthropic-api.ts
git commit -m "feat: replace narrative-critic LLM call with deterministic overview consistency warnings"
```

---

### Task 6: Label the retained retrospective narrative as optional AI enrichment

**⚠️ Coordination note:** the publication-safety stream also touches `components/dashboard/plan.test.tsx`. Before starting, check whether its PR is open; if so, sequence this task after it merges (same gate discipline as Task 3) or coordinate test-file ownership explicitly.

**Files:**
- Modify: the closeout card render in `components/dashboard/plan.tsx` (RetroSection area) and/or `components/dashboard/PlanView.tsx` — wherever the retro narrative prose renders (locate via `narrativeDegraded` prop flow, `plan.tsx:70`, `PlanView.tsx:68,339`)
- Test: extend the matching existing component test (`dashboard/plan.test.tsx`)

**Interfaces:** display-only; adds a label line when `retrospective` (the narrative string) is non-empty.
The live Plan UI must also be checked for `structuredReflections`: today it renders only the
adoption status, not the AI-generated reflection text. Preserve that behavior. If the render path
changes before this task lands and reflection text is displayed, label it as optional AI-drafted
enrichment in the same component and extend the test accordingly.

- [ ] **Step 1: Failing test** — render the closeout card fixture with `retrospective: "Some narrative."` and assert the string `AI-drafted narrative — optional enrichment; the evidence card above is deterministic` appears in the document; with narrative absent, assert it doesn't. Also render a history entry with `structuredReflections` and assert the reflection body is not rendered as unlabeled prose; only the existing adoption-status line appears.

- [ ] **Step 2: Implement** — one `<p className="text-[10px] uppercase tracking-wider text-zinc-400">` label line above the narrative prose block, conditioned on narrative presence. Match the Knowledge-page provenance-header styling precedent (compact, uppercase, muted).

- [ ] **Step 3: Verify + commit**

Run: `npx vitest run components/dashboard/plan.test.tsx && npm run check`

```bash
git add components/dashboard/plan.tsx components/dashboard/plan.test.tsx
git commit -m "fix: label retrospective Claude narrative as optional AI enrichment"
```

---

### Task 7: Documentation updates (single docs commit)

Allowed edits (docs-sweep ownership: each fact updated in its owning doc only):

1. `FEATURES.md`: delete the Ask-Coach capability line (Today section, :167-169); reword the Model-page "coach accuracy" phrase (:194-195) to "validation track record — validated/refuted counts per dimension"; reword the narrative-coherence critic line (:94-96) to the deterministic overview check; add the DataPrivacyCard to Settings list.
2. `docs/systems/07-ai-layer.md`: call-site table drops rows #2 (critic) and #6 (ask) — header count "exactly six" → "exactly four"; module table removes ask/critic prompt ownership; Known-rough-edges bullets about ask-coach system-param and misplaced tests deleted. Keep the deterministic intent note: it is not an LLM call site.
3. `docs/systems/06-generation.md`: pipeline diagram node K + §3 narrative-critic bullet → deterministic overview check (warn-only, cite INVARIANT 13/33 compliance).
4. `docs/systems/03-daily-loop.md`: remove Ask Coach from the post-ride surface list and retain the deterministic intent-parsing description.
5. `docs/systems/08-frontend.md`: feature-ownership table Ask Coach row removed; test-coverage note updated if it counted ask-related suites.
6. `docs/FILE_INDEX.md`: remove the `ask` route row (:130) and the ask-coach test-file note (:119).
7. `README.md:43` loop sentence: "Claude drafts the training block's sessions and prose inside numeric limits the engines define and validators check" (enforcement-level honesty, W4); add `## Data & privacy` section (Task 8 shares this commit or lands separately — see Task 8).
8. `docs/COMPASS.md:7` mental-model line: same reword, shorter.
9. `docs/INVARIANTS.md` **#13 amendment** (stale-pointer prevention): the sentence "The narrative critic may rewrite the **overview prose** only" must be updated to record that the critic was removed 2026-08 and the only sanctioned mutations are the two deterministic repairs. Amend in place with a dated note; do not renumber.
10. `docs/DECISIONS.md` ADR-0004 pointer check: its closing sentence references the narrative critic's overview-only rewrite — append a dated amendment note ("narrative critic removed; see overview-check") rather than rewriting the decision body (decision-record law).
11. `docs/systems/02-scoring-and-learning.md` § block-closeout paragraph and `docs/systems/05-season.md`'s P3c rough-edge entries name the narrative critic where one exists (`rg -n "narrative critic|critiqueOverview|narrative-critic" docs/`) — update each mention to the deterministic overview check or mark removed, per doc ownership.
12. `lib/README.md`: remove the `narrative-critic` entry if present (:15 area).
13. `docs/systems/07-ai-layer.md` smoke-run instructions ("generate a block / re-analyse today / ask the coach"): drop "ask the coach" and state that the remaining four call sites are generation, ride analysis, prose retrospective, and structured retrospective.
14. **Drift flags only (do not fix here):** FEATURES.md lines ~6-8, ~158-160, ~230-232 contain corrupted/garbled sentences (pre-existing); report them to the user for a docs-sweep session; do not repair in this plan.

Anchor discipline (INVARIANT 31): before renaming/removing any heading referenced above, `rg` the old slug repo-wide.

- [ ] Verify link integrity: `npm run check` includes link validation per the review's audit — confirm green.
- [ ] Commit: `git commit -m "docs: reconcile AI-surface docs with Ask Coach removal and deterministic overview check"`

### Task 8: Privacy disclosures (two placements, one wording source)

**Files:**
- Create: `components/DataPrivacyCard.tsx` (server-rendered, mirrors AiUsageCard's presentational pattern)
- Modify: `app/settings/page.tsx` (render under PLATFORM divider, after AiUsageCard)
- Modify: `README.md` (new section)

- [ ] **Step 1: Component** (static; no test framework ceremony needed beyond a smoke render — but per house law add the jsdom test):

```tsx
import { Card } from "./ui";

// Static privacy disclosure — decision Q21: local persistence and remote AI processing are
// disclosed SEPARATELY. Copy owned here + README; keep the two in sync deliberately (three-copy
// risk acknowledged: two placements, one fact owner = this component for in-app, README §Data & privacy for repo).
export default function DataPrivacyCard() {
  return (
    <Card title="Data & privacy">
      <ul className="list-disc space-y-1.5 pl-4 text-sm text-zinc-500 dark:text-zinc-400">
        <li>
          <strong className="text-zinc-700 dark:text-zinc-200">Stored locally.</strong> All your
          data — scores, plans, notes, settings, the knowledge base — lives as JSON and markdown
          files on this machine. Nothing is uploaded to a cloud database; backups are files you
          export yourself.
        </li>
        <li>
          <strong className="text-zinc-700 dark:text-zinc-200">Processed remotely by Anthropic.</strong>{" "}
          Four call categories send data off this machine to the Anthropic API: block generation,
          the ride-analysis coach note, prose retrospectives, and structured retrospectives. Per-call
          spend is tracked under AI usage &amp; cost. Intent parsing is deterministic and does not contact
          Anthropic.
        </li>
        <li>Everything else — scoring, nutrition, readiness, scheduling, backup — runs without contacting Anthropic. Your physiology and ride data sync from Intervals.icu (one-way pull), and plan moves mirror to its calendar; Intervals.icu remains that data's system of record.</li>
      </ul>
    </Card>
  );
}
```

- [ ] **Step 2: Wire + test** — render `<DataPrivacyCard />` in `app/settings/page.tsx` after `<AiUsageCard />`; jsdom test asserting both bold lead-ins and the word "Anthropic" render, and that "local" and "remote" appear in **separate list items** (assert two `<li>`).

- [ ] **Step 3: README section** (after Setup, before Development):

```markdown
## Data & privacy

- **Local persistence.** NodeVelo stores everything — your ledger, plans, intent notes, knowledge
  base, settings — as JSON and markdown files on your machine (`data/`, `knowledge-base/`). There
  is no cloud database; export/import produces files you control.
- **Remote AI processing.** Block generation, the ride-analysis coach note, prose retrospectives,
  and structured retrospectives send ride data and context to the Anthropic API for processing.
  Intent parsing is deterministic and does not contact Anthropic. Costs are tracked locally in-app.
  No other feature contacts Anthropic.
- **Intervals.icu.** Your physiology and ride data are pulled from Intervals.icu (one-way), and
  accepted plans mirror back to its calendar; it remains that data's system of record.
```

- [ ] **Step 4: Verify + commit** — `npm run check`; commit both placements together: `feat: add separated local-persistence and remote-Anthropic privacy disclosures`

### Task 9: Verification & decision-record conformance sweep (final gate)

- [ ] **A4 verification (already-shipped claim):** `npx vitest run lib/kb-loader.test.ts lib/retrospective-schema.test.ts app/api/history/route.test.ts app/api/generate/route.test.ts` — all adoption-gate tests pass unmodified; confirms INVARIANT 59 intact and no task regressed it.
- [ ] **Banned-phrase sweep (user-facing strings):** `rg -n "proved right|% right|coach accuracy|injury risk|injury-risk|proven-poor" components/ app/ lib/ --glob '!*.test.*'` → expected: zero hits in rendered strings (`lib/morning-check.ts` injury-rest guidance and internal comments exempt per A2-4/A2-5; `demoted lever` chip exempt).
- [ ] **Full check:** `npm run check` green.
- [ ] **Smoke evidence attached:** Task 5's live-run note (calls recorded, output read) present in the final report.
- [ ] **Scope audit:** `git diff --stat main...HEAD` — confirm no `app/api/write/`, no `lib/physiology*`, no ROADMAP/ARCHIVE/todo/CONTINUE changes.

---

## Compatibility concerns

1. **Wire field `coachAccuracy` keeps its name** (sync GET payload). Renaming would break the client/server pair for zero athlete-visible benefit; only display copy changes. Note the name-vs-copy mismatch in `app/api/sync/route.ts`'s adjacent comment so the next reader isn't confused.
2. **`PROMPT_VERSION` does not move** (Global Constraint 5). Neither deleted call stamped artifacts. If a reviewer disagrees, the counter is INVARIANT 54's reasoning: bumping would falsely assert changes to generated plans/today analyses/block-history.
3. **`QUICK_MODEL` orphaning:** after Tasks 4–5 haiku has no caller. Delete the constant only if grep proves zero references; otherwise leave with a comment. Either way `ai-usage.ts` PRICING keys stay untouched (historical usage rows still deserialize; INVARIANT 18's duplication rule is about live models).
4. **Historical `data/ai-usage.json` rows for ask-coach/critic calls** remain legible; AiUsageCard groups by stored model string — cosmetic only, nothing breaks.
5. **No persisted-schema change anywhere** → no migration flags, no truthy-check concerns (recurring bug class not applicable).
6. **Component-test drift:** `dashboard/today.test.tsx` may pin old MetricTip strings (Task 2) and `SyncProvider.test.tsx` may exercise the removed guard comment path (comment-only — safe). Update pinned strings mechanically in the same commits.
7. **Docs anchors:** removing the 07-ai-layer call-site table rows doesn't rename headings, but the "Debugging a bad generation" section is hot-linked (COMPASS, AGENTS.md) — leave that heading intact.

## File ownership (disjointness guarantees)

This plan owns: `components/{StandingGuidance,trends/verdict,PlanPreview,AiUsageCard,DataPrivacyCard,dashboard/TodayView,dashboard/plan}.tsx`, `lib/{readiness,overview-check,anthropic-api,anthropic-prompts}.ts`, deletions (`AskCoach.tsx`, `app/api/ask/`, `lib/narrative-critic.ts`, `lib/ask-coach.test.ts`), `app/settings/page.tsx`, README/COMPASS/FEATURES/systems-docs/FILE_INDEX edits listed in Task 7, and their tests.

Explicitly **not owned** (other streams): `app/api/write/route.ts` + any validator gate escalation (publication safety); `lib/physiology.ts`, sync-route physiology handling (physiology freshness); ROADMAP/ARCHIVE/todo reconciliation (backlog owner). If a conflict emerges mid-execution, stop and surface it rather than editing across streams.

## Integration checkpoints

- After **each** task: `npm run check` green + commit staged to only that task's files.
- After **Task 4**: manual Today walkthrough (both modes) + `/api/ask` 404 proof.
- After **Task 5**: mandatory live generation smoke (Constraint 6) — this is the plan's single live-API gate.
- After **Task 9**: whole-diff review per subagent-driven-development's final review; PR opened only via `npm run finish:agent-task` (never manual push).
- Post-merge docs ritual (implementer's closing duty per COMPASS): FEATURES/ARCHIVE moves belong to the merge session, not this plan's tasks beyond Task 7's specified edits.

## Explicit non-goals

- No provider migration, model switch, prompt-cache change, budget guard, or cost telemetry redesign.
  Those belong to a separate measured experiment: hold deterministic inputs/prompts constant,
  compare schema validity, validator findings, truncation, athlete-visible usefulness, latency, and
  dollars per successful result over a fixed sample before changing a live model route.
- No publication-gate implementation, informed-override flow, or write-route changes (Phase 1's separate bullet).
- No physiology freshness UI or blocking behavior.
- No page consolidation, nav restructuring, or prose-density redesign (Phase 2/7).
- No conversational-refinement, workout-library, nutrition, or event work.
- No reopening of Ask Coach's fate, the freeze, or the evidence gate — all settled in the decision record.
- No repair of the pre-existing FEATURES.md corruption beyond flagging (Task 7 item 9).
