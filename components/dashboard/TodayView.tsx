"use client";

import { useEffect, useRef, useState } from "react";
import { api, isStale } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { useSync } from "../SyncProvider";
import { Zone } from "../ui";
import AskCoach from "../AskCoach";
import AthleteStateCard from "../AthleteStateCard";
import MorningCheckIn from "../MorningCheckIn";
import TrendPulse from "../TrendPulse";
import { EnergyAvailabilityTile, PlannedToday, ReadinessAlerts, RecentDataSummary, TodayRideCard } from "./today";

// The /today page body. Split out of the old dual-mode Dashboard (RV-8): it owns only the today-only
// state (the coach-note post + the auto-sync-once latch) and reads the rest from SyncProvider, so the
// Plan page's generator state no longer lives in the same component.
export default function TodayView() {
  const { state, analyzing, doSync, reAnalyse } = useSync();

  const [notePosting, setNotePosting] = useState(false);
  const [notePosted, setNotePosted] = useState(false);
  const [notePostFailed, setNotePostFailed] = useState(false);
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
    setNotePostFailed(false);
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
      setNotePostFailed(true); // S1-3: a button that quietly returns to rest on failure is a lie
    } finally {
      setNotePosting(false);
    }
  };

  // FTP + resolved fuel numbers from the coach snapshot — evidence-tier context under the tiles
  // (the old CoachSnapshotCard's non-form content; its form line now lives in the verdict card).
  const snap = state.coachSnapshot;
  const coachContext = snap
    ? [
        snap.ftp !== null ? `FTP ${snap.ftp}W` : null,
        snap.fuel.todayTargetKcal !== null ? `${snap.fuel.todayTargetKcal} kcal target` : null,
        snap.fuel.rideBurnKj !== null ? `${snap.fuel.rideBurnKj} kJ ride` : null,
        snap.fuel.weightTrend7dKg !== null
          ? `${snap.fuel.weightTrend7dKg > 0 ? "+" : ""}${snap.fuel.weightTrend7dKg} kg/7d`
          : null,
      ]
        .filter((b): b is string => b !== null)
        .join(" · ")
    : "";

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-4rem)] lg:overflow-hidden">
      {/* Zone 1 hierarchy (S1-1, Constitution §4): alarms → manual override door → ONE verdict →
          collapsed evidence. One vocabulary owns the verdict (the athlete-state register); the old
          Build/Hold/Recover badge and the separate coach's-read card were same-altitude rivals and
          are merged into the verdict card's supporting layer. */}
      <Zone rank={1} title="Readiness — can I go hard?">
        {/* Triggered fatigue/load-ramp alarms outrank everything, aviation-style. */}
        <ReadinessAlerts fatigueAlert={state.fatigueAlert} loadRamp={state.loadRamp} />
        {/* Proactive "not feeling it?" check-in (ROADMAP #3) — the self-report door sits above the
            data verdict so the athlete reports how they feel before anchoring on a green score. */}
        <MorningCheckIn />
        {/* THE verdict: the §5 signal-fusion read (it already is the reconciliation of the signals
            below). The coach's TSB-as-modifier read (ROADMAP #1) folds in as its supporting line —
            the same snapshot the LLM is handed, so the athlete sees what it sees. */}
        {state.athleteState ? (
          <AthleteStateCard
            state={state.athleteState}
            form={
              state.coachSnapshot?.form.tsbModifier
                ? { tsb: state.coachSnapshot.form.tsb, ...state.coachSnapshot.form.tsbModifier }
                : null
            }
            ftpRetest={state.coachSnapshot?.ftpRetest ?? null}
          />
        ) : (
          // Degraded read: no fused state yet (thin/no data). The readiness reason is already a plain
          // sentence — shown without the retired Build/Hold/Recover badge register.
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {state.readiness?.reason ?? "Sync to compute today's readiness."}
          </p>
        )}
        {/* Evidence tier: the raw signals behind the verdict, collapsed by default — reachable in one
            click/keypress, not shouting (hidden ≠ deleted, Constitution §6). */}
        {state.lastSync && (
          <details className="mt-2">
            <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Supporting signals
            </summary>
            <div className="mt-2">
              <RecentDataSummary
                sync={state.lastSync}
                acwr={state.acwr}
                polarization={state.polarization}
                bare
              />
              {/* Energy-availability proxy — am I chronically under-fuelling? A recovery input, so it
                  sits with the load signals. */}
              <EnergyAvailabilityTile sync={state.lastSync} />
              {/* The coach snapshot's remaining context numbers (FTP + resolved fuel), kept reachable
                  after the card merge. The EA band is omitted — the tile above already shows it. */}
              {coachContext && (
                <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{coachContext}</p>
              )}
            </div>
          </details>
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
              notePostFailed={notePostFailed}
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
          {/* One stable coach-note shell across the analysing → loaded transition (FB-2026-06-30). The
              frame used to remount/resize between branches (analysing/empty used `fill`, the loaded note
              didn't), so the pink cyber-brackets snapped inward when the note landed mid-sync. Now a single
              Zone (no `fill`, content-height) renders whenever there's a synced ride; only its inner content
              swaps, so the frame grows with the text instead of glitching. */}
          {state.todayAnalysis?.activityDate === localToday() &&
          (state.todayAnalysis.coachNote || analyzing || state.anthropicConfigured) ? (
            <Zone title="Coach note" hero accent="pink">
              {state.todayAnalysis.coachNote ? (
                <>
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
                </>
              ) : analyzing ? (
                <p className="text-xs italic leading-5 text-zinc-500 dark:text-zinc-400">Analysing today&apos;s ride…</p>
              ) : (
                // Ride synced but the note is missing (e.g. the auto-run hit an Anthropic hiccup) —
                // offer a manual retry instead of waiting for the next full sync.
                <>
                  <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">No coach note yet.</p>
                  <button
                    onClick={reAnalyse}
                    className="mt-2 rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
                  >
                    ↻ Generate coach note
                  </button>
                </>
              )}
            </Zone>
          ) : null}
          {state.anthropicConfigured && <AskCoach />}
        </div>
      </div>
    </div>
  );
}
