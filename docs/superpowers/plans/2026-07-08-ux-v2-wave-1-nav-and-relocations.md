# UX v2 Wave 1 — Nav Tiering & Cross-Page Relocations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute UX-MASTERPLAN v2 Wave 1 — the tiered nav rail, the "Knowledge" name unification, and every pure cross-page relocation from the §2 moves ledger (goals card off Plan, current performance → Profile, effort bands Model → Profile, season Profile → Plan, delete-block → overflow) — leaving no page half-moved.

**Architecture:** Pure presentation-layer moves. No API routes, stores, or lib logic change; components move between pages or within them, and one component (`SeasonSection`) is extracted from a 719-line form into its own file. Spec: `UX-MASTERPLAN.md` §2 (ledger) + §3 (nav), commit `150279f`.

**Tech Stack:** Next.js 16 App Router · React 19 · Tailwind v4 · TypeScript 5 · Vitest.

## Global Constraints

- **Run commands with `npm`** (`npm test` = `vitest run`, `npm run build`).
- **This checkout is shared with a concurrent agent session.** Stage only files you touched (`git add <path>...`), never `git add -A` / `git add .`. If a build error appears in a file you did NOT edit, run `git status --short <file>` first — uncommitted means the other agent is mid-edit: wait ~30 s, retry once, then stop and report; do not fix it.
- **This Next.js version differs from training data.** If any App Router API question arises, read `node_modules/next/dist/docs/` before writing code.
- **Verification model for this wave:** these are JSX relocations with no new logic — there is nothing meaningful to unit-test first. The gates for every task are: `npm test` (existing suites stay green), `npm run build` (type gate), and a live preview probe of the affected page. Dark mode is canonical — check dark first.
- **Naming rule (spec §3):** the destination is **"Knowledge"** — no "Knowledge Base", "Knowledge base", or "Docs" in athlete-facing copy after this wave.
- **Mobile is out of scope** (spec defers it): the mobile bottom bar keeps its current structure; only its label text changes. The desktop rail is the deliverable.
- **Ledger rows NOT in this wave (by design):** rows coupled to a page rebuild execute in that page's wave — Trend Pulse cut + coach-note truncation (Wave 2, Today), weight/intake tiles + 7-day-load tile + weekly-volume demotion (Wave 3, Trends), week-strip-into-hero merge (Wave 5, Plan). Nothing here is missing; do not "helpfully" do them early.
- **Known spec erratum (found during planning):** the §2 ledger row "Directive chips — Was: Plan + Model" is wrong: directives never rendered on Plan. The rows seen on Plan were *goals* whose names resemble categories, rendered by `GoalsProgress`. The outcome is unchanged (the goals card leaves Plan; Model already sole-owns directives). Task 7 corrects the ledger row.

---

### Task 1: Tiered nav rail + "Knowledge" naming

**Files:**
- Modify: `components/Nav.tsx:13-21` (LINKS), `components/Nav.tsx:218-234` (rail rendering)
- Modify: `app/knowledge/page.tsx` (page title strings — locate via grep in Step 3)

**Interfaces:**
- Produces: `LINKS` entries gain `tier: "primary" | "coach" | "system"`. No other component consumes `LINKS`.

- [ ] **Step 1: Rewrite `LINKS` with tiers and the unified name**

Replace `components/Nav.tsx:9-21` with:

```tsx
type IconName = "today" | "plan" | "trends" | "profile" | "model" | "settings" | "knowledge";
type NavTier = "primary" | "coach" | "system";

// Tiered rail (UX-MASTERPLAN v2 §3): the daily trio renders full-weight; the rare tier renders
// smaller under group labels. `mobileTab: false` keeps a link out of the mobile bottom bar
// (mobile restructure is deferred; Model still rides the top-bar brain icon there).
const LINKS: { href: string; label: string; short: string; icon: IconName; tier: NavTier; mobileTab?: boolean }[] = [
  { href: "/today", label: "Today", short: "Today", icon: "today", tier: "primary" },
  { href: "/plan", label: "Plan", short: "Plan", icon: "plan", tier: "primary" },
  { href: "/trends", label: "Trends", short: "Trends", icon: "trends", tier: "primary" },
  { href: "/profile", label: "Profile", short: "Profile", icon: "profile", tier: "coach" },
  { href: "/model", label: "Model", short: "Model", icon: "model", tier: "coach", mobileTab: false },
  { href: "/settings", label: "Settings", short: "Settings", icon: "settings", tier: "system" },
  { href: "/knowledge", label: "Knowledge", short: "Knowledge", icon: "knowledge", tier: "system" },
];

const TIER_LABELS: Record<Exclude<NavTier, "primary">, string> = {
  coach: "You & the coach",
  system: "System",
};
```

- [ ] **Step 2: Render the rail in three groups**

Replace the desktop `<nav>` block (`components/Nav.tsx:218-234`, the `flex flex-1 flex-col gap-1 px-2` nav) with:

```tsx
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {(["primary", "coach", "system"] as const).map((tier) => (
            <div key={tier} className="flex flex-col gap-1">
              {tier !== "primary" && (
                <p className="px-3 pb-0.5 pt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  {TIER_LABELS[tier]}
                </p>
              )}
              {LINKS.filter((l) => l.tier === tier).map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 transition-colors ${
                    tier === "primary" ? "text-sm" : "text-[13px]"
                  } ${
                    isActive(link.href)
                      ? "bg-zinc-900 text-white dark:bg-[#ff49c8]/10 dark:text-[#ff49c8] dark:ring-1 dark:ring-[#ff49c8]/40"
                      : tier === "primary"
                        ? "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  <Icon name={link.icon} className={`shrink-0 ${tier === "primary" ? "h-4 w-4" : "h-3.5 w-3.5"}`} />
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
```

The mobile bottom bar (`LINKS.filter((l) => l.mobileTab !== false)`) needs no code change — it ignores `tier` and picks up the "Knowledge" short label automatically.

- [ ] **Step 3: Sweep remaining name drift**

Run: `grep -rn "Knowledge Base\|Knowledge base\|>Docs<" app/ components/ --include="*.tsx"`
Expected hits: `app/knowledge/page.tsx` (metadata title and/or `<h1>`). Edit each athlete-facing string to **"Knowledge"** (e.g. `<h1>…>Knowledge</h1>`, `title: "Knowledge — NodeVelo"`). Re-run the grep. Expected: no output.

- [ ] **Step 4: Verify**

Run: `npm test` → all suites pass. Run: `npm run build` → compiles clean.
Preview (dark, desktop ≥1280 px): the rail shows Today/Plan/Trends full-size, then "YOU & THE COACH" over Profile/Model, then "SYSTEM" over Settings/Knowledge; active-page highlight still works on all seven; mobile (<640 px) bottom bar shows "Knowledge" as the last tab.

- [ ] **Step 5: Commit**

```bash
git add components/Nav.tsx app/knowledge/page.tsx
git commit -m "feat(nav): tiered desktop rail + Knowledge name unification (UX v2 W1)"
```

---

### Task 2: Plan sheds the Goals card; block hero gains "This block targets"

**Files:**
- Modify: `components/dashboard/PlanView.tsx` (drop `GoalsProgress` + its state)
- Modify: `components/dashboard/plan.tsx` (delete `GoalsProgress`; add targets line in `CurrentBlockSection`)

**Interfaces:**
- Consumes: `CurrentBlock.goal: string` (exists, `lib/types.ts:286`).
- Produces: `GoalsProgress` and its `ProfileGoals` interface no longer exist; nothing else imports them (verified: only `PlanView.tsx`).

- [ ] **Step 1: Remove the Goals card from PlanView**

In `components/dashboard/PlanView.tsx`:
1. Import list from `./plan` (lines 15-21): remove `GoalsProgress`.
2. Delete line 44 (`const [athleteMd, setAthleteMd] = …`) and line 45 (`const [goalsForProgress, setGoalsForProgress] = …`). Keep `blockHistory`.
3. Remove the now-unused `import type { AthleteMdSnapshot } from "@/lib/kb-loader";` (line 6).
4. In `loadPrefill` (lines 78-95): delete `setAthleteMd(response.athleteMd);` and `setGoalsForProgress(response.goals);` — keep `setRawGoals(response.goals)` and the weakpoints prefill. The `athleteMd` field can stay in the `api<{…}>` response type annotation (the route still returns it).
5. Replace the goals/this-week grid (lines 237-245):

```tsx
      {state.lastSync && <WeeklyDebrief sync={state.lastSync} />}
```

- [ ] **Step 2: Delete `GoalsProgress` from plan.tsx**

In `components/dashboard/plan.tsx`, delete the whole `// ---------- Progress toward goals ----------` region: the `ProfileGoals` interface and the `GoalsProgress` function (lines 160-201).

- [ ] **Step 3: Add the derived targets line to the block hero**

In `CurrentBlockSection` (`components/dashboard/plan.tsx`), directly after the `Week X of Y` paragraph (the `<p className="mt-0.5 text-xs …">` ending at line 419), add:

```tsx
            <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500 dark:text-zinc-400">
              This block targets:{" "}
              <span className="text-zinc-700 dark:text-zinc-300">{block.goal.split("\n")[0]}</span>
            </p>
```

- [ ] **Step 4: Verify**

Run: `npm test` → pass. Run: `npm run build` → clean (this proves no dangling `GoalsProgress` references).
Preview `/plan` (dark): no "Goals" card; "This week" card still present; the Active block hero shows "This block targets: …" as one clamped line.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/PlanView.tsx components/dashboard/plan.tsx
git commit -m "feat(plan): goals card leaves Plan; hero gains derived targets line (UX v2 W1)"
```

---

### Task 3: Profile gains the Current performance strip

**Files:**
- Modify: `components/AthleteProfileForm.tsx` (new `Section` before Goals & Weakpoints, pre-edit anchor line 465)

**Interfaces:**
- Consumes: `data.athleteMd.performanceData: Record<string, string>` (already in `ProfileResponse`, line 51).

- [ ] **Step 1: Insert the section**

In `components/AthleteProfileForm.tsx`, immediately **before** `<Section title="Goals & Weakpoints">` (line 465 pre-edit), insert:

```tsx
      {/* Current performance (FTP · threshold HR · max HR) — canonical home per UX v2 §2 ledger;
          moved from Plan's goals card. Values live in knowledge-base athlete.md, edited there. */}
      {athleteMd.performanceData && Object.keys(athleteMd.performanceData).length > 0 && (
        <Section title="Current performance" editHref="/knowledge">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(athleteMd.performanceData).map(([k, v]) => (
              <div key={k} className="rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900">
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{k}</p>
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{v}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
```

(`athleteMd` is already destructured from `data` at line 305.)

- [ ] **Step 2: Verify**

Run: `npm run build` → clean. Preview `/profile` (dark): a "Current performance" card with the FTP / Threshold HR / Max HR tiles sits above Goals & Weakpoints, with an "Edit →" link to /knowledge.

- [ ] **Step 3: Commit**

```bash
git add components/AthleteProfileForm.tsx
git commit -m "feat(profile): current performance strip arrives from Plan (UX v2 W1)"
```

---

### Task 4: Effort bands move Model → Profile

**Files:**
- Modify: `app/profile/page.tsx` (full rewrite below)
- Modify: `components/AthleteProfileForm.tsx` (accept + render `ifBandRows`)
- Modify: `app/model/page.tsx` (full rewrite below)

**Interfaces:**
- Consumes: `ifBandOffsetRows(powerZonePct: number[]): IfBandOffsetRow[]` from `lib/calibration`; `readPhysiology()` from `lib/physiology`; `IfBandOffsets({ rows })` component (unchanged).
- Produces: `AthleteProfileForm({ ifBandRows }: { ifBandRows?: IfBandOffsetRow[] })` — new optional prop, default `[]`.

- [ ] **Step 1: Rewrite `app/profile/page.tsx`**

```tsx
import type { Metadata } from "next";
import AthleteProfileForm from "@/components/AthleteProfileForm";
import { ifBandOffsetRows } from "@/lib/calibration";
import { readPhysiology } from "@/lib/physiology";

export const metadata: Metadata = { title: "Athlete Profile — NodeVelo" };

// Read the physiology store at request time so the IF-band view reflects the latest synced zones
// (moved from /model with the effort-bands card — UX v2 §2 ledger: zones are declared data).
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const ifRows = ifBandOffsetRows((await readPhysiology())?.current.powerZonePct ?? []);
  return <AthleteProfileForm ifBandRows={ifRows} />;
}
```

- [ ] **Step 2: Accept and render the prop in AthleteProfileForm**

1. Add to the imports: `import IfBandOffsets from "./IfBandOffsets";` and `import type { IfBandOffsetRow } from "@/lib/calibration";`
2. Change the signature (line 125):

```tsx
export default function AthleteProfileForm({ ifBandRows = [] }: { ifBandRows?: IfBandOffsetRow[] }) {
```

3. Render `<IfBandOffsets rows={ifBandRows} />` immediately **after** the "Current performance" section added in Task 3 (still before Goals & Weakpoints).

- [ ] **Step 3: Rewrite `app/model/page.tsx`**

```tsx
import CalibrationPanel from "@/components/CalibrationPanel";
import CoachDirectivesCard from "@/components/CoachDirectivesCard";
import StateDriversCard from "@/components/StateDriversCard";

// The "what the second brain knows" page (ROADMAP #2 / anti-black-box). Aggregates the model state the
// coach reasons from — what it thinks of you now (+ why), the standing directives (+ track record), and
// what it has learned to calibrate. State drivers and directives are read-only; the calibration panel
// (CalibrationPanel) is contest/correct — a manual override on a learned parameter, via /api/calibration.
// The effort-bands view moved to /profile (UX v2 §2 ledger: zones are declared data, not learned).
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
      <StateDriversCard />
      <CoachDirectivesCard />
      <CalibrationPanel />
    </div>
  );
}
```

(The `force-dynamic` export leaves with the zones read — the remaining three cards fetch client-side.)

- [ ] **Step 4: Verify**

Run: `npm test` → pass. Run: `npm run build` → clean.
Preview: `/model` (dark) shows drivers → directives → calibration, no effort-bands card; `/profile` shows "Effort bands from your zones" between Current performance and Goals & Weakpoints, with live zone data (not the "Sync your…" empty state, since zones are synced).

- [ ] **Step 5: Commit**

```bash
git add app/profile/page.tsx app/model/page.tsx components/AthleteProfileForm.tsx
git commit -m "feat(profile,model): effort bands move to Profile (UX v2 W1)"
```

---

### Task 5: Season moves Profile → Plan (extract `SeasonSection`)

**Files:**
- Create: `components/SeasonSection.tsx`
- Modify: `components/AthleteProfileForm.tsx` (remove season state/handlers/JSX)
- Modify: `components/dashboard/PlanView.tsx` (render it)

**Interfaces:**
- Produces: `SeasonSection()` — self-contained client component, no props; fetches/saves `/api/season` itself.
- Consumes: `validateSeasonPlanInput` from `lib/season`; `SeasonEvent`, `SeasonPlan` from `lib/types`; `Card`, `LoadFailed`, `useMountLoad` from `components/ui`.

- [ ] **Step 1: Create `components/SeasonSection.tsx`**

The event-list/objective JSX is **cut verbatim** from `AthleteProfileForm.tsx` lines 577-661 (everything inside `<Section title="Season">…</Section>`); the state and handlers are cut from lines 130-132, 165-183, 249-278. Assembled file:

```tsx
"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/client-api";
import { validateSeasonPlanInput } from "@/lib/season";
import type { SeasonEvent, SeasonPlan } from "@/lib/types";
import { Card, LoadFailed, useMountLoad } from "./ui";

type SaveState = { state: "idle" | "saving" | "saved" } | { state: "error"; message: string };

// Season = athlete-owned intent (objective + target events) the macro-periodization engine plans
// around. Lives on /plan since UX v2 (§2 ledger): it's consumed at block-generation time (M4).
// Extracted unchanged from AthleteProfileForm. A load failure must NOT fall back to an empty form
// (S1-3): saving blanks over an unreadable-but-saved season would silently destroy it.
export default function SeasonSection() {
  const [objective, setObjective] = useState("");
  const [events, setEvents] = useState<SeasonEvent[]>([]);
  const [seasonSaveState, setSeasonSaveState] = useState<SaveState>({ state: "idle" });
  const [seasonLoadFailed, setSeasonLoadFailed] = useState(false);

  const loadSeason = useCallback(async () => {
    try {
      const { plan } = await api<{ plan: SeasonPlan }>("/api/season");
      setObjective(plan.objective);
      setEvents(plan.events);
      setSeasonLoadFailed(false);
    } catch {
      setSeasonLoadFailed(true);
    }
  }, []);

  useMountLoad(loadSeason);

  const updateEvent = (index: number, patch: Partial<SeasonEvent>) => {
    setEvents((evs) => evs.map((e, i) => (i === index ? { ...e, ...patch } : e)));
    if (seasonSaveState.state === "saved") setSeasonSaveState({ state: "idle" });
  };
  const addEvent = () => {
    setEvents((evs) => [...evs, { name: "", date: "", priority: "B" }]);
  };
  const removeEvent = (index: number) => {
    setEvents((evs) => evs.filter((_, i) => i !== index));
  };

  const saveSeason = async () => {
    const parsed = validateSeasonPlanInput({ objective, events });
    if (typeof parsed === "string") {
      setSeasonSaveState({ state: "error", message: parsed });
      return;
    }
    setSeasonSaveState({ state: "saving" });
    try {
      await api("/api/season", { method: "PUT", body: JSON.stringify(parsed) });
      setSeasonSaveState({ state: "saved" });
      const fresh = await api<{ plan: SeasonPlan }>("/api/season");
      setObjective(fresh.plan.objective);
      setEvents(fresh.plan.events);
    } catch (err) {
      setSeasonSaveState({ state: "error", message: err instanceof Error ? err.message : "Save failed" });
    }
  };

  return (
    <Card title="Season">
      {/* PASTE the JSX cut from AthleteProfileForm.tsx lines 577-661 here, unchanged:
          the intro <p>, the seasonLoadFailed ? <LoadFailed…> : <> objective input,
          events list, + Add event, Save row </> — nothing in it references anything
          outside this component. */}
    </Card>
  );
}
```

(The paste replaces the placeholder comment — the cut block is self-contained: it references only `objective`, `events`, `seasonSaveState`, `seasonLoadFailed`, the four handlers, and `SeasonEvent`.)

- [ ] **Step 2: Strip season from AthleteProfileForm**

Delete from `components/AthleteProfileForm.tsx` (pre-edit line numbers):
- 130-132 (`objective`, `events`, `seasonSaveState` state) and 165 (`seasonLoadFailed`)
- 167-183 (`loadSeason` + its comment + `useMountLoad(loadSeason)`)
- 249-278 (`updateEvent`, `addEvent`, `removeEvent`, `saveSeason`)
- 576-662 (the whole `<Section title="Season">` block)
- Imports now unused: `validateSeasonPlanInput` (line 10); `SeasonEvent` and `SeasonPlan` from the types import (line 9) — **keep `SeasonFocus`** (the goals type uses it).

- [ ] **Step 3: Render on Plan**

In `components/dashboard/PlanView.tsx`: add `import SeasonSection from "../SeasonSection";` and render it between the `{plan && <PlanPreview …/>}` block and the block-history slot:

```tsx
      <SeasonSection />

      {historyFailed ? (
```

- [ ] **Step 4: Verify**

Run: `npm test` → pass. Run: `npm run build` → clean (proves no orphaned season references in the form).
Preview `/plan` (dark): Season card (objective + events + Save) sits under the generator; edit the objective, Save → "✓ Saved". Preview `/profile`: no Season section; Goals & Weakpoints flows straight into Nutrition formula.

- [ ] **Step 5: Commit**

```bash
git add components/SeasonSection.tsx components/AthleteProfileForm.tsx components/dashboard/PlanView.tsx
git commit -m "feat(plan,profile): season editing moves to Plan as SeasonSection (UX v2 W1)"
```

---

### Task 6: Delete block leaves prime real estate (overflow menu)

**Files:**
- Modify: `components/dashboard/plan.tsx` (`CurrentBlockSection`, pre-edit lines 421-452)

**Interfaces:**
- Consumes: existing `confirming` state + inline confirm row (unchanged — S2-7's consequence copy stays).

- [ ] **Step 1: Replace the standing Delete button with an overflow menu**

In `CurrentBlockSection`, add menu state next to `confirming` (line 377):

```tsx
  const [menuOpen, setMenuOpen] = useState(false);
```

Then replace the `{onDelete && ( confirming ? (…) : (<button … Delete block</button>) )}` block (lines 421-452) with — keeping the `confirming` branch **verbatim** and swapping only the collapsed branch:

```tsx
          {onDelete && (
            confirming ? (
              /* …existing confirm row, unchanged… */
            ) : (
              <div className="relative shrink-0" onMouseLeave={() => setMenuOpen(false)}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Block actions"
                  onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}
                  className="rounded-md px-2.5 py-1.5 text-sm font-semibold text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  …
                </button>
                {menuOpen && (
                  <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-40 rounded-md border border-zinc-200 bg-white py-1 shadow-md dark:border-zinc-700 dark:bg-zinc-900">
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setConfirming(true);
                      }}
                      onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}
                      className="block w-full px-3 py-1.5 text-left text-xs font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      Delete block…
                    </button>
                  </div>
                )}
              </div>
            )
          )}
```

- [ ] **Step 2: Verify**

Run: `npm run build` → clean. Preview `/plan` (dark): hero corner shows a quiet "…"; click → "Delete block…" → the existing confirm row ("ridden history and scores are kept" + Yes/Cancel); Cancel restores the "…". Keyboard: Tab reaches "…", Escape closes the menu.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/plan.tsx
git commit -m "feat(plan): delete-block demoted to overflow menu (UX v2 W1)"
```

---

### Task 7: Wave gate — docs, ledger erratum, success measures

**Files:**
- Modify: `DESIGN.md` (§8 layout bullets + per-page table)
- Modify: `UX-MASTERPLAN.md` (§2 directive-chips ledger row erratum)

- [ ] **Step 1: Update DESIGN.md §8**

In the **Desktop** bullet, after "fixed left nav rail `w-44`", append: "; the rail is tiered — Today/Plan/Trends full-weight, then 'You & the coach' (Profile, Model) and 'System' (Settings, Knowledge) groups (UX v2 §3)". In the **Mobile** bullet, replace the "Knowledge Base"/"Docs" wording with "Knowledge".
In the per-page table: **Plan** row — replace "Goals · this-week debrief" in Supporting with "this-week debrief · season (objective/events) · 'this block targets' line"; **Profile** row — append "current performance · effort bands (zones)" to Supporting; **Model** row — remove the effort-bands mention if present.

- [ ] **Step 2: Correct the UX-MASTERPLAN §2 ledger row**

Change the row `| Directive chips (5 categories) | Plan + Model | **Model** · Standing guidance | generator consumes internally |` — replace the "Was" cell with: `Model (W1 planning found the "Plan chips" were actually goals rows — see goals-list row)`.

- [ ] **Step 3: Run the Wave-1 success measures (spec §8 subset)**

```bash
npm test && npm run build
grep -rn "Knowledge Base\|Knowledge base\|>Docs<" app/ components/ --include="*.tsx"   # expect: nothing
grep -rn "GoalsProgress" components/ app/ --include="*.tsx"                            # expect: nothing
grep -rn "IfBandOffsets" app/model/ --include="*.tsx"                                  # expect: nothing
```

Preview walk (dark, then light): all seven pages render; rail tiering everywhere; no page lost content it was supposed to keep.

- [ ] **Step 4: Commit**

```bash
git add DESIGN.md UX-MASTERPLAN.md
git commit -m "docs: DESIGN §8 + ledger erratum for UX v2 Wave 1"
```
