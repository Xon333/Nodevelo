# FR-13 Early-End Retrospective Effective Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `agent-orchestration` to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make early-end retrospective language and stored hour totals evaluate only the lived closeout window while leaving normal completion and deterministic closeout authority unchanged.

**Architecture:** `POST /api/retrospective` computes one inclusive `effectiveCloseoutDate`, then derives planned days and ride activities through that date. One shared `RetrospectiveInput` feeds both optional AI calls, while `buildCloseoutEvidence` remains the deterministic authority and stored block identity retains the original schedule.

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript 5, Vitest, Anthropic prompt builders. No new dependencies.

## Global Constraints

- Start from accepted FR-3 commit `cf8dddf86519d175b961671aea2fe120419ca4a9` in an isolated `codex/*` worktree; never edit `main`.
- Add the exact early-end regression before changing production code.
- Use `resolveToday`; never derive user-facing today from UTC.
- Normal completion and explicit early end use one formula: `min(today, block.endDate)`.
- Preserve `buildCloseoutEvidence`, frozen-ledger reads, seed derivation, acknowledgement semantics, and markdown → history → CAS-clear ordering.
- Retrospective prose and structured reflections remain optional language only and never feed deterministic generation.
- Keep original `BlockHistoryEntry.startDate`, `endDate`, and `lengthWeeks`; persist effective-window `plannedHours` and `actualHours`.
- Increment `PROMPT_VERSION` from `9` to `10` because the retrospective prompt contract changes.
- Do not touch adaptive-roadmap invalidation, preview persistence, UI, prose style, provider choice, or unrelated FR-3 findings.
- A changed AI path requires one attended live smoke run against isolated data before completion.

---

### Task 1: Lock the effective-window contract with failing regressions

**Files:**
- Modify: `app/api/retrospective/route.test.ts`
- Modify: `lib/anthropic-prompts.test.ts`

**Interfaces:**
- Consumes: existing `post`, `block`, `sync`, `maturedIntervention`, and `retroInput` fixtures.
- Produces: failing assertions for `RetrospectiveInput.effectiveCloseoutDate`, `RetrospectiveInput.endedEarly`, effective hours/evidence, and early-end prompt instructions.

- [ ] **Step 1: Read the current route-handler and Vitest guidance plus both files in full**

Run:

```bash
sed -n '1,240p' ../../node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
sed -n '1,220p' ../../node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md
cat app/api/retrospective/route.test.ts
cat lib/anthropic-prompts.test.ts
```

Expected: the Next.js 16 route contract and all existing retrospective fixtures are read before edits.

- [ ] **Step 2: Add the exact early-end route regression**

Append inside `describe("Phase 1 trust contract", ...)` in `app/api/retrospective/route.test.ts`:

```ts
  it("FR-13: early end gives both AI calls and history only the lived window", async () => {
    const earlyBlock = {
      ...block,
      startDate: "2026-08-31",
      endDate: "2026-09-13",
      createdAt: "2026-08-30T08:00:00.000Z",
      days: [
        day("2026-09-01", "Threshold", 60),
        day("2026-09-03", "SIT", 45),
      ],
    };
    const futureRide = {
      ...sync.activities[0],
      id: "future",
      date: "2026-09-03",
      name: "Future sentinel",
      movingTimeSec: 2 * 3600,
      trainingLoad: 200,
      decoupling: 1,
    };
    h.readCurrentBlock.mockResolvedValue(earlyBlock);
    h.readLastSync.mockResolvedValue({
      ...sync,
      activities: [futureRide],
      wellness: [
        { ...sync.wellness[0], date: "2026-08-31", ctl: 50 },
        { ...sync.wellness[1], date: "2026-09-01", ctl: 51 },
        { ...sync.wellness[1], date: "2026-09-13", ctl: 99 },
      ],
    });
    h.readScoreLog.mockResolvedValue({ entries: [] });
    h.readInterventionLog.mockResolvedValue({
      records: [{ ...maturedIntervention, blockStartDate: earlyBlock.startDate }],
      updatedAt: new Date(0).toISOString(),
    });

    const res = await post({
      today: "2026-09-01",
      endedEarly: true,
      endReason: "Recovery reset",
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.closeout).toMatchObject({
      plannedSessions: 1,
      scoredSessions: 0,
      missedSessions: 1,
    });

    for (const input of [
      h.generateRetrospective.mock.calls[0][0],
      h.generateStructuredRetrospective.mock.calls[0][0],
    ]) {
      expect(input).toMatchObject({
        startDate: "2026-08-31",
        endDate: "2026-09-13",
        effectiveCloseoutDate: "2026-09-01",
        endedEarly: true,
        plannedHours: 1,
        actualHours: 0,
        ctlEnd: 51,
        topSessions: [],
        avgDecoupling: null,
      });
    }

    const entry = h.appendBlockHistory.mock.calls[0][0];
    expect(entry).toMatchObject({
      startDate: "2026-08-31",
      endDate: "2026-09-13",
      lengthWeeks: 2,
      plannedHours: 1,
      actualHours: 0,
    });
    expect(entry.days.map((d: { date: string }) => d.date)).toEqual(["2026-09-01"]);
  });

  it("FR-13: normal completion keeps the full scheduled and actual window", async () => {
    await post({ today: "2026-06-29" });

    expect(h.generateRetrospective.mock.calls[0][0]).toMatchObject({
      effectiveCloseoutDate: "2026-06-28",
      endedEarly: false,
      plannedHours: 6.25,
      actualHours: 2.5,
      ctlEnd: 58,
    });
    expect(h.appendBlockHistory.mock.calls[0][0]).toMatchObject({
      plannedHours: 6.3,
      actualHours: 2.5,
    });
  });
```

- [ ] **Step 3: Extend the prompt fixture and add prompt regressions**

Add these defaults to `retroInput` in `lib/anthropic-prompts.test.ts`, immediately after `endDate`:

```ts
  effectiveCloseoutDate: "2026-05-28",
  endedEarly: false,
```

Append inside `describe("buildRetrospectivePrompt / buildStructuredRetrospectivePrompt", ...)`:

```ts
  it("marks an early end as an effective window in both retrospective prompts", () => {
    const early = retroInput({
      effectiveCloseoutDate: "2026-05-02",
      endedEarly: true,
      plannedHours: 1,
      actualHours: 0,
    });
    const expected =
      "Closeout window: ended early on 2026-05-02. Evaluate only 2026-05-01 → 2026-05-02; " +
      "scheduled days after 2026-05-02 are excluded and must not be treated as missed.";
    const interventions: ReflectionInterventionInput[] = [
      {
        dimension: "VO2max",
        severity: "watch",
        title: "Check execution",
        physMetric: "5-min power",
        baselineExecEwma: 5,
        baselinePhys: 320,
        outcome: {
          execNow: 5,
          physNow: 320,
          execDelta: 0,
          physDelta: 0,
          verdict: "inconclusive",
        },
      },
    ];

    expect(buildRetrospectivePrompt(early)).toContain(expected);
    expect(buildStructuredRetrospectivePrompt({ ...early, interventions })).toContain(expected);
  });

  it("does not add early-end instructions to a normal completion", () => {
    expect(buildRetrospectivePrompt(retroInput())).not.toContain("Closeout window: ended early");
  });
```

- [ ] **Step 4: Run the focused tests and verify the regression is red**

Run:

```bash
npx vitest run app/api/retrospective/route.test.ts lib/anthropic-prompts.test.ts
```

Expected: FAIL because the route still includes the future day/activity, does not supply the new fields, and neither prompt emits the early-end exclusion line. Existing unrelated tests remain green.

---

### Task 2: Implement the single route-owned window and prompt contract

**Files:**
- Modify: `app/api/retrospective/route.ts`
- Modify: `lib/anthropic-prompts.ts`
- Modify: `lib/anthropic-api.ts`
- Test: `app/api/retrospective/route.test.ts`
- Test: `lib/anthropic-prompts.test.ts`

**Interfaces:**
- Consumes: `resolveToday`, `buildCloseoutEvidence(block, entries, activities, throughIso)`, and the existing `RetrospectiveInput` fields.
- Produces: required `RetrospectiveInput.effectiveCloseoutDate: string` and `RetrospectiveInput.endedEarly: boolean`; prompt provenance version `10`.

- [ ] **Step 1: Extend `RetrospectiveInput` and render one conditional closeout line**

In `lib/anthropic-prompts.ts`, add after `endDate`:

```ts
  effectiveCloseoutDate: string;
  endedEarly: boolean;
```

Add before `buildRetrospectivePrompt`:

```ts
function retrospectiveCloseoutLine(input: RetrospectiveInput): string | null {
  return input.endedEarly
    ? `Closeout window: ended early on ${input.effectiveCloseoutDate}. Evaluate only ${input.startDate} → ${input.effectiveCloseoutDate}; scheduled days after ${input.effectiveCloseoutDate} are excluded and must not be treated as missed.`
    : null;
}
```

In `buildRetrospectivePrompt`, add after the existing `Block:` line:

```ts
    retrospectiveCloseoutLine(input),
```

The existing `.filter((l) => l !== null)` removes the line for normal completion.

In `buildStructuredRetrospectivePrompt`, add after the existing `Completed block:` line:

```ts
    retrospectiveCloseoutLine(input),
```

and change its terminal join to:

```ts
  ].filter((line) => line !== null).join("\n");
```

- [ ] **Step 2: Derive the route's planned and actual collections from one cutoff**

In `app/api/retrospective/route.ts`, replace the current `blockActivities`, `actualHours`, and `plannedHours` block with:

```ts
  const effectiveCloseoutDate = today < block.endDate ? today : block.endDate;
  const plannedDays = block.days.filter(
    (d) => d.date >= block.startDate && d.date <= effectiveCloseoutDate
  );
  const blockActivities = sync.activities.filter(
    (a) =>
      a.date >= block.startDate &&
      a.date <= effectiveCloseoutDate &&
      (a.type === "Ride" || a.type === "VirtualRide")
  );

  const actualHours = blockActivities.reduce((sum, activity) => sum + activity.movingTimeSec, 0) / 3600;
  const plannedHours = plannedDays.reduce((sum, plannedDay) => sum + plannedDay.durationMin, 0) / 60;
```

Pass `effectiveCloseoutDate` as the fourth `buildCloseoutEvidence` argument, replace
`closestCtl(sync.wellness, block.endDate)` with
`closestCtl(sync.wellness, effectiveCloseoutDate)`, and replace
`truncateBlockDays(block.days, today)` with
`truncateBlockDays(block.days, effectiveCloseoutDate)`.

- [ ] **Step 3: Build one shared input and use it for both optional AI calls**

Extend the `@/lib/anthropic-api` type import in `app/api/retrospective/route.ts` with
`RetrospectiveInput`, then add after `complianceMap` is built:

```ts
  const retrospectiveInput: RetrospectiveInput = {
    goal: block.goal,
    lengthWeeks: block.lengthWeeks,
    startDate: block.startDate,
    endDate: block.endDate,
    effectiveCloseoutDate,
    endedEarly,
    plannedHours,
    actualHours,
    overallCompliancePct,
    ctlStart,
    ctlEnd,
    complianceByType: complianceMap,
    topSessions,
    avgDecoupling,
    powerProfile: powerProfileText,
  };
```

Replace the prose call's object literal with:

```ts
      retrospective = await generateRetrospective(retrospectiveInput);
```

Replace the structured call's duplicated retrospective fields with:

```ts
      structuredReflections = await generateStructuredRetrospective({
        ...retrospectiveInput,
        interventions: maturedInterventions,
      });
```

- [ ] **Step 4: Bump AI provenance once**

In `lib/anthropic-api.ts`, replace the current version line with:

```ts
export const PROMPT_VERSION = 10; // 9→10: retrospectives identify the effective early-closeout window
```

- [ ] **Step 5: Run focused tests and type checking**

Run:

```bash
npx vitest run app/api/retrospective/route.test.ts lib/anthropic-prompts.test.ts lib/block-closeout.test.ts
npx tsc --noEmit
```

Expected: all focused tests pass, including `0/1` with one miss for the early end; TypeScript reports no errors.

- [ ] **Step 6: Commit the tested behavior**

```bash
git add app/api/retrospective/route.ts app/api/retrospective/route.test.ts \
  lib/anthropic-prompts.ts lib/anthropic-prompts.test.ts lib/anthropic-api.ts
git commit -m "fix(retrospective): exclude unlived early-end days"
```

---

### Task 3: Update canonical documentation and verify the FR-13 boundary

**Files:**
- Modify: `docs/systems/07-ai-layer.md`
- Modify: `ROADMAP.md`
- Modify: `ARCHIVE.md`

**Interfaces:**
- Consumes: the shipped route and prompt contract from Task 2 plus the accepted FR-3 evidence, design, and this plan.
- Produces: canonical documentation and recorded completion evidence; no behavior.

- [ ] **Step 1: Update the AI-layer authority description**

Under `## Authority boundary` in `docs/systems/07-ai-layer.md`, add:

```md
- Retrospective language receives one route-owned effective closeout window. Normal completion ends
  at the scheduled block end; explicit early end stops at the athlete's local closeout date. Planned
  and actual hours, block-window ride evidence, and the stored history totals use that same window.
```

- [ ] **Step 2: Close the roadmap package without renumbering it**

Remove the completed `FR-13` package from `ROADMAP.md` and append this section to `ARCHIVE.md`:

```md
## FR-13 — early-end retrospective effective window (2026-09)

- **Evidence:** [FR3-01](docs/reviews/2026-09-01-fr3-core-journey-audit.md#fr3-01--early-end-narrative-grades-the-unlived-future)
- **Design:** [accepted design](docs/superpowers/specs/2026-09-01-fr13-early-end-retrospective-window-design.md)
- **Plan:** [implementation plan](docs/superpowers/plans/2026-09-01-fr13-early-end-retrospective-window.md)
- **Shipped:** one effective closeout date now bounds planned and actual retrospective inputs,
  persisted history hours, and block-window language evidence. Normal completion still covers the
  full block; deterministic closeout and FR-5 authority boundaries are unchanged.
```

Change the design status line to `**Status:** Shipped 2026-09-01`.

- [ ] **Step 3: Run the full automated verification set**

Run:

```bash
npm run check
npm run check-links
git diff --check cf8dddf86519d175b961671aea2fe120419ca4a9
git diff --name-only cf8dddf86519d175b961671aea2fe120419ca4a9
```

Expected: all checks pass; the name-only output contains only the five implementation/test files and the FR-13 canonical documentation files named in this plan. It contains none of the excluded adaptive-roadmap, preview, UI, or unrelated UX files.

- [ ] **Step 4: Run one attended live prompt smoke against isolated data**

Create scratch copies so the real athlete data and knowledge base cannot change:

```bash
fr13_scratch_dir=$(mktemp -d)
cp -R ../../data "$fr13_scratch_dir/data"
cp -R ../../knowledge-base "$fr13_scratch_dir/knowledge-base"
```

Write an active scratch block whose only lived session is 60 minutes on 2026-09-01 and whose second session is still future:

```bash
node - "$fr13_scratch_dir/data/current-block.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
fs.writeFileSync(file, JSON.stringify({
  goal: "FR-13 isolated smoke",
  lengthWeeks: 2,
  startDate: "2026-08-31",
  endDate: "2026-09-13",
  overview: "FR-13 isolated smoke",
  createdAt: "fr13-isolated-smoke",
  days: [
    { date: "2026-09-01", name: "Threshold", type: "Threshold", durationMin: 60 },
    { date: "2026-09-03", name: "SIT", type: "SIT", durationMin: 45 }
  ]
}, null, 2) + "\n");
NODE

node - "$fr13_scratch_dir/data" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[2];
const inSmokeWindow = (date) => date >= "2026-08-31" && date <= "2026-09-13";
const scoreFile = path.join(dir, "score-log.json");
const scoreLog = JSON.parse(fs.readFileSync(scoreFile, "utf8"));
scoreLog.entries = scoreLog.entries.filter((entry) => !inSmokeWindow(entry.date));
fs.writeFileSync(scoreFile, JSON.stringify(scoreLog, null, 2) + "\n");
const syncFile = path.join(dir, "last-sync.json");
const sync = JSON.parse(fs.readFileSync(syncFile, "utf8"));
sync.activities = sync.activities.filter((activity) => !inSmokeWindow(activity.date));
fs.writeFileSync(syncFile, JSON.stringify(sync, null, 2) + "\n");
NODE
```

Start the isolated app with the normal Anthropic key available:

```bash
set -a
source ../../.env.local
set +a
test -n "$ANTHROPIC_API_KEY"
NODEVELO_DATA_DIR="$fr13_scratch_dir/data" \
NODEVELO_KB_DIR="$fr13_scratch_dir/knowledge-base" \
npm run dev:preview
```

In another terminal, close the scratch block:

```bash
curl -sS -X POST http://127.0.0.1:3100/api/retrospective \
  -H 'Content-Type: application/json' \
  --data '{"today":"2026-09-01","expectedBlockCreatedAt":"fr13-isolated-smoke","endedEarly":true,"endReason":"FR-13 isolated smoke"}'
```

Expected: HTTP 200; `closeout` reports one planned session and excludes 2026-09-03. Read the response narrative and the new markdown under
`$fr13_scratch_dir/knowledge-base/block-retrospectives/`; neither may call the result a two-week pause,
grade 2026-09-03, or compare actual hours with the full scheduled block. Stop the preview server after inspection. The scratch directory may remain for the PR evidence; it is outside the repository.

- [ ] **Step 5: Commit documentation and recorded evidence**

```bash
git add ROADMAP.md ARCHIVE.md docs/systems/07-ai-layer.md \
  docs/superpowers/specs/2026-09-01-fr13-early-end-retrospective-window-design.md
git commit -m "docs: close FR-13 retrospective window"
```

- [ ] **Step 6: Finish through the sanctioned repository workflow**

Run:

```bash
npm run finish:agent-task
```

Expected: verification passes, the branch is pushed, and the FR-13 pull request opens. Do not merge without the repository's required reciprocal review or an explicit PR-scoped user override.
