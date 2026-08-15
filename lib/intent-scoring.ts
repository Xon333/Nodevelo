// Deterministic scoring of a SELF-DIRECTED ride against the athlete's own stated objectives.
//
// The LLM translates a free-text note into structured objectives (lib/intent-schema.ts); everything
// that turns those objectives into a 1-10 verdict lives here, in pure TypeScript with no I/O, no SDK
// and no network (INVARIANT 12 — the model never computes a number).
//
// Three things this module is deliberately the ONLY place for:
//   • `resolveTargetWatts` — the single seam where a stated `%FTP` becomes watts, anchored to the
//     ride-date `ftpUsed` the ledger froze rather than to today's FTP.
//   • `canonicalise` — the four ordered stages that make the model's DECOMPOSITION CHOICE unable to
//     move the score.
//   • the scoreability gate — grounding, then kind-eligibility-by-confidence, then evidence scope.
//
// Three things this module deliberately CANNOT see, each pinned by a test that reads this source file:
// whole-ride aerobic drift, the ride's existing execution score, and any whole-ride variability figure.
// Matched-lap NP/variability may appear in evidence text only, never as a scoring input. A judge shown
// no drift number cannot report a drift verdict, and this scorer must not either.
//
// THE ONE-WAY CONFIDENCE RULE. The deterministic gate decides scoreability FIRST. Confidence may then
// only SHRINK the gradable kind set (`medium` drops `structure`) or veto outright (`low`). No
// confidence level can make a ride scoreable that the gate rejected. Pinned by a monotonicity test
// across all three levels for every fixture, because per-level examples cannot see the inverse bug.
//
// EVIDENCE SCOPE IS NOT FULFILMENT. `scopeMin` answers "how much of the ride does this evidence SPEAK
// ABOUT", never "how much of it went well". A clearly stated target the athlete badly missed therefore
// scores LOW; it never becomes `Not scored`. Scope is the MAXIMUM across objectives, never a union:
// zone arrays are whole-ride aggregates with no timestamps and lap indices carry no stated sample
// interval, so a union is not a number this codebase can honestly compute.
//
// MERGED TARGETS ARE NEVER RE-GROUNDED. Grounding runs on each objective as the model emitted it,
// BEFORE stage 1. A summed `zone-time` target is accepted only when every merged part was individually
// grounded — it is never re-checked against the note as a whole, because the sum legitimately does not
// appear there ("20 min Z2 then 25 min Z2" contains no `45`). This is the one place merging could
// smuggle an ungrounded number through, and the rule that stops it is per-part, not per-sum.

import { verifyGrounding } from "./intent-grounding";
import { round1 } from "./stats";
import type {
  ExecutedInterval,
  IntentInterpretation,
  IntentOverlay,
  IntentParseFailure,
  IntentTarget,
  NotScoredReason,
  ObjectiveKind,
  OverlayStatus,
  ScoredObjective,
  StructuredIntent,
  WorkoutType,
  ZoneBasis,
} from "./types";

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------

// The DETERMINISTIC scorer version, distinct from the interpretation's `promptVersion` (which versions
// the LLM parse). Design §11.2 requires retro scoring to use "the same deterministic scorer" as future
// rides, which is unverifiable without recording which one ran.
export const INTENT_SCORING_VERSION = 1;

// The evidence-scope gate. A whole-ride 1-10 verdict must not rest only on LOCAL evidence: a 9-minute
// lap says nothing about the other 109 minutes.
export const INTENT_MIN_SCOPE_MIN = 20; // absolute floor, minutes
export const INTENT_SCOPE_MIN_FRACTION = 0.33;

export type IntentConfidence = IntentInterpretation["confidence"];

// `qualitative` is in no list — it is acknowledged (`measurable: false, scored: false`) and never
// graded: speed, braking and GPS cannot establish that cornering was good (design §6/§12.2).
export const GRADABLE_KINDS_BY_CONFIDENCE: Record<IntentConfidence, readonly ObjectiveKind[]> = {
  high: ["duration", "zone-time", "zone-emphasis", "effort", "structure", "terrain"],
  // structure dropped at medium (ordinal/reward-only); terrain KEPT — it is a falsifiable existence
  // claim from lap data, the same rigor class as `effort`, not an ordinal claim like `structure`.
  medium: ["duration", "zone-time", "zone-emphasis", "effort", "terrain"],
  low: [],
};

// A lap counts as a candidate for a stated effort when its length is within this fraction of the
// target's.
const LAP_DURATION_TOLERANCE = 0.2;

const OVERLAY_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

// Everything the scorer is allowed to see about the ride. Note what is NOT here: aerobic drift, the
// ledger's own verdict, and any whole-ride variability or normalised-power figure. The absence is the
// contract — a field that does not exist cannot leak into a delta.
export interface RideEvidence {
  durationMin: number;
  isIndoor: boolean; // VirtualRide — power only for an unstated zone basis, no HR substitute
  powerZoneTimes: number[] | null; // SECONDS per zone, index 0 = zone 1
  hrZoneTimes: number[] | null; // SECONDS per zone, index 0 = zone 1
  laps: ExecutedInterval[]; // athlete-curated intervals; `[]` means none were available
  ftpUsed: number; // the FTP that applied on the RIDE's date, from the ledger row
  wholeRideMaxHr: number | null;
  wholeRideAvgCadence: number | null;
}

// One zone reading, plus which array it came from and whether that array was the athlete's stated
// choice or this module's default. Recorded in the objective's `evidence` so a later reader never has
// to guess which sensor answered.
export interface ZoneReading {
  minutes: number;
  totalMinutes: number;
  sharePct: number;
  basis: "power" | "heart-rate";
  assumed: boolean; // true when the note stated no basis and power was defaulted to
}

export interface GradeContext {
  // The laps still unclaimed by an earlier effort. Efforts are matched longest-target-first and a lap
  // is CONSUMED once matched, so two efforts can never both claim it.
  laps?: ExecutedInterval[];
  // Matched-lap start indices in the order the note STATED the efforts — the only ordered evidence
  // this module has, and therefore the only thing `structure` can be graded from.
  effortStartIndices?: (number | null)[];
  // A note produced by canonicalisation (a merge, a subsumption, a rep-count conflict) that must
  // survive into the graded objective's evidence trail.
  carriedEvidence?: string | null;
}

export interface GradeResult {
  objective: ScoredObjective;
  delta: number | null; // null = ungraded; contributes nothing, not a zero
  matchedLaps: ExecutedInterval[];
}

export interface IntentVerdict {
  score: number | null;
  reason: NotScoredReason | null;
  objectives: ScoredObjective[]; // graded canonical set first, then acknowledged non-gradable ones
  scopeMin: number;
  scopeRequiredMin: number;
}

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

// Reused verbatim from the non-SIT interval-adherence band in lib/execution-score.ts. Symmetric,
// because sustained overshoot on a threshold effort is a real pacing failure, not a bonus.
function adherenceDelta(pct: number): number {
  if (pct >= 95 && pct <= 106) return 2;
  if ((pct >= 90 && pct < 95) || (pct > 106 && pct <= 112)) return 1;
  if (pct >= 85 && pct < 90) return 0;
  if (pct >= 80 && pct < 85) return -1;
  return -2;
}

function hrCeilingDelta(peakHr: number, ceilingBpm: number): number {
  const over = peakHr - ceilingBpm;
  if (over <= 0) return 2;
  if (over <= 3) return 1;
  if (over <= 8) return 0;
  if (over <= 15) return -1;
  return -2;
}

// Reused from the duration-compliance band in lib/execution-score.ts, and one-sided by design: riding
// LONGER than you said is not a failure of your own session (design §6 forbids penalising a
// self-directed ride for its own structure). Question 1 pins the low end — "3 hours of Z2" ridden for
// 40 minutes is 22%, which must land on -2.
function complianceDelta(pct: number): number {
  if (pct >= 95) return 2;
  if (pct >= 85) return 1;
  if (pct >= 70) return 0;
  if (pct >= 55) return -1;
  return -2;
}

// Question 8's reward-only zone-emphasis band: mentioning a hard zone must not create a penalty merely
// because hard-zone work is naturally a small share of a real ride.
function emphasisDelta(sharePct: number): number {
  if (sharePct >= 60) return 2;
  if (sharePct >= 45) return 1;
  return 0;
}

// One clamped contribution per kind, so a third zone objective cannot triple a bonus. `structure` and
// `zone-emphasis` are REWARD-ONLY: neither ambiguous ordering nor an accurately mentioned hard zone
// should penalise a self-directed ride for its own structure.
const KIND_BAND: Record<ObjectiveKind, { min: number; max: number }> = {
  duration: { min: -2, max: 2 },
  "zone-time": { min: -2, max: 2 },
  "zone-emphasis": { min: 0, max: 2 },
  effort: { min: -2, max: 2 },
  structure: { min: 0, max: 1 },
  terrain: { min: -2, max: 2 },
  qualitative: { min: 0, max: 0 },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Round half AWAY FROM ZERO, so a -0.5 mean is not quietly rounded up to 0 while +0.5 rounds to 1, and
// so a negative mean can never surface as `-0`.
function roundSymmetric(value: number): number {
  const rounded = (value < 0 ? -1 : 1) * Math.round(Math.abs(value));
  return rounded + 0; // normalises -0
}

// ---------------------------------------------------------------------------
// Zone helpers
// ---------------------------------------------------------------------------

// "Z2" / "z2" / "zone 2" / "2" → index 1. Anything else → null.
function zoneIndex(zone: string | undefined | null): number | null {
  if (!zone) return null;
  const match = /^\s*(?:z|zone)?\s*([1-7])\s*$/i.exec(zone);
  return match ? Number(match[1]) - 1 : null;
}

// The canonical STRING form of a zone, for identity and merge keys. Spelling is the model's choice and
// must never move a score: `sameZone` and `zoneMinutes` already read "Z2" / "z2" / "zone 2" / "2" as one
// zone, so the keys that decide dedupe and merge have to agree with them. A raw `.toUpperCase()` did
// not, which let one claim split across two spellings ("Z2" 20 min + "zone 2" 25 min) escape the
// stage-2 sum and score as two separate over-achieved targets.
//
// Unparseable zones fall back to their uppercased text so an unrecognised label still groups with
// itself. That branch cannot collide with the canonical form: any string uppercasing to "Z<1-7>" parses.
function zoneKey(zone: string | undefined | null): string {
  const index = zoneIndex(zone);
  return index === null ? (zone ?? "-").toUpperCase() : `Z${index + 1}`;
}

function readZoneArray(
  array: number[] | null,
  index: number,
  basis: "power" | "heart-rate",
  assumed: boolean
): ZoneReading | null {
  // Null, too short for the requested zone, or summing to zero — all mean NO evidence, never a zero
  // reading. A ride with no zone data has not been observed to spend zero minutes in Z2.
  if (!array || array.length < index + 1) return null;
  const total = array.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  if (!(total > 0)) return null;
  const seconds = Number.isFinite(array[index]) ? array[index] : 0;
  // round1(seconds / 60) — never round the seconds to whole minutes first.
  return {
    minutes: round1(seconds / 60),
    totalMinutes: round1(total / 60),
    sharePct: (seconds / total) * 100,
    basis,
    assumed,
  };
}

// Which array — stated by the athlete, never guessed from the zone number.
//
// An EXPLICIT basis is honoured exactly and never cross-falls-back: grading a stated power target from
// HR data reports a different measurement under the label the athlete asked for. `unspecified` defaults
// to power (cycling zones are power zones in this app — physiology.json stores % of FTP), with an HR
// fallback permitted for that basis alone, and none at all indoors (ERG flattens power and HR drifts,
// so an indoor HR-derived zone reading substitutes for nothing).
export function zoneMinutes(
  evidence: RideEvidence,
  zone: string | undefined,
  basis: ZoneBasis
): ZoneReading | null {
  const index = zoneIndex(zone);
  if (index === null) return null;
  if (basis === "power") return readZoneArray(evidence.powerZoneTimes, index, "power", false);
  if (basis === "heart-rate") return readZoneArray(evidence.hrZoneTimes, index, "heart-rate", false);
  const power = readZoneArray(evidence.powerZoneTimes, index, "power", true);
  if (power) return power;
  if (evidence.isIndoor) return null;
  return readZoneArray(evidence.hrZoneTimes, index, "heart-rate", true);
}

function basisLabel(reading: ZoneReading): string {
  const name = reading.basis === "power" ? "power" : "HR";
  return reading.assumed ? `${name} zones assumed — the note stated no basis` : `${name} zones as stated`;
}

function missingZoneDataText(basis: ZoneBasis, isIndoor: boolean): string {
  if (basis === "power") return "no power zone data";
  if (basis === "heart-rate") return "no HR zone data";
  return isIndoor ? "no power zone data (indoor ride — HR is not a substitute)" : "no power or HR zone data";
}

// ---------------------------------------------------------------------------
// Target resolution — the ONLY place a stated percentage becomes watts
// ---------------------------------------------------------------------------

// An explicit `watts` always wins over a percentage when the note somehow states both. `ftpUsed` comes
// from the ledger entry, not the current physiology store, so resolution is anchored to the FTP that
// actually applied on the ride's date. With no usable anchor the target CANNOT resolve — the effort is
// then ungraded rather than resolved against a guess.
export function resolveTargetWatts(target: IntentTarget, ftpUsed: number): number | null {
  if (target.watts != null && Number.isFinite(target.watts)) return target.watts;
  if (target.targetPctFtp == null || !Number.isFinite(target.targetPctFtp)) return null;
  if (!Number.isFinite(ftpUsed) || ftpUsed <= 0) return null;
  return Math.round((ftpUsed * target.targetPctFtp) / 100);
}

// ---------------------------------------------------------------------------
// Canonicalisation — question 6's four ordered stages
// ---------------------------------------------------------------------------
//
// The ORDER is the whole correctness argument. An earlier draft of this design collapsed stages 1 and
// 2 into a single "merge" rule, which made EXACT DUPLICATES sum as if they were distinct split
// components: "45 min Z2" emitted twice became a 90-minute target. Dedupe strictly precedes merge.
//
//   stage 0  kind normalisation   (a claim stating only a zone is an emphasis, not an effort)
//   stage 1  drop exact semantic duplicates   — nothing is summed here
//   stage 2  merge what remains DISTINCT, per kind
//   stage 3  cross-kind subsumption           — one phrase contributes once
//   stage 4  bounded aggregation              — the caller's, in `scoreIntentExecution`

const roundOr = (value: number | undefined, step: number): string =>
  value == null || !Number.isFinite(value) ? "-" : String(Math.round(value / step) * step);

// `(kind, zone, zoneBasis, durationMin, watts, targetPctFtp, reps, targetHrBpm, targetCadenceRpm,
// terrain)`, with `durationMin` rounded to the minute, `watts` to 5 W and `targetPctFtp` to 1%.
// `description` and `sourceText` are EXCLUDED — free text varies while the claim does not.
//
// The one exception is `qualitative`, whose stage-2 merge key is `("qualitative", description)`: a
// stage-1 key COARSER than stage 2's own would drop entries stage 2 was told to keep, collapsing
// "practice cornering" and "keep speed on descents" into one acknowledged line.
export function identityKey(objective: ScoredObjective): string {
  const target = objective.target ?? {};
  const parts = [
    objective.kind,
    zoneKey(target.zone),
    objective.zoneBasis,
    roundOr(target.durationMin, 1),
    roundOr(target.watts, 5),
    roundOr(target.targetPctFtp, 1),
    roundOr(target.reps, 1),
    roundOr(target.targetHrBpm, 1),
    roundOr(target.targetCadenceRpm, 1),
    target.terrain ?? "-",
  ];
  if (objective.kind === "qualitative") parts.push(objective.description);
  return parts.join("|");
}

function withTarget(objective: ScoredObjective, target: IntentTarget, note?: string | null): ScoredObjective {
  return { ...objective, target, evidence: note ?? null };
}

const numeric = (value: number | undefined): number | null =>
  value != null && Number.isFinite(value) ? value : null;

// Stage 0. A claim whose only stated content is a zone is an EMPHASIS claim, whatever kind the model
// filed it under: "some Z4 efforts" names no duration to evaluate over (question 7's zone-only row),
// and a `zone-time` with no minutes states no total. Kind normalisation must precede stage 1 because
// identity depends on kind.
function normaliseKinds(objectives: ScoredObjective[]): ScoredObjective[] {
  return objectives.map((objective) => {
    const target = objective.target;
    if (!target || !target.zone) return objective;
    if (objective.kind !== "effort" && objective.kind !== "zone-time") return objective;
    const statesSomethingElse =
      numeric(target.durationMin) !== null ||
      numeric(target.watts) !== null ||
      numeric(target.targetPctFtp) !== null ||
      (objective.kind === "effort" && numeric(target.reps) !== null);
    if (statesSomethingElse) return objective;
    return { ...objective, kind: "zone-emphasis" as ObjectiveKind, target: { zone: target.zone } };
  });
}

// Stage 1. Keep the first occurrence of each identity, discard the rest. NOTHING is summed here.
function dropExactDuplicates(objectives: ScoredObjective[]): ScoredObjective[] {
  const seen = new Set<string>();
  const kept: ScoredObjective[] = [];
  for (const objective of objectives) {
    const key = identityKey(objective);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ ...objective, evidence: null }); // the model does not own the evidence trail
  }
  return kept;
}

// Stage 2. Only entries that survived stage 1 as DISTINCT reach a merge rule.
function mergeKey(objective: ScoredObjective): string {
  const target = objective.target ?? {};
  switch (objective.kind) {
    case "duration":
      return "duration";
    case "structure":
      return "structure";
    case "zone-time":
    case "zone-emphasis":
      return `${objective.kind}|${zoneKey(target.zone)}|${objective.zoneBasis}`;
    case "effort":
      // `reps` is deliberately absent: two readings of one effort that disagree only on rep count are
      // CONTRADICTORY, not additive. HR and cadence targets distinguish separate effort claims.
      return `effort|${roundOr(target.durationMin, 1)}|${roundOr(target.watts, 5)}|${roundOr(
        target.targetPctFtp,
        1
      )}|${zoneKey(target.zone)}|${roundOr(target.targetHrBpm, 1)}|${roundOr(target.targetCadenceRpm, 1)}`;
    case "terrain":
      return `terrain|${target.terrain ?? "-"}|${roundOr(target.durationMin, 1)}`;
    case "qualitative":
      return `qualitative|${objective.description}`;
  }
}

function mergeGroup(group: ScoredObjective[]): ScoredObjective {
  const first = group[0];
  if (group.length === 1) return first;
  const grounded = group.every((objective) => objective.grounded);

  switch (first.kind) {
    case "duration": {
      // Competing claims about ONE total, not parts of it — take the max.
      const max = Math.max(...group.map((o) => numeric(o.target?.durationMin) ?? 0));
      return withTarget(
        first,
        { ...first.target, durationMin: max },
        `${group.length} stated totals; took the longest (${max} min)`
      );
    }
    case "zone-time": {
      // A split phase list states PARTS of one total — sum them, per (zone, basis). Never across
      // bases: HR-zone minutes and power-zone minutes are not addable.
      const sum = group.reduce((total, o) => total + (numeric(o.target?.durationMin) ?? 0), 0);
      return {
        ...withTarget(first, { ...first.target, durationMin: sum }, `summed from ${group.length} stated parts`),
        // A summed target is accepted only when EVERY merged part was individually grounded; it is
        // never re-grounded against the note, because the sum does not appear there.
        grounded,
      };
    }
    case "effort": {
      // `reps` is NEVER summed. Genuinely different rep counts of the same effort are contradictory
      // readings of one note: keep the max and record the conflict.
      const reps = group.map((o) => numeric(o.target?.reps)).filter((value): value is number => value !== null);
      if (reps.length === 0) return first;
      const max = Math.max(...reps);
      const conflicting = new Set(reps).size > 1;
      return withTarget(
        first,
        { ...first.target, reps: max },
        conflicting ? `conflicting rep counts stated (${[...new Set(reps)].join(", ")}); took ${max}` : null
      );
    }
    default:
      // `zone-emphasis` (stage 1's dedupe is the whole rule), `structure` (at most one survives) and
      // `qualitative` (no merge) all keep the first entry.
      return first;
  }
}

function mergeDistinct(objectives: ScoredObjective[]): ScoredObjective[] {
  const groups = new Map<string, ScoredObjective[]>();
  const order: string[] = [];
  for (const objective of objectives) {
    const key = mergeKey(objective);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(objective);
  }
  return order.map((key) => mergeGroup(groups.get(key)!));
}

const sameZone = (a: ScoredObjective, b: ScoredObjective): boolean => {
  const left = zoneIndex(a.target?.zone);
  const right = zoneIndex(b.target?.zone);
  return left !== null && left === right;
};

// Two bases are compatible when they name the same measurement, or when one side never named one.
const compatibleBasis = (a: ZoneBasis, b: ZoneBasis): boolean =>
  a === b || a === "unspecified" || b === "unspecified";

// Stage 3. One stated phrase must not contribute twice under two kinds. "45 min Z2" is simultaneously
// a duration claim and a zone claim, and letting it score on both axes counts the same evidence twice
// — a note that happened to phrase its total as a zone would outscore an identical one that did not.
function applySubsumption(objectives: ScoredObjective[]): ScoredObjective[] {
  const zoneTimes = objectives.filter((o) => o.kind === "zone-time");
  const dropped = new Set<ScoredObjective>();

  // 3a. `zone-time` subsumes `zone-emphasis` for the same zone — the numbered claim is strictly
  // stronger.
  for (const objective of objectives) {
    if (objective.kind !== "zone-emphasis") continue;
    if (zoneTimes.some((zt) => sameZone(zt, objective) && compatibleBasis(zt.zoneBasis, objective.zoneBasis))) {
      dropped.add(objective);
    }
  }

  // 3b. A `zone-time` sharing the `duration` objective's source span, or stating the same target
  // (+-1 min), subsumes that duration entry: one phrase, one contribution. The zone-time wins because
  // it is the more specific claim. If the note SEPARATELY states a total ("2 h ride, 45 min of it in
  // Z2"), the spans and targets differ and both survive — correctly, they are two real claims.
  for (const objective of objectives) {
    if (objective.kind !== "duration") continue;
    const stated = numeric(objective.target?.durationMin);
    const overlaps = zoneTimes.some((zt) => {
      if (dropped.has(zt)) return false;
      const sameSpan =
        zt.sourceText !== null && objective.sourceText !== null && zt.sourceText === objective.sourceText;
      const ztMin = numeric(zt.target?.durationMin);
      const sameTarget = stated !== null && ztMin !== null && Math.abs(ztMin - stated) <= 1;
      return sameSpan || sameTarget;
    });
    if (overlaps) dropped.add(objective);
  }

  // 3c. An `effort` whose matched lap set falls inside a `zone-time`'s zone is NOT subsumed — a
  // 9-minute threshold effort inside a 2-hour ride is a separate claim about a different part of the
  // ride, resting on different evidence (a specific lap). No rule drops it; stated here because its
  // ABSENCE is the decision.

  return objectives.filter((objective) => !dropped.has(objective));
}

// Stages 0-3. Exported separately from `scoreIntentExecution` so a failing invariance test can say
// WHICH stage broke rather than only that a number moved. Stage 4 (bounded aggregation) is the
// caller's.
export function canonicalise(objectives: ScoredObjective[]): ScoredObjective[] {
  return applySubsumption(mergeDistinct(dropExactDuplicates(normaliseKinds(objectives))));
}

// ---------------------------------------------------------------------------
// Lap matching
// ---------------------------------------------------------------------------

export function matchLaps(
  target: IntentTarget,
  laps: ExecutedInterval[],
  resolvedWatts: number | null = null
): ExecutedInterval[] {
  // Terrain is handled entirely separately (R3/R4 fix, 2026-08-12) — it never shares the duration
  // pre-filter or the distance() ranking below. See matchTerrain.
  if (target.terrain) return matchTerrain(target, laps);

  const durationMin = numeric(target.durationMin);
  if (durationMin === null || durationMin <= 0) {
    const zone = zoneIndex(target.zone);
    if (zone === null) return [];
    const candidates = laps.filter((lap) => lap.zone === zone + 1);
    return candidates.length === 1 ? candidates : [];
  }
  const targetSec = durationMin * 60;
  const low = targetSec * (1 - LAP_DURATION_TOLERANCE);
  const high = targetSec * (1 + LAP_DURATION_TOLERANCE);
  const candidates = laps.filter((lap) => lap.durationSec >= low && lap.durationSec <= high);
  const wanted = Math.max(1, Math.round(numeric(target.reps) ?? 1));
  const distance = (lap: ExecutedInterval): number => {
    if (target.targetHrBpm != null) {
      return lap.avgHr == null ? Number.MAX_SAFE_INTEGER : Math.abs(lap.avgHr - target.targetHrBpm);
    }
    if (target.targetCadenceRpm != null) {
      return lap.avgCadenceRpm == null
        ? Number.MAX_SAFE_INTEGER
        : Math.abs(lap.avgCadenceRpm - target.targetCadenceRpm);
    }
    if (resolvedWatts === null) return Math.abs(lap.durationSec - targetSec);
    if (lap.avgWatts == null) return Number.MAX_SAFE_INTEGER;
    return Math.abs(lap.avgWatts - resolvedWatts);
  };
  return [...candidates].sort((a, b) => distance(a) - distance(b)).slice(0, wanted);
}

// Strava's own published climb-categorization floor (support.strava.com/hc/en-us/articles/216917057) —
// borrowed here as the minimum |gradient| that counts as a climb/descent at all, not their full
// length×gradient category scoring, which this phase doesn't need.
const CLIMB_GRADIENT_FLOOR_PCT = 3;
// Same family as CLIMB_GRADIENT_FLOOR_PCT — a named, tunable constant, not an inline magic number.
// A gradient-fallback terrain match whose duration exceeds this multiple of the stated claim is treated
// as "wrong lap, not a generous ride" — see docs/systems/02-scoring-and-learning.md's rough-edges entry
// for the reproduction (10.3x overmatch on an undivided ride).
const TERRAIN_OVERMATCH_RATIO = 3;

function hasLabelHint(lap: ExecutedInterval, terrain: "climb" | "descent"): boolean {
  return (lap.label ?? "").trim().toLowerCase().includes(terrain);
}

// R4 fix (2026-08-12): climb and descent deliberately read DIFFERENT gradient statistics, not the same
// field with a sign flip. Climb keeps maxGradientPct (peak) — a short steep pitch inside an otherwise
// flat lap should still count (design doc §4: a real climb lap's average read ~0.4% while its peak hit
// 14-15%). Descent switches to avgGradientPct (already-synced, signed, pre-dates this phase) — the NET
// gradient over the lap is the honest "was this a sustained descent" signal. maxGradientPct is the wrong
// extremum for descent: it's the most-POSITIVE sample, so one flat or uphill moment anywhere in a real
// descent would defeat a maxGradientPct<=-3% check even though the lap genuinely descended overall.
function clearsGradientFloor(lap: ExecutedInterval, terrain: "climb" | "descent"): boolean {
  if (terrain === "climb") {
    return lap.maxGradientPct != null && lap.maxGradientPct >= CLIMB_GRADIENT_FLOOR_PCT;
  }
  return lap.avgGradientPct != null && lap.avgGradientPct <= -CLIMB_GRADIENT_FLOOR_PCT;
}

// A candidate qualifies as the stated terrain only via its own label or a gradient clearing the floor
// above — NEVER by elimination among duration-matched laps. A lap that shows no climb/descent signal is
// not evidence of one; without this filter, "closest by distance" among non-qualifying candidates would
// silently guess.
function filterByTerrain(terrain: "climb" | "descent", candidates: ExecutedInterval[]): ExecutedInterval[] {
  const labelled = candidates.filter((lap) => hasLabelHint(lap, terrain));
  if (labelled.length > 0) return labelled; // label is the primary signal — don't dilute with gradient-only candidates once any label exists
  return candidates.filter((lap) => clearsGradientFloor(lap, terrain));
}

// R3 fix (2026-08-12): terrain candidacy comes from filterByTerrain (label/gradient), never the ±20%
// duration pre-filter that gates power/HR/cadence matching above. Phase 3c additionally rejects an
// unlabelled gradient-fallback candidate over 3× the stated duration; labelled candidates remain exempt.
// Other duration mismatches are selected by closest duration, then graded by gradeTerrain.
function matchTerrain(target: IntentTarget, laps: ExecutedInterval[]): ExecutedInterval[] {
  const terrain = target.terrain!;
  const qualifying = filterByTerrain(terrain, laps);
  const durationMin = numeric(target.durationMin);
  if (durationMin === null || durationMin <= 0) {
    // No stated duration: same ultra-conservative "exactly one candidate or nothing" rule the zone-only
    // branch above already uses — a genuinely ambiguous terrain claim stays ungraded.
    return qualifying.length === 1 ? qualifying : [];
  }
  if (qualifying.length === 0) return [];
  const targetSec = durationMin * 60;
  const closest = [...qualifying].sort(
    (a, b) => Math.abs(a.durationSec - targetSec) - Math.abs(b.durationSec - targetSec)
  )[0];
  if (!hasLabelHint(closest, terrain) && closest.durationSec > targetSec * TERRAIN_OVERMATCH_RATIO) return [];
  return [closest];
}

const lapMinutes = (laps: ExecutedInterval[]): number =>
  round1(laps.reduce((total, lap) => total + lap.durationSec, 0) / 60);

// VAM (vertical ascent meters/hour) — Michele Ferrari's "Velocità Ascensionale Media", an established
// cycling climbing-effort metric independent of gradient noise. Evidence-text context only (design doc
// §6) — never a scored dimension by itself. Reference points: club cyclists ~700-900 m/h, professional
// mountain-stage efforts ~1650-1800 m/h.
export function vam(elevationGainM: number, durationSec: number): number {
  return elevationGainM / (durationSec / 3600);
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

interface Verdict {
  delta: number | null;
  scored: boolean;
  measurable: boolean;
  scopeMin: number;
  evidence: string;
  matchedLaps?: ExecutedInterval[];
}

// Missing data is NEVER a failed metric (design §13): an ungraded row stays `measurable: true`,
// contributes no delta and no scope, and is still returned so the debrief can show it was acknowledged.
const ungraded = (evidence: string): Verdict => ({
  delta: null,
  scored: false,
  measurable: true,
  scopeMin: 0,
  evidence,
});

function gradeDuration(objective: ScoredObjective, evidence: RideEvidence): Verdict {
  const stated = numeric(objective.target?.durationMin);
  if (stated === null || stated <= 0) return ungraded("no duration stated");
  const pct = (evidence.durationMin / stated) * 100;
  return {
    delta: complianceDelta(pct),
    scored: true,
    measurable: true,
    // A claim about the ride's TOTAL: observing the total observes the ride.
    scopeMin: evidence.durationMin,
    evidence: `${evidence.durationMin} min ridden vs ${stated} min stated (${Math.round(pct)}% of target)`,
  };
}

function gradeZoneTime(objective: ScoredObjective, evidence: RideEvidence): Verdict {
  const stated = numeric(objective.target?.durationMin);
  if (stated === null || stated <= 0) return ungraded("no duration stated for this zone target");
  const reading = zoneMinutes(evidence, objective.target?.zone, objective.zoneBasis);
  if (!reading) return ungraded(missingZoneDataText(objective.zoneBasis, evidence.isIndoor));
  const pct = (reading.minutes / stated) * 100;
  const zone = (objective.target?.zone ?? "").toUpperCase();
  return {
    delta: complianceDelta(pct),
    scored: true,
    measurable: true,
    // Zone arrays are whole-ride aggregates — reading one reads the entire distribution.
    scopeMin: evidence.durationMin,
    evidence: `${reading.minutes.toFixed(1)} min in ${zone} vs ${stated} min stated (${Math.round(
      pct
    )}% of target; ${basisLabel(reading)})`,
  };
}

function gradeZoneEmphasis(objective: ScoredObjective, evidence: RideEvidence): Verdict {
  const reading = zoneMinutes(evidence, objective.target?.zone, objective.zoneBasis);
  if (!reading) return ungraded(missingZoneDataText(objective.zoneBasis, evidence.isIndoor));
  const zone = (objective.target?.zone ?? "").toUpperCase();
  return {
    delta: emphasisDelta(reading.sharePct),
    scored: true,
    measurable: true,
    scopeMin: evidence.durationMin,
    evidence: `${zone} was ${Math.round(reading.sharePct)}% of zone time (${reading.minutes.toFixed(
      1
    )} of ${reading.totalMinutes.toFixed(1)} min; ${basisLabel(reading)})`,
  };
}

function gradeHrCeiling(matched: ExecutedInterval[], scopeMin: number, ceilingBpm: number): Verdict {
  const withHr = matched.filter((lap) => lap.avgHr != null || lap.maxHr != null);
  if (withHr.length === 0) {
    return {
      delta: 1,
      scored: true,
      measurable: true,
      scopeMin,
      evidence: `${matched.length} matching lap${matched.length === 1 ? "" : "s"} (no HR recorded on them, graded on presence)`,
    };
  }
  const peakHr = Math.max(...withHr.map((lap) => lap.maxHr ?? lap.avgHr ?? 0));
  const vi = viEvidenceText(matched);
  return {
    delta: hrCeilingDelta(peakHr, ceilingBpm),
    scored: true,
    measurable: true,
    scopeMin,
    evidence: `${matched.length} matching lap${matched.length === 1 ? "" : "s"}, peak HR ${Math.round(peakHr)} vs ${ceilingBpm} bpm ceiling${vi ? `, ${vi}` : ""}`,
  };
}

function gradeCadenceTarget(matched: ExecutedInterval[], scopeMin: number, targetRpm: number): Verdict {
  const withCadence = matched.filter((lap) => lap.avgCadenceRpm != null);
  if (withCadence.length === 0) {
    return {
      delta: 1,
      scored: true,
      measurable: true,
      scopeMin,
      evidence: `${matched.length} matching lap${matched.length === 1 ? "" : "s"} (no cadence recorded on them, graded on presence)`,
    };
  }
  const meanCadence = withCadence.reduce((sum, lap) => sum + (lap.avgCadenceRpm ?? 0), 0) / withCadence.length;
  const pct = (meanCadence / targetRpm) * 100;
  const vi = viEvidenceText(matched);
  return {
    delta: adherenceDelta(pct),
    scored: true,
    measurable: true,
    scopeMin,
    evidence: `${matched.length} matching lap${matched.length === 1 ? "" : "s"} averaging ${Math.round(meanCadence)} rpm vs ${targetRpm} rpm target (${Math.round(pct)}% adherence)${vi ? `, ${vi}` : ""}`,
  };
}

function gradeWholeRideHrCeiling(evidence: RideEvidence, ceilingBpm: number): Verdict {
  if (evidence.wholeRideMaxHr == null) {
    return ungraded("no HR recorded for the ride (whole-ride ceiling claim, no evidence to grade)");
  }
  return {
    delta: hrCeilingDelta(evidence.wholeRideMaxHr, ceilingBpm),
    scored: true,
    measurable: true,
    scopeMin: evidence.durationMin,
    evidence: `whole ride, peak HR ${Math.round(evidence.wholeRideMaxHr)} vs ${ceilingBpm} bpm ceiling`,
  };
}

function gradeWholeRideCadence(evidence: RideEvidence, targetRpm: number): Verdict {
  if (evidence.wholeRideAvgCadence == null) {
    return ungraded("no cadence recorded for the ride (whole-ride target, no evidence to grade)");
  }
  const pct = (evidence.wholeRideAvgCadence / targetRpm) * 100;
  return {
    delta: adherenceDelta(pct),
    scored: true,
    measurable: true,
    scopeMin: evidence.durationMin,
    evidence: `whole ride averaged ${Math.round(evidence.wholeRideAvgCadence)} rpm vs ${targetRpm} rpm target (${Math.round(pct)}% adherence)`,
  };
}

function gradeEffort(objective: ScoredObjective, evidence: RideEvidence, pool: ExecutedInterval[]): Verdict {
  const target = objective.target ?? {};
  const stated = numeric(target.durationMin);
  const noDuration = stated === null || stated <= 0;
  const wholeRideShaped = noDuration || target.zone !== undefined;
  if (wholeRideShaped && target.targetHrBpm != null) return gradeWholeRideHrCeiling(evidence, target.targetHrBpm);
  if (wholeRideShaped && target.targetCadenceRpm != null) return gradeWholeRideCadence(evidence, target.targetCadenceRpm);
  if (noDuration) return ungraded("no duration stated for this effort");

  // Checked before the lap data, because an unresolvable percentage is a defect in the CLAIM rather
  // than in the evidence: the target cannot even be expressed.
  const resolvedWatts = resolveTargetWatts(target, evidence.ftpUsed);
  if (resolvedWatts === null && numeric(target.targetPctFtp) !== null) {
    return ungraded("no FTP anchor for the stated %");
  }
  if (pool.length === 0) return ungraded("no interval data");

  const reps = Math.max(1, Math.round(numeric(target.reps) ?? 1));
  const required = Math.ceil(0.75 * reps);
  const matched = matchLaps(target, pool, resolvedWatts);
  const scopeMin = lapMinutes(matched);

  if (matched.length < required) {
    return {
      // A curated lap set with no effort of the stated length is a real finding, not missing data.
      delta: -1,
      scored: true,
      measurable: true,
      scopeMin,
      evidence:
        reps > 1
          ? `only ${matched.length} of ${reps} laps matched the stated ${stated} min effort`
          : `no lap within +-20% of the stated ${stated} min effort`,
      matchedLaps: matched,
    };
  }

  if (target.targetHrBpm != null) return gradeHrCeiling(matched, scopeMin, target.targetHrBpm);
  if (target.targetCadenceRpm != null) return gradeCadenceTarget(matched, scopeMin, target.targetCadenceRpm);

  const withPower = matched.filter((lap) => lap.avgWatts != null && lap.avgWatts > 0);
  if (resolvedWatts !== null && withPower.length > 0) {
    const meanWatts = withPower.reduce((sum, lap) => sum + (lap.avgWatts ?? 0), 0) / withPower.length;
    const pct = (meanWatts / resolvedWatts) * 100;
    const shown = Math.round(meanWatts);
    return {
      delta: adherenceDelta(pct),
      scored: true,
      measurable: true,
      // Genuinely local evidence: a 9-min lap says nothing about the other 109 minutes.
      scopeMin,
      evidence:
        reps > 1
          ? `${matched.length} laps averaging ${shown} W vs ${resolvedWatts} W target (${Math.round(
              pct
            )}% adherence)`
          : `${scopeMin.toFixed(1)} min lap at ${shown} W vs ${resolvedWatts} W target (${Math.round(
              pct
            )}% adherence)`,
      matchedLaps: matched,
    };
  }

  const noPower = resolvedWatts !== null;
  return {
    delta: 1,
    scored: true,
    measurable: true,
    scopeMin,
    evidence: `${matched.length} matching lap${matched.length === 1 ? "" : "s"} totalling ${scopeMin.toFixed(
      1
    )} min${noPower ? " (no power recorded on them, graded on presence)" : ""}`,
    matchedLaps: matched,
  };
}

// REWARD-ONLY, and graded from the only ordered evidence this module has: the start indices of the
// laps its efforts matched. Zone arrays carry no timestamps, so they can say nothing about order. With
// fewer than two ordered efforts there is no evidence either way, which is `scored: false` rather than
// a zero — and either way `structure` carries a scope of 0, because it re-describes objectives that
// are already counted and must never be able to carry the gate on its own.
function gradeStructure(effortStartIndices: (number | null)[] | undefined): Verdict {
  const ordered = (effortStartIndices ?? []).filter((index): index is number => index !== null);
  if (!effortStartIndices || ordered.length < 2 || ordered.length !== effortStartIndices.length) {
    return { ...ungraded("no ordered evidence (fewer than two matched efforts)"), scopeMin: 0 };
  }
  const inOrder = ordered.every((index, position) => position === 0 || index > ordered[position - 1]);
  return {
    delta: inOrder ? 1 : 0,
    scored: true,
    measurable: true,
    scopeMin: 0,
    evidence: inOrder
      ? "the matched efforts occurred in the stated order"
      : "the matched efforts did not occur in the stated order (no penalty — the parse may have mis-ordered the note)",
  };
}

// R11 fix (2026-08-12, second review round): VI (npWatts / avgWatts) rides along as evidence text only
// on any matched lap (design doc §8) — never a scored dimension, purely context on how steady vs surgy
// the effort was, independent of whichever field actually drove the match/grade. Computed from the
// PRIMARY (first) matched lap only — VI is inherently a per-effort ratio; this file doesn't invent a
// multi-lap aggregation formula for it (same "no fabricated formula" discipline as elsewhere here).
// Shared by gradeTerrain (below) and Task 8's gradeHrCeiling/gradeCadenceTarget — the three matched-lap
// grading functions Phase 3b adds. Whole-ride grading has no matched lap, so it's out of scope there.
function viEvidenceText(matched: ExecutedInterval[]): string | null {
  const primary = matched[0];
  if (!primary || primary.avgWatts == null || primary.avgWatts <= 0 || primary.npWatts == null) return null;
  return `VI ${(primary.npWatts / primary.avgWatts).toFixed(2)}`;
}

// Existence + duration compliance ONLY — never a quality/technique grade (design doc §15's non-goal on
// descending/cornering skill). `matchLaps` (Task 6) does the label-first/gradient-fallback selection;
// this function only grades what it returns.
function gradeTerrain(objective: ScoredObjective, pool: ExecutedInterval[]): Verdict {
  const target = objective.target ?? {};
  const terrain = target.terrain;
  if (!terrain) return ungraded("no terrain stated");
  if (pool.length === 0) return ungraded("no interval data");

  const matched = matchLaps(target, pool);
  if (matched.length === 0) {
    return { delta: null, scored: false, measurable: true, scopeMin: 0, evidence: `no ${terrain} found in the curated intervals` };
  }

  const scopeMin = lapMinutes(matched);
  const primary = matched[0];
  // R6 fix (2026-08-12): must check that the label actually mentions THIS terrain, not merely that
  // `primary.label` is non-empty — a gradient-matched lap (guaranteed to not label-match, since
  // filterByTerrain prefers label matches first) can still carry an unrelated label like "Tempo 1".
  const labelled = hasLabelHint(primary, terrain);
  const contextParts = [
    primary.avgGradientPct != null ? `avg ${primary.avgGradientPct.toFixed(1)}%` : null,
    primary.maxGradientPct != null ? `max ${primary.maxGradientPct.toFixed(1)}%` : null,
    // R4 fix (2026-08-12): VAM is an ascent-rate metric; elevationGainM is a gross positive-only
    // accumulation, near-meaningless on a genuine descent lap. Climb evidence only.
    terrain === "climb" && primary.elevationGainM != null && primary.durationSec > 0
      ? `VAM ${Math.round(vam(primary.elevationGainM, primary.durationSec))} m/h`
      : null,
    viEvidenceText(matched), // R11 fix — climb AND descent both get VI, unlike VAM above
  ].filter((part): part is string => part !== null);
  const context = contextParts.length > 0 ? ` — ${contextParts.join(", ")}` : "";
  const source = labelled ? "labelled" : "matched by gradient";

  const stated = numeric(target.durationMin);
  if (stated === null || stated <= 0) {
    return {
      delta: 1,
      scored: true,
      measurable: true,
      scopeMin,
      evidence: `${scopeMin.toFixed(1)} min ${terrain} (${source})${context}`,
      matchedLaps: matched,
    };
  }
  const pct = (scopeMin / stated) * 100;
  return {
    delta: complianceDelta(pct),
    scored: true,
    measurable: true,
    scopeMin,
    evidence: `${scopeMin.toFixed(1)} min ${terrain} vs ${stated} min stated (${source})${context}`,
    matchedLaps: matched,
  };
}

export function gradeObjective(
  objective: ScoredObjective,
  evidence: RideEvidence,
  context: GradeContext = {}
): GradeResult {
  const pool = context.laps ?? evidence.laps;
  let verdict: Verdict;
  switch (objective.kind) {
    case "duration":
      verdict = gradeDuration(objective, evidence);
      break;
    case "zone-time":
      verdict = gradeZoneTime(objective, evidence);
      break;
    case "zone-emphasis":
      verdict = gradeZoneEmphasis(objective, evidence);
      break;
    case "effort":
      verdict = gradeEffort(objective, evidence, pool);
      break;
    case "structure":
      verdict = gradeStructure(context.effortStartIndices);
      break;
    case "terrain":
      verdict = gradeTerrain(objective, pool);
      break;
    case "qualitative":
      verdict = {
        delta: null,
        scored: false,
        // The one kind that is NOT measurable: sensors cannot establish that cornering was good
        // (design §6). A flat evidence-string list could not express "acknowledged but not graded".
        measurable: false,
        scopeMin: 0,
        evidence: "acknowledged; no sensor can establish skill quality",
      };
      break;
  }

  const text = [context.carriedEvidence, verdict.evidence].filter(Boolean).join("; ");
  return {
    objective: {
      ...objective,
      measurable: verdict.measurable,
      scored: verdict.scored,
      scopeMin: verdict.scopeMin,
      evidence: text,
    },
    delta: verdict.delta,
    matchedLaps: verdict.matchedLaps ?? [],
  };
}

// The MAXIMUM across objectives, never a union — see the module header.
export function evidenceScope(objectives: ScoredObjective[]): number {
  return objectives.reduce((max, objective) => Math.max(max, objective.scopeMin ?? 0), 0);
}

// ---------------------------------------------------------------------------
// The scoreability gate
// ---------------------------------------------------------------------------

// Predicate (a), semantic grounding, plus predicate (b), kind eligibility by confidence.
//
// When `note` is supplied, grounding is RE-VERIFIED against it. `verifyGrounding` can only ever lower
// the model's own claim (it returns false whenever `grounded` is false), so supplying a note is always
// a narrowing — which is what makes the monotonicity property hold in both call shapes. An objective
// with no numeric target has nothing for the field matchers to verify: `structure`'s claim is ordinal
// and has no unit-bearing token, and every other target-less kind is ungradable regardless.
export function gradableObjectives(
  objectives: ScoredObjective[],
  confidence: IntentConfidence,
  note?: string
): ScoredObjective[] {
  const kinds = GRADABLE_KINDS_BY_CONFIDENCE[confidence];
  return objectives.filter((objective) => {
    if (!kinds.includes(objective.kind)) return false;
    if (!objective.grounded) return false;
    if (note === undefined || objective.target === null) return true;
    return verifyGrounding(objective, note);
  });
}

// Predicate (c): at least one gradable objective, and evidence that speaks about enough of the ride.
// Confidence is consulted FIRST only to veto — it can never promote.
export function assessScoreability(input: {
  confidence: IntentConfidence;
  gradableCount: number;
  scopeMin: number;
  rideMin: number;
}): { scoreable: boolean; reason: NotScoredReason | null; requiredScopeMin: number } {
  const requiredScopeMin = Math.max(INTENT_MIN_SCOPE_MIN, INTENT_SCOPE_MIN_FRACTION * input.rideMin);
  if (input.confidence === "low") return { scoreable: false, reason: "intent-unreliable", requiredScopeMin };
  if (input.gradableCount < 1) {
    return { scoreable: false, reason: "no-measurable-objectives", requiredScopeMin };
  }
  if (input.scopeMin < requiredScopeMin) {
    return { scoreable: false, reason: "no-measurable-objectives", requiredScopeMin };
  }
  return { scoreable: true, reason: null, requiredScopeMin };
}

// ---------------------------------------------------------------------------
// The scorer
// ---------------------------------------------------------------------------

function acknowledge(objective: ScoredObjective, why: string): ScoredObjective {
  return {
    ...objective,
    measurable: objective.kind !== "qualitative",
    scored: false,
    scopeMin: 0,
    evidence: why,
  };
}

// Baseline 5, one clamped contribution per kind (the MEAN of that kind's canonical members' deltas,
// rounded, then clamped to that kind's band), summed and clamped to 1-10. Ungraded members are absent
// from the mean entirely — never a zero in the denominator — so an objective the data could not speak
// to changes the score by exactly nothing, as if it had not been stated.
//
// `note`, when supplied, re-verifies grounding against the athlete's own text. The runner passes it;
// omitting it trusts `objective.grounded` as the caller already lowered it.
export function scoreIntentExecution(
  interpretation: IntentInterpretation,
  evidence: RideEvidence,
  note?: string
): IntentVerdict {
  const all = interpretation.objectives;
  const gradable = gradableObjectives(all, interpretation.confidence, note);
  const canonical = canonicalise(gradable);
  const carried = new Map(canonical.map((objective) => [objective, objective.evidence]));

  // Efforts are matched LONGEST TARGET FIRST, and a lap is consumed once matched, so two efforts can
  // never both claim it. The stated order is preserved separately for `structure`.
  const efforts = canonical.filter((objective) => objective.kind === "effort");
  const byLongest = [...efforts].sort(
    (a, b) => (numeric(b.target?.durationMin) ?? 0) - (numeric(a.target?.durationMin) ?? 0)
  );
  const pool = [...evidence.laps];
  const graded = new Map<ScoredObjective, GradeResult>();
  for (const objective of byLongest) {
    const result = gradeObjective(objective, evidence, {
      laps: pool,
      carriedEvidence: carried.get(objective),
    });
    graded.set(objective, result);
    for (const lap of result.matchedLaps) {
      const index = pool.indexOf(lap);
      if (index >= 0) pool.splice(index, 1);
    }
  }
  const effortStartIndices = efforts.map((objective) => {
    const matched = graded.get(objective)?.matchedLaps ?? [];
    return matched.length === 0 ? null : Math.min(...matched.map((lap) => lap.startIndex ?? Number.NaN));
  });
  const orderedEvidence = effortStartIndices.map((index) =>
    index === null || Number.isNaN(index) ? null : index
  );

  const results: GradeResult[] = [];
  for (const objective of canonical) {
    const already = graded.get(objective);
    results.push(
      already ??
        gradeObjective(objective, evidence, {
          laps: pool,
          effortStartIndices: orderedEvidence,
          carriedEvidence: carried.get(objective),
        })
    );
  }

  const objectives = results.map((result) => result.objective);
  const scopeMin = evidenceScope(objectives);
  const assessed = assessScoreability({
    confidence: interpretation.confidence,
    gradableCount: gradable.length,
    scopeMin,
    rideMin: evidence.durationMin,
  });
  // assessScoreability's "no-measurable-objectives" conflates two different situations: real objectives
  // that simply aren't verifiable from the ride data (its documented contract — genuinely self-directed),
  // and zero objectives extracted at all (nothing about training intent was recovered — unspecified).
  // Only override the latter; a real-but-ungradable objective keeps self-directed exactly as before
  // (PR #35 review finding N2, 2026-08-12).
  const { scoreable, requiredScopeMin } = assessed;
  const reason =
    assessed.reason === "no-measurable-objectives" && interpretation.objectives.length === 0
      ? "intent-unreliable"
      : assessed.reason;

  // Stage 4 — bounded aggregation.
  let total = 5;
  for (const kind of Object.keys(KIND_BAND) as ObjectiveKind[]) {
    const deltas = results
      .filter((result) => result.objective.kind === kind && result.delta !== null)
      .map((result) => result.delta as number);
    if (deltas.length === 0) continue;
    const mean = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
    const band = KIND_BAND[kind];
    total += clamp(roundSymmetric(mean), band.min, band.max);
  }

  // Every objective that never reached grading is still returned, so 2c can show it was acknowledged.
  const canonicalSet = new Set(gradable);
  const acknowledged = all
    .filter((objective) => !canonicalSet.has(objective))
    .map((objective) =>
      acknowledge(
        objective,
        objective.kind === "qualitative"
          ? "acknowledged; no sensor can establish skill quality"
          : !objective.grounded || (note !== undefined && objective.target !== null && !verifyGrounding(objective, note))
            ? "not grounded in the note"
            : `not graded at ${interpretation.confidence} confidence`
      )
    );

  return {
    score: scoreable ? clamp(total, 1, 10) : null,
    reason,
    objectives: [...objectives, ...acknowledged],
    scopeMin,
    scopeRequiredMin: requiredScopeMin,
  };
}

// ---------------------------------------------------------------------------
// The stated workout type
// ---------------------------------------------------------------------------

const PURPOSE_PATTERNS: Array<{ pattern: RegExp; type: WorkoutType }> = [
  { pattern: /\b(?:gym|strength|weights|lifting)\b/i, type: "Strength" },
  { pattern: /\b(?:sprint|anaerobic|neuromuscular|sit)\b/i, type: "SIT" },
  { pattern: /\bvo2\s*max\b|\bvo2\b/i, type: "VO2max" },
  { pattern: /\b(?:threshold|sweet\s*spot|sweetspot|ftp)\b/i, type: "Threshold" },
  { pattern: /\b(?:race|simulation|group\s*ride|kom)\b/i, type: "RaceSim" },
  { pattern: /\b(?:recovery|easy\s*spin|shake\s*out)\b/i, type: "Recovery" },
  { pattern: /\b(?:endurance|aerobic|base|zone\s*2|z2|long\s*ride)\b/i, type: "Z2" },
  { pattern: /\brest\b/i, type: "Rest" },
];

const ZONE_TYPES: Record<number, WorkoutType> = { 1: "Recovery", 2: "Z2", 3: "Z2", 4: "Threshold", 5: "VO2max", 6: "SIT", 7: "SIT" };

// Derived from the STATED purpose and zones — never from ride intensity, the circularity INVARIANTS
// 35/40 exist to prevent. The signature takes only a `StructuredIntent`, so consulting a ride metric
// here is UNEXPRESSIBLE rather than merely avoided.
//
// Provenance only in Phase 2b: per-type learning stays prescribed-only (INVARIANT 40) until the two
// 1-10 score populations are shown comparable on a real corpus AND compliance gains a meaning for
// rides that have none.
export function intentWorkoutType(intent: StructuredIntent): WorkoutType | null {
  const purpose = intent.primaryPurpose ?? "";
  for (const { pattern, type } of PURPOSE_PATTERNS) {
    if (pattern.test(purpose)) return type;
  }
  const zones = (intent.phases ?? [])
    .map((phase) => zoneIndex(phase.targetZone))
    .filter((index): index is number => index !== null)
    .map((index) => index + 1);
  if (zones.length === 0) return null;
  return ZONE_TYPES[Math.max(...zones)] ?? null;
}

// ---------------------------------------------------------------------------
// The overlay producer
// ---------------------------------------------------------------------------

interface BuildOverlayBase {
  id: string;
  activityId: string;
  date: string; // YYYY-MM-DD
  noteFingerprint: string;
  createdAt: string; // ISO
  status?: OverlayStatus; // defaults to "active"
}

// A discriminated union, so the five outcome rows are enforced by the type rather than by a runtime
// check a caller could skip: either a verdict came out of the scorer, or a deterministic reason was
// decided without one. `intent-unreliable` arrives through the VERDICT arm (the scorer returns it for
// `low` confidence), which is what keeps the interpretation attempt on the record (design §5.3).
export type BuildOverlayInput = BuildOverlayBase &
  (
    | { interpretation: IntentInterpretation; verdict: IntentVerdict; reason?: never; parseFailure?: never }
    | { interpretation?: null; verdict?: never; reason: "no-intent-found"; parseFailure?: never }
    // NV-10: `interpreter-failed` alone is required to carry its diagnosis — enforced by the type
    // (not a runtime check a caller could skip), matching this union's existing "producer can't
    // build an incoherent row" discipline.
    | { interpretation?: null; verdict?: never; reason: "interpreter-failed"; parseFailure: IntentParseFailure | null }
  );

// The producer half of the contract `isApplicable` (lib/intent-overlay.ts) consumes. Every row this
// emits must round-trip through that consumer and be ACCEPTED — a producer emitting records its own
// consumer rejects is the Phase 2a defect shape, so the test asserts it directly rather than describing
// it.
export function buildOverlay(input: BuildOverlayInput): IntentOverlay {
  const score = input.verdict ? input.verdict.score : null;
  const reason = input.verdict ? input.verdict.reason : input.reason;

  // Only `no-measurable-objectives` pairs with `self-directed`: there the intent WAS clear and the
  // ride data simply could not verify it. The other three reasons all mean no trustworthy intent was
  // recovered, which IS the definition of `unspecified`.
  const selfDirected = score !== null || reason === "no-measurable-objectives";

  const interpretation = input.interpretation
    ? { ...input.interpretation, objectives: input.verdict.objectives }
    : null;

  return {
    id: input.id,
    activityId: input.activityId,
    date: input.date,
    noteFingerprint: input.noteFingerprint,
    status: input.status ?? "active",
    origin: selfDirected ? "self-directed" : "unspecified",
    effectiveExecutionScore: score,
    notScoredReason: reason ?? null,
    // Spread-ready: absent (not just null) when there's no diagnosis to record — mirrors this
    // codebase's `{}`-when-inapplicable stamp convention (lib/score-log.ts).
    ...(input.reason === "interpreter-failed" && input.parseFailure ? { parseFailure: input.parseFailure } : {}),
    interpretation,
    scoringVersion: score === null ? null : INTENT_SCORING_VERSION,
    // Provenance only, and only where an intent was actually recovered — a type asserted alongside
    // `unspecified` would have been derived from nothing.
    effectiveWorkoutType: selfDirected && interpretation ? intentWorkoutType(interpretation.intent) : null,
    schemaVersion: OVERLAY_SCHEMA_VERSION,
    createdAt: input.createdAt,
    approvedAt: null,
    supersededBy: null,
  };
}
