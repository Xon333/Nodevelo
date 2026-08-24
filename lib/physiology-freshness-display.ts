import type { PhysiologyFreshness } from "./types";

export function describeFreshnessForAthlete(
  f: PhysiologyFreshness
): { tone: "ok" | "warn" | "block"; text: string } {
  switch (f.state) {
    case "fresh": return { tone: "ok", text: `Physiology confirmed ${f.confirmedAt.slice(0, 10)} — current.` };
    case "sync-failed": return { tone: "warn", text: `Physiology check failed (${f.lastDetail}); using values confirmed ${f.lastConfirmedAt?.slice(0, 10) ?? "at an unknown time"}.` };
    case "stale": return { tone: "warn", text: f.lastConfirmedAt === null ? "Physiology has never been confirmed since freshness tracking began — re-sync to confirm." : `Physiology last confirmed ${f.lastConfirmedAt.slice(0, 10)} — ${f.ageDays} days ago. Re-sync or re-test.` };
    case "obsolete": return { tone: "block", text: `Physiology marked obsolete ${f.markedObsoleteAt.slice(0, 10)} — generation blocked until re-synced.` };
    case "inconsistent": return { tone: "block", text: `Physiology inconsistent (${f.reason}) — generation blocked until refreshed.` };
    case "malformed": return { tone: "block", text: "Physiology store is unreadable — restore its backup or re-sync. Generation blocked." };
    case "missing": return { tone: "block", text: "No physiology yet — connect Intervals.icu and sync. Generation blocked." };
  }
}
