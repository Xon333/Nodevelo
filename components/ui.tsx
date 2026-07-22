"use client";

// Shared presentational primitives so cards, stat tiles, and dividers look
// identical across the dashboard, trends, and profile pages.

import { useEffect, useId, type ButtonHTMLAttributes, type ReactNode } from "react";

// One-line explanation shown on hover/focus over a metric/title. `align` flips the tooltip to the
// right edge so it doesn't clip when the anchor sits near a container's right. Wrap the trigger
// element in `group relative`; the tip fades in on group-hover AND group-focus-within — hover is
// the mouse accelerator, focus is the keyboard door (UX-CONSTITUTION §6: never hover alone). Give
// the trigger element `tabIndex` (or use InfoDot, whose trigger is a focusable span) and pass `id`
// wired to the trigger's `aria-describedby` so assistive tech gets the text too.
export function MetricTip({ text, align = "left", id }: { text: string; align?: "left" | "right"; id?: string }) {
  return (
    <span
      id={id}
      role="tooltip"
      className={`pointer-events-none absolute ${
        align === "right" ? "right-0" : "left-0"
      } top-full z-30 mt-1 w-64 max-w-[80vw] rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug text-zinc-600 opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300`}
    >
      {text}
    </span>
  );
}

// Small ⓘ affordance next to a label/value — shows a MetricTip on hover or keyboard focus. The
// consistent "what is this number?" hint used across cards, tiles, and stats. The trigger is a
// focusable span, not a `<button>`: InfoDot is nested inside other clickable buttons in several
// call sites, and a `<button>` can't validly contain a `<button>`
// (invalid HTML → a hydration error). `tabIndex` makes it Tab-reachable, `aria-describedby` hands
// the text to assistive tech, and there's no click behavior to lose — the reveal is purely
// hover/focus, so no activation semantics (role="button") are implied.
export function InfoDot({ text, align }: { text: string; align?: "left" | "right" }) {
  const id = useId();
  return (
    <span className="group relative inline-flex align-middle text-zinc-500 dark:text-zinc-400">
      <span
        tabIndex={0}
        aria-label="Explain this metric"
        aria-describedby={id}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        className="cursor-help text-[10px] opacity-60"
      >
        ⓘ
      </span>
      <MetricTip id={id} text={text} align={align} />
    </span>
  );
}

// Fetch-on-mount for a best-effort loader that owns a visible failed state — the other half of the
// LoadFailed convention below. `load` must be a stable useCallback that touches state only after
// its first await (post-microtask), so the effect never sets state synchronously; the same `load`
// doubles as LoadFailed's retry. An optional `refreshKey` re-runs the fetch when it changes (e.g.
// a parent bumps it after a save) — same rules, not just the initial mount.
export function useMountLoad(load: () => Promise<void>, refreshKey?: number) {
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
}

// Quiet degraded-state line for a best-effort slot whose fetch failed (UX-CONSTITUTION §5: failure
// must be distinguishable from absence — a card that silently vanishes hides breakage). Renders in
// the slot the content would have occupied; `retry` re-runs the fetch.
export function LoadFailed({ what, retry }: { what: string; retry?: () => void }) {
  return (
    <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
      <span className="mr-1.5 text-amber-600 dark:text-amber-400" aria-hidden>
        ⚠
      </span>
      Couldn&apos;t load {what}.
      {retry && (
        <button onClick={retry} className="ml-1.5 font-medium text-cyan-700 hover:underline dark:text-[#00d4ff]">
          Retry
        </button>
      )}
    </p>
  );
}

// Pulsing placeholder block for a pending fetch (UX-CONSTITUTION §8: loading holds layout — content
// must not jump on resolve). S3-1's replacement for the bare centered "Loading…" line. Surface
// tokens only (DESIGN.md §1): light `bg-zinc-100` reads as a quiet card-to-be on the zinc-50 page,
// dark `bg-zinc-800` is the card surface against zinc-950. Size each block roughly to the content
// it stands in for via `className` (`h-44`, `lg:h-96`, `w-36`, …) — approximate footprint, not
// pixel-perfect mimicry.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800 ${className ?? ""}`} />;
}

// Wrapper for a skeleton screen: one polite "Loading" announcement for assistive tech in place of
// the old visible text (the Skeleton blocks themselves are aria-hidden decoration). Layout classes
// pass through so the wrapper can mirror the resolved page's scaffold (`space-y-3`, grids, …).
export function SkeletonScreen({
  label = "Loading",
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-label={label} className={className}>
      {children}
    </div>
  );
}

// Eyebrow-titled surface card (muted title + optional right-aligned hint/action + optional ⓘ hover tip).
// `action` is a right-aligned ReactNode (an Edit link, a small button) for the title row; `hint` is
// the muted micro-text variant. Both sit on the right; title (or a spacer) holds the left.
export function Card({
  title,
  hint,
  tip,
  action,
  accentTop,
  className,
  children,
}: {
  title?: string;
  hint?: string;
  tip?: string;
  action?: ReactNode;
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
      {(title || hint || action) && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          {title ? (
            <h2 className="flex items-center gap-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              {title}
              {tip && <InfoDot text={tip} />}
            </h2>
          ) : (
            <span />
          )}
          {(hint || action) && (
            <div className="flex shrink-0 items-center gap-2">
              {hint && <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{hint}</span>}
              {action}
            </div>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

// UXA-11: DESIGN.md §2 documents primary actions as pink-outline in dark mode (Nav's Sync,
// BlockGenerator's Generate) — but every Settings/Profile/Knowledge Save button independently
// drifted to an inverted solid-zinc treatment instead, in three different sizes. This is the one
// documented convention; sweep remaining call sites onto it as they're touched. Exported as a class
// string too, for the one call site (BackupRestore's Export, an `<a download>`) that isn't a `<button>`.
export const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:border dark:border-[#ff49c8]/50 dark:bg-transparent dark:text-[#ff49c8] dark:hover:bg-[#ff49c8]/10 dark:disabled:border-zinc-600 dark:disabled:text-zinc-500 dark:disabled:bg-transparent";

export function PrimaryButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`${PRIMARY_BUTTON_CLASS} ${className ?? ""}`} />;
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
      <p className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
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

// UXA-32: the neon hero shell (border + glow + CyberFrame corner/scanline decoration) — DESIGN.md §4
// reserves this for the one emphasized surface per view. Extracted out of Zone's `hero` branch so it
// can be composed directly by surfaces that need the shell without Zone's own rank+title header (e.g.
// CurrentBlockSection in dashboard/plan.tsx) — previously hand-copied instead, which is how
// BlockTimeline ended up wearing it incorrectly (UXA-12: a hero shell copy-pasted into a section that
// was never meant to have one).
export function HeroSurface({
  accent = "cyan",
  className,
  children,
}: {
  accent?: "cyan" | "pink";
  className?: string;
  children: ReactNode;
}) {
  const heroAccent =
    accent === "pink"
      ? "dark:border-[#ff49c8]/55 dark:shadow-[0_0_28px_-8px_rgba(255,73,200,0.45)]"
      : "dark:border-[#00d4ff]/55 dark:shadow-[0_0_28px_-8px_rgba(0,212,255,0.45)]";
  return (
    <section className={`relative rounded-none border-2 border-zinc-300 bg-white px-4 py-3 dark:bg-zinc-900 ${heroAccent} ${className ?? ""}`}>
      <CyberFrame accent={accent} />
      <div className="relative z-10">{children}</div>
    </section>
  );
}

// Ranked section wrapper for the command-center layout. A numbered badge + eyebrow
// title establishes the priority path (visual hierarchy); `hero` promotes it to a
// cyber-framed card (cyan by default, pink via `accent`) for the most important zones.
export function Zone({
  rank,
  title,
  hint,
  hero,
  accent = "cyan",
  className,
  children,
}: {
  rank?: number;
  title: string;
  hint?: string;
  hero?: boolean;
  accent?: "cyan" | "pink";
  className?: string;
  children: ReactNode;
}) {
  const header = (
    <div className="mb-2 flex items-center gap-2">
      {rank != null && (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600 dark:bg-synced/15 dark:text-synced">
          {rank}
        </span>
      )}
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h2>
      {hint && <span className="ml-auto text-[10px] text-zinc-500 dark:text-zinc-400">{hint}</span>}
    </div>
  );
  if (hero) {
    return (
      <HeroSurface accent={accent} className={className}>
        {header}
        {children}
      </HeroSurface>
    );
  }
  return (
    <section className={`rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800 ${className ?? ""}`}>
      {header}
      {children}
    </section>
  );
}

// Labelled section break (label + rule) for separating page zones.
export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
    </div>
  );
}
