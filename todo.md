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

- 📌 ☐ P2 `audit` **RV2-15 — re-center the strain bands once `deriveStrainHigh` has real ledger stamps.**
  The wellness strain adapter feeds a neutral `sleep=3` (no wearable autofill), so strain's live range is
  6–18 not 4–20 and the `med 12 / high 15` bands were never re-centered. Safe today — the guards fall back to
  the population bands — but DON'T FORGET to re-fit once the ledger carries enough stamped strain values to
  derive the high band honestly. Data-gated (chicken/egg). _[morning-check.ts](lib/morning-check.ts) · ROADMAP Inc 2._

- 🔎 ☐ P3 `feat` **Lap-data — confirm the `laps` field against a live payload.** `fetchIntervals` now prefers
  device laps (>1 in the response) for the executed side, else falls back to `icu_intervals` (shipped). But the
  separate `laps` array is **unconfirmed** against a real `/activity/{id}/intervals` response — Intervals folds
  laps into `icu_intervals` via the per-activity **"Keep All Laps"** setting, so that toggle may be the real
  lever. Absent `laps` the path is byte-identical to before (can't regress). Confirm whether a structured ride
  actually carries a `laps` array; if not, it's a harmless no-op and "Keep All Laps" is the fix.
  _[intervals-api.ts](lib/intervals-api.ts)._

---

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).
