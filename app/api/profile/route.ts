import { NextResponse } from "next/server";
import { readAthleteProfile, readLastSync, writeAthleteProfile } from "@/lib/data-store";
import { writeAthleteProfileMd } from "@/lib/kb-loader";
import { adjustBuffer, weightTrendFromWellness } from "@/lib/nutrition";
import type { AthleteProfile } from "@/lib/types";

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((v): v is string => typeof v === "string");
  if (items.length !== value.length) return null;
  return items.map((s) => s.trim()).filter((s) => s !== "");
}

function validateProfile(body: unknown): AthleteProfile | string {
  if (!body || typeof body !== "object") return "Request body must be a JSON object.";
  const input = (body as Record<string, unknown>).profile as Record<string, unknown> | undefined;
  if (!input) return "Missing profile.";
  const perf = input.performance as Record<string, unknown> | undefined;
  const nutrition = input.nutrition as Record<string, unknown> | undefined;
  if (!perf || !nutrition) return "Profile must include performance and nutrition sections.";

  for (const key of ["ftp", "maxHr", "thresholdHr", "weightKg", "weeklyHoursMin", "weeklyHoursMax"]) {
    if (!finitePositive(perf[key])) return `performance.${key} must be a positive number.`;
  }
  if ((perf.weeklyHoursMin as number) > (perf.weeklyHoursMax as number)) {
    return "weeklyHoursMin cannot exceed weeklyHoursMax.";
  }
  for (const key of ["baseCalories", "restDayTarget", "targetWeightKg"]) {
    if (!finitePositive(nutrition[key])) return `nutrition.${key} must be a positive number.`;
  }
  const buffer = nutrition.buffer;
  if (typeof buffer !== "number" || !Number.isFinite(buffer) || buffer < 0 || buffer > 600) {
    return "nutrition.buffer must be between 0 and 600 kcal.";
  }
  const goals = stringList(input.goals);
  const weakpoints = stringList(input.weakpoints);
  if (goals === null || weakpoints === null) return "goals and weakpoints must be string lists.";

  return {
    performance: {
      ftp: perf.ftp as number,
      maxHr: perf.maxHr as number,
      thresholdHr: perf.thresholdHr as number,
      weightKg: perf.weightKg as number,
      weeklyHoursMin: perf.weeklyHoursMin as number,
      weeklyHoursMax: perf.weeklyHoursMax as number,
    },
    goals,
    weakpoints,
    nutrition: {
      baseCalories: nutrition.baseCalories as number,
      restDayTarget: nutrition.restDayTarget as number,
      buffer,
      targetWeightKg: nutrition.targetWeightKg as number,
    },
    updatedAt: new Date().toISOString(),
  };
}

// GET returns the profile plus read-only values derived from the last sync.
export async function GET() {
  const [profile, sync] = await Promise.all([readAthleteProfile(), readLastSync()]);

  const weighIns = (sync?.wellness ?? [])
    .filter((w) => w.weightKg !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
  const weightTrend7Day = sync ? weightTrendFromWellness(sync.wellness) : null;

  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const recentRpes = (sync?.activities ?? [])
    .filter((a) => a.date >= cutoff && a.rpe !== null)
    .map((a) => a.rpe as number);
  const lastKcal = (sync?.wellness ?? [])
    .filter((w) => w.kcalConsumed !== null)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  return NextResponse.json({
    profile,
    autoSync: {
      syncedAt: sync?.syncedAt ?? null,
      latestWeightKg: weighIns[0]?.weightKg ?? null,
      latestWeightDate: weighIns[0]?.date ?? null,
      weightTrend7Day,
      avgRpe7Day:
        recentRpes.length > 0
          ? Math.round((recentRpes.reduce((a, b) => a + b, 0) / recentRpes.length) * 10) / 10
          : null,
      lastKcalConsumed: lastKcal?.kcalConsumed ?? null,
      lastKcalDate: lastKcal?.date ?? null,
    },
    bufferStatus: adjustBuffer(profile.nutrition.buffer, weightTrend7Day ?? 0),
  });
}

// PUT saves athlete.json AND regenerates athlete_profile.md (non-negotiable #6).
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const profile = validateProfile(body);
  if (typeof profile === "string") {
    return NextResponse.json({ error: profile }, { status: 400 });
  }
  await writeAthleteProfile(profile);
  await writeAthleteProfileMd(profile);
  return NextResponse.json({ profile });
}
