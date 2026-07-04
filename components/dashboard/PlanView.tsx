"use client";

import { useCallback, useEffect, useState } from "react";
import { api, nextMonday } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import type { AthleteMdSnapshot } from "@/lib/kb-loader";
import { currentPeriod, filterGoalsByFocus, formatSeasonContext, suggestedBlockWeeks } from "@/lib/season";
import type { BlockHistoryEntry, CurrentBlock, GeneratedPlan, SeasonPlan, WriteResult } from "@/lib/types";
import { useSync } from "../SyncProvider";
import PlanPreview from "../PlanPreview";
import RescheduleBanner from "../RescheduleBanner";
import SeasonRoadmap from "../SeasonRoadmap";
import { LoadFailed, useMountLoad } from "../ui";
import BlockGenerator from "./BlockGenerator";
import {
  BlockHistory,
  CurrentBlockSection,
  GoalsProgress,
  RetroSection,
  WeeklyDebrief,
} from "./plan";

// The /plan page body. Split out of the old dual-mode Dashboard (RV-8): it owns the block-generation,
// preview, retrospective and history state (none of which the Today page needs) and reads the synced
// app state from SyncProvider. The generator form itself is the separate BlockGenerator component.
export default function PlanView() {
  const { state, setState } = useSync();

  const [lengthWeeks, setLengthWeeks] = useState<2 | 4 | 6 | 8>(4);
  const [goal, setGoal] = useState("");
  const [rawGoals, setRawGoals] = useState<Array<{ goal: string; target: string; focus: string }>>([]);
  const [weakpointsText, setWeakpointsText] = useState("");
  const [startDate, setStartDate] = useState(nextMonday());
  const [seasonReadout, setSeasonReadout] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);

  const [writing, setWriting] = useState(false);
  const [writeResults, setWriteResults] = useState<WriteResult[] | null>(null);

  const [athleteMd, setAthleteMd] = useState<AthleteMdSnapshot | null>(null);
  const [goalsForProgress, setGoalsForProgress] = useState<Array<{ goal: string; target: string }>>([]);
  const [blockHistory, setBlockHistory] = useState<BlockHistoryEntry[]>([]);

  const [retroGenerating, setRetroGenerating] = useState(false);
  const [retroResult, setRetroResult] = useState<{
    retrospective: string;
    seeds: string[];
    complianceByType: Record<string, number>;
  } | null>(null);
  const [retroError, setRetroError] = useState<string | null>(null);

  // When a block is already active the generator collapses to a thin bar so it stops
  // cutting the Plan page in half; it expands on demand (and is always open with no block).
  const [genOpen, setGenOpen] = useState(false);

  // Degraded-state flags (S1-3): each best-effort fetch fails *visibly* — a LoadFailed line in the
  // slot with a retry — instead of the section silently not existing.
  const [historyFailed, setHistoryFailed] = useState(false);
  const [prefillFailed, setPrefillFailed] = useState(false);
  const [seasonCtxFailed, setSeasonCtxFailed] = useState(false);

  const loadBlockHistory = useCallback(async () => {
    // Flags only touched after the await, so the mount effect never setStates synchronously.
    try {
      const h = await api<BlockHistoryEntry[]>("/api/history");
      setBlockHistory(h);
      setHistoryFailed(false);
    } catch {
      setHistoryFailed(true);
    }
  }, []);

  // Plan-only data: goal/weakpoint prefill + block history (Today doesn't need them).
  const loadPrefill = useCallback(async () => {
    try {
      const response = await api<{
        athleteMd: AthleteMdSnapshot;
        goals: Array<{ goal: string; target: string; focus: string }>;
        weakpoints: Array<{ weakpoint: string; detail: string }>;
      }>("/api/profile");
      setAthleteMd(response.athleteMd);
      setGoalsForProgress(response.goals);
      setRawGoals(response.goals);
      if (response.weakpoints.length > 0) {
        setWeakpointsText(response.weakpoints.map((w) => w.weakpoint).join("\n"));
      }
      setPrefillFailed(false);
    } catch {
      setPrefillFailed(true);
    }
  }, []);

  useMountLoad(loadPrefill);
  useMountLoad(loadBlockHistory);

  // Season context for the generator: pre-fills length + narrows the goal pre-fill to what's relevant
  // this focus period, and surfaces a readout so the athlete can see why (Season/Block hierarchy).
  // Independent fetch from the profile prefill above; on failure the form falls back to today's
  // defaults — but the failure itself is shown (S1-3), since a silently missing season context
  // changes what gets generated.
  const loadSeasonCtx = useCallback(async () => {
    try {
      const { plan } = await api<{ plan: SeasonPlan }>("/api/season");
      const today = localToday();
      const period = currentPeriod(plan, today);
      if (period) {
        setLengthWeeks(suggestedBlockWeeks(period, today));
        setSeasonReadout(formatSeasonContext(plan, today));
        if (rawGoals.length > 0) {
          const filtered = filterGoalsByFocus(rawGoals as Array<{ goal: string; target: string; focus: import("@/lib/types").SeasonFocus | "general" }>, period.focus);
          setGoal(filtered.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
        }
      } else if (rawGoals.length > 0) {
        setGoal(rawGoals.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
      }
      setSeasonCtxFailed(false);
    } catch {
      setSeasonCtxFailed(true);
    }
  }, [rawGoals]);

  // Re-runs when rawGoals lands (the callback's dep), matching the old effect's behaviour.
  useMountLoad(loadSeasonCtx);

  // Elapsed counter ticks while a generation is in flight. The reset to 0 lives in generate()
  // (where the run starts) rather than in this effect, so no setState fires synchronously here.
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [generating]);

  if (!state) return null; // Dashboard already guards loadError / loading; this narrows the type.

  const generate = async () => {
    if (!goal.trim()) {
      setGenerateError("Enter a block goal first.");
      return;
    }
    setElapsed(0);
    setGenerating(true);
    setGenerateError(null);
    setWriteResults(null);
    try {
      const { plan } = await api<{ plan: GeneratedPlan }>("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          lengthWeeks,
          goal: goal.trim(),
          startDate,
          weakpoints: weakpointsText
            .split("\n")
            .map((w) => w.trim())
            .filter(Boolean),
        }),
      });
      setPlan(plan);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const write = async () => {
    if (!plan) return;
    setWriting(true);
    try {
      const { results, currentBlock } = await api<{
        results: WriteResult[];
        currentBlock: CurrentBlock | null;
      }>("/api/write", { method: "POST", body: JSON.stringify({ plan }) });
      setWriteResults(results);
      if (currentBlock) {
        setState((s) => (s ? { ...s, currentBlock } : s));
        void loadBlockHistory();
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Write failed");
    } finally {
      setWriting(false);
    }
  };

  // S2-7: the confirm now happens in-product, inline in CurrentBlockSection (plan.tsx) before this
  // fires — window.confirm's generic browser dialog never stated that ridden history/scores survive.
  const deleteBlock = async () => {
    try {
      await api("/api/sync", { method: "DELETE" });
      setState((s) => (s ? { ...s, currentBlock: null } : s));
      setPlan(null);
      setWriteResults(null);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const generateRetro = async () => {
    setRetroGenerating(true);
    setRetroError(null);
    try {
      const result = await api<{ retrospective: string; seeds: string[]; complianceByType: Record<string, number> }>(
        "/api/retrospective",
        { method: "POST" }
      );
      setRetroResult(result);
      // Block is now cleared server-side — update local state.
      setState((s) => (s ? { ...s, currentBlock: null } : s));
      void loadBlockHistory();
    } catch (err) {
      setRetroError(err instanceof Error ? err.message : "Retrospective failed");
    } finally {
      setRetroGenerating(false);
    }
  };

  const hasActiveBlock = state.currentBlock !== null && state.currentBlock.endDate >= localToday();

  return (
    <div className="space-y-3">
      <SeasonRoadmap />
      <RescheduleBanner />
      <RetroSection
        block={state.currentBlock}
        generating={retroGenerating}
        result={retroResult}
        error={retroError}
        onGenerate={generateRetro}
      />

      {!retroResult && <CurrentBlockSection block={state.currentBlock} onDelete={deleteBlock} scores={state.scores} compromisedDates={state.compromisedDates} partialDates={state.partialDates} />}

      {/* Goals + this-week side by side, just under the active block */}
      {(athleteMd || state.lastSync) && (
        <div className="grid gap-3 sm:grid-cols-[1.7fr_1fr]">
          {goalsForProgress.length > 0 && athleteMd && (
            <GoalsProgress goals={goalsForProgress} performanceData={athleteMd.performanceData} />
          )}
          {state.lastSync && <WeeklyDebrief sync={state.lastSync} />}
        </div>
      )}

      {/* Degraded prefill notices — the generator still works, but the athlete should know the
          fields aren't reflecting their profile/season right now. */}
      {prefillFailed && <LoadFailed what="your profile prefill (goals & weakpoints)" retry={() => void loadPrefill()} />}
      {seasonCtxFailed && <LoadFailed what="the season context for the generator" retry={() => void loadSeasonCtx()} />}

      {/* Block generation — collapses to a thin bar when a block is active so it no longer
          cuts the page in half; always open when there's no block to generate against. */}
      <BlockGenerator
        hasActiveBlock={hasActiveBlock}
        genOpen={genOpen}
        setGenOpen={setGenOpen}
        lengthWeeks={lengthWeeks}
        setLengthWeeks={setLengthWeeks}
        startDate={startDate}
        setStartDate={setStartDate}
        goal={goal}
        setGoal={setGoal}
        weakpointsText={weakpointsText}
        setWeakpointsText={setWeakpointsText}
        generating={generating}
        generate={generate}
        generateError={generateError}
        elapsed={elapsed}
        anthropicConfigured={state.anthropicConfigured}
        showSyncTip={!state.lastSync && state.configured}
        seasonReadout={seasonReadout}
      />

      {plan && (
        <PlanPreview
          plan={plan}
          writing={writing}
          results={writeResults}
          intervalsConfigured={state.configured}
          onWrite={write}
          onDismiss={() => {
            setPlan(null);
            setWriteResults(null);
          }}
        />
      )}

      {historyFailed ? (
        <LoadFailed what="block history" retry={() => void loadBlockHistory()} />
      ) : (
        <BlockHistory history={blockHistory} />
      )}
    </div>
  );
}
