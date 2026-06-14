"use client";

import type { GeneratedPlan, PlannedDay, WriteResult } from "@/lib/types";
import { TYPE_STYLES } from "@/lib/workout-types";

interface Props {
  plan: GeneratedPlan;
  writing: boolean;
  results: WriteResult[] | null;
  intervalsConfigured: boolean;
  onWrite: () => void;
  onDismiss: () => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayHeading(date: string): string {
  return `${WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${date.slice(5)}`;
}

function fmtHours(days: PlannedDay[]): string {
  const total = days.reduce((s, d) => s + d.durationMin, 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function DayCard({ day, result }: { day: PlannedDay; result: WriteResult | undefined }) {
  const style = TYPE_STYLES[day.type];
  return (
    <article
      className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800"
      style={{ borderLeftColor: style.accent, borderLeftWidth: 4 }}
    >
      <div className="px-3 pt-3 pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">{dayHeading(day.date)}</span>
          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${style.badge}`}>
            {day.type}
          </span>
          {day.durationMin > 0 && (
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{day.durationMin} min</span>
          )}
          {result && (
            <span className={`ml-auto text-[11px] font-semibold ${result.ok ? "text-green-600" : "text-red-600"}`}>
              {result.ok ? "✓ written" : `✗ ${result.error ?? "failed"}`}
            </span>
          )}
        </div>
        <h4 className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{day.name}</h4>
        {day.workoutText && (
          <pre className="mt-2 overflow-x-auto rounded bg-zinc-50 px-2.5 py-2 font-mono text-[11px] leading-5 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            {day.workoutText}
          </pre>
        )}
        {day.description && (
          <p className="mt-2 text-[11px] leading-5 whitespace-pre-line text-zinc-500 dark:text-zinc-400">
            {day.description}
          </p>
        )}
      </div>
    </article>
  );
}

export default function PlanPreview({
  plan,
  writing,
  results,
  intervalsConfigured,
  onWrite,
  onDismiss,
}: Props) {
  const weeks = [...new Set(plan.days.map((d) => d.weekNumber))].sort((a, b) => a - b);
  const written = results !== null && results.every((r) => r.ok);
  const resultFor = (day: PlannedDay) => results?.find((r) => r.date === day.date);

  return (
    <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/50">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Plan preview</h2>
            <span className="text-xs text-zinc-400">{fmtHours(plan.days)} total · {plan.days.length} sessions</span>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-500 dark:text-zinc-400">{plan.overview}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 no-print">
          <button
            onClick={() => window.print()}
            className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
          >
            Print
          </button>
          <button
            onClick={onDismiss}
            className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
      </div>

      {plan.warnings.length > 0 && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Warnings — review before writing:</p>
          <ul className="mt-0.5 list-inside list-disc text-xs text-amber-700 dark:text-amber-300">
            {plan.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Weeks */}
      {weeks.map((week) => {
        const weekDays = plan.days.filter((d) => d.weekNumber === week);
        const wHours = fmtHours(weekDays);
        return (
          <div key={week} className="mt-4 print-break-before">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Week {week}{weekDays[0]?.weekTheme ? ` · ${weekDays[0].weekTheme}` : ""}
              </h3>
              <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:border dark:border-[#00d4ff]/40 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff]">
                {wHours}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {weekDays.map((day) => (
                <DayCard key={day.date} day={day} result={resultFor(day)} />
              ))}
            </div>
          </div>
        );
      })}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 no-print dark:border-zinc-700">
        <button
          onClick={onDismiss}
          disabled={writing}
          className="rounded border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          Discard & adjust
        </button>
        <button
          onClick={onWrite}
          disabled={writing || written || !intervalsConfigured}
          className="rounded bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:bg-[#ff49c8] dark:text-zinc-900 dark:hover:brightness-110 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
        >
          {writing ? `Writing ${plan.days.length} events…` : written ? "✓ Written to Intervals.icu" : "Write to Intervals.icu"}
        </button>
        {!intervalsConfigured && (
          <p className="text-xs text-red-600">Intervals.icu not configured.</p>
        )}
        {results !== null && !written && (
          <p className="text-xs text-red-600">
            {results.filter((r) => !r.ok).length}/{results.length} events failed — see cards above.
          </p>
        )}
      </div>
    </section>
  );
}
