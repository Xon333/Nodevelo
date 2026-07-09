# UX v2 Wave 4 — Profile Dossier + Model Three-Groups Implementation Plan (+ Task 0 hitRate fix)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute UX-MASTERPLAN v2 Wave 4 — Model becomes three stacked groups (NOW: fused score + ranked drivers as signed magnitude bars · LEARNED: calibration card-ified with provenance chips · STANDING GUIDANCE: directives rendered from their structured source, one line each, evidence behind "why ▸", validation ✓ / proven-poor flags), and Profile becomes a readable dossier (rider-read hero group with weight · zones & effort bands · goals/weakpoints and nutrition as compact read views with the edit forms behind inline disclosures). Task 0 (independent, found during planning): Wave 3's `InsightsFold` renders the 0–1 `hitRate` fraction with a `%` suffix — "✓ 0.67%" instead of "✓ 67%".

**Architecture:** Presentation-layer only — no API routes or lib logic change. `StateDriversCard` gains magnitude bars; `CalibrationPanel` re-lays its existing override state machine into per-param cards; a new `StandingGuidance` component replaces `CoachDirectivesCard` (deleted), rendering the structured `Insight[]` + per-dimension validation from the existing `/api/trends` query (same TanStack key as the Trends page → shared cache, zero payload changes) with the demote rule imported from `lib/synthesis`; `app/model/page.tsx` gains the three `SectionDivider` groups. `AthleteProfileForm` is regrouped under dossier dividers and its two open forms move behind `<details>` disclosures. Spec: `UX-MASTERPLAN.md` §6 (Profile + Model) + §7.4; success measures §8 ("Profile: no edit form visible before its disclosure is opened. Model: zero multi-paragraph prose blocks outside `<details>`").

**Tech Stack:** Next.js 16 App Router · React 19 · Tailwind v4 · TypeScript 5 · Vitest.

## Global Constraints

- **Run commands with `npm`** (`npm test` = `vitest run`, `npm run build`, `npm run check` = tsc + lint + test — all green at base).
- **This checkout is shared with a concurrent agent session.** Stage only files you touched (`git add <path>...`), never `git add -A` / `git add .`. Before editing a file, `git status --short <file>` — uncommitted foreign changes: wait ~30s, re-check once, else STOP and report BLOCKED. A build error in a file you did NOT edit: status-check first; uncommitted = other agent mid-edit (wait, retry once, else stop and report).
- **Commit directly on `main`** (trunk-based; no branch).
- **This Next.js version differs from training data.** Read `node_modules/next/dist/docs/` before writing code if any App Router question arises.
- **No API/payload/lib-logic changes.** `/api/trends`, `/api/profile`, `/api/calibration`, `lib/synthesis.ts`, `lib/intervention.ts` are all read-only for this wave.
- **Units gotcha (bit Wave 3):** `ValidationData.byDimension[].hitRate` is a 0–1 fraction (lib/intervention.ts:187); `coachAccuracy.hitRatePct` is 0–100. Any rendered percentage from `hitRate` must be `Math.round(hitRate * 100)`.
- **Verification model:** JSX-only wave — gates are `npm run check`, `npm run build`, and the controller's live preview walk (dark first). No new unit tests expected; no LLM path changes (AGENTS.md smoke rule not triggered).
- **Out of scope (Wave 5):** Plan hero/week strip, Settings grouping, Knowledge header, density polish (incl. the deferred strip/chart down-color alignment and the DeliveryCard `type="button"` polish — do NOT do them here).

---

### Task 0: Fix the Wave 3 hitRate percentage display in `InsightsFold`

**Files:**
- Modify: `components/trends/verdict.tsx`

**Why:** `mark()` returns a `byDimension` entry whose `hitRate` is a 0–1 fraction, but the chip renders `✓ {m.hitRate}%` — a 67% hit rate would display as "✓ 0.67%". Unnoticed live because no dimension has a matured hit rate yet.

- [ ] **Step 1: Fix the chip**

In `components/trends/verdict.tsx`, in the insight `row` renderer, replace:

```tsx
                ✓ {m.hitRate}%
```

with:

```tsx
                ✓ {Math.round(m.hitRate * 100)}%
```

(The chip's `title` counts — validated/evaluated — are integers and stay as they are.)

- [ ] **Step 2: Verify + commit**

Run: `npm run check` → green; `npm run build` → clean.

```bash
git add components/trends/verdict.tsx
git commit -m "fix(trends): validation mark renders hitRate fraction as a percentage (W3 follow-up)"
```

---

### Task 1: Model NOW — `StateDriversCard` drivers become signed magnitude bars

**Files:**
- Modify: `components/StateDriversCard.tsx`

**Interfaces:**
- Consumes: `AthleteState.drivers` — already sorted by `|effect|` descending (lib/athlete-state.ts:129), each `{ key, dir, note, effect }`; `driverEffectClass`, `DIR`, `BAND_COLOR` from `./athlete-state-ui` (unchanged).
- Produces: same component signature; only the drivers list rendering changes.

- [ ] **Step 1: Replace the drivers `<ul>` with the bar layout**

In `components/StateDriversCard.tsx`, after `const s = state?.athleteState ?? null;` add:

```tsx
  // Bars scale to the biggest mover so relative magnitude reads at a glance (masterplan §6 NOW:
  // "signed magnitude bars, largest first" — the list is already |effect|-sorted upstream).
  const maxAbs = s && s.drivers.length > 0 ? Math.max(...s.drivers.map((d) => Math.abs(d.effect))) : 1;
```

Then replace the whole `{s.drivers.length > 0 && ( <ul …> … </ul> )}` block with:

```tsx
          {s.drivers.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {s.drivers.map((d) => {
                const pct = Math.max(6, Math.round((Math.abs(d.effect) / maxAbs) * 100));
                const positive = d.effect > 0;
                return (
                  <li key={d.key} className="grid grid-cols-[minmax(0,1fr)_5.5rem_2.5rem] items-center gap-2">
                    <span title={d.note} className="min-w-0 truncate text-xs text-zinc-600 dark:text-zinc-300">
                      {DIR[d.dir]} {d.note}
                    </span>
                    <span aria-hidden className="flex h-2 items-center overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                      <span
                        className={`h-full rounded-full ${positive ? "bg-emerald-500/80 dark:bg-emerald-400/70" : "bg-amber-500/80 dark:bg-amber-400/70"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className={`text-right font-mono text-xs ${driverEffectClass(d.effect)}`}>
                      {d.effect > 0 ? "+" : ""}
                      {d.effect}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
```

Everything else in the file (score row, headline, empty state, Card wrapper) stays byte-identical.

- [ ] **Step 2: Verify + commit**

Run: `npm run check` → green; `npm run build` → clean. Preview note: the controller checks /model rendering after the page rewrite lands (Task 3).

```bash
git add components/StateDriversCard.tsx
git commit -m "feat(model): state drivers render as signed magnitude bars (UX v2 W4)"
```

---

### Task 2: Model LEARNED — `CalibrationPanel` card-ified

**Files:**
- Modify: `components/CalibrationPanel.tsx`

**Interfaces:**
- Consumes: everything it already consumes (ROWS config, `resolveCalibratedValue`, `/api/calibration` POST, `useSync` calibration state) — the override state machine is UNCHANGED, only the layout moves from list rows inside one card to one `Card` per parameter.
- Produces: `CalibrationPanel()` now returns a `grid gap-3 sm:grid-cols-2` of per-param cards (or a single "Sync to compute" card when calibration is absent). The old intro paragraph moves to the Model page (Task 3 renders it under the LEARNED divider).

- [ ] **Step 1: Restructure**

In `components/CalibrationPanel.tsx`:

1. Rename `ParamRow` → `ParamCard`, change its root from `<li className="border-t …">` to a `Card` (the `Card` import already exists), computing a provenance chip. The full new component wrapper (its state, `save`/`startEdit`/`submit` handlers, and the `editing ? … : …` controls block are **kept verbatim** — only the wrapping JSX around them changes):

```tsx
function ParamCard({
  row,
  param,
  onSaved,
}: {
  row: RowConfig;
  param: CalibratedParameter | undefined;
  onSaved: (calibration: CalibrationStore) => void;
}) {
  const effective = resolveCalibratedValue(param ?? null, row.populationDefault);
  const overridden = param?.manualOverride != null;

  /* …existing editing/draft/saving/error state + save/startEdit/submit handlers, verbatim… */

  // Provenance chip (Constitution §5: where did this number come from?) — set-by-you beats
  // learned beats default; "learning but not yet trusted" still shows the default chip and the
  // detail() line below explains why.
  const provenance = overridden
    ? "set by you"
    : param && param.source !== "default" && effective === param.value
      ? `learned · ${param.dataPoints} rides`
      : "default";
  const chipCls = overridden
    ? "bg-zinc-100 text-zinc-600 dark:bg-[#ff49c8]/10 dark:text-[#ff49c8]"
    : provenance.startsWith("learned")
      ? "bg-cyan-50 text-cyan-700 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff]"
      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-700/50 dark:text-zinc-400";

  return (
    <Card
      className="h-full"
      title={row.label}
      action={
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chipCls}`}>
          {provenance}
        </span>
      }
    >
      <p className="font-mono text-2xl font-bold leading-none text-zinc-900 dark:text-zinc-100">
        {effective.toFixed(1)}
        <span className="ml-0.5 font-sans text-xs font-normal text-zinc-500 dark:text-zinc-400">{row.unit}</span>
        {param && param.source !== "default" && param.confidence !== "high" && (
          <span
            className={`ml-2 align-middle font-sans text-[10px] font-medium ${
              param.confidence === "low" ? "text-amber-600 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {param.confidence} confidence
          </span>
        )}
      </p>
      <p className="mt-1.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{row.blurb}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{detail(param, effective)}</p>

      {/* …existing `editing ? (…) : (…)` controls block and the error line, verbatim… */}
    </Card>
  );
}
```

2. Replace the default export with:

```tsx
// LEARNED (UX v2 §6 Model): one card per learned value — number, provenance, confidence tier,
// contest/correct inline. The group intro sentence lives on the page under the LEARNED divider.
export default function CalibrationPanel() {
  const { state, setState } = useSync();
  const cal = state?.calibration ?? null;
  const onSaved = (calibration: CalibrationStore) => setState((s) => (s ? { ...s, calibration } : s));

  if (!cal) {
    return (
      <Card title="Per-athlete calibration">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Sync to compute your calibration.</p>
      </Card>
    );
  }
  return (
    <div className="grid items-stretch gap-3 sm:grid-cols-2">
      {ROWS.map((row) => (
        <ParamCard key={row.param} row={row} param={cal[row.param]} onSaved={onSaved} />
      ))}
    </div>
  );
}
```

The old wrapping `Card title="Per-athlete calibration"` with its intro `<p>` is deleted (the intro sentence reappears on the page in Task 3).

- [ ] **Step 2: Verify + commit**

Run: `npm run check` → green; `npm run build` → clean.

```bash
git add components/CalibrationPanel.tsx
git commit -m "feat(model): calibration card-ified — provenance chips + confidence tiers (UX v2 W4)"
```

---

### Task 3: Model STANDING GUIDANCE + the three-group page

**Files:**
- Create: `components/StandingGuidance.tsx`
- Modify: `app/model/page.tsx` (full rewrite below)
- Delete: `components/CoachDirectivesCard.tsx` (`git rm`; verify first that its only importer is the model page: `grep -rn "CoachDirectivesCard" app/ components/ --include="*.tsx"`)

**Interfaces:**
- Consumes: `TrendsData` (`insights: Insight[]`, `validation.byDimension` with 0–1 `hitRate`) via the existing `/api/trends` GET, `queryKey: ["trends", syncedAt]` — the SAME key the Trends page uses, so the cache is shared; `DIRECTIVE_DEMOTE_DEFAULTS` from `@/lib/synthesis` (`minDecisive: 3`, `demoteHitRateMax: 0.34` — fractions); `coachAccuracy` from `useSync` (the aggregate track record, canonical here since W2).
- Produces: `StandingGuidance()` — the directives' sole owner: grouped by dimension, one line per directive, evidence behind `why` `<details>`, ✓ hit-rate where earned, proven-poor flag per the demote rule.

- [ ] **Step 1: Create `components/StandingGuidance.tsx`**

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { DIRECTIVE_DEMOTE_DEFAULTS } from "@/lib/synthesis";
import type { Insight } from "@/lib/types";
import { useSync } from "./SyncProvider";
import { Card, LoadFailed, Skeleton } from "./ui";
import type { TrendsData } from "./trends/types";

// STANDING GUIDANCE (UX v2 §6 Model): the directives' sole owner, rendered from their structured
// source (ranked insights + per-dimension validation — the same inputs lib/synthesis.ts folds into
// the generator's directive block) instead of the synthesized text blob. One line per directive,
// evidence behind "why", validation ✓ where earned, proven-poor nudges flagged by the same demote
// rule the generator applies. Reuses the /api/trends query key → shared cache with the Trends page.
export default function StandingGuidance() {
  const { state } = useSync();
  const syncedAt = state?.lastSync?.syncedAt ?? null;
  const acc = state?.coachAccuracy ?? null;
  const { data, error, refetch } = useQuery({
    queryKey: ["trends", syncedAt],
    queryFn: () => api<TrendsData>(`/api/trends?today=${localToday()}`),
  });

  // Aggregate track record beside the guidance (Constitution §5) — canonical home since UX v2 W2.
  const trackRecord =
    acc && (acc.hitRatePct !== null || acc.pending > 0) ? (
      acc.hitRatePct !== null ? (
        <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
          {acc.hitRatePct}% right ({acc.evaluated} checked)
        </span>
      ) : (
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">accruing · {acc.pending} pending</span>
      )
    ) : undefined;

  let body: ReactNode;
  if (error) {
    body = <LoadFailed what="the standing guidance" retry={() => void refetch()} />;
  } else if (!data) {
    body = <Skeleton className="h-24" />;
  } else if (data.insights.length === 0) {
    body = (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        No directives yet — they synthesise once there&apos;s enough execution history to spot a pattern.
      </p>
    );
  } else {
    // Group by dimension, preserving the overall severity ranking; the dimension's matured track
    // record annotates its header (✓ where earned, proven-poor per the generator's demote rule).
    const groups = new Map<string, Insight[]>();
    for (const ins of data.insights) {
      const g = groups.get(ins.dimension);
      if (g) g.push(ins);
      else groups.set(ins.dimension, [ins]);
    }
    const trackOf = (dimension: string) =>
      data.validation?.byDimension.find((d) => d.dimension === dimension) ?? null;
    body = (
      <div className="space-y-3">
        {[...groups.entries()].map(([dimension, rows]) => {
          const t = trackOf(dimension);
          const decisive = t ? t.validated + t.refuted : 0;
          const demoted =
            t?.hitRate != null &&
            decisive >= DIRECTIVE_DEMOTE_DEFAULTS.minDecisive &&
            t.hitRate <= DIRECTIVE_DEMOTE_DEFAULTS.demoteHitRateMax;
          return (
            <div key={dimension}>
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {dimension}
                {t?.hitRate != null && !demoted && (
                  <span
                    title={`Acting on matured ${dimension} nudges proved right ${Math.round(t.hitRate * 100)}% of the time (${decisive} decisive).`}
                    className="font-mono font-normal normal-case text-green-700 dark:text-emerald-400"
                  >
                    ✓ {Math.round(t.hitRate * 100)}%
                  </span>
                )}
                {demoted && (
                  <span
                    title={`Past ${dimension} nudges worked only ${Math.round((t!.hitRate as number) * 100)}% across ${decisive} decisive blocks — the evidence stands; the coach reaches for a different lever.`}
                    className="rounded bg-amber-50 px-1.5 font-normal normal-case text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                  >
                    proven-poor lever
                  </span>
                )}
              </p>
              <ul className="mt-1 space-y-1.5">
                {rows.map((ins, i) => {
                  const dot =
                    ins.severity === "alert" ? "bg-red-500" : ins.severity === "watch" ? "bg-amber-500" : "bg-green-500";
                  return (
                    <li key={i} className="rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                      <p className="flex items-start gap-2 text-xs">
                        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                        <span className="min-w-0">
                          <span className="font-semibold text-zinc-800 dark:text-zinc-100">{ins.title}</span>
                          <span className="text-zinc-600 dark:text-zinc-300"> — {ins.suggestion}</span>
                        </span>
                      </p>
                      <details className="mt-1 pl-3.5">
                        <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                          why
                        </summary>
                        <p className="mt-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{ins.evidence}</p>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
          The same guidance, with each dimension&apos;s track record folded in, steers every block you generate.
        </p>
      </div>
    );
  }

  return (
    <Card
      title="Coaching directives"
      tip="The standing guidance distilled from your execution history — the structured view of the exact directive block the generator is handed."
      action={trackRecord}
    >
      {body}
    </Card>
  );
}
```

- [ ] **Step 2: Rewrite `app/model/page.tsx`**

```tsx
import CalibrationPanel from "@/components/CalibrationPanel";
import StandingGuidance from "@/components/StandingGuidance";
import StateDriversCard from "@/components/StateDriversCard";
import { SectionDivider } from "@/components/ui";

// The "what the second brain knows" page — three stacked groups (UX v2 §6): NOW (the fused state +
// its ranked drivers as magnitude bars — the same data Today's "why? →" links to), LEARNED
// (per-athlete calibration, contest/correct inline), STANDING GUIDANCE (the directives' sole owner,
// structured lines instead of a text blob). Bars and lines, not paragraphs.
export default function ModelPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Your coaching model</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          What the second brain has learned about you, and why it decides what it does — read it, and
          correct it where it&apos;s wrong.
        </p>
      </div>
      <section className="space-y-3">
        <SectionDivider label="Now — what drives your state" />
        <StateDriversCard />
      </section>
      <section className="space-y-3">
        <SectionDivider label="Learned — per-athlete calibration" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Thresholds learned from your own data, with a population default until there&apos;s enough
          history. Updated each sync — override one only if you know the learned value is wrong for you.
        </p>
        <CalibrationPanel />
      </section>
      <section className="space-y-3">
        <SectionDivider label="Standing guidance — what the coach keeps telling you" />
        <StandingGuidance />
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Delete the replaced card**

Run: `grep -rn "CoachDirectivesCard" app/ components/ --include="*.tsx"` → expect only `app/model/page.tsx` (already rewritten) — then `git rm components/CoachDirectivesCard.tsx`. Re-run the grep → nothing.

- [ ] **Step 4: Verify + commit**

Run: `npm run check` → green; `npm run build` → clean.

```bash
git add app/model/page.tsx components/StandingGuidance.tsx
git commit -m "feat(model): three groups — drivers/calibration/standing guidance, directives structured (UX v2 W4)"
```

(The `git rm` already staged the deletion; it rides in this commit.)

---

### Task 4: Profile — the rider-read hero + dossier dividers

**Files:**
- Modify: `components/AthleteProfileForm.tsx` (render restructure; no state/handler changes)

**Interfaces:**
- Consumes: `SectionDivider` from `./ui` (add to the existing ui import); `latestWeightKg` (already destructured).
- Produces: the page body regrouped into four divider-labelled dossier groups; the current-performance strip gains a synced Weight tile.

- [ ] **Step 1: Restructure the return**

In `components/AthleteProfileForm.tsx` (anchor on quoted code, not line numbers — the file is large):

1. Add `SectionDivider` to the ui import: `import { Card, SectionDivider, Skeleton, SkeletonScreen } from "./ui";`
2. The header block and the two notice banners (physiology change, FTP stale) stay first, untouched — alerts outrank the dossier.
3. Wrap the existing PRs/rider-profile grid AND the Current-performance section in the first group. Directly before the `{riderProfileSection && powerPRsSection && …}` conditional, open:

```tsx
      {/* Dossier group 1 (UX v2 §6 Profile): who is this rider — curve, phenotype, headline numbers. */}
      <section className="space-y-4">
        <SectionDivider label="The rider read" />
```

and close the `</section>` after the Current-performance `<Section>` block (keep the grid fallback logic and the Current-performance conditional exactly as they are, now nested inside).

4. Inside the Current-performance grid, append a synced Weight tile after the `Object.entries(...).map(...)` output (inside the same `grid grid-cols-2 gap-2 sm:grid-cols-3` div):

```tsx
            {latestWeightKg != null && (
              <div className="rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900">
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Weight <span className="text-cyan-700 dark:text-[#00d4ff]">· synced</span>
                </p>
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{latestWeightKg.toFixed(1)} kg</p>
              </div>
            )}
```

5. Wrap `<IfBandOffsets rows={ifBandRows} />` in group 2:

```tsx
      <section className="space-y-4">
        <SectionDivider label="Zones & effort bands" />
        <IfBandOffsets rows={ifBandRows} />
      </section>
```

6. Wrap the Goals & Weakpoints `<Section>` in group 3 (`<SectionDivider label="Goals & weakpoints" />`) and the Nutrition `<Section>` in group 4 (`<SectionDivider label="Nutrition formula" />`) — same `<section className="space-y-4">` shape. The Section contents are untouched in this task (Task 5 converts them to read views).
7. Change the page container from `space-y-5` to `space-y-6` (group gap = 2× the inner `space-y-4`… keep inner as written; the divider pattern matches Trends/Model).

- [ ] **Step 2: Verify + commit**

Run: `npm run check` → green; `npm run build` → clean.

```bash
git add components/AthleteProfileForm.tsx
git commit -m "feat(profile): dossier groups — rider read hero with synced weight tile (UX v2 W4)"
```

---

### Task 5: Profile — goals/weakpoints + nutrition become read views with inline edit disclosures

**Files:**
- Modify: `components/AthleteProfileForm.tsx` (the two `<Section>` bodies; all state/handlers stay verbatim)

**Interfaces:**
- Success measure this task owns (§8): "Profile: no edit form visible before its disclosure is opened."

- [ ] **Step 1: Goals & Weakpoints read view + disclosure**

Inside `<Section title="Goals & Weakpoints">`, keep the intro `<p>` (shorten `mb-3` to `mb-2`), then insert the read view, and wrap ALL the existing form JSX (the goals list + "+ Add goal", the weakpoints list + "+ Add weakpoint", and the Save row — everything currently after the intro paragraph) inside a `<details>`:

```tsx
        {goals.length === 0 && weakpoints.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">None yet — open Edit below to add your first goal.</p>
        ) : (
          <>
            <ul className="space-y-1">
              {goals.map((g, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">{g.goal || "—"}</span>
                  {g.target && (
                    <>
                      <span aria-hidden className="text-zinc-400 dark:text-zinc-500">→</span>
                      <span className="text-zinc-600 dark:text-zinc-300">{g.target}</span>
                    </>
                  )}
                  <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-700/60 dark:text-zinc-300">
                    {g.focus}
                  </span>
                </li>
              ))}
            </ul>
            {weakpoints.length > 0 && (
              <ul className="mt-2 space-y-1">
                {weakpoints.map((w, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">weak</span>
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">{w.weakpoint}</span>
                    {w.detail && <span className="text-zinc-500 dark:text-zinc-400">· {w.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Edit
          </summary>
          <div className="mt-2">
            {/* …the existing goals form, add buttons, weakpoints form, and Save row — moved here verbatim… */}
          </div>
        </details>
```

(The read view intentionally reads the live `goals`/`weakpoints` state, so draft edits inside the open disclosure preview immediately above it.)

- [ ] **Step 2: Nutrition read view + disclosure**

Inside `<Section title="Nutrition formula">`, keep the intro `<p>` and the buffer auto-adjustment status block visible (it is status, not a form); add a read line and move the inputs grid + Save row into a `<details>`:

```tsx
        <p className="mb-2 font-mono text-sm text-zinc-800 dark:text-zinc-100">
          {data.nutrition.baseCalories.toLocaleString()} base
          <span className="text-zinc-500 dark:text-zinc-400"> · </span>
          {data.nutrition.restDayTarget.toLocaleString()} rest-day
          <span className="text-zinc-500 dark:text-zinc-400"> · </span>+{data.nutrition.buffer} buffer
          <span className="text-zinc-500 dark:text-zinc-400"> · target </span>
          {data.nutrition.targetWeightKg} kg
        </p>
```

Order inside the Section becomes: intro `<p>` → the read line above → the existing buffer auto-adjustment `div` (unchanged) → `<details><summary>Edit</summary><div className="mt-2">…inputs grid + Save row, verbatim…</div></details>`. The read line uses `data.nutrition` (saved values), not the `nut` draft — the number the formula actually uses.

- [ ] **Step 3: Verify + commit**

Run: `npm run check` → green; `npm run build` → clean. Quick self-check: no `<input>`/`<select>` in this file renders outside a `<details>` (grep the file: every `input`/`select` occurrence should be inside the two disclosure blocks).

```bash
git add components/AthleteProfileForm.tsx
git commit -m "feat(profile): goals + nutrition read views with inline edit disclosures (UX v2 W4)"
```

---

### Task 6: Wave gate — DESIGN.md §8, masterplan bookkeeping, final sweep

**Files:**
- Modify: `DESIGN.md` (Profile + Model rows)
- Modify: `UX-MASTERPLAN.md` (§7 item 4 + header line)

- [ ] **Step 1: DESIGN.md §8 rows** (each ONE table line)

Profile row →

```markdown
| **Profile** | "Who am I — what does the coach plan around?" | THE RIDER READ (power curve + phenotype · current performance + synced weight · PR strip, provenance badges) | ZONES & EFFORT BANDS (synced) · GOALS & WEAKPOINTS read view · NUTRITION FORMULA read + buffer status | edit forms → inline `<details>` disclosures (no form visible until opened) |
```

Model row →

```markdown
| **Model** | "What does the brain know about me — and why?" | NOW — fused score + ranked drivers as signed magnitude bars | LEARNED — calibration cards (value · provenance chip · confidence · contest/correct inline) · STANDING GUIDANCE — directives grouped by dimension, one line each, ✓/proven-poor track marks | directive evidence → "why" `<details>` |
```

- [ ] **Step 2: UX-MASTERPLAN bookkeeping**

1. §7 item 4 →

```markdown
4. **Wave 4 — Profile dossier + Model three-groups.** ✅ shipped 2026-07-09 (plan
   `docs/superpowers/plans/2026-07-09-ux-v2-wave-4-profile-model.md`). Model: driver magnitude
   bars · calibration cards · StandingGuidance renders the directives' structured source (insights
   + validation, demote rule shared with the generator) — CoachDirectivesCard retired. Profile:
   dossier dividers, synced weight in the rider read, goals/nutrition read views with inline edits.
```

2. Header line 3: "Waves 1–3 shipped 2026-07-08/09 (§7), Waves 4–5 open" → "Waves 1–4 shipped 2026-07-08/09 (§7), Wave 5 open".

- [ ] **Step 3: Final sweep**

```bash
npm run check && npm run build
grep -rn "CoachDirectivesCard" app/ components/ --include="*.tsx"   # expect: nothing
grep -rn "Wave 4" ROADMAP.md todo.md                                 # expect: nothing forward-looking
```

Success measures (§8), verified in the controller's preview walk: /profile shows no edit form before a disclosure opens; /model has zero multi-paragraph prose outside `<details>`.

- [ ] **Step 4: Commit**

```bash
git add DESIGN.md UX-MASTERPLAN.md
git commit -m "docs(ux): DESIGN §8 + masterplan wave state for UX v2 Wave 4"
```
