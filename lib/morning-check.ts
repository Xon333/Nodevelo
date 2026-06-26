// Proactive "not feeling it?" morning override (ROADMAP #3). A single manual flag — feeling ill or
// extremely fatigued — deterministically downgrades today's quality session. No subjective sliders, no
// sync, no AI: objective fatigue is already surfaced by computeReadiness/computeFatigueAlert; this is just
// the athlete's one-tap override for "I feel worse than the load model can see."

import type { MorningCheckDecision, MorningCheckEntry, MorningCheckFlag } from "./types";

export interface MorningCheckObjective {
  isQualityDay: boolean; // today's planned session is a quality (Threshold/VO2max/SIT/RaceSim) day
}

export interface MorningCheckDecisionResult {
  decision: MorningCheckDecision;
  reasons: string[];
}

// Either bad flag downgrades a quality day; an easy/rest day has no stimulus to protect, so it proceeds.
export function decideMorningCheck(flag: MorningCheckFlag, o: MorningCheckObjective): MorningCheckDecisionResult {
  if (!o.isQualityDay) {
    return { decision: "proceed", reasons: ["Today isn't a quality day — nothing to downgrade."] };
  }
  if (flag === "ill") return { decision: "downgrade", reasons: ["Reported feeling ill — downgrading today's quality session."] };
  if (flag === "extreme-fatigue") return { decision: "downgrade", reasons: ["Reported extreme fatigue — downgrading today's quality session."] };
  return { decision: "proceed", reasons: ["No flag set — proceeding as planned."] };
}

// Guard for the proactive apply. The apply must only fire when the athlete actually flagged today AND got an
// actionable (downgrade) decision, and the day hasn't already been ridden — the route is the real contract,
// so this can't live only in the component. Returns an error reason, or null when the apply may proceed.
export function proactiveApplyBlock(check: MorningCheckEntry | null, rideLoggedToday: boolean): string | null {
  if (rideLoggedToday) return "Today's ride is already logged — nothing to change.";
  if (!check) return "Flag how you're feeling first.";
  if (check.decision === "proceed") return "Today's flag didn't recommend a change.";
  return null;
}

// One entry per date; a re-submission replaces it (the flag is editable, like a disposition).
export function mergeMorningCheck(existing: MorningCheckEntry[], entry: MorningCheckEntry): MorningCheckEntry[] {
  const byDate = new Map(existing.map((e) => [e.date, e]));
  byDate.set(entry.date, entry);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
