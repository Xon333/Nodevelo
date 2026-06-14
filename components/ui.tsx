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
        accentTop ? "dark:[border-top-color:rgba(0,255,136,0.4)]" : ""
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
      <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-800 dark:text-[#00ff88]">
        {value}
        {arrow ? <span className="text-[10px] font-normal opacity-60">{arrow}</span> : null}
      </p>
    </div>
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
