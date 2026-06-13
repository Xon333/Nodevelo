"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, isStale, nextMonday } from "@/lib/client-api";
import type { AthleteMdSnapshot } from "@/lib/kb-loader";
import type {
  CurrentBlock,
  GeneratedPlan,
  SyncData,
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
}

function todayIso(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}

// ---------- Current block card ----------

function BlockCalendar({ block }: { block: CurrentBlock }) {
  const today = todayIso();
  const weeks: CurrentBlock["days"][] = [];
  const sorted = [...block.days].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < sorted.length; i += 7) weeks.push(sorted.slice(i, i + 7));
  return (
    <div className="mt-3 space-y-1.5">
      {weeks.map((week, i) => (
        <div key={i} className="flex gap-1.5">
          {week.map((day) => (
            <div
              key={day.date}
              title={`${day.date} — ${day.name}${day.durationMin ? ` (${day.durationMin} min)` : ""}`}
              className={`flex h-9 flex-1 items-center justify-center rounded text-[10px] font-medium ${TYPE_STYLES[day.type].cell} ${
                day.type === "Rest" ? "text-zinc-600" : "text-white"
              } ${day.date === today ? "ring-2 ring-zinc-900 ring-offset-1" : ""} ${
                day.date < today ? "opacity-40" : ""
              }`}
            >
              {day.date.slice(8)}
            </div>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap gap-3 pt-1">
        {(["Z2", "Recovery", "Threshold", "VO2max", "SIT", "Strength", "Rest"] as const).map(
          (t) => (
            <span key={t} className="flex items-center gap-1 text-[11px] text-zinc-500">
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
      <section className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-6 text-center">
        <p className="text-sm text-zinc-500">
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
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">
            Current block: {block.goal}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {block.lengthWeeks} weeks · {block.startDate} → {block.endDate} ·{" "}
            {daysRemaining > 0
              ? `${daysRemaining} days remaining (${upcoming} sessions left)`
              : "finished"}
          </p>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            title="Delete this block to generate a new one"
          >
            Delete block
          </button>
        )}
      </div>
      {block.overview && (
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">{block.overview}</p>
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
    <div className="rounded-md bg-zinc-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-zinc-800">{value}</p>
    </div>
  );

  return (
    <details className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-700 select-none">
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
  const autoSyncDone = useRef(false);

  const doSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const { lastSync } = await api<{ lastSync: SyncData }>("/api/sync", { method: "POST" });
      setState((s) => (s ? { ...s, lastSync } : s));
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const appState = await api<AppState>("/api/sync");
        if (cancelled) return;
        setState(appState);
        // Pre-fill goal and weakpoints from athlete_profile.md (overridable per block).
        try {
          const { athleteMd } = await api<{ athleteMd: AthleteMdSnapshot }>("/api/profile");
          if (!cancelled) {
            if (athleteMd.goals.length > 0) {
              setGoal(athleteMd.goals.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
            }
            if (athleteMd.weakpoints.length > 0) {
              setWeakpointsText(athleteMd.weakpoints.map((w) => w.weakpoint).join("\n"));
            }
          }
        } catch {
          // profile prefill is best-effort; both fields stay editable
        }
        // Auto-sync on open when the cache is older than 24 h.
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
  }, [doSync]);

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
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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

      <CurrentBlockSection block={state.currentBlock} onDelete={deleteBlock} />

      {/* Actions + block settings */}
      <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={generate}
            disabled={generating || !state.anthropicConfigured}
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
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
            <p className="text-xs text-amber-700">
              Tip: sync first so the plan reflects your recent training.
            </p>
          )}
        </div>
        {generateError && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            {generateError}
          </p>
        )}

        <div className="mt-4 grid gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="text-xs font-medium text-zinc-600">Block length</label>
            <div className="mt-1.5 flex gap-2">
              {([2, 4] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => setLengthWeeks(w)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                    lengthWeeks === w
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400"
                  }`}
                >
                  {w} weeks
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="start-date" className="text-xs font-medium text-zinc-600">
              Start date
            </label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="goal" className="text-xs font-medium text-zinc-600">
              Block goal (one per line)
            </label>
            <textarea
              id="goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              placeholder="from profile; edit to override"
              className="mt-1.5 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="weakpoints" className="text-xs font-medium text-zinc-600">
              Weakpoints to target (one per line)
            </label>
            <textarea
              id="weakpoints"
              value={weakpointsText}
              onChange={(e) => setWeakpointsText(e.target.value)}
              rows={2}
              placeholder="from profile; edit to override"
              className="mt-1.5 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
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

      <RecentDataSummary sync={state.lastSync} />
    </div>
  );
}
