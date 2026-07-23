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
- ☐ P2 `bug` **HR-40** — Sync applies a stale dispositions snapshot inside the score-log lock.
  `app/api/sync/route.ts:510` reads dispositions *outside* `updateScoreLog`'s lock; line 528 applies them
  inside it via `applyDispositions`, which sets `compromised` to exactly the read snapshot — clearing the
  flag for any date not in it. A disposition POST landing in that window has its stamp immediately
  un-set by sync's stale list, and since sync is user-triggered, the wrong flag can persist for a day or
  more (feeds Trends and the learning gate). Fix direction: re-read dispositions inside the lock,
  immediately before applying.
- ☐ P2 `bug` **HR-41** — `atomicWrite`'s `.bak` rotation (`lib/json-store.ts:105`) swallows every copy
  error, not just the expected first-write ENOENT — a real EACCES/EIO/ENOSPC during a disk-pressure
  event silently voids the backup guarantee exactly when it matters. Separately: if the *live* file is
  corrupt (recovered via `.bak` on read) but not yet fixed, the next write copies those corrupt bytes
  over the last good `.bak` before writing new content — a crash between that copy and the rename leaves
  both copies unusable, and the next read silently falls all the way to the fallback. Fix direction:
  rethrow non-ENOENT copy errors; skip (or gate) the `.bak` rotation when the current live content
  doesn't parse.
- ☐ P2 `bug` **HR-42** — A bad/fallback value can get silently written back as real data for CRITICAL
  stores. `readAthleteProfile` "writes on read" (`lib/data-store.ts:52-56`): if both `athlete.json` and
  its `.bak` are corrupt, the migration branch fires on `DEFAULT_PROFILE` and persists factory-default
  goals/nutrition to disk, permanently overwriting whatever was recoverable. `updateScoreLog`
  (`app/api/sync/route.ts:521`) has the same shape — a double-corrupt ledger silently becomes a
  near-empty one that sync then treats as real. Fix direction: have `readJsonFile` signal "this was the
  fallback, not a real read" and make write-back paths refuse (or at least warn) before persisting a
  fallback as truth for a CRITICAL store.
- ☐ P2 `bug` **HR-43** — An old-format `athlete.json` (reachable via restoring an old backup through
  `app/api/import/route.ts:48`) crashes `readAthleteProfile` outright — it dereferences fields
  (`profile.goals.length` at `lib/data-store.ts:44`, `profile.performance.ftp` at :61-69) that the type
  declares required but that a pre-goals-migration file never had, with no shape-merge against
  `DEFAULT_PROFILE` first. Every profile-dependent route 500s persistently, with no self-heal (the
  migration write that would fix it never gets the chance to run). Fix direction: shape-merge the parsed
  profile over `DEFAULT_PROFILE` before the migration check runs.
- ☐ P2 `bug` **HR-44** — A stale reschedule suggestion can mutate the wrong block, and the UXA-24 guard
  structurally can't catch it. `RescheduleBanner.tsx:31-41` loads its suggestion once on mount and never
  reloads it after write/delete/retro/sync; `apply` (lines 64-77) sends `expectedBlockCreatedAt` from
  `state.currentBlock` *at click time* — the current block, not the block the stale suggestion was
  actually computed against — so the version check passes even though the premise is dead. If the
  athlete writes a replacement block covering the same dates while the banner's still showing an old
  suggestion, Apply copies content from the *new* block onto a date chosen for the *old* one. Fix
  direction: capture `createdAt` at suggestion-fetch time and send that; reload the suggestion whenever
  `state.currentBlock?.createdAt` changes.
- ☐ P2 `bug` **HR-45** — `doSync` never updates or invalidates the cached `currentBlock` in
  `SyncProvider.tsx:163-183` — the POST response carries no `currentBlock` field, even though POST
  `/api/sync` can mutate the block itself (inbound calendar-move reconciliation, execution backfill). No
  invalidation follows, and every `setQueryData` call re-freshens react-query's 30s `staleTime`. An
  athlete who moves a session on Intervals.icu and hits Sync sees a success toast while the calendar
  strip still shows the pre-move layout — and can then act (move/swap) against days that no longer hold
  what the UI claims. Fix direction: `invalidateQueries(SYNC_QUERY_KEY)` at the end of `doSync`, or
  return and merge `currentBlock` from the POST response.
- ☐ P2 `bug` **HR-46** — `RescheduleBanner.apply`'s own post-apply refresh (`RescheduleBanner.tsx:78-79`,
  `api<AppState>("/api/sync")`) omits `?today=`, so the server falls back to UTC — the same recurring
  class as HR-32, here on the client. Worse, `setState(fresh)` replaces the *entire* app-state cache: if
  the athlete also has a Sync in flight when they hit Apply, whichever response lands second wins and is
  marked fresh for 30s, with no error surfaced either way. Fix direction: pass `?today=${localToday()}`
  and replace the manual GET+setState with `invalidateQueries(SYNC_QUERY_KEY)` — `DayAction.tsx` already
  does exactly this; the two flows should be consistent.
- ☐ P2 `bug` **HR-47** — `DayAction`'s calendar-mirror-failure note (`DayAction.tsx:52-62`) —
  specifically the "Intervals.icu update failed (will drift until re-synced)" case — can never actually
  be read. `onMoved?.()` fires immediately after, which calls `setPinnedDate(null)` in
  `plan.tsx:344-345`, which unmounts `DayAction` (the `eligible && pinned` gate at `plan.tsx:342`) on the
  next render — destroying the note before the athlete has a real chance to see it. Same silent-failure
  shape as the delete bug this session started from. Fix direction: lift mirror-status display out of
  the popover into `CurrentBlockSection` itself, or don't auto-close the popover on a mirror failure.
- ☐ P2 `bug` **HR-48** — A partial write shows "✓ written" on cards whose events were just rolled back.
  `app/api/write/route.ts:94-104` correctly rolls back created events on partial failure and returns
  `rolledBack`/`rollbackFailed`, but `PlanView.tsx:261-267` only destructures `{results, currentBlock}` —
  `PlanPreview.tsx:45-49` still marks the successful-looking cards as written even though their events
  were just deleted, and orphaned `rollbackFailed` ids never reach any UI. Fix direction: consume both
  fields; render an accurate "partial write — rolled back" banner instead of implying partial success.

### P3 — polish / smaller correctness (2026-07-23 round)

- ☐ P3 `bug` **HR-49** — `readAthleteProfile` mutates the shared, module-level `DEFAULT_PROFILE.performance`
  object in place (`lib/data-store.ts:61-69`) when overlaying md/physiology FTP data onto a fallback
  read — polluting the process-wide default for every later fallback read in the same process. Fix
  direction: deep-clone the fallback (or build the overlay immutably) before mutating.
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
