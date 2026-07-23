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

**HR-2026-07-23 — hostile review of the block/sync/archive data flows, prompted by a real bug.**
The athlete deleted their active block; it vanished from the UI but came back on refresh. Root cause
(found and fixed same-session, not part of this round): `readJsonFile` treated a legitimately-parsed
`null` — exactly what `current-block.json` holds when there's no active block — as a failed read, and
silently fell back to the `.bak` snapshot, which always holds the pre-write content (i.e. the block
that was just deleted). That fix shipped. This round is 4 parallel review passes (data-store mechanics,
API route correctness, client-side state, and block-history archival) specifically hunting for more of
this same *class* of bug — silent data loss/resurrection in the read-modify-write paths around blocks,
sync, and archiving — before trusting the area further. 35 raw findings, deduped to 29 (6 pairs found
independently by two agents). Continues the HR- series (append, not renumber).

### P1 — correctness / data-integrity (2026-07-23 round)

- ☑ P1 `bug` **HR-31** — **Fixed.** `mergeCurrentBlockDays` (`lib/data-store.ts`) no longer falls back
  to the caller's pre-write snapshot when the on-disk block reads back `null` — a cleared block is now
  respected as a real terminal state (returns `null`, no-op) instead of being silently resurrected. The
  now-pointless `fallback` parameter was dropped from the signature entirely (4 call sites +
  `persistMirroredMove`'s mock updated to match). New regression test in `lib/data-store.test.ts`
  reproduces the exact resurrection sequence (write a block → delete it → merge onto it) — RED before
  the fix, confirms GREEN after.
- ☑ P1 `bug` **HR-32** — **Fixed.** All three archive sites (sync DELETE, write-replace, retrospective)
  now accept a client-supplied `today` (`resolveToday`) instead of hardcoding `utcToday()` — threaded
  through as a DELETE query param and POST body field, matching sync's own GET/POST convention. The 3
  client callers in `PlanView.tsx` (`deleteBlock`, `write`, `generateRetro`) now send `localToday()`.
  Regression tests added to all 3 route test files proving a day already lived local-side, but not yet
  "today" server-side in UTC, is correctly archived instead of silently dropped.
- ☑ P1 `bug` **HR-33** — **Fixed.** `/api/retrospective` POST now accepts `expectedBlockCreatedAt` and
  reuses `lib/block-version.ts`'s `blockChangedResponse`, checked immediately after reading the block —
  before the live LLM call. The client (`generateRetro` in `PlanView.tsx`) now sends it alongside HR-32's
  `today`. 3 new regression tests (409 on mismatch, 200 on match, 200 when omitted entirely).
- ☑ P1 `bug` **HR-34** — **Fixed.** `PlanPreview` now has its own `writeError` prop, rendered right next
  to the Write button — `PlanView.tsx`'s `write()` sets a dedicated `writeError` state instead of
  misusing `generateError`. New static-render test confirms the error text actually appears in
  `PlanPreview`'s output.

### P2 — high-value correctness (2026-07-23 round)

- ☑ P2 `bug` **HR-35** — **Fixed.** `updateCurrentBlock`/`mergeCurrentBlockDays` (`lib/data-store.ts`)
  now take an optional `expectedCreatedAt` that's re-compared INSIDE the per-file lock, right before the
  mutator runs — a real compare-and-swap instead of check-then-act. Threaded through all four
  block-mutating routes: `app/api/sync/route.ts` DELETE (now CAS-writes the local clear FIRST, before
  touching the calendar/archive — a rejected delete no longer deletes events or archives a block it lost
  authority over), `app/api/write/route.ts` POST (rejects with 409 + rolls back this request's
  newly-created events on mismatch), `app/api/reschedule/route.ts` POST/PUT/PATCH (via
  `persistMirroredMove`'s new `versionConflict` flag, surfaced as 409), and `app/api/retrospective/route.ts`
  POST (the widest window of all — a live LLM call; on mismatch the retrospective is still saved to Plan
  history, only the block-clear is rejected). New regression tests in `lib/data-store.test.ts`,
  `lib/calendar-mirror.test.ts`, and all 4 route test files simulate a concurrent write winning the race.
- ☑ P2 `bug` **HR-36** — **Fixed.** Added `updateInterventionLog` (`lib/data-store.ts`) via
  `updateJsonFile`, operating on the whole `InterventionLog` (mirrors `updateCalibration`, not
  `updateScoreLog` — `validateInterventions` already conditionally stamps its own `updatedAt`). Both live
  call sites now route through it: `app/api/write/route.ts` (merge fresh interventions) and
  `app/api/sync/route.ts` (validate/mature outcomes) — a block write landing while a sync is in flight
  can no longer silently drop whichever side's changes land second. The now-orphaned unlocked
  `writeInterventionLog` was removed outright (zero remaining callers — leaving it would've been exactly
  the HR-54(a) footgun). New concurrency regression test in `lib/data-store.test.ts` proves both a
  concurrent merge and a concurrent validation pass land together instead of last-writer-wins.
- ☑ P2 `bug` **HR-37** — **Fixed.** `appendBlockHistory` (`lib/data-store.ts`) now checks, inside the
  same locked critical section, whether the id it's about to displace already carries a `retrospective`
  that the incoming (bare) entry lacks — if so, the existing richer entry wins outright (still bumped to
  the front) instead of being wiped by whichever archive call happened to land second. Both directions
  (rich-then-bare, bare-then-rich, rich-then-rich) covered by new tests in `lib/data-store.test.ts`.
- ☑ P2 `bug` **HR-38** — **Fixed.** `app/api/write/route.ts` now snapshots the OLD block's live
  calendar descriptions (`fetchEvents`) BEFORE the per-day write loop starts — the only point they're
  still intact, since a shared date's upsert overwrites them. On a partial-failure rollback, a shared
  date (one the old block also covered) is now restored via a fresh `createEvent` carrying the old
  block's own content and real description (`dayToEventPayload`, reused from `lib/calendar-mirror.ts`)
  instead of being deleted; only genuinely new dates (no old-block day to restore) still get deleted. New
  regression test in `app/api/write/route.test.ts` proves the shared date is restored, not destroyed,
  while the non-shared date is still cleaned up.
- ☑ P2 `bug` **HR-39** — **Fixed.** `app/api/reschedule/route.ts` POST now rejects with 400 when `to`
  is a real planned (non-rest) day — the same rest/empty check PUT/PATCH already had — instead of
  overwriting its prescription unconditionally. New regression test in
  `app/api/reschedule/route.test.ts` confirms it 400s onto an occupied day and never calls the mirror.
- ☑ P2 `bug` **HR-40** — **Fixed.** `updateScoreLog` (`lib/data-store.ts`) now accepts an async mutate;
  `app/api/sync/route.ts` moved its `readDispositions()` call from outside the lock to inside
  `updateScoreLog`'s mutate, immediately before `applyDispositions` — a disposition POST landing in that
  window can no longer have its stamp un-set by sync's stale snapshot. New regression test in
  `app/api/sync/route.test.ts` asserts (via `invocationCallOrder`) that the dispositions read happens
  after `updateScoreLog` is invoked, not before it; confirmed RED against the old ordering before the fix.
- ☑ P2 `bug` **HR-41** — **Fixed.** `atomicWrite` (`lib/json-store.ts`) now reads + parses the live file
  before rotating it into `.bak`: a genuine copy failure (anything but ENOENT) rethrows instead of being
  silently swallowed, and corrupt live content (a `SyntaxError` on parse) skips rotation entirely —
  preserving the existing `.bak` instead of overwriting the last known-good snapshot with corrupt bytes.
  New tests in `lib/json-store.test.ts` cover both: a genuine `.bak`-write failure now throws, and a
  corrupt live file no longer clobbers a good `.bak` (the new write still lands on the live file itself).
- ☑ P2 `bug` **HR-42** — **Fixed.** Added `readJsonFileWithStatus` (`lib/json-store.ts`), which signals
  `corruptFallback: true` when at least one candidate (live or `.bak`) existed but failed to read/parse —
  as opposed to plain ENOENT on both (an ordinary first-write, not corruption). `updateJsonFile` now
  refuses (throws) when a CRITICAL store's read is a corrupt fallback, instead of letting `mutate` derive
  and persist a value from bare defaults — this alone covers every CRITICAL-store transactional updater
  (`updateScoreLog`, `updateCurrentBlock`, `updateBlockHistory`, `updateDispositions`,
  `updateInterventionLog`). `readAthleteProfile`'s bespoke write-on-read migration path (not routed
  through `updateJsonFile`) got its own explicit check: the self-heal write is skipped on a genuinely
  corrupt double-read, though the in-memory migrated profile still returns so the response isn't broken.
  New tests in `lib/json-store.test.ts` and `lib/data-store.test.ts` cover the refusal, the
  still-normal-on-real-first-write case, and non-CRITICAL stores staying unaffected.
- ☑ P2 `bug` **HR-43** — **Fixed.** Added `shapeMergeProfile` (`lib/data-store.ts`), which merges the
  raw parsed `athlete.json` over `DEFAULT_PROFILE` — filling in missing `performance`/`nutrition` fields
  and defaulting absent `goals`/`weakpoints` to `[]` (fresh arrays, not shared `DEFAULT_PROFILE`
  references) — before `applyGoalsMigration` or the FTP overlay ever dereference those fields.
  `readAthleteProfile` now runs every disk read through it first. New tests cover the merge itself
  (old-format input, already-complete input, empty/null input) and an end-to-end `readAthleteProfile`
  read of an old-format file that previously would have crashed outright.
- ☑ P2 `bug` **HR-44** — **Fixed.** `GET /api/reschedule` now returns `blockCreatedAt` alongside the
  suggestion. `RescheduleBanner.tsx` captures it into its own `suggestionBlockCreatedAt` state at fetch
  time and sends THAT as `expectedBlockCreatedAt` on Apply — not `state.currentBlock?.createdAt` read
  fresh at click time. It also now reloads the suggestion whenever `state.currentBlock?.createdAt`
  changes (`useMountLoad`'s `refreshKey`, widened from `number` to `unknown` to accept a createdAt
  string). New tests in `app/api/reschedule/route.test.ts` and `components/RescheduleBanner.test.tsx`
  (confirmed RED against the old click-time read before the fix) — this is also the first component
  interaction test in the repo: added `@testing-library/react` + `jsdom` as dev dependencies (per-file
  `@vitest-environment jsdom` docblock, so the rest of the suite stays on the faster node environment).
- ☑ P2 `bug` **HR-45** — **Fixed.** `doSync` (`SyncProvider.tsx`) now calls
  `queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY })` right after its manual field merge —
  the same idiom `DayAction.tsx` already used for this exact gap (its own comment called out that
  doSync's POST response has no `currentBlock` field). New test in `components/SyncProvider.test.tsx`
  (the first `@tanstack/react-query`-backed component test in the repo, using a real `QueryClientProvider`)
  proves a block mutated server-side by the sync itself is picked up after `doSync` resolves; confirmed
  RED against the pre-fix code.
- ☑ P2 `bug` **HR-46** — **Fixed.** `RescheduleBanner.apply`'s post-apply refresh no longer does a bare
  `api<AppState>("/api/sync")` GET (which omitted `?today=`, falling back to UTC) plus a raw
  `setState(fresh)` (which replaced the entire app-state cache — a race against a concurrent Sync).
  Replaced with `queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY })`, the same idiom
  `DayAction.tsx` already uses for this exact refresh-after-move need. New test in
  `components/RescheduleBanner.test.tsx` confirms the invalidate call and that the old bare GET is gone
  entirely; confirmed RED against the pre-fix code.
- ☑ P2 `bug` **HR-47** — **Fixed.** `DayAction`'s `onMoved` now reports `{ mirrorFailed: boolean }`
  instead of firing blind; `plan.tsx`'s two call sites only `setPinnedDate(null)` (which unmounts
  `DayAction`, destroying its own failure note) when the mirror actually succeeded. A mirror failure
  leaves the popover open — the note stays visible until the athlete dismisses it themselves (outside
  click, Escape, or re-toggling the cell). New test in `components/dashboard/plan.test.tsx` (through the
  real `CurrentBlockSection` — pins a day, triggers Move, asserts the popover survives a mirror failure
  but auto-closes on success); confirmed RED against the old unconditional-close behavior.
- ☑ P2 `bug` **HR-48** — **Fixed.** `PlanView.tsx`'s `write()` now consumes `rolledBack`/`rollbackFailed`
  from the write response into a new `writeRollback` state, passed to `PlanPreview` as a `rollback` prop.
  `PlanPreview`'s `DayCard` no longer shows "✓ written" for a rolled-back day — it shows "↺ rolled back —
  not saved" (or, if that specific event's own cleanup failed per `rollbackFailed`, a distinct "⚠ rollback
  failed — check Intervals.icu"). The summary line reads "Partial write rolled back — nothing was saved"
  instead of only counting outright failures. New tests in `components/PlanPreview.test.tsx` cover both
  card states and the ordinary (non-rollback) case staying unchanged; confirmed RED against the old code.

### P3 — polish / smaller correctness (2026-07-23 round)

- ☑ P3 `bug` **HR-49** — **Fixed** (mostly incidentally, by HR-43). `shapeMergeProfile` already
  rebuilds `performance`/`nutrition` as fresh objects via spread, so the FTP/HR overlay's in-place
  mutation (`profile.performance.ftp = ...`) no longer reaches `DEFAULT_PROFILE` — verified with a new
  regression test rather than left as an assumption. The one residual gap: `goals`/`weakpoints` were
  still returned as the literal `DEFAULT_PROFILE.goals`/`.weakpoints` array references on a fallback read
  (contradicting `shapeMergeProfile`'s own doc comment) — now cloned (`[...p.goals]`) too. New tests in
  `lib/data-store.test.ts` confirm no field of a fallback-derived profile shares a reference with
  `DEFAULT_PROFILE`; confirmed RED on the array-sharing case before the clone.
- ☐ P3 `bug` **HR-50** — Profile PUT (`app/api/profile/route.ts:121-176`) persists the *read-time*
  FTP/HR overlay back into the base store — baking derived values into `athlete.json` — and is an
  unlocked read-modify-write against a concurrent PUT or the goals migration. Fix direction: an
  `updateAthleteProfile` transactional helper operating on the raw, un-overlaid file.
- ☐ P3 `bug` **HR-51** — Sync's calibration re-derive is one-sided: it reads unlocked
  (`app/api/sync/route.ts:244`) and writes with a plain `writeCalibration` (:260), while the Model page's
  manual-override POST correctly uses `updateCalibration`. A manual override landing in that narrow
  window is lost — `manualOverride` is real user input, not re-derivable. Fix direction: route sync's
  write through `updateCalibration` too.
- ☐ P3 `bug` **HR-52** — Remaining unlocked read-modify-writes on two more CRITICAL stores, both narrow
  concurrent-tab windows: `block-settings.json` (`app/api/settings/route.ts:39→110`, two concurrent
  PUTs) and `physiology.json` (`app/api/sync/route.ts:220-224`, two concurrent syncs). Same fix shape as
  HR-36/HR-51: a `updateJsonFile`-based helper for each.
- ☐ P3 `bug` **HR-53** — The ledger-rebuild marker still checks `rebuiltAt !== null`
  (`app/api/sync/route.ts:514`) instead of a truthy check — the exact AGENTS.md-documented migration-flag
  anti-pattern. A hand-edited or partially-imported marker file (`{}` on disk, parsing back as
  `undefined`) reads as "already rebuilt" and silently refuses a requested rebuild.
- ☐ P3 `bug` **HR-54** — Assorted data-store hygiene, all low-risk: (a) `writeScoreLog`/`writeDispositions`
  are exported but have zero callers — standing footguns inviting exactly HR-36's unlocked-write pattern
  if someone reaches for them later; consider removing. (b) `writeJsonFile(file, undefined)` would
  serialize to the literal string `"undefined"` (not valid JSON) — no current caller, but cheap to guard.
  (c) `app/api/disposition/route.ts:13` inlines UTC "today" (`new Date().toISOString().slice(0,10)`) for
  a user-facing default instead of `localToday()` — the AGENTS.md-flagged class, here missed. (d) An old
  `block-settings.json` predating `autoSyncOnOpen` reads that field as `undefined` → falsy → auto-sync
  silently disabled even though the documented default is `true`.
- ☐ P3 `bug` **HR-55** — Write-replace archives unconditionally (`app/api/write/route.ts:108-125`, no
  guard), unlike DELETE which only archives when `livedDays.length > 0`
  (`app/api/sync/route.ts:846-850`). A generate-then-regenerate-without-delete cycle on a future-start
  block archives a zero-content noise entry onto the athlete-visible Plan history / Trends timeline. Fix
  direction: apply the same "any lived days" guard in the write route (shared helper).
- ☐ P3 `bug` **HR-56** — `deleteBlock` (`PlanView.tsx:287-294`) discards the DELETE response body
  entirely — `eventsRemoved`/`eventsFailed` are computed server-side but never reach the UI, so a
  partially-failed calendar cleanup is invisible — and, unlike `write`/`generateRetro`, never calls
  `loadBlockHistory()` even though the server just archived lived days; the Plan history section stays
  stale until an unrelated reload.
- ☐ P3 `bug` **HR-57** — `/api/retrospective` POST has no try/catch around its live Anthropic call
  (`app/api/retrospective/route.ts:124`) — every other AI-backed route wraps this. A network blip or a
  429/overload produces an unhandled rejection and a bare framework 500 with no `{error}` body, instead
  of the coach-voice error every other route gives.
- ☐ P3 `bug` **HR-58** — `/api/generate` persists `writeSeasonPlan` mid-proposal
  (`app/api/generate/route.ts:271`) even if generation then fails or the plan is never written, via an
  unlocked blind write after an unlocked read — a concurrent season-plan edit (e.g. saving the Season
  form) in that window can be silently clobbered. Fix direction: defer persistence to the accept/write
  step, or route through a locked update.
- ☐ P3 `bug` **HR-59** — `RescheduleBanner.apply`'s single catch block
  (`RescheduleBanner.tsx:82-83`) conflates "the move itself failed" with "the post-move refresh failed" —
  a failed refresh (move actually succeeded) shows "Couldn't apply the move," which is wrong and also
  hides the real, actionable 409 message that `DayAction.tsx` correctly preserves in the equivalent path.

---

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).
