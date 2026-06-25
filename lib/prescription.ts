// Parse a planned day's workout (Intervals.icu step syntax) into the structured work
// intervals the coach prescribed — the "second brain" intent that execution is judged
// against. Only deliberate efforts (≥ sweet-spot) are kept; warmups, recovery valves
// and endurance steps are ignored, so an endurance ride yields an empty prescription.

import { DEFAULT_DURABILITY_INSERT_ENVELOPE } from "./calibration";
import type { PrescribedInterval } from "./types";

const WORK_THRESHOLD_PCT = 80;

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

// One "- …" step → its duration and power %. Ramps ("50-70%") use the upper bound.
function parseStep(line: string): { durationSec: number; pct: number } | null {
  const pm = line.match(/(\d+)\s*(?:-\s*(\d+))?\s*%/);
  if (!pm) return null;
  const pct = pm[2] ? Math.max(Number(pm[1]), Number(pm[2])) : Number(pm[1]);
  const durationSec = durationToSec(line.slice(0, pm.index));
  if (durationSec <= 0) return null;
  return { durationSec, pct };
}

// Real-duration label: sub-minute → "30s", exact minutes → "20m", mixed → "1m30s".
// (A naive round(sec/60) turns 30s into "1m" because 0.5 rounds up.)
function durLabel(s: number): string {
  return s < 60 ? `${s}s` : s % 60 === 0 ? `${s / 60}m` : `${Math.floor(s / 60)}m${s % 60}s`;
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

export function parsePrescription(workoutText: string, ftp: number): PrescribedInterval[] {
  if (!workoutText) return [];

  // A repeat header ("Main Set 3x" / "3x") repeats the whole FOLLOWING block of work steps N times in
  // sequence — NOT each step N times in place. The old per-step expansion turned an over-under block
  // [O,U,O,U] into [O,O,…,U,U,…], so the order-based interval matcher (lib/interval-match.ts) compared
  // every executed rep against the wrong target — deflating unders, inflating overs, and inventing
  // "cut short" reps on a perfectly-ridden session. So: expand the block in order first, into one
  // entry per rep; collapse only CONSECUTIVE-identical reps afterwards for a compact label (matching is
  // unaffected — identical reps flatten to the same sequence whether stored as N×reps:1 or 1×reps:N).
  type Work = { durationSec: number; pct: number; targetWatts: number };
  const expanded: Work[] = [];
  let block: Work[] = [];
  let blockReps = 1;
  const flush = () => {
    for (let r = 0; r < blockReps; r++) expanded.push(...block);
    block = [];
    blockReps = 1;
  };

  for (const raw of workoutText.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      flush(); // blank line ends a repeat block
      continue;
    }
    if (!line.startsWith("-")) {
      flush(); // a new section label ends the previous block before reading its repeat count
      const rx = line.match(/(\d+)\s*x/i);
      blockReps = rx ? Math.max(1, Number(rx[1])) : 1;
      continue;
    }
    const step = parseStep(line);
    if (!step || step.pct < WORK_THRESHOLD_PCT) continue; // warmups/recovery valves/endurance dropped
    block.push({
      durationSec: step.durationSec,
      pct: step.pct,
      targetWatts: ftp > 0 ? Math.round((step.pct / 100) * ftp) : 0,
    });
  }
  flush(); // trailing block at EOF

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
    iv.label = `${iv.reps > 1 ? `${iv.reps}×` : ""}${durLabel(iv.durationSec)} @ ${iv.targetWatts}W`;
  }
  return out;
}
