import { NextResponse } from "next/server";
import { readBlockSettings, updateBlockSettings } from "@/lib/data-store";
import type { BlockSettings } from "@/lib/types";
import { DEFAULT_BLOCK_SETTINGS } from "@/lib/types";
import {
  isAcwrBandsOverridden,
  isAthleteStateWeightsOverridden,
  isDurabilityInsertEnvelopeOverridden,
  isTsbModifierEdgesOverridden,
  resolveAcwrBands,
  resolveAthleteStateWeights,
  resolveDurabilityInsertEnvelope,
  resolveTsbModifierEdges,
  type AcwrBands,
  type AthleteStateWeights,
  type DeepPartial,
  type DurabilityInsertEnvelope,
  type TsbModifierEdges,
} from "@/lib/calibration";

export async function GET() {
  const settings = await readBlockSettings();
  return NextResponse.json(settings);
}

// HR-52: signals a validation failure from inside updateBlockSettings' mutate callback (which can't
// itself return a NextResponse) — caught below and turned into the same 400 the route always gave.
class SettingsValidationError extends Error {}

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

  try {
    // HR-52: the whole read-validate-merge-write runs as ONE locked critical section — `current` is
    // read fresh inside updateBlockSettings' lock, so two concurrent PUTs (e.g. two open tabs saving
    // Settings) can't each compute their own `updated` from the same stale base and clobber one
    // another's unrelated field changes.
    const updated = await updateBlockSettings((current) => {
      const num = (key: keyof BlockSettings, min: number, max: number): number => {
        const v = b[key] ?? current[key] ?? DEFAULT_BLOCK_SETTINGS[key];
        const n = Number(v);
        if (!Number.isFinite(n)) return current[key] as number;
        return Math.max(min, Math.min(max, n));
      };

      const next: BlockSettings = {
        targetWeeklyHours: num("targetWeeklyHours", 4, 25),
        maxAvailableHours: num("maxAvailableHours", 4, 30),
        recoveryWeekHoursMin: num("recoveryWeekHoursMin", 2, 15),
        recoveryWeekHoursMax: num("recoveryWeekHoursMax", 2, 15),
        qualitySessionsPerLoadingWeek: num("qualitySessionsPerLoadingWeek", 1, 4),
        longRideDurationMinutes: num("longRideDurationMinutes", 60, 480),
        restDaysPerWeek: num("restDaysPerWeek", 0, 3),
        polarisedApproach: typeof b.polarisedApproach === "boolean" ? b.polarisedApproach : current.polarisedApproach,
        autoSyncOnOpen: typeof b.autoSyncOnOpen === "boolean" ? b.autoSyncOnOpen : current.autoSyncOnOpen,
        autoPostCoachNote: typeof b.autoPostCoachNote === "boolean" ? b.autoPostCoachNote : current.autoPostCoachNote,
        lapButtonSteps: typeof b.lapButtonSteps === "boolean" ? b.lapButtonSteps : current.lapButtonSteps,
        updatedAt: new Date().toISOString(),
      };

      if (next.targetWeeklyHours > next.maxAvailableHours) {
        throw new SettingsValidationError("Target weekly hours can't exceed maximum available hours.");
      }
      if (next.recoveryWeekHoursMin > next.maxAvailableHours) {
        throw new SettingsValidationError("Recovery-week minimum hours can't exceed maximum available hours.");
      }
      if (next.recoveryWeekHoursMin > next.recoveryWeekHoursMax) {
        throw new SettingsValidationError("Recovery week: minimum hours can't be more than maximum hours.");
      }

      // ACWR band override (the manual half of calibration): validate + clamp via the calibration
      // resolver when present, otherwise preserve the existing override, otherwise leave it off.
      if (isAcwrBandsOverridden(b.acwrBands as Partial<AcwrBands> | null)) {
        next.acwrBands = resolveAcwrBands(b.acwrBands as Partial<AcwrBands>);
      } else if (current.acwrBands) {
        next.acwrBands = current.acwrBands;
      }

      // TSB adaptation-window override (same manual-calibration pattern, ROADMAP #2): clamp + order via
      // the resolver when present, else preserve the existing override, else leave it on population defaults.
      if (isTsbModifierEdgesOverridden(b.tsbModifierEdges as Partial<TsbModifierEdges> | null)) {
        next.tsbModifierEdges = resolveTsbModifierEdges(b.tsbModifierEdges as Partial<TsbModifierEdges>);
      } else if (current.tsbModifierEdges) {
        next.tsbModifierEdges = current.tsbModifierEdges;
      }

      // Durability-insert envelope override (ROADMAP #2): read by the generate route's plan validation.
      if (isDurabilityInsertEnvelopeOverridden(b.durabilityInsertEnvelope as Partial<DurabilityInsertEnvelope> | null)) {
        next.durabilityInsertEnvelope = resolveDurabilityInsertEnvelope(b.durabilityInsertEnvelope as Partial<DurabilityInsertEnvelope>);
      } else if (current.durabilityInsertEnvelope) {
        next.durabilityInsertEnvelope = current.durabilityInsertEnvelope;
      }

      // Athlete-state fusion weights (ROADMAP §5 / #2): clamp + order via the resolver when present
      // (safe now that resolveAthleteStateWeights bounds every leaf — CAL-1), else preserve an existing
      // override, else leave it on population defaults.
      if (isAthleteStateWeightsOverridden(b.athleteStateWeights as DeepPartial<AthleteStateWeights> | null)) {
        next.athleteStateWeights = resolveAthleteStateWeights(b.athleteStateWeights as DeepPartial<AthleteStateWeights>);
      } else if (current.athleteStateWeights) {
        next.athleteStateWeights = current.athleteStateWeights;
      }

      return next;
    });

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof SettingsValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
