"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, timeAgo } from "@/lib/client-api";
import { Card, SectionDivider, Skeleton, SkeletonScreen } from "./ui";
import PowerCurveChart from "./PowerCurveChart";
import IfBandOffsets from "./IfBandOffsets";
import type { AthleteMdSnapshot } from "@/lib/kb-loader";
import type { PowerCurvePoint, PowerProfile, PowerSystem, SeasonFocus } from "@/lib/types";
import type { IfBandOffsetRow } from "@/lib/calibration";

interface NutritionSettings {
  baseCalories: number;
  restDayTarget: number;
  buffer: number;
  targetWeightKg: number;
}

interface AutoSyncInfo {
  syncedAt: string | null;
  latestWeightKg: number | null;
  latestWeightDate: string | null;
  weightTrend7Day: number | null;
  avgRpe7Day: number | null;
  lastKcalConsumed: number | null;
  lastKcalDate: string | null;
}

interface BufferStatus {
  bufferApplied: number;
  delta: number;
  reason: string;
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

interface ProfileResponse {
  nutrition: NutritionSettings;
  ftpStaleDays: number | null;
  physiologyChange: PhysiologyChange | null;
  physiologySource: "intervals" | "manual" | null;
  athleteMd: AthleteMdSnapshot;
  autoSync: AutoSyncInfo;
  bufferStatus: BufferStatus;
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


// ---------- Main component ----------

export default function AthleteProfileForm({ ifBandRows = [] }: { ifBandRows?: IfBandOffsetRow[] }) {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nut, setNut] = useState({ baseCalories: "", restDayTarget: "", buffer: "", targetWeightKg: "" });
  const [saveState, setSaveState] = useState<SaveState>({ state: "idle" });
  const [goals, setGoals] = useState<ProfileResponse["goals"]>([]);
  const [weakpoints, setWeakpoints] = useState<ProfileResponse["weakpoints"]>([]);
  const [goalsSaveState, setGoalsSaveState] = useState<SaveState>({ state: "idle" });

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
          baseCalories: String(n.baseCalories),
          restDayTarget: String(n.restDayTarget),
          buffer: String(n.buffer),
          targetWeightKg: String(n.targetWeightKg),
        });
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load profile");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveNutrition = async () => {
    const parsed: Record<string, number> = {};
    for (const [key, value] of Object.entries(nut)) {
      const n = Number(value);
      if (value.trim() === "" || !Number.isFinite(n)) {
        setSaveState({ state: "error", message: `"${key}" is not a valid number.` });
        return;
      }
      parsed[key] = n;
    }
    setSaveState({ state: "saving" });
    try {
      await api("/api/profile", { method: "PUT", body: JSON.stringify({ nutrition: parsed }) });
      setSaveState({ state: "saved" });
      const fresh = await api<ProfileResponse>("/api/profile");
      setData(fresh);
    } catch (err) {
      setSaveState({ state: "error", message: err instanceof Error ? err.message : "Save failed" });
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
      setGoalsSaveState({ state: "error", message: err instanceof Error ? err.message : "Save failed" });
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

  const { athleteMd, autoSync, bufferStatus, syncedPowerCurve, powerProfile, latestWeightKg } = data;

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
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500">vs expected</p>
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
              all-time best efforts · from Intervals.icu · {timeAgo(autoSync.syncedAt)} · drag the curve to read any duration
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
        <Link href="/knowledge" className="shrink-0 whitespace-nowrap text-xs text-cyan-700 hover:underline dark:text-[#00d4ff]">
          Edit athlete_profile.md →
        </Link>
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
            <ul className="space-y-1">
              {goals.map((g, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">{g.goal || "—"}</span>
                  {g.target && (
                    <>
                      <span aria-hidden className="text-zinc-400 dark:text-zinc-500">→</span>
                      <span className="text-zinc-600 dark:text-zinc-300">{g.target}</span>
                    </>
                  )}
                  <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-700/60 dark:text-zinc-300">
                    {g.focus}
                  </span>
                </li>
              ))}
            </ul>
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
          <div className="mt-2">
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
              onClick={addWeakpoint}
              className="mt-3 rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
            >
              + Add weakpoint
            </button>

            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={saveGoals}
                disabled={goalsSaveState.state === "saving"}
                className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
              >
                {goalsSaveState.state === "saving" ? "Saving…" : "Save"}
              </button>
              {goalsSaveState.state === "saved" && <span className="text-xs text-green-700 dark:text-green-400">✓ Saved</span>}
              {goalsSaveState.state === "error" && <span className="text-xs text-red-600">{goalsSaveState.message}</span>}
            </div>
          </div>
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
        <p className="mb-2 font-mono text-sm text-zinc-800 dark:text-zinc-100">
          {data.nutrition.baseCalories.toLocaleString()} base
          <span className="text-zinc-500 dark:text-zinc-400"> · </span>
          {data.nutrition.restDayTarget.toLocaleString()} rest-day
          <span className="text-zinc-500 dark:text-zinc-400"> · </span>+{data.nutrition.buffer} buffer
          <span className="text-zinc-500 dark:text-zinc-400"> · target </span>
          {data.nutrition.targetWeightKg} kg
        </p>

        <div className="rounded bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Buffer auto-adjustment</p>
          <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">
            Configured {data.nutrition.buffer} kcal → applied{" "}
            <span className="font-semibold">{bufferStatus.bufferApplied} kcal</span>
            {bufferStatus.delta !== 0 && ` (${bufferStatus.delta > 0 ? "+" : ""}${bufferStatus.delta} kcal)`}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{bufferStatus.reason}</p>
        </div>

        <details className="mt-3">
          <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Edit
          </summary>
          <div className="mt-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  { key: "baseCalories", label: "Base calories", unit: "kcal" },
                  { key: "restDayTarget", label: "Rest day target", unit: "kcal" },
                  { key: "buffer", label: "Training buffer", unit: "kcal" },
                  { key: "targetWeightKg", label: "Target weight", unit: "kg" },
                ] as const
              ).map((f) => (
                <label key={f.key}>
                  <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                    {f.label} <span className="text-zinc-500 dark:text-zinc-400">({f.unit})</span>
                  </span>
                  <input
                    type="number"
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
              <button
                onClick={saveNutrition}
                disabled={saveState.state === "saving"}
                className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
              >
                {saveState.state === "saving" ? "Saving…" : "Save"}
              </button>
              {saveState.state === "saved" && <span className="text-xs text-green-700 dark:text-green-400">✓ Saved</span>}
              {saveState.state === "error" && <span className="text-xs text-red-600">{saveState.message}</span>}
            </div>
          </div>
        </details>
        </Card>
      </section>
    </div>
  );
}
