"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type IconName = "dashboard" | "trends" | "profile" | "settings" | "knowledge";

const LINKS: { href: string; label: string; short: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Dashboard", short: "Home", icon: "dashboard" },
  { href: "/trends", label: "Trends", short: "Trends", icon: "trends" },
  { href: "/profile", label: "Profile", short: "Profile", icon: "profile" },
  { href: "/settings", label: "Settings", short: "Settings", icon: "settings" },
  { href: "/knowledge", label: "Knowledge Base", short: "Docs", icon: "knowledge" },
];

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
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
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

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = stored ? stored === "dark" : prefersDark;
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
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

export default function Nav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <>
      {/* Mobile top bar: brand + toggle only (tabs live in the bottom bar) */}
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur sm:hidden dark:border-zinc-700 dark:bg-zinc-900/90">
        <div className="flex items-center justify-between px-4 py-3">
          <Link
            href="/dashboard"
            className="font-[family-name:var(--font-warriot)] text-xl tracking-wide text-zinc-900 dark:bg-gradient-to-r dark:from-[#ff49c8] dark:to-[#00d4ff] dark:bg-clip-text dark:text-transparent dark:[filter:drop-shadow(0_0_8px_rgba(255,73,200,0.35))]"
          >
            NodeVelo
          </Link>
          <DarkToggle />
        </div>
      </header>

      {/* Desktop: vertical nav rail pinned to the right edge */}
      <aside className="no-print fixed right-0 top-0 z-40 hidden h-full w-44 flex-col border-l border-zinc-200 bg-white/90 backdrop-blur sm:flex dark:border-zinc-700 dark:bg-zinc-900/90">
        <Link
          href="/dashboard"
          className="font-[family-name:var(--font-warriot)] px-4 py-5 text-2xl tracking-wide text-zinc-900 dark:bg-gradient-to-r dark:from-[#ff49c8] dark:to-[#00d4ff] dark:bg-clip-text dark:text-transparent dark:[filter:drop-shadow(0_0_8px_rgba(255,73,200,0.35))]"
        >
          NodeVelo
        </Link>
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive(link.href)
                  ? "bg-zinc-900 text-white dark:bg-[#ff49c8]/10 dark:text-[#ff49c8] dark:ring-1 dark:ring-[#ff49c8]/40"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              }`}
            >
              <Icon name={link.icon} className="h-4 w-4 shrink-0" />
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-zinc-200 px-3 py-4 dark:border-zinc-700">
          <DarkToggle />
        </div>
      </aside>

      {/* Bottom tab bar: mobile only */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)] sm:hidden dark:border-zinc-700 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-5xl items-stretch justify-around">
          {LINKS.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                  active
                    ? "text-zinc-900 dark:text-[#ff49c8]"
                    : "text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300"
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
