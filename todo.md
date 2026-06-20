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

| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| MR-1 | ☐ | P1 | bug | **IF basis inconsistent.** Today card + `score-log.ts` compute IF from NP (`normalizedPower ?? avgWatts`), but the coach-note prompt (`anthropic-api.ts` `analyseRide`, ~L401) uses **avg watts** → the note's IF reads lower/misleading vs the card. Make the note NP-based too; fix the stale `// avg watts / FTP` comment on `TodayAnalysis.intensityFactor`. (NP itself is already synced from `icu_normalized_power` — no change needed there.) |
| MR-2 | ☐ | P1 | bug | **Weekly-hours window mismatch.** Recent-Baselines "Weekly hours" comes from `behaviour` (`score-log.ts` `weeklyHours = totalHours / weeks` over the logged window), while its sibling tiles (Avg TSS/ride, decoupling, cadence) are **90-day rolling** (`RollingBaselines`). Align to one window or relabel so the card isn't mixing horizons. |
| UX-1 | ☐ | P2 | ux | **Power bar overflows horizontally** on the Today ride card — compact it so there's no horizontal scroll (lean-UX mandate). (The `ZoneBars` "Time in power zones" row / power chart on the ride card.) |
| UX-2 | ☐ | P2 | ux | **Trend-pulse "Weekly volume" tile dead-ends.** Its onClick is `router.push("/trends")`, but /trends has no weekly-volume view to land on, so it feels like it goes nowhere. Give it a real destination (a volume section / deep-link / scroll target) or drop the click affordance. |
| UX-3 | ☐ | P3 | ux | **Execution-quality card:** add a hover/`MetricTip` explanation, and verify the card compresses gracefully as more rides become visible (no squish/overflow). |
| RC-1 | ☐ | P2 | feat | **Avg speed on Today ride card.** `TodayAnalysis` carries no distance/speed (only `ActivitySummary.distanceMeters` does) — thread `distanceMeters` (or a computed `avgSpeedKmh`) through the sync route onto `TodayAnalysis` and show it alongside the power metrics. |

_Design/judgment items from the same feedback batch were routed to [ROADMAP.md](ROADMAP.md): power-zone
SoT vs personal override; the "Z2 dialed-in" overstatement (time-above-zone discipline signal); and the
Recent-Baselines content / TSS-vs-Load naming / NP-Avg "two values" reconsideration._

_Add new bugs/feedback here as they come in. For anything strategic or multi-session, put it in
[ROADMAP.md](ROADMAP.md) instead._
