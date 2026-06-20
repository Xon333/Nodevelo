"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, isStale, nextMonday } from "@/lib/client-api";
import AskCoach from "./AskCoach";
import AthleteStateCard from "./AthleteStateCard";
import RescheduleBanner from "./RescheduleBanner";
import type { AthleteMdSnapshot } from "@/lib/kb-loader";
import type {
  BlockHistoryEntry,
  CurrentBlock,
  GeneratedPlan,
  WriteResult,
} from "@/lib/types";
import { localToday } from "@/lib/date";
import PlanPreview from "./PlanPreview";
import TrendPulse from "./TrendPulse";
import { useSync } from "./SyncProvider";
import { Zone } from "./ui";
import { PlannedToday, ReadinessBadge, RecentDataSummary, TodayRideCard } from "./dashboard/today";
import {
  BlockHistory,
  CurrentBlockSection,
  GoalsProgress,
  RetroSection,
  WeeklyDebrief,
} from "./dashboard/plan";

// Local calendar date — matches what SyncProvider sends as "today", so the client's
// "is this today's analysis?" check agrees with the server-stored activityDate.
const todayIso = localToday;

// ---------- Dashboard ----------

export default function Dashboard({ mode = "plan" }: { mode?: "today" | "plan" }) {
  // Sync state is shared via SyncProvider so the nav-rail sync control and the page
  // views stay in lock-step. Page-specific state (below) stays local.
  const { state, setState, loadError, analyzing, doSync, reAnalyse } = useSync();

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

  const [notePosting, setNotePosting] = useState(false);
  const [notePosted, setNotePosted] = useState(false);

  // When a block is already active the generator collapses to a thin bar so it stops
  // cutting the Plan page in half; it expands on demand (and is always open with no block).
  const [genOpen, setGenOpen] = useState(false);

  const autoSyncDone = useRef(false);

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
    if (mode !== "plan") return;
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
  }, [mode, loadBlockHistory]);

  // Auto-sync once on Today when the cached data is stale.
  useEffect(() => {
    if (mode !== "today" || !state || autoSyncDone.current) return;
    if (state.autoSyncOnOpen && state.configured && isStale(state.lastSync?.syncedAt ?? null)) {
      autoSyncDone.current = true;
      void doSync();
    }
  }, [mode, state, doSync]);

  // Elapsed counter ticks while a generation is in flight. The reset to 0 lives in generate()
  // (where the run starts) rather than in this effect, so no setState fires synchronously here.
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [generating]);

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

  const postNote = async () => {
    if (!state?.todayAnalysis) return;
    setNotePosting(true);
    try {
      await api("/api/note", {
        method: "POST",
        body: JSON.stringify({
          date: state.todayAnalysis.activityDate,
          activityName: state.todayAnalysis.activityName,
          coachNote: state.todayAnalysis.coachNote,
          executionScore: state.todayAnalysis.executionScore,
        }),
      });
      setNotePosted(true);
    } catch {
      // best-effort — don't show error for note post failure
    } finally {
      setNotePosting(false);
    }
  };

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        Failed to load app state: {loadError}
      </div>
    );
  }
  if (!state) {
    return <p className="py-12 text-center text-sm text-zinc-400">Loading…</p>;
  }

  const hasActiveBlock =
    state.currentBlock !== null && state.currentBlock.endDate >= todayIso();

  return (
    <div className={mode === "today" ? "flex flex-col gap-3 lg:h-[calc(100dvh-4rem)] lg:overflow-hidden" : "space-y-3"}>
      {mode === "today" && (
        <>
          <Zone rank={1} title="Readiness — can I go hard?">
            {/* §5 signal-fusion glance — the second brain's overall read, above the individual signals. */}
            {state.athleteState && (
              <div className="mb-2">
                <AthleteStateCard state={state.athleteState} />
              </div>
            )}
            {state.readiness || state.fatigueAlert?.triggered || state.loadRamp?.triggered ? (
              <ReadinessBadge
                readiness={state.readiness}
                fatigueAlert={state.fatigueAlert}
                loadRamp={state.loadRamp}
              />
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Sync to compute today&apos;s readiness.</p>
            )}
            {state.lastSync && (
              <div className="mt-2">
                <RecentDataSummary
                  sync={state.lastSync}
                  acwr={state.acwr}
                  polarization={state.polarization}
                  bare
                />
              </div>
            )}
          </Zone>

          {/* Session & fuel is the wide focus; trend pulse + coach note fill the column
              beside it. On desktop the page is locked to the viewport — the session card's
              body and the right column scroll internally so all borders stay visible. */}
          <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[1.7fr_1fr] lg:[grid-template-rows:minmax(0,1fr)]">
            {/* Session card fills its grid cell and scrolls internally so the bottom
                border lands at the page bottom instead of being clipped. */}
            <Zone rank={2} title="Today — session & fuel" hero fill>
              {state.todayAnalysis && state.todayAnalysis.activityDate === todayIso() ? (
                <TodayRideCard
                  analysis={state.todayAnalysis}
                  onPostNote={state.configured ? postNote : undefined}
                  notePosting={notePosting}
                  notePosted={notePosted}
                  bare
                  hideCoachNote
                />
              ) : (
                <PlannedToday block={state.currentBlock} />
              )}
            </Zone>

            {/* Trend pulse fixed; coach note fills the rest of the column and scrolls,
                so its bottom border lands at the page bottom (never clipped). */}
            <div className="flex flex-col gap-3 lg:min-h-0">
              <Zone rank={3} title="Trend pulse — am I improving?" hint="opens Trends">
                <TrendPulse vertical />
                {/* Coach-accuracy: validation-loop self-assessment. Hidden until the 28-day horizon
                    yields a decisive outcome or there are interventions still accruing. */}
                {state.coachAccuracy &&
                  (state.coachAccuracy.hitRatePct !== null || state.coachAccuracy.pending > 0) && (
                    <div
                      title="How often acting on the coach's matured directives proved right (28-day validation horizon)."
                      className="mt-2 flex items-baseline justify-between border-t border-zinc-100 pt-2 dark:border-zinc-700/60"
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        Coach accuracy
                      </span>
                      {state.coachAccuracy.hitRatePct !== null ? (
                        <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                          {state.coachAccuracy.hitRatePct}%{" "}
                          <span className="text-zinc-400 dark:text-zinc-500">
                            ({state.coachAccuracy.evaluated} checked)
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">
                          accruing · {state.coachAccuracy.pending} pending
                        </span>
                      )}
                    </div>
                  )}
              </Zone>
              {state.todayAnalysis?.activityDate === todayIso() && state.todayAnalysis.coachNote ? (
                <Zone title="Coach note" hero accent="pink" fill>
                  <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-300">{state.todayAnalysis.coachNote}</p>
                  {state.anthropicConfigured && (
                    <button
                      onClick={reAnalyse}
                      disabled={analyzing}
                      title="Regenerate today's coach note"
                      className="mt-2 rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
                    >
                      {analyzing ? "Re-analysing…" : "↻ Re-analyse"}
                    </button>
                  )}
                </Zone>
              ) : state.todayAnalysis?.activityDate === todayIso() && analyzing ? (
                <Zone title="Coach note" hero accent="pink" fill>
                  <p className="text-xs italic leading-5 text-zinc-400 dark:text-zinc-500">Analysing today&apos;s ride…</p>
                </Zone>
              ) : state.todayAnalysis?.activityDate === todayIso() && state.anthropicConfigured ? (
                // Ride synced but the note is missing (e.g. the auto-run hit an Anthropic hiccup) —
                // offer a manual retry instead of waiting for the next full sync.
                <Zone title="Coach note" hero accent="pink" fill>
                  <p className="text-xs leading-5 text-zinc-400 dark:text-zinc-500">No coach note yet.</p>
                  <button
                    onClick={reAnalyse}
                    className="mt-2 rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
                  >
                    ↻ Generate coach note
                  </button>
                </Zone>
              ) : null}
              {state.anthropicConfigured && <AskCoach />}
            </div>
          </div>
        </>
      )}

      {mode === "plan" && (
        <>
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
      <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-700 dark:bg-zinc-800">
        {hasActiveBlock && !genOpen ? (
          <button
            onClick={() => setGenOpen(true)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Generate next block</span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">Plan the next 2–4 weeks →</span>
          </button>
        ) : (
          <>
            {hasActiveBlock && (
              <div className="mb-3 flex justify-end">
                <button
                  onClick={() => setGenOpen(false)}
                  className="text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  Collapse
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={generate}
            disabled={generating || !state.anthropicConfigured}
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:border dark:border-[#ff49c8]/50 dark:bg-transparent dark:text-[#ff49c8] dark:hover:bg-[#ff49c8]/10 dark:disabled:border-zinc-600 dark:disabled:text-zinc-500 dark:disabled:bg-transparent"
          >
            {generating
              ? `Generating… ${elapsed}s`
              : hasActiveBlock
                ? "Generate Next Block"
                : "Generate New Block"}
          </button>
          {!state.anthropicConfigured && (
            <p className="text-xs text-red-600">
              ANTHROPIC_API_KEY is not set — generation is unavailable.
            </p>
          )}
          {!state.lastSync && state.configured && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Tip: sync first so the plan reflects your recent training.
            </p>
          )}
        </div>
        {generateError && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
            {generateError}
          </p>
        )}

        <div className="mt-4 grid gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-zinc-700">
          <div>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Block length</label>
            <div className="mt-1.5 flex gap-2">
              {([2, 4] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => setLengthWeeks(w)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                    lengthWeeks === w
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-[#ff49c8]/60 dark:bg-[#ff49c8]/10 dark:text-[#ff49c8]"
                      : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-500"
                  }`}
                >
                  {w} weeks
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="start-date" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Start date
            </label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:focus:border-zinc-400"
            />
          </div>
          <div>
            <label htmlFor="goal" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Block goal (one per line)
            </label>
            <textarea
              id="goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              placeholder="from profile; edit to override"
              className="mt-1.5 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:placeholder-zinc-500 dark:focus:border-zinc-400"
            />
          </div>
          <div>
            <label htmlFor="weakpoints" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Weakpoints to target (one per line)
            </label>
            <textarea
              id="weakpoints"
              value={weakpointsText}
              onChange={(e) => setWeakpointsText(e.target.value)}
              rows={2}
              placeholder="from profile; edit to override"
              className="mt-1.5 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:placeholder-zinc-500 dark:focus:border-zinc-400"
            />
          </div>
            </div>
          </>
        )}
      </section>

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
        </>
      )}
    </div>
  );
}
