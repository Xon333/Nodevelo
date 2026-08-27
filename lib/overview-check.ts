import type { PlannedDay, WorkoutType } from "./types";
import type { WeekTarget } from "./block-skeleton";
import { round1 } from "./stats";

const QUALITY_TYPES: WorkoutType[] = ["Threshold", "VO2max", "SIT", "RaceSim"];

export interface WeekFacts {
  weekNumber: number;
  isRecovery: boolean;
  totalHours: number;
  qualityCounts: Partial<Record<WorkoutType, number>>; // only types that actually occurred
  longestRideMinutes: number;
}

// Pure: the ground truth the critic checks the overview against. Driven by weekTargets (not just
// days) so a week with zero generated days still appears — a real gap the overview shouldn't paper over.
export function extractBlockFacts(days: PlannedDay[], weekTargets: WeekTarget[]): WeekFacts[] {
  const byWeek = new Map<number, PlannedDay[]>();
  for (const d of days) {
    const list = byWeek.get(d.weekNumber);
    if (list) list.push(d);
    else byWeek.set(d.weekNumber, [d]);
  }
  return weekTargets.map((t) => {
    const weekDays = byWeek.get(t.weekNumber) ?? [];
    const totalMin = weekDays.reduce((sum, d) => sum + d.durationMin, 0);
    const qualityCounts: Partial<Record<WorkoutType, number>> = {};
    for (const type of QUALITY_TYPES) {
      const n = weekDays.filter((d) => d.type === type).length;
      if (n > 0) qualityCounts[type] = n;
    }
    const longestRideMinutes = weekDays.reduce((max, d) => Math.max(max, d.durationMin), 0);
    return { weekNumber: t.weekNumber, isRecovery: t.isRecovery, totalHours: round1(totalMin / 60), qualityCounts, longestRideMinutes };
  });
}

const HOUR_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};

export function checkOverviewAgainstFacts(overview: string, weeks: WeekFacts[]): string[] {
  const warnings = new Set<string>();

  for (const sentence of overview.split(/(?<=[.!?])\s+/)) {
    const references = [...sentence.matchAll(/\bweek\s+(\d+)\b/gi)];
    for (const [index, reference] of references.entries()) {
      const week = weeks.find((candidate) => candidate.weekNumber === Number(reference[1]));
      if (!week) continue;
      const clause = sentence.slice(reference.index, references[index + 1]?.index ?? sentence.length);

      const totalHours = clause.match(/(\d+(?:\.\d+)?)\s*-?\s*hours?\b/i);
      const totalDescribesRide = totalHours && clause.slice((totalHours.index ?? 0) + totalHours[0].length).trimStart().toLowerCase().startsWith("ride");
      if (totalHours && !totalDescribesRide && Math.abs(Number(totalHours[1]) - week.totalHours) >= 1) {
        warnings.add(
          `Overview says ${totalHours[1]}h for week ${week.weekNumber}, but the scheduled total is ${week.totalHours}h.`,
        );
      }

      const ride = clause.match(/\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight)\s*-?\s*hour ride\b/i);
      if (ride) {
        const statedHours = HOUR_WORDS[ride[1].toLowerCase()] ?? Number(ride[1]);
        if (statedHours * 60 - week.longestRideMinutes >= 30) {
          warnings.add(
            `Overview describes a ${statedHours}-hour ride in week ${week.weekNumber}, but the longest scheduled ride is ${week.longestRideMinutes} minutes.`,
          );
        }
      }

      for (const type of QUALITY_TYPES) {
        if (!new RegExp(`\\b${type}\\b`, "i").test(clause) || (week.qualityCounts[type] ?? 0)) continue;
        if (new RegExp(`(?:escalat|progress|increas)[^.!?]*\\b${type}\\b`, "i").test(clause)) {
          warnings.add(
            `Overview claims escalating ${type} work in week ${week.weekNumber}, but no ${type} session is scheduled that week.`,
          );
        } else {
          warnings.add(
            `Overview names "${type}" in week ${week.weekNumber}, but no ${type} session is scheduled that week.`,
          );
        }
      }
    }
  }

  return [...warnings];
}
