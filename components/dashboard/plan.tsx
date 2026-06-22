"use client";

import { useEffect, useRef, useState } from "react";
import type { AthleteMdSnapshot } from "@/lib/kb-loader";
import type { BlockHistoryEntry, CurrentBlock, RideScoreEntry, SyncData } from "@/lib/types";
import { TYPE_STYLES } from "@/lib/workout-types";
import { isoDaysAgo, localToday as todayIso } from "@/lib/date";
import { Card, StatTile, CyberFrame } from "../ui";

// The block overview can run several sentences. Clamp it to 3 lines so the calendar + goals stay near
// the top of the fold, with a "Show more" toggle that only appears when the text actually overflows.
function BlockOverview({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clampable, setClampable] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el) setClampable(el.scrollHeight > el.clientHeight + 1);
  }, [text]);
  return (
    <div className="mt-2 max-w-3xl">
      <p ref={ref} className={`text-sm leading-6 text-zinc-600 dark:text-zinc-400 ${expanded ? "" : "line-clamp-3"}`}>
        {text}
      </p>
      {(clampable || expanded) && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-xs font-medium text-zinc-500 hover:underline dark:text-[#00d4ff]"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

// ---------- Weekly debrief ----------

export function WeeklyDebrief({ sync }: { sync: SyncData }) {
  const today = todayIso();
  const d = new Date();
  const dayOfWeek = d.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset);
  // Format from local components (matches todayIso() and activity start_date_local)
  // so the week boundary doesn't shift via UTC near midnight.
  const weekStart = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;

  const weekActivities = sync.activities.filter((a) => a.date >= weekStart && a.date <= today);
  const weekHours = weekActivities.reduce((s, a) => s + a.movingTimeSec, 0) / 3600;
  const weekTss = weekActivities.reduce((s, a) => s + (a.trainingLoad ?? 0), 0);
  const topSession = [...weekActivities].sort((a, b) => (b.trainingLoad ?? 0) - (a.trainingLoad ?? 0))[0];

  const cutoff7 = isoDaysAgo(7);
  const weekWellness = sync.wellness.filter((w) => w.date >= cutoff7 && w.date <= today);
  const hrvValues = weekWellness.map((w) => w.hrv).filter((v): v is number => v !== null);
  const sleepValues = weekWellness.map((w) => w.sleepHours).filter((v): v is number => v !== null);
  const avgHrv = hrvValues.length > 0 ? Math.round(hrvValues.reduce((s, v) => s + v, 0) / hrvValues.length) : null;
  const avgSleep = sleepValues.length > 0 ? (sleepValues.reduce((s, v) => s + v, 0) / sleepValues.length).toFixed(1) : null;

  if (weekActivities.length === 0 && avgHrv === null) return null;

  return (
    <Card title="This week">
      <div className="flex flex-wrap gap-2">
        <StatTile label="Hours" value={`${weekHours.toFixed(1)} h`} />
        {weekTss > 0 && <StatTile label="TSS" value={String(Math.round(weekTss))} />}
        {avgHrv !== null && <StatTile label="Avg HRV" value={String(avgHrv)} />}
        {avgSleep !== null && <StatTile label="Avg sleep" value={`${avgSleep} h`} />}
      </div>
      {topSession && (
        <div className="mt-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">Top session</p>
          <p className="mt-0.5 text-sm font-medium leading-snug text-zinc-800 dark:text-zinc-100">{topSession.name}</p>
          {topSession.trainingLoad != null && (
            <p className="mt-0.5 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{topSession.trainingLoad} TSS</p>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------- Retrospective section ----------

export function RetroSection({
  block,
  generating,
  result,
  error,
  onGenerate,
}: {
  block: CurrentBlock | null;
  generating: boolean;
  result: { retrospective: string; seeds: string[]; complianceByType: Record<string, number> } | null;
  error: string | null;
  onGenerate: () => void;
}) {
  const today = todayIso();
  const blockEnded = block && block.endDate < today;

  // Show the latest retro from a history entry if we've already run it for this block.
  if (!result && !blockEnded) return null;

  if (result) {
    return (
      <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Block retrospective</h2>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-900 dark:text-[#ff49c8]/70">
            completed
          </span>
        </div>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">{result.retrospective}</p>
        {result.seeds.length > 0 && (
          <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-700">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1.5">
              Seeded into next block
            </p>
            <ul className="space-y-1">
              {result.seeds.map((s, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300 dark:bg-[#ff49c8]/40" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 dark:border-zinc-600 dark:bg-zinc-800">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-amber-900 dark:text-zinc-100">
            Block ended {block!.endDate}
          </p>
          <p className="mt-0.5 text-xs text-amber-700 dark:text-zinc-400">
            Generate a retrospective to close the block and seed the next one with insights.
          </p>
          {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <button
          onClick={onGenerate}
          disabled={generating}
          className="shrink-0 rounded-md bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-900 disabled:opacity-50 dark:bg-[#ff49c8]/20 dark:text-[#ff49c8] dark:hover:bg-[#ff49c8]/30 dark:border dark:border-[#ff49c8]/40"
        >
          {generating ? "Generating…" : "Wrap up block"}
        </button>
      </div>
    </section>
  );
}

// ---------- Progress toward goals ----------

interface ProfileGoals {
  athleteMd: AthleteMdSnapshot;
}

export function GoalsProgress({ athleteMd }: ProfileGoals) {
  if (!athleteMd.goals.length) return null;

  const powerGoals = athleteMd.performanceData;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-700 dark:bg-zinc-800">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Goals</h2>
      <div className="mt-3 flex flex-col gap-2">
        {athleteMd.goals.map((g) => (
          <div key={g.goal} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 text-sm text-zinc-700 dark:text-zinc-300">{g.goal}</span>
            {g.target && (
              <span className="min-w-0 break-words rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff] dark:ring-1 dark:ring-[#00d4ff]/30">
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

export function BlockHistory({ history }: { history: BlockHistoryEntry[] }) {
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

function BlockCalendar({ block, scores, compromisedDates, partialDates }: { block: CurrentBlock; scores: RideScoreEntry[]; compromisedDates: string[]; partialDates: string[] }) {
  const compromisedSet = new Set(compromisedDates);
  const partialSet = new Set(partialDates);
  const today = todayIso();
  const scoreByDate = new Map(scores.map((s) => [s.date, s.executionScore]));
  const scoreColor = (v: number) =>
    v >= 7 ? "text-green-700 dark:text-green-400" : v >= 5 ? "text-amber-700 dark:text-amber-400" : "text-red-600 dark:text-red-400";
  const weeks: CurrentBlock["days"][] = [];
  const sorted = [...block.days].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < sorted.length; i += 7) weeks.push(sorted.slice(i, i + 7));

  const weeklyMinutes = weeks.map((week) =>
    week.reduce((s, d) => s + d.durationMin, 0)
  );

  return (
    <div className="mt-3 space-y-1">
      {weeks.map((week, i) => {
        const mins = weeklyMinutes[i];
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const label = m === 0 ? `${h}h` : `${h}h ${m}m`;
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-right text-[10px] font-medium text-zinc-400">{label}</span>
            <div className="flex flex-1 gap-1.5 overflow-visible">
              {week.map((day, dayIdx) => {
                const alignClass =
                  dayIdx <= 1 ? "left-0" : dayIdx >= week.length - 2 ? "right-0" : "left-1/2 -translate-x-1/2";
                const score = scoreByDate.get(day.date);
                const completed = score !== undefined;
                // A compromised session was ridden (then attributed) — it's excluded from
                // `scores`, so guard it here or it would read as falsely "Missed".
                const compromised = !completed && compromisedSet.has(day.date);
                // A partial session is scored (so it's "completed" in the ledger sense) but the
                // athlete attributed it as cut short — label it accordingly, not plain "Completed".
                const partial = completed && partialSet.has(day.date);
                const missed = !completed && !compromised && day.date < today && day.type !== "Rest";
                return (
                  <div key={day.date} className="group relative flex-1">
                    <div
                      className={`flex h-7 w-full items-center justify-center rounded text-[10px] font-medium ${TYPE_STYLES[day.type].cell} ${
                        day.type === "Rest" ? "text-zinc-600" : "text-white"
                      } ${day.date === today ? "ring-2 ring-zinc-900 ring-offset-1 dark:ring-[#ff49c8] dark:ring-offset-zinc-800" : ""} ${
                        completed ? "font-bold ring-1 ring-inset ring-white/60 dark:ring-black/30" : ""
                      } ${missed ? "opacity-40" : ""} ${!completed && !missed && day.date < today ? "opacity-40" : ""}`}
                    >
                      {completed ? (
                        <span className="flex items-center gap-0.5 rounded-sm bg-black/45 px-1 leading-none text-white">
                          <span className="text-[10px] font-bold leading-none">✓</span>
                          <span className="text-[10px]">{score}</span>
                        </span>
                      ) : compromised ? (
                        <span className="rounded-sm bg-black/35 px-1 text-[10px] font-bold leading-none text-white" title="Compromised">~</span>
                      ) : (
                        day.date.slice(8)
                      )}
                    </div>
                    {/* Custom tooltip */}
                    <div
                      className={`pointer-events-none absolute bottom-full mb-2 z-30 opacity-0 transition-opacity duration-100 group-hover:opacity-100 w-max max-w-[160px] ${alignClass}`}
                    >
                      <div className="rounded border border-zinc-200 bg-white px-2.5 py-2 shadow-md dark:border-zinc-700 dark:bg-zinc-900">
                        <p className="text-[11px] font-semibold leading-tight text-zinc-800 dark:text-zinc-100">
                          {day.name}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${TYPE_STYLES[day.type].cell}`}
                          />
                          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{day.type}</span>
                          {day.durationMin > 0 && (
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                              · {day.durationMin} min
                            </span>
                          )}
                        </div>
                        {completed ? (
                          <p className="mt-0.5 text-[10px] font-medium">
                            <span className={partial ? "text-amber-600 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"}>
                              {partial ? "Partial · " : "Completed · "}
                            </span>
                            <span className={scoreColor(score)}>execution {score}/10</span>
                          </p>
                        ) : compromised ? (
                          <p className="mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">Compromised — ridden, excluded from scoring</p>
                        ) : missed ? (
                          <p className="mt-0.5 text-[10px] font-medium text-red-500">Missed</p>
                        ) : null}
                        <p className="mt-0.5 font-mono text-[10px] text-zinc-400 dark:text-zinc-600">
                          {day.date}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 pl-12">
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

export function CurrentBlockSection({
  block,
  onDelete,
  scores,
  compromisedDates,
  partialDates,
}: {
  block: CurrentBlock | null;
  onDelete?: () => void;
  scores: RideScoreEntry[];
  compromisedDates: string[];
  partialDates: string[];
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
  const weekOfBlock = Math.min(
    block.lengthWeeks,
    Math.max(1, Math.floor((Date.parse(today) - Date.parse(block.startDate)) / (7 * 86_400_000)) + 1)
  );
  // Real sessions still to come — exclude rest days (durationMin 0) and any day already ridden
  // (so today drops off once it's logged, instead of lingering as "to go").
  const completedDates = new Set(scores.map((s) => s.date));
  const sessionsToGo = block.days.filter(
    (d) => d.date >= today && d.durationMin > 0 && !completedDates.has(d.date)
  ).length;
  return (
    <section className="relative rounded-none border-2 border-zinc-300 bg-white px-4 py-4 dark:border-[#00d4ff]/55 dark:bg-zinc-900 dark:shadow-[0_0_28px_-8px_rgba(0,212,255,0.45)]">
      <CyberFrame accent="cyan" />
      <div className="relative z-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Active block</h2>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff] dark:ring-1 dark:ring-[#00d4ff]/30">
                {block.lengthWeeks}w
              </span>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {block.startDate} → {block.endDate} ·{" "}
              {daysRemaining > 0
                ? `Week ${weekOfBlock} of ${block.lengthWeeks} · ${sessionsToGo} session${sessionsToGo === 1 ? "" : "s"} to go`
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
        {block.overview && <BlockOverview text={block.overview} />}
        <BlockCalendar block={block} scores={scores} compromisedDates={compromisedDates} partialDates={partialDates} />
      </div>
    </section>
  );
}
