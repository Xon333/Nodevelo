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

**Hostile review, whole-repo (2026-08-15): 13 findings, HR-60…HR-72 (append-only after HR-59).**
Ground truth: `npm run check` was green before and after (tsc clean, 2219/2219 tests). 8 fixed same
session on `claude/hostile-review-2026-08-15`, atomic per finding; 5 remain — 2 need an athlete
decision, 1 is `/handoff`'s file to write, 2 are already tracked elsewhere. Full writeup in the
session transcript; short form below.

- ☑ P1 `bug` **HR-60** UTC/local date mismatch in the learning loop — `app/api/write/route.ts` set
  `firedAt` with inline UTC while the route's own local `today` sat unused three lines up;
  `validateInterventions` (`lib/intervention.ts`) compares it against sync's local `today` to judge
  directive-horizon maturity. Fixed: reuse the route's `today`.
- ☑ P1 `bug` **HR-61** Three UTC-defaulted `today` params were latent traps (`lib/score-log.ts`
  `buildRideScores`, `lib/intervention.ts` `validateInterventions`, `lib/intervals-api.ts`
  `fetchSportSettings`) — every live caller already passes local `today` explicitly, so no active bug,
  but the inline literal default would silently reintroduce HR-60 for the next caller that omits it.
  Fixed: named `utcToday()` helper instead of an inline literal, so it's greppable.
- ☑ P2 `bug` **HR-62** `npm run sync` (`scripts/sync.sh`) claimed "stale worktrees pruned" but
  `git worktree prune` only drops entries whose directory is already gone — it never removed one still
  on disk. Found 63 worktrees / 2.7 GB, all clean, all merged. Fixed: real sweep — removes any
  `.worktrees/*` that's clean and whose branch is an ancestor of `origin/main`.
- ☑ P2 `bug` **HR-63** 4 broken doc anchors (INVARIANTS #31 violated by the doc it governs) —
  `docs/COMPASS.md` nutrition-calibration link, `docs/systems/06-generation.md` ADR-0013 link ×2 (all
  three: em-dash/middot headings slugify to a double hyphen, not one), plus `ARCHIVE.md`'s dead link to
  the deleted `CoachSnapshotCard.tsx` (content moved to `AthleteStateCard.tsx`). Fixed.
- ☑ P2 `audit` **HR-64** Nothing enforced HR-63/INVARIANTS #31. Fixed: added
  `scripts/check-links.mjs` (relative-link + `#anchor` validator, exempts the immutable
  `docs/superpowers/plans/`) wired into `npm run check`.
- ☐ P2 `ux` **HR-65** Split-brain skill storage — `.claude/skills/` has 6 symlinks into
  `.agents/skills/` plus 6 real tracked dirs there; `.agents/skills/handoff`,
  `hostile-review`, `triage-audit` are untracked (currently byte-identical, but two tracked copies
  will silently drift, and the untracked ones are what's polluting `git status`). **Needs a decision:
  pick one home, symlink the rest.**
- ☐ P2 `audit` **HR-66** `docs/reviews/2026-08-05-pr3-nutrition-workout-library-review.md` has been
  untracked since 2026-08-06 — not gitignored, not committed, only in `git status` noise. **Needs a
  decision: commit it or add `docs/reviews/` to `.gitignore`.**
- ☑ P3 `bug` **HR-67** 3 lint warnings rode green (no `--max-warnings 0`): an unused param in
  `lib/nutrition.ts` not `_`-prefixed, and two now-redundant `eslint-disable-next-line` comments
  (`components/BlockSettingsForm.tsx`, `lib/data-store.test.ts`) left over from before the
  underscore-prefix rule (#73) existed. Fixed all 3; `npm run lint` now runs `--max-warnings 0`.
- ☑ P3 `bug` **HR-68** Dead todo item — `i-have-adhd/` no longer exists at repo root (confirmed).
  Removed the stale line.
- ☐ P3 `edu` **HR-69** `CONTINUE.md` is stale — still says "after P4 COMPLETE… Next: the 'second
  brain' spec work" while the repo is well past that (adaptive-coach P3c, NV-1…14 closed).
  INVARIANT #28: only `/handoff` may write this file — **run `/handoff` or ask to clear it.**
- ☑ P3 `audit` **HR-70** 18 `lib/` exports (mostly nutrition/aerobic tuning constants, 3
  `intervals-api.ts` helpers) had zero cross-file consumers — verified rigorously (every name checked
  repo-wide, not just grepped). Not dead code, just needlessly `export`ed, blurring which constants are
  real cross-module contracts per INVARIANTS. Fixed: dropped `export` from all 18.
- — P3 `audit` **HR-71** `lib/workout-library.ts` is fully tested with zero consumers — already
  honestly tracked in ROADMAP.md ("Later" — 1 of 10 tasks shipped, not wired in). No new action; listed
  in the review only for completeness.
- — P2 `feat` **HR-72** No cost ceiling on `/api/generate`/`/api/ask` against a live Anthropic key —
  confirmed zero rate-limit/token-bucket code in `app/api`. Real feature work, not a hygiene fix —
  already ROADMAP's **P8 · AI-route cost guard**. No new action here.

**Post-2026-08-15 debrief audit (NV-1…NV-14): CLOSED, 14/14 shipped same day.** External audit of the
self-directed debrief path, ground-truthed against live code + `data/*.json` — **~93% accurate**,
unusually high for an external review. Full detail per item, including three live-caught regressions
(NV-9's poisoned zone denominator, NV-10's token-budget/categorization bug, and NV-8's own truncation
it caught in NV-7's new prose the same day it shipped) → [ARCHIVE.md](ARCHIVE.md). Two documented
residual gaps, not their own tickets yet: zone claims aren't terrain/phase-scoped
([02-scoring-and-learning.md](docs/systems/02-scoring-and-learning.md#known-rough-edges)) and an
unlabelled compound lap remains undetectable (same doc, P3c Gap A's narrower remaining half).

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

**Post-2026-08-03: hybrid Claude + Codex workflow.** Sequential handoff proven 2026-08-03 (3 Codex PRs,
zero regressions); mechanical concurrency dry-run done 2026-08-15 (PRs #72–#74) →
[ARCHIVE.md](ARCHIVE.md) and [WORKFLOW.md § Two agents at once](WORKFLOW.md#two-agents-at-once).
Genuine two-human/two-session concurrency (as opposed to one Claude session orchestrating both agents)
remains untested — revisit only if that distinction starts to matter in practice.

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
