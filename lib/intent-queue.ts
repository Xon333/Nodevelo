// The intent-parse work queue: which synced rides still need their athlete note interpreted.
//
// Derivable, never persisted — recomputed on every run from the synced activities, the score-log
// ledger and the existing overlay store. That is what makes the whole pipeline idempotent for free:
// there is no queue file to fall out of sync with reality, and a crash mid-run costs at most a repeat
// of the items that never reached a terminal state.
//
// Pure, no I/O. The impure orchestration — reading the stores, calling the model, writing overlays,
// retry and supersession — lives in the runner. Everything here is a decision about WHICH rides are
// eligible, and correctness of those decisions must not depend on the runner remembering to re-check.

import { createHash } from "node:crypto";
import type { ActivitySummary, IntentOverlay, RideScoreEntry } from "./types";

// How many items one runner invocation may process. Exported here because it belongs with the queue's
// contract, but deliberately NOT applied by `buildIntentQueue`: the queue returns every eligible item
// so the runner can report an honest `remaining` count after taking its slice. A queue that
// pre-truncated would make `remaining` permanently read 0 and the client would stop looping early.
export const INTENT_MAX_PER_RUN = 5;

// One ride awaiting interpretation. `note` is the RAW description — the runner normalizes it (to
// decide the no-note case) and truncates it (for the prompt); carrying the raw text keeps both those
// concerns out of the queue. `fingerprint` is computed from the same text, so a note edit produces a
// different item and idempotency keys on exactly what was interpreted.
export interface IntentQueueItem {
  activityId: string;
  date: string;
  note: string;
  fingerprint: string;
  durationMin: number;
}

export interface BuildIntentQueueOptions {
  // Activity ids whose `needsParse` skip is bypassed — and ONLY that skip. Force never crosses the
  // `autoFromDate` boundary, the prescribed rule or the primary-ride rule: those are correctness, not
  // caching. The runner resolves the id itself from today's primary ride; no id crosses the wire.
  force?: readonly string[];
  // Repo convention (lib/sync-analysis.ts): a caller-owned array the callee pushes onto, never throws
  // into. A ledger/primary mismatch is reported here rather than silently swallowed.
  warnings?: string[];
}

// Whitespace-insensitive so that reformatting a note — a newline the athlete added, trailing spaces
// Intervals.icu kept — does not read as an edit and re-bill a parse. An absent note and a
// whitespace-only note both normalize to "", which is what makes "this ride has no note" a stable,
// idempotent fact rather than a permanent re-queue.
export function normalizeNote(description: string | null | undefined): string {
  return (description ?? "").trim().replace(/\s+/g, " ");
}

// First 16 hex of sha256(normalized). 16 hex = 64 bits, far more than enough to distinguish the notes
// of one athlete's rides, and short enough to read in a JSON store by eye.
export function noteFingerprint(description: string | null | undefined): string {
  return createHash("sha256").update(normalizeNote(description)).digest("hex").slice(0, 16);
}

// Mirrors `isRide` in lib/score-log.ts. Duplicated rather than imported because this module must stay
// free of the scoring engine's dependency graph; the cross-module parity test in intent-queue.test.ts
// is what keeps the two definitions honest if either ever changes.
function isRide(activity: ActivitySummary): boolean {
  return activity.type === "Ride" || activity.type === "VirtualRide";
}

// Whole minutes, matching what the ledger froze as `durationMin`. Rounding matters to the comparison
// below, not just to display: two rides 19 seconds apart are the SAME length to buildRideScores, so a
// primary-ride helper comparing raw seconds would disagree with the ledger about which one won.
function rideDurationMin(activity: ActivitySummary): number {
  return Math.round(activity.movingTimeSec / 60);
}

// The date's key session — the ride the ledger scored. Reproduces buildRideScores' collision rule
// exactly (lib/score-log.ts: `if (!prior || entry.durationMin > prior.durationMin)`): longest wins by
// STRICT `>` over the activity array's own order, so the FIRST ride wins an exact tie.
//
// The strictness is the whole point. A `>=` here would pick the last tied ride while the ledger kept
// the first, and the overlay would then be bound to an activity id the ledger never stamped —
// resolving against nothing, invisibly, from both sides.
export function primaryRideOfDate(activities: ActivitySummary[], date: string): ActivitySummary | null {
  let primary: ActivitySummary | null = null;
  let primaryMin = 0;
  for (const activity of activities) {
    if (activity.date !== date || !isRide(activity)) continue;
    const durationMin = rideDurationMin(activity);
    if (durationMin <= 0) continue;
    if (!primary || durationMin > primaryMin) {
      primary = activity;
      primaryMin = durationMin;
    }
  }
  return primary;
}

// Has this exact note, on this exact ride, already been decided?
//
// The test reads ALL overlays, not the applicable ones. `isApplicable` is the natural-looking choice
// and the wrong one: it excludes `disabled` and `pending`, so using it here would re-parse and re-bill
// every record a human deliberately turned off (resurrecting it) and every record Phase 4 has prepared
// for review (racing the reviewer) on every single sync.
//
// A SUPERSEDED record is the one case that does re-parse: it interpreted a note that no longer exists.
export function needsParse(activityId: string, fingerprint: string, overlays: IntentOverlay[]): boolean {
  return !overlays.some(
    (overlay) =>
      overlay.activityId === activityId && overlay.noteFingerprint === fingerprint && overlay.supersededBy === null
  );
}

// Which rides still need a note parsed, newest first.
//
// Driven off the LEDGER, not the activity list: a ride the ledger never scored has no row for an
// overlay to layer over, so interpreting its note would produce a record nothing ever reads.
export function buildIntentQueue(
  activities: ActivitySummary[],
  entries: RideScoreEntry[],
  overlays: IntentOverlay[],
  today: string,
  autoFromDate: string | null | undefined,
  opts: BuildIntentQueueOptions = {}
): IntentQueueItem[] {
  // Fail closed. `autoFromDate` is the rollout floor that keeps 2b out of the historical no-block
  // period Phase 4 owns — a period that must be reviewed by a human, never silently auto-approved. An
  // unset boundary therefore means "auto-process nothing", never "auto-process everything". The runner
  // persists the boundary in its own transaction before the first queue build; this is the guard for
  // the case where that somehow did not happen. Truthy check, not `!= null`: a store written before
  // the field existed parses back `undefined`, not `null` (INVARIANT 3).
  if (!autoFromDate) return [];

  const forced = new Set(opts.force ?? []);
  const items: IntentQueueItem[] = [];

  for (const entry of entries) {
    // A prescription is never redefined by a post-ride note (decision #14). Enforced at the producer
    // as well as at resolution: an overlay that is never written cannot be misresolved later.
    if (entry.planned) continue;
    if (entry.date > today) continue;
    // Question 0's floor, enforced HERE rather than in the runner precisely so that `force` cannot
    // cross it — force bypasses idempotency, never a correctness boundary.
    if (entry.date < autoFromDate) continue;

    const primary = primaryRideOfDate(activities, entry.date);
    if (!primary) continue;

    // Date matching alone is insufficient. When the ledger row carries an id and it names a DIFFERENT
    // ride than the current activity set calls primary, binding an overlay to `primary` would attach
    // it to a row the resolver will never match: resolveEffectiveOutcome uses the ACTIVITY index for a
    // row that has an id and never falls back to the date index for it, so the overlay would resolve
    // against nothing — silently, from both sides. Skip and report; never guess. Truthy check because
    // a pre-Phase-2a row parses the field back as `undefined` (INVARIANT 3) — that is the legacy path
    // below, not a mismatch.
    if (entry.activityId && entry.activityId !== primary.id) {
      opts.warnings?.push(`intent: ledger/primary mismatch on ${entry.date}`);
      continue;
    }

    // For a row with NO activityId — every row in the real ledger today — the overlay binds to
    // `primary.id` and `entry.date`, and resolution goes through the date index. That index is not
    // primary-ride-aware, so what keeps the legacy path safe is this loop's own guarantee that only
    // the primary ride is ever enqueued for a date, hence at most one active overlay per date.
    const note = primary.description ?? "";
    const fingerprint = noteFingerprint(note);
    if (!forced.has(primary.id) && !needsParse(primary.id, fingerprint, overlays)) continue;

    // A note-less ride still enqueues: it needs a deterministic `no-intent-found` overlay so the
    // ledger's own off-plan verdict is not the last word on a ride the athlete simply did not annotate.
    items.push({
      activityId: primary.id,
      date: entry.date,
      note,
      fingerprint,
      durationMin: rideDurationMin(primary),
    });
  }

  // Newest first: the most recent ride is the one the athlete is looking at, and the one whose
  // interpretation most affects what the coach says next.
  return items.sort((a, b) => b.date.localeCompare(a.date));
}
