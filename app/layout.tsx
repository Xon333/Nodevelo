import type { Metadata } from "next";
import { Chakra_Petch, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import Nav from "@/components/Nav";
import SyncNotice from "@/components/SyncNotice";
import { SyncProvider } from "@/components/SyncProvider";
import QueryProvider from "@/components/QueryProvider";

// Unified UI face — techno/cyber character, readable across the whole app.
const chakra = Chakra_Petch({
  variable: "--font-chakra",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Mono face for numeric/data values.
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

// Display face for the NodeVelo wordmark only.
const warriot = localFont({
  src: "./fonts/WarriotTechItalic.ttf",
  variable: "--font-warriot",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NodeVelo",
  description: "AI-powered training block generator on top of Intervals.icu.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the head script below adds `.dark` before React hydrates; React
    // must accept the DOM class rather than patch it back to the server-rendered one.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${chakra.variable} ${jetbrains.variable} ${warriot.variable} h-full antialiased`}
    >
      <head>
        {/* Theme before first paint (UX S1-5): dark is the canonical theme, and the old
            useEffect-applied class flashed light on every load. Runs synchronously during HTML
            parsing — same sources as Nav's DarkToggle (localStorage "theme", else OS preference). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("theme");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full">
        {/* UXA-17: skip link — the nav (up to 10 focusable stops on desktop) precedes main in DOM
            order with no bypass; visually hidden until focused. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-zinc-900 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white dark:focus:bg-zinc-100 dark:focus:text-zinc-900"
        >
          Skip to content
        </a>
        <QueryProvider>
          <SyncProvider>
            <Nav />
            <SyncNotice />
            {/* Reserve space for the fixed left rail on desktop; bottom bar on mobile */}
            <div className="sm:pl-44">
              {/* Mobile: clip horizontal overflow so a hover tooltip near the right edge (not even
                  touch-triggerable) can't create page-wide horizontal scroll. Desktop is unaffected —
                  tooltips show fully in the margin. Vertical (top-full dropdowns) stays visible.
                  UXA-33: no mx-auto — the rail is `fixed` (pinned to the true viewport edge, outside
                  this div's layout flow), so centering content within this div's padded remainder
                  left it floating detached from the rail. A first fix (fixed-step max-w-5xl /
                  2xl:max-w-[1400px]) only reduced the problem: still a flat pixel cap that doesn't
                  scale with the viewport, so any monitor wider than ~1536-1920px (most desktop
                  monitors today) still showed several hundred px of dead space on the right.
                  Fluid cap instead: 92% of the available width (after the rail), capped at 1800px so
                  it doesn't run unreadably wide on very large displays — scales continuously instead
                  of jumping between a couple of hardcoded steps. sm:-scoped (not applied on mobile,
                  where the rail itself doesn't exist and w-full should fill edge to edge as before). */}
              <main id="main-content" className="w-full px-4 py-5 pb-24 max-sm:overflow-x-clip sm:max-w-[min(92%,1800px)] sm:py-8 sm:pb-8">{children}</main>
            </div>
          </SyncProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
