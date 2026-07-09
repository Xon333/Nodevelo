// The Trends fold-1 verdict (UX v2 §5): three axes — engine, delivery, fueling — each honestly
// derived from series the /api/trends payload already carries, combined into one page verdict.
// Pure and deterministic so the derivation is testable and each axis tip can state it plainly
// (Constitution §5: every number answers "where did this come from?").

import { eaLevel } from "./nutrition";

export type AxisDir = "up" | "steady" | "down";

export interface VerdictAxis {
  key: "engine" | "delivery" | "fueling";
  // Strip chip text, e.g. "engine ↑" · "delivery → (avg 7.4/10)" · "fueling on target".
  label: string;
  dir: AxisDir | null; // null = not enough data; the chip renders muted, honestly "no read yet"
  derivation: string; // the tip naming the derivation (Constitution §5)
}

export interface TrendsVerdict {
  // The one-word page answer; null = not enough data for any verdict (the strip renders a quiet
  // empty-state line instead of pretending).
  word: "Improving" | "Holding" | "Mixed" | "Slipping" | null;
  axes: VerdictAxis[];
}

// First-half vs second-half mean comparison — the same midpoint/epsilon shape as trendDir
// (components/trends/sections.tsx) so the strip never disagrees with the per-chart labels.
function halvesDir(values: number[]): AxisDir | null {
  if (values.length < 4) return null;
  const mid = Math.floor(values.length / 2);
  const a = values.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
  const b = values.slice(mid).reduce((s, v) => s + v, 0) / (values.length - mid);
  const eps = Math.max(0.02, Math.abs(a) * 0.02);
  if (Math.abs(b - a) < eps) return "steady";
  return b - a > 0 ? "up" : "down";
}

const ARROW: Record<AxisDir, string> = { up: "↑", steady: "→", down: "↓" };

export function deriveTrendsVerdict(input: {
  ctl: Array<{ value: number }>;
  ef: Array<{ value: number }>;
  scores: Array<{ executionScore: number }>;
  energy: Array<{ burnKcal: number | null; intakeKcal: number | null; weightKg: number | null }>;
}): TrendsVerdict {
  // ENGINE — CTL slope + Pw:HR trend, both higher-is-better. Both must agree to move the axis
  // (disagreement is honestly "steady"); a one-signal read uses the signal that exists.
  const ctlDir = halvesDir(input.ctl.map((p) => p.value));
  const efDir = halvesDir(input.ef.map((p) => p.value));
  const engineDir: AxisDir | null =
    ctlDir === null ? efDir : efDir === null ? ctlDir : ctlDir === efDir ? ctlDir : "steady";

  // DELIVERY — execution average + direction over the last 24 scored sessions (the payload's
  // scores already exclude legacy + compromised rides).
  const recent = input.scores.slice(-24).map((s) => s.executionScore);
  const deliveryTrend = halvesDir(recent);
  const avg = recent.length >= 2 ? Math.round((recent.reduce((s, v) => s + v, 0) / recent.length) * 10) / 10 : null;
  const deliveryDir: AxisDir | null = deliveryTrend ?? (avg !== null ? "steady" : null);

  // FUELING — the weekly EA proxy: (weekly intake − weekly ride burn) ÷ 7 ÷ median weight,
  // banded by the same eaLevel bands as Today's EA tile (body-weight basis, non-clinical),
  // averaged over the last ≤4 complete weeks where both series were logged.
  const fuelWeeks = input.energy
    .filter((e) => e.burnKcal !== null && e.intakeKcal !== null && e.weightKg !== null && e.weightKg > 0)
    .slice(-4);
  let fuelingDir: AxisDir | null = null;
  let fuelingLabel = "fueling — no read yet";
  if (fuelWeeks.length > 0) {
    const perKg =
      fuelWeeks.reduce(
        (s, e) => s + ((e.intakeKcal as number) - (e.burnKcal as number)) / 7 / (e.weightKg as number),
        0
      ) / fuelWeeks.length;
    const level = eaLevel(perKg);
    fuelingDir = level === "low" ? "down" : "steady";
    fuelingLabel = level === "low" ? "fueling running low" : level === "ample" ? "fueling ample" : "fueling on target";
  }

  const axes: VerdictAxis[] = [
    {
      key: "engine",
      label: engineDir ? `engine ${ARROW[engineDir]}` : "engine — no read yet",
      dir: engineDir,
      derivation:
        "CTL slope (fitness trajectory) and the Pw:HR trend on steady outdoor rides, first half of each series vs the second. Both rising = the motor is getting bigger; disagreement reads as steady.",
    },
    {
      key: "delivery",
      label:
        deliveryDir && avg !== null
          ? `delivery ${ARROW[deliveryDir]} (avg ${avg}/10)`
          : "delivery — no read yet",
      dir: deliveryDir,
      derivation:
        "Execution-score average and direction over your last 24 matched sessions (compromised and pre-block rides excluded) — do you deliver what's prescribed?",
    },
    {
      key: "fueling",
      label: fuelingLabel,
      dir: fuelingDir,
      derivation:
        "Weekly logged intake minus ride burn, per kg body weight per day, over the last complete logged weeks — the same energy-availability bands as Today's EA tile. Under-logged intake reads low.",
    },
  ];

  // The word: engine carries double weight (the page question is adaptation); low fueling can
  // drag the word down but never lift it. No engine AND no delivery read → no verdict at all.
  if (engineDir === null && deliveryDir === null) return { word: null, axes };
  const val = (d: AxisDir | null) => (d === "up" ? 1 : d === "down" ? -1 : 0);
  const score = 2 * val(engineDir) + val(deliveryDir) + (fuelingDir === "down" ? -1 : 0);
  const word = score >= 2 ? "Improving" : score >= 0 ? "Holding" : score >= -2 ? "Mixed" : "Slipping";
  return { word, axes };
}
