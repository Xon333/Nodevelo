// Deterministic schedule-placement validation. Generation is *instructed* to space quality
// sessions ("avoid back-to-back hard days") and to cap them at the weekly budget, but nothing
// enforced it — workout-validate.ts checks each session's protocol bands, not where it lands in
// the week. This closes that gap: a post-generation pass over the block's day sequence that flags
//   (a) two hard/quality days on consecutive calendar dates, and
//   (b) any week carrying more quality sessions than the loading-week budget.
//
// Deterministic: emits warnings only, never reorders the coach's plan — same contract as
// validatePlanProtocol. The generate route folds these straight into the plan's warnings array
// alongside the protocol checks.

import type { BlockSettings, PlannedDay, WorkoutType } from "./types";
import { carriesEmbeddedIntensity } from "./prescription";

// The intensity ("hard") sessions: structured quality work that drives adaptation and needs an
// easy/rest day after it. RaceSim is a peaking/sharpening session (KB §10, whole-session IF
// ~0.80–0.88) and counts toward the quality budget + spacing the same as the interval types —
// keeping intervals primary while race-sim breaks indoor-ladder monotony (see ROADMAP goal-driven
// selection). Z2, Recovery, Strength and Rest are not hard and never trip these checks.
const QUALITY_TYPES = new Set<WorkoutType>(["Threshold", "VO2max", "SIT", "RaceSim"]);

function isQuality(day: PlannedDay): boolean {
  return QUALITY_TYPES.has(day.type);
}

// A day is "hard" for spacing if it's a quality type OR an otherwise-easy ride carrying a real dose
// of embedded threshold/VO2 work (a durability template) — so the back-to-back guard isn't blind to
// intensity hidden inside a Z2 ride. (The quality *budget* below stays type-based: durability
// complements the budgeted quality work, it doesn't count against it.)
function isHardDay(day: PlannedDay, ftp: number): boolean {
  return isQuality(day) || carriesEmbeddedIntensity(day.workoutText, ftp);
}

function hardLabel(day: PlannedDay): string {
  return isQuality(day) ? day.type : `${day.type} (embedded intensity)`;
}

// Whole calendar days from isoA to isoB (noon-anchored to dodge DST edges).
function daysBetween(isoA: string, isoB: string): number {
  return Math.round((Date.parse(`${isoB}T12:00:00Z`) - Date.parse(`${isoA}T12:00:00Z`)) / 86_400_000);
}

// Validate a whole generated block's session *placement*. Returns a (possibly empty) list of
// human-readable warnings — never throws, never mutates.
export function validateSchedule(days: PlannedDay[], settings: BlockSettings, ftp: number): string[] {
  if (days.length === 0) return [];
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const warnings: string[] = [];

  // (a) Back-to-back hard days: a hard session (quality type, or an endurance ride carrying embedded
  // threshold/VO2 work) on two consecutive calendar dates. Checked by date adjacency (not array
  // position) so a gap never false-pairs. Spans week boundaries naturally (a Sat→Sun across the split).
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (isHardDay(prev, ftp) && isHardDay(cur, ftp) && daysBetween(prev.date, cur.date) === 1) {
      warnings.push(
        `SCHEDULE: back-to-back hard days — ${hardLabel(prev)} on ${prev.date} then ${hardLabel(cur)} on ${cur.date}. Put an easy or rest day between hard sessions.`
      );
    }
  }

  // (b) Weekly quality budget: more quality sessions in a week than the loading-week budget. A
  // recovery week naturally sits under the budget, so only over-prescribed weeks fire — no need
  // to identify which week is the recovery week.
  const byWeek = new Map<number, PlannedDay[]>();
  for (const d of sorted) {
    const list = byWeek.get(d.weekNumber);
    if (list) list.push(d);
    else byWeek.set(d.weekNumber, [d]);
  }
  const budget = settings.qualitySessionsPerLoadingWeek;
  for (const [week, weekDays] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    const quality = weekDays.filter(isQuality);
    if (quality.length > budget) {
      warnings.push(
        `SCHEDULE: week ${week} has ${quality.length} quality sessions (${quality
          .map((d) => d.type)
          .join(", ")}) — over the ${budget}/week budget.`
      );
    }
  }

  return warnings;
}
