// Deterministic reschedule engine (roadmap #3, second half). When a quality session isn't
// delivered (missed, or compromised by equipment/sickness), the prescribed *stimulus* wasn't
// done — so don't silently drop it: detect it and suggest the next rest day to make it up on,
// without creating back-to-back hard days. Pure + athlete-confirmed (the app applies it to the
// local block only; the Intervals.icu calendar mutation is a separate, larger step).

import type { CurrentBlock, CurrentBlockDay, WorkoutType } from "./types";

const QUALITY: WorkoutType[] = ["Threshold", "VO2max", "SIT", "RaceSim"];
const isQuality = (t: WorkoutType, durationMin: number) => durationMin > 0 && QUALITY.includes(t);
const isRest = (t: WorkoutType, durationMin: number) => t === "Rest" || durationMin === 0;
const isEasy = (t: WorkoutType, durationMin: number) => durationMin > 0 && (t === "Z2" || t === "Recovery");

type SlotKind = "rest" | "easy";

// Earliest future make-up slot for a displaced quality session: a day of one of the requested kinds
// (rest and/or easy), not flanked by another quality day (no back-to-back hard days). `fromDate` is
// the day being moved away — ignored as a flank since it's vacating. Shared by the reactive
// (rest-only) and proactive (rest-or-easy) reschedulers.
function findMakeUpSlot(days: CurrentBlockDay[], fromDate: string, today: string, kinds: SlotKind[]): { date: string; kind: SlotKind } | null {
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (d.date <= today) continue;
    const kind: SlotKind | null = isRest(d.type, d.durationMin) ? "rest" : isEasy(d.type, d.durationMin) ? "easy" : null;
    if (!kind || !kinds.includes(kind)) continue;
    const prevQ = i > 0 && days[i - 1].date !== fromDate && isQuality(days[i - 1].type, days[i - 1].durationMin);
    const nextQ = i < days.length - 1 && days[i + 1].date !== fromDate && isQuality(days[i + 1].type, days[i + 1].durationMin);
    if (prevQ || nextQ) continue;
    return { date: d.date, kind };
  }
  return null;
}

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
  const to = findMakeUpSlot(days, missed.date, today, ["rest"])?.date ?? null;

  return { from: missed.date, fromName: missed.name, fromType: missed.type, reason, to };
}

// ---------- Proactive reschedule (roadmap #3) ----------
// The mirror of suggestReschedule: today IS a quality day and the morning check-in says the athlete
// can't deliver it. Unlike the reactive path (a logistics miss → move onto a rest day), the proactive
// trigger means the athlete is *compromised today* — so the only load-neutral move is a swap with an
// upcoming EASY (Z2/Recovery) day. We deliberately don't raid a rest day (that adds load when the
// athlete can least afford it): with no easy slot, today is an honest deload and the stimulus carries
// forward (CR-6 / RR-1). So "only the easy-day swap preserves load" holds by construction.

const RECOVERY_DOWNGRADE_MIN = 45; // recovery spin replacing today's quality when there's no easy day to swap with

export interface ProactiveReschedule {
  from: string; // today
  fromName: string;
  fromType: WorkoutType;
  to: string | null; // the easy-day swap target; null = no easy slot → honest deload, carry to next block
  // When `to` is null but a clear rest day exists, this is its date — surfaced so the UI can explain
  // that we deliberately *didn't* raid it (adding load while compromised), instead of implying nothing
  // was available (RR-1 UI note).
  skippedRestDay: string | null;
}

export function suggestProactiveReschedule(block: CurrentBlock | null, today: string): ProactiveReschedule | null {
  if (!block) return null;
  const days = [...block.days].sort((a, b) => a.date.localeCompare(b.date));
  const todayDay = days.find((d) => d.date === today);
  if (!todayDay || !isQuality(todayDay.type, todayDay.durationMin)) return null; // only meaningful on a quality day
  const slot = findMakeUpSlot(days, today, today, ["easy"]); // easy-only — never consume a rest day (RR-1)
  // No easy slot: was there a clear rest day we chose not to raid? (Only for the explanation.)
  const skippedRestDay = slot ? null : findMakeUpSlot(days, today, today, ["rest"])?.date ?? null;
  return {
    from: today,
    fromName: todayDay.name,
    fromType: todayDay.type,
    to: slot?.date ?? null,
    skippedRestDay,
  };
}

// Pure block transform: with an easy-day target, swap (today takes the easy session, the easy day
// takes today's quality — weekly load preserved). With no target, today is an honest deload to a
// recovery spin and the quality stimulus carries forward.
export function applyProactiveReschedule(
  block: CurrentBlock,
  today: string
): { days: CurrentBlockDay[]; to: string | null; deferred: string | null; skippedRestDay: string | null } | null {
  const sug = suggestProactiveReschedule(block, today);
  if (!sug) return null;
  const todayDay = block.days.find((d) => d.date === today);
  if (!todayDay) return null;
  const targetDay = sug.to ? block.days.find((d) => d.date === sug.to) ?? null : null;

  const carry = (src: CurrentBlockDay) => ({
    name: src.name,
    type: src.type,
    durationMin: src.durationMin,
    ...(src.workoutText ? { workoutText: src.workoutText } : {}),
    ...(src.prescription ? { prescription: src.prescription } : {}),
  });

  // What today becomes: the target's easy session swapped back (load preserved), else a recovery spin
  // capped so it's never longer than the quality session it replaces (CR-10).
  const todayReplacement = targetDay
    ? carry(targetDay)
    : { name: `Recovery (downgraded from ${todayDay.type})`, type: "Recovery" as WorkoutType, durationMin: Math.min(RECOVERY_DOWNGRADE_MIN, todayDay.durationMin) };

  const quality = carry(todayDay);
  const days = block.days.map((d) => {
    if (d.date === today) return { date: d.date, ...todayReplacement };
    if (sug.to && d.date === sug.to) return { date: d.date, ...quality };
    return d;
  });
  // No easy slot → today deloads and the stimulus would otherwise be lost; report it so the caller can
  // carry it forward to the next block rather than silently dropping it (CR-6).
  const deferred = sug.to === null ? `${todayDay.type} (planned ${today})` : null;
  return { days, to: sug.to, deferred, skippedRestDay: sug.skippedRestDay };
}

