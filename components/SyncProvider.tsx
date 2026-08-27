"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { api } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import type {
  AcwrResult,
  AthleteState,
  CurrentBlock,
  EffectiveOutcome,
  FatigueAlert,
  IntensityDistribution,
  LoadRampAlert,
  NoBlockSummary,
  PhysiologyFreshness,
  ReadinessSignal,
  CalibrationStore,
  RideScoreEntry,
  SyncData,
  TodayAnalysis,
} from "@/lib/types";
import type { CoachSnapshot } from "@/lib/coach-snapshot";
import type { EaLevel, NeatImbalanceContext, NutritionModel, NutritionTrendWarning } from "@/lib/nutrition";

export interface AppState {
  configured: boolean;
  anthropicConfigured: boolean;
  lastSync: SyncData | null;
  currentBlock: CurrentBlock | null;
  todayAnalysis: TodayAnalysis | null;
  // Phase 2c: today's overlay-resolved outcome (null score display is wrong without this — the
  // debrief must not fall back to TodayAnalysis.executionScore once a self-directed overlay applies).
  todayOutcome: EffectiveOutcome | null;
  readiness: ReadinessSignal | null;
  fatigueAlert: FatigueAlert | null;
  loadRamp: LoadRampAlert | null;
  acwr: AcwrResult | null;
  // Phase 3a: the no-block weekly-envelope/session-suggestion/three-stream surface. Null while a block
  // is genuinely active, or before the first sync (readiness/loadRamp themselves null there).
  noBlockSummary: NoBlockSummary | null;
  polarization: IntensityDistribution | null;
  scores: RideScoreEntry[];
  compromisedDates: string[];
  partialDates: string[];
  completedDates: string[];
  autoSyncOnOpen: boolean;
  // Validation-loop self-assessment: how often acting on the coach's matured directives proved
  // right. hitRatePct is null until the 28-day horizon produces a decisive outcome.
  coachAccuracy?: { hitRatePct: number | null; evaluated: number; pending: number };
  // Signal fusion (§5): the glanceable "second brain's read on you now". Null with too little data.
  athleteState?: AthleteState | null;
  // Task 10: same assessed physiology verdict GET /api/sync already exposes; POST /api/sync doesn't
  // carry it, so the following GET refetch remains the source of truth.
  physiologyFreshness?: PhysiologyFreshness | null;
  // ROADMAP #1: the resolved-numbers snapshot the LLM is handed, surfaced on Today so the athlete
  // sees the same figures the coach reasons from.
  coachSnapshot?: CoachSnapshot | null;
  // ROADMAP #2: per-athlete calibration (read-only on Settings).
  calibration?: CalibrationStore | null;
  // §10: the resolved nutrition model (rmr/neatMultiplier or legacy baseCalories) the under-fuelling
  // streak alert needs — same resolve GET /api/sync already does for coachSnapshot's fuel figures.
  // GET-only (not returned by the POST sync response); a doSync() invalidates this query, so the
  // following GET refetch fills it in, same pattern as coachAccuracy/autoSyncOnOpen above.
  nutritionModel?: NutritionModel | null;
  // Historical windows span both day types; JSON cannot carry a resolver function, so GET /api/sync
  // sends the two plain models and the client selects per day.
  nutritionModelsByDayType?: { rest: NutritionModel; train: NutritionModel } | null;
  nutritionTrendWarning?: NutritionTrendWarning | null;
  planEaKcalPerKg?: number | null;
  planEaLevel?: EaLevel | null;
  // §10: the calibrated NEAT solve's out-of-band finding, when the energy-balance identity didn't
  // close — surfaced alongside the streak alert so an apparent deficit is never acted on without also
  // seeing the log-bias/RMR-equation ambiguity that could explain it. Tagged with which day-type split
  // (rest/train) it came from once one is adopted — `dayType: null` is the pre-split pooled figure.
  neatImbalance?: NeatImbalanceContext | null;
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
  const { data, error } = useQuery({ queryKey: SYNC_QUERY_KEY, queryFn: () => api<AppState>(`/api/sync?today=${localToday()}`) });
  const state = data ?? null;
  const loadError = error ? (error instanceof Error ? error.message : "Couldn't load — try again.") : null;

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

  // UXA-6: a ref-based re-entrancy guard, not just the `analyzing` state — a double-click races two
  // calls before the first setAnalyzing(true) has re-rendered; coach-note generation is billed and
  // deterministic intent evaluation still must not race it.
  const analyzingRef = useRef(false);

  // Deferred AI work. Shared by the post-sync auto-run (force=false, idempotent) and the manual
  // re-analyse action (force=true). One ref guard covers both deferred endpoints.
  const runAnalysis = useCallback(async (force: boolean) => {
    if (analyzingRef.current) return;
    analyzingRef.current = true;
    setAnalyzing(true);

    // Intent scoring runs to completion BEFORE coach-note generation, not after.
    // The note prompt (lib/sync-analysis.ts's addCoachNote) reads today's resolved overlay to decide
    // whether the raw note may reach the model at all — if /api/analyze ran first, that overlay
    // wouldn't exist yet, and the coach note could assert a confident intent-execution judgment on the
    // very note the deterministic scorer goes on to reject a moment later.
    try {
      const failed = new Set<string>();
      for (let round = 0; round < 6; round += 1) {
        const result = await api<{
          processed: number;
          remaining: number;
          stalled: boolean;
          failedIds: string[];
          warnings: string[];
        }>("/api/intent", {
          method: "POST",
          body: JSON.stringify({ today: localToday(), force, skip: [...failed] }),
        });
        for (const id of result.failedIds) failed.add(id);
        if (result.warnings?.length) setSyncWarnings((w) => [...w, ...result.warnings]);
        if (!(result.remaining > 0 && !result.stalled && result.processed > 0)) break;
      }
    } catch (e) {
      setSyncWarnings((w) => [...w, `Intent analysis failed: ${e instanceof Error ? e.message : "error"}`]);
    }

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
      // Phase 2c: an overlay the intent loop just wrote is invisible to the UI until /api/sync is
      // re-fetched — todayOutcome was resolved from whatever the store held BEFORE this loop ran.
      // Invalidating (not just marking stale) forces the refetch even if the athlete isn't looking at
      // a component that would otherwise trigger one on its own.
      await queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY });
      setAnalyzing(false);
      analyzingRef.current = false;
    }
  }, [setState, queryClient]);

  const doSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncWarnings([]);
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
        noBlockSummary: NoBlockSummary | null;
        polarization: IntensityDistribution | null;
        scores: RideScoreEntry[];
        compromisedDates: string[];
        partialDates: string[];
        completedDates: string[];
        athleteState: AthleteState | null;
        coachSnapshot: CoachSnapshot | null;
        calibration: CalibrationStore | null;
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
              noBlockSummary: result.noBlockSummary,
              polarization: result.polarization,
              scores: result.scores,
              compromisedDates: result.compromisedDates,
              partialDates: result.partialDates,
              completedDates: result.completedDates,
              athleteState: result.athleteState,
              coachSnapshot: result.coachSnapshot,
              calibration: result.calibration,
            }
          : s
      );
      if (result.warnings?.length) setSyncWarnings(result.warnings);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Couldn't sync — try again.");
      setSyncing(false);
      return;
    }
    // HR-45: this POST's response carries no `currentBlock` field, even though sync itself can mutate
    // the block (inbound calendar-move reconciliation, execution-outcome backfill) — the manual merge
    // above would otherwise leave the cached block stale after a sync that moved something. GET
    // /api/sync (the query this cache key backs) DOES return `currentBlock`, so invalidate and let the
    // next read re-fetch fresh state — same idiom DayAction already uses for the same gap.
    await queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY });
    // Fast path done — surface the data immediately, then fetch the deferred coach note so an
    // Anthropic hiccup never blocks (or fails) the sync itself.
    setSyncing(false);
    // Always run the idempotent deferred step: a prior transient intent failure must retry on a later
    // sync even when today's coach note already exists.
    await runAnalysis(false);
  }, [queryClient, runAnalysis, setState]);

  // Manual re-analyse — force a fresh coach note (e.g. after the auto-run failed).
  const reAnalyse = useCallback(() => runAnalysis(true), [runAnalysis]);

  return (
    <SyncContext.Provider value={{ state, setState, loadError, syncing, syncError, analyzing, syncWarnings, doSync, reAnalyse }}>
      {children}
    </SyncContext.Provider>
  );
}
