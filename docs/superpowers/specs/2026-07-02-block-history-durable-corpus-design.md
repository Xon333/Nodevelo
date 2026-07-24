# Durable Planned Corpus (Block-History) — Design

**Date:** 2026-07-02
**Status:** Shipped 2026-07-02 → [ARCHIVE.md](../../../ARCHIVE.md) "SUB-1 · Durable planned corpus (block-history)"
**ROADMAP:** `SUB-1` under "Data substrate — turn the loop over ⭐". Sibling `SUB-2` (legacy backfill
importer, pre-app rides) was paused 2026-07-02 after a live Intervals.icu API check showed only 22–28%
of that corpus has calendar-event backing — separate scope, not a blocker here. Ties `MACRO` (the
2026-07-01 macro-periodization spec already flagged "synergy with SUB-1, not a blocker").

---

## 1. Problem & context

`buildRideScores` (`lib/score-log.ts:51-182`) matches a ride to a prescription using only the *live*
`CurrentBlock.days` (lines 71-72 build `plannedByDate` solely from `block.days`). The moment a block is
superseded (a new one written), completed (retrospective), or discarded, its per-day prescriptions
vanish from the matching path — only `BlockHistoryEntry` (`lib/types.ts:401-421`) survives the block's
death, and that type captures goal/overview/retrospective-level fields, never `days`.

Concretely: a ride whose block has since rolled off is not `legacy` (that flag means "before the app's
first block ever existed" — `lib/score-log.ts:142`) — it's silently `planned:false`, indistinguishable
from a ride with no plan at all, even though a plan genuinely existed. The trainable corpus (rides with
`planned:true`, the only ones execution learning uses) can only ever grow forward from whatever block is
currently live; it can never recover a past one. Per the 2026-06-30 audit, this is why the corpus is 13
planned vs 100 legacy despite six months of real training.

**No block has rolled over yet** — `data/block-history.json` doesn't exist on disk, and the first block
(started 2026-06-15) runs through 2026-07-12. This is greenfield: the design's job is to ship before that
date so the corpus never develops the hole in the first place, not to repair existing damage.

## 2. Goals / non-goals

**Goals**
- `block-history` retains per-day prescriptions so `buildRideScores` can match a ride against *any*
  historical block, not just the current one.
- Self-sustaining: once shipped, the corpus stops losing entries as blocks roll over — no recurring
  manual step required.
- Compose with the immutable-ledger invariants (LEDGER-1/2/3) unmodified — extend the matching input,
  don't touch the freeze/merge/rebuild logic that already correctly handles the result.

**Non-goals**
- SUB-2 (pre-app legacy backfill) — separate, paused 2026-07-02.
- Repairing already-frozen-wrong entries — none exist yet; shipping before 2026-07-12 makes this moot.
- A provenance/trust-tier field distinguishing "matched live" vs "matched via history" — no consumer
  exists today (see §4).
- `block-history` pruning/cap — **correction (final review, 2026-07-02): this claim was wrong.**
  `appendBlockHistory` (`lib/data-store.ts`) already caps at 20 entries (pre-existing, not part of this
  design), and discard/supersede archiving (§6) pushes churn well above "one per real block" — 20 was
  evicting real history within a season. Fixed by raising the cap to 200, not by adding new pruning logic,
  so the "no new mechanism" spirit of this non-goal holds even though the premise didn't.

## 3. Approach — history-aware first-scoring

The naive framing ("archive `days`, then build a mechanism to re-derive already-frozen-wrong entries")
turns out to be solving a problem that doesn't need to exist. The ledger's rebuild merge already permits
an off-plan→planned upgrade with zero changes: `mergeScoreLogRebuild` (`lib/score-log.ts:206-215`) only
blocks the *downgrade* case —
```
if (prev?.planned && !f.planned) continue; // LEDGER-1: a rebuild can't un-plan a frozen entry
```
— if `prev.planned` is false and the fresh re-derivation now finds a match (`planned:true`), the fresh
entry wins unconditionally. The only reason this upgrade never happens today is that `buildRideScores`
never has a historical prescription to find.

So instead of building a new "re-match on archive" trigger (which would sit awkwardly against
LEDGER-3's explicit intent — the full ledger rebuild is a deliberately rare, manual, one-shot operation,
`lib/sync-ledger.ts:6-12`, "a destructive, one-time migration that must not silently re-run on every
sync"), **make `buildRideScores` history-aware on every normal sync, not just on rebuild.**

`mergeScoreLog` (the normal-sync merge, `lib/score-log.ts:191-196`) always keeps an already-frozen entry
over a fresh one — a date once scored never re-derives on a normal sync. So passing `history` into the
*normal* path only changes behavior for dates **not yet in the ledger**: brand-new rides get scored
correctly against their real prescription the first time, whether that prescription lives in the current
block or a historical one. Nothing is ever frozen wrong, so nothing ever needs upgrading. The manual
rebuild stays exactly what it's for — a rare recovery tool for the residual edge case (a sync gap that
spans a block rollover) — rather than becoming part of the normal delivery path.

## 4. Data model

`BlockHistoryEntry` (`lib/types.ts:401-421`) gains:
```ts
days?: CurrentBlockDay[];
```
Verbatim reuse of the existing `CurrentBlockDay` type — no new type, no projection/mapping code. The
matcher applies the same `durationMin > 0` filter at match time it already applies to the current
block (`lib/score-log.ts:72`), so a trimmed projection would save a few KB in a local JSON file at the
cost of a second type kept in sync at three call sites. Not worth it.

**One transform at archive time: truncate `days` to dates ≤ the archive date** ("archive the lived
portion only"). A superseded or discarded block's *future* days were never a live plan — no ride can
legitimately match them — and archiving them would manufacture the overlap case §6 has to handle at
runtime. Truncating at the source removes most of that ambiguity before it exists. On a natural
retrospective-completion archive this is a no-op (the block ran its full course).

## 5. Matching integration — `buildRideScores`

`lib/score-log.ts:51` gains an optional parameter:
```ts
history?: BlockHistoryEntry[]
```
`plannedByDate` (currently built only from `block.days`, lines 71-72) is seeded in two passes:
1. From `history`, in ascending `createdAt` order — each entry's (already-truncated) `days`.
2. From `block.days` last (unchanged from today).

Map-overwrite semantics give "current block wins on any date collision, else the most-recently-created
historical block covering that date" for free — no explicit tie-break branch needed. One guard on the
historical pass: a historical day only contributes if that block's `createdAt` ≤ the ride's date (a ride
can't have executed a prescription written after it happened). The current-block pass is untouched —
zero regression surface on today's live-scoring behavior.

There is a single `buildRideScores` call site (`app/api/sync/route.ts:267`); its output (`fresh`) feeds
both merge paths (`doRebuild ? mergeScoreLogRebuild : mergeScoreLog`). Passing `history` into that one
call site — sourced via the existing `readBlockHistory()` (`lib/data-store.ts`) — is enough to make both
the normal-sync path and the rebuild path history-aware; no second call site to wire up. The ≤400-entry
ledger cap and the ~13-entry/year history size make this scan trivially cheap on every sync.

## 6. Archive-site changes

Three places a block "dies" today; two already call `appendBlockHistory`, one doesn't:

1. **Write-time supersede** (`app/api/write/route.ts:91-106`) — fires whenever a new block is written
   over an existing one. Add `days` (truncated to ≤ today) to the existing archive payload.
2. **Retrospective completion** (`app/api/retrospective/route.ts:237-257`) — athlete-triggered; add
   `days` (truncation is a no-op here — the block ran its course).
3. **Discard** (`DELETE` in `app/api/sync/route.ts`, ~line 480-495) — today calls `writeCurrentBlock(null)`
   directly with **no** `appendBlockHistory` call at all, silently losing any days already ridden against
   a since-discarded block. This is the one behavior change beyond "add a field": start archiving here
   too, with the same lived-portion truncation, **but only when at least one day was actually lived** — a
   same-day discard (regenerated before any day passed) truncates to zero days and is skipped entirely.
   "Discard" means "stop prescribing from this block," not "the sessions I already rode against it didn't
   happen" — truncation already excludes the rejected future days, so archiving the lived past closes a
   real corpus leak. **Correction (final review, 2026-07-02): "costs nothing" was wrong** — the archive
   already feeds two athlete-visible surfaces (§12), and every discard consumes a slot in the (now-larger)
   cap above; a zero-lived-days entry is pure noise on both fronts with no offsetting corpus value, hence
   the added guard.

## 7. Edge cases & degradation

- **Sync gap spanning a rollover** (a ride happens, its block rolls off, and no sync occurs in between)
  is the one residual case history-aware first-scoring doesn't close automatically — the ride would still
  score correctly *whenever* it's first synced (history is checked then too), so this only matters if a
  sync genuinely never happens for that date before the ledger otherwise moves on. Recoverable via the
  existing manual rebuild (`{rebuildLedger:true, force:true}`) if it's ever observed. No new machinery
  built for it.
- **Overlapping historical blocks** on the same date (two blocks both archived, both covering a date) —
  rare after §4's truncation; resolved by createdAt recency per §5.
- **Pre-existing history entries without `days`** — none exist (`block-history.json` isn't on disk yet).
  `days` is optional; an entry lacking it simply contributes nothing to matching. No migration needed.

## 8. Error handling

No new failure modes. `days` is an added field on records already written through the existing atomic
write + per-file lock + `.bak` snapshot pattern (`lib/json-store.ts`).

**Correction (final review, 2026-07-02):** the claim that an archive failure "should not block the block
deletion" was wrong — describes intent this design never implemented. All three archive calls (including
the discard path's new one) are bare, unwrapped `await`s, matching the file's existing pattern (the
`deleteEvents` calendar call above the discard site isn't wrapped either). A local JSON write failing
there surfaces as a normal request failure, ordered *before* `writeCurrentBlock(null)` clears the block —
fail-before-destructive-clear, so a failure is retryable and never silently loses the block's local state.
This is the right behavior; the doc, not the code, was wrong.

## 9. Testing

Extend `lib/score-log.test.ts`:
- A ride matching a *historical* (not current) block's day → `planned:true`, `legacy:false`.
- Current block and a historical block both cover a date → current wins.
- A historical block's `createdAt` is after the ride's date → no match (guard holds).
- Two historical blocks cover the same date → most-recent `createdAt` wins.
- Discard-path archival: `days` truncated to ≤ discard date; days after are dropped.
- A history entry with no `days` (legacy/pre-SUB-1 record) → contributes nothing, no crash.

## 10. Pillar alignment

- **Deterministic core** — no LLM touches this path; purely a matching-input extension.
- **Immutable ledger** — LEDGER-1 (never downgrade), LEDGER-2 (carry-forward provenance), LEDGER-3
  (rebuild stays rare/manual) are all read, not modified. The design's whole point is to compose with
  them rather than add a parallel mechanism.
- **Local-first, single-user** — reuses the existing JSON store; no new dependency, no new file beyond
  the already-existing (currently just unpopulated) `block-history.json`.

## 11. Dependencies & sequencing

No dependency on SUB-2 (paused, unrelated). Should ship before **2026-07-12**, when the current block
ends — after that date, the first natural rollover happens, and every day after is a day the corpus could
otherwise silently lose.

## 12. Out of scope (v1)

- Provenance/trust-tier marking on `RideScoreEntry` (§3's non-goals — no consumer today; purely additive
  to add later as `matchSource?: "live" | "history"` if one appears).
- `block-history` pruning or size cap beyond raising the pre-existing one (see §2 correction).
- **New** UI — no screen, component, or copy was added or changed by this design. **Correction (final
  review, 2026-07-02): the original claim ("nothing here is athlete-visible") was wrong** — `days` rides
  along on `BlockHistoryEntry` records that two pre-existing, unmodified surfaces already render:
  `/api/history` → `PlanView`'s block-history list, and `/api/trends`'s block timeline. This design didn't
  add those surfaces, but archiving a discard (§6) does make a new *kind* of entry appear there — the
  zero-lived-days guard added in §6 is what actually keeps that surface clean, not the absence of a
  consumer.
