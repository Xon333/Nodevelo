"use client";

import { useEffect, useRef, useState } from "react";
import { api, isStale } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { describeFreshnessForAthlete } from "@/lib/physiology-freshness";
import { useSync } from "../SyncProvider";
import { Zone } from "../ui";
import AskCoach from "../AskCoach";
import AthleteStateCard from "../AthleteStateCard";
import LoadingPrompt from "../LoadingPrompt";
import MorningCheckIn from "../MorningCheckIn";
import { EatToday, EnergyAvailabilityTile, NutritionTrendWarningBanner, PlanEaWarningBanner, PlannedToday, ReadinessAlerts, RecentDataSummary, TodayRideCard } from "./today";

// The /today page body — one page, two moments (UX v2 §4). A synced ride on today's LOCAL date
// switches the layout from the pre-ride glance (M1: can I go hard — what's the session?) to the
// post-ride debrief (M2: how did it go — what do I eat?). The mode is data-derived, never a
// question the athlete answers (Constitution §3); `flipped` is the quiet manual escape for the
// odd case (evening plan-check after a morning ride) — client-only, auto mode re-asserts on the
// next load. Both layouts scroll naturally: the viewport lock retired with the split (pre-ride
// fits one screen by construction; the debrief scrolls like every other page).
export default function TodayView() {
  const { state, analyzing, doSync, reAnalyse } = useSync();

  const [notePosting, setNotePosting] = useState(false);
  const [notePosted, setNotePosted] = useState(false);
  const [notePostFailed, setNotePostFailed] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const autoSyncDone = useRef(false);

  // Auto-sync once on Today when the cached data is stale.
  useEffect(() => {
    if (!state || autoSyncDone.current) return;
    if (state.autoSyncOnOpen && state.configured && isStale(state.lastSync?.syncedAt ?? null)) {
      autoSyncDone.current = true;
      void doSync();
    }
  }, [state, doSync]);

  // Render-phase adjustments (React's "adjusting state when props change" pattern — doing this in
  // an effect sets state synchronously and cascades a re-render; react-hooks/set-state-in-effect):
  // 1) A fresh coach note (re-analyse, new sync) re-arms the post button — the ✓ Posted latch
  //    belongs to the note it posted, not the page.
  const currentNote = state?.todayAnalysis?.coachNote ?? null;
  const [armedForNote, setArmedForNote] = useState(currentNote);
  if (currentNote !== armedForNote) {
    setArmedForNote(currentNote);
    setNotePosted(false);
    setNotePostFailed(false);
  }
  // 2) The manual flip is scoped to one ride's day — a new ride identity re-asserts auto mode.
  const currentRideDate = state?.todayAnalysis?.activityDate ?? null;
  const [flipRideDate, setFlipRideDate] = useState(currentRideDate);
  if (currentRideDate !== flipRideDate) {
    setFlipRideDate(currentRideDate);
    setFlipped(false);
  }

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

  // FTP + resolved fuel numbers from the coach snapshot — evidence-tier context inside the
  // supporting-signals disclosure (the old CoachSnapshotCard's non-form content).
  const snap = state.coachSnapshot;
  const today = localToday();
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

  // Mode detection (approved: auto-switch, no tabs — masterplan §4).
  const todayRide = state.todayAnalysis?.activityDate === today ? state.todayAnalysis : null;
  const mode: "pre" | "post" = todayRide && !flipped ? "post" : "pre";
  const freshness = state.physiologyFreshness ? describeFreshnessForAthlete(state.physiologyFreshness) : null;
  const freshnessText =
    state.physiologyFreshness?.state === "fresh" &&
    localToday(new Date(state.physiologyFreshness.confirmedAt)) === today
      ? "Physiology confirmed today — current."
      : freshness?.text ?? null;
  const freshnessClasses =
    freshness?.tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
      : freshness?.tone === "block"
      ? "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300"
      : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";

  // Collapsed evidence shared by both moments (hidden ≠ deleted, Constitution §6).
  const supportingSignals = state.lastSync ? (
    <details>
      <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Supporting signals
      </summary>
      <div className="mt-2">
        <RecentDataSummary sync={state.lastSync} acwr={state.acwr} polarization={state.polarization} bare />
        {/* Energy-availability proxy — am I chronically under-fuelling? A recovery input, so it
            sits with the load signals. */}
        <EnergyAvailabilityTile
          sync={state.lastSync}
          nutritionModel={state.nutritionModel}
          nutritionModelsByDayType={state.nutritionModelsByDayType}
          neatImbalance={state.neatImbalance}
        />
        {coachContext && <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{coachContext}</p>}
      </div>
    </details>
  ) : null;

  const askCoach = state.anthropicConfigured ? (
    <details>
      <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Ask coach
      </summary>
      <div className="mt-2">
        <AskCoach bare />
      </div>
    </details>
  ) : null;

  return (
    <div className="flex flex-col gap-3">
      <h1 className="sr-only">Today</h1>
      {/* Triggered alarms outrank both moments (aviation rule, Constitution §4). */}
      <ReadinessAlerts fatigueAlert={state.fatigueAlert} loadRamp={state.loadRamp} />

      {freshness && freshnessText && (
        <p className={`rounded-lg border px-3 py-2 text-xs ${freshnessClasses}`}>{freshnessText}</p>
      )}

      {/* Track C loading chip: day-before target / day-of loaded-or-skipped attribution. Its
          pre-ask fires the evening BEFORE a durability ride — when Today is typically already in
          post-ride mode — so it can't live inside the pre-ride branch only; it self-hides when
          there is nothing to ask. Mounted once, above the mode branch, so it renders in both. */}
      <LoadingPrompt />

      <NutritionTrendWarningBanner warning={state.nutritionTrendWarning ?? null} />
      <PlanEaWarningBanner level={state.planEaLevel ?? null} kcalPerKg={state.planEaKcalPerKg ?? null} />

      {/* The quiet corner flip (planned ↔ debrief) — exists only once today's ride is in. */}
      {todayRide && (
        <div className="-mb-2 flex justify-end">
          <button
            onClick={() => setFlipped((v) => !v)}
            className="text-[10px] font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-[#00d4ff]"
          >
            {mode === "post" ? "view planned session →" : "← back to debrief"}
          </button>
        </div>
      )}

      {mode === "post" && todayRide ? (
        <>
          {/* M2: the go/no-go decision is made — the verdict compresses to one strip. */}
          {state.athleteState && (
            <AthleteStateCard compact state={state.athleteState} ftpRetest={state.coachSnapshot?.ftpRetest ?? null} />
          )}
          <Zone rank={1} title="Debrief — how did it go?" hero accent="pink">
            <TodayRideCard
              analysis={todayRide}
              outcome={state.todayOutcome}
              onPostNote={state.configured ? postNote : undefined}
              notePosting={notePosting}
              notePosted={notePosted}
              notePostFailed={notePostFailed}
              analyzing={analyzing}
              onReAnalyse={state.anthropicConfigured ? reAnalyse : undefined}
            />
          </Zone>
          {/* The decision that still remains post-ride (M2). */}
          <EatToday analysis={todayRide} />
          <div className="flex flex-col gap-2">
            {supportingSignals}
            {askCoach}
          </div>
        </>
      ) : (
        <>
          <Zone rank={1} title="Readiness — can I go hard?">
            {/* THE verdict: the §5 signal-fusion read; the coach's TSB-as-modifier read folds in
                as its supporting line — the same snapshot the LLM is handed. */}
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
              // Degraded read: no fused state yet (thin/no data). S1-4: when Intervals.icu is
              // connected, the remedy is one click — a real action, not a dead end. When it isn't
              // connected yet, name that and the one fix instead (UXA-2) — this was previously a
              // silent dead end with no message and no action.
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {state.configured
                    ? (state.readiness?.reason ?? "Sync to compute today's readiness.")
                    : "Intervals.icu isn't connected yet, so there's nothing to read your readiness from."}
                </p>
                {state.configured ? (
                  <button
                    onClick={() => void doSync()}
                    className="mt-1 text-sm text-cyan-700 hover:underline dark:text-[#00d4ff]"
                  >
                    Sync now →
                  </button>
                ) : (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Add your Intervals.icu key to NodeVelo&apos;s local config and restart it to connect.
                  </p>
                )}
              </div>
            )}
          </Zone>

          {/* M1's main event, promoted: what am I about to ride. The morning check-in renders
              inline here when relevant (S2-9 rules unchanged — it self-hides once today's ride
              is logged and on true rest days). */}
          <Zone rank={2} title="Today's session — what am I riding?" hero>
            <MorningCheckIn />
            <PlannedToday block={state.currentBlock} noBlockSummary={state.noBlockSummary} />
          </Zone>

          {/* Quiet footer: everything else is one disclosure away (masterplan §4). */}
          <div className="flex flex-col gap-2">
            {supportingSignals}
            {!todayRide && state.todayAnalysis && (
              <details>
                <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Last debrief · {state.todayAnalysis.activityDate}
                </summary>
                <div className="mt-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
                  {/* No re-analyse / note-post actions on a past ride's debrief — disposition stays interactive. */}
                  <TodayRideCard analysis={state.todayAnalysis} outcome={state.todayOutcome} />
                </div>
              </details>
            )}
            {askCoach}
          </div>
        </>
      )}
    </div>
  );
}
