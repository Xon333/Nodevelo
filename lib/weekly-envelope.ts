// Phase 3a §8: classifies whether a calendar week's training load should count toward the envelope
// anchor. New logic — computeFatigueAlert/computeLoadRamp/compromised are real signals but none of them
// classify an ARBITRARY historical week on their own (verified during design, 2026-08-12): the first is
// a live snapshot check, the second only compares the trailing two 7-day windows anchored to `today`.
import { addDaysIso } from "./date";
import { computeReadiness } from "./readiness";
import type { RideScoreEntry, WellnessEntry } from "./types";

export type WeekTolerance = "tolerated" | "not-tolerated" | "unknown";

const MIN_RIDES_TO_CLASSIFY = 2; // fewer synced rides than this and the week's own load is unreadable
const POST_WEEK_WINDOW_DAYS = 3; // days after weekEnd checked for a deep-fatigue recovery read

export function classifyWeekTolerance(input: {
  weekStart: string;
  weekEnd: string;
  entries: RideScoreEntry[];
  wellness: WellnessEntry[];
}): WeekTolerance {
  const { weekStart, weekEnd, entries, wellness } = input;
  const weekEntries = entries.filter((e) => e.date >= weekStart && e.date <= weekEnd && !e.legacy);
  if (weekEntries.length < MIN_RIDES_TO_CLASSIFY) return "unknown";

  if (weekEntries.some((e) => e.compromised)) return "not-tolerated";

  // Post-week recovery read: TSB = ctl - atl per day, evaluated via the same public, already-calibrated
  // computeReadiness seam readiness.ts's own live checks use — never the module-private
  // isDeepFatigueTsb/heavyAtlCtl helpers directly (not exported).
  const postWeek = wellness.filter((w) => w.date > weekEnd && w.date <= addDaysIso(weekEnd, POST_WEEK_WINDOW_DAYS));
  const withFitness = postWeek.filter((w) => w.ctl !== null && w.atl !== null);
  if (withFitness.length === 0) return "unknown";

  const anyDeepFatigue = withFitness.some((w) => {
    const ctl = w.ctl as number;
    const atl = w.atl as number;
    return computeReadiness({ ctl, atl, tsb: ctl - atl }, []).level === "Recover";
  });
  return anyDeepFatigue ? "not-tolerated" : "tolerated";
}
