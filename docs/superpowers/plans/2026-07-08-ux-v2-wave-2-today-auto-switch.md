# UX v2 Wave 2 — Today Auto-Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute UX-MASTERPLAN v2 Wave 2 — Today becomes one page serving two moments: a synced ride on today's *local* date auto-switches the layout from the pre-ride glance (M1: alerts → verdict → promoted session prescription) to the post-ride debrief (M2: verdict strip → debrief hero → "Eat today" fuel card), with Trend Pulse and the viewport-lock/edge-fade machinery cut.

**Architecture:** Presentation-layer rebuild of `/today` only — no API routes, stores, or scoring logic change. `TodayView` gains mode detection (`todayAnalysis.activityDate === localToday()`, the check it already uses) and renders one of two layouts; `TodayRideCard` is reordered into the debrief hero (execution verdict first, coach takeaway ≤3 sentences inline); the fuel decision extracts to a new `EatToday` card; `AthleteStateCard` gains a `compact` strip variant. Two tiny deterministic helpers (`addDaysIso`, `splitLeadSentences`) are the only unit-testable additions. Spec: `UX-MASTERPLAN.md` §4 + §7.2, commit `94d19a3`.

**Tech Stack:** Next.js 16 App Router · React 19 · Tailwind v4 · TypeScript 5 · Vitest.

## Global Constraints

- **Run commands with `npm`** (`npm test` = `vitest run`, `npm run build`, `npm run check` = tsc + lint + test).
- **This checkout is shared with a concurrent agent session.** Stage only files you touched (`git add <path>...`), never `git add -A` / `git add .`. If a build error appears in a file you did NOT edit, run `git status --short <file>` first — uncommitted means the other agent is mid-edit: wait ~30 s, retry once, then stop and report; do not fix it.
- **This Next.js version differs from training data.** If any App Router API question arises, read `node_modules/next/dist/docs/` before writing code.
- **"Today" must be local, not UTC** (AGENTS.md): mode detection and the tomorrow-preview use `localToday()` / local-calendar day math — never `toISOString().slice(0, 10)`.
- **Verification model:** Tasks 1's helpers are TDD'd. Everything else is JSX restructuring — gates are `npm test` (suites stay green), `npm run build` (type gate), and a live preview probe of `/today`. Dark mode is canonical — check dark first. To see **pre-ride** mode with a ride already synced today, use the flip link (or `npm run reset:today` with the dev server on :3000 — it clears `today-analysis.json`; the next sync recomputes it, safe by design). **Post-ride** mode needs a real synced ride today — do NOT fake data; if none exists, verify the pre-ride layout live, confirm the flip link is absent, and desk-check the post branch (it gets its live check the next ride day).
- **No new LLM path** (AGENTS.md smoke rule not triggered): the coach note moves surfaces but its generation is untouched. If a today-ride exists in preview, one click of "↻ Re-analyse" doubles as a live smoke of the relocated states.
- **Same-commit amendment rule** (Constitution preamble + masterplan §7): the Constitution §3 moment clause ships in the auto-switch commit (Task 5); the §4 one-canonical-home clause ships in the Trend-Pulse-cut commit (Task 6).
- **Wave 3+ rows stay out of scope:** Trends verdict strip/groups, weight-intake tile relocations, Profile dossier, Model groups, Plan hero. `/api/trends` **stays** (the Trends page consumes it — only the `TrendPulse` client dies).

---

### Task 1: Deterministic helpers — `addDaysIso` + `splitLeadSentences` (TDD)

**Files:**
- Modify: `lib/date.ts` (append), `lib/date.test.ts` (append)
- Create: `lib/text.ts`, `lib/text.test.ts`

**Interfaces:**
- Produces: `addDaysIso(iso: string, n: number): string` — local-calendar day arithmetic on `YYYY-MM-DD` (Task 4 consumes for the tomorrow preview).
- Produces: `splitLeadSentences(text: string, n?: number): { lead: string; rest: string | null }` — first `n` (default 3) sentences visible, remainder for disclosure (Task 3 consumes for the coach takeaway).

- [ ] **Step 1: Write the failing tests**

Append to `lib/date.test.ts` (add `addDaysIso` to the existing import from `./date`):

```ts
describe("addDaysIso", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDaysIso("2026-07-08", 1)).toBe("2026-07-09");
    expect(addDaysIso("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("subtracts with negative n and handles leap days", () => {
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
  });
});
```

Create `lib/text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { splitLeadSentences } from "./text";

describe("splitLeadSentences", () => {
  it("returns short text whole, rest null", () => {
    expect(splitLeadSentences("One. Two. Three.")).toEqual({ lead: "One. Two. Three.", rest: null });
  });
  it("splits the lead after n sentences (., !, ? boundaries)", () => {
    expect(splitLeadSentences("A. B! C? D. E.", 3)).toEqual({ lead: "A. B! C?", rest: "D. E." });
  });
  it("does not split on decimals", () => {
    const r = splitLeadSentences("IF was 0.85 today. Solid ride. Keep it steady. Rest tomorrow.");
    expect(r.lead).toBe("IF was 0.85 today. Solid ride. Keep it steady.");
    expect(r.rest).toBe("Rest tomorrow.");
  });
  it("treats newlines as sentence whitespace", () => {
    expect(splitLeadSentences("A.\nB.\nC.\nD.", 3)).toEqual({ lead: "A. B. C.", rest: "D." });
  });
  it("handles empty / whitespace-only input", () => {
    expect(splitLeadSentences("  ")).toEqual({ lead: "", rest: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/date.test.ts lib/text.test.ts`
Expected: FAIL — `addDaysIso` is not exported; `lib/text.ts` does not exist.

- [ ] **Step 3: Implement**

Append to `lib/date.ts`:

```ts
// Pure calendar-day arithmetic on a YYYY-MM-DD string (local-date semantics; the Date constructor
// normalizes an overflowed day-of-month, so month/year/leap boundaries and DST are all safe).
// For "tomorrow's session" previews and similar day-offset lookups against block days.
export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localToday(new Date(y, m - 1, d + n));
}
```

Create `lib/text.ts`:

```ts
// Split prose into a visible lead of the first `n` sentences and the disclosed remainder
// (UX v2 court rule 3: visible prose ≤ 3 sentences per card, coach note included). Boundaries
// are sentence punctuation (. ! ?) followed by whitespace — decimals ("IF 0.85") never match
// because no whitespace follows the dot; a rare abbreviation split ("e.g. ") just moves the
// fold a sentence early, which is harmless for a truncation seam.
export function splitLeadSentences(text: string, n = 3): { lead: string; rest: string | null } {
  const parts = text.trim().split(/(?<=[.!?])\s+/).filter((s) => s !== "");
  if (parts.length <= n) return { lead: text.trim(), rest: null };
  return { lead: parts.slice(0, n).join(" "), rest: parts.slice(n).join(" ") };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lib/date.test.ts lib/text.test.ts`
Expected: PASS (all new cases green, existing date suites untouched).

- [ ] **Step 5: Commit**

```bash
git add lib/date.ts lib/date.test.ts lib/text.ts lib/text.test.ts
git commit -m "feat(lib): addDaysIso + splitLeadSentences helpers (UX v2 W2)"
```

---

### Task 2: `AthleteStateCard` gains the post-ride `compact` strip

**Files:**
- Modify: `components/AthleteStateCard.tsx`

**Interfaces:**
- Produces: `AthleteStateCard({ state, form?, ftpRetest?, compact? })` — new optional `compact?: boolean`. Compact renders one strip line: score · band — recommendation · confidence (when not high) · "why? →"; keeps the hover/focus drivers reveal and the rare FTP-retest line; drops the form line and the score bar (the go/no-go decision is already made — masterplan §4). Default (no `compact`) renders exactly as today.

- [ ] **Step 1: Extract the shared drivers tooltip, add the compact branch**

In `components/AthleteStateCard.tsx`, change the signature (line 23-33) to:

```tsx
export default function AthleteStateCard({
  state,
  form,
  ftpRetest,
  compact,
}: {
  state: AthleteState;
  // The coach-snapshot TSB-as-actionable-modifier read (lib/coach-snapshot.ts resolveTsbModifier) —
  // supporting evidence under the verdict, not a second verdict (Constitution §4).
  form?: { tsb: number | null; band: string; guidance: string } | null;
  ftpRetest?: { evidence: string } | null;
  // Post-ride strip (UX v2 §4): score · band · recommendation · why? in one line — the day's
  // go/no-go is decided, so the verdict compresses. Keeps confidence (Constitution §5) and the
  // hover/focus drivers reveal; drops the form line and score bar.
  compact?: boolean;
}) {
```

Then, after `const detailId = useId();` (line 40), insert the tooltip extraction and the compact branch — the tooltip JSX is **moved verbatim** from the bottom of the component (the `<div id={detailId} role="tooltip" …>` block, pre-edit lines 108-130) into a `driversTip` const:

```tsx
  // Hover/focus detail shared by both variants: the ranked drivers that moved the score.
  const driversTip = (
    <div
      id={detailId}
      role="tooltip"
      className="pointer-events-none absolute left-0 top-full z-30 mt-1 w-80 max-w-[90vw] rounded-lg border border-zinc-200 bg-white p-3 text-left opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        What moved it
      </p>
      <ul className="mt-1.5 space-y-1">
        {state.drivers.map((d) => (
          <li key={d.key} className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="min-w-0 text-zinc-500 dark:text-zinc-400">
              {DIR[d.dir]} {d.note}
            </span>
            <span className={`shrink-0 font-mono ${driverEffectClass(d.effect)}`}>
              {d.effect > 0 ? "+" : ""}
              {d.effect}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  if (compact) {
    return (
      <div
        tabIndex={0}
        aria-describedby={detailId}
        className="group relative flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800"
      >
        <span className="flex shrink-0 items-baseline gap-0.5">
          <span className={`font-mono text-xl font-bold leading-none ${BAND_COLOR[state.band]}`}>{state.score}</span>
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">/100</span>
        </span>
        <p className="min-w-0 text-sm font-semibold leading-tight">
          <span className={BAND_COLOR[state.band]}>{band}</span>
          <span className="font-medium text-zinc-600 dark:text-zinc-300"> — {state.recommendation}</span>
          {state.confidence !== "high" && (
            <span
              className={`ml-1.5 text-[10px] font-normal ${
                state.confidence === "low" ? "text-amber-600 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              · {state.confidence} confidence
            </span>
          )}
        </p>
        <Link
          href="/model"
          aria-label="Why this state — open your coaching model"
          className="ml-auto shrink-0 text-[10px] font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-[#00d4ff]"
        >
          why? →
        </Link>
        {ftpRetest && (
          <p className="w-full text-[11px] leading-snug text-amber-600 dark:text-amber-400">
            <span className="font-semibold">FTP check:</span> {ftpRetest.evidence}
          </p>
        )}
        {driversTip}
      </div>
    );
  }
```

Finally, in the full-card return, replace the moved tooltip block (pre-edit lines 108-130) with `{driversTip}`.

- [ ] **Step 2: Verify**

Run: `npm run build` → clean. Preview `/today` (dark): the full verdict card renders exactly as before (no visual change — `compact` has no caller yet).

- [ ] **Step 3: Commit**

```bash
git add components/AthleteStateCard.tsx
git commit -m "feat(today): athlete-state verdict strip variant (UX v2 W2)"
```

---

### Task 3: `TodayRideCard` becomes the debrief hero; `EatToday` extracts

**Files:**
- Modify: `components/dashboard/today.tsx` (restructure `TodayRideCard`, add `EatToday`)
- Modify: `components/dashboard/TodayView.tsx` (call-site: new props, coach-note Zone dies, temporary `EatToday` placement)

**Interfaces:**
- Produces: `TodayRideCard({ analysis, onPostNote?, notePosting?, notePosted?, notePostFailed?, analyzing?, onReAnalyse? })` — `bare` and `hideCoachNote` are **removed** (it always returns bare content for a host Zone); `analyzing?: boolean` and `onReAnalyse?: () => void` arrive (the coach-note lifecycle lives inside the card now; `onReAnalyse` absent = read-only render, e.g. the pre-ride "last debrief" disclosure in Task 5).
- Produces: `EatToday({ analysis }: { analysis: TodayAnalysis })` — the promoted fuel card (advised intake + formula + the fuel-prompt nudge). Returns `null` when the analysis has neither.
- Consumes: `splitLeadSentences` from Task 1.

- [ ] **Step 1: Restructure `TodayRideCard` in `components/dashboard/today.tsx`**

Add to the imports: `import { splitLeadSentences } from "@/lib/text";`

Replace the signature (pre-edit lines 87-103) with:

```tsx
export function TodayRideCard({
  analysis,
  onPostNote,
  notePosting,
  notePosted,
  notePostFailed,
  analyzing,
  onReAnalyse,
}: {
  analysis: TodayAnalysis;
  onPostNote?: () => void;
  notePosting?: boolean;
  notePosted?: boolean;
  notePostFailed?: boolean; // last post attempt failed — the button says so and retries (S1-3)
  analyzing?: boolean; // the deferred coach-note step is in flight
  onReAnalyse?: () => void; // manual (re)generate — absent for read-only renders (last-debrief disclosure)
}) {
```

After the `tipId` line, add the takeaway computation (the `?? analysis` fallback preserves the legacy pre-`coachNote` on-disk shape the old inline block supported):

```tsx
  const note = analysis.coachNote ?? (analysis as unknown as { analysis?: string }).analysis ?? null;
  // Coach takeaway ≤3 sentences visible (court rule 3); the rest is one disclosure away.
  const takeaway = note ? splitLeadSentences(note, 3) : null;
```

Now reorder the card body. The final `body` content order is (blocks marked *keep* are moved without internal changes):

1. **Execution verdict first** — replace the old execution-score block (pre-edit lines 266-295) and move it to the TOP of `body`, upgraded to the debrief headline (the post button keeps its exact existing JSX, only `analysis.coachNote` becomes `note` in its guard):

```tsx
      {/* The debrief verdict first (M2): execution is the answer to "how did it go?". */}
      {analysis.executionScore != null && (
        <div className="flex items-center gap-3">
          <span className="font-mono text-3xl font-bold leading-none text-zinc-800 dark:text-[#ff49c8]">
            {analysis.executionScore}
            <span className="font-sans text-sm font-normal text-zinc-500 dark:text-zinc-400">/10</span>
          </span>
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            {executionScoreLabel(analysis.executionScore)}
          </span>
          {onPostNote && note && (
            <button
              onClick={onPostNote}
              disabled={notePosting || notePosted}
              title={notePostFailed ? "Posting failed — click to retry" : "Post coach note to Intervals.icu"}
              className={`ml-auto shrink-0 whitespace-nowrap rounded border px-2 py-1 text-[10px] font-medium transition-colors ${
                notePosted
                  ? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
                  : notePostFailed
                    ? "border-red-300 text-red-700 hover:border-red-400 dark:border-red-700 dark:text-red-400 dark:hover:border-red-600"
                    : "border-zinc-300 text-zinc-600 hover:border-zinc-400 hover:text-zinc-800 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
              }`}
            >
              {notePosted ? "✓ Posted" : notePosting ? "Posting…" : notePostFailed ? "✕ Failed — retry" : "↑ Post to Intervals.icu"}
            </button>
          )}
        </div>
      )}
```

2. **Power-PR banner** — *keep* verbatim (pre-edit lines 156-173).

3. **Planned-vs-actual line** — replace the two-box grid (pre-edit lines 204-240) with:

```tsx
      {/* Planned vs actual as one line (masterplan §4): the comparison, not two boxes. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Planned</span>
        {analysis.plannedName ? (
          <>
            <span className="font-medium text-zinc-800 dark:text-zinc-200">{analysis.plannedName}</span>
            {plannedStyle && (
              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${plannedStyle.badge}`}>
                {analysis.plannedType}
              </span>
            )}
            {analysis.plannedDurationMin !== null && (
              <span className="text-zinc-500 dark:text-zinc-400">{analysis.plannedDurationMin} min</span>
            )}
          </>
        ) : (
          <span className="text-zinc-500 dark:text-zinc-400">no session planned</span>
        )}
        <span aria-hidden className="text-zinc-400 dark:text-zinc-500">→</span>
        <span className="font-medium text-zinc-800 dark:text-zinc-200">{analysis.activityName}</span>
        <span className="text-zinc-500 dark:text-zinc-400">{analysis.activityDurationMin} min</span>
        {analysis.activityAvgHr !== null && (
          <span className="text-zinc-500 dark:text-zinc-400">{analysis.activityAvgHr} bpm avg</span>
        )}
        {analysis.activityKj !== null && (
          <span className="text-zinc-500 dark:text-zinc-400">{analysis.activityKj} kcal</span>
        )}
      </div>
```

4. **Key metrics strip** (IF with basis / NP / avg) — *keep* verbatim (pre-edit lines 242-264).

5. **Coach takeaway** — new block (replaces both the old `!hideCoachNote` bottom block, pre-edit lines 448-456, and TodayView's separate coach-note Zone):

```tsx
      {/* Coach takeaway — ≤3 sentences visible, full note one disclosure away (court rule 3).
          The analysing / missing-note / re-analyse states live here now: the old right-column
          note Zone died with the two-moment split (UX v2 §4), and keeping one stable card frame
          around the swapping inner content preserves the FB-2026-06-30 no-remount fix. */}
      <div className="mt-3 border-l-2 border-zinc-300 pl-3 dark:border-[#ff49c8]/30">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Coach takeaway</p>
        {takeaway ? (
          <>
            <p className="mt-0.5 text-xs leading-5 text-zinc-600 dark:text-zinc-300">{takeaway.lead}</p>
            {takeaway.rest && (
              <details className="mt-1">
                <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Full note
                </summary>
                <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">{takeaway.rest}</p>
              </details>
            )}
            {onReAnalyse && (
              <button
                onClick={onReAnalyse}
                disabled={analyzing}
                title="Regenerate today's coach note"
                className="mt-2 rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
              >
                {analyzing ? "Re-analysing…" : "↻ Re-analyse"}
              </button>
            )}
          </>
        ) : analyzing ? (
          <p className="mt-0.5 text-xs italic leading-5 text-zinc-500 dark:text-zinc-400">Analysing today&apos;s ride…</p>
        ) : onReAnalyse ? (
          // Ride synced but the note is missing (e.g. the auto-run hit an Anthropic hiccup) —
          // offer a manual retry instead of waiting for the next full sync.
          <>
            <p className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">No coach note yet.</p>
            <button
              onClick={onReAnalyse}
              className="mt-2 rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
            >
              ↻ Generate coach note
            </button>
          </>
        ) : (
          <p className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">No coach note for this ride.</p>
        )}
      </div>
```

6. **Power execution `<details>`** — *keep* verbatim (pre-edit lines 297-417).

7. **`<SessionDisposition date={analysis.activityDate} />`** — *keep* (pre-edit line 446).

8. **"Your note" behind a disclosure** — replace the always-visible athlete-note div (pre-edit lines 436-442) with:

```tsx
      {/* Athlete note (Intervals.icu activity description) — disclosed, not fold-1 (M2 budget). */}
      {analysis.activityDescription != null && analysis.activityDescription.trim() !== "" && (
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Your note
          </summary>
          <p className="mt-1 text-xs italic leading-5 text-zinc-600 dark:text-zinc-400">{analysis.activityDescription}</p>
        </details>
      )}
```

**Delete** from the old body: the `!bare` header row (pre-edit lines 148-153) · the fuel-prompt block (pre-edit lines 175-202, moves to `EatToday` in Step 2) · the advised-daily-intake block (pre-edit lines 419-434, moves to `EatToday`) · the old bottom coach-note block (pre-edit lines 448-456). **Replace** the shell branch (pre-edit lines 459-464, `if (bare) return body; return <section>…`) with a plain `return body;` (keep the `body` const — the card always renders bare now, hosted by its caller's Zone).

- [ ] **Step 2: Add `EatToday` to `components/dashboard/today.tsx`**

Insert after the `TodayRideCard` function (the fuel-prompt inner JSX is **moved verbatim** from the block deleted in Step 1):

```tsx
// ---------- "Eat today" — the post-ride fuel card (UX v2 §4) ----------

// Advised daily intake + its formula, promoted out of the ride card: post-ride this is the
// decision that still remains (M2). The deterministic fuel-prompt nudge/gap read rides along —
// same decision, same moment. Truthy-checked fields throughout (never `=== null`): a
// today-analysis.json written before a field existed parses back with the key simply absent.
export function EatToday({ analysis }: { analysis: TodayAnalysis }) {
  if (analysis.advisedIntakeKcal == null && !analysis.fuelPrompt) return null;
  return (
    <Card title="Eat today">
      {analysis.advisedIntakeKcal != null && (
        <div className="flex items-baseline gap-3">
          <p className="font-mono text-xl font-bold text-zinc-900 dark:text-[#ff49c8] dark:[text-shadow:0_0_8px_rgba(255,73,200,0.3)]">
            {analysis.advisedIntakeKcal.toLocaleString()} kcal
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {analysis.advisedBaseKcal?.toLocaleString()} base
            {analysis.advisedRideFuelKcal ? ` + ${analysis.advisedRideFuelKcal.toLocaleString()} ride` : ""}
            {analysis.advisedBufferKcal ? ` + ${analysis.advisedBufferKcal.toLocaleString()} buffer` : ""}
          </p>
        </div>
      )}
      {analysis.fuelPrompt && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <span className="text-sm" aria-hidden>⛽</span>
          {analysis.fuelPrompt.kind === "log-nudge" ? (
            <p className="text-xs text-zinc-600 dark:text-zinc-300">
              Log your in-ride carbs on Intervals.icu —{" "}
              {analysis.fuelPrompt.reason === "long-ride" ? "long rides" : "interval days"} teach your fueling
              optimum.
            </p>
          ) : (
            <p className="text-xs text-zinc-600 dark:text-zinc-300">
              You logged{" "}
              <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-100">
                {analysis.fuelPrompt.loggedGPerH} g/h
              </span>
              ; your derived optimum is{" "}
              <span className="font-mono font-semibold text-cyan-700 dark:text-[#00d4ff]">
                {analysis.fuelPrompt.optimumGPerH} g/h
              </span>{" "}
              <span className="text-zinc-400 dark:text-zinc-500">(from your own rides)</span>.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Update the call site in `components/dashboard/TodayView.tsx`**

1. Import list (line 12): add `EatToday` to the `./today` import.
2. Replace the `TodayRideCard` call (pre-edit lines 151-163) with — `EatToday` sits after the card *temporarily*; Task 5 moves it to its final slot outside the hero:

```tsx
          {state.todayAnalysis && state.todayAnalysis.activityDate === localToday() ? (
            <>
              <TodayRideCard
                analysis={state.todayAnalysis}
                onPostNote={state.configured ? postNote : undefined}
                notePosting={notePosting}
                notePosted={notePosted}
                notePostFailed={notePostFailed}
                analyzing={analyzing}
                onReAnalyse={state.anthropicConfigured ? reAnalyse : undefined}
              />
              <div className="mt-3">
                <EatToday analysis={state.todayAnalysis} />
              </div>
            </>
          ) : (
            <PlannedToday block={state.currentBlock} />
          )}
```

3. Delete the whole coach-note Zone block from the right column (pre-edit lines 199-237, the `{state.todayAnalysis?.activityDate === localToday() && … <Zone title="Coach note" hero accent="pink">…</Zone> : null}` conditional plus its FB-2026-06-30 comment) — the takeaway lives inside the ride card now. `analyzing` and `reAnalyse` stay destructured (the card consumes them).

- [ ] **Step 4: Verify**

Run: `npm test` → pass. Run: `npm run build` → clean (proves no dangling `bare`/`hideCoachNote` usage).
Preview `/today` (dark). With a today-ride synced: execution score leads the session card; planned-vs-actual is one line; "Coach takeaway" shows ≤3 sentences (open "Full note" if longer); "Eat today" card renders below; no separate pink coach-note card in the right column; "Your note" is collapsed. Without a today-ride: the planned-session view is unchanged.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/today.tsx components/dashboard/TodayView.tsx
git commit -m "feat(today): ride card becomes the debrief hero; Eat-today card extracted (UX v2 W2)"
```

---

### Task 4: `PlannedToday` — type chip + tomorrow preview on rest/empty days

**Files:**
- Modify: `components/dashboard/today.tsx` (`PlannedToday`, pre-edit lines 595-665)

**Interfaces:**
- Consumes: `addDaysIso` from Task 1; `CurrentBlock.days[].{date,name,type,durationMin}` (existing).

- [ ] **Step 1: Implement**

In `components/dashboard/today.tsx`, extend the lib/date import: `import { addDaysIso, isoDaysAgo, localToday as todayIso, isBlockFinished } from "@/lib/date";`

In `PlannedToday`, after `const day = block?.days.find((d) => d.date === today) ?? null;` insert:

```tsx
  // Rest/empty days answer M1 with "what's next" instead (masterplan §4): tomorrow's session.
  const tomorrow = block?.days.find((d) => d.date === addDaysIso(today, 1)) ?? null;
  const tomorrowPreview =
    tomorrow && tomorrow.type !== "Rest" ? (
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Tomorrow: <span className="font-medium text-zinc-700 dark:text-zinc-300">{tomorrow.name}</span>
        {" · "}
        {tomorrow.type}
        {tomorrow.durationMin > 0 ? ` · ${tomorrow.durationMin} min` : ""}
      </p>
    ) : tomorrow ? (
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Tomorrow: rest day.</p>
    ) : null;
```

Then wire it into the two session-less branches:

```tsx
    if (day?.type === "Rest") {
      return (
        <div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Rest day — recover.</p>
          {tomorrowPreview}
        </div>
      );
    }
```

and the final no-session branch:

```tsx
    return (
      <div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No session planned for today.</p>
        {tomorrowPreview}
      </div>
    );
```

Finally, promote the session's type to the standard chip (masterplan: "name, type chip, duration"). In the session branch, replace the name/type header row (the `<div className="flex items-center justify-between gap-2">…</div>` with the colored dot + mono `{day.type} · … min`) with:

```tsx
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{day.name}</span>
        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${style.badge}`}>{day.type}</span>
        {day.durationMin > 0 && (
          <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{day.durationMin} min</span>
        )}
      </div>
```

- [ ] **Step 2: Verify**

Run: `npm run build` → clean. Preview `/today` (dark): if today has a planned session, its card shows name + type chip + duration + prescription chips. (Rest-day/tomorrow branches: if today isn't a rest day, verify by reading — the branch logic is exercised in Task 5's preview walk.)

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/today.tsx
git commit -m "feat(today): session card gains type chip; rest days preview tomorrow (UX v2 W2)"
```

---

### Task 5: The auto-switch — `TodayView` rewrite (+ `AskCoach bare`, skeleton, Constitution §3)

**Files:**
- Modify: `components/dashboard/TodayView.tsx` (full rewrite below)
- Modify: `components/AskCoach.tsx` (`bare` prop)
- Modify: `components/Dashboard.tsx` (today skeleton → single column)
- Modify: `UX-CONSTITUTION.md` (§3 moment clause — same-commit rule)

**Interfaces:**
- Consumes: `AthleteStateCard compact` (Task 2), `TodayRideCard`/`EatToday` (Task 3), `PlannedToday` (Task 4).
- Produces: `AskCoach({ bare }: { bare?: boolean })` — `bare` skips the Zone shell (for the footer disclosure).
- Mode rule: `todayAnalysis.activityDate === localToday()` → post-ride; `flipped` client-state toggles the view; no persistence.

- [ ] **Step 1: `AskCoach` gains `bare`**

In `components/AskCoach.tsx`: change the signature to `export default function AskCoach({ bare }: { bare?: boolean }) {`, wrap the current Zone children in `const body = (<>…</>);` (everything between `<Zone …>` and `</Zone>`, unchanged), and replace the return with:

```tsx
  if (bare) return body;
  return (
    <Zone title="Ask coach" hint="quick · today's context">
      {body}
    </Zone>
  );
```

- [ ] **Step 2: Rewrite `components/dashboard/TodayView.tsx`**

Full replacement file:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { api, isStale } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { useSync } from "../SyncProvider";
import { Zone } from "../ui";
import AskCoach from "../AskCoach";
import AthleteStateCard from "../AthleteStateCard";
import MorningCheckIn from "../MorningCheckIn";
import { EatToday, EnergyAvailabilityTile, PlannedToday, ReadinessAlerts, RecentDataSummary, TodayRideCard } from "./today";

// The /today page body — one page, two moments (UX v2 §4). A synced ride on today's LOCAL date
// switches the layout from the pre-ride glance (M1: can I go hard — what's the session?) to the
// post-ride debrief (M2: how did it go — what do I eat?). The mode is data-derived, never a
// question the athlete answers (Constitution §3); `flipped` is the quiet manual escape for the
// odd case (evening plan-check after a morning ride) — client-only, auto mode re-asserts on the
// next load. Both layouts scroll naturally: the viewport lock retired with the split (pre-ride
// fits one screen by construction; the debrief scrolls like every other page).
export default function TodayView() {
  const { state, analyzing, doSync, reAnalyse } = useSync();

  const [notePosting, setNotePosting] = useState(false);
  const [notePosted, setNotePosted] = useState(false);
  const [notePostFailed, setNotePostFailed] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const autoSyncDone = useRef(false);

  // Auto-sync once on Today when the cached data is stale.
  useEffect(() => {
    if (!state || autoSyncDone.current) return;
    if (state.autoSyncOnOpen && state.configured && isStale(state.lastSync?.syncedAt ?? null)) {
      autoSyncDone.current = true;
      void doSync();
    }
  }, [state, doSync]);

  if (!state) return null; // Dashboard already guards loadError / loading; this narrows the type.

  const postNote = async () => {
    if (!state.todayAnalysis) return;
    setNotePosting(true);
    setNotePostFailed(false);
    try {
      await api("/api/note", {
        method: "POST",
        body: JSON.stringify({
          date: state.todayAnalysis.activityDate,
          activityName: state.todayAnalysis.activityName,
          coachNote: state.todayAnalysis.coachNote,
          executionScore: state.todayAnalysis.executionScore,
        }),
      });
      setNotePosted(true);
    } catch {
      setNotePostFailed(true); // S1-3: a button that quietly returns to rest on failure is a lie
    } finally {
      setNotePosting(false);
    }
  };

  // FTP + resolved fuel numbers from the coach snapshot — evidence-tier context inside the
  // supporting-signals disclosure (the old CoachSnapshotCard's non-form content).
  const snap = state.coachSnapshot;
  const coachContext = snap
    ? [
        snap.ftp !== null ? `FTP ${snap.ftp}W` : null,
        snap.fuel.todayTargetKcal !== null ? `${snap.fuel.todayTargetKcal} kcal target` : null,
        snap.fuel.rideBurnKj !== null ? `${snap.fuel.rideBurnKj} kJ ride` : null,
        snap.fuel.weightTrend7dKg !== null
          ? `${snap.fuel.weightTrend7dKg > 0 ? "+" : ""}${snap.fuel.weightTrend7dKg} kg/7d`
          : null,
      ]
        .filter((b): b is string => b !== null)
        .join(" · ")
    : "";

  // Mode detection (approved: auto-switch, no tabs — masterplan §4).
  const todayRide = state.todayAnalysis?.activityDate === localToday() ? state.todayAnalysis : null;
  const mode: "pre" | "post" = todayRide && !flipped ? "post" : "pre";

  // Collapsed evidence shared by both moments (hidden ≠ deleted, Constitution §6).
  const supportingSignals = state.lastSync ? (
    <details>
      <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Supporting signals
      </summary>
      <div className="mt-2">
        <RecentDataSummary sync={state.lastSync} acwr={state.acwr} polarization={state.polarization} bare />
        {/* Energy-availability proxy — am I chronically under-fuelling? A recovery input, so it
            sits with the load signals. */}
        <EnergyAvailabilityTile sync={state.lastSync} />
        {coachContext && <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{coachContext}</p>}
      </div>
    </details>
  ) : null;

  const askCoach = state.anthropicConfigured ? (
    <details>
      <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Ask coach
      </summary>
      <div className="mt-2">
        <AskCoach bare />
      </div>
    </details>
  ) : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Triggered alarms outrank both moments (aviation rule, Constitution §4). */}
      <ReadinessAlerts fatigueAlert={state.fatigueAlert} loadRamp={state.loadRamp} />

      {/* The quiet corner flip (planned ↔ debrief) — exists only once today's ride is in. */}
      {todayRide && (
        <div className="-mb-2 flex justify-end">
          <button
            onClick={() => setFlipped((v) => !v)}
            className="text-[10px] font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-[#00d4ff]"
          >
            {mode === "post" ? "view planned session →" : "← back to debrief"}
          </button>
        </div>
      )}

      {mode === "post" && todayRide ? (
        <>
          {/* M2: the go/no-go decision is made — the verdict compresses to one strip. */}
          {state.athleteState && (
            <AthleteStateCard compact state={state.athleteState} ftpRetest={state.coachSnapshot?.ftpRetest ?? null} />
          )}
          <Zone rank={1} title="Debrief — how did it go?" hero accent="pink">
            <TodayRideCard
              analysis={todayRide}
              onPostNote={state.configured ? postNote : undefined}
              notePosting={notePosting}
              notePosted={notePosted}
              notePostFailed={notePostFailed}
              analyzing={analyzing}
              onReAnalyse={state.anthropicConfigured ? reAnalyse : undefined}
            />
          </Zone>
          {/* The decision that still remains post-ride (M2). */}
          <EatToday analysis={todayRide} />
          <div className="flex flex-col gap-2">
            {supportingSignals}
            {askCoach}
          </div>
        </>
      ) : (
        <>
          <Zone rank={1} title="Readiness — can I go hard?">
            {/* THE verdict: the §5 signal-fusion read; the coach's TSB-as-modifier read folds in
                as its supporting line — the same snapshot the LLM is handed. */}
            {state.athleteState ? (
              <AthleteStateCard
                state={state.athleteState}
                form={
                  state.coachSnapshot?.form.tsbModifier
                    ? { tsb: state.coachSnapshot.form.tsb, ...state.coachSnapshot.form.tsbModifier }
                    : null
                }
                ftpRetest={state.coachSnapshot?.ftpRetest ?? null}
              />
            ) : (
              // Degraded read: no fused state yet (thin/no data). S1-4: when Intervals.icu is
              // connected, the remedy is one click — a real action, not a dead end.
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {state.readiness?.reason ?? "Sync to compute today's readiness."}
                </p>
                {state.configured && (
                  <button
                    onClick={() => void doSync()}
                    className="mt-1 text-sm text-cyan-700 hover:underline dark:text-[#00d4ff]"
                  >
                    Sync now →
                  </button>
                )}
              </div>
            )}
          </Zone>

          {/* M1's main event, promoted: what am I about to ride. The morning check-in renders
              inline here when relevant (S2-9 rules unchanged — it self-hides once today's ride
              is logged and on true rest days). */}
          <Zone rank={2} title="Today's session — what am I riding?" hero>
            <MorningCheckIn />
            <PlannedToday block={state.currentBlock} />
          </Zone>

          {/* Quiet footer: everything else is one disclosure away (masterplan §4). */}
          <div className="flex flex-col gap-2">
            {supportingSignals}
            {!todayRide && state.todayAnalysis && (
              <details>
                <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Last debrief · {state.todayAnalysis.activityDate}
                </summary>
                <div className="mt-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
                  {/* Read-only: no re-analyse / post actions on a past ride's debrief. */}
                  <TodayRideCard analysis={state.todayAnalysis} />
                </div>
              </details>
            )}
            {askCoach}
          </div>
        </>
      )}
    </div>
  );
}
```

Notes on what this rewrite drops (all deliberate, masterplan §4 cuts): the `lg:h-[calc(100dvh-4rem)] lg:overflow-hidden` viewport lock and the two-column grid (both layouts are a single column now) · the `TrendPulse` import + its Zone (ledger: canonical home is Trends) · the coach-accuracy footer tile (canonical home: the Model page's directives-card track record — `CoachDirectivesCard` already renders it) · `Zone fill` usage (machinery removed in Task 6).

- [ ] **Step 3: Single-column today skeleton in `components/Dashboard.tsx`**

Replace the today-mode skeleton (pre-edit lines 25-35) with:

```tsx
    return mode === "today" ? (
      <SkeletonScreen className="flex flex-col gap-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-72" />
        <Skeleton className="h-24" />
      </SkeletonScreen>
    ) : (
```

(Comment update in the same edit: the S3-1 comment's Today description becomes "Today: verdict → session/debrief hero → footer".)

- [ ] **Step 4: Constitution §3 amendment (same commit — the change that proves it)**

In `UX-CONSTITUTION.md` §3, append as a new paragraph after the existing one:

```markdown
A page may serve two moments **if it presents exactly one at a time** (a moment-aware layout —
Today's pre-ride/post-ride auto-switch). The mode must be data-derived, never a question the
athlete answers; a quiet manual flip may exist for the edge case, but it never persists.
```

- [ ] **Step 5: Verify**

Run: `npm test` → pass. Run: `npm run build` → clean.
Preview `/today` (dark, desktop):
- **With a today-ride:** post-ride layout — verdict strip (one line, score + band + recommendation + why?) → pink "Debrief — how did it go?" hero → "Eat today" card → collapsed "Supporting signals" / "Ask coach". Corner link "view planned session →" flips to the pre-ride view ("← back to debrief" flips back; reload re-asserts post-ride). No Trend pulse, no coach-accuracy tile, page scrolls naturally (no internal card scrollbars).
- **Without a today-ride** (`npm run reset:today` + reload, or a day with no ride): pre-ride layout — verdict card (full, with form line) → promoted session hero (check-in when relevant) → footer with "Supporting signals", "Last debrief · <date>" (if a stale analysis exists), "Ask coach". No flip link. Fits 1440×900 without scrolling (§8 success measure).
- Keyboard: tab reaches the flip link, the three `<summary>` disclosures, and the verdict strip (drivers reveal on focus).
- Light mode spot-check, then mobile width (375px): single column, no horizontal overflow.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/TodayView.tsx components/AskCoach.tsx components/Dashboard.tsx UX-CONSTITUTION.md
git commit -m "feat(today): pre/post-ride auto-switch layouts (UX v2 W2)"
```

---

### Task 6: The cuts — TrendPulse dies, viewport-lock/edge-fade machinery retires (+ Constitution §4)

**Files:**
- Delete: `components/TrendPulse.tsx`
- Modify: `components/ui.tsx` (remove `TrendTile`; remove `Zone`'s `fill` prop + scroll-fade machinery)
- Modify: `UX-CONSTITUTION.md` (§4 one-canonical-home clause — same-commit rule)

**Interfaces:**
- Consumes: Task 5 already removed the only `TrendPulse` and `Zone fill` call sites (verified during planning: `TrendTile` is imported only by `TrendPulse`; `fill` was passed only by `TodayView`; `/api/trends` is still consumed by `components/Trends.tsx` and stays).
- Produces: `Zone({ rank?, title, hint?, hero?, accent?, className?, children })` — no `fill`.

- [ ] **Step 1: Delete the component**

```bash
git rm components/TrendPulse.tsx
```

- [ ] **Step 2: Strip `ui.tsx`**

1. Delete the `TrendTile` function (pre-edit lines 322-370, the "Compact trend tile" block).
2. In `Zone` (pre-edit lines 231-320): remove the `fill` prop from the signature + type (and its comment); delete the S3-3 scroll-affordance comment block, `scrollRef`, `moreBelow` state, and the whole `useEffect`; simplify the returns —

```tsx
  return (
    <section className={`${shell} ${className ?? ""}`}>
      {hero && <CyberFrame accent={accent} />}
      <div className={hero ? "relative z-10" : undefined}>
        <div className="mb-2 flex items-center gap-2">
          {rank != null && (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600 dark:bg-synced/15 dark:text-synced">
              {rank}
            </span>
          )}
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h2>
          {hint && <span className="ml-auto text-[10px] text-zinc-500 dark:text-zinc-400">{hint}</span>}
        </div>
        {children}
      </div>
    </section>
  );
```

3. Trim the now-unused imports: the file header import becomes `import { useEffect, useId, type ReactNode } from "react";` (`useEffect` stays for `useMountLoad`; `useRef`/`useState` leave with the fill machinery).

- [ ] **Step 3: Constitution §4 amendment (same commit — the cut that proves it)**

In `UX-CONSTITUTION.md` §4, append as a new paragraph:

```markdown
Corollary — **one canonical home per metric** (UX v2 court rule 1): every number has exactly one
owner surface; anywhere else it appears as a link to that home, or not at all. A metric answering
another page's question verbatim (Today's old Trend Pulse carrying "am I improving?") is a
relocation, not a copy.
```

- [ ] **Step 4: Verify (spec §8 success measures)**

```bash
npm test && npm run build
grep -rn "TrendPulse" app/ components/ --include="*.tsx"        # expect: nothing
grep -rn "TrendTile" app/ components/ --include="*.tsx"          # expect: nothing
grep -rn "100dvh" app/ components/ --include="*.tsx"             # expect: nothing
grep -wn "fill" components/ui.tsx                                 # expect: nothing (Zone is fill-free)
```

Preview `/today` + `/trends` (dark): Today renders both moments as in Task 5; Trends is untouched (its charts and `/api/trends` fetch still work).

- [ ] **Step 5: Commit**

```bash
git add components/ui.tsx UX-CONSTITUTION.md
git commit -m "feat(today): retire Trend Pulse + viewport-lock/edge-fade machinery (UX v2 W2)"
```

---

### Task 7: Wave gate — DESIGN.md §8, masterplan bookkeeping, final sweep

**Files:**
- Modify: `DESIGN.md` (§8 layout bullet + Today per-page row)
- Modify: `UX-MASTERPLAN.md` (§2 ledger addition · §7 Wave 2 marked shipped)

- [ ] **Step 1: DESIGN.md §8 — the viewport-lock clause dies**

In the **Desktop** bullet, delete the sentence "The Today page is viewport-locked (`lg:h-[calc(100dvh-4rem)] lg:overflow-hidden`) with cards scrolling internally." and replace with: "Every page scrolls naturally (the Today viewport lock retired in UX v2 Wave 2)."

Replace the **Today** row of the per-page table with:

```markdown
| **Today** | Pre-ride: "Can I go hard — what's the session?" · Post-ride: "How did it go — what do I eat?" (auto-switch on a synced ride matching today's local date; UX v2 §4) | Pre: readiness verdict → promoted session prescription. Post: verdict strip → debrief hero (execution score · planned-vs-actual line · IF/NP/avg · coach takeaway ≤3 sentences) → "Eat today" fuel card | morning check-in (pre, inline) · PR banner · disposition chips | **Power execution** (per-rep · trace · zone bars), full coach note, "Your note", supporting signals, last debrief (pre), ask coach — all `<details>` |
```

- [ ] **Step 2: UX-MASTERPLAN bookkeeping**

1. §2 ledger — add a row (the one Today tenant the ledger missed, found during Wave 2 planning):

```markdown
| Coach accuracy (hit rate) | Today · trend-pulse footer | **Model** · directives-card header (was already there) | — |
```

2. §7 — mark Wave 2 shipped, mirroring the Wave 1 entry's format:

```markdown
2. **Wave 2 — Today auto-switch.** ✅ shipped 2026-07-08 (plan
   `docs/superpowers/plans/2026-07-08-ux-v2-wave-2-today-auto-switch.md`). Mode detection
   (local-date ride match) + pre/post layouts + cuts (Trend Pulse, coach-accuracy copy,
   viewport-lock & edge-fade machinery) + Constitution §3/§4 amendments.
```

3. Header line 3: change "Wave 1 shipped 2026-07-08 (§7), Waves 2–5 open" to "Waves 1–2 shipped 2026-07-08 (§7), Waves 3–5 open".

- [ ] **Step 3: Final sweep (spec §8 subset + ban list)**

```bash
npm run check && npm run build
grep -rn "Wave 2" ROADMAP.md todo.md   # expect: nothing to update (verified at planning; re-check)
```

Preview walk (dark, then light): all seven pages render; Today in whichever mode the live data dictates; flip link works; no ban-list hits on the new surfaces (no hover-only critical info — disclosures are `<details>`; no naked acronyms — IF/NP tiles keep their tips; no two same-altitude verdicts — post-ride has the strip only).

- [ ] **Step 4: Commit**

```bash
git add DESIGN.md UX-MASTERPLAN.md
git commit -m "docs(ux): DESIGN §8 + masterplan ledger/wave state for UX v2 Wave 2"
```
