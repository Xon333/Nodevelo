// Single source of "today". The client computes its LOCAL calendar date and sends it to the
// server, which prefers it over its own UTC date — so the two never disagree across the UTC day
// boundary (the bug where an evening ride's local date ≠ the server's UTC date, dropping today's
// analysis). Activities are matched on their local date, so "today" must be local too.

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

// Server-side: prefer a valid client-supplied local date, else fall back to UTC.
export function resolveToday(clientToday: unknown): string {
  return typeof clientToday === "string" && ISO_DATE.test(clientToday) ? clientToday : utcToday();
}
