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

import type { BlockSettings, PlannedDay, SeasonEvent, WorkoutType } from "./types";
import { carriesEmbeddedIntensity } from "./prescription";
import { resolveDurabilityInsertEnvelope } from "./calibration";
import { RECOVERY_QUALITY_CAP, type WeekTarget } from "./block-skeleton";

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
// complements the budgeted quality work, it doesn't count against it.) `embeddedHardPct` is the
// athlete's resolved durability-envelope floor (CAL-3) — the same value validatePlanProtocol uses, so
// the two validators agree on what counts as an embedded hard effort.
function isHardDay(day: PlannedDay, ftp: number, embeddedHardPct: number): boolean {
  return isQuality(day) || carriesEmbeddedIntensity(day.workoutText, ftp, embeddedHardPct);
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
export function validateSchedule(
  days: PlannedDay[],
  settings: BlockSettings,
  ftp: number,
  weekTargets: WeekTarget[] = [],
  events: SeasonEvent[] = []
): string[] {
  if (days.length === 0) return [];
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const warnings: string[] = [];
  // The embedded-hard floor, per-athlete: resolve the durability envelope once and reuse it for every
  // adjacency check, so spacing agrees with validatePlanProtocol on what counts as an embedded effort.
  const embeddedHardPct = resolveDurabilityInsertEnvelope(settings.durabilityInsertEnvelope).embeddedHardPct;

  // (a) Back-to-back hard days: a hard session (quality type, or an endurance ride carrying embedded
  // threshold/VO2 work) on two consecutive calendar dates. Checked by date adjacency (not array
  // position) so a gap never false-pairs. Spans week boundaries naturally (a Sat→Sun across the split).
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (isHardDay(prev, ftp, embeddedHardPct) && isHardDay(cur, ftp, embeddedHardPct) && daysBetween(prev.date, cur.date) === 1) {
      warnings.push(
        `SCHEDULE: back-to-back hard days — ${hardLabel(prev)} on ${prev.date} then ${hardLabel(cur)} on ${cur.date}. Put an easy or rest day between hard sessions.`
      );
    }
  }

  // (b) Weekly quality budget, per week. EC-11: this used to apply the flat loading-week budget to
  // EVERY week, with a comment asserting "a recovery week naturally sits under the budget, so only
  // over-prescribed weeks fire" — the assumption the 2026-07 reviewed block falsified by keeping a
  // full loading-week quality skeleton in its recovery week. Event days are excluded so this agrees
  // with validateEventTaper rather than double-counting a protected race against the budget.
  const recoveryWeeks = new Set(weekTargets.filter((t) => t.isRecovery).map((t) => t.weekNumber));
  const eventDates = new Set(events.map((e) => e.date));
  const byWeek = new Map<number, PlannedDay[]>();
  for (const d of sorted) {
    const list = byWeek.get(d.weekNumber);
    if (list) list.push(d);
    else byWeek.set(d.weekNumber, [d]);
  }
  for (const [week, weekDays] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    const budget = recoveryWeeks.has(week) ? RECOVERY_QUALITY_CAP : settings.qualitySessionsPerLoadingWeek;
    const quality = weekDays.filter((d) => isQuality(d) && !eventDates.has(d.date));
    if (quality.length > budget) {
      const label = recoveryWeeks.has(week) ? "recovery" : "loading";
      warnings.push(
        `SCHEDULE: week ${week} has ${quality.length} quality sessions (${quality
          .map((d) => d.type)
          .join(", ")}) — over the ${budget}/week budget for a ${label} week.`
      );
    }
  }

  return warnings;
}

// P4 (2026-07-24 block-generation redesign): a lightweight taper tier for priority-B/C events, short
// of full A-tier backward scheduling (`backwardScheduleFromEvent`, which only fires for priority-A —
// see lib/season.ts). B/C events otherwise get only `formatUpcomingEventsForBlock`'s one-line "protect
// this day" prompt callout, with zero deterministic load-shaping — which is how a real priority-B KOM
// attempt ended up with the block's single most quality-dense week landing immediately before it (live
// review, 2026-07-24). Same warn-only contract as validateSchedule above: never reorders the plan.
const QUALITY_FREE_DAYS_BEFORE_EVENT = 2;
const EVENT_WEEK_QUALITY_CAP = 1;

export function validateEventTaper(
  days: PlannedDay[],
  events: SeasonEvent[],
  ftp: number,
  settings: BlockSettings
): string[] {
  if (days.length === 0 || events.length === 0) return [];
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((d) => [d.date, d]));
  const warnings: string[] = [];
  // Same resolved floor validateSchedule uses, so the two agree on what counts as embedded.
  const embeddedHardPct = resolveDurabilityInsertEnvelope(settings.durabilityInsertEnvelope).embeddedHardPct;
  // EC-1: every event's own day is protected training, not a taper breach. A second race in the same
  // week must never read as "a quality session N days before" the first, in either direction.
  const eventDates = new Set(events.map((e) => e.date));

  for (const event of events.filter((e) => e.priority !== "A").sort((a, b) => a.date.localeCompare(b.date))) {
    const eventDay = byDate.get(event.date);
    if (!eventDay) continue; // the event falls outside this block's own generated days

    // (a) the final QUALITY_FREE_DAYS_BEFORE_EVENT calendar days before the event must carry no hard
    // work. A7: isHardDay, not isQuality — an endurance ride with embedded threshold/VO2 efforts is
    // exactly what a taper must exclude, and the narrow type-only check missed it (live-confirmed).
    for (const d of sorted) {
      if (eventDates.has(d.date)) continue; // another event's own day — not a training breach
      const gap = daysBetween(d.date, event.date);
      if (gap >= 1 && gap <= QUALITY_FREE_DAYS_BEFORE_EVENT && isHardDay(d, ftp, embeddedHardPct)) {
        warnings.push(
          `EVENT TAPER: ${event.name} (priority ${event.priority}) on ${event.date} has a hard session (${hardLabel(d)}) ${gap} day${gap > 1 ? "s" : ""} before it — keep the final ${QUALITY_FREE_DAYS_BEFORE_EVENT} days free of hard work so the taper actually protects the event.`
        );
      }
    }

    // (b) the event's own week shouldn't carry more quality work than the cap, beyond the event
    // session itself (a RaceSim/priority effort ON the event day is the point, not a budget breach).
    // EC-1: exclude EVERY event day, not just this one — two legitimate same-week races previously
    // counted against each other.
    const otherQuality = sorted.filter(
      (d) => d.weekNumber === eventDay.weekNumber && !eventDates.has(d.date) && isQuality(d)
    );
    if (otherQuality.length > EVENT_WEEK_QUALITY_CAP) {
      warnings.push(
        `EVENT TAPER: ${event.name} (priority ${event.priority}) week carries ${otherQuality.length} other quality session(s) besides the event itself — cap it at ${EVENT_WEEK_QUALITY_CAP} to protect the taper.`
      );
    }
  }

  return warnings;
}

// P5b (2026-07-24 block-generation redesign): within-week temporal sequencing. Applied-sports-science
// consensus: freshness-dependent quality (VO2max/SIT — the stimulus needs genuinely fresh legs) should
// land earlier in the week than fatigue-tolerant quality (Threshold — explicitly trainable "on some
// fatigue" per the consensus; RaceSim by the KB's own design, which deliberately puts its hardest move
// on already-tired legs). Every live smoke test so far has this backwards — Threshold on Tuesday (the
// week's freshest day), SIT/RaceSim on Thursday — because nothing has ever told the model otherwise.
// Standalone quality-typed days only: a durability template's tired-legs embedded efforts (Saturday's
// long ride) are deliberately fatigue-seeking by KB design, a different thing entirely, and untouched
// by this check.
const FRESHNESS_PRIORITY_TYPES = new Set<WorkoutType>(["VO2max", "SIT"]);
const FATIGUE_TOLERANT_TYPES = new Set<WorkoutType>(["Threshold", "RaceSim"]);

export function validateWeekSequencing(days: PlannedDay[]): string[] {
  const byWeek = new Map<number, PlannedDay[]>();
  for (const d of days) {
    const list = byWeek.get(d.weekNumber);
    if (list) list.push(d);
    else byWeek.set(d.weekNumber, [d]);
  }
  const warnings: string[] = [];
  for (const [week, weekDays] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    const fresh = weekDays.filter((d) => FRESHNESS_PRIORITY_TYPES.has(d.type)).sort((a, b) => a.date.localeCompare(b.date));
    const tolerant = weekDays.filter((d) => FATIGUE_TOLERANT_TYPES.has(d.type)).sort((a, b) => a.date.localeCompare(b.date));
    if (fresh.length === 0 || tolerant.length === 0) continue;
    const earliestFresh = fresh[0];
    const earliestTolerant = tolerant[0];
    if (earliestTolerant.date < earliestFresh.date) {
      warnings.push(
        `SEQUENCING: week ${week} — ${earliestTolerant.type} on ${earliestTolerant.date} lands before ${earliestFresh.type} on ${earliestFresh.date}. Place freshness-dependent quality (VO2max/SIT) earlier in the week than fatigue-tolerant quality (Threshold/RaceSim) — the stimulus depends on fresh legs.`
      );
    }
  }
  return warnings;
}

// The composition half of the recovery-week contract. RECOVERY_RETENTION_PCT (block-skeleton.ts)
// already enforced the VOLUME cut and validateWeekHours already checked it; nothing checked what the
// week was made OF. The 2026-07 reviewed block cut volume ~19% against a mandated ~40% AND kept all
// three quality types (SIT, Threshold, and a long ride with embedded threshold efforts) — just
// trimmed. A recovery week drops quality types entirely; it does not shrink every one slightly.
//
// Counts BOTH standalone quality days and endurance days hiding a real dose of threshold/VO2 work —
// the latter is the evasion route a count-only check can't see. EC-2: a B/C-priority event inside a
// recovery week IS that week's one retained intensity touch, so its day never counts here.
export function validateRecoveryWeekDensity(
  days: PlannedDay[],
  weekTargets: WeekTarget[],
  settings: BlockSettings,
  ftp: number,
  events: SeasonEvent[] = []
): string[] {
  const recoveryWeeks = new Set(weekTargets.filter((t) => t.isRecovery).map((t) => t.weekNumber));
  if (recoveryWeeks.size === 0) return [];
  const embeddedHardPct = resolveDurabilityInsertEnvelope(settings.durabilityInsertEnvelope).embeddedHardPct;
  const eventDates = new Set(events.map((e) => e.date));
  const warnings: string[] = [];

  for (const week of [...recoveryWeeks].sort((a, b) => a - b)) {
    const weekDays = days.filter((d) => d.weekNumber === week && !eventDates.has(d.date));
    const standalone = weekDays.filter(isQuality);
    const embedded = weekDays.filter(
      (d) => !isQuality(d) && carriesEmbeddedIntensity(d.workoutText, ftp, embeddedHardPct)
    );

    if (embedded.length > 0) {
      warnings.push(
        `RECOVERY DENSITY: week ${week} (recovery) has an endurance ride carrying embedded threshold/VO2 work (${embedded
          .map((d) => `${d.type} on ${d.date}`)
          .join(", ")}). A recovery week's long ride should be unbroken Z2 — no embedded efforts.`
      );
    }
    if (standalone.length > RECOVERY_QUALITY_CAP) {
      warnings.push(
        `RECOVERY DENSITY: week ${week} (recovery) has ${standalone.length} quality sessions (${standalone
          .map((d) => d.type)
          .join(", ")}) — a recovery week keeps at most ${RECOVERY_QUALITY_CAP}. Drop the extra type entirely rather than shortening every one.`
      );
    }
  }
  return warnings;
}
