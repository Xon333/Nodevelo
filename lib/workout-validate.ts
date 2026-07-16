// KB-grounded workout-protocol validation. Run at generation time so a workout that
// contradicts the knowledge base — e.g. SIT prescribed as 1-min efforts, or below the maximal
// intensity floor — is flagged BEFORE it reaches the calendar. That keeps the plan and the live
// session describing the same thing, which is the root of plan-vs-detection mismatch (the
// matcher otherwise judges a correctly-ridden session against a wrong prescription).
//
// Deterministic: emits warnings only, never silently rewrites the coach's intent. Bands are
// deliberately lenient (a tolerance past the KB edges) so only clear violations fire — false
// warnings cause data fatigue. Sources: training_knowledge.md §4 (SIT: 4–6×30s all-out at
// 130–200% FTP, 4-min recovery) and cycling_database.md (Z5 VO2max 106–120%, 3–8 min efforts;
// Z4 Threshold 91–105%; sweet spot 88–93%).

import type { PlannedDay, WorkoutType } from "./types";
import { parsePrescription, totalPrescribedMinutes } from "./prescription";
import { DEFAULT_DURABILITY_INSERT_ENVELOPE, type DurabilityInsertEnvelope } from "./calibration";

export interface ProtocolRule {
  maxEffortSec?: number; // longest a single work effort should run
  minEffortSec?: number; // shortest
  minIntensityPct?: number; // floor for a work step's %FTP
  maxIntensityPct?: number; // ceiling
  cite: string; // KB reference, surfaced in the warning
}

// Only the structured "quality" types carry a protocol worth validating; Z2/Recovery/Strength/
// Rest have no fixed interval shape. Bands include tolerance past the KB edges. Exported as the
// single source of truth for lib/session-level.ts's within-type band normalisation.
export const PROTOCOL: Partial<Record<WorkoutType, ProtocolRule>> = {
  SIT: { maxEffortSec: 45, minIntensityPct: 130, cite: "KB training §4: SIT is 4–6×30s all-out at 130–200% FTP" },
  VO2max: { minEffortSec: 90, maxEffortSec: 600, minIntensityPct: 100, maxIntensityPct: 130, cite: "KB database Z5: VO2max is 3–8 min at 106–120% FTP" },
  Threshold: { minIntensityPct: 80, maxIntensityPct: 115, cite: "KB database Z4: threshold/sweet-spot is 88–105% FTP" },
};

// Tolerance: the greater of 15% relative or 8 minutes absolute, whichever is more lenient — small
// rounding/estimation gaps are normal and must not fire on every session; a 30+ minute real-world
// gap on a stated 90-minute session (found live, 2026-07-16) must.
function durationTolerance(statedMin: number): number {
  return Math.max(statedMin * 0.15, 8);
}

// Real prescribed total vs. stated duration — the SAME number Intervals.icu's own step-parser will
// compute and display, since Ride-category events never set an explicit moving_time (lib/plan-
// parser.ts). A mismatch here is exactly why NodeVelo's own weekly-hours totals can disagree with
// what the athlete's calendar actually shows. null when the day has no workoutText or the gap is
// within tolerance.
export function validateDurationConsistency(day: PlannedDay): string | null {
  if (!day.workoutText) return null;
  // Strength sessions get an explicit moving_time written directly from durationMin (lib/plan-
  // parser.ts:40), never step-parsed. Their prose workoutText (sets/reps) has no parseable steps,
  // so don't flag the expected ~0min real total against the stated duration.
  if (day.type === "Strength") return null;
  const real = totalPrescribedMinutes(day.workoutText);
  const gap = day.durationMin - real;
  if (Math.abs(gap) <= durationTolerance(day.durationMin)) return null;
  return `DAY ${day.date} (${day.type}): stated ${day.durationMin}min but the prescribed steps only sum to ~${Math.round(real)}min — tighten the workout text or the stated duration so Intervals.icu's real displayed time matches what NodeVelo shows.`;
}

// Durability templates (KB §12) embed threshold/VO2 efforts inside an otherwise-easy ride (TYPE
// Z2/Recovery). Those inserts are invisible to the per-type rules above, so validate the genuinely-
// hard ones (≥ the envelope's embeddedHardPct) against the threshold∪VO2 envelope — a supra-VO2 or
// marathon insert is malformed, but intended threshold/VO2 work passes. The envelope (floor / %FTP
// ceiling / max duration) is the calibration-framework population default, overridable per athlete.
const ENDURANCE_TYPES = new Set<WorkoutType>(["Z2", "Recovery"]);
const DURABILITY_CITE = "KB training §12: durability inserts are threshold/VO2 efforts (≤~120% FTP, ≤~20 min)";

function fmtDur(sec: number): string {
  return sec >= 60 ? `${Math.round(sec / 60)}m` : `${sec}s`;
}

// Validate one planned day's work efforts against its type's KB protocol. Returns a (possibly
// empty) list of human-readable warnings — never throws, never mutates.
export function validateWorkoutProtocol(
  day: PlannedDay,
  ftp: number,
  envelope: DurabilityInsertEnvelope = DEFAULT_DURABILITY_INSERT_ENVELOPE
): string[] {
  if (!day.workoutText) return [];
  // parsePrescription returns only the deliberate work efforts: steps under a Warmup/Cooldown
  // label are dropped outright (a priming ramp at 80–85% is prep, not a rep), and the rest is
  // filtered by the ≥80% FTP work floor — so we never flag warmups, valves or endurance steps.
  let steps = parsePrescription(day.workoutText, ftp);
  let rule = PROTOCOL[day.type];
  if (!rule && ENDURANCE_TYPES.has(day.type)) {
    // Endurance ride: only the hard inserts (≥ the floor) are "intensity" worth validating; a tempo
    // block or pure Z2 isn't a durability insert and shouldn't trip the per-type quality rules.
    steps = steps.filter((s) => s.targetPctFtp >= envelope.embeddedHardPct);
    rule = { maxEffortSec: envelope.maxEffortMin * 60, maxIntensityPct: envelope.maxIntensityPct, cite: DURABILITY_CITE };
  }
  if (!rule || steps.length === 0) return [];

  const warnings: string[] = [];
  for (const s of steps) {
    if (rule.maxEffortSec !== undefined && s.durationSec > rule.maxEffortSec) {
      warnings.push(`DAY ${day.date} (${day.type}): effort ${s.label} runs ${fmtDur(s.durationSec)} — longer than protocol (${rule.cite}).`);
    }
    if (rule.minEffortSec !== undefined && s.durationSec < rule.minEffortSec) {
      warnings.push(`DAY ${day.date} (${day.type}): effort ${s.label} is only ${fmtDur(s.durationSec)} — shorter than protocol (${rule.cite}).`);
    }
    if (rule.minIntensityPct !== undefined && s.targetPctFtp < rule.minIntensityPct) {
      warnings.push(`DAY ${day.date} (${day.type}): effort at ${s.targetPctFtp}% FTP is below the ${rule.minIntensityPct}% floor (${rule.cite}).`);
    }
    if (rule.maxIntensityPct !== undefined && s.targetPctFtp > rule.maxIntensityPct) {
      warnings.push(`DAY ${day.date} (${day.type}): effort at ${s.targetPctFtp}% FTP exceeds the ${rule.maxIntensityPct}% ceiling (${rule.cite}).`);
    }
  }
  return warnings;
}

// The structured quality types whose protocol findings are VIOLATIONS — a malformed session would
// be lived (and measured) against the wrong identity — vs endurance days, whose durability-insert
// findings stay advisory (the lighter touch those days already get above). RaceSim is listed for
// completeness: it has no PROTOCOL entry today, so it cannot currently produce findings.
const QUALITY_TYPES = new Set<WorkoutType>(["Threshold", "VO2max", "SIT", "RaceSim"]);

export interface ProtocolFindings {
  violations: string[]; // quality-session protocol breaches — a distinct, higher-severity category
  advisories: string[]; // endurance-day insert findings — ordinary warnings
}

// Validate a whole generated block, split by severity. The generate route folds `advisories` into
// the plan's generic warnings and carries `violations` separately (GeneratedPlan.protocolViolations)
// so the UI can render them as their own category. Replaces the old flat validatePlanProtocol.
export function splitPlanProtocol(
  days: PlannedDay[],
  ftp: number,
  envelope: DurabilityInsertEnvelope = DEFAULT_DURABILITY_INSERT_ENVELOPE
): ProtocolFindings {
  const out: ProtocolFindings = { violations: [], advisories: [] };
  for (const d of days) {
    const findings = validateWorkoutProtocol(d, ftp, envelope);
    const durationFinding = validateDurationConsistency(d);
    if (durationFinding) findings.push(durationFinding);
    if (findings.length === 0) continue;
    (QUALITY_TYPES.has(d.type) ? out.violations : out.advisories).push(...findings);
  }
  return out;
}
