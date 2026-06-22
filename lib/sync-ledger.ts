// Ledger schema backfill, extracted from the sync route (CR-G) so the immutable-ledger migration is
// pure and unit-tested instead of buried inline in a 340-line handler. Older score-log entries
// (written before fields like ftpUsed / legacy / inferredType existed) are filled in once,
// idempotently: an entry that already has a value keeps it, so re-running never re-shifts history.
import type { RideScoreEntry } from "./types";

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
