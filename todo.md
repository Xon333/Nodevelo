# NodeVelo — live punch-list

Short-lived tracker for **incoming bugs and feedback** — things to action soon, not strategy.
Keep it lean: when an item ships, move its one-line record to [ARCHIVE.md](ARCHIVE.md).

- **What's next / strategy** → [ROADMAP.md](ROADMAP.md)
- **Completed work** → [ARCHIVE.md](ARCHIVE.md)
- **Research spikes** → [research.md](research.md)

**Legend** — Status: ☐ todo · ◑ partial · ☑ done · Priority: P1 correctness/data-integrity ·
P2 high-value UX/feature · P3 polish/education · Type: `bug` `ux` `feat` `audit` `edu`

---

## ⛔ Hardening gate — clear before new ROADMAP features

From a self-review of the §5 / #1 / #3 / Track B work. **The P1 merge-blockers `CR-1..3` are cleared
(✅ shipped, verified). No new ROADMAP feature (#2, the CoachSnapshot Today-surfacing WIP, etc.) until
the P2/P3 connective tissue below also clears.**

| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| CR-1 | ☑ | P1 | bug | **DONE.** Durability intensity is no longer invisible: `carriesEmbeddedIntensity` ([`prescription.ts`](lib/prescription.ts)) flags an endurance ride carrying ≥5 min of ≥88%-FTP work; `validateSchedule` (now takes `ftp`) treats such a Z2 ride as a hard day for back-to-back spacing, and `validateWorkoutProtocol` validates the embedded inserts against a threshold∪VO2 envelope (≤122%, ≤20 min). Budget stays type-based (durability complements). Ledger-scoring of inserts remains the deferred future scoring loop. |
| CR-2 | ☑ | P1 | bug | **DONE.** `PUT /api/morning-check` now guards via `proactiveApplyBlock` ([`morning-check.ts`](lib/morning-check.ts)) — refuses unless today's stored check recommended `downgrade` and no ride is logged. |
| CR-3 | ☑ | P1 | bug | **DONE.** `/api/ask` + `/api/morning-check` resolve the client's local date (`resolveToday`); `AskCoach` + `MorningCheckIn` thread `localToday()` on every call. UTC-boundary disagreement closed. |
| CR-4 | ☑ | P2 | audit | **DONE (rescoped per discussion — crash fix + thin skeleton, no generic encyclopedia).** Committed `knowledge-base-defaults/` (schema + the §4/§10/§11/§12 anchors the prompt cites). [`kb-loader.ts`](lib/kb-loader.ts) now reads local-else-default and never throws on a missing dir (the `readdir` 502 is gone); a fresh clone / CI runs. Your real `knowledge-base/` stays gitignored + preferred — unchanged. |
| CR-5 | ☐ | P2 | bug | **ACWR computed two ways.** `/api/ask` uses bare `computeAcwr` (population bands) while Today/generate use `resolveAcwrBands(settings)` → Ask-Coach can contradict the readiness strip. Use calibrated bands wherever the snapshot is built. [`ask/route.ts`](app/api/ask/route.ts) |
| CR-6 | ☐ | P2 | bug | **No make-up slot ⇒ stimulus evaporates.** When no rest/easy day is free, the proactive path downgrades today and "carry to next block" is a comment, not code — the quality work is just lost. Persist it (retro seed / flag) or warn. [`reschedule.ts applyProactiveReschedule`](lib/reschedule.ts) |
| CR-7 | ☐ | P2 | bug | **Goal matcher has no negation.** "avoid hills" / "no racing" force a false RaceSim requirement; "granfondo"/"racecourse" false-negative. Tighten or document. [`session-requirements.ts`](lib/session-requirements.ts) |
| CR-8 | ☑ | P2 | audit | **DONE.** Added a vitest `@/` alias config + integration tests (IO + LLM mocked) for the three LLM-facing routes: morning-check GET/POST/PUT incl. the CR-2 apply guard; ask CoachSnapshot assembly + disposition guard (#1); generate Track-B RaceSim requirement + durability stamp. +11 tests. (The thin `/api/write` path is left uncovered for now.) |
| CR-9 | ☐ | P2 | audit | **CoachSnapshot assembled twice, by hand.** Ask passes real today-data, generate passes nulls — drift risk. Extract one `buildCoachSnapshotFromStores()` both call. [`coach-snapshot.ts`](lib/coach-snapshot.ts) |
| CR-10 | ☐ | P2 | ux | **"Load-preserving" overclaimed.** Only the easy-day swap preserves load; the rest-day branch hardcodes 45-min Recovery (drops a 4 h day's volume + eats the rest day). Scale the downgrade to the volume target; soften the ROADMAP claim. [`reschedule.ts RECOVERY_DOWNGRADE_MIN`](lib/reschedule.ts) |
| CR-11 | ☐ | P2 | audit | **Calibration debt is outrunning #2.** Strain bands (15/12), TSB −25, IF effort bands, durability limiter map — all uncalibrated population constants added this session. Consolidate under ROADMAP **#2** (which these features keep deferring) rather than scattering more. |
| CR-12 | ☐ | P3 | bug | RaceSim requirement under-enforced — prompt says "per loading week", validator only checks ≥1/block. Tighten (needs loading-vs-recovery-week detection). [`session-requirements.ts`](lib/session-requirements.ts) |
| CR-13 | ☐ | P3 | ux | `illness: "mild"` force-downgrades even at minimal strain — likely too blunt; consider "proceed easy" for mild + low strain. [`morning-check.ts`](lib/morning-check.ts) |
| CR-14 | ☐ | P3 | bug | Durability rotation reads the *old active* block's stamp → regenerate-before-write reselects the same template; pre-feature/first blocks always start at A. Minor. [`durability.ts`](lib/durability.ts) + generate route |
| CR-15 | ☐ | P3 | audit | Both reschedule paths rewrite the local block only — the Intervals.icu calendar (system of record) stays stale. Bundle the calendar mutation with ROADMAP §7 bidirectional sync. [`reschedule.ts`](lib/reschedule.ts) |
| CR-16 | ☐ | P3 | audit | The "low-token spot-check" isn't cheap anymore — Ask-Coach now reads `interventionLog` + `morning-check` and runs the full synthesis chain (athlete model → insights → validation → directives) + snapshot on every question. Trim to what the spot-check actually needs if latency/cost shows. [`ask/route.ts`](app/api/ask/route.ts) |

_Design/judgment items also live in [ROADMAP.md](ROADMAP.md): power-zone SoT vs personal override; the
"Z2 dialed-in" overstatement; Recent-Baselines content / TSS-vs-Load naming; whether IF should be
replaced rather than annotated. Add new bugs/feedback here; strategy → [ROADMAP.md](ROADMAP.md)._
