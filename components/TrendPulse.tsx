"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { TrendTile } from "./ui";

interface Pt {
  value: number;
}
interface Score {
  executionScore: number;
  compliancePct: number | null;
}
interface TrendsResp {
  ef: Pt[];
  ctl: Pt[];
  scores: Score[];
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

// The Today view's "trend pulse" — four compact tiles answering "am I improving?"
// at a glance. Reuses the server-computed trends so the numbers match the Trends page.
export default function TrendPulse({ vertical }: { vertical?: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<TrendsResp | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api<TrendsResp>("/api/trends");
        if (!cancelled) setData(d);
      } catch {
        // pulse is best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const go = () => router.push("/trends");

  if (!data || !data.syncedAt) {
    return (
      <button onClick={go} className="w-full rounded-md bg-zinc-50 px-3 py-3 text-left text-xs text-zinc-400 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800">
        Sync to populate trends →
      </button>
    );
  }

  const ef = data.ef.map((p) => p.value);
  const ctl = data.ctl.map((p) => p.value);
  const exec = data.scores.map((s) => s.executionScore);
  const comp = data.scores.map((s) => s.compliancePct).filter((v): v is number => v !== null);
  const compAvg = comp.length ? Math.round(comp.reduce((s, v) => s + v, 0) / comp.length) : null;

  return (
    <div className={`grid gap-2 ${vertical ? "grid-cols-2 lg:grid-cols-1" : "grid-cols-2 sm:grid-cols-4"}`}>
      <TrendTile label="Pw:HR" value={ef.length ? ef[ef.length - 1].toFixed(2) : "—"} points={ef} delta={delta(ef)} onClick={go} />
      <TrendTile label="CTL" value={ctl.length ? ctl[ctl.length - 1].toFixed(0) : "—"} points={ctl} delta={delta(ctl)} onClick={go} />
      <TrendTile label="Execution" value={exec.length ? `${exec[exec.length - 1].toFixed(1)}/10` : "—"} points={exec} delta={delta(exec)} onClick={go} />
      <TrendTile label="Compliance" value={compAvg !== null ? `${compAvg}%` : "—"} points={comp} delta={delta(comp)} onClick={go} />
    </div>
  );
}
