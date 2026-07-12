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

**HR-2026-07-12 — hostile review of the past 3 days' commits (`619b8c4..HEAD`, UX v2 Wave 5 polish
through today's morning-check/trend-detector fixes).** 15 findings from an xhigh multi-agent review
(10 independent finder angles, 38 raw candidates deduped — one bug was independently caught by 7 of
10 angles). None shipped yet; burn down P1 first.

### P1 — correctness / data-integrity

- ☑ P1 `bug` **HR-1** — Today's trend-detector fix (`a3321c7`) only patched `trendOf()` in
  `lib/athlete-model.ts`. Three other files reimplement the identical split-half-mean trend
  algorithm and still lack the tail-turnaround guard: `halvesDir()` in
  [lib/trends-verdict.ts:27](lib/trends-verdict.ts:27), `trendDir()` in
  [components/trends/sections.tsx:12](components/trends/sections.tsx:12), and `trendArrow()` in
  [components/MultiSparkline.tsx:57](components/MultiSparkline.tsx:57). The Trends page verdict
  strip can still show "declining" on an engine/delivery/energy axis whose last two sessions have
  already recovered — the exact bug just fixed one call site over. **Fix once** in a shared helper
  all four call.
- ☑ P1 `bug` **HR-2** — `/api/generate` resolves "today" via raw
  `new Date().toISOString().slice(0, 10)` (UTC) at 4 separate call sites
  ([app/api/generate/route.ts:174,178,179,189](app/api/generate/route.ts:174)) instead of
  `resolveToday()`/`localToday()`. This is the AGENTS.md-documented recurring bug class, reintroduced
  in the same diff that correctly fixed it in `/api/ask` and `/api/sync` — and it breaks the CR-9
  "can't drift" guarantee `resolveCoachSignals` exists to give: a west-of-UTC athlete generating a
  block near local midnight gets a different "today" (and thus a different weekly-energy window and
  season phase) than Ask-Coach/Trends show for the same moment. 7 of 10 review angles independently
  flagged this.
- ☑ P1 `bug` **HR-3** — `reconcileInboundMoves`' conflict map (`dayAt`,
  [lib/calendar-mirror.ts:110](lib/calendar-mirror.ts:110)) is built once from the block's original
  days and never updated as the loop applies moves. Two events dragged onto the same
  originally-vacant date in one sync both pass the "target is Rest" check — the second silently
  overwrites the first instead of surfacing an occupied-day warning, permanently dropping one
  athlete-confirmed move.
- ☑ P1 `bug` **HR-4** — `writeCurrentBlock` ([lib/data-store.ts:90](lib/data-store.ts:90)) is a
  plain `writeJsonFile`, not the lock-protected `updateJsonFile` pattern `score-log.json`/
  `dispositions.json` use for exactly this reason. This diff adds several new concurrent writers of
  `current-block.json` (reschedule PUT/PATCH, morning-check PUT, sync's inbound-reconcile writes);
  two near-simultaneous requests can silently clobber each other's move with no error.
- ☑ P1 `bug` **HR-5** — **Won't-fix (athlete decision, 2026-07-12).** The IF-based over-intensity
  penalty for Z2/Recovery days was deleted ([lib/execution-score.ts:118](lib/execution-score.ts:118))
  and replaced with an HR-based judge that's a no-op when HR data is missing (no strap, sync gap).
  Re-reading the code comments at [lib/execution-score.ts:177-179](lib/execution-score.ts:177) showed
  this was a deliberate, documented tradeoff (not an oversight) when the HR-based judge replaced the
  old terrain-confounded power penalty — outdoor Z2 rides were getting falsely flagged "too hard" from
  hill/wind power spikes. Athlete confirmed: keep "no HR data → no penalty" as accepted behavior rather
  than reintroducing the terrain false-positives an IF-based fallback would bring back.

### P2 — high-value UX / correctness

- ☑ P2 `bug` **HR-6** — `MorningCheckIn`'s post-refresh verdict card
  ([components/MorningCheckIn.tsx:148](components/MorningCheckIn.tsx:148)) previews a reschedule
  suggestion recomputed live by the GET route, not the one frozen when the flag originally fired. If
  the block changes in between (a manual Move, say), the preview and what tapping Apply actually
  executes can silently diverge.
- ☑ P2 `bug` **HR-7** — `lib/trends.ts`'s new weekly-intake aggregation guards on
  `kcalConsumed > 0` ([lib/trends.ts:127](lib/trends.ts:127)) instead of `!== null`, so a
  legitimately-logged 0-kcal day (e.g. a tracked fast) silently drops out of the week's intake total
  and logged-day count — a regression vs. the codebase's own convention of treating 0 as a real
  value for this field.
- ☐ P2 `audit` **HR-8** — The fuel-line prompt change (`9ec687b`, feeding `/api/generate`'s LLM
  prompt) shipped without the AGENTS.md-required live Anthropic smoke run — the commit message
  self-admits substituting a unit test against fixture shapes instead. Run it once against the real
  API before trusting the prompt output.
- ☐ P2 `ux` **HR-9** — Rider Profile's systems tiles
  ([components/AthleteProfileForm.tsx:279](components/AthleteProfileForm.tsx:279)) dropped absolute
  watts and W/kg, leaving only "% vs expected" — the raw per-system numbers are no longer visible
  anywhere on the page (Power PRs shows all-time best efforts, not per-system profile estimates).
- ☐ P2 `bug` **HR-10** — `MorningCheckDecisionResult` now returns `decision: "rest"` for both a
  genuine injury stop and a non-quality-day fatigue skip ([lib/morning-check.ts:42](lib/morning-check.ts:42));
  only the separate `flag` field actually distinguishes them. Any future caller that branches on
  `decision` alone (as the type name invites) will describe both identically.

### P3 — polish / cleanup

- ☐ P3 `bug` **HR-11** — `applyCalendarMirror`
  ([lib/calendar-mirror.ts:179](lib/calendar-mirror.ts:179)) and `/api/sync`'s inbound-reconcile loop
  ([app/api/sync/route.ts:448](app/api/sync/route.ts:448)) both `await` independent per-date
  Intervals.icu calls sequentially instead of running them concurrently — doubles mutation latency on
  any 2-date move (swap, downgrade-with-make-up).
- ☐ P3 `ux` **HR-12** — `components/MoveDay.tsx` and `components/SwapDay.tsx` are near-total
  structural duplicates (same state shape, same busy/error/note handling) differing only in HTTP
  verb and labels — extract a shared component/hook.
- ☐ P3 `bug` **HR-13** — `calendar-mirror.ts`'s `dayToEventPayload`
  ([lib/calendar-mirror.ts:16](lib/calendar-mirror.ts:16)) re-implements the event-payload shape
  `lib/plan-parser.ts`'s `planDayToEvent` already builds (the new code's own comment admits mirroring
  it) — the two can drift independently.
- ☐ P3 `bug` **HR-14** — `lib/trends.ts`'s `latestWeeklyBalance`
  ([lib/trends.ts:161](lib/trends.ts:161)) hand-rolls a 7-day date offset instead of calling
  `lib/date.ts`'s existing `isoDaysAgo`/`addDaysIso`.
- ☐ P3 `bug` **HR-15** — `/api/reschedule`'s PUT and PATCH handlers
  ([app/api/reschedule/route.ts:246](app/api/reschedule/route.ts:246)) duplicate the same
  request-parsing/existence/future-only-date validation prologue almost line for line — factor into
  one shared helper so a future validation fix doesn't have to be applied twice.

---

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).
