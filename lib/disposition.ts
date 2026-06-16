// Pure helpers for session dispositions — the athlete's attribution of why a session went how
// it did. Deterministic; the only consumer-facing effect is gating which rides teach the model.

import type { DispositionEntry, RideScoreEntry } from "./types";

// One entry per date; a re-submission replaces it (attribution is editable, unlike the ledger).
export function mergeDisposition(existing: DispositionEntry[], entry: DispositionEntry): DispositionEntry[] {
  const byDate = new Map(existing.map((e) => [e.date, e]));
  byDate.set(entry.date, entry);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Dates the athlete marked as compromised (the only disposition that changes how a ride is
// scored into the model — kept as history, excluded from the execution metric).
export function compromisedDates(entries: DispositionEntry[]): Set<string> {
  return new Set(entries.filter((e) => e.disposition === "compromised").map((e) => e.date));
}

// Stamp the derived `compromised` flag onto ledger entries from the current dispositions. Pure
// — re-derivable on every sync (and on each disposition edit) without rewriting frozen scores.
export function applyDispositions(entries: RideScoreEntry[], dispositions: DispositionEntry[]): RideScoreEntry[] {
  const compromised = compromisedDates(dispositions);
  return entries.map((e) => ({ ...e, compromised: compromised.has(e.date) }));
}
