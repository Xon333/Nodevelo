"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, timeAgo } from "@/lib/client-api";
import type { AthleteMdSnapshot } from "@/lib/kb-loader";
import type { PowerCurvePoint } from "@/lib/types";

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

interface ProfileResponse {
  nutrition: NutritionSettings;
  ftpStaleDays: number | null;
  athleteMd: AthleteMdSnapshot;
  autoSync: AutoSyncInfo;
  bufferStatus: BufferStatus;
  syncedPowerCurve: PowerCurvePoint[];
  latestWeightKg: number | null;
  weightHistory: WeightPoint[];
}

type SaveState = { state: "idle" | "saving" | "saved" } | { state: "error"; message: string };

const POWER_CURVE_LABELS: Record<number, string> = {
  5: "5s", 15: "15s", 30: "30s", 60: "1 min",
  120: "2 min", 300: "5 min", 1200: "20 min", 1800: "30 min", 3600: "60 min",
};

// ---------- Weight sparkline ----------

function WeightSparkline({ points }: { points: WeightPoint[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (points.length < 2) return null;

  const W = 280;
  const H = 46;   // chart area
  const TIP = 28; // tooltip strip at top
  const PAD = 4;
  const TOTAL = H + TIP;

  const weights = points.map((p) => p.weightKg);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const range = maxW - minW || 0.5;

  const toX = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const toY = (w: number) => TIP + PAD + (1 - (w - minW) / range) * (H - PAD * 2);

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.weightKg).toFixed(1)}`)
    .join(" ");

  const hp = hoveredIdx !== null ? points[hoveredIdx] : null;
  const hx = hoveredIdx !== null ? toX(hoveredIdx) : 0;
  const hy = hp ? toY(hp.weightKg) : 0;

  // Tooltip rect clamped to SVG bounds
  const TIP_W = 86;
  const tipRx = hp ? Math.max(0, Math.min(hx - TIP_W / 2, W - TIP_W)) : 0;

  return (
    <svg viewBox={`0 0 ${W} ${TOTAL}`} className="w-full overflow-visible" style={{ height: TOTAL }}>
      {/* Chart line */}
      <path
        d={pathD}
        fill="none"
        strokeWidth="1.5"
        strokeLinejoin="round"
        className="stroke-blue-500 dark:stroke-[#ff49c8]"
      />

      {/* Min/max range labels — hide while tooltip active */}
      {!hp && (
        <>
          <text x={W - 2} y={TIP + PAD + 6} textAnchor="end" fontSize={8} className="fill-zinc-400 dark:fill-zinc-600">
            {maxW.toFixed(1)}
          </text>
          <text x={W - 2} y={TOTAL - 2} textAnchor="end" fontSize={8} className="fill-zinc-400 dark:fill-zinc-600">
            {minW.toFixed(1)}
          </text>
        </>
      )}

      {/* Hover hit areas only — no persistent dots, just the line; a dot appears on hover */}
      {points.map((p, i) => {
        const cx = toX(i);
        const cy = toY(p.weightKg);
        const isHovered = hoveredIdx === i;
        return (
          <g key={i}>
            {isHovered && (
              <circle cx={cx} cy={cy} r={4} className="fill-blue-500 dark:fill-[#ff49c8]" style={{ pointerEvents: "none" }} />
            )}
            <circle
              cx={cx}
              cy={cy}
              r={10}
              fill="transparent"
              className="cursor-crosshair"
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          </g>
        );
      })}

      {/* Hover tooltip */}
      {hp && (
        <g style={{ pointerEvents: "none" }}>
          {/* Dashed vertical guide */}
          <line
            x1={hx} y1={TIP - 2}
            x2={hx} y2={hy - 6}
            strokeWidth={1}
            strokeDasharray="2 2"
            className="stroke-zinc-300 dark:stroke-[#ff49c8]/35"
          />
          {/* Tooltip bg */}
          <rect
            x={tipRx} y={1}
            width={TIP_W} height={TIP - 4}
            rx={3}
            className="fill-zinc-100 dark:fill-zinc-900"
            fillOpacity={0.97}
          />
          {/* Border line on tooltip rect */}
          <rect
            x={tipRx} y={1}
            width={TIP_W} height={TIP - 4}
            rx={3}
            fill="none"
            strokeWidth={0.5}
            className="stroke-zinc-300 dark:stroke-[#ff49c8]/30"
          />
          {/* Weight value */}
          <text
            x={tipRx + TIP_W / 2} y={11}
            textAnchor="middle"
            fontSize={9}
            fontWeight="600"
            fontFamily="monospace"
            className="fill-zinc-800 dark:fill-[#ff49c8]"
          >
            {hp.weightKg.toFixed(1)} kg
          </text>
          {/* Date */}
          <text
            x={tipRx + TIP_W / 2} y={20}
            textAnchor="middle"
            fontSize={7.5}
            fontFamily="monospace"
            className="fill-zinc-500 dark:fill-zinc-400"
          >
            {hp.date}
          </text>
        </g>
      )}
    </svg>
  );
}

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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
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

function StatGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      {items.map(({ label, value }) => (
        <div key={label}>
          <dt className="text-[11px] text-zinc-400 dark:text-zinc-500">{label}</dt>
          <dd className="mt-0.5 font-mono text-sm font-semibold text-zinc-800 dark:text-[#00d4ff]">{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------- Main component ----------

export default function AthleteProfileForm() {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nut, setNut] = useState({ baseCalories: "", restDayTarget: "", buffer: "", targetWeightKg: "" });
  const [saveState, setSaveState] = useState<SaveState>({ state: "idle" });

  const load = useCallback(async () => {
    try {
      const response = await api<ProfileResponse>("/api/profile");
      setData(response);
      const n = response.nutrition;
      setNut({
        baseCalories: String(n.baseCalories),
        restDayTarget: String(n.restDayTarget),
        buffer: String(n.buffer),
        targetWeightKg: String(n.targetWeightKg),
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load profile");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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

  const { athleteMd, autoSync, bufferStatus, syncedPowerCurve, latestWeightKg, weightHistory } = data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Athlete profile</h1>
        <Link href="/knowledge" className="text-xs text-cyan-700 hover:underline dark:text-[#00d4ff]">
          Edit athlete_profile.md →
        </Link>
      </div>

      {/* FTP stale warning */}
      {data.ftpStaleDays !== null && data.ftpStaleDays > 90 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/60 dark:bg-amber-950/40">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
          <div>
            <p className="text-sm font-medium text-amber-900 dark:text-amber-300">
              FTP may be stale — last updated {data.ftpStaleDays} days ago
            </p>
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
              All intensity metrics (IF, TSS, zones) are calculated from FTP. Consider a ramp test or 20-min effort to refresh it, then update your profile.
            </p>
          </div>
        </div>
      )}

      {/* 1. Live data from Intervals.icu — top priority */}
      <Section title="Live data from Intervals.icu">
        {autoSync.syncedAt === null ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No sync yet —{" "}
            <Link href="/dashboard" className="text-cyan-700 hover:underline dark:text-[#00d4ff]">
              sync from the dashboard
            </Link>.
          </p>
        ) : (
          <>
            <StatGrid items={[
              { label: "Latest weight", value: autoSync.latestWeightKg != null ? `${autoSync.latestWeightKg.toFixed(1)} kg` : "—" },
              { label: "7-day trend", value: autoSync.weightTrend7Day != null ? `${autoSync.weightTrend7Day > 0 ? "+" : ""}${autoSync.weightTrend7Day.toFixed(1)} kg` : "—" },
              { label: "Avg RPE (7d)", value: autoSync.avgRpe7Day != null ? `${autoSync.avgRpe7Day}/10` : "—" },
              { label: "Last intake", value: autoSync.lastKcalConsumed != null ? `${autoSync.lastKcalConsumed} kcal` : "—" },
            ]} />
            {weightHistory.length >= 3 && (
              <div className="mt-4">
                <p className="mb-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                  Weight — last {weightHistory.length} entries
                </p>
                <div className="overflow-hidden rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-900">
                  <WeightSparkline points={weightHistory} />
                </div>
              </div>
            )}
          </>
        )}
        <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">Synced {timeAgo(autoSync.syncedAt)}.</p>
      </Section>

      {/* 2. Power PRs — from sync or manual */}
      {(syncedPowerCurve.length > 0 || athleteMd.powerProfile.length > 0) && (
        <Section title="Power PRs" editHref={syncedPowerCurve.length > 0 ? undefined : "/knowledge"}>
          {syncedPowerCurve.length > 0 ? (
            <>
              <p className="mb-3 text-[11px] text-zinc-400 dark:text-zinc-500">
                84-day best efforts · from Intervals.icu · {timeAgo(autoSync.syncedAt)}
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

      {/* 3. Goals & Weakpoints */}
      {(athleteMd.goals.length > 0 || athleteMd.weakpoints.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {athleteMd.goals.length > 0 && (
            <Section title="Goals" editHref="/knowledge">
              <ul className="space-y-1.5">
                {athleteMd.goals.map((g, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 rounded bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
                    <span className="text-sm text-zinc-800 dark:text-zinc-200">{g.goal}</span>
                    {g.target && g.target !== g.goal && (
                      <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">{g.target}</span>
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
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{w.detail}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}

      {/* 4. Training zones */}
      {athleteMd.trainingZones.length > 0 && (
        <Section title="Training zones" editHref="/knowledge">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-400 dark:text-zinc-500">
                  <th className="pb-1 pr-3 font-medium">Zone</th>
                  <th className="pb-1 pr-3 font-medium">Name</th>
                  <th className="pb-1 pr-3 font-medium">Power</th>
                  <th className="pb-1 font-medium">HR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                {athleteMd.trainingZones.map((z) => (
                  <tr key={z.zone}>
                    <td className="py-1 pr-3 font-semibold text-zinc-800 dark:text-zinc-200">{z.zone}</td>
                    <td className="py-1 pr-3 text-zinc-500 dark:text-zinc-400">{z.name}</td>
                    <td className="py-1 pr-3 text-zinc-500 dark:text-zinc-400">{z.power}</td>
                    <td className="py-1 text-zinc-500 dark:text-zinc-400">{z.hr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* 5. Nutrition formula — bottom */}
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
