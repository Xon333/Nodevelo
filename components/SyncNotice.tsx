"use client";

import { useState } from "react";
import { useSync } from "./SyncProvider";

// Global, dismissible banner for sync reliability signals — the prominent surface the cramped 10px
// nav-rail text never gave (and mobile never showed at all). Errors (a failed/refused sync, incl. the
// 502 empty-sync guard that keeps prior data, or a failed initial load) show red with a Retry; the
// non-fatal `warnings[]` from a sub-step (quirk mining, intervention validation, ride analysis, coach
// note) show amber. Dismissal is keyed to the message, so a *new* problem re-surfaces after dismiss;
// a clean re-sync clears the state on its own.
export default function SyncNotice() {
  const { state, syncing, syncError, loadError, syncWarnings, doSync } = useSync();
  const [dismissed, setDismissed] = useState<string | null>(null);

  const error = syncError ?? loadError ?? null;
  const warnings = syncWarnings ?? [];
  // One key per distinct notice; dismissing hides until a different notice appears.
  const key = error ? `e:${error}` : warnings.length ? `w:${warnings.join("|")}` : null;
  if (!key || key === dismissed) return null;

  const isError = !!error;
  const tone = isError
    ? "border-red-300 bg-red-50/95 dark:border-red-800/70 dark:bg-red-950/90"
    : "border-amber-300 bg-amber-50/95 dark:border-amber-800/70 dark:bg-amber-950/85";
  const headColor = isError ? "text-red-800 dark:text-red-200" : "text-amber-800 dark:text-amber-200";
  const bodyColor = isError ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300";

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className="fixed inset-x-0 top-14 z-50 px-3 sm:left-44 sm:top-4 sm:px-6"
    >
      <div className={`mx-auto max-w-2xl rounded-lg border px-3.5 py-3 shadow-lg backdrop-blur ${tone}`}>
        <div className="flex items-start gap-3">
          <span className={`mt-px text-sm ${bodyColor}`} aria-hidden>
            {isError ? "✕" : "⚠"}
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-semibold ${headColor}`}>
              {isError ? "Sync problem" : `Synced with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`}
            </p>
            {isError ? (
              <p className={`mt-0.5 text-[11px] leading-snug ${bodyColor}`}>{error}</p>
            ) : (
              <ul className="mt-0.5 space-y-0.5">
                {warnings.map((w, i) => (
                  <li key={i} className={`text-[11px] leading-snug ${bodyColor}`}>
                    • {w}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center gap-3">
              {isError && state?.configured && (
                <button
                  onClick={() => void doSync()}
                  disabled={syncing}
                  className="rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {syncing ? "Retrying…" : "Retry sync"}
                </button>
              )}
              <button onClick={() => setDismissed(key)} className={`text-[11px] font-medium hover:underline ${bodyColor}`}>
                Dismiss
              </button>
            </div>
          </div>
          <button
            onClick={() => setDismissed(key)}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 shrink-0 rounded p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
