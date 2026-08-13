// Phase 3a §8: classifies whether a calendar week's training load should count toward the envelope
// anchor. New logic — computeFatigueAlert/computeLoadRamp/compromised are real signals but none of them
// classify an ARBITRARY historical week on their own (verified during design, 2026-08-12): the first is
// a live snapshot check, the second only compares the trailing two 7-day windows anchored to `today`.
import { addDaysIso } from "./date";
import { computeReadiness } from "./readiness";
import type { ActivitySummary, RideScoreEntry, WeeklyEnvelope, WellnessEntry } from "./types";

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

// ---------------------------------------------------------------------------
// resolveWeeklyEnvelope — anchor, role, range, Monday recompute vs. every-sync reduction
// ---------------------------------------------------------------------------

export const WEEKLY_ENVELOPE_CALCULATION_VERSION = 1;
const RANGE_BAND_PCT = 0.075; // ±7.5%, within design §8.2's "roughly ±7-8%"
const RECENT_WEEKS_FOR_ANCHOR = 8;

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function weekBounds(mondayIso: string): { start: string; end: string } {
  const start = new Date(`${mondayIso}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: mondayIso, end: end.toISOString().slice(0, 10) };
}

// Canonical load is ActivitySummary.trainingLoad (design §8.1, verbatim: "Use Intervals.icu's synced
// activity trainingLoad as the canonical completed-ride load"), NOT RideScoreEntry.tss — a different
// field on a different type, the ledger's own scoring-time value (external review, 2026-08-12).
function weekLoad(activities: ActivitySummary[], start: string, end: string): number {
  return activities
    .filter((a) => a.date >= start && a.date <= end && a.trainingLoad !== null)
    .reduce((sum, a) => sum + (a.trainingLoad as number), 0);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Returns the median load AND the ordered tolerance sequence (newest week first) — resolveRole reads
// the same sequence rather than re-classifying, so the two functions can never disagree about which
// weeks were tolerated. Load comes from `activities` (canonical trainingLoad); tolerance classification
// comes from `entries` (the compromised flag) + `wellness` (post-week recovery read).
function resolveAnchor(
  activities: ActivitySummary[],
  entries: RideScoreEntry[],
  wellness: WellnessEntry[],
  currentMonday: string
): { median: number; recentTolerance: WeekTolerance[] } {
  const loads: number[] = [];
  const recentTolerance: WeekTolerance[] = [];
  let cursor = currentMonday;
  for (let i = 0; i < RECENT_WEEKS_FOR_ANCHOR; i++) {
    cursor = addDaysIso(cursor, -7);
    const { start, end } = weekBounds(cursor);
    const tolerance = classifyWeekTolerance({ weekStart: start, weekEnd: end, entries, wellness });
    recentTolerance.push(tolerance);
    if (tolerance === "tolerated") loads.push(weekLoad(activities, start, end));
  }
  return { median: median(loads), recentTolerance };
}

// Concrete v1 rule (design §8.2 explicitly defers exact thresholds to implementation): count only the
// CLASSIFIABLE weeks (unknown excluded from the vote, same "never guess" discipline as the anchor
// itself) among the most recent 3. Two or more not-tolerated → recovery. Zero not-tolerated among at
// least 2 classifiable recent weeks → build. Everything else (including "too few classifiable weeks to
// have a real read") → maintain, the conservative default — never guesses toward "push harder".
function resolveRole(recentTolerance: WeekTolerance[]): "build" | "maintain" | "recovery" {
  const recentThree = recentTolerance.slice(0, 3).filter((t) => t !== "unknown");
  const notTolerated = recentThree.filter((t) => t === "not-tolerated").length;
  if (notTolerated >= 2) return "recovery";
  if (recentThree.length >= 2 && notTolerated === 0) return "build";
  return "maintain";
}

function roleAdjustedCentre(anchorMedian: number, role: "build" | "maintain" | "recovery"): number {
  if (role === "build") return anchorMedian * 1.08;
  if (role === "recovery") return anchorMedian * 0.75;
  return anchorMedian;
}

function roundedRange(centre: number): { min: number; max: number } {
  const step = 10; // realistic ride-sized TSS increment (design §8.2: "false precision" to avoid)
  const min = Math.round((centre * (1 - RANGE_BAND_PCT)) / step) * step;
  const max = Math.round((centre * (1 + RANGE_BAND_PCT)) / step) * step;
  return { min, max };
}

export function resolveWeeklyEnvelope(input: {
  today: string;
  persisted: WeeklyEnvelope | null;
  activities: ActivitySummary[];
  entries: RideScoreEntry[];
  wellness: WellnessEntry[];
}): { envelope: WeeklyEnvelope; wrote: boolean } {
  const { today, persisted, activities, entries, wellness } = input;
  const currentMonday = mondayOf(today);

  if (!persisted || persisted.weekStart !== currentMonday) {
    // Path A: Monday full recompute (also fires the FIRST time this ever runs, whatever weekday that
    // is — there is no persisted week to compare against yet).
    const anchor = resolveAnchor(activities, entries, wellness, currentMonday);
    const role = resolveRole(anchor.recentTolerance);
    const centre = roleAdjustedCentre(anchor.median, role);
    const envelope: WeeklyEnvelope = {
      weekStart: currentMonday,
      role,
      range: roundedRange(centre),
      previousRange: null,
      reductionApplied: false,
      reductionReason: null,
      calculationVersion: WEEKLY_ENVELOPE_CALCULATION_VERSION,
      resolvedAt: new Date().toISOString(),
    };
    return { envelope, wrote: true };
  }

  // Path B: every sync (including Monday's, after path A already ran this week), reduction-only safety
  // check against the CURRENTLY PERSISTED range — never raises it.
  const freshAnchor = resolveAnchor(activities, entries, wellness, currentMonday);
  // Bug found in Task 2's own test run: with zero classifiable weeks, median([])===0 read as "evidence"
  // of a lower range and reduced an existing envelope to 0-0. No classifiable data is "nothing to say
  // yet," not "reduce to zero" — only a fresh calc backed by at least one real tolerated week counts.
  const hasRealEvidence = freshAnchor.recentTolerance.includes("tolerated");
  if (!hasRealEvidence) return { envelope: persisted, wrote: false };
  const freshCentre = roleAdjustedCentre(freshAnchor.median, persisted.role);
  const freshRange = roundedRange(freshCentre);
  const impliesLower = freshRange.max < persisted.range.max || freshRange.min < persisted.range.min;
  if (!impliesLower) return { envelope: persisted, wrote: false };

  const envelope: WeeklyEnvelope = {
    ...persisted,
    range: {
      min: Math.min(freshRange.min, persisted.range.min),
      max: Math.min(freshRange.max, persisted.range.max),
    },
    previousRange: persisted.range,
    reductionApplied: true,
    reductionReason: "new fatigue/wellness evidence implied a lower range mid-week",
    resolvedAt: new Date().toISOString(),
  };
  return { envelope, wrote: true };
}
