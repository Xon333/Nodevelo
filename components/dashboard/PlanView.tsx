"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  // Bumped after a successful Season save so the roadmap strip and generator context re-fetch
  // instead of going stale until reload (UX v2 W1 review, Finding 1).
  const [seasonVersion, setSeasonVersion] = useState(0);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);

  const [writing, setWriting] = useState(false);
  const [writeResults, setWriteResults] = useState<WriteResult[] | null>(null);
  // HR-34: dedicated state instead of generateError — see PlanPreview's writeError prop comment.
  const [writeError, setWriteError] = useState<string | null>(null);
  // HR-48: a partial write's auto-rollback info — when set, some `writeResults` entries marked
  // `ok: true` were actually undone server-side (their events deleted/restored), so PlanPreview must
  // not render them as "✓ written".
  const [writeRollback, setWriteRollback] = useState<{ rolledBack: number; rollbackFailed: number[] } | null>(null);

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
  // UXA-19: this query key is deliberately identical to SeasonRoadmap's own — same page, same params —
  // so react-query dedupes the two into one network request instead of two independent fetches
  // (confirmed live as 3x redundant /api/season calls per Plan load).
  const today = localToday();
  const seasonQuery = useQuery({
    queryKey: ["season", today, seasonVersion],
    queryFn: () => api<{ plan: SeasonPlan; outlook: SeasonOutlookSlot[] | null }>(`/api/season?today=${today}`),
  });
  const seasonCtxFailed = seasonQuery.isError;

  // Pure derivations from the query result — recomputed every render, no state of their own (avoids
  // react-hooks/set-state-in-effect entirely for these). On failure the form falls back to today's
  // defaults — but the failure itself is shown above (S1-3), since a silently missing season context
  // changes what gets generated.
  let seasonReadout: string | null = null;
  let focusLabel: string | null = null;
  let goalCount = 0;
  let suggestedLengthWeeks: (2 | 4 | 6 | 8) | null = null;
  let goalPrefill: { text: string; shown: Array<{ goal: string; target: string; focus: string }> } | null = null;
  if (seasonQuery.data) {
    const { plan, outlook } = seasonQuery.data;
    // The block-length suggestion still comes from a real committed period when one exists (event
    // mode's persisted arc) — harmless and self-resolving if rolling mode briefly still has a
    // straddling settled period left over from before this redesign.
    const period = currentPeriod(plan, today);
    if (period) suggestedLengthWeeks = suggestedBlockWeeks(period, today);

    const next = outlook?.[0] ?? null;
    if (next) {
      // Rolling mode, SEASON_SHAPES_GENERATION on: the server already ran chooseNextFocus for this
      // exact "next block" decision — show it directly instead of re-deriving anything client-side.
      seasonReadout = `${FOCUS_LABELS[next.focus]} — ${next.rationale}`;
      focusLabel = FOCUS_LABELS[next.focus];
      if (rawGoals.length > 0) {
        const filtered = filterGoalsByFocus(rawGoals as Array<{ goal: string; target: string; focus: import("@/lib/types").SeasonFocus | "general" }>, next.focus);
        goalCount = filtered.length;
        goalPrefill = { text: filtered.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"), shown: filtered };
      }
    } else if (period) {
      // Event mode: the server never projects an outlook while a real committed arc exists — use the
      // period directly, exactly as before this redesign.
      seasonReadout = formatSeasonContext(plan, today);
      focusLabel = FOCUS_LABELS[period.focus];
      if (rawGoals.length > 0) {
        const filtered = filterGoalsByFocus(rawGoals as Array<{ goal: string; target: string; focus: import("@/lib/types").SeasonFocus | "general" }>, period.focus);
        goalCount = filtered.length;
        goalPrefill = { text: filtered.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"), shown: filtered };
      }
    } else if (rawGoals.length > 0) {
      // Nothing to target — no current period, no outlook (season disabled or a brand-new season).
      goalPrefill = { text: rawGoals.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"), shown: rawGoals };
    }
  }

  // lengthWeeks/goal/shownGoals are pre-filled from the season context above but stay independently
  // user-editable afterward (the length buttons, the goal textarea), so they can't be pure
  // derivations like the rest of this block. React's "adjusting state when props change" pattern —
  // direct setState during render, guarded by a snapshot of what's already been synced — applies the
  // prefill exactly once per new season/goals snapshot with no effect, matching this codebase's own
  // react-hooks/set-state-in-effect convention (see TodayView.tsx's armedForNote/flipRideDate).
  const [syncedFor, setSyncedFor] = useState<{ data: typeof seasonQuery.data; goals: typeof rawGoals } | null>(null);
  if (seasonQuery.data && (syncedFor === null || syncedFor.data !== seasonQuery.data || syncedFor.goals !== rawGoals)) {
    setSyncedFor({ data: seasonQuery.data, goals: rawGoals });
    if (suggestedLengthWeeks) setLengthWeeks(suggestedLengthWeeks);
    if (goalPrefill) {
      setGoal(goalPrefill.text);
      setShownGoals(goalPrefill.shown);
    }
  }

  // Elapsed counter ticks while a generation is in flight. The reset to 0 lives in generate()
  // (where the run starts) rather than in this effect, so no setState fires synchronously here.
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [generating]);

  // UXA-5: an already-generated, not-yet-written plan represents a real (1-2 min) LLM spend — warn
  // before a refresh/close silently discards it. beforeunload only covers browser-level navigation
  // (refresh, close tab, typing a new URL), not in-app Link clicks, which don't unload the page.
  useEffect(() => {
    if (!plan || writeResults) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [plan, writeResults]);

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
      setGenerateError(err instanceof Error ? err.message : "Couldn't generate — try again.");
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
      setProfileSaveState({ state: "error", message: err instanceof Error ? err.message : "Couldn't save — try again." });
    }
  };

  const write = async () => {
    if (!plan) return;
    setWriting(true);
    setWriteError(null);
    setWriteRollback(null);
    try {
      // UXA-24: tells the server what block (if any) this tab believes is active, so a stale tab
      // can't silently overwrite one another tab already replaced.
      const { results, currentBlock, rolledBack, rollbackFailed } = await api<{
        results: WriteResult[];
        currentBlock: CurrentBlock | null;
        // HR-48: present on a partial-write auto-rollback (RV-9) — some `results` entries marked
        // `ok: true` were actually undone server-side; PlanPreview needs this to render them accurately.
        rolledBack?: number;
        rollbackFailed?: number[];
      }>("/api/write", {
        method: "POST",
        // HR-32: today, alongside expectedBlockCreatedAt — the route's archive-truncation step needs
        // the athlete's real local date, not the server's UTC one.
        body: JSON.stringify({ plan, expectedBlockCreatedAt: state?.currentBlock?.createdAt ?? null, today: localToday() }),
      });
      setWriteResults(results);
      setWriteRollback(typeof rolledBack === "number" ? { rolledBack, rollbackFailed: rollbackFailed ?? [] } : null);
      if (currentBlock) {
        setState((s) => (s ? { ...s, currentBlock } : s));
        void loadBlockHistory();
      }
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "Couldn't write to Intervals.icu — try again.");
    } finally {
      setWriting(false);
    }
  };

  // S2-7: the confirm now happens in-product, inline in CurrentBlockSection (plan.tsx) before this
  // fires — window.confirm's generic browser dialog never stated that ridden history/scores survive.
  // Deliberately lets a failure throw instead of catching it here: CurrentBlockSection's own "Yes,
  // delete" click handler catches it and shows it locally, next to the confirm bar. Catching it here
  // and routing it through generateError was the actual bug — that state only ever renders inside
  // BlockGenerator's expanded form, which is collapsed by default whenever a block is active (i.e.
  // always, at the exact moment Delete is used) — a failed delete gave zero visible feedback.
  const deleteBlock = async () => {
    const expected = state?.currentBlock?.createdAt;
    const params = new URLSearchParams();
    if (expected) params.set("expectedBlockCreatedAt", expected);
    // HR-32: the route's archive-truncation step needs the athlete's real local date, not the
    // server's UTC one.
    params.set("today", localToday());
    await api(`/api/sync?${params}`, { method: "DELETE" });
    setState((s) => (s ? { ...s, currentBlock: null } : s));
    setPlan(null);
    setWriteResults(null);
  };

  const generateRetro = async () => {
    setRetroGenerating(true);
    setRetroError(null);
    try {
      // HR-32/HR-33: was a bare POST with no body — the route fell back to UTC "today" for its
      // archive truncation (could silently drop or skip archiving a day ridden this morning local
      // time but not yet "today" in UTC), and had no version guard at all, unlike write/delete.
      const result = await api<{ retrospective: string; seeds: string[]; complianceByType: Record<string, number> }>(
        "/api/retrospective",
        {
          method: "POST",
          body: JSON.stringify({ today: localToday(), expectedBlockCreatedAt: state?.currentBlock?.createdAt ?? null }),
        }
      );
      setRetroResult(result);
      // Block is now cleared server-side — update local state.
      setState((s) => (s ? { ...s, currentBlock: null } : s));
      void loadBlockHistory();
    } catch (err) {
      setRetroError(err instanceof Error ? err.message : "Couldn't generate the retrospective — try again.");
    } finally {
      setRetroGenerating(false);
    }
  };

  const hasActiveBlock = state.currentBlock !== null && state.currentBlock.endDate >= localToday();

  return (
    <div className="space-y-3">
      <h1 className="sr-only">Plan</h1>
      <SeasonRoadmap
        plan={seasonQuery.data?.plan ?? null}
        outlook={seasonQuery.data?.outlook ?? null}
        failed={seasonCtxFailed}
        onRetry={() => void seasonQuery.refetch()}
      />
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
      {seasonCtxFailed && <LoadFailed what="the season context for the generator" retry={() => void seasonQuery.refetch()} />}

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
        intervalsConfigured={state.configured}
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
          writeError={writeError}
          rollback={writeRollback}
          intervalsConfigured={state.configured}
          hasActiveBlock={hasActiveBlock}
          onWrite={write}
          onDismiss={() => {
            setPlan(null);
            setWriteResults(null);
            setWriteError(null);
            setWriteRollback(null);
          }}
        />
      )}

      <SeasonSection
        onSaved={() => setSeasonVersion((v) => v + 1)}
      />

      {historyFailed ? (
        <LoadFailed what="block history" retry={() => void loadBlockHistory()} />
      ) : (
        <BlockHistory history={blockHistory} />
      )}
    </div>
  );
}
