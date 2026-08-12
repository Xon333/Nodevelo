// Resolution of a ride's EFFECTIVE outcome: an active intent overlay's verdict when one applies,
// otherwise the frozen ledger entry's own score. One seam, so no consumer re-implements
// overlay-then-ledger fallback (INVARIANT 34's "gate at the producer", applied to a read path).
//
// The ledger is never rewritten (INVARIANT 1) — an overlay layers OVER it, which is what makes an
// approved correction reversible: disable the overlay and the original score is authoritative again.
//
// Pure, no I/O: the caller loads the store once and resolves many entries.

import { originOf } from "./ride-origin";
import type { EffectiveOutcome, IntentOverlay, NotScoredReason, ResolvedRide, RideScoreEntry } from "./types";

// These three reasons all mean "no trustworthy intent was recovered" — which IS the definition of
// `unspecified`. Only `no-measurable-objectives` is compatible with `self-directed`: there the intent
// was clear, the ride data simply couldn't verify it (design §6's technical-descending case).
const NO_TRUSTWORTHY_INTENT: ReadonlySet<NotScoredReason> = new Set([
  "no-intent-found",
  "interpreter-failed",
  "intent-unreliable",
]);

// An overlay whose own fields contradict each other, or that oversteps what an overlay is allowed to
// assert, is not trusted — better to fall back to the frozen ledger than let a malformed record
// silently reclassify a ride or grant it a score. Fail-closed, matching this repo's "better absent
// than wrong" convention.
function isCoherent(overlay: IntentOverlay): boolean {
  // A missing score and a stated reason must accompany each other, in both directions.
  if ((overlay.effectiveExecutionScore === null) !== (overlay.notScoredReason !== null)) return false;
  if ((overlay.effectiveExecutionScore === null) !== (overlay.scoringVersion === null)) return false;
  // No trustworthy intent ⇒ unspecified. Without this an overlay could label a ride self-directed on
  // the strength of a note that couldn't be read at all, quietly exempting it from drift.
  if (
    overlay.notScoredReason &&
    NO_TRUSTWORTHY_INTENT.has(overlay.notScoredReason) &&
    overlay.origin !== "unspecified"
  ) {
    return false;
  }
  // An authoritative workout type may only accompany a recovered intent. `unspecified` means no
  // trustworthy intent existed, so a type asserted alongside it was derived from nothing — and a
  // future per-type consumer reading the field through a different path would inherit it silently.
  // Truthy check, not `!== null`: a record written before this field existed parses back `undefined`
  // (INVARIANT 3), and rejecting those would break every historical overlay Phase 4 must read.
  if (overlay.effectiveWorkoutType && overlay.origin !== "self-directed") return false;
  // An overlay can never legitimately assert a prescription — only the ledger's own `planned` flag can
  // establish that (decision #14). Without this, a malformed overlay claiming `origin: "prescribed"`
  // on an unplanned row would be admitted into per-type/compliance grouping keyed on whole-ride-IF
  // (the exact circularity Phase 1 removed), and could trip the `comps.length ? … : 0` compliance
  // fallback for a ride with no compliance concept at all.
  if (overlay.origin === "prescribed") return false;
  return true;
}

// Whether this overlay may affect derived state at all. Three independent gates:
//   • status === "active" — `pending` is Phase 4 work awaiting human approval; applying it early would
//     change effective state without consent (design §11.1, decision #10). `disabled` is soft-retired.
//   • supersededBy === null — a replaced overlay never applies, even if its status still reads active.
//     Resolution must not depend on the superseding write having been atomic.
//   • isCoherent — see above.
export function isApplicable(overlay: IntentOverlay): boolean {
  return overlay.status === "active" && overlay.supersededBy === null && isCoherent(overlay);
}

// Applicability is filtered BEFORE newest-wins selection, deliberately. Selecting the newest record and
// then testing it would let a `pending` successor silently suppress the `active` overlay it hasn't
// replaced yet — the correction would vanish from derived state the moment Phase 4 prepared its
// replacement, with no approval and no disable. Filtering first means the current active overlay keeps
// applying until its successor is actually approved.
function newestApplicable(
  overlays: IntentOverlay[],
  keyOf: (overlay: IntentOverlay) => string
): Map<string, IntentOverlay> {
  const indexed = new Map<string, IntentOverlay>();
  for (const overlay of overlays) {
    if (!isApplicable(overlay)) continue;
    const key = keyOf(overlay);
    if (!key) continue;
    const previous = indexed.get(key);
    if (!previous || overlay.createdAt > previous.createdAt) indexed.set(key, overlay);
  }
  return indexed;
}

// Newest applicable wins, independent of array order — a store appended to over time must resolve
// deterministically regardless of how it happens to sit on disk.
export function indexOverlaysByActivity(overlays: IntentOverlay[]): Map<string, IntentOverlay> {
  return newestApplicable(overlays, (overlay) => overlay.activityId);
}

// The date-keyed fallback index, for legacy ledger rows carrying no activityId (decision #9).
export function indexOverlaysByDate(overlays: IntentOverlay[]): Map<string, IntentOverlay> {
  return newestApplicable(overlays, (overlay) => overlay.date);
}

// Overlay first, ledger second — with two hard exceptions.
//
// (1) A PRESCRIBED ride always resolves to the ledger, before any lookup. Decision #14: a post-ride
//     note can never redefine a formal session after the fact to improve its score. Enforcing that here
//     rather than trusting every future writer means a malformed or misdirected overlay cannot
//     reclassify a block session — the ledger's own `planned` flag is authoritative and independent.
// (2) Date matching applies ONLY to a row with no activityId. Letting a row that HAS an id fall back to
//     a date match would let a same-day secondary ride's overlay bind to the primary ride's entry.
export function resolveEffectiveOutcome(
  entry: RideScoreEntry,
  byActivity: Map<string, IntentOverlay>,
  byDate: Map<string, IntentOverlay>
): EffectiveOutcome {
  const ledger: EffectiveOutcome = {
    effectiveExecutionScore: entry.executionScore,
    origin: originOf(entry),
    source: "ledger",
    overlay: null,
  };
  if (entry.planned) return ledger; // decision #14 — a prescription is never displaced by a note

  const matched = entry.activityId ? byActivity.get(entry.activityId) : byDate.get(entry.date);
  if (!matched) return ledger;
  return {
    effectiveExecutionScore: matched.effectiveExecutionScore,
    origin: matched.origin,
    source: "overlay",
    overlay: matched,
  };
}

// Resolve a whole ledger once. Every consumer that needs effective outcomes — execution modelling and
// drift accounting alike — takes the result of this, so the two can never diverge on what a ride was.
export function resolveAll(entries: RideScoreEntry[], overlays: IntentOverlay[]): ResolvedRide[] {
  const byActivity = indexOverlaysByActivity(overlays);
  const byDate = indexOverlaysByDate(overlays);
  return entries.map((entry) => ({ entry, outcome: resolveEffectiveOutcome(entry, byActivity, byDate) }));
}
