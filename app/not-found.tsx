import Link from "next/link";

// UXA-49: previously fell through to Next's default 404 (blank, unbranded, no way back into the
// app) — matches error.tsx's tone/shell instead of a dead end.
export default function NotFound() {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-5 py-6 dark:border-zinc-700 dark:bg-zinc-800">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Page not found</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        There&apos;s nothing here. The link may be stale, or the page moved.
      </p>
      <Link
        href="/today"
        className="mt-4 inline-block rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        Back to Today
      </Link>
    </div>
  );
}
