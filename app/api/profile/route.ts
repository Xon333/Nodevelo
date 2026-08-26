import { NextResponse } from "next/server";
import { readAthleteProfile, readLastSync, updateAthleteProfile } from "@/lib/data-store";
import { parseAthleteMd } from "@/lib/kb-loader";
import { analyzePowerProfile } from "@/lib/power-profile";
import { readPhysiologyWithStatus, resolveHrZones, resolvePowerZones } from "@/lib/physiology";
import { assessPhysiologyFreshnessFromReads, readPhysiologyStatus } from "@/lib/physiology-freshness";
import {
  calculateDailyTarget,
  calibrateNeat,
  desiredWeightTrend,
  isRestDayFor,
  nonDerivedNeatCalibration,
  resolveBuffer,
  exerciseBurn,
  resolveNutritionModel,
  restingKcalPerHourOf,
  smoothedCurrentWeightKg,
  trustedDayTypeSplit,
  weightTrendFromWellness,
  WEIGHT_TREND_LONG_WINDOW_DAYS,
  DEFAULT_NEAT_MULTIPLIER,
  NEAT_PLAUSIBLE_MIN,
  NEAT_PLAUSIBLE_MAX,
} from "@/lib/nutrition";
import { localToday, ageYearsFrom } from "@/lib/date";
import type { AthleteProfile, NeatCalibration } from "@/lib/types";
import type { Zone } from "@/lib/zones";

// GET returns the parsed athlete_profile.md snapshot plus Intervals.icu auto-sync data.
// Performance, goals and weakpoints all come from the markdown — no re-entry needed.
export async function GET() {
  const [profile, sync, athleteMd, physRead, physStatusRead] = await Promise.all([
    readAthleteProfile(),
    readLastSync(),
    parseAthleteMd(),
    readPhysiologyWithStatus(),
    readPhysiologyStatus(),
  ]);
  const physStore = physRead.store;

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

  const today = localToday();
  const weighIns = (sync?.wellness ?? [])
    .filter((w) => w.weightKg !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
  const rawLatestWeightKg = weighIns[0]?.weightKg ?? null;
  const weightTrend7Day = sync ? weightTrendFromWellness(sync.wellness) : null;
  const weightTrendLong = sync ? weightTrendFromWellness(sync.wellness, WEIGHT_TREND_LONG_WINDOW_DAYS) : null;
  // GOAL comparisons (resolveBuffer's currentKg) use the smoothed figure, not the latest single
  // weigh-in — a raw reading swings ±0.5–1 kg and was flipping the buffer across the deadband
  // boundary depending on which weigh-in happened to be last (I2). resolveNutritionModel's
  // latestWeightKg below is DELIBERATELY left on the raw latest reading — RMR should track current mass.
  // smoothedWeightKgRaw stays nullable (no weigh-ins ever) for the derivation panel; the goal-comparison
  // variant below falls back to the manual performance.weightKg so resolveBuffer always has a number.
  const smoothedWeightKgRaw = smoothedCurrentWeightKg(sync?.wellness ?? [], today);
  const smoothedWeightKgForGoal = smoothedWeightKgRaw ?? profile.performance.weightKg;

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

  // Hoisted so the derivation panel (Task 5) can reuse the exact same values the response already
  // surfaces via `bufferStatus`/`nutritionModel` below, rather than recomputing (and risking drift).
  // buffer-redesign-feedforward Task 2: resolveBuffer replaces adjustBuffer as the primary entry
  // point — goal-rate feed-forward when profile.nutrition.neat is trustworthy, else the same
  // trend-servo adjustBuffer used to be, but seeded from the goal surplus rather than the retired
  // `profile.nutrition.buffer` setting. `profile.nutrition.buffer` is still passed through (the
  // `legacyBuffer` parameter) but resolveBuffer never reads it in EITHER mode — kept only so the
  // signature documents where the retired setting used to matter.
  const bufferStatus = resolveBuffer(
    profile.nutrition.neat,
    smoothedWeightKgForGoal,
    profile.nutrition.targetWeightKg,
    profile.nutrition.targetRateKgPerWeek,
    weightTrend7Day,
    weightTrendLong,
    profile.nutrition.buffer
  );
  // isRestDayToday: whether today's synced activity burn (if any) resolves to 0 — same activeBurn
  // convention calculateDailyTarget's isRestDay already uses elsewhere (lib/nutrition.ts's isRestDayFor).
  // Hoisted into a variable (rather than inlined per call site) so DT Task 3's derivation panel can
  // reuse the EXACT boolean resolveNutritionModel picked its rest/train multiplier from, instead of a
  // second call that could in principle resolve differently.
  const isRestDayToday = isRestDayFor(sync?.activities ?? [], today);
  const nutritionModel = resolveNutritionModel(
    profile,
    rawLatestWeightKg ?? profile.performance.weightKg,
    today,
    isRestDayToday
  );
  const rmr = nutritionModel.kind === "derived" ? nutritionModel.rmr : null;
  // NET of each activity's resting-equivalent cost, at the rate this model's calibration basis
  // dictates — the same figure calculateDailyTarget is about to add to k×RMR, so the panel's
  // "+ N activity kcal" line names the number actually used, not the pre-netting source figure.
  const restingKcalPerHour = restingKcalPerHourOf(nutritionModel);
  let todayActiveBurnKcal: number | null = 0;
  for (const activity of (sync?.activities ?? []).filter((a) => a.date === today)) {
    const burn = exerciseBurn(activity, restingKcalPerHour);
    if (burn === null) {
      todayActiveBurnKcal = null;
      break;
    }
    todayActiveBurnKcal += burn.kcal;
  }
  const todayPlan = todayActiveBurnKcal === null
    ? null
    : calculateDailyTarget(todayActiveBurnKcal, nutritionModel, bufferStatus.bufferApplied, isRestDayToday);
  const maintenanceKcal = nutritionModel.kind === "derived"
    ? Math.round(nutritionModel.neatMultiplier * nutritionModel.rmr)
    : null;
  // Review fix #5: a LIVE calibration-state check, distinct from `profile.nutrition.neat` (the
  // persisted record actually driving the daily-target formula). calibrateNeat's `stale` sentinel is
  // deliberately never persisted — the /api/sync guard is right to refuse it, since a batch-transfer
  // gap must not silently revert a good prior solve to the population default. But that left `stale`
  // permanently unreachable: nothing else ever called calibrateNeat, so the UI's dedicated "your last
  // transfer is too old" branch (neatWhy in AthleteProfileForm.tsx) was dead code and the on-disk
  // `stale` flag was always false. Re-solving here (read-only, nothing written) surfaces the REASON for
  // display without resurrecting the persistence problem.
  const liveNeat =
    rmr !== null ? calibrateNeat(sync?.wellness ?? [], sync?.activities ?? [], rmr, today) : null;
  const neatStale = liveNeat !== null && liveNeat.source === "default" && liveNeat.stale;
  const desiredTrendKgPerWeek = desiredWeightTrend(
    smoothedWeightKgForGoal,
    profile.nutrition.targetWeightKg,
    profile.nutrition.targetRateKgPerWeek
  );
  const physiologyFreshness = assessPhysiologyFreshnessFromReads(physRead, physStatusRead, today);

  return NextResponse.json({
    nutrition: profile.nutrition,
    goals: profile.goals,
    weakpoints: profile.weakpoints,
    goalsMigratedAt: profile.goalsMigratedAt,
    // The RMR inputs, exposed so the profile UI can pre-populate its form and detect the
    // pre-migration state (resolveNutritionModel below is the actual migration gate; these three
    // fields are just their current on-disk value for the form to show/edit).
    performance: {
      dateOfBirth: profile.performance.dateOfBirth,
      heightCm: profile.performance.heightCm,
      sex: profile.performance.sex,
    },
    ftpStaleDays: Number.isFinite(ftpStaleDays) ? ftpStaleDays : null,
    physiologyFreshness,
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
      rawLatestWeightKg
    ),
    weightHistory: (sync?.wellness ?? [])
      .filter((w) => w.weightKg !== null)
      .map((w) => ({ date: w.date, weightKg: w.weightKg as number }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-56), // last 8 weeks
    latestWeightKg: rawLatestWeightKg,
    autoSync: {
      syncedAt: sync?.syncedAt ?? null,
      latestWeightKg: rawLatestWeightKg,
      latestWeightDate: weighIns[0]?.date ?? null,
      weightTrend7Day,
      avgRpe7Day:
        recentRpes.length > 0
          ? Math.round((recentRpes.reduce((a, b) => a + b, 0) / recentRpes.length) * 10) / 10
          : null,
      lastKcalConsumed: lastKcal?.kcalConsumed ?? null,
      lastKcalDate: lastKcal?.date ?? null,
    },
    bufferStatus,
    nutritionModel,
    // Task 5: the full derivation chain, so the profile UI can show the system working (RMR → NEAT →
    // maintenance → weight/goal → observed trend → buffer → today's target) instead of a bare number.
    derivation: {
      rmr,
      neat: profile.nutrition.neat,
      neatStale,
      // DT Task 3: null until the day-type split has enough data to adopt (see DayTypeNeat's doc
      // comment in lib/types.ts) — the derivation panel's single-flat-k row is the no-regression
      // default and only switches to the rest/train view once this is non-null.
      dayTypeNeat: profile.nutrition.dayTypeNeat,
      isRestDayToday,
      // DT Task 6: whether the split matching `isRestDayToday` above is the one ACTUALLY driving
      // today's target, vs. merely being displayed. Computed via the exact same trustedDayTypeSplit
      // call resolveNutritionModel makes internally (not a second independent read of the confidence
      // field) — the whole point of that shared helper is that the derivation panel and the real
      // prescription can never disagree about which number is in force. False whenever dayTypeNeat is
      // null (nothing to be trusted or not), an override is active, or the active side's own
      // confidence is "low" — the profile UI must not bold a split value, or imply it's active, in any
      // of those cases when the real formula has actually fallen back to pooled.
      dayTypeSplitTrusted: trustedDayTypeSplit(profile.nutrition.neat, profile.nutrition.dayTypeNeat, isRestDayToday) !== null,
      maintenanceKcal,
      todayPlan,
      todayActiveBurnKcal,
      smoothedWeightKg: smoothedWeightKgRaw,
      rawLatestWeightKg,
      targetWeightKg: profile.nutrition.targetWeightKg,
      trendShortKgPerWeek: weightTrend7Day,
      trendLongKgPerWeek: weightTrendLong,
      desiredTrendKgPerWeek,
      buffer: bufferStatus,
    },
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
  // `neat` is deliberately NOT one of this route's editable fields via the base four below — it's
  // calibrateNeat's output (Phase 2), adopted on sync — so it's carried forward from the current
  // on-disk value inside the mutate callback, EXCEPT for the one deliberate override path
  // (`neatMultiplier`, Step 5) validated separately just below.
  // buffer-redesign-feedforward Task 2: `buffer` is EXCLUDED here — it's retired as an athlete-
  // editable field (see the `hasBaseNutritionFields`/validation block below) and is always carried
  // forward from the on-disk value inside the mutate callback, never from this route's input.
  // DT Task 2: `dayTypeNeat` is EXCLUDED for the same reason as `neat` — it's calibrateNeatByDayType's
  // output, adopted on sync under the same override guard, never an athlete-typed field here.
  let nutrition: Omit<AthleteProfile["nutrition"], "neat" | "buffer" | "dayTypeNeat"> | undefined;
  // Step 5: manual override of the calibrated NEAT multiplier. Accepted independently of the base
  // four nutrition fields — `{ nutrition: { neatMultiplier } }` alone is a valid PUT, so the
  // derivation panel can set/clear just this without resubmitting the whole nutrition form.
  let neatOverride: { multiplier: number; solvedAt: string } | { reset: true } | undefined;
  if (b.nutrition !== undefined) {
    const input = b.nutrition as Record<string, unknown>;
    if (input.neatMultiplier !== undefined) {
      const v = input.neatMultiplier;
      if (v === null) {
        // Reset: "revert to derived" — re-derive from the athlete's current sync data below, falling
        // back to the population default only if that solve doesn't come back. An athlete clearing
        // their manual value also resumes auto-calibration on the next sync either way.
        neatOverride = { reset: true };
      } else if (typeof v === "number" && Number.isFinite(v) && v >= NEAT_PLAUSIBLE_MIN && v <= NEAT_PLAUSIBLE_MAX) {
        neatOverride = { multiplier: v, solvedAt: new Date().toISOString() };
      } else {
        return NextResponse.json(
          { error: `neatMultiplier must be null or a finite number between ${NEAT_PLAUSIBLE_MIN} and ${NEAT_PLAUSIBLE_MAX}.` },
          { status: 400 }
        );
      }
    }
    // `buffer` is deliberately NOT destructured for validation — Task 2 (buffer-redesign-feedforward)
    // retires it as an athlete-editable field. A payload that still includes it (an older cached
    // client) is accepted without erroring; it just never reaches `hasBaseNutritionFields` or the
    // constructed `nutrition` object below, so it can no longer write to the persisted setting.
    const { baseCalories, restDayTarget, targetWeightKg, targetRateKgPerWeek } = input;
    const hasBaseNutritionFields =
      baseCalories !== undefined ||
      restDayTarget !== undefined ||
      targetWeightKg !== undefined ||
      targetRateKgPerWeek !== undefined;
    if (hasBaseNutritionFields) {
      const pos = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
      if (!pos(baseCalories)) return NextResponse.json({ error: "baseCalories must be a positive number." }, { status: 400 });
      if (!pos(restDayTarget)) return NextResponse.json({ error: "restDayTarget must be a positive number." }, { status: 400 });
      if (!pos(targetWeightKg)) return NextResponse.json({ error: "targetWeightKg must be a positive number." }, { status: 400 });
      // Validate targetRateKgPerWeek: accept null or a finite number with |v| <= 1.5
      if (targetRateKgPerWeek !== undefined) {
        if (targetRateKgPerWeek !== null && !(typeof targetRateKgPerWeek === "number" && Number.isFinite(targetRateKgPerWeek) && Math.abs(targetRateKgPerWeek) <= 1.5)) {
          return NextResponse.json({ error: "targetRateKgPerWeek must be null or a finite number with absolute value ≤ 1.5." }, { status: 400 });
        }
      }
      nutrition = {
        baseCalories: baseCalories as number,
        restDayTarget: restDayTarget as number,
        targetWeightKg: targetWeightKg as number,
        targetRateKgPerWeek: (targetRateKgPerWeek ?? null) as number | null,
      };
    }
  }

  // RMR inputs live on `performance`, saved independently of the nutrition block.
  let performancePatch: Partial<AthleteProfile["performance"]> | undefined;
  if (b.performance !== undefined) {
    const input = b.performance as Record<string, unknown>;
    const patch: Partial<AthleteProfile["performance"]> = {};
    if (input.dateOfBirth !== undefined) {
      const dob = input.dateOfBirth;
      if (dob !== null && (typeof dob !== "string" || ageYearsFrom(dob, localToday()) === null)) {
        return NextResponse.json({ error: "dateOfBirth must be a valid past YYYY-MM-DD date, or null." }, { status: 400 });
      }
      patch.dateOfBirth = dob as string | null;
    }
    if (input.heightCm !== undefined) {
      const h = input.heightCm;
      if (h !== null && !(typeof h === "number" && Number.isFinite(h) && h > 50 && h < 260)) {
        return NextResponse.json({ error: "heightCm must be between 50 and 260, or null." }, { status: 400 });
      }
      patch.heightCm = h as number | null;
    }
    if (input.sex !== undefined) {
      const s = input.sex;
      if (s !== null && s !== "male" && s !== "female") {
        return NextResponse.json({ error: 'sex must be "male", "female", or null.' }, { status: 400 });
      }
      patch.sex = s as "male" | "female" | null;
    }
    performancePatch = patch;
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

  // "Revert to derived" (Step 5's reset path) must actually re-derive, not just fall back to the
  // population prior — the button says "derived", so landing on DEFAULT_NEAT_MULTIPLIER while a live
  // solve is available silently cost the athlete real food until their next sync. Read outside the
  // lock (mirrors /api/sync's best-effort recalibration block, which needs the same wellness/activities/
  // RMR inputs); calibrateNeat itself is a pure function, so only the reads need awaiting here.
  let revertRecord: NeatCalibration | null = null;
  if (neatOverride !== undefined && "reset" in neatOverride) {
    const [profileForRevert, sync] = await Promise.all([readAthleteProfile(), readLastSync()]);
    const today = localToday();
    const latestWeightKgForRevert =
      (sync?.wellness ?? [])
        .filter((w) => w.weightKg !== null)
        .sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg ?? profileForRevert.performance.weightKg;
    // Only `.kind`/`.rmr` are read below (re-deriving `neat`, not `dayTypeNeat`), so isRestDayToday
    // doesn't affect this call's outcome — computed anyway for consistency with every other call site.
    const modelForRevert = resolveNutritionModel(
      profileForRevert,
      latestWeightKgForRevert,
      today,
      isRestDayFor(sync?.activities ?? [], today)
    );
    // Only the derived model carries an RMR to calibrate against — a legacy (pre-migration) profile has
    // nothing for calibrateNeat to solve relative to, same guard /api/sync uses.
    if (modelForRevert.kind === "derived") {
      const neatResult = calibrateNeat(sync?.wellness ?? [], sync?.activities ?? [], modelForRevert.rmr, today);
      if (neatResult !== null && neatResult.source === "derived") revertRecord = neatResult;
    }
  }

  // HR-50: mutates the RAW stored profile, never the live-overlaid one readAthleteProfile returns —
  // baking physiology-sync-derived FTP/HR back into athlete.json as if it were saved user input was
  // the actual bug. Locked, so a concurrent PUT (or the goals-migration self-heal write) can't
  // clobber this one.
  const updated = await updateAthleteProfile((current) => ({
    ...current,
    // Preserve the athlete's existing calibration (neat) by default — this route's base four
    // nutrition fields never touch it, so a plain `{ nutrition }` replace would silently wipe it out
    // on every unrelated nutrition-field save. `neatOverride` (Step 5) is the one deliberate exception.
    //
    // Both the reset and the manual-override branches funnel through nonDerivedNeatCalibration rather
    // than spreading `...current.nutrition.neat` — the previous record's solve-only fields (imbalance/
    // windowDays/loggedDays/weighIns/confidence) describe a DIFFERENT solve (or no solve at all) and
    // must not survive onto a record whose `source` no longer says "derived".
    //
    // buffer-redesign-feedforward Task 2: spreads `current.nutrition` FIRST, then `nutrition` on top
    // (rather than the old `nutrition ?? current.nutrition` either/or) — `nutrition` never carries
    // `buffer` anymore, so `buffer` always survives from `current.nutrition` regardless of what this
    // PUT's payload contained. The retired setting can no longer be written by any client, old or new.
    ...(nutrition !== undefined || neatOverride !== undefined
      ? {
          nutrition: {
            ...current.nutrition,
            ...nutrition,
            neat:
              neatOverride === undefined
                ? current.nutrition.neat
                : "reset" in neatOverride
                  ? (revertRecord ?? nonDerivedNeatCalibration("default", DEFAULT_NEAT_MULTIPLIER))
                  : nonDerivedNeatCalibration("override", neatOverride.multiplier, neatOverride.solvedAt),
            // Both the reset and manual-override branches also null out `dayTypeNeat` — it's a
            // solve-derived sibling of `neat` (see the comment above) computed from the SAME kind of
            // stale-solve data, and `trustedDayTypeSplit` (lib/nutrition.ts) requires — among other
            // things — `neat.source !== "override"` before it will trust it. On reset, `neat.source`
            // becomes "default"/"derived" (not "override"), so an untouched `dayTypeNeat` would
            // immediately resume driving the daily target off a split computed before whatever the
            // athlete just changed — silently, with no
            // `stale` flag to warn the UI. Falling back to `null` (not re-deriving inline) is correct
            // because `resolveNutritionModel` already falls back to the fresh pooled `neat.multiplier`
            // set just above, and the next sync's `calibrateNeatByDayType` call re-solves the real
            // split from current data anyway.
            dayTypeNeat: neatOverride === undefined ? current.nutrition.dayTypeNeat : null,
          },
        }
      : {}),
    ...(goals !== undefined ? { goals } : {}),
    ...(weakpoints !== undefined ? { weakpoints } : {}),
    performance: performancePatch ? { ...current.performance, ...performancePatch } : current.performance,
  }));
  return NextResponse.json({
    nutrition: updated.nutrition,
    goals: updated.goals,
    weakpoints: updated.weakpoints,
    performance: updated.performance,
  });
}
