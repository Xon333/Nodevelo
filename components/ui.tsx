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
        accentTop ? "dark:[border-top-color:rgba(255, 73, 200,0.4)]" : ""
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
export function StatTile({ label, value, arrow }: { label: string; value: string; arrow?: string }) {
  return (
    <div className="rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-800 dark:text-[#ff49c8]">
        {value}
        {arrow ? <span className="text-[10px] font-normal opacity-60">{arrow}</span> : null}
      </p>
    </div>
  );
}

// Cyberpunk decoration layer (corner brackets + subtle scanlines) to drop inside a
// `relative` card. Accents show in dark mode only; light mode stays utilitarian.
// Inspired by nyxui's cyberpunk-card, but static (no JS) to keep the app fast.
// Place BEFORE the content and wrap content in `relative z-10` so it sits on top.
export function CyberFrame() {
  const corner = "pointer-events-none absolute h-3 w-3 border-zinc-300 dark:border-[#ff49c8]/70";
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 hidden rounded-lg dark:block"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, rgba(255, 73, 200,0.04) 0px, rgba(255, 73, 200,0.04) 1px, transparent 1px, transparent 3px)",
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
