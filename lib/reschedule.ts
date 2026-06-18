// Deterministic reschedule engine (roadmap #3, second half). When a quality session isn't
// delivered (missed, or compromised by equipment/sickness), the prescribed *stimulus* wasn't
// done — so don't silently drop it: detect it and suggest the next rest day to make it up on,
// without creating back-to-back hard days. Pure + athlete-confirmed (the app applies it to the
// local block only; the Intervals.icu calendar mutation is a separate, larger step).

import type { CurrentBlock, WorkoutType } from "./types";

const QUALITY: WorkoutType[] = ["Threshold", "VO2max", "SIT", "RaceSim"];
const isQuality = (t: WorkoutType, durationMin: number) => durationMin > 0 && QUALITY.includes(t);

export type DispositionByDate = Record<string, "completed" | "partial" | "missed" | "compromised">;

export interface RescheduleSuggestion {
  from: string; // the missed quality day's date
  fromName: string;
  fromType: WorkoutType;
  reason: "missed" | "compromised";
  to: string | null; // earliest rest-day to make it up on; null = no slot left → carry to next block
}

export function suggestReschedule(
  block: CurrentBlock | null,
  scoredDates: Set<string>,
  dispositionByDate: DispositionByDate,
  today: string,
  recencyDays = 10
): RescheduleSuggestion | null {
  if (!block) return null;
  const days = [...block.days].sort((a, b) => a.date.localeCompare(b.date));
  const cutoff = new Date(Date.parse(today) - recencyDays * 86_400_000).toISOString().slice(0, 10);

  // The most recent recent-past quality day that wasn't delivered: no ride logged, or the
  // athlete marked it missed/compromised.
  const missed = days
    .filter((d) => isQuality(d.type, d.durationMin) && d.date < today && d.date >= cutoff)
    .filter((d) => {
      const disp = dispositionByDate[d.date];
      return disp === "missed" || disp === "compromised" || !scoredDates.has(d.date);
    })
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!missed) return null;

  const reason: "missed" | "compromised" = dispositionByDate[missed.date] === "compromised" ? "compromised" : "missed";

  // Earliest future rest day not flanked by another quality day (avoid two hard days in a row).
  let to: string | null = null;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (d.date <= today) continue;
    if (!(d.type === "Rest" || d.durationMin === 0)) continue;
    // Don't create back-to-back hard days — but ignore the missed session itself (it's being
    // moved away, and it's in the past), only its OTHER quality neighbours matter.
    const prevQ = i > 0 && days[i - 1].date !== missed.date && isQuality(days[i - 1].type, days[i - 1].durationMin);
    const nextQ = i < days.length - 1 && days[i + 1].date !== missed.date && isQuality(days[i + 1].type, days[i + 1].durationMin);
    if (prevQ || nextQ) continue;
    to = d.date;
    break;
  }

  return { from: missed.date, fromName: missed.name, fromType: missed.type, reason, to };
}
