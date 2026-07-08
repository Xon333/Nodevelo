"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/client-api";
import { useSync } from "./SyncProvider";

type IconName = "today" | "plan" | "trends" | "profile" | "model" | "settings" | "knowledge";
type NavTier = "primary" | "coach" | "system";

// Tiered rail (UX-MASTERPLAN v2 §3): the daily trio renders full-weight; the rare tier renders
// smaller under group labels. `mobileTab: false` keeps a link out of the mobile bottom bar
// (mobile restructure is deferred; Model still rides the top-bar brain icon there).
const LINKS: { href: string; label: string; short: string; icon: IconName; tier: NavTier; mobileTab?: boolean }[] = [
  { href: "/today", label: "Today", short: "Today", icon: "today", tier: "primary" },
  { href: "/plan", label: "Plan", short: "Plan", icon: "plan", tier: "primary" },
  { href: "/trends", label: "Trends", short: "Trends", icon: "trends", tier: "primary" },
  { href: "/profile", label: "Profile", short: "Profile", icon: "profile", tier: "coach" },
  { href: "/model", label: "Model", short: "Model", icon: "model", tier: "coach", mobileTab: false },
  { href: "/settings", label: "Settings", short: "Settings", icon: "settings", tier: "system" },
  { href: "/knowledge", label: "Knowledge", short: "Knowledge", icon: "knowledge", tier: "system" },
];

const TIER_LABELS: Record<Exclude<NavTier, "primary">, string> = {
  coach: "You & the coach",
  system: "System",
};

function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "today":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="1.6" />
        </svg>
      );
    case "plan":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="17" rx="2" />
          <path d="M3 9h18M8 2v4M16 2v4" />
        </svg>
      );
    case "trends":
      return (
        <svg {...common}>
          <path d="M3 17l5-5 4 3 6-7" />
          <path d="M21 8v4h-4" />
        </svg>
      );
    case "profile":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
        </svg>
      );
    case "model":
      // A brain: two bumpy hemispheres meeting at a central fold.
      return (
        <svg {...common}>
          <path d="M12 5C10.8 4.2 9 4.6 8.5 6 7 5.8 5.8 7 6.2 8.4 5 9 5 10.8 6.2 11.4 5.4 12.4 5.8 14 7.2 14.2 7.2 15.6 8.6 16.4 10 16 10.4 16.8 11.2 17 12 16.8" />
          <path d="M12 5C13.2 4.2 15 4.6 15.5 6 17 5.8 18.2 7 17.8 8.4 19 9 19 10.8 17.8 11.4 18.6 12.4 18.2 14 16.8 14.2 16.8 15.6 15.4 16.4 14 16 13.6 16.8 12.8 17 12 16.8" />
          <path d="M12 5v11.8" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
        </svg>
      );
    case "knowledge":
      return (
        <svg {...common}>
          <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
          <path d="M4 19a2 2 0 0 1 2-2h13" />
        </svg>
      );
  }
}

function DarkToggle() {
  const [dark, setDark] = useState(false);

  // The pre-paint inline script in app/layout.tsx applies the theme class before hydration
  // (UX S1-5 — no more light flash); this only syncs the toggle's glyph to the class already on
  // <html>. Server HTML renders the light glyph, so a lazy initializer would trip a hydration
  // mismatch — correcting one glyph post-hydration is invisible since the page itself painted in
  // the right theme.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time sync to the class the layout script set pre-paint; see comment above
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <button
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded-md px-2 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      {dark ? "☀" : "☾"}
    </button>
  );
}

// Sync control, shared from SyncProvider so it can live in the nav (freeing page space).
// `compact` is the mobile icon-only variant; the rail variant shows status + last-synced.
function SyncControl({ compact }: { compact?: boolean }) {
  const { state, syncing, syncError, loadError, analyzing, syncWarnings, doSync } = useSync();
  if (!state?.configured) return null;

  // Persistent status hint on the button. The detail + Retry live in the dismissible SyncNotice
  // banner; this dot keeps "last sync had an issue" visible afterwards — and gives mobile (the
  // icon-only button) the indicator it never had. Hidden while syncing (the spinner is the signal).
  const notice: "error" | "warn" | null = syncError || loadError ? "error" : syncWarnings.length ? "warn" : null;
  const dotColor = notice === "error" ? "bg-red-500" : "bg-amber-500";
  const title =
    notice === "error"
      ? "Last sync had a problem — click to retry"
      : notice === "warn"
        ? `Last sync finished with ${syncWarnings.length} warning${syncWarnings.length === 1 ? "" : "s"}`
        : "Sync Intervals.icu";

  if (compact) {
    return (
      <button
        onClick={() => void doSync()}
        disabled={syncing}
        aria-label="Sync Intervals.icu"
        title={title}
        className="relative rounded-md px-2 py-1.5 text-base text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <span className={`inline-block ${syncing ? "animate-spin" : ""}`}>⟳</span>
        {notice && !syncing && <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden />}
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => void doSync()}
        disabled={syncing}
        title={title}
        className="relative flex w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:border dark:border-[#ff49c8]/50 dark:bg-transparent dark:text-[#ff49c8] dark:hover:bg-[#ff49c8]/10"
      >
        <span className={`inline-block ${syncing ? "animate-spin" : ""}`}>⟳</span>
        {syncing ? "Syncing…" : "Sync"}
        {notice && !syncing && <span className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden />}
      </button>
      <p className="mt-1 text-center text-[10px] text-zinc-500 dark:text-zinc-400">
        {analyzing
          ? "analysing today's ride…"
          : state.lastSync?.syncedAt
            ? `synced ${timeAgo(state.lastSync.syncedAt)}`
            : "never synced"}
      </p>
    </div>
  );
}

export default function Nav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <>
      {/* Mobile top bar: brand + toggle only (tabs live in the bottom bar) */}
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur sm:hidden dark:border-zinc-700 dark:bg-zinc-900/90">
        <div className="flex items-center justify-between px-4 py-3">
          <Link
            href="/today"
            className="font-[family-name:var(--font-warriot)] text-xl tracking-wide text-zinc-900 dark:bg-gradient-to-r dark:from-[#ff49c8] dark:to-[#00d4ff] dark:bg-clip-text dark:text-transparent dark:[filter:drop-shadow(0_0_8px_rgba(255,73,200,0.35))]"
          >
            NodeVelo
          </Link>
          <div className="flex items-center gap-1">
            <Link
              href="/model"
              aria-label="Model"
              aria-current={isActive("/model") ? "page" : undefined}
              className={`rounded-md px-2 py-1.5 transition-colors ${
                isActive("/model")
                  ? "text-zinc-900 dark:text-[#ff49c8]"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              }`}
            >
              <Icon name="model" className="h-5 w-5" />
            </Link>
            <SyncControl compact />
            <DarkToggle />
          </div>
        </div>
      </header>

      {/* Desktop: vertical nav rail pinned to the right edge */}
      <aside className="no-print fixed left-0 top-0 z-40 hidden h-full w-44 flex-col border-r border-zinc-200 bg-white/90 backdrop-blur sm:flex dark:border-zinc-700 dark:bg-zinc-900/90">
        <Link
          href="/today"
          className="font-[family-name:var(--font-warriot)] px-4 py-5 text-2xl tracking-wide text-zinc-900 dark:bg-gradient-to-r dark:from-[#ff49c8] dark:to-[#00d4ff] dark:bg-clip-text dark:text-transparent dark:[filter:drop-shadow(0_0_8px_rgba(255,73,200,0.35))]"
        >
          NodeVelo
        </Link>
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {(["primary", "coach", "system"] as const).map((tier) => (
            <div key={tier} className="flex flex-col gap-1">
              {tier !== "primary" && (
                <p className="px-3 pb-0.5 pt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  {TIER_LABELS[tier]}
                </p>
              )}
              {LINKS.filter((l) => l.tier === tier).map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 transition-colors ${
                    tier === "primary" ? "text-sm" : "text-[13px]"
                  } ${
                    isActive(link.href)
                      ? "bg-zinc-900 text-white dark:bg-[#ff49c8]/10 dark:text-[#ff49c8] dark:ring-1 dark:ring-[#ff49c8]/40"
                      : tier === "primary"
                        ? "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  <Icon name={link.icon} className={`shrink-0 ${tier === "primary" ? "h-4 w-4" : "h-3.5 w-3.5"}`} />
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="space-y-2 border-t border-zinc-200 px-3 py-3 dark:border-zinc-700">
          <SyncControl />
          <DarkToggle />
        </div>
      </aside>

      {/* Bottom tab bar: mobile only */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)] sm:hidden dark:border-zinc-700 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-5xl items-stretch justify-around">
          {LINKS.filter((l) => l.mobileTab !== false).map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                  active
                    ? "text-zinc-900 dark:text-[#ff49c8]"
                    : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
                }`}
              >
                <Icon name={link.icon} className={`h-5 w-5 ${active ? "dark:[filter:drop-shadow(0_0_4px_rgba(255,73,200,0.5))]" : ""}`} />
                {link.short}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
