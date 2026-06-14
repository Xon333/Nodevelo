// Shared presentational primitives so cards, stat tiles, and dividers look
// identical across the dashboard, trends, and profile pages.

import type { ReactNode } from "react";

// Eyebrow-titled surface card (muted title + optional right-aligned hint).
export function Card({
  title,
  hint,
  accentTop,
  className,
  children,
}: {
  title?: string;
  hint?: string;
  accentTop?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800 ${
        accentTop ? "dark:[border-top-color:rgba(255,73,200,0.4)]" : ""
      } ${className ?? ""}`}
    >
      {(title || hint) && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          {title && <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{title}</h2>}
          {hint && <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{hint}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

// Compact metric chip: muted label, mono value, optional trend arrow.
// accent controls the value colour in dark mode: plain (white), pink (primary
// highlight), or cyan (synced/secondary). Trend arrows are always cyan.
export function StatTile({
  label,
  value,
  arrow,
  accent = "plain",
}: {
  label: string;
  value: string;
  arrow?: string;
  accent?: "plain" | "pink" | "cyan";
}) {
  const valueColor =
    accent === "pink"
      ? "text-zinc-800 dark:text-[#ff49c8]"
      : accent === "cyan"
        ? "text-zinc-800 dark:text-[#00d4ff]"
        : "text-zinc-800 dark:text-zinc-100";
  return (
    <div className="rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className={`mt-0.5 font-mono text-sm font-semibold ${valueColor}`}>
        {value}
        {arrow ? <span className="ml-0.5 text-[10px] font-normal text-cyan-600 dark:text-[#00d4ff]">{arrow}</span> : null}
      </p>
    </div>
  );
}

// Cyberpunk decoration layer (corner brackets + scanlines + a top data-stream line)
// to drop inside a `relative` card. Accents show in dark mode only; light mode stays
// utilitarian. Adapted from nyxui's cyberpunk-card, but static (no JS) to stay fast.
// Place BEFORE the content and wrap content in `relative z-10` so it sits on top.
export function CyberFrame({ accent = "pink" }: { accent?: "pink" | "cyan" }) {
  const isCyan = accent === "cyan";
  // Both literal class strings must exist in source for Tailwind to emit them.
  const corner = isCyan
    ? "pointer-events-none absolute h-3 w-3 border-zinc-300 dark:border-[#00d4ff]/70"
    : "pointer-events-none absolute h-3 w-3 border-zinc-300 dark:border-[#ff49c8]/70";
  const rgb = isCyan ? "0,212,255" : "255,73,200";
  return (
    <>
      {/* data-stream top line (cloned from nyxui cyberpunk-card) */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-0 hidden h-px dark:block"
        style={{ background: `linear-gradient(to right, transparent, rgba(${rgb},0.85), transparent)` }}
      />
      {/* scanlines */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 hidden rounded-none dark:block"
        style={{
          backgroundImage: `repeating-linear-gradient(to bottom, rgba(${rgb},0.04) 0px, rgba(${rgb},0.04) 1px, transparent 1px, transparent 3px)`,
        }}
      />
      <span aria-hidden className={`${corner} left-0 top-0 border-l-2 border-t-2`} />
      <span aria-hidden className={`${corner} right-0 top-0 border-r-2 border-t-2`} />
      <span aria-hidden className={`${corner} bottom-0 left-0 border-b-2 border-l-2`} />
      <span aria-hidden className={`${corner} bottom-0 right-0 border-b-2 border-r-2`} />
    </>
  );
}

// Labelled section break (label + rule) for separating page zones.
export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{label}</span>
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
    </div>
  );
}
