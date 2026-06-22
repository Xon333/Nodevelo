import { NextResponse } from "next/server";
import { readAthleteProfile, readLastSync, writeAthleteProfile } from "@/lib/data-store";
import { parseAthleteMd } from "@/lib/kb-loader";
import { analyzePowerProfile } from "@/lib/power-profile";
import { readPhysiology, resolveHrZones, resolvePowerZones } from "@/lib/physiology";
import { adjustBuffer, weightTrendFromWellness } from "@/lib/nutrition";
import type { Zone } from "@/lib/zones";

// GET returns the parsed athlete_profile.md snapshot plus Intervals.icu auto-sync data.
// Performance, goals and weakpoints all come from the markdown — no re-entry needed.
export async function GET() {
  const [profile, sync, athleteMd, physStore] = await Promise.all([
    readAthleteProfile(),
    readLastSync(),
    parseAthleteMd(),
    readPhysiology(),
  ]);

  // FTP, threshold/max HR and zones are no longer in the markdown — project them from the
  // physiology store into the shape the profile UI already renders.
  let physiologyChange: { fromFtp: number; toFtp: number; date: string } | null = null;
  if (physStore) {
    const c = physStore.current;
    const fmtRange = (z: Zone, unit: string) =>
      z.lo === 0 ? `< ${z.hi}${unit}` : z.hi === null ? `> ${z.lo}${unit}` : `${z.lo}–${z.hi}${unit}`;
    athleteMd.performanceData = {
      ...athleteMd.performanceData,
      FTP: `${c.ftp}W`,
      ...(c.lthr !== null ? { "Threshold HR": `${c.lthr} BPM` } : {}),
      ...(c.maxHr !== null ? { "Max HR": `${c.maxHr} BPM` } : {}),
    };
    const pz = resolvePowerZones(c);
    const hz = resolveHrZones(c);
    if (pz.length > 0) {
      athleteMd.trainingZones = pz.map((z, i) => ({
        zone: z.name.split(/\s+/)[0] || `Z${i + 1}`,
        name: z.name.replace(/^Z\d+\s*/, ""),
        power: fmtRange(z, "W"),
        hr: hz[i] ? fmtRange(hz[i], " BPM") : "",
      }));
    }
    // The most recent FTP change Intervals reported (drives the "zones updated" note).
    const prev = physStore.history[physStore.history.length - 1];
    if (prev && prev.ftp !== c.ftp) {
      physiologyChange = { fromFtp: prev.ftp, toFtp: c.ftp, date: c.effectiveFrom };
    }
  }

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

  // Staleness is measured from when the current FTP became effective (synced from
  // Intervals.icu), not the nutrition-save time on athlete.json.
  const ftpStaleDays = physStore
    ? Math.floor((Date.now() - Date.parse(physStore.current.effectiveFrom)) / 86_400_000)
    : NaN;

  return NextResponse.json({
    nutrition: profile.nutrition,
    ftpStaleDays: Number.isFinite(ftpStaleDays) ? ftpStaleDays : null,
    physiologyChange,
    physiologySource: physStore?.current.source ?? null,
    athleteMd,
    // Prefer all-time best efforts (true PRs); fall back to the 84-day curve if unavailable.
    syncedPowerCurve: sync?.powerCurveAllTime ?? sync?.powerCurve ?? [],
    // Track A: rider-type + auto-derived weak point from the curve shape (deterministic; null when
    // there's no FTP or too little curve to classify). The same analysis feeds generation.
    powerProfile: analyzePowerProfile(
      sync?.powerCurveAllTime ?? sync?.powerCurve ?? [],
      physStore?.current.ftp ?? profile.performance.ftp,
      weighIns[0]?.weightKg ?? null
    ),
    weightHistory: (sync?.wellness ?? [])
      .filter((w) => w.weightKg !== null)
      .map((w) => ({ date: w.date, weightKg: w.weightKg as number }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-56), // last 8 weeks
    latestWeightKg:
      (sync?.wellness ?? [])
        .filter((w) => w.weightKg !== null)
        .sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg ?? null,
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

// PUT only saves nutrition settings — performance/goals/weakpoints live in athlete_profile.md
// and are edited there via the Knowledge Base manager.
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const input = body && typeof body === "object"
    ? (body as Record<string, unknown>).nutrition as Record<string, unknown> | undefined
    : undefined;
  if (!input) return NextResponse.json({ error: "Missing nutrition." }, { status: 400 });

  const { baseCalories, restDayTarget, buffer, targetWeightKg } = input;
  const pos = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!pos(baseCalories)) return NextResponse.json({ error: "baseCalories must be a positive number." }, { status: 400 });
  if (!pos(restDayTarget)) return NextResponse.json({ error: "restDayTarget must be a positive number." }, { status: 400 });
  if (!pos(targetWeightKg)) return NextResponse.json({ error: "targetWeightKg must be a positive number." }, { status: 400 });
  if (typeof buffer !== "number" || !Number.isFinite(buffer) || buffer < 0 || buffer > 600) {
    return NextResponse.json({ error: "buffer must be between 0 and 600 kcal." }, { status: 400 });
  }

  const current = await readAthleteProfile();
  const updated = {
    ...current,
    nutrition: {
      baseCalories: baseCalories as number,
      restDayTarget: restDayTarget as number,
      buffer: buffer as number,
      targetWeightKg: targetWeightKg as number,
    },
    updatedAt: new Date().toISOString(),
  };
  await writeAthleteProfile(updated);
  return NextResponse.json({ nutrition: updated.nutrition });
}
