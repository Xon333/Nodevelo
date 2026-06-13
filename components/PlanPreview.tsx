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
  return `${WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${date}`;
}

function DayCard({ day, result }: { day: PlannedDay; result: WriteResult | undefined }) {
  const style = TYPE_STYLES[day.type];
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-zinc-500">{dayHeading(day.date)}</span>
        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style.badge}`}>
          {day.type}
        </span>
        {day.durationMin > 0 && (
          <span className="text-xs text-zinc-500">{day.durationMin} min</span>
        )}
        {result && (
          <span
            className={`ml-auto text-xs font-medium ${result.ok ? "text-green-700" : "text-red-700"}`}
          >
            {result.ok ? "✓ written" : `✗ ${result.error ?? "failed"}`}
          </span>
        )}
      </div>
      <h4 className="mt-1.5 text-sm font-semibold text-zinc-900">{day.name}</h4>
      {day.workoutText && (
        <pre className="mt-2 overflow-x-auto rounded-md bg-zinc-50 p-3 font-mono text-xs leading-5 text-zinc-700">
          {day.workoutText}
        </pre>
      )}
      <p className="mt-2 text-xs leading-5 whitespace-pre-line text-zinc-600">{day.description}</p>
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
    <section className="rounded-lg border-2 border-zinc-300 bg-zinc-100/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">Generated plan preview</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-600">{plan.overview}</p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-200"
          title="Discard preview"
        >
          ✕
        </button>
      </div>

      {plan.warnings.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-800">
            Parser warnings — review before writing:
          </p>
          <ul className="mt-1 list-inside list-disc text-xs text-amber-800">
            {plan.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {weeks.map((week) => {
        const weekDays = plan.days.filter((d) => d.weekNumber === week);
        return (
          <div key={week} className="mt-4">
            <h3 className="text-sm font-semibold text-zinc-700">
              Week {week}
              {weekDays[0]?.weekTheme ? ` — ${weekDays[0].weekTheme}` : ""}
            </h3>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              {weekDays.map((day) => (
                <DayCard key={day.date} day={day} result={resultFor(day)} />
              ))}
            </div>
          </div>
        );
      })}

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={onWrite}
          disabled={writing || written || !intervalsConfigured}
          className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {writing
            ? `Writing ${plan.days.length} events…`
            : written
              ? "✓ Written to Intervals.icu"
              : "Write to Intervals.icu"}
        </button>
        {!intervalsConfigured && (
          <p className="text-xs text-red-600">Intervals.icu is not configured.</p>
        )}
        {results !== null && !written && (
          <p className="text-xs text-red-600">
            {results.filter((r) => !r.ok).length} of {results.length} events failed — see cards
            above. Fix and retry (already-written days will duplicate; delete them in
            Intervals.icu first).
          </p>
        )}
      </div>
    </section>
  );
}
