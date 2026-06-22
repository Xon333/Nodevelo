// Tiny shared numeric helpers (CS-8) — one canonical home so the same rounding / clamp / median isn't
// re-defined across lib modules. Pure + deterministic.

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Median of a numeric list (sorts a copy; even length → mean of the two middles). Caller ensures non-empty.
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
