"use client";

import { useEffect, useRef, useState } from "react";
import { api, isStale } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { useSync } from "../SyncProvider";
import { Zone } from "../ui";
import AskCoach from "../AskCoach";
import AthleteStateCard from "../AthleteStateCard";
import CoachSnapshotCard from "../CoachSnapshotCard";
import MorningCheckIn from "../MorningCheckIn";
import TrendPulse from "../TrendPulse";
import { PlannedToday, ReadinessBadge, RecentDataSummary, TodayRideCard } from "./today";

// The /today page body. Split out of the old dual-mode Dashboard (RV-8): it owns only the today-only
// state (the coach-note post + the auto-sync-once latch) and reads the rest from SyncProvider, so the
// Plan page's generator state no longer lives in the same component.
export default function TodayView() {
  const { state, analyzing, doSync, reAnalyse } = useSync();

  const [notePosting, setNotePosting] = useState(false);
  const [notePosted, setNotePosted] = useState(false);
  const autoSyncDone = useRef(false);

  // Auto-sync once on Today when the cached data is stale.
  useEffect(() => {
    if (!state || autoSyncDone.current) return;
    if (state.autoSyncOnOpen && state.configured && isStale(state.lastSync?.syncedAt ?? null)) {
      autoSyncDone.current = true;
      void doSync();
    }
  }, [state, doSync]);

  if (!state) return null; // Dashboard already guards loadError / loading; this narrows the type.

  const postNote = async () => {
    if (!state.todayAnalysis) return;
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

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-4rem)] lg:overflow-hidden">
      <Zone rank={1} title="Readiness — can I go hard?">
        {/* Proactive "not feeling it?" check-in (ROADMAP #3) — prominent before a quality session. */}
        <MorningCheckIn />
        {/* §5 signal-fusion glance — the second brain's overall read, above the individual signals. */}
        {state.athleteState && (
          <div className="mb-2">
            <AthleteStateCard state={state.athleteState} />
          </div>
        )}
        {/* ROADMAP #1: the coach's resolved-numbers read (TSB-as-actionable-modifier + fuel) — the
            same snapshot the LLM is handed, so the athlete sees what it sees. */}
        {state.coachSnapshot && (
          <div className="mb-2">
            <CoachSnapshotCard snapshot={state.coachSnapshot} />
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
          {state.todayAnalysis && state.todayAnalysis.activityDate === localToday() ? (
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

        {/* Trend pulse + coach note stack in this column; the column itself scrolls when the
            two together exceed the locked viewport height. (Previously the coach note used `fill`
            — flex-1 + internal scroll — which collapsed to 0px height whenever Trend pulse consumed
            the column, hiding the note entirely. Column-level scroll keeps the note reachable.) */}
        <div className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">
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
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Coach accuracy
                  </span>
                  {state.coachAccuracy.hitRatePct !== null ? (
                    <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                      {state.coachAccuracy.hitRatePct}%{" "}
                      <span className="text-zinc-500 dark:text-zinc-400">
                        ({state.coachAccuracy.evaluated} checked)
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      accruing · {state.coachAccuracy.pending} pending
                    </span>
                  )}
                </div>
              )}
          </Zone>
          {state.todayAnalysis?.activityDate === localToday() && state.todayAnalysis.coachNote ? (
            <Zone title="Coach note" hero accent="pink">
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
          ) : state.todayAnalysis?.activityDate === localToday() && analyzing ? (
            <Zone title="Coach note" hero accent="pink" fill>
              <p className="text-xs italic leading-5 text-zinc-500 dark:text-zinc-400">Analysing today&apos;s ride…</p>
            </Zone>
          ) : state.todayAnalysis?.activityDate === localToday() && state.anthropicConfigured ? (
            // Ride synced but the note is missing (e.g. the auto-run hit an Anthropic hiccup) —
            // offer a manual retry instead of waiting for the next full sync.
            <Zone title="Coach note" hero accent="pink" fill>
              <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">No coach note yet.</p>
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
    </div>
  );
}
