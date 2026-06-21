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

Re-review of `63a9263` (CR-9..16 hardening). **RR-1..4 are the priority (P1).**

| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| RR-1 | ☑ | P1 | bug | **Rest-day reschedule path now honest deload.** Proactive reschedule is easy-only (`findMakeUpSlot(..., ["easy"])`); no easy slot → today deloads to Recovery + carries forward, rest days never raided. `toWasRest` removed from the interface, route response, and `MorningCheckIn`. [reschedule.ts](lib/reschedule.ts) |
| RR-2 | ☑ | P1 | test | **CR-10 cap + deload paths now tested.** Added: swap-skips-rest, honest-deload-not-raid-rest, and `min(45, original)` cap (long→45, short→original) cases. [reschedule.test.ts](lib/reschedule.test.ts) |
| RR-3 | ☑ | P1 | bug | **Loading-week detection now theme-aware.** `isLoadingWeek` = ≥2 quality AND `weekTheme` not recovery/deload/unload/taper — a recovery week that keeps 2 quality is no longer flagged. [session-requirements.ts](lib/session-requirements.ts) |
| RR-4 | ☑ | P1 | bug | **Negation now clause-scoped.** Replaced the 15-char back-scan with `clauseStart` (breaks on punctuation/dashes/`but`/`however`/`yet`); a negation only flips a tag in its own clause — `"no gym, hilly race"` now requires a RaceSim. [session-requirements.ts](lib/session-requirements.ts) |
| RR-5 | ☐ | P2 | audit | **CR-9 only half-DRY:** both routes still hand-write `resolveAcwrBands(...)` before `resolveCoachSignals` — band resolution still duplicated across the two routes. [ask/route.ts](app/api/ask/route.ts), [generate/route.ts](app/api/generate/route.ts) |
| RR-6 | ☐ | P2 | refactor | **`CoachSignals` ↔ `CoachSnapshotInput` kept in sync by a comment, not types.** Make `CoachSnapshotInput extends CoachSignals` (or `Pick`) so the compiler enforces it. [coach-snapshot.ts:93](lib/coach-snapshot.ts:93) |
| RR-7 | ☐ | P3 | refactor | `acwrBands: Parameters<typeof computeAcwr>[1]` is opaque/fragile — name & import the real type. [coach-snapshot.ts:103](lib/coach-snapshot.ts:103) |
| RR-8 | ☑ | P2 | ux | **Warnings consolidated** — one warning naming every offending loading week (`weeks 1, 3 …`) instead of one per week. Bounded fan-out. [session-requirements.ts](lib/session-requirements.ts) |
| RR-9 | ☑ | P2 | test | **Branches covered:** multi-week consolidation, recovery-week exclusion, and block-floor fallback all tested. [session-requirements.test.ts](lib/session-requirements.test.ts) |
| RR-10 | ☐ | P2 | feat | CR-13: mild illness is now **fully inert below threshold** — full-intensity quality on a head cold. Consider intensity cap / proceed-but-flag instead of binary. [morning-check.ts:57](lib/morning-check.ts:57) |
| RR-11 | ☐ | P3 | bug | No input validation/clamping on `MorningCheckAnswers` — `strainScore` is unbounded if values fall outside 1–5. Confirm route validates or clamp here. [morning-check.ts:30](lib/morning-check.ts:30) |
| RR-12 | ☐ | P3 | polish | `byWeek` grouping assumes contiguous weekNumber + builds a Map only to sort its entries; minor cleanup. [session-requirements.ts:66](lib/session-requirements.ts:66) |

**Decisions locked (2026-06-21):**
- **RR-1 → Honest deload + carry.** Proactive reschedule only swaps onto an *easy* day (load-neutral); if no easy slot, today→Recovery and the quality carries forward via the existing `deferred` path (CR-6). Drop the rest-target/`toWasRest` swap so "only the easy-day swap preserves load" is true by construction.
- **RR-3 → Heuristic + weekTheme exclude.** Keep ≥2-quality but skip weeks whose `weekTheme` marks recovery/deload/taper.
- **RR-8 → One consolidated warning** listing the offending week numbers.
- **RR-10 → Cap intensity.** Add a `proceed-easy` outcome (neck-check rule): mild illness proceeds but downgrades hard intervals to moderate. Note: expands `MorningCheckDecision` — touches the type, route, and component.

_Process note (no fix needed): `63a9263` bundled 8 review items (incl. doc-only CR-14/15/16) in one commit — keep future CR closures atomic so they can be reverted/bisected independently._

_Design/judgment items live in [ROADMAP.md](ROADMAP.md): power-zone SoT vs personal override; the
"Z2 dialed-in" overstatement; Recent-Baselines content / TSS-vs-Load naming; whether IF should be
replaced rather than annotated. Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md)._
