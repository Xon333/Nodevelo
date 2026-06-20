"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { api } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import type {
  AcwrResult,
  CurrentBlock,
  FatigueAlert,
  IntensityDistribution,
  LoadRampAlert,
  ReadinessSignal,
  RideScoreEntry,
  SyncData,
  TodayAnalysis,
} from "@/lib/types";

export interface AppState {
  configured: boolean;
  anthropicConfigured: boolean;
  lastSync: SyncData | null;
  currentBlock: CurrentBlock | null;
  todayAnalysis: TodayAnalysis | null;
  readiness: ReadinessSignal | null;
  fatigueAlert: FatigueAlert | null;
  loadRamp: LoadRampAlert | null;
  acwr: AcwrResult | null;
  polarization: IntensityDistribution | null;
  scores: RideScoreEntry[];
  compromisedDates: string[];
  partialDates: string[];
  autoSyncOnOpen: boolean;
  // Validation-loop self-assessment: how often acting on the coach's matured directives proved
  // right. hitRatePct is null until the 28-day horizon produces a decisive outcome.
  coachAccuracy?: { hitRatePct: number | null; evaluated: number; pending: number };
}

interface SyncContextValue {
  state: AppState | null;
  setState: Dispatch<SetStateAction<AppState | null>>;
  loadError: string | null;
  syncing: boolean;
  syncError: string | null;
  // The deferred AI coach-note step (/api/analyze) is running after a fast sync.
  analyzing: boolean;
  // Non-fatal step failures surfaced from the last sync/analyze (e.g. intervention validation,
  // coach-note generation) — shown rather than swallowed.
  syncWarnings: string[];
  doSync: () => Promise<void>;
  // Manually (re)generate today's coach note — recovers a note lost to an Anthropic hiccup without
  // a full re-sync. `force` regenerates even if a note already exists.
  reAnalyse: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

// The synced app state lives under this key in the TanStack Query cache. Exported so other code
// could invalidate/read it directly if needed.
export const SYNC_QUERY_KEY = ["sync"] as const;

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within <SyncProvider>");
  return ctx;
}

// Owns the synced app state so both the nav-rail sync control and the page views share one source of
// truth. The GET load is a TanStack Query (`['sync']`) — so it dedups, retries, and refetches on tab
// focus / network reconnect (fixing the "stale after an overnight tab" UX). `doSync` (the POST that
// actually hits Intervals.icu) and the deferred coach-note step stay explicit actions that write
// their results back into the same query cache via `setState`. Page-specific data (profile, history,
// plan) stays local.
export function SyncProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, error } = useQuery({ queryKey: SYNC_QUERY_KEY, queryFn: () => api<AppState>("/api/sync") });
  const state = data ?? null;
  const loadError = error ? (error instanceof Error ? error.message : "Failed to load") : null;

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);

  // Write through to the query cache so every consumer (and any background refetch) sees one source
  // of truth. Keeps the React-style `setState(value | updater)` signature callers already use.
  const setState = useCallback<Dispatch<SetStateAction<AppState | null>>>(
    (action) => {
      queryClient.setQueryData<AppState | null>(SYNC_QUERY_KEY, (prev) => {
        const current = prev ?? null;
        return typeof action === "function"
          ? (action as (p: AppState | null) => AppState | null)(current)
          : action;
      });
    },
    [queryClient]
  );

  // The deferred AI coach-note step. Shared by the post-sync auto-run (force=false, idempotent) and
  // the manual re-analyse action (force=true, regenerates).
  const runAnalysis = useCallback(async (force: boolean) => {
    setAnalyzing(true);
    try {
      const a = await api<{ todayAnalysis: TodayAnalysis | null; warnings: string[] }>(
        "/api/analyze",
        { method: "POST", body: JSON.stringify({ today: localToday(), force }) }
      );
      if (a.todayAnalysis) setState((s) => (s ? { ...s, todayAnalysis: a.todayAnalysis } : s));
      if (a.warnings?.length) setSyncWarnings((w) => [...w, ...a.warnings]);
    } catch (e) {
      setSyncWarnings((w) => [...w, `Coach analysis failed: ${e instanceof Error ? e.message : "error"}`]);
    } finally {
      setAnalyzing(false);
    }
  }, [setState]);

  const doSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncWarnings([]);
    let analysisPending = false;
    try {
      const result = await api<{
        lastSync: SyncData;
        todayAnalysis: TodayAnalysis | null;
        analysisPending: boolean;
        warnings: string[];
        readiness: ReadinessSignal | null;
        fatigueAlert: FatigueAlert | null;
        loadRamp: LoadRampAlert | null;
        acwr: AcwrResult | null;
        polarization: IntensityDistribution | null;
        scores: RideScoreEntry[];
        compromisedDates: string[];
        partialDates: string[];
        // Send the browser's LOCAL date so the server matches today's ride on the same calendar
        // day the athlete sees — not the server's UTC date.
      }>("/api/sync", { method: "POST", body: JSON.stringify({ today: localToday() }) });
      setState((s) =>
        s
          ? {
              ...s,
              lastSync: result.lastSync,
              todayAnalysis: result.todayAnalysis,
              readiness: result.readiness,
              fatigueAlert: result.fatigueAlert,
              loadRamp: result.loadRamp,
              acwr: result.acwr,
              polarization: result.polarization,
              scores: result.scores,
              compromisedDates: result.compromisedDates,
              partialDates: result.partialDates,
            }
          : s
      );
      if (result.warnings?.length) setSyncWarnings(result.warnings);
      analysisPending = result.analysisPending;
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
      setSyncing(false);
      return;
    }
    // Fast path done — surface the data immediately, then fetch the deferred coach note so an
    // Anthropic hiccup never blocks (or fails) the sync itself.
    setSyncing(false);
    if (analysisPending) await runAnalysis(false);
  }, [runAnalysis, setState]);

  // Manual re-analyse — force a fresh coach note (e.g. after the auto-run failed).
  const reAnalyse = useCallback(() => runAnalysis(true), [runAnalysis]);

  return (
    <SyncContext.Provider value={{ state, setState, loadError, syncing, syncError, analyzing, syncWarnings, doSync, reAnalyse }}>
      {children}
    </SyncContext.Provider>
  );
}
