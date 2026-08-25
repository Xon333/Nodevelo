import type { PhysiologyFreshness } from "./types";

export const freshnessToneClasses = {
  ok: {
    panel: "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900",
    text: "text-zinc-800 dark:text-zinc-100",
    banner: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
  },
  warn: {
    panel: "border-amber-200 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/40",
    text: "text-amber-900 dark:text-amber-300",
    banner: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  },
  block: {
    panel: "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/50",
    text: "text-red-900 dark:text-red-300",
    banner: "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300",
  },
} as const;

export function describeFreshnessForAthlete(
  f: PhysiologyFreshness,
  today?: string
): { tone: "ok" | "warn" | "block"; text: string } {
  switch (f.state) {
    case "fresh":
      return { tone: "ok", text: f.confirmedDate === today ? "Physiology confirmed today — current." : f.confirmedDate ? `Physiology confirmed ${f.confirmedDate} — current.` : "Physiology confirmed recently — current." };
    case "sync-failed":
      return { tone: "warn", text: `Physiology check failed (${f.lastDetail}); using values confirmed ${f.lastConfirmedDate ?? "at an unknown time"}.` };
    case "stale":
      return { tone: "warn", text: f.lastConfirmedAt === null ? "Physiology has never been confirmed since freshness tracking began — re-sync to confirm." : f.ageDays === null || !f.lastConfirmedDate ? "Physiology confirmation date is unavailable — re-sync to confirm freshness." : `Physiology last confirmed ${f.lastConfirmedDate} — ${f.ageDays} days ago. Re-sync or re-test.` };
    case "obsolete":
      return { tone: "block", text: "Physiology marked obsolete — generation blocked until re-synced." };
    case "inconsistent":
      return { tone: "block", text: `Physiology inconsistent (${f.reason}) — generation blocked until refreshed.` };
    case "malformed":
      return { tone: "block", text: "Physiology store is unreadable — restore its backup or re-sync. Generation blocked." };
    case "missing":
      return { tone: "block", text: "No physiology yet — connect Intervals.icu and sync. Generation blocked." };
  }
}
