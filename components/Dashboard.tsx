"use client";

import { useSync } from "./SyncProvider";
import TodayView from "./dashboard/TodayView";
import PlanView from "./dashboard/PlanView";

// Thin mode-switch. The two pages it used to inline — a 529-line dual-mode monolith — now live in
// TodayView / PlanView (RV-8), each owning only its own page state. This keeps the shared concern
// (the app-state load guard) in one place and delegates the rest.
export default function Dashboard({ mode = "plan" }: { mode?: "today" | "plan" }) {
  const { state, loadError } = useSync();

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        Failed to load app state: {loadError}
      </div>
    );
  }
  if (!state) {
    return <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
  }

  return mode === "today" ? <TodayView /> : <PlanView />;
}
