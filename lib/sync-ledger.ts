// Ledger schema backfill, extracted from the sync route (CR-G) so the immutable-ledger migration is
// pure and unit-tested instead of buried inline in a 340-line handler. Older score-log entries
// (written before fields like ftpUsed / legacy / inferredType existed) are filled in once,
// idempotently: an entry that already has a value keeps it, so re-running never re-shifts history.
import type { RideScoreEntry } from "./types";

// One-shot guard for the SYNC-2 ledger rebuild (LEDGER-3). The rebuild re-scores PAST entries from
// corrected activity data — a destructive, one-time migration that must not silently re-run on every
// sync. A normal sync never requests it; once it has run (a persisted `rebuiltAt` marker), a repeat
// request is refused unless `force` is set (the deliberate "re-correct after another data fix" path).
export function shouldRebuildLedger(requested: boolean, alreadyRebuilt: boolean, force: boolean): boolean {
  return requested && (!alreadyRebuilt || force);
}

export function backfillLedgerEntries(
  entries: RideScoreEntry[],
  ftpForDate: (date: string) => number,
  offPlanFloor: string | null
): RideScoreEntry[] {
  return entries.map((e) => {
    const planned = e.planned ?? e.plannedType != null;
    return {
      ...e,
      ftpUsed: e.ftpUsed ?? ftpForDate(e.date),
      planned,
      inferredType: e.inferredType ?? e.plannedType ?? "Z2",
      durationMin: e.durationMin ?? 0,
      tss: e.tss ?? null,
      // Off-plan rides before structured training began are kept as history but flagged legacy so
      // they're excluded from the execution metric + drift — there was no plan for them to be "off."
      legacy: e.legacy ?? (!planned && (offPlanFloor === null || e.date < offPlanFloor)),
    };
  });
}
