// Which Intervals.icu calendar events to remove when a block is discarded or replaced (RV-9). Pure —
// the actual deletion (deleteEvents) lives in intervals-api.ts; these just decide the id set so the
// rules stay unit-testable. Event ids are stamped onto each CurrentBlockDay at write time.
import type { CurrentBlock } from "./types";

// Every stored event id for a block — used when the block is DISCARDED (the whole plan is thrown away,
// so all of its planned-workout events come off the calendar). Completed rides are separate activity
// objects on Intervals.icu and are unaffected. Skips days with no stored id (blocks written before
// id-tracking, or a day whose write returned none).
export function blockEventIds(block: CurrentBlock | null): number[] {
  if (!block) return [];
  return block.days.map((d) => d.eventId).filter((id): id is number => typeof id === "number");
}

// The previous block's events to prune when it's REPLACED by a freshly-written block. Two guards keep
// it from deleting the wrong things:
//   - a date the new block re-covers is upserted in place (same nodevelo-<date> uid → same event), so
//     it must NOT be deleted, or the just-written event would vanish;
//   - only FUTURE dropped dates (≥ today) are pruned — a past planned day the athlete may have already
//     ridden keeps its calendar marker; we only clear forward-looking plan that's being replaced.
export function staleEventIds(
  prevBlock: CurrentBlock | null,
  newDates: Iterable<string>,
  today: string
): number[] {
  if (!prevBlock) return [];
  const keep = new Set(newDates);
  return prevBlock.days
    .filter((d) => typeof d.eventId === "number" && d.date >= today && !keep.has(d.date))
    .map((d) => d.eventId as number);
}
