"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { BlockHistoryEntry, CurrentBlock, RideScoreEntry, SyncData } from "@/lib/types";
import { TYPE_STYLES } from "@/lib/workout-types";
import { localToday as todayIso } from "@/lib/date";
import { Card, StatTile, HeroSurface, InfoDot } from "../ui";
import { weekCharacters } from "@/lib/plan-week-character";
import DayAction from "../DayAction";

// Relative label for the "next: <session>, <when>" pointer. Parse with an explicit local midnight so
// the weekday doesn't drift a day via UTC. `date` is always strictly after `today` at the call site.
function relDay(date: string, today: string): string {
  const diff = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  if (diff <= 1) return "tomorrow";
  if (diff < 7) return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" });
  return date;
}

// The block overview can run several sentences. Clamp it to 3 lines so the calendar stays near
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
        // S2-2: py-1 (vs. none) gives this a real click/tap target.
        <button
          onClick={() => setExpanded((v) => !v)}
          className="-my-1 py-1 text-xs font-medium text-zinc-500 hover:underline dark:text-[#00d4ff]"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
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
      <Card
        title="Block retrospective"
        action={
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-900 dark:text-[#ff49c8]/70">
            completed
          </span>
        }
      >
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">{result.retrospective}</p>
        {result.seeds.length > 0 && (
          <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-700">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5">
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
      </Card>
    );
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-zinc-600 dark:bg-zinc-800">
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

// ---------- Block history ----------

// UXA-41: same unbounded-DOM gap as Trends' BlockTimeline, reading the same underlying (200-cap,
// newest-first) block-history.json — capped to the most recent 20 here too.
const MAX_HISTORY_SHOWN = 20;

export function BlockHistory({ history }: { history: BlockHistoryEntry[] }) {
  if (!history.length) return null;
  const shown = history.slice(0, MAX_HISTORY_SHOWN);
  return (
    <details className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-700 select-none dark:text-zinc-300">
        Block history ({shown.length}{history.length > shown.length ? ` of ${history.length}` : ""})
      </summary>
      <div className="mt-3 space-y-2">
        {shown.map((entry) => (
          <div
            key={entry.id}
            className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 line-clamp-1">
                {entry.goal}
              </p>
              <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
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

function BlockCalendar({
  weeks,
  characters,
  scores,
  compromisedDates,
  partialDates,
  completedDates,
  blockEndDate,
}: {
  weeks: CurrentBlock["days"][];
  characters: string[];
  scores: RideScoreEntry[];
  compromisedDates: string[];
  partialDates: string[];
  completedDates: string[];
  blockEndDate: string;
}) {
  // S2-1: each day cell's detail was hover-only (the calendar's whole story was mouse-only). One id
  // per cell, tabIndex + aria-describedby + role="tooltip" — same pattern as Wave 1's MetricTip.
  const idBase = useId();
  const compromisedSet = new Set(compromisedDates);
  const partialSet = new Set(partialDates);
  // Dates the athlete marked "completed" with no matching ledger score — a true rest day taken,
  // or a session attributed before/without a synced ride. Without this, such a day falls through
  // to blank (or falsely "Missed" for a non-Rest day) despite the athlete's own attribution.
  const dispositionCompletedSet = new Set(completedDates);
  const today = todayIso();
  // §7 manual move: click/tap a cell to pin its tooltip open as an interactive popover (hosting
  // MoveDay for eligible days) instead of the pure hover/focus preview.
  const [pinnedDate, setPinnedDate] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scoreByDate = new Map(scores.map((s) => [s.date, s.executionScore]));
  const scoreColor = (v: number) =>
    v >= 7 ? "text-green-700 dark:text-green-400" : v >= 5 ? "text-amber-700 dark:text-amber-400" : "text-red-600 dark:text-red-400";
  const weeklyMinutes = weeks.map((week) =>
    week.reduce((s, d) => s + d.durationMin, 0)
  );

  // Close a pinned popover on an outside click/tap. The ref sits on the whole calendar grid, so a
  // pointerdown anywhere inside it — another cell, or the pinned popover's own date input/buttons —
  // is "inside" and doesn't close the pin; only a pointerdown outside the grid entirely does.
  useEffect(() => {
    if (!pinnedDate) return;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPinnedDate(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pinnedDate]);

  return (
    <div ref={containerRef} className="mt-3 space-y-1">
      {weeks.map((week, i) => {
        const mins = weeklyMinutes[i];
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const label = m === 0 ? `${h}h` : `${h}h ${m}m`;
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="flex w-14 shrink-0 flex-col items-end leading-tight">
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
              {characters[i] && (
                <span className="text-[9px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{characters[i]}</span>
              )}
            </span>
            <div className="flex flex-1 gap-1.5 overflow-visible">
              {week.map((day, dayIdx) => {
                const alignClass =
                  dayIdx <= 1 ? "left-0" : dayIdx >= week.length - 2 ? "right-0" : "left-1/2 -translate-x-1/2";
                const score = scoreByDate.get(day.date);
                const hasScore = score !== undefined;
                // A compromised session was ridden (then attributed) — it's excluded from
                // `scores`, so guard it here or it would read as falsely "Missed".
                const compromised = !hasScore && compromisedSet.has(day.date);
                // A partial session is scored (so it's "completed" in the ledger sense) but the
                // athlete attributed it as cut short — label it accordingly, not plain "Completed".
                const partial = hasScore && partialSet.has(day.date);
                // Completed with no score to show (a true rest day taken, or attributed before/
                // without a synced ride) — still "completed" for display, just no execution number.
                const dispositionCompleted = !hasScore && dispositionCompletedSet.has(day.date);
                const completed = hasScore || dispositionCompleted;
                const missed = !completed && !compromised && day.date < today && day.type !== "Rest";
                const cellId = `${idBase}-${day.date}`;
                // §7 manual move: only a real, not-yet-happened session can be moved. Ineligible/rest/
                // past cells still toggle `pinnedDate` on click (harmless — MoveDay just never mounts).
                const eligible = day.date >= today && day.durationMin > 0 && day.type !== "Rest";
                const pinned = pinnedDate === day.date;
                return (
                  <div key={day.date} className="group relative flex-1">
                    <div
                      tabIndex={0}
                      role="button"
                      aria-describedby={cellId}
                      aria-controls={cellId}
                      aria-expanded={pinned}
                      onClick={() => setPinnedDate(pinned ? null : day.date)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setPinnedDate(pinned ? null : day.date);
                        } else if (e.key === "Escape") {
                          setPinnedDate(null);
                        }
                      }}
                      className={`flex h-10 w-full items-center justify-center rounded text-[10px] font-medium ${TYPE_STYLES[day.type].cell} ${
                        day.type === "Rest" ? "text-zinc-600" : "text-white"
                      } ${day.date === today ? "ring-2 ring-zinc-900 ring-offset-1 dark:ring-[#ff49c8] dark:ring-offset-zinc-800" : ""} ${
                        completed ? "font-bold ring-1 ring-inset ring-white/60 dark:ring-black/30" : ""
                      } ${missed ? "opacity-40" : ""} ${!completed && !missed && day.date < today ? "opacity-40" : ""}`}
                    >
                      {completed ? (
                        <span className="flex items-center gap-0.5 rounded-sm bg-black/45 px-1 leading-none text-white">
                          <span className="text-[10px] font-bold leading-none">✓</span>
                          {hasScore && <span className="text-[10px]">{score}</span>}
                        </span>
                      ) : compromised ? (
                        <span className="rounded-sm bg-black/35 px-1 text-[10px] font-bold leading-none text-white" title="Compromised">~</span>
                      ) : (
                        day.date.slice(8)
                      )}
                    </div>
                    {/* Day detail — opens on hover (mouse) or keyboard focus/tap (S2-1), same
                        mechanic as ui.tsx's MetricTip. UXA-35: Escape here (not just on the trigger
                        cell above) closes the pin even when focus has moved into DayAction's own
                        input/buttons inside — the trigger's own Escape handler never fires for those,
                        since this popover is a DOM sibling of the trigger, not its child. */}
                    <div
                      id={cellId}
                      role={eligible && pinned ? "dialog" : "tooltip"}
                      aria-label={eligible && pinned ? `Move ${day.name}` : undefined}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setPinnedDate(null);
                        }
                      }}
                      className={
                        pinned
                          ? `pointer-events-auto absolute bottom-full mb-2 z-40 opacity-100 w-max max-w-[160px] ${alignClass}`
                          : `pointer-events-none absolute bottom-full mb-2 z-30 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 w-max max-w-[160px] ${alignClass}`
                      }
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
                            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                              · {day.durationMin} min
                            </span>
                          )}
                        </div>
                        {completed ? (
                          <p className="mt-0.5 text-[10px] font-medium">
                            <span className={partial ? "text-amber-600 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"}>
                              {partial ? "Partial" : "Completed"}
                              {hasScore ? " · " : ""}
                            </span>
                            {hasScore && <span className={scoreColor(score)}>execution {score}/10</span>}
                          </p>
                        ) : compromised ? (
                          <p className="mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">Compromised — ridden, excluded from scoring</p>
                        ) : missed ? (
                          <p className="mt-0.5 text-[10px] font-medium text-red-500">Missed</p>
                        ) : null}
                        <p className="mt-0.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-600">
                          {day.date}
                        </p>
                        {eligible && pinned && (
                          <div className="mt-2 flex flex-col gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-700">
                            <DayAction verb="move" date={day.date} maxDate={blockEndDate} onMoved={() => setPinnedDate(null)} />
                            <DayAction verb="swap" date={day.date} maxDate={blockEndDate} onMoved={() => setPinnedDate(null)} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 pl-14">
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
  completedDates,
  sync,
}: {
  block: CurrentBlock | null;
  onDelete?: () => void;
  scores: RideScoreEntry[];
  compromisedDates: string[];
  partialDates: string[];
  completedDates: string[];
  sync?: SyncData | null;
}) {
  // S2-7: an in-product two-step confirm (state what's kept) replaces window.confirm's generic prompt.
  const [confirming, setConfirming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const scoredDates = new Set(scores.map((s) => s.date));
  const sessionsToGo = block.days.filter(
    (d) => d.date >= today && d.durationMin > 0 && !scoredDates.has(d.date)
  ).length;
  // Chunking lifted here (was inside BlockCalendar) so the header + week strip and the calendar all read
  // from one source. weeklyMinutes drives both the volume-derived week character and the strip's target.
  const sortedDays = [...block.days].sort((a, b) => a.date.localeCompare(b.date));
  const weeks: CurrentBlock["days"][] = [];
  for (let i = 0; i < sortedDays.length; i += 7) weeks.push(sortedDays.slice(i, i + 7));
  const weeklyMinutes = weeks.map((w) => w.reduce((s, d) => s + d.durationMin, 0));
  const characters = weekCharacters(weeklyMinutes);
  const character = characters[weekOfBlock - 1] ?? "";
  const nextSession = sortedDays.find((d) => d.date > today && d.durationMin > 0) ?? null;
  const nextWhen = nextSession ? relDay(nextSession.date, today) : "";
  // Week strip (masterplan §6): actual vs planned over the SAME current-block-week window (the 7-day
  // slice), so hours-vs-target share one window and don't trip ban-list §10.7. Avg HRV / avg sleep from
  // the old "This week" panel are intentionally dropped — their home is Today's readiness (Constitution §4).
  const curWeek = weeks[weekOfBlock - 1] ?? [];
  const winStart = curWeek[0]?.date;
  const winEnd = curWeek[curWeek.length - 1]?.date;
  const weekActs =
    sync && winStart && winEnd ? sync.activities.filter((a) => a.date >= winStart && a.date <= winEnd) : [];
  const weekActualHours = weekActs.reduce((s, a) => s + a.movingTimeSec, 0) / 3600;
  const weekPlannedHours = (weeklyMinutes[weekOfBlock - 1] ?? 0) / 60;
  const weekLoad = weekActs.reduce((s, a) => s + (a.trainingLoad ?? 0), 0);
  const weekTop = [...weekActs].sort((a, b) => (b.trainingLoad ?? 0) - (a.trainingLoad ?? 0))[0];
  return (
    <HeroSurface accent="cyan">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Active block</h2>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff] dark:ring-1 dark:ring-[#00d4ff]/30">
                {block.lengthWeeks}w
              </span>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {block.startDate} → {block.endDate}
            </p>
            {daysRemaining > 0 ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <span>Week {weekOfBlock} of {block.lengthWeeks}</span>
                {character && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="uppercase tracking-wide text-zinc-600 dark:text-zinc-300">{character}</span>
                    <InfoDot text="Characterised by this week's planned volume relative to the block — not a prescribed periodization phase." />
                  </>
                )}
                <span aria-hidden>·</span>
                <span>{sessionsToGo} session{sessionsToGo === 1 ? "" : "s"} to go</span>
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">finished</p>
            )}
            {nextSession && (
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                next: <span className="text-zinc-700 dark:text-zinc-300">{nextSession.name}</span>, {nextWhen}
              </p>
            )}
            <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500 dark:text-zinc-400">
              This block targets:{" "}
              <span className="text-zinc-700 dark:text-zinc-300">{block.goal.split("\n")[0]}</span>
            </p>
          </div>
          {onDelete && (
            confirming ? (
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Delete the plan — ridden history and scores are kept.
                </span>
                <button
                  onClick={() => {
                    setConfirming(false);
                    onDelete();
                  }}
                  className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                >
                  Yes, delete
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="relative shrink-0" onMouseLeave={() => setMenuOpen(false)}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                  aria-label="Block actions"
                  onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}
                  className="rounded-md px-2.5 py-1.5 text-sm font-semibold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  …
                </button>
                {menuOpen && (
                  // No margin-top: top-full already sits flush against the trigger's bottom edge.
                  // A gap here (e.g. mt-1) is real empty space neither element's box covers, so the
                  // mouse crossing it on the way to a menu item fires this wrapper's onMouseLeave and
                  // closes the menu before the click lands — reported live as "the delete button
                  // disappears after I try to click it."
                  // UXA-36: role="menu"/"menuitem" imply arrow-key/Home/End navigation per the
                  // WAI-ARIA menu pattern, which this single-item disclosure never implemented —
                  // plain markup instead of promising semantics it doesn't deliver.
                  <div className="absolute right-0 top-full z-30 w-40 rounded-md border border-zinc-200 bg-white py-1 shadow-md dark:border-zinc-700 dark:bg-zinc-900">
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        setConfirming(true);
                      }}
                      onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}
                      className="block w-full px-3 py-1.5 text-left text-xs font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      Delete block…
                    </button>
                  </div>
                )}
              </div>
            )
          )}
        </div>
        <BlockCalendar
          weeks={weeks}
          characters={characters}
          scores={scores}
          compromisedDates={compromisedDates}
          partialDates={partialDates}
          completedDates={completedDates}
          blockEndDate={block.endDate}
        />
        {daysRemaining > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">This week</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <StatTile label="Hours vs target" value={`${weekActualHours.toFixed(1)} / ${weekPlannedHours.toFixed(1)} h`} />
              {weekLoad > 0 && <StatTile label="Load" value={String(Math.round(weekLoad))} />}
            </div>
            {weekTop && (
              <div className="mt-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Top session</p>
                <p className="mt-0.5 text-sm font-medium leading-snug text-zinc-800 dark:text-zinc-100">{weekTop.name}</p>
                {weekTop.trainingLoad != null && (
                  <p className="mt-0.5 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{weekTop.trainingLoad} Load</p>
                )}
              </div>
            )}
          </div>
        )}
        {block.overview && <BlockOverview text={block.overview} />}
    </HeroSurface>
  );
}
