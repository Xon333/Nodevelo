// Parse a planned day's workout (Intervals.icu step syntax) into the structured work
// intervals the coach prescribed — the "second brain" intent that execution is judged
// against. Only deliberate efforts (≥ sweet-spot) are kept; warmups, recovery valves
// and endurance steps are ignored, so an endurance ride yields an empty prescription.
// Exclusion is two-layered: steps lexically under a Warmup/Cooldown label are dropped
// outright (a priming ramp to 80–85% is prep, not a rep), and everything else is
// filtered by the %FTP work floor.

import { DEFAULT_DURABILITY_INSERT_ENVELOPE } from "./calibration";
import type { PlannedDay, PrescribedInterval } from "./types";

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
  const re = /(\d+)\s*(?:-\s*(\d+))?\s*%/g;
  const steps: Array<{ durationSec: number; pct: number }> = [];
  let cursor = 0;
  let pm: RegExpExecArray | null;
  while ((pm = re.exec(line)) !== null) {
    const pct = pm[2] ? Math.max(Number(pm[1]), Number(pm[2])) : Number(pm[1]);
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
// Shared line-iteration state machine: walks a workout's step lines, expanding "Nx" repeat blocks
// in order (matching Intervals.icu's own step semantics — a repeat header repeats the WHOLE
// following block N times, not each step in place). `keep` decides whether a given step (with its
// section-excluded flag) counts at all — parsePrescription excludes warmup/cooldown sections and
// sub-work-floor steps; totalPrescribedMinutes below keeps everything, matching how Intervals.icu's
// own parser computes real ride duration (it does not distinguish warmup from work).
function walkWorkoutSteps(
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
