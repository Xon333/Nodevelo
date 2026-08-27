"use client";

import type { GeneratedPlan, PlannedDay, WriteResult } from "@/lib/types";
import { TYPE_STYLES } from "@/lib/workout-types";

interface Props {
  plan: GeneratedPlan;
  writing: boolean;
  results: WriteResult[] | null;
  // HR-34: a thrown write failure (network error, or the UXA-24 409 from a stale tab) — shown right
  // here, next to Write. Previously routed through PlanView's generateError, which only renders
  // inside BlockGenerator's expanded form — collapsed by default whenever a block is active, i.e.
  // always, at the exact moment Write is used. The 409's "reload to see the latest" guidance, the
  // whole point of the version guard, was exactly the message most likely lost.
  writeError: string | null;
  // HR-48: set on a partial-write auto-rollback (RV-9) — some `results` entries marked `ok: true` were
  // actually undone server-side (their events deleted/restored to the old block's content), so cards
  // and the summary line must not claim they were written.
  rollback: { rolledBack: number; rollbackFailed: number[] } | null;
  intervalsConfigured: boolean;
  hasActiveBlock: boolean; // UXA-8: states the consequence before Write replaces it
  // Publication-gate trust contract: the acknowledgment checkbox is controlled from PlanView (which
  // sends the flag in the write POST and resets it on regenerate), so the preview stays a pure
  // renderer of the gating decision.
  overrideAcknowledged: boolean;
  onOverrideAcknowledgedChange: (acknowledged: boolean) => void;
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

function DayCard({
  day,
  result,
  rollback,
}: {
  day: PlannedDay;
  result: WriteResult | undefined;
  // HR-48: when set, this write failed partway and was rolled back — a `result.ok: true` day's event
  // was undone (deleted/restored), not left standing, so it must never read "✓ written".
  rollback: { rolledBack: number; rollbackFailed: number[] } | null;
}) {
  const style = TYPE_STYLES[day.type];
  // A rolled-back "success" is only truly clean if its own event was among the ones the rollback
  // could actually undo — `rollbackFailed` lists ids the cleanup itself couldn't remove/restore,
  // meaning this specific day's calendar entry may still be sitting there with stale content.
  const rollbackFailedHere = rollback !== null && result?.eventId !== null && rollback.rollbackFailed.includes(result?.eventId as number);
  return (
    <article
      className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800"
      style={{ borderLeftColor: style.accent, borderLeftWidth: 4 }}
    >
      <div className="px-3 pt-3 pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{dayHeading(day.date)}</span>
          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${style.badge}`}>
            {day.type}
          </span>
          {day.durationMin > 0 && (
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{day.durationMin} min</span>
          )}
          {result && rollback && result.ok ? (
            <span className={`ml-auto text-[11px] font-semibold ${rollbackFailedHere ? "text-amber-600" : "text-zinc-500 dark:text-zinc-400"}`}>
              {rollbackFailedHere ? "⚠ rollback failed — check Intervals.icu" : "↺ rolled back — not saved"}
            </span>
          ) : (
            result && (
              <span className={`ml-auto text-[11px] font-semibold ${result.ok ? "text-green-600" : "text-red-600"}`}>
                {result.ok ? "✓ written" : `✗ ${result.error ?? "failed"}`}
              </span>
            )
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
  writeError,
  rollback,
  intervalsConfigured,
  hasActiveBlock,
  overrideAcknowledged,
  onOverrideAcknowledgedChange,
  onWrite,
  onDismiss,
}: Props) {
  const weeks = [...new Set(plan.days.map((d) => d.weekNumber))].sort((a, b) => a - b);
  const written = results !== null && results.every((r) => r.ok);
  const resultFor = (day: PlannedDay) => results?.find((r) => r.date === day.date);
  // Truthy-check, never `=== null`: plans generated before the gate shipped parse back as undefined.
  const blockers = plan.findings?.blockers ?? [];
  const preferences = plan.findings?.preferences ?? [];
  // Blockers are absolute — no acknowledgment exists for them. Preferences gate Write until the
  // athlete explicitly acknowledges them (the checkbox state PlanView owns and sends to /api/write).
  const blocked = blockers.length > 0;
  const needsOverride = !blocked && preferences.length > 0;
  const writeDisabled =
    writing || written || !intervalsConfigured || blocked || (needsOverride && !overrideAcknowledged);

  return (
    <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/50">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Plan preview</h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{fmtHours(plan.days)} total · {plan.days.length} sessions</span>
          </div>
          {(plan.model || plan.promptVersion != null) && (
            <p className="mt-0.5 text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
              {plan.model}{plan.model && plan.promptVersion != null ? " · " : ""}{plan.promptVersion != null ? `prompt v${plan.promptVersion}` : ""}
            </p>
          )}
          <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-500 dark:text-zinc-400">{plan.overview}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 no-print">
          <button
            onClick={() => window.print()}
            className="rounded px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
          >
            Print
          </button>
          <button
            onClick={onDismiss}
            className="rounded px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
      </div>

      {blocked && (
        <div className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 dark:border-red-700 dark:bg-red-950">
          <p className="text-xs font-semibold text-red-800 dark:text-red-300">
            Publication blocked — these defects make this plan unsafe to publish. Regenerate.
          </p>
          <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">
            These findings cannot be overridden — no acknowledgment can bypass them.
          </p>
          <ul className="mt-0.5 list-inside list-disc text-xs text-red-700 dark:text-red-300">
            {blockers.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}

      {needsOverride && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            Coaching concerns — review before publishing:
          </p>
          <ul className="mt-0.5 list-inside list-disc text-xs text-amber-700 dark:text-amber-300">
            {preferences.map((w) => <li key={w}>{w}</li>)}
          </ul>
          {/* Informed override: publishing past these concerns is a deliberate athlete decision,
              recorded server-side as provenance on the written block. */}
          <label className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-200">
            <input
              type="checkbox"
              checked={overrideAcknowledged}
              onChange={(e) => onOverrideAcknowledgedChange(e.target.checked)}
              className="mt-0.5"
            />
            I have read the concerns above — publish anyway.
          </label>
        </div>
      )}

      {plan.warnings.length > 0 && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Notes — for your awareness:</p>
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
                <DayCard key={day.date} day={day} result={resultFor(day)} rollback={rollback} />
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
          disabled={writeDisabled}
          className="rounded bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:bg-[#ff49c8] dark:text-zinc-900 dark:hover:brightness-110 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
        >
          {writing ? `Writing ${plan.days.length} events…` : written ? "✓ Written to Intervals.icu" : "Write to Intervals.icu"}
        </button>
        {/* UXA-8: states the consequence before the click, matching the in-product-confirm
            convention Delete-block and Restore already use — Write is equally destructive
            (archives the active block, prunes its future events) but previously said nothing. */}
        {hasActiveBlock && !written && intervalsConfigured && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Replaces your active block — remaining days archived, ridden history kept.
          </p>
        )}
        {!intervalsConfigured && (
          <p className="text-xs text-red-600">Intervals.icu not configured.</p>
        )}
        {results !== null && !written && (
          <p className="text-xs text-red-600">
            {rollback
              ? // HR-48: a rolled-back write saved NOTHING — plainly say so instead of only counting the
                // days that failed outright, which silently implied the rest actually stuck.
                `Partial write rolled back — nothing was saved. ${results.filter((r) => !r.ok).length}/${results.length} event(s) failed, ${rollback.rolledBack} undone.` +
                (rollback.rollbackFailed.length > 0
                  ? ` ${rollback.rollbackFailed.length} couldn't be cleaned up — check Intervals.icu directly.`
                  : "")
              : `${results.filter((r) => !r.ok).length}/${results.length} events failed — see cards above.`}
          </p>
        )}
        {writeError && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {writeError}
          </p>
        )}
      </div>
    </section>
  );
}
