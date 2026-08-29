// Deterministic per-block skeleton (P2, 2026-07-24 block-generation redesign). The LLM was free-
// forming weekly volume from a min-max range and a fixed absolute recovery band, and it undershot its
// own explicit floor in every non-recovery week of a real reviewed block. This computes ONE exact
// hour figure per week — loading weeks use the configured target while availability remains a hard
// ceiling; recovery weeks derive from that loading target (not a fixed absolute band blind to it) —
// plus a pre-generation feasibility check and a post-generation check that the hours landed near target.
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
  const { qualitySessionsPerLoadingWeek, longRideDurationMinutes, restDaysPerWeek, targetWeeklyHours, maxAvailableHours } = settings;

  if (targetWeeklyHours > maxAvailableHours) {
    return `Settings conflict: target weekly hours (${targetWeeklyHours}h) exceed available time (${maxAvailableHours}h).`;
  }
  if (settings.recoveryWeekHoursMin > maxAvailableHours) {
    return `Settings conflict: recovery-week minimum (${settings.recoveryWeekHoursMin}h) exceeds available time (${maxAvailableHours}h).`;
  }

  // (a) Day-count: quality sessions + the long ride's own day + rest days must fit in a 7-day week —
  // zero days left for easy fill is legal (tight, not broken); a negative count is not.
  const fixedDays = qualitySessionsPerLoadingWeek + 1 /* long ride */ + restDaysPerWeek;
  if (fixedDays > DAYS_PER_WEEK) {
    return `Settings conflict: ${qualitySessionsPerLoadingWeek} quality session(s) + 1 long ride + ${restDaysPerWeek} rest day(s) = ${fixedDays} days — more than a ${DAYS_PER_WEEK}-day week holds. Lower one of these before generating.`;
  }
  const easyDays = DAYS_PER_WEEK - fixedDays;

  // (b) Minimum realistic time: even sized as small as protocol allows, does a loading week fit its
  // configured target? Availability may leave headroom, but the skeleton still has to hit the target.
  const minMinutes = qualitySessionsPerLoadingWeek * MIN_QUALITY_SESSION_MIN + longRideDurationMinutes + easyDays * MIN_EASY_DAY_MIN;
  const targetMinutes = targetWeeklyHours * 60;
  if (minMinutes > targetMinutes) {
    return `Settings conflict: a loading week's minimum realistic content (${qualitySessionsPerLoadingWeek} quality session(s) at ~${MIN_QUALITY_SESSION_MIN}min + a ${longRideDurationMinutes}min long ride + ${easyDays} easy day(s) at ~${MIN_EASY_DAY_MIN}min) is ~${round1(minMinutes / 60)}h — already over the ${targetWeeklyHours}h weekly target. Raise target weekly hours, or lower the quality-session count / long-ride duration.`;
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

// One exact hour figure per week: loading weeks use the configured target; recovery weeks (already
// correctly placed by realWeeksSinceLastRecovery/
// planRecoveryWeeks — see lib/season.ts) target a derived fraction of that loading figure, clamped to
// the configured recovery band as an outer sanity bound rather than the primary source of truth.
export function computeWeekTargets(lengthWeeks: number, settings: BlockSettings, recoveryWeekIndices: number[]): WeekTarget[] {
  const recoverySet = new Set(recoveryWeekIndices);
  const loadingTarget = settings.targetWeeklyHours;
  const recoveryBandTarget = clamp(
    loadingTarget * RECOVERY_RETENTION_PCT,
    settings.recoveryWeekHoursMin,
    settings.recoveryWeekHoursMax
  );
  const derivedRecoveryTarget = Math.min(recoveryBandTarget, settings.maxAvailableHours);
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
// A quality session's natural length is a property of its TYPE, not a constant. The first Phase B
// live runs flagged the Tuesday SIT slot at 55 min against a flat 60–90 range in every single week —
// and the generated session was correct: 17 min warmup + 5 x (30s effort + 4 min recovery) + 15 min
// cooldown is ~55 min, and a 5x30s protocol cannot fill 75 minutes without artificial padding. The
// slot was mis-sized, not the workout. These figures are the realistic step-sum of each protocol as
// the knowledge base prescribes it; easy days absorb the difference so the week still sums to target.
const QUALITY_NOMINAL_BY_TYPE: Record<string, number> = {
  SIT: 55, // short maximal efforts, long recoveries — inherently the shortest quality session
  VO2max: 75,
  Threshold: 80,
  RaceSim: 100, // variable race-effort work, deliberately the longest
};
const QUALITY_NOMINAL_FALLBACK_MIN = 75; // a flexible slot whose type the model still gets to choose
const QUALITY_RECOVERY_MIN = 45; // "SHORT" — the recovery week's single retained touch

/** The natural step-sum of one quality session of this type. */
function qualityNominalFor(type: WorkoutType | null): number {
  return (type && QUALITY_NOMINAL_BY_TYPE[type]) || QUALITY_NOMINAL_FALLBACK_MIN;
}
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

// Phase B task 1 (2026-07-29 review): the original version drove minute arithmetic off the
// *budgeted* rest/quality counts and zeroed event days outright, which broke the one guarantee this
// function exists for (day durations sum exactly to the week's target) in four reachable cases —
// see the four numbered steps below. The restructured order is: (1) place slot KINDS, (2) allocate
// minutes from the counts actually PLACED, (3) apply event overrides at render time using the
// minutes their displaced slot would have drawn, never zero. Two invariants hold unconditionally for
// every slot this function returns: 0 <= minMin <= nominalMin <= maxMin, and a week's nominalMin
// values sum exactly to Math.round(targetHours * 60). See block-skeleton.test.ts's "invariant sweep".
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
    // Per-slot, because natural session length is type-dependent. Slot 0 of a loading week is locked
    // to the block's focus type, so we know exactly what it will be; later slots stay flexible across
    // all four quality types, so they take the middle figure and a wider envelope (below). A recovery
    // week's single retained touch is deliberately short whatever its type.
    const qualityNominalAt = (slotIndex: number) =>
      t.isRecovery ? QUALITY_RECOVERY_MIN : slotIndex === 0 ? qualityNominalFor(focusType) : QUALITY_NOMINAL_FALLBACK_MIN;

    // ---- Step 1: place slot KINDS (rest / quality / long ride / easy). Event overrides are applied
    // later, at render time — placement always reflects the week's underlying shape first. ----
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

    // ---- Step 2: allocate minutes from the counts ACTUALLY placed above (C2 fix) — qualityBudget
    // can exceed what fits once the rest/quality priority lists collide on the same index (e.g.
    // restDaysPerWeek: 2, qualitySessionsPerLoadingWeek: 3 both want index 3 — REST_PRIORITY runs
    // first and wins it). Driving the arithmetic off the budget instead of the placed count silently
    // shorted the week by exactly the unplaced session(s); using the real count fixes it structurally,
    // for any future priority-list shape too, not just this one collision. ----
    const qCount = kinds.filter((k) => k === "quality").length;
    const easyCount = kinds.filter((k) => k === "easy").length;

    let qualityMins: number[] = Array.from({ length: qCount }, (_, i) => qualityNominalAt(i));
    const qualityNominalTotal = qualityMins.reduce((a, b) => a + b, 0);
    let easyTotal = totalMin - (longRideMin + qualityNominalTotal);

    // ---- I3 fix: the fixed content (long ride + quality) can legitimately exceed the week's target
    // on its own — e.g. a tiny targetWeeklyHours paired with a long-ride duration that alone eats the
    // whole week. Shrink the fixed slots down to fit exactly — long ride first (it's already this
    // function's designated "absorb the residual" lever below), then quality if the long ride alone
    // can't cover it — instead of silently discarding the overshoot via Math.max(0, ...). Floor at 0
    // either way (I4): no slot is ever pushed negative to make room. ----
    if (easyTotal < 0) {
      let shortfall = -easyTotal;
      const rideReduction = Math.min(longRideMin, shortfall);
      longRideMin -= rideReduction;
      shortfall -= rideReduction;
      if (shortfall > 0 && qCount > 0) {
        const shrunkQualityTotal = Math.max(0, qualityNominalTotal - shortfall);
        qualityMins = spread(shrunkQualityTotal, qCount);
      }
      easyTotal = 0;
    }

    // Easy days absorb whatever's left; clamp them to a realistic band and dump the compensating
    // delta on the long ride — UNLESS doing so would push the long ride below zero (I4), in which
    // case skip the cosmetic clamp and keep the raw, unclamped split: it still sums exactly and never
    // goes negative, which is the only thing this function actually promises. A combination extreme
    // enough to hit this branch (e.g. longRideDurationMinutes: 10 with targetWeeklyHours: 2) has already
    // given up on "realistic day shapes" the moment Step 2 had to shrink the long ride to 0 above.
    let easyMins: number[];
    if (easyCount > 0) {
      easyMins = spread(easyTotal, easyCount);
      const clampedEasy = easyMins.map((m) => clamp(m, EASY_MIN_MIN, EASY_MAX_MIN));
      const delta = easyMins.reduce((a, b) => a + b, 0) - clampedEasy.reduce((a, b) => a + b, 0);
      if (longRideMin + delta >= 0) {
        easyMins = clampedEasy;
        longRideMin += delta;
      }
    } else {
      easyMins = [];
      longRideMin += easyTotal;
    }

    // ---- Step 3: render the seven days, applying event overrides last. A day's underlying bucket
    // (its pre-event kind) still determines the minutes it draws — an event never zeroes a day's
    // contribution (C1 fix); it just relabels the slot. `qualityMoneyCursor`/`easyCursor` advance for
    // every day in that bucket regardless of an event landing on it, so the money always lands
    // somewhere; `renderedQualityCount` advances only for days actually RENDERED as "quality" (event
    // days excluded), which is what decides the focus-type lock — so if an event displaces the
    // week's first quality day, the lock correctly falls to the next real quality day instead of
    // vanishing, preserving the >=1-focus-type-session-per-loading-week guarantee this shape exists
    // to structurally provide (see the "quality" case below). ----
    let qualityMoneyCursor = 0;
    let renderedQualityCount = 0;
    let easyCursor = 0;
    const days: DaySlot[] = kinds.map((kind, i) => {
      const date = addDaysIso(startDate, wi * 7 + i);
      const ev = eventByDate.get(date);

      // The minutes this day's bucket draws, independent of whether an event later displaces it.
      const nominal =
        kind === "rest" ? 0 :
        kind === "quality" ? qualityMins[qualityMoneyCursor++] :
        kind === "longRide" ? longRideMin :
        (easyMins[easyCursor++] ?? EASY_MIN_MIN);

      if (ev) {
        // C1 fix: carry the duration of whatever slot this event displaced — that's the time the
        // athlete was going to spend riding this day anyway — instead of zeroing it, so the week's
        // total still sums to target. (On a day that would have been "rest", that figure is
        // legitimately 0 — a rest day carries no riding time by design either way — so an event
        // landing there still sums correctly even though it contributes nothing itself.) maxMin
        // stays a generous all-day ceiling — a race can run long — regardless of the displaced
        // slot's own envelope width.
        return {
          date, kind: "event", allowedTypes: ["RaceSim"],
          duration: {
            nominalMin: nominal,
            minMin: Math.max(0, nominal - DURATION_SLACK_MIN),
            maxMin: Math.max(nominal + DURATION_SLACK_MIN, 24 * 60),
          },
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
        case "quality": {
          // Only the FIRST quality slot in a loading week is the block's primary focus session —
          // that's what structurally guarantees validatePrimaryQualityCadence's >=1-per-loading-week
          // floor (lib/season.ts). Locking every quality slot to the focus type over-constrains the
          // week: it leaves no room for formatFocusCoverageLine's own "RaceSim fills a slot when it
          // doesn't crowd out the primary" allowance, and makes deriveSessionRequirements'/
          // validateSessionRequirements' block-wide >=1-RaceSim floor (lib/session-requirements.ts)
          // unsatisfiable whenever every slot in every week is pinned to the focus type. A recovery
          // week is untouched — it carries at most one quality slot, always the primary.
          const isFirstQualitySlot = renderedQualityCount === 0;
          renderedQualityCount++;
          const flexibleSlot = !t.isRecovery && !isFirstQualitySlot;
          // A flexible slot's envelope must span the natural length of EVERY type it allows, or it
          // flags a correct session for being the wrong shape: a legitimate SIT (~55 min) and a
          // legitimate RaceSim (~100 min) both satisfy this slot, and +/-DURATION_SLACK_MIN around a
          // single middle figure would reject both. A locked slot knows its one type, so it keeps the
          // normal narrow envelope.
          const flexNominals = (["Threshold", "VO2max", "SIT", "RaceSim"] as const).map(qualityNominalFor);
          const duration = flexibleSlot
            ? {
                nominalMin: nominal,
                minMin: Math.max(0, Math.min(...flexNominals) - DURATION_SLACK_MIN),
                maxMin: Math.max(...flexNominals) + DURATION_SLACK_MIN,
              }
            : env(nominal);
          return {
            date, kind,
            allowedTypes: flexibleSlot ? ["Threshold", "VO2max", "SIT", "RaceSim"] : focusType ? [focusType] : ["Threshold", "VO2max", "SIT", "RaceSim"],
            duration,
            maxIntensityPct: t.isRecovery ? RECOVERY_QUALITY_CEILING_PCT : null,
            locked: flexibleSlot ? false : !!focusType,
            reason: t.isRecovery
              ? `the ONE retained quality touch — short, early, at the bottom of its band`
              : flexibleSlot
                ? `complementary quality slot — flexible across Threshold/VO2max/SIT/RaceSim; may be RaceSim when the block goal calls for it, since the week's primary focus session already covers the required coverage`
                : `the block's primary quality (focus: ${focus})`,
          };
        }
        case "longRide":
          return {
            date, kind, allowedTypes: ["Z2"], duration: env(nominal),
            maxIntensityPct: t.isRecovery ? RECOVERY_LONG_RIDE_CEILING_PCT : null,
            locked: true,
            reason: t.isRecovery
              ? "recovery week: unbroken Z2, no embedded threshold/VO2 efforts whatever the block's durability template says"
              : "the week's long endurance ride",
          };
        default: // "easy"
          return {
            date, kind: "easy", allowedTypes: ["Z2", "Recovery"], duration: env(nominal),
            maxIntensityPct: EASY_CEILING_PCT, locked: false,
            reason: "easy Z2 — the week's volume lever",
          };
      }
    });

    return { ...t, qualityBudget, days };
  });

  return { focus, weeks };
}

// ---------- Phase B task 2: render the skeleton for the prompt ----------
// Consumed by Task 4 in place of formatWeekTargets' single weekly figure — a filled per-day table
// means the model picks a duration inside each stated envelope instead of solving a 7-day allocation
// problem itself (the live run this whole redesign responds to undershot every loading week by
// 0.5-1.1h doing exactly that). Pure string formatting only: no IO, no randomness, same input -> same
// output, and it introduces no output mutation (ADR-0004's warn-only contract is unaffected — this
// function only ever reads a BlockSkeleton, it never rewrites planned days).

const ALL_QUALITY: WorkoutType[] = ["Threshold", "VO2max", "SIT", "RaceSim"];

function slotTypeLabel(d: DaySlot): string {
  return d.allowedTypes.length === 1 ? d.allowedTypes[0] : d.allowedTypes.join(" or ");
}

function slotDurationLabel(d: DaySlot): string {
  if (d.kind === "rest") return "0";
  // An event day carries a real, non-zero nominal duration (Task 1's C1 fix) that already counts
  // toward the week's total below — show that figure instead of hiding it behind prose, so the model
  // can still check this row against the footer sum; the caveat explains why it may not land exactly.
  if (d.kind === "event") {
    return `${d.duration.nominalMin} min planned (actual length is whatever the event demands — do not shorten or pad it to force a fit)`;
  }
  return `${d.duration.nominalMin} min (${d.duration.minMin}–${d.duration.maxMin} ok)`;
}

// Replaces formatWeekTargets' single weekly figure. Rendering the whole week as a filled table means
// the model picks a number inside each envelope instead of solving a 7-day allocation problem.
export function formatBlockSkeleton(skeleton: BlockSkeleton): string {
  const blocks = skeleton.weeks.map((w) => {
    const total = w.days.reduce((t, d) => t + d.duration.nominalMin, 0);
    const rows = w.days.map((d) => {
      const ceiling = d.maxIntensityPct === null ? "—" : `≤${d.maxIntensityPct}% FTP`;
      return `| ${d.date} | ${d.kind} | ${slotTypeLabel(d)} | ${slotDurationLabel(d)} | ${ceiling} | ${d.reason} |`;
    });
    // Derived from the skeleton itself, not hardcoded: a quality type counts as "kept" only if some
    // day this week actually allows it. A hardcoded enumeration was the real defect this task calls
    // out — it once named the surviving type as dropped and omitted a type that was genuinely absent.
    const dropped = w.isRecovery ? ALL_QUALITY.filter((qt) => !w.days.some((d) => d.allowedTypes.includes(qt))) : [];
    const notThisWeek = dropped.length > 0 ? `\nNOT this week: ${dropped.join(", ")} — dropped entirely, not shortened.` : "";
    return [
      `WEEK ${w.weekNumber} — ${w.isRecovery ? "RECOVERY" : "LOADING"} · target ${w.targetHours}h.`,
      `| Date | Slot | Type | Duration | Ceiling | Why |`,
      `|---|---|---|---|---|---|`,
      ...rows,
      `These nominal durations already sum to ${total} min — the week's target. Prefer the nominal figure. If you deviate inside a range, COMPENSATE on another day in the same week so the week still totals ${total} min; the ranges are per-day leeway, not a licence to land the week short.${notThisWeek}`,
    ].join("\n");
  });

  return [
    `WEEK SKELETON (FIXED — fill each slot, do NOT add, drop, move, merge or retype any day).`,
    `Each row is one calendar day. Never place any effort above a row's intensity ceiling, including efforts embedded inside an otherwise-easy ride.`,
    `DURATION IS MEASURED FROM YOUR WORKOUT STEPS, NOT FROM THE NUMBER YOU WRITE. The app recomputes each day's duration by summing that day's warmup + main + cooldown steps and overwrites your stated figure with the result. So a session only fills its slot if its STEPS add up to a figure inside the slot's range — writing "75 min" above steps that total 53 will be recorded as 53 and will miss the slot. Add up your steps for every day before finalising it.`,
    ...blocks,
  ].join("\n\n");
}
