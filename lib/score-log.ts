// Builds and merges the per-ride execution score log. Deterministic — uses the same
// execution-score logic as the daily analysis, applied to EVERY ride in the synced window
// (not just planned days). Planned rides are scored on adherence/compliance; off-plan rides
// on intrinsic quality (decoupling, pacing) against an inferred type. Each entry records the
// FTP it used so the immutable ledger never re-shifts when FTP later changes.

import { computeExecutionScore, resolveCompliance, timeAboveZ2Fraction, type ScoringCalibration } from "./execution-score";
import { inferWorkoutType } from "./ride-classify";
import { round1, round2 } from "./stats";
import type { ActivitySummary, BehaviourSummary, CurrentBlock, CurrentBlockDay, RideEntryContext, RideScoreEntry } from "./types";

const MAX_ENTRIES = 400; // ~6 months of all rides

function isRide(a: ActivitySummary): boolean {
  return a.type === "Ride" || a.type === "VirtualRide";
}

// Freeze the calibration that actually scored THIS entry (ROADMAP #2). `decouplingGood` is global;
// the IF-band offset is per-type and only moves planned (non-intrinsic) entries — off-plan rides skip
// the intensity-vs-type branch, so no offset applies and none is stamped. A spread-ready `{}` when
// nothing applied keeps uncalibrated entries free of a `calibration` key (byte-identical to before).
// Exported so the sync route's live-today re-score stamps the same shape (planned → pass the type).
export function calStampFor(
  calibration: ScoringCalibration | null | undefined,
  scoringType: string | null,
  intrinsic: boolean
): { calibration: { decouplingGood?: number; ifBandOffset?: number } } | Record<string, never> {
  const stamp: { decouplingGood?: number; ifBandOffset?: number } = {};
  const g = calibration?.decouplingGood;
  if (g != null && Number.isFinite(g)) stamp.decouplingGood = g;
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
  contextForDate?: ((date: string) => RideEntryContext | null) | null
): RideScoreEntry[] {
  // Prescribed sessions, by date (only days that actually plan a ride).
  const plannedByDate = new Map<string, CurrentBlockDay>();
  if (block) for (const d of block.days) if (d.durationMin > 0) plannedByDate.set(d.date, d);

  // One entry per date; if a date has two rides, keep the longer (the key session).
  const byDate = new Map<string, RideScoreEntry>();

  for (const act of activities) {
    if (act.date > today || !isRide(act)) continue;
    const actualMin = Math.round(act.movingTimeSec / 60);
    if (actualMin <= 0) continue;

    const ftp = ftpForDate(act.date);
    const ifBasis = act.normalizedPower ?? act.avgWatts;
    const intensityFactor = ifBasis !== null && ftp > 0 ? round2(ifBasis / ftp) : null;
    const variabilityIndex =
      act.normalizedPower !== null && act.avgWatts !== null && act.avgWatts > 0
        ? round2(act.normalizedPower / act.avgWatts)
        : null;
    // Easy-ride discipline signal (Z2/Recovery only, applied in computeExecutionScore).
    const aboveZ2Frac = timeAboveZ2Fraction(act.powerZoneTimes);
    // Context-stamp (ROADMAP #2): the state the athlete carried into this date (form + morning-check).
    // Spread-ready so an entry stays context-free when no data covers the date (byte-identical to before).
    const ctx = contextForDate?.(act.date) ?? null;
    const contextStamp = {
      ...(ctx?.formState ? { formState: ctx.formState } : {}),
      ...(ctx?.morningCheck ? { morningCheck: ctx.morningCheck } : {}),
    };

    const planned = plannedByDate.get(act.date);
    let entry: RideScoreEntry | null = null;

    if (planned) {
      const durationCompliancePct = planned.durationMin > 0 ? Math.round((actualMin / planned.durationMin) * 100) : null;
      const executionScore = computeExecutionScore({
        compliancePct: durationCompliancePct,
        intensityFactor,
        plannedType: planned.type,
        decoupling: act.decoupling,
        variabilityIndex,
        aboveZ2Frac,
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
          // Capped by execution so a poorly-executed session never reads as fully compliant.
          compliancePct: resolveCompliance(durationCompliancePct, executionScore),
          intensityFactor,
          ftpUsed: ftp,
          durationMin: actualMin,
          tss: act.trainingLoad,
          ...calStampFor(calibration, planned.type, false),
          ...contextStamp,
          ...fuelStampFor(act),
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
        decoupling: act.decoupling,
        variabilityIndex,
        aboveZ2Frac, // gated to prescribed Z2/Recovery in computeExecutionScore — inert here (intrinsic)
        intrinsic: true,
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
          compliancePct: null,
          intensityFactor,
          ftpUsed: ftp,
          durationMin: actualMin,
          tss: act.trainingLoad,
          ...calStampFor(calibration, inferredType, true),
          ...contextStamp,
          ...fuelStampFor(act),
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
// never downgrade a frozen `planned` ride to off-plan. buildRideScores only knows the CURRENT block, and
// block history keeps no per-day prescription, so a historical planned ride (its block has rolled off) is
// re-derived as off-plan; letting that win would corrupt the planned/execution axis the rebuild exists to
// correct. We can't re-score it correctly either (its plan is gone — no planned duration/type to recompute
// compliance), so the honest choice is to keep the frozen entry there. Off-plan rides, current-block rides,
// dates the current block now re-plans, and brand-new dates all re-score normally.
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

// LEDGER-2: a rebuild re-scores from corrected activity data, but the frozen context provenance
// (formState/morningCheck — stamped when the wellness/morning-check window still covered the date) can't
// always be reconstructed: the wellness window is shorter than the activity window. Carry forward any
// stamp the fresh entry lacks so a rebuild never silently deletes a correlation-engine data point. A
// fresh stamp always wins when present; a context-free entry stays context-free (no undefined keys).
function carryForwardContext(fresh: RideScoreEntry, prev: RideScoreEntry | undefined): RideScoreEntry {
  if (!prev) return fresh;
  const formState = fresh.formState ?? prev.formState;
  const morningCheck = fresh.morningCheck ?? prev.morningCheck;
  if (formState === fresh.formState && morningCheck === fresh.morningCheck) return fresh; // nothing to carry
  return {
    ...fresh,
    ...(formState !== undefined ? { formState } : {}),
    ...(morningCheck !== undefined ? { morningCheck } : {}),
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
