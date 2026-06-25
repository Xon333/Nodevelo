"use client";

import { useCallback, useEffect, useState } from "react";
import { api, nextMonday } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import type { AthleteMdSnapshot } from "@/lib/kb-loader";
import type { BlockHistoryEntry, CurrentBlock, GeneratedPlan, WriteResult } from "@/lib/types";
import { useSync } from "../SyncProvider";
import PlanPreview from "../PlanPreview";
import RescheduleBanner from "../RescheduleBanner";
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

  const [lengthWeeks, setLengthWeeks] = useState<2 | 4>(4);
  const [goal, setGoal] = useState("");
  const [weakpointsText, setWeakpointsText] = useState("");
  const [startDate, setStartDate] = useState(nextMonday());

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);

  const [writing, setWriting] = useState(false);
  const [writeResults, setWriteResults] = useState<WriteResult[] | null>(null);

  const [athleteMd, setAthleteMd] = useState<AthleteMdSnapshot | null>(null);
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

  const loadBlockHistory = useCallback(async () => {
    try {
      const h = await api<BlockHistoryEntry[]>("/api/history");
      setBlockHistory(h);
    } catch {
      // history is best-effort
    }
  }, []);

  // Plan-only data: goal/weakpoint prefill + block history (Today doesn't need them).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { athleteMd: md } = await api<{ athleteMd: AthleteMdSnapshot }>("/api/profile");
        if (!cancelled) {
          setAthleteMd(md);
          if (md.goals.length > 0) {
            setGoal(md.goals.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
          }
          if (md.weakpoints.length > 0) {
            setWeakpointsText(md.weakpoints.map((w) => w.weakpoint).join("\n"));
          }
        }
      } catch {
        // profile prefill is best-effort
      }
      void loadBlockHistory();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadBlockHistory]);

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

  const deleteBlock = async () => {
    if (!window.confirm("Delete the current block? You can generate a new one after.")) return;
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
          {athleteMd && <GoalsProgress athleteMd={athleteMd} />}
          {state.lastSync && <WeeklyDebrief sync={state.lastSync} />}
        </div>
      )}

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

      <BlockHistory history={blockHistory} />
    </div>
  );
}
