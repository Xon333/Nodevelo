// Match the coach's prescription against the intervals the athlete curated in
// Intervals.icu, rep-by-rep, and roll it up. Order-based alignment: the i-th prescribed
// rep is compared to the i-th executed work effort. Pure + deterministic.

import type { ExecutedInterval, IntervalAdherence, IntervalComparison, PrescribedInterval } from "./types";

export function matchPrescription(
  prescription: PrescribedInterval[],
  executed: ExecutedInterval[]
): IntervalComparison | null {
  if (prescription.length === 0) return null;

  // Flatten prescribed reps in order: "2×20" → two 20-min targets.
  const flat: Array<{ targetWatts: number; durationSec: number }> = [];
  for (const p of prescription) {
    for (let i = 0; i < Math.max(1, p.reps); i++) {
      flat.push({ targetWatts: p.targetWatts, durationSec: p.durationSec });
    }
  }

  // Prefer Intervals' WORK-typed efforts; if none are typed, fall back to efforts whose
  // power is in the work band (excludes warmups/recovery valves) so alignment holds.
  const minTarget = Math.min(...flat.map((f) => f.targetWatts));
  // Filtering uses NP first (higher, more stable) so warm-up/recovery laps below the work
  // band are excluded correctly. Adherence uses avg watts (what you actually averaged, not the
  // normalized figure) so DI-2 power mis-reads are avoided — NP can be 20%+ above avg for
  // short or variable efforts and would overstate adherence.
  const filterPower = (e: ExecutedInterval) => e.npWatts ?? e.avgWatts ?? 0;
  const adherePower = (e: ExecutedInterval) => e.avgWatts ?? e.npWatts ?? 0;
  const typed = executed.filter((e) => e.type === "WORK");
  const work = typed.length > 0 ? typed : executed.filter((e) => filterPower(e) >= 0.8 * minTarget);

  const reps: IntervalAdherence[] = [];
  const n = Math.min(flat.length, work.length);
  for (let i = 0; i < n; i++) {
    const target = flat[i].targetWatts;
    const targetDur = flat[i].durationSec;
    const actual = Math.round(adherePower(work[i]));
    const actualDur = work[i].durationSec;
    reps.push({
      targetWatts: target,
      actualWatts: actual,
      durationSec: actualDur,
      targetDurationSec: targetDur,
      adherencePct: target > 0 ? Math.round((actual / target) * 100) : 0,
      durationPct: targetDur > 0 ? Math.round((actualDur / targetDur) * 100) : 100,
    });
  }

  const avg = (xs: number[]) => (xs.length > 0 ? Math.round(xs.reduce((s, v) => s + v, 0) / xs.length) : 0);
  const median = (xs: number[]) => {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const avgAdherencePct = avg(reps.map((r) => r.adherencePct));
  const avgDurationPct = avg(reps.map((r) => r.durationPct));
  // Effective execution = power adherence scaled by how much of the prescribed duration was
  // actually held (capped at 100% so an over-long rep isn't credited as extra). A rep nailed
  // on watts but cut short is NOT a fully-executed rep — this is what scoring keys on.
  const effectiveAdherencePct = avg(
    reps.map((r) => Math.round(r.adherencePct * Math.min(1, r.durationPct / 100)))
  );

  // Plan-vs-detection mismatch (not a bail): every matched rep ran ~half-or-less its prescribed
  // length, yet power was on target AND the rep count matched. That consistent half-duration +
  // nailed-watts signature means the plan's per-rep duration definition differs from what was
  // ridden (e.g. a SIT day stored as 1-min reps but ridden/detected as 30s) — so the duration
  // penalty would mis-score a correct session. A genuine bail (short reps with weak power, or a
  // mid-session fade) is excluded by the strong-power + all-reps-consistent requirement.
  const countMatches = reps.length === flat.length;
  const allRepsHalvedOrLess = reps.length >= 2 && reps.every((r) => r.durationPct < 55);
  const powerNailed = median(reps.map((r) => r.adherencePct)) >= 95;
  const structuralMismatch = countMatches && allRepsHalvedOrLess && powerNailed;

  return {
    prescribedLabels: prescription.map((p) => p.label),
    reps,
    // Only reps that held ≥90% of the prescribed duration count as completed.
    completed: reps.filter((r) => r.durationPct >= 90).length,
    total: flat.length,
    avgAdherencePct,
    avgDurationPct,
    effectiveAdherencePct,
    structuralMismatch,
  };
}
