// Builds and merges the per-ride execution score log. Deterministic — uses the same
// execution-score logic as the daily analysis, applied to EVERY ride in the synced window
// (not just planned days). Planned rides are scored on adherence/compliance; off-plan rides
// on intrinsic quality (decoupling, pacing) against an inferred type. Each entry records the
// FTP it used so the immutable ledger never re-shifts when FTP later changes.

import {
  aerobicDisciplineRead,
  computeExecutionScore,
  resolveCompliance,
  timeAboveAerobicHrFraction,
  type AerobicDiscipline,
  type ScoringCalibration,
} from "./execution-score";
import { aerobicEffPct, z2PwHrBaselineBefore } from "./aerobic";
import { EXPECTS_EMBEDDED_EFFORTS } from "./durability-score";
import { inferWorkoutType } from "./ride-classify";
import { round1, round2 } from "./stats";
import type { ActivitySummary, BehaviourSummary, BlockHistoryEntry, CurrentBlock, CurrentBlockDay, IntervalComparison, RideEntryContext, RideScoreEntry } from "./types";

const MAX_ENTRIES = 400; // ~6 months of all rides

function isRide(a: ActivitySummary): boolean {
  return a.type === "Ride" || a.type === "VirtualRide";
}

// Freeze the calibration that actually scored THIS entry (ROADMAP #2). Now just the per-type IF-band
// offset (decoupling was demoted out of execution scoring — ACC-2026-06-25), which only moves planned
// (non-intrinsic) entries — off-plan rides skip the intensity-vs-type branch, so no offset applies and
// none is stamped. A spread-ready `{}` when nothing applied keeps uncalibrated entries free of a
// `calibration` key. Exported so the sync route's live-today re-score stamps the same shape.
export function calStampFor(
  calibration: ScoringCalibration | null | undefined,
  scoringType: string | null,
  intrinsic: boolean
): { calibration: { ifBandOffset?: number } } | Record<string, never> {
  const stamp: { ifBandOffset?: number } = {};
  if (!intrinsic && scoringType) {
    const o = calibration?.ifBandOffsets?.[scoringType];
    if (o != null && Number.isFinite(o) && o !== 0) stamp.ifBandOffset = o;
  }
  return Object.keys(stamp).length > 0 ? { calibration: stamp } : {};
}

// Fueling context stamp (ROADMAP Track C): freeze the athlete's logged carb intake as g/h onto the
// entry, so a later carbs→execution/decoupling correlation has the provenance to derive their optimal
// intake (the engine's next consumer, once enough rides carry it). Spread-ready `{}` when nothing was
// logged: carbsIngestedG is num(carbs_ingested), so an unlogged ride reads null — distinct from a
// deliberately-logged 0 ("fasted"), which IS a real data point the correlation needs (FUEL-1; without it
// the signal can only ever learn from well-fuelled rides). Negative/non-finite are garbage → dropped.
// Pure: g/h is the logged grams over the ride's moving hours, frozen like ftpUsed so it stays reproducible.
export function fuelStampFor(act: ActivitySummary): { fuel: { carbsGPerH: number } } | Record<string, never> {
  const grams = act.carbsIngestedG;
  if (grams == null || !Number.isFinite(grams) || grams < 0 || act.movingTimeSec <= 0) return {};
  const carbsGPerH = round1(grams / (act.movingTimeSec / 3600));
  return { fuel: { carbsGPerH } };
}

// NP-provenance stamp (ROADMAP #8): flags an entry whose intensityFactor fell back to avg power
// because normalizedPower was absent — mirrors the "NP"/"avg" badge the Today debrief already shows
// live. Spread-ready `{}` when NP was present, or when there's no avg power to fall back to either
// (nothing was scored off avg power in that case, so nothing to flag as unverified).
export function npStampFor(act: ActivitySummary): { npUnverified: true } | Record<string, never> {
  return act.normalizedPower === null && act.avgWatts !== null ? { npUnverified: true } : {};
}

// Easy-ride merged-read provenance stamp (planned Z2/Recovery only): freezes the two inputs behind
// mergedEasyRead (the HR-zone read + aerobicEffPct) onto the entry — stamped on the ledger rather than
// joined at read time because the ledger (~400 entries, ~6 months) and the sync window
// (SYNC_WINDOW_DAYS = 182) don't fully overlap, so a read-time join would silently lose the oldest
// slice. Also guards against re-deriving the HR read + gates a second, independent time — exactly the
// drift class the 2026-07-11 "Coach-prompt aerobic-discipline gap closed" fix (ARCHIVE.md) had to clean
// up after. Matches the `fuel`/`intervals`/`calStampFor` provenance pattern. Gated on the same
// ride-shape condition as computeExecutionScore's merged-read branch (prescribed Z2/Recovery,
// non-embeds-efforts durability template) — so stamp presence means the ride was ELIGIBLE for the
// merged read, not that the read necessarily produced a non-zero adjustment: when both
// aboveAerobicHrFrac and aerobicEffPct are null, this still stamps `{ easy: { indoor } }` even
// though computeExecutionScore's own gate (at least one of the two signals present) never entered
// the merged-read branch for that ride. Spread-ready `{}` off-plan, other types, and templates B–E.
export function easyStampFor(
  act: ActivitySummary,
  plannedType: string,
  durabilityTemplate: string | null | undefined,
  aboveAerobicHrFrac: number | null | undefined,
  aerobicEffPctValue: number | null | undefined
): { easy: { indoor: boolean; hrRead?: AerobicDiscipline; aerobicEffPct?: number } } | Record<string, never> {
  const isEasyType = plannedType === "Z2" || plannedType === "Recovery";
  if (!isEasyType || EXPECTS_EMBEDDED_EFFORTS.has(durabilityTemplate ?? "")) return {};
  const hrRead = aerobicDisciplineRead(aboveAerobicHrFrac);
  const stamp: { indoor: boolean; hrRead?: AerobicDiscipline; aerobicEffPct?: number } = {
    indoor: act.type === "VirtualRide",
  };
  if (hrRead != null) stamp.hrRead = hrRead;
  if (aerobicEffPctValue != null) stamp.aerobicEffPct = round1(aerobicEffPctValue);
  return { easy: stamp };
}

// Interval-adherence stamp (ROADMAP scoring-core gap): maps the prescription-vs-execution comparison
// down to the four fields the ledger freezes as `intervals`. One mapping, used by this module AND the
// sync route's today-patch, so the two capture points can never diverge on what "the stamp" means.
export function intervalStampFrom(cmp: IntervalComparison): RideScoreEntry["intervals"] {
  return {
    adherencePct: cmp.effectiveAdherencePct,
    structuralMismatch: cmp.structuralMismatch,
    completed: cmp.completed,
    total: cmp.total,
  };
}

// SUB-1: a block's "lived" days as of its archive date — the days it actually covered while live, not
// the un-lived future of a superseded/discarded block. Archiving only the lived portion keeps a later
// block's overlapping dates from ever having two competing historical prescriptions.
export function truncateBlockDays(days: CurrentBlockDay[], asOfDate: string): CurrentBlockDay[] {
  return days.filter((d) => d.date <= asOfDate);
}

// Block history enrichment (ROADMAP season-architecture-redesign §8): join each day's real execution
// outcome from the score log by date. Planned-only (`e.planned`) — an off-plan ride has no prescribed
// day to attribute an outcome to. Pure; returns a fresh array only when at least one day's stamp
// actually changes, and preserves referential equality on every unchanged day so a caller (the sync
// route) can diff cheaply and only persist the days that moved.
export function backfillExecutionOntoDays(days: CurrentBlockDay[], entries: RideScoreEntry[]): CurrentBlockDay[] {
  const byDate = new Map(entries.filter((e) => e.planned).map((e) => [e.date, e]));
  let changed = false;
  const out = days.map((d) => {
    const e = byDate.get(d.date);
    if (!e) return d;
    const next: NonNullable<CurrentBlockDay["execution"]> = {
      score: e.executionScore,
      compliancePct: e.compliancePct,
      ...(e.compromised ? { compromised: true as const } : {}),
    };
    if (
      d.execution?.score === next.score &&
      d.execution?.compliancePct === next.compliancePct &&
      d.execution?.compromised === next.compromised
    ) {
      return d;
    }
    changed = true;
    return { ...d, execution: next };
  });
  return changed ? out : days;
}

export function buildRideScores(
  block: CurrentBlock | null,
  activities: ActivitySummary[],
  ftpForDate: (date: string) => number,
  today: string = new Date().toISOString().slice(0, 10),
  // Marks where structured training begins (the first block's start). Off-plan rides BEFORE
  // it are still stored as history, but flagged `legacy` so they're excluded from the
  // execution-quality metric and the drift signal — there was no plan for them to be "off."
  // null = no block has ever existed, so every off-plan ride is legacy.
  offPlanFloor: string | null = null,
  // Per-athlete calibration (ROADMAP #2): the resolved values to score against. The decoupling cutoff
  // AND the per-type IF-band offset that actually scored an entry are both frozen onto it (like ftpUsed),
  // so the immutable ledger stays reproducible (past entries stay frozen via mergeScoreLog regardless).
  // Omitted → population defaults.
  calibration?: ScoringCalibration | null,
  // ROADMAP #2 context-stamp: the athlete-state context (form + morning-check) as of a ride's date,
  // frozen onto each entry as provenance for a later state→execution correlation. Omitted → no stamp.
  contextForDate?: ((date: string) => RideEntryContext | null) | null,
  // SUB-1: historical blocks' archived prescriptions, so a ride whose block has since rolled off can
  // still match. Seeded before the current block, oldest first, so a live block always wins on a date
  // collision and among history entries the most-recently-created wins (Map overwrite semantics). A
  // historical day only counts if its block's createdAt is on/before the day itself — a block can't
  // retroactively claim to have prescribed an already-past day.
  history?: BlockHistoryEntry[],
  // Interval-adherence signal (ROADMAP scoring-core gap): resolves the prescription-vs-execution stamp
  // for a planned interval day, so the ledger can score off the same adherence signal the "today" path
  // already uses instead of coarse whole-ride duration/IF alone (the SIT 2/10 lesson — a frozen entry
  // with no adherence input can't be honestly re-derived later). Only ever consulted for a planned day
  // that isn't Z2/Recovery and doesn't carry a durabilityTemplate — durability rides are graded by a
  // wholly different system (see computeExecutionScore's gradedByDurability) and must never even reach
  // this lookup. Omitted → byte-identical to before (no stamp, adherence never engages).
  adherenceForDate?: ((date: string) => RideScoreEntry["intervals"] | null) | null,
  // Track C: the athlete's day-before loading attribution (loading-log.json), resolved per ride date and
  // frozen onto durability days as provenance for the loading loop. Provenance only — never feeds
  // executionScore (mirrors formState/fuel). Omitted → no stamp, byte-identical to before.
  preLoadForDate?: ((date: string) => { loaded: boolean; targetG: number } | null) | null
): RideScoreEntry[] {
  // Prescribed sessions, by date (only days that actually plan a ride).
  const plannedByDate = new Map<string, CurrentBlockDay>();
  const sortedHistory = [...(history ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const h of sortedHistory) {
    if (!h.days) continue;
    const createdDate = h.createdAt.slice(0, 10);
    for (const d of h.days) if (d.durationMin > 0 && createdDate <= d.date) plannedByDate.set(d.date, d);
  }
  if (block) for (const d of block.days) if (d.durationMin > 0) plannedByDate.set(d.date, d);

  // One entry per date; if a date has two rides, keep the longer (the key session).
  const byDate = new Map<string, RideScoreEntry>();

  for (const act of activities) {
    if (act.date > today || !isRide(act)) continue;
    const actualMin = Math.round(act.movingTimeSec / 60);
    if (actualMin <= 0) continue;

    // Anchor to the FTP intervals.icu applied to THIS ride (icu_ftp) when present — its own record of the
    // FTP live that day. It beats the effective-dated store, whose change-date is only as precise as when
    // we happened to sync (RV-5: an FTP test not synced for days would otherwise score the gap rides
    // against the old FTP). Falls back to physiologyAsOf via ftpForDate when the activity carries none.
    const ftp = act.icuFtp ?? ftpForDate(act.date);
    const ifBasis = act.normalizedPower ?? act.avgWatts;
    const intensityFactor = ifBasis !== null && ftp > 0 ? round2(ifBasis / ftp) : null;
    const variabilityIndex =
      act.normalizedPower !== null && act.avgWatts !== null && act.avgWatts > 0
        ? round2(act.normalizedPower / act.avgWatts)
        : null;
    // Easy-ride discipline signal (Z2/Recovery only, applied in computeExecutionScore).
    const aboveAerobicHrFrac = timeAboveAerobicHrFraction(act.hrZoneTimes);
    // The non-circular aerobic read: this ride's Z2 Pw:HR vs the athlete's baseline from qualifying
    // rides BEFORE it (no self-reference). Null (too little Z2 / no baseline) → no effect. Hoisted above
    // the planned/off-plan split — both branches consume it (planned Z2/Recovery merges it via
    // mergedEasyRead, off-plan uses it as the sole aerobic read) — so it's computed once, not twice.
    // ponytail: O(rides) per call → O(n²) across a full ledger rebuild; pre-accepted (lib/aerobic.ts).
    const easyAerobicEffPct = aerobicEffPct(act, z2PwHrBaselineBefore(activities, act.date));
    // Context-stamp (ROADMAP #2): the objective form the athlete carried into this date.
    // Spread-ready so an entry stays context-free when no wellness covers the date.
    const ctx = contextForDate?.(act.date) ?? null;
    const contextStamp = {
      ...(ctx?.formState ? { formState: ctx.formState } : {}),
    };

    const planned = plannedByDate.get(act.date);
    let entry: RideScoreEntry | null = null;

    if (planned) {
      const durationCompliancePct = planned.durationMin > 0 ? Math.round((actualMin / planned.durationMin) * 100) : null;
      // Interval-adherence stamp (scoring-core gap): only ever looked up for a genuine interval day —
      // Z2/Recovery are steady rides with no target reps to adhere to, and a durability long ride is
      // graded by the delivery-grade system instead (computeExecutionScore's gradedByDurability). Mirrors
      // EXPECTS_EMBEDDED_EFFORTS's intent but is deliberately broader: ANY durabilityTemplate routes a day
      // away from this axis, not just the embeds-efforts subset — the lookup must never even be invoked.
      const isDurabilityOrSteady = planned.type === "Z2" || planned.type === "Recovery" || Boolean(planned.durabilityTemplate);
      const stamp = isDurabilityOrSteady ? null : (adherenceForDate?.(act.date) ?? null);
      const executionScore = computeExecutionScore({
        compliancePct: durationCompliancePct,
        intensityFactor,
        plannedType: planned.type,
        variabilityIndex,
        aboveAerobicHrFrac,
        // Corroborates/refutes the HR-ceiling read on planned Z2/Recovery via mergedEasyRead
        // (inert elsewhere — computeExecutionScore only consumes it for prescribed Z2/Recovery).
        aerobicEffPct: easyAerobicEffPct,
        // Interval-target adherence (scoring-core gap): a structural plan/detection mismatch means the
        // duration comparison was untrustworthy, not that the session failed — treat it as no signal
        // (same as no lookup) rather than let a bogus adherence number drive the score.
        adherencePct: stamp && !stamp.structuralMismatch ? stamp.adherencePct : null,
        // Track B: a durability long ride carries its template — makes the above-Z2 rule template-aware
        // (B–E embed efforts, so above-Z2 time isn't a lapse). The effort-delivery grade needs interval
        // timing the ledger doesn't fetch, so that lands on the today path only.
        durabilityTemplate: planned.durabilityTemplate ?? null,
        calibration,
      });
      if (executionScore !== null) {
        entry = {
          date: act.date,
          executionScore,
          plannedType: planned.type,
          inferredType: planned.type,
          planned: true,
          legacy: false,
          activityId: act.id,
          // Capped by execution so a poorly-executed session never reads as fully compliant.
          compliancePct: resolveCompliance(durationCompliancePct, executionScore),
          intensityFactor,
          ftpUsed: ftp,
          durationMin: actualMin,
          tss: act.trainingLoad,
          ...(planned.durabilityTemplate ? { durabilityTemplate: planned.durabilityTemplate } : {}), // Track B: attribute outcomes per template (#4)
          // Track C: the athlete's day-before loading attribution — provenance for the loading loop,
          // only meaningful on durability days (the prompt only ever asks there).
          ...(planned.durabilityTemplate && preLoadForDate
            ? (() => {
                const pl = preLoadForDate(act.date);
                return pl ? { preLoad: pl } : {};
              })()
            : {}),
          ...calStampFor(calibration, planned.type, false),
          ...contextStamp,
          ...fuelStampFor(act),
          ...npStampFor(act),
          ...easyStampFor(act, planned.type, planned.durabilityTemplate, aboveAerobicHrFrac, easyAerobicEffPct),
          // Frozen even when structuralMismatch suppressed it from scoring THIS time — the comparison is
          // still real provenance for a later rebuild/correlation (structuralMismatch means duration was
          // untrustworthy, not that the whole comparison is worthless).
          ...(stamp ? { intervals: stamp } : {}),
        };
      }
    } else {
      // Off-plan ride — always stored as history, but flagged `legacy` if it predates the
      // first block (pre-structure), which keeps it out of the execution metric + drift.
      const isLegacy = offPlanFloor === null || act.date < offPlanFloor;
      const inferredType = inferWorkoutType(intensityFactor, actualMin);
      const executionScore = computeExecutionScore({
        compliancePct: null,
        intensityFactor,
        plannedType: inferredType,
        variabilityIndex,
        aboveAerobicHrFrac, // gated to prescribed Z2/Recovery in computeExecutionScore — inert here (intrinsic)
        intrinsic: true,
        aerobicEffPct: easyAerobicEffPct,
        calibration,
      });
      if (executionScore !== null) {
        entry = {
          date: act.date,
          executionScore,
          plannedType: null,
          inferredType,
          planned: false,
          legacy: isLegacy,
          activityId: act.id,
          compliancePct: null,
          intensityFactor,
          ftpUsed: ftp,
          durationMin: actualMin,
          tss: act.trainingLoad,
          ...calStampFor(calibration, inferredType, true),
          ...contextStamp,
          ...fuelStampFor(act),
          ...npStampFor(act),
        };
      }
    }

    if (!entry) continue;
    const prior = byDate.get(act.date);
    if (!prior || entry.durationMin > prior.durationMin) byDate.set(act.date, entry);
  }

  return [...byDate.values()];
}

// The score log is an append-only historical ledger: a PAST date, once scored, is frozen here, so a
// later FTP change never rewrites it. Existing entries win on a date collision; fresh entries only
// fill in dates not yet recorded.
//
// The one deliberate exception is TODAY (CR-E): while the current day is still "live", the sync route
// re-derives today's entry each run (it has interval-aware data this merge can't see — see the patch
// in app/api/sync/route.ts), so today's score can move until the day rolls over. Past dates never do.
export function mergeScoreLog(existing: RideScoreEntry[], fresh: RideScoreEntry[]): RideScoreEntry[] {
  const byDate = new Map<string, RideScoreEntry>();
  for (const e of fresh) byDate.set(e.date, e);
  for (const e of existing) byDate.set(e.date, e); // existing overrides fresh — immutable
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_ENTRIES);
}

// Rebuild merge (SYNC-2): re-scored `fresh` entries win on overlapping dates, so a corrected NP/decoupling
// re-flows into the score — with ONE invariant a plain fresh-wins merge violates (LEDGER-1): a rebuild must
// never downgrade a frozen `planned` ride to off-plan. buildRideScores now also matches against archived
// history (SUB-1), so most rolled-off-block rides re-derive correctly — but the guard still matters for a
// history entry with no `days` (archived before SUB-1, or evicted by the archive's size cap) or one whose
// prescription was truncated away; letting a wrongly-off-plan re-derivation win in that case would corrupt
// the planned/execution axis the rebuild exists to correct, so the honest choice is to keep the frozen
// entry there. Off-plan rides, current-block rides, dates the current block now re-plans, and brand-new
// dates all re-score normally.
export function mergeScoreLogRebuild(fresh: RideScoreEntry[], existing: RideScoreEntry[]): RideScoreEntry[] {
  const byDate = new Map<string, RideScoreEntry>();
  for (const e of existing) byDate.set(e.date, e);
  for (const f of fresh) {
    const prev = byDate.get(f.date);
    if (prev?.planned && !f.planned) continue; // LEDGER-1: a rebuild can't un-plan a frozen entry
    byDate.set(f.date, carryForwardContext(f, prev)); // LEDGER-2: keep frozen provenance the re-score lacks
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_ENTRIES);
}

// LEDGER-2: a rebuild re-scores from corrected activity data, but the frozen form provenance (stamped when
// the wellness window still covered the date) can't always be reconstructed: the wellness window is shorter
// than the activity window. Carry forward the stamp the fresh entry lacks so a rebuild never silently
// deletes a correlation-engine data point. A fresh stamp always wins; a context-free entry stays so.
function carryForwardContext(fresh: RideScoreEntry, prev: RideScoreEntry | undefined): RideScoreEntry {
  if (!prev) return fresh;
  const formState = fresh.formState ?? prev.formState;
  // Interval-adherence stamp (scoring-core gap): the re-score's lookup may not cover this date either
  // (same reconstruction gap as formState) — carry the frozen stamp forward so a rebuild never silently
  // loses the adherence provenance the SIT 2/10 lesson exists to prevent. A fresh stamp always wins.
  const intervals = fresh.intervals ?? prev.intervals;
  if (formState === fresh.formState && intervals === fresh.intervals) return fresh; // nothing to carry
  return {
    ...fresh,
    ...(formState !== undefined ? { formState } : {}),
    ...(intervals !== undefined ? { intervals } : {}),
  };
}

// Complete-riding-behaviour signal from ALL logged rides (planned + off-plan).
export function summariseBehaviour(entries: RideScoreEntry[]): BehaviourSummary {
  const total = entries.length;
  const plannedRides = entries.filter((e) => e.planned).length;
  const unplannedRides = total - plannedRides;
  const offPlanPct = total > 0 ? Math.round((unplannedRides / total) * 100) : 0;

  const unplannedScores = entries.filter((e) => !e.planned).map((e) => e.executionScore);
  const unplannedAvgQuality = unplannedScores.length
    ? round1(unplannedScores.reduce((s, v) => s + v, 0) / unplannedScores.length)
    : null;

  let weeklyHours: number | null = null;
  if (total > 0) {
    const dates = entries.map((e) => e.date).sort();
    const spanDays = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000 + 1;
    const weeks = Math.max(1, spanDays / 7);
    const totalHours = entries.reduce((s, e) => s + e.durationMin, 0) / 60;
    weeklyHours = round1(totalHours / weeks);
  }

  return { totalRides: total, plannedRides, unplannedRides, offPlanPct, unplannedAvgQuality, weeklyHours };
}
