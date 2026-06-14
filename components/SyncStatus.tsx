"use client";

import { timeAgo } from "@/lib/client-api";

interface Props {
  configured: boolean;
  lastSyncedAt: string | null;
  syncing: boolean;
  error: string | null;
  onSync: () => void;
}

export default function SyncStatus({ configured, lastSyncedAt, syncing, error, onSync }: Props) {
  const dot = !configured
    ? "bg-red-500"
    : error
      ? "bg-amber-500"
      : "bg-green-500 dark:bg-[#00d4ff] dark:[box-shadow:0_0_6px_2px_rgba(0,212,255,0.5)]";
  const statusText = !configured
    ? "Intervals.icu not configured — set INTERVALS_API_KEY and INTERVALS_ATHLETE_ID in .env.local"
    : error
      ? "Connection problem"
      : "Intervals.icu connected";

  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{statusText}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Last synced: {timeAgo(lastSyncedAt)}
              {lastSyncedAt ? ` (${new Date(lastSyncedAt).toLocaleString()})` : ""}
            </p>
          </div>
        </div>
        <button
          onClick={onSync}
          disabled={!configured || syncing}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:border dark:border-[#ff49c8]/50 dark:bg-transparent dark:text-[#ff49c8] dark:hover:bg-[#ff49c8]/10 dark:disabled:border-zinc-600 dark:disabled:text-zinc-500 dark:disabled:bg-transparent"
        >
          {syncing ? "Syncing…" : "Sync Now"}
        </button>
      </div>
      {error && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
