"use client";

import { useSync } from "./SyncProvider";
import TodayView from "./dashboard/TodayView";
import PlanView from "./dashboard/PlanView";
import { Skeleton, SkeletonScreen } from "./ui";

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
    // S3-1: skeletons sized to each page's first-paint scaffold (Today: verdict zone → session/
    // column grid; Plan: season strip → block hero → goals/debrief row → generator bar), so the
    // resolved layout lands in reserved space instead of jumping down from a one-line "Loading…".
    return mode === "today" ? (
      <SkeletonScreen className="flex flex-col gap-3">
        <Skeleton className="h-44" />
        <div className="grid gap-3 lg:grid-cols-[1.7fr_1fr]">
          <Skeleton className="h-72 lg:h-96" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-44" />
            <Skeleton className="h-28" />
          </div>
        </div>
      </SkeletonScreen>
    ) : (
      <SkeletonScreen className="space-y-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-80" />
        <div className="grid gap-3 sm:grid-cols-[1.7fr_1fr]">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
        <Skeleton className="h-10" />
      </SkeletonScreen>
    );
  }

  return mode === "today" ? <TodayView /> : <PlanView />;
}
