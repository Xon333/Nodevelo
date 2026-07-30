// Single source of "today". The client computes its LOCAL calendar date and sends it to the
// server, which prefers it over its own UTC date — so the two never disagree across the UTC day
// boundary (the bug where an evening ride's local date ≠ the server's UTC date, dropping today's
// analysis). Activities are matched on their local date, so "today" must be local too.

import type { CurrentBlock } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Local calendar date as YYYY-MM-DD (browser-local on the client). Use this for anything the
// client sends as "today" and for client-side "is this today?" comparisons.
export function localToday(d: Date = new Date()): string {
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}

// UTC calendar date — the server's fallback when the client didn't supply its local date.
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// A rolling-window cutoff as YYYY-MM-DD: the UTC calendar date `n` days before `from`. Kept here
// (not inline in components) so the React Compiler's purity check doesn't flag the Date.now()/
// new Date() call during render — the same reason localToday() is a helper rather than inlined.
export function isoDaysAgo(n: number, from: number = Date.now()): string {
  return new Date(from - n * 86_400_000).toISOString().slice(0, 10);
}

// Server-side: prefer a valid client-supplied local date, else fall back to UTC.
export function resolveToday(clientToday: unknown): string {
  return typeof clientToday === "string" && ISO_DATE.test(clientToday) ? clientToday : utcToday();
}

// True once a block's endDate has passed — pure date comparison, deliberately NOT tied to whether every
// session was logged/scored (that could get stuck behind a skipped rest day, a compromised session, or a
// delayed sync). Drives the block-completion prompt in PlannedToday (components/dashboard/today.tsx).
export function isBlockFinished(block: CurrentBlock | null, today: string): boolean {
  return block !== null && today > block.endDate;
}

// Pure calendar-day arithmetic on a YYYY-MM-DD string (local-date semantics; the Date constructor
// normalizes an overflowed day-of-month, so month/year/leap boundaries and DST are all safe).
// For "tomorrow's session" previews and similar day-offset lookups against block days.
export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localToday(new Date(y, m - 1, d + n));
}

// Age in whole years, derived at point of use from a stored date of birth. Deliberately NOT a stored
// `ageYears` number: that silently drifts by one every year and nobody ever revisits it. Both arguments
// are YYYY-MM-DD; returns null on malformed input or an implausible result rather than a wrong number.
export function ageYearsFrom(dateOfBirth: string, today: string): number | null {
  if (!ISO_DATE.test(dateOfBirth) || !ISO_DATE.test(today)) return null;
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}
