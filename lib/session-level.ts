// Measurability (docs/superpowers/plans/2026-07-15-block-generation-measurability.md): derive a
// stable, comparable difficulty stamp for a generated session from its parsed prescription. The LLM
// writes each block's intervals freehand, so two Threshold sessions in different blocks share no
// stable identity — this composite gives retrospectives an apples-to-apples number without moving
// to a curated workout library. Pure + deterministic: same prescription in, same stamp out,
// whichever block or prompt produced it.
//
// score        = total work minutes × (duration-weighted avg %FTP / 100) — intensity-weighted dose.
// bandPosition = where the avg intensity sits inside the type's KB protocol band (0 = floor,
//                1 = ceiling) — the within-type normalisation the PROTOCOL table already implies.
//                null for types without a band (RaceSim, endurance days' inserts).
//
// durationMin is deliberately NOT an input: it counts warmup/cooldown/recovery time, which varies
// freely without changing what the session trains — the parsed work efforts ARE the identity.

import type { PrescribedInterval, SessionLevel, WorkoutType } from "./types";
import { PROTOCOL } from "./workout-validate";

// KB training §4 puts SIT at 130–200% FTP. The PROTOCOL table pins only the floor (an all-out
// effort can't violate a ceiling), so the band ceiling used for normalisation lives here.
const SIT_BAND_CEILING_PCT = 200;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeSessionLevel(
  type: WorkoutType,
  prescription: PrescribedInterval[]
): SessionLevel | null {
  const workSec = prescription.reduce((s, p) => s + p.reps * p.durationSec, 0);
  if (workSec <= 0) return null;
  const avgRaw =
    prescription.reduce((s, p) => s + p.reps * p.durationSec * p.targetPctFtp, 0) / workSec;

  const rule = PROTOCOL[type];
  const lo = rule?.minIntensityPct;
  const hi = rule?.maxIntensityPct ?? (type === "SIT" ? SIT_BAND_CEILING_PCT : undefined);
  const bandPosition =
    lo !== undefined && hi !== undefined && hi > lo
      ? round2(Math.min(1, Math.max(0, (avgRaw - lo) / (hi - lo))))
      : null;

  return {
    // Score/band derive from the RAW (pre-rounding) figures; rounding is storage-only.
    score: round1((workSec / 60) * (avgRaw / 100)),
    workMin: round1(workSec / 60),
    avgPctFtp: round1(avgRaw),
    bandPosition,
  };
}
