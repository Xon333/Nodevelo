// Proactive "not feeling it?" morning override (ROADMAP #3). A manual flag — feeling ill, extremely
// fatigued, or injured — deterministically changes today's plan. No subjective sliders, no sync, no AI:
// objective fatigue is already surfaced by computeReadiness/computeFatigueAlert; this is just the athlete's
// one-tap override for "I feel worse than the load model can see."

import type { MorningCheckDecision, MorningCheckEntry, MorningCheckFlag } from "./types";

export interface MorningCheckObjective {
  isQualityDay: boolean; // today's planned session is a quality (Threshold/VO2max/SIT/RaceSim) day
}

export interface MorningCheckDecisionResult {
  decision: MorningCheckDecision;
  reasons: string[];
}

// Why injury is not just a third "downgrade" flag (S2-9):
//   ill / extreme-fatigue are *metabolic/cardiovascular* — the hazard is intensity. When it's a quality
//   day, the honest move is the load-neutral swap/deload the reschedule engine already does (still on the
//   bike, just easier) — that genuinely protects a tired-but-otherwise-fine cardiovascular system. On an
//   easy day there's nothing to downgrade, so the verdict is a plain "rest" — skip the volume day (see
//   the non-quality branch below for why that beats the old "proceed").
//
//   injury is *musculoskeletal* — the hazard is the MOTION and LOAD, not the intensity. Repetitive
//   pedaling, a fixed joint angle, and drivetrain load aggravate a strained knee / Achilles / lower back
//   just as much on a 4-hour Z2 ride as on a VO2 day (the app's own live case today is a 240-min Z2). So:
//     • The "no quality day → nothing to protect → proceed" logic is WRONG for injury — an easy day is not
//       safe when the concern is the pedaling itself. Injury therefore triggers on ANY ride day, quality
//       or not (the caller ungates the surface accordingly).
//     • Swapping the session onto an upcoming easy day (the "downgrade" mechanism) doesn't help either — it
//       just moves the same aggravating motion to a different day. So injury gets its own "rest" decision:
//       skip today, no swap, no make-up carry-forward, and see a professional if it persists. This app does
//       not attempt return-to-training programming; it just refuses to tell an injured athlete to ride.
export function decideMorningCheck(flag: MorningCheckFlag, o: MorningCheckObjective): MorningCheckDecisionResult {
  if (flag === "injury") {
    // Same verdict regardless of what's scheduled — the motion is the risk, not the intensity.
    return {
      decision: "rest",
      reasons: [
        "Reported an injury — rest today. Don't swap it onto an easy day: the pedaling motion can aggravate a strain just as much.",
        "If the pain persists or worsens, see a professional before training again.",
      ],
    };
  }
  // An easy day has no hard stimulus to protect — but the athlete flagging ill/extreme fatigue is
  // saying "I feel worse than the load model can see", and the honest answer to that on a volume day
  // is to skip it: the missed aerobic volume costs little, grinding through illness or deep fatigue
  // digs the hole deeper. (The old verdict here was "proceed — nothing to downgrade", which left the
  // athlete with no way to record skipping an easy ride they were too flat to start.)
  if (!o.isQualityDay) {
    const cause = flag === "ill" ? "feeling ill" : "extreme fatigue";
    return {
      decision: "rest",
      reasons: [
        `Reported ${cause} — skip today's easy ride. It's aerobic volume, not a key stimulus: missing it costs little, and riding through it sets recovery back further than the volume is worth.`,
      ],
    };
  }
  if (flag === "ill") return { decision: "downgrade", reasons: ["Reported feeling ill — downgrading today's quality session."] };
  if (flag === "extreme-fatigue") return { decision: "downgrade", reasons: ["Reported extreme fatigue — downgrading today's quality session."] };
  return { decision: "proceed", reasons: ["No flag set — proceeding as planned."] };
}

// Guard for the proactive *apply* (the swap/deload block mutation). The apply must only fire when the
// athlete flagged today AND got a "downgrade" decision, and the day hasn't already been ridden — the route
// is the real contract, so this can't live only in the component. Returns an error reason, or null to
// proceed. Note "rest" (injury) is intentionally NOT applyable here: it recommends skipping the day with no
// scheduling change, so there is nothing for applyProactiveReschedule to move (S2-9).
export function proactiveApplyBlock(check: MorningCheckEntry | null, rideLoggedToday: boolean): string | null {
  if (rideLoggedToday) return "Today's ride is already logged — nothing to change.";
  if (!check) return "Flag how you're feeling first.";
  if (check.decision === "rest") return "Resting today doesn't move the session — no change to apply.";
  if (check.decision === "proceed") return "Today's flag didn't recommend a change.";
  return null;
}

// One entry per date; a re-submission replaces it (the flag is editable, like a disposition).
export function mergeMorningCheck(existing: MorningCheckEntry[], entry: MorningCheckEntry): MorningCheckEntry[] {
  const byDate = new Map(existing.map((e) => [e.date, e]));
  byDate.set(entry.date, entry);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
