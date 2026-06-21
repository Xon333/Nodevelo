// Proactive "not feeling it?" morning check-in (ROADMAP #3). A pre-session subjective read drives a
// DETERMINISTIC proceed-vs-downgrade decision — the fatigue/sleep/soreness signals the deliberately-
// absent HRV feed would give, combined with the objective form signals (TSB / readiness / ACWR). No
// AI in the decision; the thresholds are population defaults and are calibration hooks for #2.

import type { AcwrResult, MorningCheckDecision, MorningCheckEntry, ReadinessSignal } from "./types";

export interface MorningCheckAnswers {
  fatigue: number; // 1–5, higher = more fatigued (bad)
  sleep: number; // 1–5, higher = slept better (good)
  soreness: number; // 1–5, higher = more sore (bad)
  motivation: number; // 1–5, higher = more motivated (good)
  illness: MorningCheckEntry["illness"];
}

export interface MorningCheckObjective {
  isQualityDay: boolean; // today's planned session is a quality (Threshold/VO2max/SIT/RaceSim) day
  tsb: number | null;
  readiness: ReadinessSignal["level"] | null;
  acwr: AcwrResult["level"] | null;
}

// Population-default band edges — calibration hooks for #2 (per-athlete tuning).
const STRAIN_HIGH = 15; // strain alone forces a downgrade
const STRAIN_MED = 12; // strain that downgrades only when the objective signals agree
const TSB_DEEP = -25;

// Subjective strain, 4 (fresh) … 20 (wrecked).
export function strainScore(a: MorningCheckAnswers): number {
  return a.fatigue + a.soreness + (6 - a.sleep) + (6 - a.motivation);
}

export interface MorningCheckDecisionResult {
  decision: MorningCheckDecision;
  strain: number;
  reasons: string[];
}

export function decideMorningCheck(a: MorningCheckAnswers, o: MorningCheckObjective): MorningCheckDecisionResult {
  const strain = strainScore(a);
  const reasons: string[] = [];

  // Only quality days have a stimulus worth protecting; an easy/rest day just proceeds.
  if (!o.isQualityDay) {
    return { decision: "proceed", strain, reasons: ["Today isn't a quality day — nothing to downgrade."] };
  }

  const objectivePoor = (o.tsb !== null && o.tsb <= TSB_DEEP) || o.readiness === "Recover" || o.acwr === "high" || o.acwr === "danger";

  let downgrade = false;
  if (a.illness !== "none") {
    downgrade = true;
    reasons.push(a.illness === "sick" ? "Reported illness (sick)." : "Reported illness (mild) before a quality day.");
  }
  if (strain >= STRAIN_HIGH) {
    downgrade = true;
    reasons.push(`High reported strain (${strain}/20).`);
  } else if (strain >= STRAIN_MED && objectivePoor) {
    downgrade = true;
    const bits: string[] = [];
    if (o.tsb !== null && o.tsb <= TSB_DEEP) bits.push(`TSB ${o.tsb}`);
    if (o.readiness === "Recover") bits.push("readiness Recover");
    if (o.acwr === "high" || o.acwr === "danger") bits.push(`ACWR ${o.acwr}`);
    reasons.push(`Moderate reported strain (${strain}/20) with the objective signals agreeing (${bits.join(", ")}).`);
  }

  if (!downgrade) reasons.push(`You're good — reported strain ${strain}/20${objectivePoor ? ", but watch it" : ""}.`);

  return { decision: downgrade ? "downgrade" : "proceed", strain, reasons };
}

// Guard for the proactive apply (the downgrade + reschedule). The apply must only fire when the
// athlete actually checked in *and* got a downgrade, and the day hasn't already been ridden — the
// route is the real contract, so this can't live only in the component. Returns an error reason, or
// null when the apply may proceed.
export function proactiveApplyBlock(check: MorningCheckEntry | null, rideLoggedToday: boolean): string | null {
  if (rideLoggedToday) return "Today's ride is already logged — nothing to downgrade.";
  if (!check) return "Do a morning check-in first.";
  if (check.decision !== "downgrade") return "Today's check-in didn't recommend a downgrade.";
  return null;
}

// One entry per date; a re-submission replaces it (the check is editable, like a disposition).
export function mergeMorningCheck(existing: MorningCheckEntry[], entry: MorningCheckEntry): MorningCheckEntry[] {
  const byDate = new Map(existing.map((e) => [e.date, e]));
  byDate.set(entry.date, entry);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
