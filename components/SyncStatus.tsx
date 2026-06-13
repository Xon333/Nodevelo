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
  const dot = !configured ? "bg-red-500" : error ? "bg-amber-500" : "bg-green-500";
  const statusText = !configured
    ? "Intervals.icu not configured — set INTERVALS_API_KEY and INTERVALS_ATHLETE_ID in .env.local"
    : error
      ? "Connection problem"
      : "Intervals.icu connected";

  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
          <div>
            <p className="text-sm font-medium text-zinc-900">{statusText}</p>
            <p className="text-xs text-zinc-500">
              Last synced: {timeAgo(lastSyncedAt)}
              {lastSyncedAt ? ` (${new Date(lastSyncedAt).toLocaleString()})` : ""}
            </p>
          </div>
        </div>
        <button
          onClick={onSync}
          disabled={!configured || syncing}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {syncing ? "Syncing…" : "Sync Now"}
        </button>
      </div>
      {error && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
    </section>
  );
}
