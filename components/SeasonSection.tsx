"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/client-api";
import { validateSeasonPlanInput } from "@/lib/season";
import type { SeasonEvent, SeasonPlan } from "@/lib/types";
import { Card, LoadFailed, PrimaryButton, useMountLoad } from "./ui";

type SaveState = { state: "idle" | "saving" | "saved" } | { state: "error"; message: string };

// Season = athlete-owned intent (objective + target events) the macro-periodization engine plans
// around. Lives on /plan since UX v2 (§2 ledger): it's consumed at block-generation time (M4).
// Extracted unchanged from AthleteProfileForm. A load failure must NOT fall back to an empty form
// (S1-3): saving blanks over an unreadable-but-saved season would silently destroy it.
export default function SeasonSection({ onSaved }: { onSaved?: () => void }) {
  const [objective, setObjective] = useState("");
  const [events, setEvents] = useState<SeasonEvent[]>([]);
  const [seasonSaveState, setSeasonSaveState] = useState<SaveState>({ state: "idle" });
  const [seasonLoadFailed, setSeasonLoadFailed] = useState(false);

  const loadSeason = useCallback(async () => {
    try {
      const { plan } = await api<{ plan: SeasonPlan }>("/api/season");
      setObjective(plan.objective);
      setEvents(plan.events);
      setSeasonLoadFailed(false);
    } catch {
      setSeasonLoadFailed(true);
    }
  }, []);

  useMountLoad(loadSeason);

  const updateEvent = (index: number, patch: Partial<SeasonEvent>) => {
    setEvents((evs) => evs.map((e, i) => (i === index ? { ...e, ...patch } : e)));
    if (seasonSaveState.state === "saved") setSeasonSaveState({ state: "idle" });
  };
  const addEvent = () => {
    setEvents((evs) => [...evs, { name: "", date: "", priority: "B" }]);
  };
  const removeEvent = (index: number) => {
    setEvents((evs) => evs.filter((_, i) => i !== index));
  };

  const saveSeason = async () => {
    const parsed = validateSeasonPlanInput({ objective, events });
    if (typeof parsed === "string") {
      setSeasonSaveState({ state: "error", message: parsed });
      return;
    }
    setSeasonSaveState({ state: "saving" });
    try {
      await api("/api/season", { method: "PUT", body: JSON.stringify(parsed) });
      setSeasonSaveState({ state: "saved" });
      const fresh = await api<{ plan: SeasonPlan }>("/api/season");
      setObjective(fresh.plan.objective);
      setEvents(fresh.plan.events);
      onSaved?.();
    } catch (err) {
      setSeasonSaveState({ state: "error", message: err instanceof Error ? err.message : "Couldn't save — try again." });
    }
  };

  return (
    <Card title="Season">
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Your season is the arc the coach periodizes — one line on what you&apos;re chasing, plus any target
        events. Blocks are generated <span className="font-medium">against</span> it.
      </p>
      {seasonLoadFailed ? (
        <LoadFailed what="your season (objective & events)" retry={() => void loadSeason()} />
      ) : (
        // UXA-21: <form> gives Enter-to-submit from any field here.
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveSeason();
          }}
        >
      <label className="block">
        <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
          Objective <span className="font-normal text-zinc-500 dark:text-zinc-400">— the one outcome the whole season serves</span>
        </span>
        <input
          type="text"
          value={objective}
          placeholder="e.g. faster on hilly KOMs — raise FTP + 1–5 min punch"
          onChange={(e) => {
            setObjective(e.target.value);
            if (seasonSaveState.state === "saved") setSeasonSaveState({ state: "idle" });
          }}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
        />
      </label>

      <div className="mt-3 space-y-2">
        {events.map((ev, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2 rounded bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
            <label className="min-w-[10rem] flex-1">
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Name</span>
              <input
                type="text"
                value={ev.name}
                onChange={(e) => updateEvent(i, { name: e.target.value })}
                className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
              />
            </label>
            <label>
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Date</span>
              <input
                type="date"
                value={ev.date}
                onChange={(e) => updateEvent(i, { date: e.target.value })}
                className="mt-1 rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
              />
            </label>
            <label>
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Priority</span>
              <select
                value={ev.priority}
                onChange={(e) => updateEvent(i, { priority: e.target.value as SeasonEvent["priority"] })}
                className="mt-1 rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
              >
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => removeEvent(i)}
              title="Remove this event"
              className="rounded-md border border-red-300 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addEvent}
        className="mt-3 rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
      >
        + Add event
      </button>

      <div className="mt-3 flex items-center gap-3">
        <PrimaryButton type="submit" disabled={seasonSaveState.state === "saving"}>
          {seasonSaveState.state === "saving" ? "Saving…" : "Save"}
        </PrimaryButton>
        {seasonSaveState.state === "saved" && <span role="status" className="text-xs text-green-700 dark:text-green-400">✓ Saved</span>}
        {seasonSaveState.state === "error" && <span role="alert" className="text-xs text-red-600">{seasonSaveState.message}</span>}
      </div>
        </form>
      )}
    </Card>
  );
}
