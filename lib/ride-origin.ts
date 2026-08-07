// Ride origin: the semantic distinction the boolean `planned` conflated — whether a prescription
// existed, versus whether the ride is evidence of drift. A self-directed ride is off-PLAN but not
// off-TRACK, and counting it as drift is the defect this whole phase exists to make impossible.
//
// Origin is DERIVED here, never stored on the ledger. A frozen row can only be prescribed or
// unspecified; `self-directed` is asserted exclusively by an active intent overlay, resolved through
// lib/intent-overlay.ts. One assertion point means the ledger and the overlay can never disagree.
//
// Pure, no I/O.

import type { RideOrigin, RideScoreEntry } from "./types";

// A ledger row can only ever be `prescribed` (a block covered the date) or `unspecified` (it didn't) —
// both fully determined by `planned`. It can never be `self-directed`, because intent is never known
// when the row is written (sync is LLM-free) and the row is frozen before the parse runs.
export function originOf(entry: Pick<RideScoreEntry, "planned">): RideOrigin {
  return entry.planned ? "prescribed" : "unspecified";
}

// Does this ride count toward the "training is drifting off-plan" signal? Only an `unspecified` ride
// during structured training. Self-directed rides are excluded by decision #1's hard requirement;
// legacy (pre-first-block) rides keep their existing exemption — there was no plan for them to be off.
//
// Takes an ORIGIN, not an entry, on purpose: the caller must have already decided whether it holds the
// raw ledger origin or the EFFECTIVE (overlay-resolved) one. Passing a ledger row here is the exact
// mistake that would let self-directed rides keep inflating offPlanPct — so the signature makes it
// impossible. Drift must always be computed from the effective origin.
export function countsAsDrift(origin: RideOrigin, legacy: boolean): boolean {
  return !legacy && origin === "unspecified";
}
