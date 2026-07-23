import { NextResponse } from "next/server";
import { readAthleteProfile, readLastSync, updateAthleteProfile } from "@/lib/data-store";
import { parseAthleteMd } from "@/lib/kb-loader";
import { analyzePowerProfile } from "@/lib/power-profile";
import { readPhysiology, resolveHrZones, resolvePowerZones } from "@/lib/physiology";
import { adjustBuffer, weightTrendFromWellness } from "@/lib/nutrition";
import type { AthleteProfile } from "@/lib/types";
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
    goals: profile.goals,
    weakpoints: profile.weakpoints,
    goalsMigratedAt: profile.goalsMigratedAt,
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

// PUT saves nutrition and/or goals/weakpoints (Goals/Weakpoints centralization) — any of the three
// top-level keys may be present; each is validated and applied independently.
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  // HR-50: validate BEFORE the locked update below — a 400 here must never touch the lock, and the
  // mutator handed to updateAthleteProfile is a pure merge with no failure path of its own.
  let nutrition: AthleteProfile["nutrition"] | undefined;
  if (b.nutrition !== undefined) {
    const input = b.nutrition as Record<string, unknown>;
    const { baseCalories, restDayTarget, buffer, targetWeightKg } = input;
    const pos = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
    if (!pos(baseCalories)) return NextResponse.json({ error: "baseCalories must be a positive number." }, { status: 400 });
    if (!pos(restDayTarget)) return NextResponse.json({ error: "restDayTarget must be a positive number." }, { status: 400 });
    if (!pos(targetWeightKg)) return NextResponse.json({ error: "targetWeightKg must be a positive number." }, { status: 400 });
    if (typeof buffer !== "number" || !Number.isFinite(buffer) || buffer < 0 || buffer > 600) {
      return NextResponse.json({ error: "buffer must be between 0 and 600 kcal." }, { status: 400 });
    }
    nutrition = {
      baseCalories: baseCalories as number,
      restDayTarget: restDayTarget as number,
      buffer: buffer as number,
      targetWeightKg: targetWeightKg as number,
    };
  }

  const VALID_FOCUS = new Set(["aerobic-base", "threshold", "vo2max", "anaerobic", "durability", "sharpen", "general"]);

  let goals: AthleteProfile["goals"] | undefined;
  if (b.goals !== undefined) {
    if (!Array.isArray(b.goals)) return NextResponse.json({ error: "goals must be an array." }, { status: 400 });
    goals = [];
    for (const g of b.goals) {
      if (!g || typeof g !== "object") return NextResponse.json({ error: "Each goal must be an object." }, { status: 400 });
      const rec = g as Record<string, unknown>;
      const goalText = typeof rec.goal === "string" ? rec.goal.trim() : "";
      const target = typeof rec.target === "string" ? rec.target.trim() : "";
      const focus = typeof rec.focus === "string" && VALID_FOCUS.has(rec.focus) ? (rec.focus as AthleteProfile["goals"][number]["focus"]) : "general";
      if (!goalText) return NextResponse.json({ error: "Goal text is required." }, { status: 400 });
      goals.push({ goal: goalText, target, focus });
    }
  }

  let weakpoints: AthleteProfile["weakpoints"] | undefined;
  if (b.weakpoints !== undefined) {
    if (!Array.isArray(b.weakpoints)) return NextResponse.json({ error: "weakpoints must be an array." }, { status: 400 });
    weakpoints = [];
    for (const w of b.weakpoints) {
      if (!w || typeof w !== "object") return NextResponse.json({ error: "Each weakpoint must be an object." }, { status: 400 });
      const rec = w as Record<string, unknown>;
      const weakpointText = typeof rec.weakpoint === "string" ? rec.weakpoint.trim() : "";
      const detail = typeof rec.detail === "string" ? rec.detail.trim() : "";
      if (!weakpointText) return NextResponse.json({ error: "Weakpoint text is required." }, { status: 400 });
      weakpoints.push({ weakpoint: weakpointText, detail });
    }
  }

  // HR-50: mutates the RAW stored profile, never the live-overlaid one readAthleteProfile returns —
  // baking physiology-sync-derived FTP/HR back into athlete.json as if it were saved user input was
  // the actual bug. Locked, so a concurrent PUT (or the goals-migration self-heal write) can't
  // clobber this one.
  const updated = await updateAthleteProfile((profile) => ({
    ...profile,
    ...(nutrition !== undefined ? { nutrition } : {}),
    ...(goals !== undefined ? { goals } : {}),
    ...(weakpoints !== undefined ? { weakpoints } : {}),
  }));
  return NextResponse.json({ nutrition: updated.nutrition, goals: updated.goals, weakpoints: updated.weakpoints });
}
