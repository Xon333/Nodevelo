import { NextResponse } from "next/server";
import { readBlockSettings, writeBlockSettings } from "@/lib/data-store";
import type { BlockSettings } from "@/lib/types";
import { DEFAULT_BLOCK_SETTINGS } from "@/lib/types";
import {
  isAcwrBandsOverridden,
  isDurabilityInsertEnvelopeOverridden,
  isStrainBandsOverridden,
  isTsbModifierEdgesOverridden,
  resolveAcwrBands,
  resolveDurabilityInsertEnvelope,
  resolveStrainBands,
  resolveTsbModifierEdges,
  type AcwrBands,
  type DurabilityInsertEnvelope,
  type StrainBands,
  type TsbModifierEdges,
} from "@/lib/calibration";

export async function GET() {
  const settings = await readBlockSettings();
  return NextResponse.json(settings);
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const current = await readBlockSettings();

  const num = (key: keyof BlockSettings, min: number, max: number): number => {
    const v = b[key] ?? current[key] ?? DEFAULT_BLOCK_SETTINGS[key];
    const n = Number(v);
    if (!Number.isFinite(n)) return current[key] as number;
    return Math.max(min, Math.min(max, n));
  };

  const updated: BlockSettings = {
    weeklyHoursMin: num("weeklyHoursMin", 4, 25),
    weeklyHoursMax: num("weeklyHoursMax", 4, 30),
    recoveryWeekHoursMin: num("recoveryWeekHoursMin", 2, 15),
    recoveryWeekHoursMax: num("recoveryWeekHoursMax", 2, 15),
    qualitySessionsPerLoadingWeek: num("qualitySessionsPerLoadingWeek", 1, 4),
    longRideDurationMinutes: num("longRideDurationMinutes", 60, 480),
    restDaysPerWeek: num("restDaysPerWeek", 0, 3),
    polarisedApproach: typeof b.polarisedApproach === "boolean" ? b.polarisedApproach : current.polarisedApproach,
    autoSyncOnOpen: typeof b.autoSyncOnOpen === "boolean" ? b.autoSyncOnOpen : current.autoSyncOnOpen,
    autoPostCoachNote: typeof b.autoPostCoachNote === "boolean" ? b.autoPostCoachNote : current.autoPostCoachNote,
    updatedAt: new Date().toISOString(),
  };

  // ACWR band override (the manual half of calibration): validate + clamp via the calibration
  // resolver when present, otherwise preserve the existing override, otherwise leave it off.
  if (isAcwrBandsOverridden(b.acwrBands as Partial<AcwrBands> | null)) {
    updated.acwrBands = resolveAcwrBands(b.acwrBands as Partial<AcwrBands>);
  } else if (current.acwrBands) {
    updated.acwrBands = current.acwrBands;
  }

  // TSB adaptation-window override (same manual-calibration pattern, ROADMAP #2): clamp + order via the
  // resolver when present, else preserve the existing override, else leave it on population defaults.
  if (isTsbModifierEdgesOverridden(b.tsbModifierEdges as Partial<TsbModifierEdges> | null)) {
    updated.tsbModifierEdges = resolveTsbModifierEdges(b.tsbModifierEdges as Partial<TsbModifierEdges>);
  } else if (current.tsbModifierEdges) {
    updated.tsbModifierEdges = current.tsbModifierEdges;
  }

  // Morning-check strain-band override (ROADMAP #2): same clamp-or-preserve pattern. Read by the
  // morning-check route — before SET-1 this (and the two below) were dropped on every save.
  if (isStrainBandsOverridden(b.strainBands as Partial<StrainBands> | null)) {
    updated.strainBands = resolveStrainBands(b.strainBands as Partial<StrainBands>);
  } else if (current.strainBands) {
    updated.strainBands = current.strainBands;
  }

  // Durability-insert envelope override (ROADMAP #2): read by the generate route's plan validation.
  if (isDurabilityInsertEnvelopeOverridden(b.durabilityInsertEnvelope as Partial<DurabilityInsertEnvelope> | null)) {
    updated.durabilityInsertEnvelope = resolveDurabilityInsertEnvelope(b.durabilityInsertEnvelope as Partial<DurabilityInsertEnvelope>);
  } else if (current.durabilityInsertEnvelope) {
    updated.durabilityInsertEnvelope = current.durabilityInsertEnvelope;
  }

  // Athlete-state fusion weights (ROADMAP §5 / #2): PRESERVE an existing override so a save can't wipe it,
  // but don't accept a NEW one through this route yet — resolveAthleteStateWeights does not clamp (CAL-1),
  // so persisting arbitrary client values could disable the lived-fatigue safety cap. Accept+clamp lands
  // with CAL-1.
  if (current.athleteStateWeights) {
    updated.athleteStateWeights = current.athleteStateWeights;
  }

  await writeBlockSettings(updated);
  return NextResponse.json(updated);
}
