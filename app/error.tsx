"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

// Route-segment error boundary: a runtime error in any page (Dashboard, Trends, …) renders this
// fallback instead of white-screening the app. The fixed nav rail (in the root layout, above this
// boundary) stays mounted, so the athlete can navigate away and the data path is untouched.
// NOTE: Next.js 16 passes `unstable_retry`, not `reset` — re-fetches + re-renders the segment.
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="rounded-lg border border-red-200 bg-white px-5 py-6 dark:border-red-900/50 dark:bg-zinc-800">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Something went wrong</h2>
      <p className="mt-1 text-sm text-zinc-500">
        This view hit an unexpected error. Your data is safe — nothing was written. Try again, or
        switch to another page.
      </p>
      {/* UXA-22: the raw message stays reachable (anti-black-box, Constitution §6) but no longer
          shouts — this is the app's one true last-resort screen, so it can't route through the
          coach-voice translation every other error path uses. */}
      {error.message && (
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Technical details
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-zinc-100 px-3 py-2 font-mono text-xs text-red-700 dark:bg-zinc-900 dark:text-red-400">
            {error.message}
            {error.digest ? `\n(digest ${error.digest})` : ""}
          </pre>
        </details>
      )}
      <button
        onClick={() => unstable_retry()}
        className="mt-4 rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        Try again
      </button>
    </div>
  );
}
