import { NextResponse } from "next/server";
import { readBlockSettings, writeBlockSettings } from "@/lib/data-store";
import type { BlockSettings } from "@/lib/types";
import { DEFAULT_BLOCK_SETTINGS } from "@/lib/types";
import { isAcwrBandsOverridden, resolveAcwrBands, type AcwrBands } from "@/lib/calibration";

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

  await writeBlockSettings(updated);
  return NextResponse.json(updated);
}
