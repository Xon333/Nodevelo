"use client";

import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
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
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within <SyncProvider>");
  return ctx;
}

// Owns the synced app state so both the nav-rail sync control and the page views
// share one source of truth. Page-specific data (profile, history, plan) stays local.
export function SyncProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);

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
    if (analysisPending) {
      setAnalyzing(true);
      try {
        const a = await api<{ todayAnalysis: TodayAnalysis | null; warnings: string[] }>(
          "/api/analyze",
          { method: "POST", body: JSON.stringify({ today: localToday() }) }
        );
        if (a.todayAnalysis) setState((s) => (s ? { ...s, todayAnalysis: a.todayAnalysis } : s));
        if (a.warnings?.length) setSyncWarnings((w) => [...w, ...a.warnings]);
      } catch (e) {
        setSyncWarnings((w) => [...w, `Coach analysis failed: ${e instanceof Error ? e.message : "error"}`]);
      } finally {
        setAnalyzing(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const appState = await api<AppState>("/api/sync");
        if (!cancelled) setState(appState);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SyncContext.Provider value={{ state, setState, loadError, syncing, syncError, analyzing, syncWarnings, doSync }}>
      {children}
    </SyncContext.Provider>
  );
}
