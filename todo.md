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

**Block-generation architecture — research-backed redesign (2026-07-24).** P1, P2, P3a-c, P4, P5, and
P7(verify) all shipped → [ARCHIVE.md](ARCHIVE.md) "Block-generation architecture redesign — P1–P7
(2026-07-24)". Full plan detail + known gaps →
[docs/systems/05-season.md § Known rough edges](docs/systems/05-season.md#known-rough-edges).

- ☐ P3d–e, P6 `feat` — queued. P3d/e deliberately deferred (need new forward-projection code / new
  regen infrastructure, and no live evidence yet justifies either). P6 not yet scoped to
  file/function detail.

**Block-generation Phases A + B (2026-07-29).** ☑ Both shipped → [ARCHIVE.md](ARCHIVE.md)
"Block generation — recovery-week defect + deterministic skeleton (Phase A + B, 2026-07-29)". The
season tripwire fired and its prescribed response is built. One item stays open below.

- ☐ P2 `bug` **Confirm loading weeks now hit their hour target.** Phase B took them from 1/4 inside
  the 30-min tolerance to 3/4 (measured −20/−34/−10 min vs 12h; recovery week −4). The residual cause
  — a flat quality-slot size that flagged correct ~55min SIT sessions every week — was fixed *after*
  that measurement, and replaying the last run's plan against the corrected skeleton drops its
  conformance warnings 3→0. **Unverified for hours:** needs one live 4-week generation to confirm the
  freed minutes actually land. If a week still misses, read the `SKELETON:` warnings first — they name
  the exact day and slot.

**HR-2026-07-23 — hostile review of the block/sync/archive data flows.** All 29 findings (HR-31
through HR-59) fixed → [ARCHIVE.md](ARCHIVE.md) "Hostile review — block/sync/archive data flows
(HR-2026-07-23)". Nothing open from this round.

---

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
- ☑ **Nutrition Phases 1–3, the buffer redesign, and day-type NEAT calibration — shipped &
  live-verified 2026-07-30 through 2026-08-01.**
  Record → [ARCHIVE.md](ARCHIVE.md) · how it works → [docs/systems/09-nutrition.md](docs/systems/09-nutrition.md).
  Five defects that were **live in production** (training days prescribing less than rest days; no way
  to express a deficit; `targetWeight` never read; mechanical `kj` treated as calories; off-bike burn
  dropped), then NEAT derived from the athlete's own logs, then the buffer changed from a trend servo
  to a feed-forward goal surplus, then the under-fuelling streak alert, then day-type-conditioned NEAT
  (rest days no longer share a `k` dragged down by training days).
  **Live-measured, most recent first:** rest-day target 2080 → **2230** (day-type split, weight 0.29 at
  n=5 logged rest days, grows as data accrues — raw unshrunk rest-day solve 1.55, within rounding of the
  original review's independent 1.53 finding). Pooled `k` = 1.2584 (high confidence, 42 d/39 logged/21
  weigh-ins) before the split. Caught and fixed a real bug along the way: the block validator was
  checking every day against one shared model, which would have falsely "corrected" correct rest-day
  figures once `k_rest`/`k_train` diverged — confirmed live on a real generated block, zero false
  corrections. D1 holds on real LLM output; 1614 tests green.
- ☐ `audit` Nutrition follow-ups — none blocking; magnitudes in
  [09-nutrition § known rough edges](docs/systems/09-nutrition.md#known-rough-edges). `weeklyEnergy`
  remains approximate because NodeVelo does not yet persist the final prescription for every calendar
  day; do not reconstruct old buffers or stamp rides only (rest days would be absent). Derived route
  coverage, coach-snapshot local-date fallback, and conditional RMR-floor transparency are closed.
- ☐ P3 `feat` Nutrition Phase 4 — daily carbohydrate target (spec §9). Protein deliberately out (the
  athlete already covers it); within-day timing out (needs meal-level logging they've declined);
  wearables out.

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).
