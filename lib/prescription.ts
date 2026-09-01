// Parse a planned day's workout (Intervals.icu step syntax) into the structured work
// intervals the coach prescribed — the "second brain" intent that execution is judged
// against. Only deliberate efforts (≥ sweet-spot) are kept; warmups, recovery valves
// and endurance steps are ignored, so an endurance ride yields an empty prescription.
// Exclusion is two-layered: steps lexically under a Warmup/Cooldown label are dropped
// outright (a priming ramp to 80–85% is prep, not a rep), and everything else is
// filtered by the %FTP work floor.

import { DEFAULT_DURABILITY_INSERT_ENVELOPE } from "./calibration";
import type { PlannedDay, PrescribedInterval } from "./types";

export type PrescriptionTargetMode = "power" | "heartRate";
export type PrescriptionSectionName = "Warmup" | "Main Set" | "Cooldown";
export type StepRole = "warmup" | "active" | "recovery" | "cooldown";
export type StepTarget =
  | { kind: "power-percent"; minPctFtp: number; maxPctFtp: number }
  | { kind: "power-ramp"; fromPctFtp: number; toPctFtp: number }
  | { kind: "power-zone"; minZone: 1 | 2 | 3 | 4 | 5 | 6; maxZone: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: "hr-percent"; basis: "max" | "lthr"; minPct: number; maxPct: number }
  | { kind: "hr-zone"; minZone: 1 | 2 | 3 | 4 | 5; maxZone: 1 | 2 | 3 | 4 | 5 };

export interface PrescriptionStep {
  cue?: string;
  durationSec: number;
  end: "timer" | "lapButton";
  role: StepRole;
  target: StepTarget;
  hrCeilingBpm?: number;
}

export interface PrescriptionSection {
  name: PrescriptionSectionName;
  repeats: number;
  steps: PrescriptionStep[];
}

export interface CyclingPrescription {
  targetMode: PrescriptionTargetMode;
  sections: PrescriptionSection[];
}

export class PrescriptionSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrescriptionSyntaxError";
  }
}

const syntaxError = (message: string): never => {
  throw new PrescriptionSyntaxError(message);
};

const DURATION_TOKENS = String.raw`(?:\d+\s*(?:h|m|s|'|")\s*)+`;
const TARGET_TOKEN = String.raw`(?:ramp\s+)?(?:\d+(?:\.\d+)?(?:%?\s*-\s*\d+(?:\.\d+)?)?%(?:\s+(?:HR|LTHR))?(?!\w)|Z[1-6](?:\s*-\s*Z[1-6])?(?:\s+HR)?\b)`;
const DURATION_AT_END_RX = new RegExp(`(${DURATION_TOKENS})$`, "i");
const DURATION_TARGET_CLAUSE_RX = new RegExp(`${DURATION_TOKENS}${TARGET_TOKEN}`, "i");

export function assertPrescriptionValid(
  value: CyclingPrescription,
  options: { lapButtonSteps: boolean }
): void {
  if (!value.sections.length) syntaxError("Prescription must contain at least one section");

  for (const section of value.sections) {
    if (!Number.isInteger(section.repeats) || section.repeats <= 0) syntaxError("Section repeats must be positive integers");
    if (!section.steps.length) syntaxError("Prescription sections must not be empty");

    for (const step of section.steps) {
      if (step.cue !== undefined && (
        !step.cue.trim()
        || step.cue !== step.cue.trim()
        || /[\r\n]/.test(step.cue)
        || /^Press lap(?:\s|$)/i.test(step.cue)
        || /(?:^|\s)HR cap [1-9]\d*bpm$/i.test(step.cue)
        || DURATION_AT_END_RX.test(step.cue)
        || DURATION_TARGET_CLAUSE_RX.test(step.cue)
      )) syntaxError("Cue must be nonempty, trimmed, single-line, and must not use reserved lap/cap grammar");
      if (!Number.isInteger(step.durationSec) || step.durationSec <= 0) syntaxError("Step duration must be a positive integer");
      const targetMode = step.target.kind.startsWith("power-") ? "power" : "heartRate";
      if (targetMode !== value.targetMode) syntaxError("Step target does not match prescription target mode");
      if (step.target.kind === "power-ramp" && section.name === "Main Set") syntaxError("Power ramps are only valid in Warmup or Cooldown");
      if (step.hrCeilingBpm !== undefined && value.targetMode === "heartRate") syntaxError("HR-led workouts cannot carry an HR ceiling");
      if (step.hrCeilingBpm !== undefined && (!Number.isInteger(step.hrCeilingBpm) || step.hrCeilingBpm <= 0)) syntaxError("HR ceiling must be a positive integer");
      if (step.end === "lapButton" && !options.lapButtonSteps) syntaxError("Lap-button step requires lap-button capability");
      if (step.end === "lapButton" && step.role !== "warmup" && step.role !== "recovery") syntaxError("Lap-button role must be warmup or recovery");

      const range =
        step.target.kind === "power-percent" ? [step.target.minPctFtp, step.target.maxPctFtp]
        : step.target.kind === "power-ramp" ? [step.target.fromPctFtp, step.target.toPctFtp]
        : step.target.kind === "hr-percent" ? [step.target.minPct, step.target.maxPct]
        : [step.target.minZone, step.target.maxZone];
      if (range.some((part) => !Number.isFinite(part) || part <= 0) || (step.target.kind !== "power-ramp" && range[0] > range[1])) {
        syntaxError("Target range must contain positive values in ascending order");
      }
    }
  }
}

export function formatDuration(durationSec: number): string {
  if (!Number.isInteger(durationSec) || durationSec <= 0) syntaxError("Duration must be a positive integer");
  const hours = Math.floor(durationSec / 3600);
  const minutes = Math.floor((durationSec % 3600) / 60);
  const seconds = durationSec % 60;
  return `${hours ? `${hours}h` : ""}${minutes ? `${minutes}m` : ""}${seconds ? `${seconds}s` : ""}`;
}

function renderRange(min: number, max: number, suffix: string): string {
  return min === max ? `${min}${suffix}` : `${min}${suffix}-${max}${suffix}`;
}

function renderTarget(target: StepTarget): string {
  switch (target.kind) {
    case "power-percent": return renderRange(target.minPctFtp, target.maxPctFtp, "%");
    case "power-ramp": return `ramp ${renderRange(target.fromPctFtp, target.toPctFtp, "%")}`;
    case "power-zone": return renderRange(target.minZone, target.maxZone, "").replace(/(^|-)(\d)/g, "$1Z$2");
    case "hr-percent": return `${renderRange(target.minPct, target.maxPct, "%")} ${target.basis === "max" ? "HR" : "LTHR"}`;
    case "hr-zone": return `${renderRange(target.minZone, target.maxZone, "").replace(/(^|-)(\d)/g, "$1Z$2")} HR`;
  }
}

export function renderPrescription(
  prescription: CyclingPrescription,
  options: { lapButtonSteps: boolean }
): string {
  assertPrescriptionValid(prescription, options);
  return prescription.sections.map((section) => {
    const header = `${section.name}${section.repeats > 1 ? ` ${section.repeats}x` : ""}`;
    const steps = section.steps.map((step) => {
      const cueParts = [
        step.end === "lapButton" ? "Press lap" : null,
        step.cue,
        step.hrCeilingBpm ? `HR cap ${step.hrCeilingBpm}bpm` : null,
      ].filter((value): value is string => Boolean(value));
      return `- ${[...cueParts, formatDuration(step.durationSec), renderTarget(step.target), `intensity=${step.role}`].join(" ")}`;
    });
    return [header, ...steps].join("\n");
  }).join("\n\n");
}

function parseTarget(text: string): { head: string; target: StepTarget } {
  const patterns: Array<[RegExp, (match: RegExpMatchArray) => StepTarget]> = [
    [/^(.*?)\bramp\s+(\d+(?:\.\d+)?)%?\s*-\s*(\d+(?:\.\d+)?)%$/i, (m) => ({ kind: "power-ramp", fromPctFtp: Number(m[2]), toPctFtp: Number(m[3]) })],
    [/^(.*?)Z([1-5])(?:\s*-\s*Z([1-5]))?\s+HR$/i, (m) => ({ kind: "hr-zone", minZone: Number(m[2]) as 1 | 2 | 3 | 4 | 5, maxZone: Number(m[3] ?? m[2]) as 1 | 2 | 3 | 4 | 5 })],
    [/^(.*?)(\d+(?:\.\d+)?)(?:%?\s*-\s*(\d+(?:\.\d+)?))?%\s+(HR|LTHR)$/i, (m) => ({ kind: "hr-percent", basis: m[4].toUpperCase() === "HR" ? "max" : "lthr", minPct: Number(m[2]), maxPct: Number(m[3] ?? m[2]) })],
    [/^(.*?)Z([1-6])(?:\s*-\s*Z([1-6]))?$/i, (m) => ({ kind: "power-zone", minZone: Number(m[2]) as 1 | 2 | 3 | 4 | 5 | 6, maxZone: Number(m[3] ?? m[2]) as 1 | 2 | 3 | 4 | 5 | 6 })],
    [/^(.*?)(\d+(?:\.\d+)?)(?:%?\s*-\s*(\d+(?:\.\d+)?))?%$/, (m) => ({ kind: "power-percent", minPctFtp: Number(m[2]), maxPctFtp: Number(m[3] ?? m[2]) })],
  ];
  for (const [pattern, makeTarget] of patterns) {
    const match = text.match(pattern);
    if (match) return { head: match[1].trimEnd(), target: makeTarget(match) };
  }
  return syntaxError(`Step must end with exactly one supported target: ${text}`);
}

function inferRole(section: PrescriptionSectionName, target: StepTarget): StepRole {
  if (section === "Warmup") return "warmup";
  if (section === "Cooldown") return "cooldown";
  if (target.kind === "power-percent" && target.maxPctFtp < 80) return "recovery";
  if (target.kind === "hr-zone" && target.maxZone <= 2) return "recovery";
  return "active";
}

function parseRichStep(line: string, sectionName: PrescriptionSectionName): PrescriptionStep {
  let rest = line.slice(1).trim();
  let role: StepRole | undefined;
  const roleMatch = rest.match(/\s+intensity=(warmup|active|recovery|cooldown)$/i);
  if (roleMatch) {
    role = roleMatch[1].toLowerCase() as StepRole;
    rest = rest.slice(0, roleMatch.index).trimEnd();
  }

  rest = rest.replace(/\s+\d+(?:\s*-\s*\d+)?rpm$/i, "");
  const { head, target } = parseTarget(rest);
  const durationMatch = head.match(DURATION_AT_END_RX);
  if (!durationMatch) return syntaxError(`Step is missing a duration: ${line}`);
  const durationSec = durationToSec(durationMatch[1]);
  let cue = head.slice(0, durationMatch.index).trim();
  if (DURATION_TARGET_CLAUSE_RX.test(cue)) {
    syntaxError(`Step must contain exactly one target: ${line}`);
  }

  let hrCeilingBpm: number | undefined;
  const capMatch = cue.match(/(?:^|\s)HR cap ([1-9]\d*)bpm$/i);
  if (capMatch) {
    hrCeilingBpm = Number(capMatch[1]);
    cue = cue.slice(0, capMatch.index).trim();
  }

  const end = /^Press lap(?:\s|$)/i.test(cue) ? "lapButton" : "timer";
  if (end === "lapButton") cue = cue.replace(/^Press lap(?:\s+|$)/i, "").trim();
  return {
    durationSec,
    end,
    role: role ?? inferRole(sectionName, target),
    target,
    ...(cue ? { cue } : {}),
    ...(hrCeilingBpm === undefined ? {} : { hrCeilingBpm }),
  };
}

export function parseCyclingPrescription(workoutText: string): CyclingPrescription {
  const sections: PrescriptionSection[] = [];
  let current: PrescriptionSection | undefined;
  const flush = () => {
    if (current) sections.push(current);
    current = undefined;
  };

  for (const raw of workoutText.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (!line.startsWith("-")) {
      flush();
      const header = line.match(/^(Warmup|Main Set|Cooldown)(?: ([1-9]\d*)x)?$/);
      if (!header) return syntaxError(`Invalid section header: ${line}`);
      current = { name: header[1] as PrescriptionSectionName, repeats: Number(header[2] ?? 1), steps: [] };
      continue;
    }
    current ??= { name: "Main Set", repeats: 1, steps: [] };
    current.steps.push(parseRichStep(line, current.name));
  }
  flush();

  const modes = new Set(sections.flatMap((section) => section.steps.map((step) => step.target.kind.startsWith("power-") ? "power" : "heartRate")));
  if (modes.size !== 1) syntaxError(modes.size ? "Mixed target families are not supported" : "Prescription contains no steps");
  const prescription: CyclingPrescription = { targetMode: [...modes][0] as PrescriptionTargetMode, sections };
  assertPrescriptionValid(prescription, { lapButtonSteps: true });
  return prescription;
}

export function prescriptionsEqual(left: CyclingPrescription, right: CyclingPrescription): boolean {
  const targetValues = (target: StepTarget): unknown[] => {
    switch (target.kind) {
      case "power-percent": return [target.kind, target.minPctFtp, target.maxPctFtp];
      case "power-ramp": return [target.kind, target.fromPctFtp, target.toPctFtp];
      case "power-zone": return [target.kind, target.minZone, target.maxZone];
      case "hr-percent": return [target.kind, target.basis, target.minPct, target.maxPct];
      case "hr-zone": return [target.kind, target.minZone, target.maxZone];
    }
  };
  const semanticValues = (prescription: CyclingPrescription): unknown[] => [
    prescription.targetMode,
    prescription.sections.map((section) => [
      section.name,
      section.repeats,
      section.steps.map((step) => [
        step.durationSec,
        step.end,
        step.role,
        targetValues(step.target),
        step.cue ?? null,
        step.hrCeilingBpm ?? null,
      ]),
    ]),
  ];
  return JSON.stringify(semanticValues(left)) === JSON.stringify(semanticValues(right));
}

const WORK_THRESHOLD_PCT = 80;

// Section labels whose steps are never work, whatever their %FTP: a warmup's priming/build step
// at 80–85% used to clear WORK_THRESHOLD_PCT and get validated as a (malformed) main-set rep.
// Any other label ("Main Set 3x", a custom name) — and an unlabeled group after a blank line,
// which is how generated Z2/durability rides carry their main work — counts normally.
const EXCLUDED_SECTION_RX = /\b(?:warm[\s-]?up|cool[\s-]?down)\b/i;

// Seconds from the duration token(s) preceding the power %: 12m, 30s, 1h, 1h30m, 5', 30".
function durationToSec(head: string): number {
  let sec = 0;
  const h = head.match(/(\d+)\s*h/i);
  if (h) sec += Number(h[1]) * 3600;
  const m = head.match(/(\d+)\s*(?:m|')/i);
  if (m) sec += Number(m[1]) * 60;
  const s = head.match(/(\d+)\s*(?:s|")/i);
  if (s) sec += Number(s[1]);
  return sec;
}

// One "- …" step → its work clause(s). Ramps ("50-70%") use the upper bound. A line can carry MORE
// THAN ONE effort ("Seated climb 2m30s 108%, then standing attack 25s 140%") — Intervals.icu's own
// step-parser reads each duration+%FTP clause independently, so this returns every clause found on
// the line (HR-16, 2026-07-17: the old single-match version silently dropped every clause after the
// first, undercounting real duration and losing real prescribed intervals like the standing attack
// above). Each clause's duration is read from the text since the PREVIOUS clause ended (or the line
// start, for the first).
function parseStep(line: string): Array<{ durationSec: number; pct: number }> {
  const re = /(\d+(?:\.\d+)?)\s*(?:%\s*-\s*(\d+(?:\.\d+)?)|-\s*(\d+(?:\.\d+)?))?\s*%/gi;
  const steps: Array<{ durationSec: number; pct: number }> = [];
  let cursor = 0;
  let pm: RegExpExecArray | null;
  while ((pm = re.exec(line)) !== null) {
    const after = line.slice(pm.index + pm[0].length);
    if (/^\s*(?:-\s*\d+(?:\.\d+)?\s*%)?\s*(?:HR|LTHR)\b/i.test(after)) {
      cursor = pm.index + pm[0].length;
      continue;
    }
    const pct = pm[2] || pm[3] ? Math.max(Number(pm[1]), Number(pm[2] ?? pm[3])) : Number(pm[1]);
    const durationSec = durationToSec(line.slice(cursor, pm.index));
    cursor = pm.index + pm[0].length;
    if (durationSec > 0) steps.push({ durationSec, pct });
  }
  return steps;
}

// Real-duration label: sub-minute → "30s", exact minutes → "20m", mixed → "1m30s".
// (A naive round(sec/60) turns 30s into "1m" because 0.5 rounds up.)
function durLabel(s: number): string {
  return s < 60 ? `${s}s` : s % 60 === 0 ? `${s / 60}m` : `${Math.floor(s / 60)}m${s % 60}s`;
}

// Derive an interval's display label from its structural fields — the single source of truth for
// the "6×30s @ 432W" chip. Prefer this over the stored `label` string anywhere it's rendered: blocks
// generated before the durLabel fix (3801d6b) carry a stale label (30s mis-shown as "1m") even though
// their durationSec is correct, and rescheduled days copy the prescription verbatim. Deriving at the
// point of use means a stale stored string can never be trusted.
export function formatPrescriptionLabel(iv: Pick<PrescribedInterval, "reps" | "durationSec" | "targetWatts">): string {
  return `${iv.reps > 1 ? `${iv.reps}×` : ""}${durLabel(iv.durationSec)} @ ${iv.targetWatts}W`;
}

// Threshold-and-above work, distinctly past sweet-spot/tempo — what a durability template embeds
// (B threshold, C VO2) inside an otherwise-easy ride. The %FTP floor is the calibration-framework
// durability-insert envelope's `embeddedHardPct` (population default 88%); EMBEDDED_MIN_SEC is the
// separate "meaningful dose" threshold.
const EMBEDDED_MIN_SEC = 5 * 60;

// True when a ride carries a meaningful dose of threshold-or-harder work — e.g. a durability Z2 ride
// with late threshold/VO2 efforts. Lets the spacing + protocol checks stop treating such a ride as
// "easy". Sweet-spot/tempo steady rides (80–87%) and pure endurance don't trip it. `embeddedHardPct`
// defaults to the population floor; pass the athlete's resolved envelope edge to personalise it.
export function carriesEmbeddedIntensity(
  workoutText: string | undefined,
  ftp: number,
  embeddedHardPct: number = DEFAULT_DURABILITY_INSERT_ENVELOPE.embeddedHardPct
): boolean {
  if (!workoutText) return false;
  const hardSec = parsePrescription(workoutText, ftp)
    .filter((w) => w.targetPctFtp >= embeddedHardPct)
    .reduce((sum, w) => sum + w.reps * w.durationSec, 0);
  return hardSec >= EMBEDDED_MIN_SEC;
}

// HR-28 (2026-07-17 hostile review): relocated to sit directly above parsePrescription, its primary
// caller — it previously sat between carriesEmbeddedIntensity's doc comment and that function's own
// declaration, displacing it.
// Shared line-iteration state machine: walks a workout's step lines, expanding "Nx" repeat blocks
// in order (matching Intervals.icu's own step semantics — a repeat header repeats the WHOLE
// following block N times, not each step in place). `keep` decides whether a given step (with its
// section-excluded flag) counts at all — parsePrescription excludes warmup/cooldown sections and
// sub-work-floor steps; totalPrescribedMinutes below keeps everything, matching how Intervals.icu's
// own parser computes real ride duration (it does not distinguish warmup from work).
export function walkWorkoutSteps(
  workoutText: string,
  keep: (step: { durationSec: number; pct: number }, inExcludedSection: boolean) => boolean
): Array<{ durationSec: number; pct: number }> {
  if (!workoutText) return [];
  const expanded: Array<{ durationSec: number; pct: number }> = [];
  let block: Array<{ durationSec: number; pct: number }> = [];
  let blockReps = 1;
  const flush = () => {
    for (let r = 0; r < blockReps; r++) expanded.push(...block);
    block = [];
    blockReps = 1;
  };
  let inExcludedSection = false;
  for (const raw of workoutText.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      flush();
      inExcludedSection = false;
      continue;
    }
    if (!line.startsWith("-")) {
      flush();
      inExcludedSection = EXCLUDED_SECTION_RX.test(line);
      // HR-27 (2026-07-17 hostile review): a repeat count only means something for actual work sets
      // -- a malformed "Warmup 2x" header must not multiply the warmup's own minutes, since `keep`
      // for totalPrescribedMinutes keeps excluded-section steps too (unlike parsePrescription, which
      // filters them to empty before the multiplier would ever matter).
      const rx = inExcludedSection ? null : line.match(/(\d+)\s*x/i);
      blockReps = rx ? Math.max(1, Number(rx[1])) : 1;
      continue;
    }
    for (const step of parseStep(line)) {
      if (!keep(step, inExcludedSection)) continue;
      block.push(step);
    }
  }
  flush();
  return expanded;
}

export function parsePrescription(workoutText: string, ftp: number): PrescribedInterval[] {
  if (!workoutText) return [];

  // A repeat header ("Main Set 3x" / "3x") repeats the whole FOLLOWING block of work steps N times in
  // sequence — NOT each step N times in place. The old per-step expansion turned an over-under block
  // [O,U,O,U] into [O,O,…,U,U,…], so the order-based interval matcher (lib/interval-match.ts) compared
  // every executed rep against the wrong target — deflating unders, inflating overs, and inventing
  // "cut short" reps on a perfectly-ridden session. So: expand the block in order first, into one
  // entry per rep; collapse only CONSECUTIVE-identical reps afterwards for a compact label (matching is
  // unaffected — identical reps flatten to the same sequence whether stored as N×reps:1 or 1×reps:N).
  const expanded = walkWorkoutSteps(
    workoutText,
    (step, inExcludedSection) => !inExcludedSection && step.pct >= WORK_THRESHOLD_PCT
  ).map((s) => ({
    durationSec: s.durationSec,
    pct: s.pct,
    targetWatts: ftp > 0 ? Math.round((s.pct / 100) * ftp) : 0,
  }));

  // Collapse consecutive-identical efforts into reps>1 (e.g. a 5×5min VO2 block reads "5×5m", not five
  // separate chips); genuinely-varied blocks like over-unders stay one entry per rep, in order.
  const out: PrescribedInterval[] = [];
  for (const e of expanded) {
    const last = out[out.length - 1];
    if (last && last.durationSec === e.durationSec && last.targetPctFtp === e.pct && last.targetWatts === e.targetWatts) {
      last.reps += 1;
    } else {
      out.push({ reps: 1, durationSec: e.durationSec, targetPctFtp: e.pct, targetWatts: e.targetWatts, label: "" });
    }
  }
  for (const iv of out) {
    iv.label = formatPrescriptionLabel(iv);
  }
  return out;
}

// The REAL total ride duration Intervals.icu's own step-parser computes from the workout text —
// every step, every section (warmup/cooldown included), no intensity floor. This is deliberately
// the OPPOSITE filter from parsePrescription's WORK-only view; the two answer different questions
// ("what did the coach prescribe as work" vs. "how long will this ride actually run").
export function totalPrescribedMinutes(workoutText: string): number {
  const stepLines = workoutText.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("-"));
  const hasLegacyCompoundStep = stepLines.some((line) => parseStep(line).length > 1);
  if (!hasLegacyCompoundStep && stepLines.length > 0 && stepLines.every((line) => /\sintensity=(?:warmup|active|recovery|cooldown)$/i.test(line))) {
    const prescription = parseCyclingPrescription(workoutText);
    return prescription.sections.reduce(
      (total, section) => total + section.repeats * section.steps.reduce((sum, step) => sum + step.durationSec, 0),
      0
    ) / 60;
  }
  const steps = walkWorkoutSteps(workoutText, () => true);
  return steps.reduce((sum, s) => sum + s.durationSec, 0) / 60;
}

// HR-19 (2026-07-17 hostile review): lib/workout-validate.ts's validateDurationConsistency only
// WARNED when a day's stated durationMin disagreed with its real step-sum -- the mismatch still
// shipped to Intervals.icu (which derives the displayed ride time from these same steps) and to
// every NodeVelo hours total, unchanged, every time. durationMin is a derived STATISTIC of the
// workout text, not part of the coach's prescriptive intent (the steps/intensities themselves,
// which this reconciliation never touches) -- so unlike workout-validate.ts's deliberate
// warn-only stance on protocol content, making this one number agree with the text it summarises
// is a checksum fix, not a silent override of what the coach chose to prescribe. Exempt Rest (no
// workoutText) and Strength (gets an explicit moving_time from durationMin directly, lib/plan-
// parser.ts -- its prose text was never meant to be step-parsed; reconciling it would zero out a
// real strength session's duration).
export function reconcileDurationMin(days: PlannedDay[]): PlannedDay[] {
  return days.map((d) => {
    if (!d.workoutText || d.type === "Strength") return d;
    const real = Math.round(totalPrescribedMinutes(d.workoutText));
    return real === d.durationMin ? d : { ...d, durationMin: real };
  });
}
