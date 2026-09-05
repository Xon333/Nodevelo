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

**Maintainer audit (2026-09-05).** Full evidence, locations, smallest fixes and verification:
[maintainer audit](docs/reviews/2026-09-05-maintainer-audit.md). MA-1 is fixed in the accompanying change.

- ☐ P2 `bug` **MA-2** Reject null/primitive Profile section containers before property reads; current null nutrition/performance requests return 500.
- ☐ P2 `audit` **MA-3** Exclude private runtime roots from production traces and add synthetic-canary build assertions (52 references reproduced).
- ☐ P2 `bug` **MA-4** PR #109: unknown successful usage must not pass measured-cost gates as $0.
- ☐ P2 `bug` **MA-5** PR #109: permit independent category winners, then gate their combined cost.
- ☐ P2 `audit` **MA-6** Primary cleanup owner: exclude modifications to immutable historical plans before committing; preserve working files during reconciliation.
- ☐ P3 `edu` **MA-7** Primary cleanup owner: retain bounded-search, quadratic-baseline and binary-loading rationale when removing unwanted comment wording.
- ☐ P3 `edu` **MA-8** Remove stale route/module line counts from owning navigation docs or regenerate them.


**Whole-repo hostile review (2026-08-15) — remaining decisions.** Closed findings HR-60…HR-65,
HR-67, HR-68, HR-70…HR-72 are recorded in [ARCHIVE.md](ARCHIVE.md).

- ☐ P2 `audit` **HR-66** `docs/reviews/2026-08-05-pr3-nutrition-workout-library-review.md` has been
  untracked since 2026-08-06 — not gitignored, not committed, only in `git status` noise. **Needs a
  decision: commit it or add `docs/reviews/` to `.gitignore`.**
- ☐ P3 `edu` **HR-69** `CONTINUE.md` is stale — still says "after P4 COMPLETE… Next: the 'second
  brain' spec work" while the repo is well past that (adaptive-coach P3c, NV-1…14 closed).
  INVARIANT #28: only `/handoff` may write this file — **run `/handoff` or ask to clear it.**

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
- ☐ `ux` P3 Nutrition input bounds (UXA-51) — `targetWeightKg` still has a floor of 0 and no
  ceiling.

---

- ☐ `audit` Nutrition follow-ups — none blocking; magnitudes in
  [09-nutrition § known rough edges](docs/systems/09-nutrition.md#known-rough-edges). `weeklyEnergy`
  remains approximate because NodeVelo does not yet persist the final prescription for every calendar
  day; do not reconstruct old buffers or stamp rides only (rest days would be absent).
- ☐ `ux` Phase 3a no-block Today layout — revisit whether the fused `AthleteStateCard` (Zone 1,
  `lib/athlete-state.ts`) should eventually be replaced/merged with design §10's three-stream
  Load/Recovery/Execution read for the no-block case, rather than keeping the fused score permanent and
  adding §10's read as Zone 2 supplementary text. Chose the lower-risk option for v1 (2026-08-12,
  athlete's explicit call); flagged to reconsider once the no-block section has shipped and been used.

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).
