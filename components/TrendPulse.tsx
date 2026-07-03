"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { InfoDot, LoadFailed, TrendTile, useMountLoad } from "./ui";

interface Pt {
  value: number;
}
interface TrendsResp {
  ctl: Pt[];
  weeklyHours: Array<{ date: string; hours: number }>;
  zones: number[];
  syncedAt: string | null;
}

function delta(points: number[]): "up" | "down" | "flat" | undefined {
  if (points.length < 4) return points.length ? "flat" : undefined;
  const mid = Math.floor(points.length / 2);
  const a = points.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
  const b = points.slice(mid).reduce((s, v) => s + v, 0) / (points.length - mid);
  const eps = Math.max(Math.abs(a) * 0.02, 1e-6);
  return b - a > eps ? "up" : b - a < -eps ? "down" : "flat";
}

function Tile({ label, tip, onClick, children }: { label: string; tip?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md bg-zinc-50 px-2.5 py-2 text-left transition-colors hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800"
    >
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
        {tip && <InfoDot text={tip} />}
      </p>
      {children}
    </button>
  );
}

// Weekly training volume — the "am I building or slipping?" answer a glance should give.
function VolumeTile({ weeks, onClick }: { weeks: TrendsResp["weeklyHours"]; onClick: () => void }) {
  const hours = weeks.map((w) => w.hours);
  const latest = hours.length ? hours[hours.length - 1] : null;
  const max = Math.max(...hours, 1);
  return (
    <Tile label="Weekly volume" tip="Total ride hours per complete week (recent weeks; the in-progress week is excluded). Bar height tracks your weekly training volume — consistency and ramp at a glance." onClick={onClick}>
      <div className="my-0.5 flex h-[22px] items-end gap-[2px]">
        {weeks.map((w, i) => (
          <div
            key={i}
            title={`Week of ${w.date}: ${w.hours} h`}
            className="flex-1 rounded-[1px] bg-zinc-300 dark:bg-[#00d4ff]/45"
            style={{ height: `${Math.max(6, (w.hours / max) * 100)}%` }}
          />
        ))}
      </div>
      <p className="font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-100">
        {latest != null ? `${latest.toFixed(1)} h` : "—"}
        <span className="ml-1 text-[10px] font-normal text-zinc-500 dark:text-zinc-400">this wk</span>
      </p>
    </Tile>
  );
}

// Time-in-zone over the last 28 days, collapsed to easy / moderate / hard (the polarization
// split). ~80% easy is the endurance-base target.
function ZoneTile({ zones, onClick }: { zones: number[]; onClick: () => void }) {
  const total = zones.reduce((s, v) => s + v, 0);
  if (total === 0) return null;
  const easy = (zones[0] ?? 0) + (zones[1] ?? 0);
  const mod = zones[2] ?? 0;
  const hard = (zones[3] ?? 0) + (zones[4] ?? 0) + (zones[5] ?? 0) + (zones[6] ?? 0);
  const pct = (x: number) => Math.round((x / total) * 100);
  return (
    <Tile label="Time in zones · 28d" tip="Share of the last 28 days' riding time spent easy / moderate / hard (power zones collapsed to the polarization split). ~80% easy is the endurance-base target." onClick={onClick}>
      <div className="my-1 flex h-2.5 overflow-hidden rounded-full">
        <div style={{ width: `${pct(easy)}%` }} className="bg-blue-400 dark:bg-blue-500/70" />
        <div style={{ width: `${pct(mod)}%` }} className="bg-amber-400 dark:bg-amber-500/70" />
        <div style={{ width: `${pct(hard)}%` }} className="bg-red-400 dark:bg-red-500/70" />
      </div>
      <p className="font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-100">
        {pct(easy)}/{pct(mod)}/{pct(hard)} <span className="text-[10px] font-normal text-zinc-500 dark:text-zinc-400">e/m/h</span>
      </p>
    </Tile>
  );
}

// The Today view's "trend pulse" — fitness trajectory, weekly volume, and polarization at a
// glance. Reuses the server-computed trends so the numbers match the Trends page.
export default function TrendPulse({ vertical }: { vertical?: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<TrendsResp | null>(null);
  const [failed, setFailed] = useState(false);

  // Best-effort, but a failure must be visible (S1-3): without the flag, a broken /api/trends
  // rendered the "Sync to populate trends" empty state — a lie that hides breakage.
  const load = useCallback(async () => {
    // State only touched after the await (post-microtask), so the effect that calls this doesn't
    // setState synchronously; the flag starts false and success re-clears it after a retry.
    try {
      const d = await api<TrendsResp>("/api/trends");
      setData(d);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useMountLoad(load);

  const go = () => router.push("/trends");

  if (failed) return <LoadFailed what="the trend pulse" retry={() => void load()} />;

  if (!data || !data.syncedAt) {
    return (
      <button onClick={go} className="w-full rounded-md bg-zinc-50 px-3 py-3 text-left text-xs text-zinc-500 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800">
        Sync to populate trends →
      </button>
    );
  }

  const ctl = data.ctl.map((p) => p.value);
  return (
    <div className={`grid gap-2 ${vertical ? "grid-cols-2 lg:grid-cols-1" : "grid-cols-3"}`}>
      <TrendTile label="CTL — fitness" tip="Chronic Training Load — your ~42-day rolling average daily training stress; the standard fitness proxy. Rising = building fitness, falling = detraining." value={ctl.length ? ctl[ctl.length - 1].toFixed(0) : "—"} points={ctl} delta={delta(ctl)} onClick={go} />
      <VolumeTile weeks={data.weeklyHours} onClick={go} />
      <ZoneTile zones={data.zones} onClick={go} />
    </div>
  );
}
