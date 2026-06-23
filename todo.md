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

From the 2026-06-23 sync triage (the activity field-mapping fix shipped — see [ARCHIVE.md](ARCHIVE.md)):

- ☐ **SYNC-1 · Coach note not rendering** · P2 · `bug`/`ux` (UI lane) — the note IS generated and
  persisted (`today-analysis.json` has `coachNote`, `activityDate` = today) and the GET returns it, yet
  the Today view doesn't show it even after a full reload. So it's a client render/layout bug, not data —
  likely around the coach-note `Zone` ([components/Dashboard.tsx](components/Dashboard.tsx) ~L336) vs the
  `TodayRideCard` path ([components/dashboard/today.tsx](components/dashboard/today.tsx) ~L378). Needs
  runtime inspection of the running app to pin which path renders + why it's hidden/empty.
- ☐ **SYNC-2 · Ledger rebuild after the NP/decoupling mapping fix** · P1 · `data` — the field-mapping fix
  corrects *future* syncs, but historical `score-log.json` entries are frozen with execution scores + IF
  computed off the old null NP (IF fell back to raw avg) and null decoupling. A one-time rebuild
  (re-derive past entries from `last-sync` activities with corrected fields) is needed so the calibration
  ledger (decoupling baseline, TSB edge) doesn't keep training on corrupted past values. Check
  `mergeScoreLog` freeze-vs-recompute behaviour first.
- ☑ **SYNC-3 · "Power PRs didn't appear" — NOT a bug** (verified, no action) — fetched the live
  intervals.icu `all` + `84d` power curves; both match the stored curve and the 2026-06-23 VO2 ride beat
  no standard duration (5min best stays 339 W), so `powerPRs: []` is correct. _Possible future feat_ (not
  filed): surface near-PRs / sub-5min durations, since rep 1 (~385 W/4min) isn't a checked duration.

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).

_Design/judgment calls that surfaced during the CR sweep now live in [ROADMAP.md](ROADMAP.md): power-zone
SoT vs personal override; the "Z2 dialed-in" overstatement; Recent-Baselines content / TSS-vs-Load naming;
whether IF should be replaced rather than annotated; CR-C observability (P8); CR-F per-carb checks (Track C)._
