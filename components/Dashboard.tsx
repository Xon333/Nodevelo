"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, isStale, nextMonday } from "@/lib/client-api";
import type { AthleteMdSnapshot } from "@/lib/kb-loader";
import type {
  BlockHistoryEntry,
  CurrentBlock,
  GeneratedPlan,
  SyncData,
  TodayAnalysis,
  WriteResult,
} from "@/lib/types";
import { TYPE_STYLES } from "@/lib/workout-types";
import PlanPreview from "./PlanPreview";
import SyncStatus from "./SyncStatus";

interface AppState {
  configured: boolean;
  anthropicConfigured: boolean;
  lastSync: SyncData | null;
  currentBlock: CurrentBlock | null;
  todayAnalysis: TodayAnalysis | null;
}

function todayIso(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}

// ---------- Today's ride analysis ----------

function TodayRideCard({ analysis }: { analysis: TodayAnalysis }) {
  const style = analysis.plannedType
    ? TYPE_STYLES[analysis.plannedType as keyof typeof TYPE_STYLES] ?? TYPE_STYLES.Z2
    : TYPE_STYLES.Z2;

  const fmt = (n: number | null, unit: string) =>
    n !== null ? `${n} ${unit}` : null;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Today's ride</h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{analysis.activityDate}</span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {/* Planned */}
        <div className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Planned</p>
          {analysis.plannedName ? (
            <>
              <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">{analysis.plannedName}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {analysis.plannedType && (
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style.badge}`}>
                    {analysis.plannedType}
                  </span>
                )}
                {analysis.plannedDurationMin !== null && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{analysis.plannedDurationMin} min</span>
                )}
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-zinc-400">No session planned</p>
          )}
        </div>

        {/* Actual */}
        <div className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Actual</p>
          <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">{analysis.activityName}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {[
              fmt(analysis.activityDurationMin, "min"),
              fmt(analysis.activityAvgWatts, "W avg"),
              fmt(analysis.activityAvgHr, "bpm avg"),
              fmt(analysis.activityKj, "kJ"),
              analysis.activityRpe !== null ? `RPE ${analysis.activityRpe}/10` : null,
            ]
              .filter(Boolean)
              .map((v) => (
                <span key={v} className="text-xs text-zinc-500 dark:text-zinc-400">
                  {v}
                </span>
              ))}
          </div>
        </div>
      </div>

      {/* Claude analysis */}
      <div className="mt-3 rounded-md border-l-2 border-zinc-300 bg-zinc-50 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900">
        <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Coach analysis</p>
        <p className="mt-1 text-sm leading-6 text-zinc-700 dark:text-zinc-300">{analysis.analysis}</p>
      </div>
      <p className="mt-2 text-[11px] text-zinc-400">
        Analysed at {new Date(analysis.analysedAt).toLocaleTimeString()} · re-sync to refresh
      </p>
    </section>
  );
}

// ---------- Progress toward goals ----------

interface ProfileGoals {
  athleteMd: AthleteMdSnapshot;
  lastSync: SyncData | null;
}

function GoalsProgress({ athleteMd, lastSync }: ProfileGoals) {
  if (!athleteMd.goals.length) return null;

  const powerGoals = athleteMd.performanceData;
  const ftp = lastSync ? null : null; // FTP comes from athlete profile, not sync

  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-700 dark:bg-zinc-800">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Goals</h2>
      <div className="mt-3 flex flex-col gap-2">
        {athleteMd.goals.map((g) => (
          <div key={g.goal} className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-zinc-700 dark:text-zinc-300">{g.goal}</span>
            {g.target && (
              <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                → {g.target}
              </span>
            )}
          </div>
        ))}
      </div>
      {powerGoals && Object.keys(powerGoals).length > 0 && (
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Current performance</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(powerGoals).map(([k, v]) => (
              <div key={k} className="rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900">
                <p className="text-[11px] text-zinc-400">{k}</p>
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{v}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- Block history ----------

function BlockHistory({ history }: { history: BlockHistoryEntry[] }) {
  if (!history.length) return null;
  return (
    <details className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-700 select-none dark:text-zinc-300">
        Block history ({history.length})
      </summary>
      <div className="mt-3 space-y-2">
        {history.map((entry) => (
          <div
            key={entry.id}
            className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 line-clamp-1">
                {entry.goal}
              </p>
              <span className="shrink-0 text-xs text-zinc-400">
                {entry.startDate} → {entry.endDate}
              </span>
            </div>
            {entry.overview && (
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400 line-clamp-2">
                {entry.overview}
              </p>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

// ---------- Current block card ----------

function BlockCalendar({ block }: { block: CurrentBlock }) {
  const today = todayIso();
  const weeks: CurrentBlock["days"][] = [];
  const sorted = [...block.days].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < sorted.length; i += 7) weeks.push(sorted.slice(i, i + 7));

  const weeklyMinutes = weeks.map((week) =>
    week.reduce((s, d) => s + d.durationMin, 0)
  );

  return (
    <div className="mt-3 space-y-1.5">
      {weeks.map((week, i) => {
        const mins = weeklyMinutes[i];
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const label = m === 0 ? `${h}h` : `${h}h ${m}m`;
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-right text-[10px] font-medium text-zinc-400">{label}</span>
            <div className="flex flex-1 gap-1.5">
              {week.map((day) => (
                <div
                  key={day.date}
                  title={`${day.date} — ${day.name}${day.durationMin ? ` (${day.durationMin} min)` : ""}`}
                  className={`flex h-9 flex-1 items-center justify-center rounded text-[10px] font-medium ${TYPE_STYLES[day.type].cell} ${
                    day.type === "Rest" ? "text-zinc-600" : "text-white"
                  } ${day.date === today ? "ring-2 ring-zinc-900 ring-offset-1 dark:ring-zinc-100" : ""} ${
                    day.date < today ? "opacity-40" : ""
                  }`}
                >
                  {day.date.slice(8)}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-3 pt-1 pl-12">
        {(["Z2", "Recovery", "Threshold", "VO2max", "SIT", "Strength", "Rest"] as const).map(
          (t) => (
            <span key={t} className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className={`h-2 w-2 rounded-sm ${TYPE_STYLES[t].cell}`} /> {t}
            </span>
          )
        )}
      </div>
    </div>
  );
}

function CurrentBlockSection({
  block,
  onDelete,
}: {
  block: CurrentBlock | null;
  onDelete?: () => void;
}) {
  if (!block) {
    return (
      <section className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-6 text-center dark:border-zinc-600 dark:bg-zinc-800">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No active training block. Generate one below to get started.
        </p>
      </section>
    );
  }
  const today = todayIso();
  const daysRemaining = Math.max(
    0,
    Math.ceil((Date.parse(block.endDate) - Date.parse(today)) / 86_400_000)
  );
  const upcoming = block.days.filter((d) => d.date >= today).length;
  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Current block: {block.goal}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {block.lengthWeeks} weeks · {block.startDate} → {block.endDate} ·{" "}
            {daysRemaining > 0
              ? `${daysRemaining} days remaining (${upcoming} sessions left)`
              : "finished"}
          </p>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
            title="Delete this block to generate a new one"
          >
            Delete block
          </button>
        )}
      </div>
      {block.overview && (
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">{block.overview}</p>
      )}
      <BlockCalendar block={block} />
    </section>
  );
}

// ---------- Recent data summary ----------

function RecentDataSummary({ sync }: { sync: SyncData | null }) {
  if (!sync) return null;
  const today = todayIso();
  const cutoff7 = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const hours7 =
    sync.activities
      .filter((a) => a.date >= cutoff7 && a.date <= today)
      .reduce((s, a) => s + a.movingTimeSec, 0) / 3600;
  const weighIns = sync.wellness
    .filter((w) => w.weightKg !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
  const latestWeight = weighIns[0];
  const weekAgo = weighIns.find(
    (w) => (Date.parse(latestWeight?.date ?? today) - Date.parse(w.date)) / 86_400_000 >= 4
  );
  const trend =
    latestWeight?.weightKg != null && weekAgo?.weightKg != null
      ? Math.round((latestWeight.weightKg - weekAgo.weightKg) * 10) / 10
      : null;

  const stat = (label: string, value: string) => (
    <div className="rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
      <p className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-zinc-800 dark:text-zinc-200">{value}</p>
    </div>
  );

  return (
    <details className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-700 select-none dark:text-zinc-300">
        Recent data summary
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {stat("CTL (fitness)", sync.fitness.ctl?.toFixed(1) ?? "—")}
        {stat("ATL (fatigue)", sync.fitness.atl?.toFixed(1) ?? "—")}
        {stat("TSB (form)", sync.fitness.tsb?.toFixed(1) ?? "—")}
        {stat("Last 7-day hours", `${hours7.toFixed(1)} h`)}
        {stat(
          "Weight",
          latestWeight?.weightKg != null ? `${latestWeight.weightKg.toFixed(1)} kg` : "—"
        )}
        {stat("Weight trend", trend !== null ? `${trend > 0 ? "+" : ""}${trend.toFixed(1)} kg` : "—")}
      </div>
    </details>
  );
}

// ---------- Dashboard ----------

export default function Dashboard() {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

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

  const autoSyncDone = useRef(false);

  const doSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await api<{ lastSync: SyncData; todayAnalysis: TodayAnalysis | null }>("/api/sync", { method: "POST" });
      setState((s) =>
        s ? { ...s, lastSync: result.lastSync, todayAnalysis: result.todayAnalysis } : s
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, []);

  const loadBlockHistory = useCallback(async () => {
    try {
      const h = await api<BlockHistoryEntry[]>("/api/history");
      setBlockHistory(h);
    } catch {
      // history is best-effort
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const appState = await api<AppState>("/api/sync");
        if (cancelled) return;
        setState(appState);

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

        if (
          appState.configured &&
          isStale(appState.lastSync?.syncedAt ?? null) &&
          !autoSyncDone.current
        ) {
          autoSyncDone.current = true;
          void doSync();
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doSync, loadBlockHistory]);

  useEffect(() => {
    if (!generating) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [generating]);

  const generate = async () => {
    if (!goal.trim()) {
      setGenerateError("Enter a block goal first.");
      return;
    }
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
    <div className="space-y-4">
      <SyncStatus
        configured={state.configured}
        lastSyncedAt={state.lastSync?.syncedAt ?? null}
        syncing={syncing}
        error={syncError}
        onSync={doSync}
      />

      {state.todayAnalysis && state.todayAnalysis.activityDate === todayIso() && (
        <TodayRideCard analysis={state.todayAnalysis} />
      )}

      <CurrentBlockSection block={state.currentBlock} onDelete={deleteBlock} />

      {/* Block generation form */}
      <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={generate}
            disabled={generating || !state.anthropicConfigured}
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
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
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-400"
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

      {athleteMd && <GoalsProgress athleteMd={athleteMd} lastSync={state.lastSync} />}

      <RecentDataSummary sync={state.lastSync} />

      <BlockHistory history={blockHistory} />
    </div>
  );
}
