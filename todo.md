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
- ☐ `ux` P2 Nutrition input bounds (UXA-51) — `baseCalories`/`restDayTarget`/`targetWeightKg` have a
  floor of 0 and no ceiling (no authoritative one exists in code); decide if any deserve a real
  sanity ceiling.

---

- ☐ decide `i-have-adhd/`: delete or properly install (untracked clone at repo root since 2026-06-25)
- ☐ P2 `feat` Day-to-day nutrition accuracy — scoped, spec written and pending review:
  [docs/superpowers/specs/2026-07-30-day-to-day-nutrition-accuracy-design.md](docs/superpowers/specs/2026-07-30-day-to-day-nutrition-accuracy-design.md).
  RMR-based auto-computed baseline (replaces flat `baseCalories`/`restDayTarget`), fixes the
  `kj`-only blind spot that drops off-bike/non-power activity burn, adds an under-fueling streak
  alert. Next: user reviews the spec, then an implementation plan.

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).
