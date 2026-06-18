"use client";

import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { api } from "@/lib/client-api";
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

  const doSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await api<{
        lastSync: SyncData;
        todayAnalysis: TodayAnalysis | null;
        readiness: ReadinessSignal | null;
        fatigueAlert: FatigueAlert | null;
        loadRamp: LoadRampAlert | null;
        acwr: AcwrResult | null;
        polarization: IntensityDistribution | null;
        scores: RideScoreEntry[];
        compromisedDates: string[];
        partialDates: string[];
      }>("/api/sync", { method: "POST" });
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
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
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
    <SyncContext.Provider value={{ state, setState, loadError, syncing, syncError, doSync }}>
      {children}
    </SyncContext.Provider>
  );
}
