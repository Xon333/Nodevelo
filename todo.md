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

_Empty — the **EC-2026-06-27 edge-case sweep** is closed. EC-1/EC-2 (P2) and EC-3/EC-4/EC-7/EC-8 + the
`sharpen` Focus option (P3) shipped → see "Edge-case sweep EC-2026-06-27 — closeout" in
[ARCHIVE.md](ARCHIVE.md). Two items were consciously **accepted, no fix** (kept here as known limits):_

- ☑ P3 `audit` **EC-5 — EA trend is sensitive to rest-day composition (accepted).** The cur-vs-prior 7-day
  windows can hold different counts of rest days (high EA) vs hard days (low EA), so the arrow can move from
  SCHEDULING, not intake. Kept a soft arrow (no verdict) for this reason; a per-athlete band is Track C. _[nutrition.ts](lib/nutrition.ts)._
- ☑ P3 `polish` **EC-6 — new rolling baselines are silent until the next sync (self-heals).** A newly-added
  baseline field isn't in the stored `rolling-baselines.json` until a POST sync recomputes, so its tile hides
  right after deploy, then fills on the first sync. Inherent to the derive-on-sync model — no code change. _[trends/sections.tsx](components/trends/sections.tsx)._

_Prior shipped work (Season/block goals-flow, FB-2026-06-30 Today+Profile sweep, EA→CoachSnapshot wire-up,
SUB-1 block-history durable corpus, SUB-3 route tests, #4 measurement + demote halves) →
[ARCHIVE.md](ARCHIVE.md). SUB-2 (legacy backfill) investigated and paused → [ROADMAP.md](ROADMAP.md)
"Data substrate"._

---

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).
