"use client";

import { useCallback, useEffect, useState } from "react";
import { api, nextMonday } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import type { AthleteMdSnapshot } from "@/lib/kb-loader";
import { currentPeriod, filterGoalsByFocus, formatSeasonContext, suggestedBlockWeeks, FOCUS_LABELS, type SeasonOutlookSlot } from "@/lib/season";
import { mergeGoalsFromBlockText, parseWeakpointLines } from "@/lib/profile-goals";
import type { BlockHistoryEntry, CurrentBlock, GeneratedPlan, SeasonPlan, WriteResult } from "@/lib/types";
import { useSync } from "../SyncProvider";
import PlanPreview from "../PlanPreview";
import RescheduleBanner from "../RescheduleBanner";
import SeasonRoadmap from "../SeasonRoadmap";
import SeasonSection from "../SeasonSection";
import { LoadFailed, useMountLoad } from "../ui";
import BlockGenerator from "./BlockGenerator";
import {
  BlockHistory,
  CurrentBlockSection,
  RetroSection,
} from "./plan";

// The /plan page body. Split out of the old dual-mode Dashboard (RV-8): it owns the block-generation,
// preview, retrospective and history state (none of which the Today page needs) and reads the synced
// app state from SyncProvider. The generator form itself is the separate BlockGenerator component.
export default function PlanView() {
  const { state, setState } = useSync();

  const [lengthWeeks, setLengthWeeks] = useState<2 | 4 | 6 | 8>(4);
  const [goal, setGoal] = useState("");
  const [rawGoals, setRawGoals] = useState<Array<{ goal: string; target: string; focus: string }>>([]);
  // The exact subset of rawGoals the goal textarea was last pre-filled from (narrowed by season
  // focus, see loadSeasonCtx) — saveGoalsAndWeakpointsToProfile needs this to scope its merge so it
  // never deletes a goal belonging to a focus this box never showed.
  const [shownGoals, setShownGoals] = useState<Array<{ goal: string; target: string; focus: string }>>([]);
  const [weakpointsText, setWeakpointsText] = useState("");
  const [profileSaveState, setProfileSaveState] = useState<
    { state: "idle" | "saving" | "saved" } | { state: "error"; message: string }
  >({ state: "idle" });
  const [startDate, setStartDate] = useState(nextMonday());
  const [seasonReadout, setSeasonReadout] = useState<string | null>(null);
  const [focusLabel, setFocusLabel] = useState<string | null>(null);
  const [goalCount, setGoalCount] = useState(0);
  // Bumped after a successful Season save so the roadmap strip and generator context re-fetch
  // instead of going stale until reload (UX v2 W1 review, Finding 1).
  const [seasonVersion, setSeasonVersion] = useState(0);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);

  const [writing, setWriting] = useState(false);
  const [writeResults, setWriteResults] = useState<WriteResult[] | null>(null);

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
      setRawGoals(response.goals);
      if (response.weakpoints.length > 0) {
        setWeakpointsText(
          response.weakpoints.map((w) => w.weakpoint + (w.detail ? `: ${w.detail}` : "")).join("\n")
        );
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
      const today = localToday();
      const { plan, outlook } = await api<{ plan: SeasonPlan; outlook: SeasonOutlookSlot[] | null }>(`/api/season?today=${today}`);
      // The block-length suggestion still comes from a real committed period when one exists (event
      // mode's persisted arc) — harmless and self-resolving if rolling mode briefly still has a
      // straddling settled period left over from before this redesign.
      const period = currentPeriod(plan, today);
      if (period) setLengthWeeks(suggestedBlockWeeks(period, today));

      const next = outlook?.[0] ?? null;
      if (next) {
        // Rolling mode, SEASON_SHAPES_GENERATION on: the server already ran chooseNextFocus for this
        // exact "next block" decision — show it directly instead of re-deriving anything client-side.
        setSeasonReadout(`${FOCUS_LABELS[next.focus]} — ${next.rationale}`);
        setFocusLabel(FOCUS_LABELS[next.focus]);
        if (rawGoals.length > 0) {
          const filtered = filterGoalsByFocus(rawGoals as Array<{ goal: string; target: string; focus: import("@/lib/types").SeasonFocus | "general" }>, next.focus);
          setGoalCount(filtered.length);
          setGoal(filtered.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
          setShownGoals(filtered);
        }
      } else if (period) {
        // Event mode: the server never projects an outlook while a real committed arc exists — use the
        // period directly, exactly as before this redesign.
        setSeasonReadout(formatSeasonContext(plan, today));
        setFocusLabel(FOCUS_LABELS[period.focus]);
        if (rawGoals.length > 0) {
          const filtered = filterGoalsByFocus(rawGoals as Array<{ goal: string; target: string; focus: import("@/lib/types").SeasonFocus | "general" }>, period.focus);
          setGoalCount(filtered.length);
          setGoal(filtered.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
          setShownGoals(filtered);
        }
      } else {
        // Nothing to target — no current period, no outlook (season disabled or a brand-new season).
        setSeasonReadout(null);
        setFocusLabel(null);
        if (rawGoals.length > 0) {
          setGoal(rawGoals.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
          setShownGoals(rawGoals);
        }
      }
      setSeasonCtxFailed(false);
    } catch {
      setSeasonReadout(null);
      setFocusLabel(null);
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
          today: localToday(),
        }),
      });
      setPlan(plan);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  // Opt-in only — never runs as a side effect of generate(). A one-off block-time wording tweak
  // should stay one-off; this is the explicit "also make it permanent" action.
  const saveGoalsAndWeakpointsToProfile = async () => {
    setProfileSaveState({ state: "saving" });
    try {
      const mergedGoals = mergeGoalsFromBlockText(
        rawGoals as Array<{ goal: string; target: string; focus: import("@/lib/types").SeasonFocus | "general" }>,
        shownGoals as Array<{ goal: string; target: string; focus: import("@/lib/types").SeasonFocus | "general" }>,
        goal
      );
      const mergedWeakpoints = parseWeakpointLines(weakpointsText);
      await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify({ goals: mergedGoals, weakpoints: mergedWeakpoints }),
      });
      setProfileSaveState({ state: "saved" });
      void loadPrefill(); // re-fetch from the server (mirrors AthleteProfileForm's save) rather than trusting the client-side merge as final
    } catch (err) {
      setProfileSaveState({ state: "error", message: err instanceof Error ? err.message : "Save failed" });
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
      <SeasonRoadmap refreshKey={seasonVersion} />
      <RescheduleBanner />
      <RetroSection
        block={state.currentBlock}
        generating={retroGenerating}
        result={retroResult}
        error={retroError}
        onGenerate={generateRetro}
      />

      {!retroResult && <CurrentBlockSection block={state.currentBlock} onDelete={deleteBlock} scores={state.scores} compromisedDates={state.compromisedDates} partialDates={state.partialDates} completedDates={state.completedDates} sync={state.lastSync ?? null} />}

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
        focusLabel={focusLabel}
        goalCount={goalCount}
        onSaveToProfile={() => void saveGoalsAndWeakpointsToProfile()}
        profileSaveState={profileSaveState}
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

      <SeasonSection
        onSaved={() => {
          setSeasonVersion((v) => v + 1);
          void loadSeasonCtx();
        }}
      />

      {historyFailed ? (
        <LoadFailed what="block history" retry={() => void loadBlockHistory()} />
      ) : (
        <BlockHistory history={blockHistory} />
      )}
    </div>
  );
}
