import { Card } from "./ui";
import type { IfBandOffsetRow } from "@/lib/calibration";

// Read-only view of the per-type IF effort-band shifts the scorer derives from the athlete's own power
// zones (ROADMAP #2, anti-black-box). Pure presentational — the rows are computed server-side in the
// model page from the synced zones (lib/calibration.ifBandOffsetRows), so this can't drift from scoring.
export default function IfBandOffsets({ rows }: { rows: IfBandOffsetRow[] }) {
  const hasZones = rows.some((r) => r.athleteTopPct != null);
  const fmt = (o: number) => (o === 0 ? "default" : `${o > 0 ? "+" : ""}${o.toFixed(2)}`);
  return (
    <Card title="Effort bands from your zones">
      <p className="-mt-1 mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        How your Intervals.icu power zones shift the execution-score intensity bands per session type. Derived
        live from your synced zones — a zone that matches the population default scores on the default band.
      </p>
      {!hasZones ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Sync your Intervals.icu power zones to see this.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.type} className="border-t border-zinc-100 pt-3 first:border-t-0 first:pt-0 dark:border-zinc-700/60">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{r.type}</span>
                <span className="font-mono text-sm text-zinc-900 dark:text-zinc-100">
                  IF {fmt(r.offset)}
                  {r.offset !== 0 && (
                    <span className="ml-1 align-middle text-[10px] font-normal uppercase tracking-wide text-zinc-500 dark:text-[#ff49c8]">
                      shifted
                    </span>
                  )}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                Anchored to your {r.anchorZone} top:{" "}
                {r.athleteTopPct != null ? `${r.athleteTopPct}% FTP` : "—"} (default {r.defaultTopPct}%).
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
