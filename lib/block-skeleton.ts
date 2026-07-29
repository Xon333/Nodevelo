// Deterministic per-block skeleton (P2, 2026-07-24 block-generation redesign). The LLM was free-
// forming weekly volume from a min-max range and a fixed absolute recovery band, and it undershot its
// own explicit floor in every non-recovery week of a real reviewed block. This computes ONE exact
// hour figure per week — loading weeks target the top of the configured range (making today's
// aspirational "plan toward the top" prose literal), recovery weeks target a figure DERIVED from that
// loading target (not a fixed absolute band blind to it) — plus a pre-generation feasibility check and
// a post-generation check that the generated hours actually landed near the target.
//
// Pure + deterministic, same contract as workout-validate.ts/schedule-validate.ts: computation and
// prompt-formatting never throw or invent data; the post-generation check only warns, never rewrites.

import type { BlockSettings, PlannedDay, SeasonEvent, SeasonFocus, WorkoutType } from "./types";
import { clamp, round1 } from "./stats";
import { addDaysIso } from "./date";

const DAYS_PER_WEEK = 7;
// Conservative floors for the feasibility check — real quality/easy sessions are rarely shorter than
// these; the point is catching a genuinely impossible combination of settings, not modelling every
// session type precisely (workout-validate.ts already owns per-type protocol bands).
const MIN_QUALITY_SESSION_MIN = 45;
const MIN_EASY_DAY_MIN = 60;

// P2a: verify the configured settings can jointly fit inside a week BEFORE spending an LLM call on an
// impossible ask — the one useful idea from a full constraint solver (rejected as too heavy for a
// solo-maintained app), without the solver. Returns a human-readable conflict, or null if feasible.
export function checkBlockFeasibility(settings: BlockSettings): string | null {
  const { qualitySessionsPerLoadingWeek, longRideDurationMinutes, restDaysPerWeek, weeklyHoursMin, weeklyHoursMax } = settings;

  if (weeklyHoursMin > weeklyHoursMax) {
    return `Settings conflict: weeklyHoursMin (${weeklyHoursMin}h) is greater than weeklyHoursMax (${weeklyHoursMax}h).`;
  }

  // (a) Day-count: quality sessions + the long ride's own day + rest days must fit in a 7-day week —
  // zero days left for easy fill is legal (tight, not broken); a negative count is not.
  const fixedDays = qualitySessionsPerLoadingWeek + 1 /* long ride */ + restDaysPerWeek;
  if (fixedDays > DAYS_PER_WEEK) {
    return `Settings conflict: ${qualitySessionsPerLoadingWeek} quality session(s) + 1 long ride + ${restDaysPerWeek} rest day(s) = ${fixedDays} days — more than a ${DAYS_PER_WEEK}-day week holds. Lower one of these before generating.`;
  }
  const easyDays = DAYS_PER_WEEK - fixedDays;

  // (b) Minimum realistic time: even sized as small as protocol allows, does a loading week fit under
  // the configured ceiling?
  const minMinutes = qualitySessionsPerLoadingWeek * MIN_QUALITY_SESSION_MIN + longRideDurationMinutes + easyDays * MIN_EASY_DAY_MIN;
  const maxAvailableMinutes = weeklyHoursMax * 60;
  if (minMinutes > maxAvailableMinutes) {
    return `Settings conflict: a loading week's minimum realistic content (${qualitySessionsPerLoadingWeek} quality session(s) at ~${MIN_QUALITY_SESSION_MIN}min + a ${longRideDurationMinutes}min long ride + ${easyDays} easy day(s) at ~${MIN_EASY_DAY_MIN}min) is ~${round1(minMinutes / 60)}h — already over the ${weeklyHoursMax}h weekly ceiling. Raise weeklyHoursMax, or lower the quality-session count / long-ride duration.`;
  }

  return null;
}

// ---------- P2b: per-week exact hour targets ----------

export interface WeekTarget {
  weekNumber: number; // 1-indexed
  isRecovery: boolean;
  targetHours: number; // one exact figure — never a range
}

// KB (cycling_database.md: "reduce volume by 30-50%" every 3-4 weeks) means RETAIN 50-70% of loading
// volume. 60% sits mid-band. Derived from the loading target itself, not a fixed absolute figure blind
// to it — the defect found live was a 6-7h fixed band reasonably calibrated against a 10-12h loading
// target retaining only ~72% once loading itself undershot to ~9h40, short of even the lenient end.
const RECOVERY_RETENTION_PCT = 0.6;

// A recovery week's quality-session CEILING (not a target). KB cycling_database.md:225 pairs its
// 30–50% volume cut with "drop intensity slightly"; TrainerRoad's recovery-week guidance drops high
// intensity entirely; Friel/Roadman keep at most one short quality touch early in the week. The
// volume lever (RECOVERY_RETENTION_PCT above) was already enforced; this is the composition lever
// that was missing entirely — the reviewed 2026-07 block kept all three quality types in its
// "recovery" week, just trimmed. Imported by schedule-validate.ts and season.ts.
export const RECOVERY_QUALITY_CAP = 1;

// One exact hour figure per week: loading weeks target the TOP of the configured range (literal, not
// aspirational); recovery weeks (already correctly placed by realWeeksSinceLastRecovery/
// planRecoveryWeeks — see lib/season.ts) target a derived fraction of that loading figure, clamped to
// the configured recovery band as an outer sanity bound rather than the primary source of truth.
export function computeWeekTargets(lengthWeeks: number, settings: BlockSettings, recoveryWeekIndices: number[]): WeekTarget[] {
  const recoverySet = new Set(recoveryWeekIndices);
  const loadingTarget = settings.weeklyHoursMax;
  const derivedRecoveryTarget = clamp(loadingTarget * RECOVERY_RETENTION_PCT, settings.recoveryWeekHoursMin, settings.recoveryWeekHoursMax);
  return Array.from({ length: lengthWeeks }, (_, i) => {
    const isRecovery = recoverySet.has(i);
    return {
      weekNumber: i + 1,
      isRecovery,
      targetHours: round1(isRecovery ? derivedRecoveryTarget : loadingTarget),
    };
  });
}

// Prompt-injectable table — replaces the old range-based "WEEKLY VOLUME (loading weeks)/(recovery
// week)" prose (which the model could satisfy anywhere inside a 2-hour-wide range, and did undershoot
// in every non-recovery week of a real reviewed block) with one falsifiable number per week.
export function formatWeekTargets(targets: WeekTarget[]): string {
  const lines = targets.map(
    (t) =>
      `- Week ${t.weekNumber} (${t.isRecovery ? "RECOVERY" : "LOADING"}): target ${t.targetHours}h total — an exact figure, not a range. Before finalising the week, add up every session's DURATION; if short, LENGTHEN the easy Z2 sessions (their duration, not their count, is the lever) until the total matches.`
  );
  return `WEEK-BY-WEEK HOUR TARGETS (exact — hit each one; landing under is a shortfall, landing over is also wrong):\n${lines.join("\n")}`;
}

// P2b enforcement: the missing half of the fix — nothing today checks whether a generated week's
// actual hours matched anything. Warn-only, same contract as schedule-validate.ts.
const HOUR_TARGET_TOLERANCE_MIN = 30;

export function validateWeekHours(days: PlannedDay[], targets: WeekTarget[]): string[] {
  const totalsByWeek = new Map<number, number>();
  for (const d of days) {
    totalsByWeek.set(d.weekNumber, (totalsByWeek.get(d.weekNumber) ?? 0) + d.durationMin);
  }
  const warnings: string[] = [];
  for (const t of targets) {
    const actualMin = totalsByWeek.get(t.weekNumber) ?? 0;
    const targetMin = t.targetHours * 60;
    const diffMin = actualMin - targetMin;
    if (Math.abs(diffMin) > HOUR_TARGET_TOLERANCE_MIN) {
      const direction = diffMin < 0 ? "under" : "over";
      warnings.push(
        `HOURS: week ${t.weekNumber} (${t.isRecovery ? "recovery" : "loading"}) totals ${round1(actualMin / 60)}h — ${direction} its ${t.targetHours}h target by ${round1(Math.abs(diffMin) / 60)}h.`
      );
    }
  }
  return warnings;
}

// ---------- Phase B: the deterministic week skeleton ----------
// Composition (which type, which day, how long, what intensity ceiling) is computed here and handed
// to the model as a filled table; the model supplies interval prescriptions, exact durations inside
// each envelope, and prose. The 2026-07-29 live run showed why: given one weekly hour figure the
// model must solve the per-day split itself, and undershot every loading week by 0.5-1.1h.

export type SlotKind = "quality" | "longRide" | "easy" | "rest" | "event";

export interface DaySlot {
  date: string;
  kind: SlotKind;
  /** Allowed WorkoutType values. length === 1 ⇒ locked to that type. */
  allowedTypes: WorkoutType[];
  /** nominalMin is the figure that makes the week sum to target; the envelope is the model's leeway. */
  duration: { nominalMin: number; minMin: number; maxMin: number };
  /** %FTP ceiling for ANY work step this day, including steps embedded in an otherwise-easy ride. */
  maxIntensityPct: number | null;
  locked: boolean;
  /** One-line WHY — rendered into the prompt AND quoted back by the conformance validator. */
  reason: string;
}

export interface WeekSkeleton extends WeekTarget {
  qualityBudget: number;
  days: DaySlot[];
}

export interface BlockSkeleton {
  focus: SeasonFocus;
  weeks: WeekSkeleton[];
}

// Nominal session lengths. Easy days absorb the remainder, so these only need to be realistic.
const QUALITY_NOMINAL_MIN = 75;
const QUALITY_RECOVERY_MIN = 45; // "SHORT" — the recovery week's single retained touch
const EASY_MIN_MIN = 45;
const EASY_MAX_MIN = 150;
const DURATION_SLACK_MIN = 15; // envelope half-width around each nominal
const EASY_CEILING_PCT = 75;   // easy days stay genuinely easy
const RECOVERY_LONG_RIDE_CEILING_PCT = 75; // recovery long ride: unbroken Z2, no embedded work
const RECOVERY_QUALITY_CEILING_PCT = 95;   // retained touch sits at the bottom of its band

// Day-of-week placement priorities (index 0 = the week's first day). See D3 in the plan.
const REST_PRIORITY = [0, 3, 6];
const QUALITY_PRIORITY = [1, 3, 4];
const LONG_RIDE_INDEX = 5;

/** The single session type that satisfies a focus, or null when the focus has no required type. */
function focusWorkoutType(focus: SeasonFocus): WorkoutType | null {
  switch (focus) {
    case "threshold": return "Threshold";
    case "vo2max": return "VO2max";
    case "anaerobic": return "SIT";
    default: return null; // aerobic-base, durability, sharpen — no single required type
  }
}

/** Spread `total` across `count` integer slots so they sum EXACTLY to total. */
function spread(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const rem = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rem ? 1 : 0));
}

export function computeBlockSkeleton(
  startDate: string,
  weekTargets: WeekTarget[],
  settings: BlockSettings,
  focus: SeasonFocus,
  events: SeasonEvent[]
): BlockSkeleton {
  const eventByDate = new Map(events.map((e) => [e.date, e]));
  const focusType = focusWorkoutType(focus);

  const weeks = weekTargets.map((t, wi) => {
    const totalMin = Math.round(t.targetHours * 60);
    const restCount = settings.restDaysPerWeek + (t.isRecovery ? 1 : 0);
    // Recovery: at most the shared cap, and zero when the focus has no required type (a durability
    // recovery week can't keep its own quality touch — that type carries embedded work by definition).
    const qualityBudget = t.isRecovery
      ? focusType
        ? Math.min(RECOVERY_QUALITY_CAP, Math.max(0, settings.qualitySessionsPerLoadingWeek - 1))
        : 0
      : settings.qualitySessionsPerLoadingWeek;

    // D1: a recovery week scales its long ride by the same retention fraction as its weekly figure.
    let longRideMin = t.isRecovery
      ? Math.round(settings.longRideDurationMinutes * RECOVERY_RETENTION_PCT)
      : settings.longRideDurationMinutes;
    const qualityMin = t.isRecovery ? QUALITY_RECOVERY_MIN : QUALITY_NOMINAL_MIN;

    const kinds: SlotKind[] = Array.from({ length: 7 }, () => "easy");
    kinds[LONG_RIDE_INDEX] = "longRide";
    let placed = 0;
    for (const i of REST_PRIORITY) {
      if (placed >= restCount) break;
      if (kinds[i] === "easy") { kinds[i] = "rest"; placed++; }
    }
    placed = 0;
    for (const i of QUALITY_PRIORITY) {
      if (placed >= qualityBudget) break;
      if (kinds[i] === "easy") { kinds[i] = "quality"; placed++; }
    }

    const easyIdx = kinds.map((k, i) => (k === "easy" ? i : -1)).filter((i) => i >= 0);
    const easyTotal = totalMin - longRideMin - qualityBudget * qualityMin;
    let easyMins = spread(Math.max(0, easyTotal), easyIdx.length);
    // Keep easy days realistic; the long ride absorbs any residual so the week still sums exactly.
    if (easyIdx.length > 0) {
      const clamped = easyMins.map((m) => clamp(m, EASY_MIN_MIN, EASY_MAX_MIN));
      const delta = easyMins.reduce((a, b) => a + b, 0) - clamped.reduce((a, b) => a + b, 0);
      easyMins = clamped;
      longRideMin += delta;
    } else {
      longRideMin += Math.max(0, easyTotal);
    }

    let easyCursor = 0;
    const days: DaySlot[] = kinds.map((kind, i) => {
      const date = addDaysIso(startDate, wi * 7 + i);
      const ev = eventByDate.get(date);
      if (ev) {
        return {
          date, kind: "event", allowedTypes: ["RaceSim"],
          duration: { nominalMin: 0, minMin: 0, maxMin: 24 * 60 },
          maxIntensityPct: null, locked: true,
          reason: `${ev.name} (priority ${ev.priority}) — the athlete's own event; never overwrite this day`,
        };
      }
      const env = (n: number) => ({
        nominalMin: n,
        minMin: Math.max(0, n - DURATION_SLACK_MIN),
        maxMin: n + DURATION_SLACK_MIN,
      });
      switch (kind) {
        case "rest":
          return {
            date, kind, allowedTypes: ["Rest"], duration: { nominalMin: 0, minMin: 0, maxMin: 0 },
            maxIntensityPct: null, locked: true,
            reason: t.isRecovery ? "recovery week: one extra rest day" : "weekly rest day",
          };
        case "quality":
          return {
            date, kind, allowedTypes: focusType ? [focusType] : ["Threshold", "VO2max", "SIT", "RaceSim"],
            duration: env(qualityMin),
            maxIntensityPct: t.isRecovery ? RECOVERY_QUALITY_CEILING_PCT : null,
            locked: !!focusType,
            reason: t.isRecovery
              ? `the ONE retained quality touch — short, early, at the bottom of its band`
              : `the block's primary quality (focus: ${focus})`,
          };
        case "longRide":
          return {
            date, kind, allowedTypes: ["Z2"], duration: env(longRideMin),
            maxIntensityPct: t.isRecovery ? RECOVERY_LONG_RIDE_CEILING_PCT : null,
            locked: true,
            reason: t.isRecovery
              ? "recovery week: unbroken Z2, no embedded threshold/VO2 efforts whatever the block's durability template says"
              : "the week's long endurance ride",
          };
        default: {
          const m = easyMins[easyCursor++] ?? EASY_MIN_MIN;
          return {
            date, kind: "easy", allowedTypes: ["Z2", "Recovery"], duration: env(m),
            maxIntensityPct: EASY_CEILING_PCT, locked: false,
            reason: "easy Z2 — the week's volume lever",
          };
        }
      }
    });

    return { ...t, qualityBudget, days };
  });

  return { focus, weeks };
}
