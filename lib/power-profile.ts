// Track A — Power-curve intelligence. Classify the *shape* of the synced power curve into a rider
// type and surface the "easy win" (the energy system most depressed relative to this rider's own
// engine) as an auto-derived weak point. Pure + deterministic: the LLM only phrases the result.
//
// Method. Four anchor durations map onto the physiological systems:
//   5 s → neuromuscular · 1 min → anaerobic · 5 min → VO2max · 20 min → threshold.
// Each anchor's power is taken as a multiple of FTP (so bodyweight cancels — the read works even
// without a weigh-in; W/kg is computed for display only). That multiple is divided by a population
// reference multiple for the duration, giving a *relative strength* where 1.0 = exactly what you'd
// expect from this engine. Threshold (20 min ≈ FTP) is the baseline, so it's never a strength or a
// weak point — rider type is defined by how the short efforts sit relative to the engine.

import type { PowerCurvePoint, PowerProfile, PowerSystem, PowerSystemStrength, RiderType } from "./types";

interface Anchor {
  system: PowerSystem;
  durationSec: number;
  // Population reference: typical power at this duration as a multiple of FTP for a balanced rider.
  // These are the only population magic-numbers here — grounded in standard power-profile tables
  // (Coggan/Allen) and centralised so #2's calibration framework can later personalise them.
  refMultipleOfFtp: number;
}

// Ordered short→long. Threshold is the implicit baseline (P20min/FTP ≈ 1.0), so it isn't classified.
const ANCHORS: Anchor[] = [
  { system: "neuromuscular", durationSec: 5, refMultipleOfFtp: 4.0 },
  { system: "anaerobic", durationSec: 60, refMultipleOfFtp: 1.9 },
  { system: "vo2max", durationSec: 300, refMultipleOfFtp: 1.18 },
];

// A system is a notable *strength* when it clears expectation by this margin, a notable *weakness*
// when it dips below the lower edge. The dead-band between keeps a balanced curve reading as such.
const STRENGTH_MARGIN = 1.06;
const WEAKNESS_MARGIN = 0.94;

// Pull the curve value for a target duration: exact match, else the nearest point within 15%.
function wattsAt(curve: Map<number, number>, targetSec: number): number | null {
  const exact = curve.get(targetSec);
  if (exact != null && exact > 0) return exact;
  let best: { sec: number; watts: number } | null = null;
  for (const [sec, watts] of curve) {
    if (watts <= 0) continue;
    if (best === null || Math.abs(sec - targetSec) < Math.abs(best.sec - targetSec)) {
      best = { sec, watts };
    }
  }
  if (!best || Math.abs(best.sec - targetSec) > targetSec * 0.15) return null;
  return best.watts;
}

// Classify a rider type from the per-system relative strengths.
//  - one short system clearly dominant → that system's archetype (anaerobic & VO2 both → puncheur)
//  - nothing dominant but every short system at/below expectation (flat curve) → time-trialist
//  - otherwise balanced → all-rounder
function classify(byStrength: Map<PowerSystem, number>): RiderType {
  const neuro = byStrength.get("neuromuscular");
  const ana = byStrength.get("anaerobic");
  const vo2 = byStrength.get("vo2max");
  const present = [
    ["neuromuscular", neuro],
    ["anaerobic", ana],
    ["vo2max", vo2],
  ].filter((e): e is [PowerSystem, number] => typeof e[1] === "number");

  if (present.length === 0) return "all-rounder";

  const top = present.reduce((a, b) => (b[1] > a[1] ? b : a));
  if (top[1] >= STRENGTH_MARGIN) {
    return top[0] === "neuromuscular" ? "sprinter" : "puncheur";
  }
  // No system above expectation: a flat curve (all short efforts at/below FTP-relative norm) is a
  // diesel / time-trialist; a curve that's merely middling is an all-rounder.
  if (present.every(([, v]) => v <= WEAKNESS_MARGIN)) return "time-trialist";
  return "all-rounder";
}

// Analyse the curve into a rider profile. Returns null when there isn't enough to say anything
// (no usable anchors, or no FTP) — callers then skip injection / surfacing rather than guess.
export function analyzePowerProfile(
  curve: PowerCurvePoint[],
  ftp: number,
  weightKg: number | null,
  basis: "all-time" | "84-day" = "all-time"
): PowerProfile | null {
  if (!Number.isFinite(ftp) || ftp <= 0 || curve.length === 0) return null;

  const lookup = new Map(curve.map((p) => [p.durationSec, p.watts]));
  const systems: PowerSystemStrength[] = [];
  const byStrength = new Map<PowerSystem, number>();

  for (const a of ANCHORS) {
    const watts = wattsAt(lookup, a.durationSec);
    if (watts == null) continue;
    const relativeStrength = watts / ftp / a.refMultipleOfFtp;
    systems.push({
      system: a.system,
      durationSec: a.durationSec,
      watts,
      wattsPerKg: weightKg && weightKg > 0 ? Math.round((watts / weightKg) * 10) / 10 : null,
      relativeStrength: Math.round(relativeStrength * 100) / 100,
    });
    byStrength.set(a.system, relativeStrength);
  }

  if (systems.length === 0) return null;

  // Easy win = the most-depressed system, but only if it's a real dip below expectation.
  let easyWin: PowerProfile["easyWin"] = null;
  const weakest = systems.reduce((a, b) => (b.relativeStrength < a.relativeStrength ? b : a));
  if (weakest.relativeStrength < WEAKNESS_MARGIN) {
    easyWin = {
      system: weakest.system,
      durationSec: weakest.durationSec,
      relativeStrength: weakest.relativeStrength,
    };
  }

  return {
    riderType: classify(byStrength),
    systems,
    easyWin,
    confident: systems.length >= 2, // need at least two anchors to call a shape
    ftp,
    basis,
  };
}

// Human label for an anchor, for prompt + UI ("5s sprint", "1 min", "5 min").
const SYSTEM_LABEL: Record<PowerSystem, string> = {
  neuromuscular: "neuromuscular (5s sprint)",
  anaerobic: "anaerobic (1 min)",
  vo2max: "VO2max (5 min)",
  threshold: "threshold (20 min)",
};

const RIDER_TYPE_BLURB: Record<RiderType, string> = {
  sprinter: "explosive short power, drops off over sustained efforts",
  puncheur: "strong over 1–5 min surges relative to the engine",
  "time-trialist": "flat curve — sustained power with little punch above threshold",
  "all-rounder": "balanced across the power-duration curve",
};

// Generation-prompt block: the auto-derived rider type + easy win, framed as a hint that complements
// (not overrides) the athlete's manual weak points. Returns "" when there's nothing trustworthy to add.
export function formatPowerProfileForPrompt(profile: PowerProfile | null): string {
  if (!profile || !profile.confident) return "";
  const lines = [
    "\nRIDER PROFILE (auto-derived from the power curve — deterministic; phrase it, don't recompute):",
    `- Rider type: ${profile.riderType} — ${RIDER_TYPE_BLURB[profile.riderType]}.`,
  ];
  if (profile.easyWin) {
    lines.push(
      `- Auto-identified weak point ("easy win"): ${SYSTEM_LABEL[profile.easyWin.system]} power is the most depressed relative to this rider's own engine — a worthwhile micro-target this block (one light weekly touch) unless the goal points elsewhere. Treat as a hint alongside the manual weakpoints, not a replacement.`
    );
  }
  return lines.join("\n");
}
