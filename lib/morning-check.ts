// Proactive "not feeling it?" morning check-in (ROADMAP #3). A pre-session subjective read drives a
// DETERMINISTIC proceed-vs-downgrade decision — the fatigue/sleep/soreness signals the deliberately-
// absent HRV feed would give, combined with the objective form signals (TSB / readiness / ACWR). No
// AI in the decision; the thresholds are population defaults and are calibration hooks for #2.

import { resolveStrainBands, resolveTsbModifierEdges, type StrainBands } from "./calibration";
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

// The strain bands + TSB-deep cutoff are population defaults under the #2 calibration framework
// (resolveStrainBands / resolveTsbModifierEdges), not local literals — see lib/calibration.ts. The
// route passes the athlete's manual overrides (settings.strainBands / settings.tsbModifierEdges); an
// absent override resolves to the population default, so an un-overridden check decides identically.

// Subjective strain, 4 (fresh) … 20 (wrecked). The /api/morning-check route is the validation
// boundary (it rejects non-1–5 ratings with a 400); strainScore also clamps each input so the score
// stays in its documented range for any direct caller (RR-11).
const clamp1to5 = (n: number): number => Math.max(1, Math.min(5, n));
export function strainScore(a: MorningCheckAnswers): number {
  return clamp1to5(a.fatigue) + clamp1to5(a.soreness) + (6 - clamp1to5(a.sleep)) + (6 - clamp1to5(a.motivation));
}

export interface MorningCheckDecisionResult {
  decision: MorningCheckDecision;
  strain: number;
  reasons: string[];
}

// `cal` carries the athlete's resolved calibration edges (strain bands + TSB-deep cutoff); omit it and
// the population defaults apply, so an un-overridden check decides byte-identically.
export interface MorningCheckCalibration {
  strainBands?: StrainBands;
  tsbDeepEdge?: number;
}

export function decideMorningCheck(
  a: MorningCheckAnswers,
  o: MorningCheckObjective,
  cal: MorningCheckCalibration = {}
): MorningCheckDecisionResult {
  const strain = strainScore(a);
  const reasons: string[] = [];
  const { high: strainHigh, med: strainMed } = cal.strainBands ?? resolveStrainBands();
  const tsbDeep = cal.tsbDeepEdge ?? resolveTsbModifierEdges().deepFatigue;

  // Only quality days have a stimulus worth protecting; an easy/rest day just proceeds.
  if (!o.isQualityDay) {
    return { decision: "proceed", strain, reasons: ["Today isn't a quality day — nothing to downgrade."] };
  }

  const objectivePoor = (o.tsb !== null && o.tsb <= tsbDeep) || o.readiness === "Recover" || o.acwr === "high" || o.acwr === "danger";

  let downgrade = false;
  let easy = false; // proceed but cap intensity (neck-check rule)
  // Sickness always downgrades a quality day. Mild illness downgrades only when strain or the
  // objective signals also say so; otherwise (a sniffle on fresh legs) it proceeds *easy* — train but
  // cap the hard intervals rather than either nuking the day or going full gas (CR-13 / RR-10).
  if (a.illness === "sick") {
    downgrade = true;
    reasons.push("Reported illness (sick).");
  } else if (a.illness === "mild") {
    if (strain >= strainMed || objectivePoor) {
      downgrade = true;
      reasons.push("Mild illness alongside elevated strain/fatigue — don't push a quality day.");
    } else {
      easy = true;
      reasons.push("Mild illness on otherwise-fresh legs — proceed easy and cap the hard intervals (neck-check rule).");
    }
  }
  if (strain >= strainHigh) {
    downgrade = true;
    reasons.push(`High reported strain (${strain}/20).`);
  } else if (strain >= strainMed && objectivePoor) {
    downgrade = true;
    const bits: string[] = [];
    if (o.tsb !== null && o.tsb <= tsbDeep) bits.push(`TSB ${o.tsb}`);
    if (o.readiness === "Recover") bits.push("readiness Recover");
    if (o.acwr === "high" || o.acwr === "danger") bits.push(`ACWR ${o.acwr}`);
    reasons.push(`Moderate reported strain (${strain}/20) with the objective signals agreeing (${bits.join(", ")}).`);
  }

  // A downgrade outranks an easy cap (the body's telling you more than a sniffle is going on).
  const decision: MorningCheckDecision = downgrade ? "downgrade" : easy ? "proceed-easy" : "proceed";
  if (decision === "proceed") reasons.push(`You're good — reported strain ${strain}/20${objectivePoor ? ", but watch it" : ""}.`);

  return { decision, strain, reasons };
}

// Guard for the proactive apply (a downgrade+reschedule or an easy cap). The apply must only fire
// when the athlete actually checked in *and* got an actionable decision (downgrade or proceed-easy),
// and the day hasn't already been ridden — the route is the real contract, so this can't live only in
// the component. Returns an error reason, or null when the apply may proceed.
export function proactiveApplyBlock(check: MorningCheckEntry | null, rideLoggedToday: boolean): string | null {
  if (rideLoggedToday) return "Today's ride is already logged — nothing to change.";
  if (!check) return "Do a morning check-in first.";
  if (check.decision === "proceed") return "Today's check-in didn't recommend a change.";
  return null;
}

// One entry per date; a re-submission replaces it (the check is editable, like a disposition).
export function mergeMorningCheck(existing: MorningCheckEntry[], entry: MorningCheckEntry): MorningCheckEntry[] {
  const byDate = new Map(existing.map((e) => [e.date, e]));
  byDate.set(entry.date, entry);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
