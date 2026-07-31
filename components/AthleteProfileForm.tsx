"use client";
// AI: already flagged as a split candidate (docs/systems/08-frontend.md#known-rough-edges) --
// five distinct sections in one file. SeasonSection was already extracted from here; prefer the
// same move over growing this file further.

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, timeAgo } from "@/lib/client-api";
import { Card, PrimaryButton, SectionDivider, Skeleton, SkeletonScreen } from "./ui";
import PowerCurveChart from "./PowerCurveChart";
import IfBandOffsets from "./IfBandOffsets";
import type { AthleteMdSnapshot } from "@/lib/kb-loader";
import type { NeatCalibration, NutritionSettings, PowerCurvePoint, PowerProfile, PowerSystem, SeasonFocus } from "@/lib/types";
import type { IfBandOffsetRow } from "@/lib/calibration";
import { groupGoalsByFocus } from "@/lib/profile-goals";
import { FOCUS_LABELS } from "@/lib/season";
import {
  BUFFER_MAX_KCAL,
  BUFFER_MIN_KCAL,
  MAX_ADJUSTMENT_STEP_KCAL,
  NEAT_PLAUSIBLE_MAX,
  NEAT_PLAUSIBLE_MIN,
  SMOOTHED_WEIGHT_WINDOW_DAYS,
  WEIGHT_TREND_LONG_WINDOW_DAYS,
  WEIGHT_TREND_WINDOW_DAYS,
} from "@/lib/nutrition";
import type { BufferAdjustment } from "@/lib/nutrition";
import { ageYearsFrom, localToday } from "@/lib/date";

interface PerformanceRmrFields {
  dateOfBirth: string | null;
  heightCm: number | null;
  sex: "male" | "female" | null;
}

type NutritionModel =
  | { kind: "derived"; rmr: number; neatMultiplier: number; weightKg: number; targetWeightKg: number; buffer: number }
  | { kind: "legacy"; baseCalories: number; restDayTarget: number; weightKg: number; targetWeightKg: number; buffer: number };

interface AutoSyncInfo {
  syncedAt: string | null;
  latestWeightKg: number | null;
  latestWeightDate: string | null;
  weightTrend7Day: number | null;
  avgRpe7Day: number | null;
  lastKcalConsumed: number | null;
  lastKcalDate: string | null;
}

interface WeightPoint {
  date: string;
  weightKg: number;
}

interface PhysiologyChange {
  fromFtp: number;
  toFtp: number;
  date: string;
}

// Task 5: the full derivation chain the profile page renders as an explicit `<dl>` — everything
// GET /api/profile's `derivation` object exposes (see app/api/profile/route.ts). `buffer` re-uses the
// exact same BufferAdjustment the top-level `bufferStatus` field carries (computed once, server-side).
interface Derivation {
  rmr: number | null;
  neat: NeatCalibration;
  maintenanceKcal: number | null;
  smoothedWeightKg: number | null;
  rawLatestWeightKg: number | null;
  targetWeightKg: number;
  trendShortKgPerWeek: number | null;
  trendLongKgPerWeek: number | null;
  desiredTrendKgPerWeek: number;
  buffer: BufferAdjustment;
}

interface ProfileResponse {
  nutrition: NutritionSettings;
  nutritionModel: NutritionModel;
  performance: PerformanceRmrFields;
  ftpStaleDays: number | null;
  physiologyChange: PhysiologyChange | null;
  physiologySource: "intervals" | "manual" | null;
  athleteMd: AthleteMdSnapshot;
  autoSync: AutoSyncInfo;
  bufferStatus: BufferAdjustment;
  derivation: Derivation;
  syncedPowerCurve: PowerCurvePoint[];
  powerProfile: PowerProfile | null;
  latestWeightKg: number | null;
  weightHistory: WeightPoint[];
  goals: Array<{ goal: string; target: string; focus: SeasonFocus | "general" }>;
  weakpoints: Array<{ weakpoint: string; detail: string }>;
}

type SaveState = { state: "idle" | "saving" | "saved" } | { state: "error"; message: string };

const POWER_CURVE_LABELS: Record<number, string> = {
  5: "5s", 15: "15s", 30: "30s", 60: "1 min",
  120: "2 min", 300: "5 min", 1200: "20 min", 1800: "30 min", 3600: "60 min",
};

// Track A — rider-profile display labels. The blurb mirrors the one fed to generation.
const RIDER_TYPE_BLURB: Record<PowerProfile["riderType"], string> = {
  sprinter: "Explosive short power; drops off over sustained efforts.",
  puncheur: "Strong over 1–5 min surges relative to your engine.",
  "time-trialist": "Flat curve — sustained power with little punch above threshold.",
  "all-rounder": "Balanced across the power-duration curve.",
};
const SYSTEM_LABELS: Record<PowerSystem, string> = {
  neuromuscular: "Sprint (5s)",
  anaerobic: "Anaerobic (1 min)",
  vo2max: "VO2max (5 min)",
  threshold: "Threshold (20 min)",
};

// ---------- Shared helpers ----------

// The second-brain split, made visible (C): `synced` sections are measured by Intervals.icu (cyan
// badge, read-only here); `editHref` sections are owned intent the athlete edits. The two never overlap
// — a synced number is never hand-edited, an owned one is never synced.
function Section({
  title,
  editHref,
  synced,
  children,
}: {
  title: string;
  editHref?: string;
  synced?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card
      title={title}
      action={
        synced ? (
          <span
            title="Measured by Intervals.icu — synced, not editable here"
            className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-700 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff]"
          >
            synced
          </span>
        ) : editHref ? (
          <Link href={editHref} className="whitespace-nowrap text-xs text-cyan-700 hover:underline dark:text-[#00d4ff]">
            Edit →
          </Link>
        ) : undefined
      }
    >
      {children}
    </Card>
  );
}

// Task 5 derivation panel — one row of the `<dl>` chain: label + value together as the term, the
// one-line "why" (plus any extra warning/context block) as the description. Every number the nutrition
// formula runs on gets a row here so the chain is visible end to end, not just its final output.
function DerivationRow({
  label,
  value,
  why,
  extra,
}: {
  label: string;
  value: React.ReactNode;
  why: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div className="py-2">
      <dt className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
        <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">{value}</span>
      </dt>
      <dd className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        {why}
        {extra}
      </dd>
    </div>
  );
}

// Signed fixed-point formatting shared by every trend/rate/buffer row: "+" for positive, the native
// "-" for negative, nothing for exactly zero (an unsigned "0.0" reads as neutral; a signed "+0.0" would
// falsely imply a direction).
function fmtSigned(v: number, decimals = 2): string {
  const s = v.toFixed(decimals);
  return v > 0 ? `+${s}` : s;
}

// The NEAT multiplier row's "why" — confidence rendered WITH the evidence behind it (window/logged
// days/weigh-ins), never as a bare word, and "stale" kept distinct from "not enough data yet" (see
// NeatCalibration.stale in lib/types.ts — same good-data-but-old-transfer distinction).
function neatWhy(neat: NeatCalibration): string {
  if (neat.source === "override") {
    return "manually overridden — no longer tracking your logged data.";
  }
  if (neat.source === "default" && neat.stale) {
    return "your logging looks good, but your last transfer is too old to use — population default until you sync more recent logs.";
  }
  if (neat.source === "default") {
    return "population default — not enough logged days yet.";
  }
  return `derived from your last ${neat.windowDays ?? "?"} days (${neat.loggedDays ?? "?"} days logged, ${neat.weighIns ?? "?"} weigh-ins) — ${neat.confidence} confidence.`;
}

// Step 3: the nutrition Edit form's field list, incl. targetRateKgPerWeek (signed, step 0.05,
// -1.5…1.5, blank → derive from the gap). Module-level so it isn't rebuilt every render.
const NUTRITION_EDIT_FIELDS: Array<{
  key: "buffer" | "targetWeightKg" | "targetRateKgPerWeek";
  label: string;
  unit: string;
  min: number;
  max?: number;
  step?: number;
  hint: string;
}> = [
  { key: "buffer", label: "Goal buffer", unit: "kcal", min: BUFFER_MIN_KCAL, hint: `${BUFFER_MIN_KCAL}–${BUFFER_MAX_KCAL}, negative = deficit` },
  { key: "targetWeightKg", label: "Target weight", unit: "kg", min: 0, hint: "min 0" },
  { key: "targetRateKgPerWeek", label: "Target rate", unit: "kg/week", min: -1.5, max: 1.5, step: 0.05, hint: "blank = derive from the gap" },
];

// ---------- Main component ----------

export default function AthleteProfileForm({ ifBandRows = [] }: { ifBandRows?: IfBandOffsetRow[] }) {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // targetRateKgPerWeek is intentionally NOT run through the generic parsed-number loop in
  // saveNutrition below — "" is a valid value here (→ null, "derive from the gap"), not a parse error.
  const [nut, setNut] = useState({ buffer: "", targetWeightKg: "", targetRateKgPerWeek: "" });
  const [rmrInputs, setRmrInputs] = useState({ dateOfBirth: "", heightCm: "", sex: "" });
  const [saveState, setSaveState] = useState<SaveState>({ state: "idle" });
  const [goals, setGoals] = useState<ProfileResponse["goals"]>([]);
  const [weakpoints, setWeakpoints] = useState<ProfileResponse["weakpoints"]>([]);
  const [goalsSaveState, setGoalsSaveState] = useState<SaveState>({ state: "idle" });
  // NEAT override (Step 4) — its own field/save-state pair, independent of the nutrition Edit form
  // above: the brief calls for the same separate-save-path pattern the other sections already follow.
  const [neatInput, setNeatInput] = useState("");
  const [neatSaveState, setNeatSaveState] = useState<SaveState>({ state: "idle" });

  // Mount-load the profile + nutrition fields. Inline async IIFE (setState lands after the await,
  // guarded by a cancelled flag) so it reads as a fetch-on-mount, not a synchronous setState in
  // the effect body.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await api<ProfileResponse>("/api/profile");
        if (cancelled) return;
        setData(response);
        setGoals(response.goals);
        setWeakpoints(response.weakpoints);
        const n = response.nutrition;
        setNut({
          buffer: String(n.buffer),
          targetWeightKg: String(n.targetWeightKg),
          targetRateKgPerWeek: n.targetRateKgPerWeek != null ? String(n.targetRateKgPerWeek) : "",
        });
        setRmrInputs({
          dateOfBirth: response.performance?.dateOfBirth ?? "",
          heightCm: response.performance?.heightCm != null ? String(response.performance.heightCm) : "",
          sex: response.performance?.sex ?? "",
        });
        setNeatInput(String(response.derivation.neat.multiplier));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't load your profile — try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveNutrition = async () => {
    if (!data) return;
    const parsed: Record<string, number> = {};
    for (const [key, value] of Object.entries(nut)) {
      if (key === "targetRateKgPerWeek") continue; // handled below — "" is valid here (→ null)
      const n = Number(value);
      if (value.trim() === "" || !Number.isFinite(n)) {
        setSaveState({ state: "error", message: `"${key}" is not a valid number.` });
        return;
      }
      parsed[key] = n;
    }
    let targetRateKgPerWeek: number | null = null;
    if (nut.targetRateKgPerWeek.trim() !== "") {
      const r = Number(nut.targetRateKgPerWeek);
      if (!Number.isFinite(r) || Math.abs(r) > 1.5) {
        setSaveState({ state: "error", message: "Rate must be blank (derive from the gap) or between -1.5 and 1.5 kg/week." });
        return;
      }
      targetRateKgPerWeek = r;
    }
    setSaveState({ state: "saving" });
    try {
      // baseCalories/restDayTarget are no longer editable here, but the persisted nutrition record
      // still carries them (deprecated, legacy-model fallback) — round-trip the current on-disk
      // values unchanged rather than dropping them, which would fail the route's validation and, if
      // it didn't, would silently erase a pre-migration athlete's hand-set numbers.
      await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          nutrition: {
            ...parsed,
            targetRateKgPerWeek,
            baseCalories: data.nutrition.baseCalories,
            restDayTarget: data.nutrition.restDayTarget,
          },
        }),
      });
      setSaveState({ state: "saved" });
      const fresh = await api<ProfileResponse>("/api/profile");
      setData(fresh);
    } catch (err) {
      setSaveState({ state: "error", message: err instanceof Error ? err.message : "Couldn't save — try again." });
    }
  };

  const saveRmrInputs = async () => {
    const heightCm = Number(rmrInputs.heightCm);
    if (!rmrInputs.dateOfBirth || !Number.isFinite(heightCm) || heightCm <= 0 || !rmrInputs.sex) {
      setSaveState({ state: "error", message: "Date of birth, height and sex are all needed to compute your RMR." });
      return;
    }
    setSaveState({ state: "saving" });
    try {
      await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          performance: { dateOfBirth: rmrInputs.dateOfBirth, heightCm, sex: rmrInputs.sex },
        }),
      });
      setSaveState({ state: "saved" });
      setData(await api<ProfileResponse>("/api/profile"));
    } catch (err) {
      setSaveState({ state: "error", message: err instanceof Error ? err.message : "Couldn't save — try again." });
    }
  };

  // Step 4: manual NEAT override — its own save path (PUT accepts `neatMultiplier` alone, per the
  // route's Step-5 comment), independent of the base-four nutrition Edit form above.
  const saveNeatOverride = async () => {
    const v = Number(neatInput);
    if (!Number.isFinite(v) || v < NEAT_PLAUSIBLE_MIN || v > NEAT_PLAUSIBLE_MAX) {
      setNeatSaveState({ state: "error", message: `Must be a number between ${NEAT_PLAUSIBLE_MIN} and ${NEAT_PLAUSIBLE_MAX}.` });
      return;
    }
    setNeatSaveState({ state: "saving" });
    try {
      await api("/api/profile", { method: "PUT", body: JSON.stringify({ nutrition: { neatMultiplier: v } }) });
      setNeatSaveState({ state: "saved" });
      setData(await api<ProfileResponse>("/api/profile"));
    } catch (err) {
      setNeatSaveState({ state: "error", message: err instanceof Error ? err.message : "Couldn't save — try again." });
    }
  };

  const revertNeatOverride = async () => {
    setNeatSaveState({ state: "saving" });
    try {
      await api("/api/profile", { method: "PUT", body: JSON.stringify({ nutrition: { neatMultiplier: null } }) });
      setNeatSaveState({ state: "saved" });
      const fresh = await api<ProfileResponse>("/api/profile");
      setData(fresh);
      setNeatInput(String(fresh.derivation.neat.multiplier));
    } catch (err) {
      setNeatSaveState({ state: "error", message: err instanceof Error ? err.message : "Couldn't revert — try again." });
    }
  };

  const updateGoal = (index: number, patch: Partial<ProfileResponse["goals"][number]>) => {
    setGoals((gs) => gs.map((g, i) => (i === index ? { ...g, ...patch } : g)));
    if (goalsSaveState.state === "saved") setGoalsSaveState({ state: "idle" });
  };
  const addGoal = () => {
    setGoals((gs) => [...gs, { goal: "", target: "", focus: "general" }]);
  };
  const removeGoal = (index: number) => {
    setGoals((gs) => gs.filter((_, i) => i !== index));
  };

  const updateWeakpoint = (index: number, patch: Partial<ProfileResponse["weakpoints"][number]>) => {
    setWeakpoints((ws) => ws.map((w, i) => (i === index ? { ...w, ...patch } : w)));
    if (goalsSaveState.state === "saved") setGoalsSaveState({ state: "idle" });
  };
  const addWeakpoint = () => {
    setWeakpoints((ws) => [...ws, { weakpoint: "", detail: "" }]);
  };
  const removeWeakpoint = (index: number) => {
    setWeakpoints((ws) => ws.filter((_, i) => i !== index));
  };

  const saveGoals = async () => {
    if (goals.some((g) => !g.goal.trim())) {
      setGoalsSaveState({ state: "error", message: "Goal text is required." });
      return;
    }
    if (weakpoints.some((w) => !w.weakpoint.trim())) {
      setGoalsSaveState({ state: "error", message: "Weakpoint text is required." });
      return;
    }
    setGoalsSaveState({ state: "saving" });
    try {
      await api("/api/profile", { method: "PUT", body: JSON.stringify({ goals, weakpoints }) });
      setGoalsSaveState({ state: "saved" });
      const fresh = await api<ProfileResponse>("/api/profile");
      setGoals(fresh.goals);
      setWeakpoints(fresh.weakpoints);
    } catch (err) {
      setGoalsSaveState({ state: "error", message: err instanceof Error ? err.message : "Couldn't save — try again." });
    }
  };

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        {loadError}
      </div>
    );
  }
  if (!data) {
    // S3-1: title row → the side-by-side PRs/rider-profile fold (same grid as the loaded page) →
    // the next section card, so the tall page doesn't leap in from a single centered line.
    return (
      <SkeletonScreen className="space-y-5">
        <div>
          <Skeleton className="h-6 w-36" />
          <Skeleton className="mt-1.5 h-4 w-96 max-w-full" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <Skeleton className="h-72" />
          <Skeleton className="h-56" />
        </div>
        <Skeleton className="h-48" />
      </SkeletonScreen>
    );
  }

  const { athleteMd, autoSync, derivation, syncedPowerCurve, powerProfile, latestWeightKg } = data;

  // Rider profile + Power PRs as standalone sections, composed below into a side-by-side row when both
  // are available (FB-2026-06-30): curve + PR grid in one half, the rider read in the other.
  const riderProfileSection =
    powerProfile && powerProfile.confident ? (
      <Section title="Rider profile" synced>
        <p className="mb-3 text-[11px] text-zinc-500 dark:text-zinc-400">
          auto-derived from your power-curve shape · a hint the coach plans around, not a fixed label
        </p>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="rounded-full bg-cyan-50 px-2.5 py-0.5 text-sm font-semibold capitalize text-cyan-700 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff]">
            {powerProfile.riderType}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{RIDER_TYPE_BLURB[powerProfile.riderType]}</span>
        </div>
        {powerProfile.easyWin && (
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
            <span className="font-semibold">Easy win:</span> your {SYSTEM_LABELS[powerProfile.easyWin.system].toLowerCase()} power
            is the most depressed relative to your own engine — a worthwhile micro-target.
          </p>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {powerProfile.systems.map((s) => {
            const pct = Math.round((s.relativeStrength - 1) * 100);
            const strong = pct >= 6;
            const weak = pct <= -6;
            return (
              <div key={s.system} className="rounded bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{SYSTEM_LABELS[s.system]}</p>
                <p
                  className={
                    strong
                      ? "mt-0.5 text-sm font-semibold text-cyan-700 dark:text-[#00d4ff]"
                      : weak
                        ? "mt-0.5 text-sm font-semibold text-amber-700 dark:text-amber-400"
                        : "mt-0.5 text-sm font-medium text-zinc-600 dark:text-zinc-300"
                  }
                >
                  {pct > 0 ? "+" : ""}{pct}%
                </p>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">vs expected</p>
              </div>
            );
          })}
        </div>
      </Section>
    ) : null;

  const powerPRsSection =
    syncedPowerCurve.length > 0 || athleteMd.powerProfile.length > 0 ? (
      <Section title="Power PRs" synced={syncedPowerCurve.length > 0} editHref={syncedPowerCurve.length > 0 ? undefined : "/knowledge"}>
        {syncedPowerCurve.length > 0 ? (
          <>
            <p className="mb-3 text-[11px] text-zinc-500 dark:text-zinc-400">
              all-time best efforts · from Intervals.icu · {timeAgo(autoSync.syncedAt)}
              {/* UXA-59: PowerCurveChart draws nothing below 2 points (no line to scrub) — the
                  caption used to claim a drag interaction that wasn't there with exactly 1 point. */}
              {syncedPowerCurve.length > 1 ? " · drag the curve to read any duration" : ""}
            </p>
            <div className="mb-3">
              <PowerCurveChart points={syncedPowerCurve} weightKg={latestWeightKg} />
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {syncedPowerCurve.map((pt) => {
                const label = POWER_CURVE_LABELS[pt.durationSec] ?? `${pt.durationSec}s`;
                const wkg = latestWeightKg ? (pt.watts / latestWeightKg).toFixed(1) : null;
                return (
                  <div
                    key={pt.durationSec}
                    title={wkg ? `${wkg} W/kg` : undefined}
                    className={`rounded bg-zinc-50 px-3 py-1.5 dark:bg-zinc-900 ${wkg ? "cursor-help" : ""}`}
                  >
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</p>
                    <p className="font-mono text-sm font-semibold text-zinc-900 dark:text-[#00d4ff]">{pt.watts}W</p>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-500 dark:text-zinc-400">
                  <th className="pb-1 pr-4 font-medium">Duration</th>
                  <th className="pb-1 pr-4 font-medium">Watts</th>
                  <th className="pb-1 font-medium">W/kg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                {athleteMd.powerProfile.map((p) => (
                  <tr key={p.duration}>
                    <td className="py-1 pr-4 text-zinc-500 dark:text-zinc-400">{p.duration}</td>
                    <td className="py-1 pr-4 font-semibold text-zinc-800 dark:text-zinc-200">{p.watts}</td>
                    <td className="py-1 text-zinc-500 dark:text-zinc-400">{p.wkg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    ) : null;

  const hasPerf = !!(athleteMd.performanceData && Object.keys(athleteMd.performanceData).length > 0);
  const hasRiderRead = !!riderProfileSection || !!powerPRsSection || hasPerf || latestWeightKg != null;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Athlete profile</h1>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Your durable intent + synced physiology — what the coach plans around.</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <Link href="/knowledge" className="whitespace-nowrap text-xs text-cyan-700 hover:underline dark:text-[#00d4ff]">
            Edit athlete_profile.md →
          </Link>
          {/* UXA-50: no reciprocal link existed between this page and /model — AthleteStateCard's
              "why? →" points here into Profile-adjacent context, but nothing pointed back out. */}
          <Link href="/model" className="whitespace-nowrap text-xs text-cyan-700 hover:underline dark:text-[#00d4ff]">
            Your coaching model →
          </Link>
        </div>
      </div>

      {/* Physiology change note — FTP/zones synced from Intervals.icu */}
      {data.physiologyChange && (
        <div className="flex items-start gap-2.5 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 dark:border-[#00d4ff]/40 dark:bg-[#00d4ff]/10">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-cyan-500 dark:bg-[#00d4ff]" />
          <p className="text-sm text-cyan-900 dark:text-[#7fe7ff]">
            FTP changed {data.physiologyChange.fromFtp} → {data.physiologyChange.toFtp}W on{" "}
            {data.physiologyChange.date} — zones updated automatically from Intervals.icu.
          </p>
        </div>
      )}

      {/* FTP stale warning */}
      {data.ftpStaleDays !== null && data.ftpStaleDays > 90 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/60 dark:bg-amber-950/40">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
          <div>
            <p className="text-sm font-medium text-amber-900 dark:text-amber-300">
              FTP may be stale — last updated {data.ftpStaleDays} days ago
            </p>
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
              All intensity metrics (IF, TSS, zones) are calculated from FTP. Do a ramp test or 20-min effort so Intervals.icu refreshes your FTP — it syncs in automatically from there.
            </p>
          </div>
        </div>
      )}

      {/* Dossier group 1 (UX v2 §6 Profile): who is this rider — curve, phenotype, headline numbers. */}
      <section className="space-y-4">
        <SectionDivider label="The rider read" />

        {/* Power curve + PR grid beside the rider read (FB-2026-06-30): each takes half the row when both
            exist (synced). Falls back to a single stacked column when one is absent (e.g. no synced curve,
            so no confident rider profile) so a lone section never sits in a half-empty grid. */}
        {riderProfileSection && powerPRsSection && syncedPowerCurve.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            {powerPRsSection}
            {riderProfileSection}
          </div>
        ) : (
          <>
            {riderProfileSection}
            {powerPRsSection}
          </>
        )}

        {/* Current performance (FTP · threshold HR · max HR) — canonical home per UX v2 §2 ledger;
            moved from Plan's goals card. Values live in knowledge-base athlete.md, edited there. The
            synced weight tile renders even when performanceData is empty (it's synced, not manual). */}
        {(hasPerf || latestWeightKg != null) && (
          <Section title="Current performance" editHref="/knowledge">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {hasPerf &&
                Object.entries(athleteMd.performanceData!).map(([k, v]) => (
                  <div key={k} className="rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900">
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{k}</p>
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{v}</p>
                  </div>
                ))}
              {latestWeightKg != null && (
                <div className="rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900">
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Weight <span className="text-cyan-700 dark:text-[#00d4ff]">· synced</span>
                  </p>
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{latestWeightKg.toFixed(1)} kg</p>
                </div>
              )}
            </div>
          </Section>
        )}

        {!hasRiderRead && (
          <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            No rider data yet — sync with Intervals.icu (top bar) to pull your power curve, PRs, and current numbers.
          </p>
        )}
      </section>

      <section className="space-y-4">
        <SectionDivider label="Zones & effort bands" />
        <IfBandOffsets rows={ifBandRows} />
      </section>

      {/* Goals & Weakpoints — athlete-owned intent, now a real form (Goals/Weakpoints centralization)
          instead of hand-edited markdown. Independent Save button/state from Nutrition. */}
      <section className="space-y-4">
        <SectionDivider label="Goals & weakpoints" />
        <Card>
        <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
          What you&apos;re working toward, and where you&apos;re weak — the coach reads these every generation.
        </p>
        {goals.length === 0 && weakpoints.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">None yet — open Edit below to add your first goal.</p>
        ) : (
          <>
            <div className="space-y-2.5">
              {groupGoalsByFocus(goals).map((grp) => (
                <div key={grp.focus}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {FOCUS_LABELS[grp.focus]}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {grp.goals.map((g, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">{g.goal || "—"}</span>
                        {g.target && (
                          <>
                            <span aria-hidden className="text-zinc-500 dark:text-zinc-400">→</span>
                            <span className="text-zinc-600 dark:text-zinc-300">{g.target}</span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {weakpoints.length > 0 && (
              <ul className="mt-2 space-y-1">
                {weakpoints.map((w, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">weak</span>
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">{w.weakpoint}</span>
                    {w.detail && <span className="text-zinc-500 dark:text-zinc-400">· {w.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Edit
          </summary>
          {/* UXA-21: <form> gives Enter-to-submit from any goal/weakpoint field. */}
          <form
            className="mt-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveGoals();
            }}
          >
            <div className="space-y-2">
              {goals.map((g, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2 rounded bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
                  <label className="min-w-[8rem] flex-1">
                    <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Goal</span>
                    <input
                      type="text"
                      value={g.goal}
                      onChange={(e) => updateGoal(i, { goal: e.target.value })}
                      className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
                    />
                  </label>
                  <label className="min-w-[8rem] flex-1">
                    <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Target</span>
                    <input
                      type="text"
                      value={g.target}
                      onChange={(e) => updateGoal(i, { target: e.target.value })}
                      className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
                    />
                  </label>
                  <label>
                    <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Focus</span>
                    <select
                      value={g.focus}
                      onChange={(e) => updateGoal(i, { focus: e.target.value as ProfileResponse["goals"][number]["focus"] })}
                      className="mt-1 rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
                    >
                      <option value="general">general</option>
                      <option value="aerobic-base">aerobic-base</option>
                      <option value="threshold">threshold</option>
                      <option value="vo2max">vo2max</option>
                      <option value="anaerobic">anaerobic</option>
                      <option value="durability">durability</option>
                      <option value="sharpen">sharpen</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeGoal(i)}
                    title="Remove this goal"
                    className="rounded-md border border-red-300 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addGoal}
              className="mt-3 rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
            >
              + Add goal
            </button>

            <div className="mt-4 space-y-2">
              {weakpoints.map((w, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2 rounded bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
                  <label className="min-w-[8rem] flex-1">
                    <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Weakpoint</span>
                    <input
                      type="text"
                      value={w.weakpoint}
                      onChange={(e) => updateWeakpoint(i, { weakpoint: e.target.value })}
                      className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
                    />
                  </label>
                  <label className="min-w-[10rem] flex-1">
                    <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Detail</span>
                    <input
                      type="text"
                      value={w.detail}
                      onChange={(e) => updateWeakpoint(i, { detail: e.target.value })}
                      className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeWeakpoint(i)}
                    title="Remove this weakpoint"
                    className="rounded-md border border-red-300 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addWeakpoint}
              className="mt-3 rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
            >
              + Add weakpoint
            </button>

            <div className="mt-3 flex items-center gap-3">
              <PrimaryButton type="submit" disabled={goalsSaveState.state === "saving"}>
                {goalsSaveState.state === "saving" ? "Saving…" : "Save"}
              </PrimaryButton>
              {goalsSaveState.state === "saved" && <span role="status" className="text-xs text-green-700 dark:text-green-400">✓ Saved</span>}
              {goalsSaveState.state === "error" && <span role="alert" className="text-xs text-red-600">{goalsSaveState.message}</span>}
            </div>
          </form>
        </details>
        </Card>
      </section>

      {/* Nutrition formula — bottom */}
      <section className="space-y-4">
        <SectionDivider label="Nutrition formula" />
        <Card>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Drives the deterministic formula that pre-computes daily targets for every generated session.
        </p>
        {data.nutritionModel.kind === "derived" ? (
          <p className="mb-2 font-mono text-sm text-zinc-800 dark:text-zinc-100">
            {data.nutritionModel.rmr.toLocaleString()} RMR
            <span className="text-zinc-500 dark:text-zinc-400"> × </span>
            {data.nutritionModel.neatMultiplier} NEAT
            <span className="text-zinc-500 dark:text-zinc-400"> = </span>
            {Math.round(data.nutritionModel.rmr * data.nutritionModel.neatMultiplier).toLocaleString()} maintenance
            <span className="text-zinc-500 dark:text-zinc-400"> · buffer </span>
            {data.nutrition.buffer > 0 ? "+" : ""}{data.nutrition.buffer}
            <span className="text-zinc-500 dark:text-zinc-400"> · target </span>
            {data.nutrition.targetWeightKg} kg
          </p>
        ) : (
          <div className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950">
            <p className="font-mono text-sm text-zinc-800 dark:text-zinc-100">
              {data.nutrition.baseCalories.toLocaleString()} base
              <span className="text-zinc-500 dark:text-zinc-400"> · </span>
              {data.nutrition.restDayTarget.toLocaleString()} rest-day
              <span className="text-zinc-500 dark:text-zinc-400"> (your hand-set values)</span>
            </p>
            <p className="mt-1 text-xs text-zinc-700 dark:text-zinc-300">
              Add your date of birth, height and sex below and these become computed from your RMR instead.
              Your current numbers stay in use until you do — nothing changes behind your back.
            </p>
          </div>
        )}

        {/* Task 5: the whole chain, not just its output — every number the deterministic formula runs
            on, in the order it's computed, each with the one-line reasoning behind it. */}
        <dl className="divide-y divide-zinc-100 rounded bg-zinc-50 px-3 dark:divide-zinc-800 dark:bg-zinc-900">
          <DerivationRow
            label="Resting metabolic rate"
            value={derivation.rmr !== null ? `${derivation.rmr.toLocaleString()} kcal` : "—"}
            why={
              derivation.rmr !== null && data.nutritionModel.kind === "derived"
                ? `Mifflin-St Jeor from ${data.nutritionModel.weightKg} kg, ${data.performance.heightCm ?? "—"} cm, age ${
                    data.performance.dateOfBirth ? (ageYearsFrom(data.performance.dateOfBirth, localToday()) ?? "—") : "—"
                  }`
                : "add date of birth, height and sex below to compute this from Mifflin-St Jeor"
            }
          />
          <DerivationRow
            label="Non-exercise multiplier"
            value={`× ${derivation.neat.multiplier.toFixed(2)}`}
            why={neatWhy(derivation.neat)}
            extra={
              derivation.neat.imbalance && (
                <div className="mt-1.5 rounded border border-amber-200 bg-amber-50 px-2.5 py-2 leading-4 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                  <p className="font-medium">
                    The solve landed {derivation.neat.imbalance.direction === "intake-above-model" ? "above" : "below"} the
                    plausible range by ~{Math.abs(derivation.neat.imbalance.estimatedKcalPerDay)} kcal/day — clamped to{" "}
                    {derivation.neat.multiplier.toFixed(2)}. Two things can explain it, and this can&apos;t tell them apart:
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {derivation.neat.imbalance.candidates.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                  <p className="mt-1 italic">{derivation.neat.imbalance.note}</p>
                </div>
              )
            }
          />
          <DerivationRow
            label="Maintenance"
            value={derivation.maintenanceKcal !== null ? `${derivation.maintenanceKcal.toLocaleString()} kcal` : "—"}
            why="before training and before your weight goal"
          />
          <DerivationRow
            label="Weight"
            value={
              derivation.smoothedWeightKg !== null
                ? `${derivation.smoothedWeightKg.toFixed(2)} kg (${SMOOTHED_WEIGHT_WINDOW_DAYS}-day median)`
                : "—"
            }
            why={
              derivation.rawLatestWeightKg !== null
                ? `smoothed; last single reading ${derivation.rawLatestWeightKg.toFixed(1)} kg`
                : "no weigh-ins synced yet"
            }
          />
          <DerivationRow
            label="Goal"
            value={`${derivation.targetWeightKg} kg at ${fmtSigned(derivation.desiredTrendKgPerWeek)} kg/week`}
            why={data.nutrition.targetRateKgPerWeek != null ? "your setting" : "derived from the gap"}
          />
          <DerivationRow
            label="Observed trend"
            value={`${derivation.trendShortKgPerWeek !== null ? fmtSigned(derivation.trendShortKgPerWeek, 1) : "—"} kg/week (${WEIGHT_TREND_WINDOW_DAYS}d) · ${
              derivation.trendLongKgPerWeek !== null ? fmtSigned(derivation.trendLongKgPerWeek, 1) : "—"
            } (${WEIGHT_TREND_LONG_WINDOW_DAYS}d)`}
            why="the long window must confirm before any cut"
          />
          <DerivationRow
            label="Buffer"
            value={`${fmtSigned(data.nutrition.buffer, 0)} → ${fmtSigned(derivation.buffer.bufferApplied, 0)} kcal`}
            why={derivation.buffer.reason}
            extra={
              (derivation.buffer.stepClipped || derivation.buffer.capped) && (
                <div className="mt-1 space-y-0.5">
                  {derivation.buffer.stepClipped && (
                    <p className="font-medium text-amber-700 dark:text-amber-400">
                      This adjustment was clipped to the ±{MAX_ADJUSTMENT_STEP_KCAL} kcal per-correction limit.
                    </p>
                  )}
                  {derivation.buffer.capped && (
                    <p className="font-medium text-amber-700 dark:text-amber-400">
                      Buffer is pinned at its outer limit ({BUFFER_MIN_KCAL}–{BUFFER_MAX_KCAL} kcal) — the model needs
                      revisiting, not the buffer.
                    </p>
                  )}
                </div>
              )
            }
          />
          <DerivationRow
            label="Today's target"
            value={
              derivation.maintenanceKcal !== null
                ? `${(derivation.maintenanceKcal + derivation.buffer.bufferApplied).toLocaleString()} kcal`
                : "—"
            }
            why="maintenance + today's burn + buffer — shown here for a rest day; training days add today's burn on top"
          />
        </dl>

        {/* Step 4: manual NEAT override — its own disclosure + save path, independent of the base-four
            nutrition Edit form below. Overriding stops the multiplier from tracking logged data at all. */}
        <details className="mt-3 rounded bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Override non-exercise multiplier
          </summary>
          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            Currently {derivation.neat.source === "override" ? "manually set" : "derived"} at{" "}
            {derivation.neat.multiplier.toFixed(2)} ({derivation.neat.confidence} confidence). Setting a value here stops it
            tracking your logged data — it stays fixed at what you enter until you revert it.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label>
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Multiplier ({NEAT_PLAUSIBLE_MIN}–{NEAT_PLAUSIBLE_MAX})
              </span>
              <input
                type="number"
                min={NEAT_PLAUSIBLE_MIN}
                max={NEAT_PLAUSIBLE_MAX}
                step={0.01}
                value={neatInput}
                onChange={(e) => {
                  setNeatInput(e.target.value);
                  if (neatSaveState.state === "saved") setNeatSaveState({ state: "idle" });
                }}
                className="mt-1 w-28 rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
              />
            </label>
            <button
              type="button"
              onClick={() => void saveNeatOverride()}
              disabled={neatSaveState.state === "saving"}
              className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              {neatSaveState.state === "saving" ? "Saving…" : "Set override"}
            </button>
            {derivation.neat.source === "override" && (
              <button
                type="button"
                onClick={() => void revertNeatOverride()}
                disabled={neatSaveState.state === "saving"}
                className="rounded border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-600 dark:text-zinc-300"
              >
                Revert to derived
              </button>
            )}
            {neatSaveState.state === "saved" && <span role="status" className="text-xs text-green-700 dark:text-green-400">✓ Saved</span>}
            {neatSaveState.state === "error" && <span role="alert" className="text-xs text-red-600">{neatSaveState.message}</span>}
          </div>
        </details>

        <form
          className="mt-3 rounded bg-zinc-50 px-3 py-2 dark:bg-zinc-900"
          onSubmit={(e) => { e.preventDefault(); void saveRmrInputs(); }}
        >
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Resting metabolic rate inputs
            {data.nutritionModel.kind === "derived" && (
              <span className="ml-1 font-normal text-zinc-500 dark:text-zinc-400">
                — driving the {data.nutritionModel.rmr.toLocaleString()} kcal figure above
              </span>
            )}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label>
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Date of birth</span>
              <input
                type="date"
                value={rmrInputs.dateOfBirth}
                onChange={(e) => setRmrInputs((s) => ({ ...s, dateOfBirth: e.target.value }))}
                className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
              />
            </label>
            <label>
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Height (cm)</span>
              <input
                type="number" min={50} max={260}
                value={rmrInputs.heightCm}
                onChange={(e) => setRmrInputs((s) => ({ ...s, heightCm: e.target.value }))}
                className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
              />
            </label>
            <label>
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Sex</span>
              <select
                value={rmrInputs.sex}
                onChange={(e) => setRmrInputs((s) => ({ ...s, sex: e.target.value }))}
                className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
              >
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            Sex is a term in the Mifflin-St Jeor equation, not a profile setting.
          </p>
          <button type="submit" className="mt-2 rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
            Save
          </button>
        </form>

        <details className="mt-3">
          <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Edit
          </summary>
          {/* UXA-21: <form> gives Enter-to-submit from any nutrition field. */}
          <form
            className="mt-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveNutrition();
            }}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {NUTRITION_EDIT_FIELDS.map((f) => (
                <label key={f.key}>
                  <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                    {f.label} <span className="text-zinc-500 dark:text-zinc-400">({f.unit}, {f.hint})</span>
                  </span>
                  <input
                    type="number"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={nut[f.key]}
                    onChange={(e) => {
                      setNut((s) => ({ ...s, [f.key]: e.target.value }));
                      if (saveState.state === "saved") setSaveState({ state: "idle" });
                    }}
                    className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
                  />
                </label>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-3">
              <PrimaryButton type="submit" disabled={saveState.state === "saving"}>
                {saveState.state === "saving" ? "Saving…" : "Save"}
              </PrimaryButton>
              {saveState.state === "saved" && <span role="status" className="text-xs text-green-700 dark:text-green-400">✓ Saved</span>}
              {saveState.state === "error" && <span role="alert" className="text-xs text-red-600">{saveState.message}</span>}
            </div>
          </form>
        </details>
        </Card>
      </section>
    </div>
  );
}
