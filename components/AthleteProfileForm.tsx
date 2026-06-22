"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, timeAgo } from "@/lib/client-api";
import type { AthleteMdSnapshot } from "@/lib/kb-loader";
import type { PowerCurvePoint, PowerProfile, PowerSystem } from "@/lib/types";

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

function Section({
  title,
  editHref,
  children,
}: {
  title: string;
  editHref?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-zinc-100 pb-2 dark:border-zinc-700/60">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h2>
        {editHref && (
          <Link href={editHref} className="shrink-0 whitespace-nowrap text-xs text-cyan-700 hover:underline dark:text-[#00d4ff]">
            Edit →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}


// ---------- Main component ----------

export default function AthleteProfileForm() {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nut, setNut] = useState({ baseCalories: "", restDayTarget: "", buffer: "", targetWeightKg: "" });
  const [saveState, setSaveState] = useState<SaveState>({ state: "idle" });

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

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        {loadError}
      </div>
    );
  }
  if (!data) return <p className="py-12 text-center text-sm text-zinc-400">Loading…</p>;

  const { athleteMd, autoSync, bufferStatus, syncedPowerCurve, powerProfile, latestWeightKg } = data;

  return (
    <div className="space-y-5">
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

      {/* Power PRs — from sync or manual */}
      {(syncedPowerCurve.length > 0 || athleteMd.powerProfile.length > 0) && (
        <Section title="Power PRs" editHref={syncedPowerCurve.length > 0 ? undefined : "/knowledge"}>
          {syncedPowerCurve.length > 0 ? (
            <>
              <p className="mb-3 text-[11px] text-zinc-400 dark:text-zinc-500">
                all-time best efforts · from Intervals.icu · {timeAgo(autoSync.syncedAt)}
              </p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {syncedPowerCurve.map((pt) => {
                  const label = POWER_CURVE_LABELS[pt.durationSec] ?? `${pt.durationSec}s`;
                  const wkg = latestWeightKg ? (pt.watts / latestWeightKg).toFixed(1) : null;
                  return (
                    <div key={pt.durationSec} className="rounded bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{label}</p>
                      <p className="font-mono text-sm font-semibold text-zinc-900 dark:text-[#00d4ff]">{pt.watts}W</p>
                      {wkg && <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{wkg} W/kg</p>}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-zinc-400 dark:text-zinc-500">
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
      )}

      {/* Rider profile — auto-derived from the curve shape (Track A) */}
      {powerProfile && powerProfile.confident && (
        <Section title="Rider profile">
          <p className="mb-3 text-[11px] text-zinc-400 dark:text-zinc-500">
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
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{SYSTEM_LABELS[s.system]}</p>
                  <p className="font-mono text-sm font-semibold text-zinc-900 dark:text-[#00d4ff]">{s.watts}W</p>
                  {s.wattsPerKg !== null && (
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{s.wattsPerKg} W/kg</p>
                  )}
                  <p
                    className={
                      strong
                        ? "mt-0.5 text-[11px] font-medium text-cyan-700 dark:text-[#00d4ff]"
                        : weak
                          ? "mt-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
                          : "mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500"
                    }
                  >
                    {pct > 0 ? "+" : ""}{pct}% vs expected
                  </p>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* 3. Goals & Weakpoints */}
      {(athleteMd.goals.length > 0 || athleteMd.weakpoints.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {athleteMd.goals.length > 0 && (
            <Section title="Goals" editHref="/knowledge">
              <ul className="space-y-1.5">
                {athleteMd.goals.map((g, i) => (
                  <li key={i} className="flex items-start justify-between gap-2 rounded bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
                    <span className="min-w-0 text-sm text-zinc-800 dark:text-zinc-200">{g.goal}</span>
                    {g.target && g.target !== g.goal && (
                      <span className="min-w-0 break-words rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-700 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff]">
                        {g.target}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {athleteMd.weakpoints.length > 0 && (
            <Section title="Weakpoints" editHref="/knowledge">
              <ul className="space-y-1.5">
                {athleteMd.weakpoints.map((w, i) => (
                  <li key={i} className="rounded bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{w.weakpoint}</p>
                    {w.detail && w.detail !== w.weakpoint && (
                      <p className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{w.detail}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}

      {/* Nutrition formula — bottom */}
      <Section title="Nutrition formula">
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Drives the deterministic formula that pre-computes daily targets for every generated session.
        </p>
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
                {f.label} <span className="text-zinc-400 dark:text-zinc-500">({f.unit})</span>
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

        <div className="mt-3 rounded bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Buffer auto-adjustment</p>
          <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">
            Configured {data.nutrition.buffer} kcal → applied{" "}
            <span className="font-semibold">{bufferStatus.bufferApplied} kcal</span>
            {bufferStatus.delta !== 0 && ` (${bufferStatus.delta > 0 ? "+" : ""}${bufferStatus.delta} kcal)`}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{bufferStatus.reason}</p>
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
      </Section>
    </div>
  );
}
