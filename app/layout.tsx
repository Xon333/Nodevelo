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
                  tooltips show fully in the margin. Vertical (top-full dropdowns) stays visible. */}
              <main id="main-content" className="mx-auto w-full max-w-5xl px-4 py-5 pb-24 max-sm:overflow-x-clip sm:py-8 sm:pb-8">{children}</main>
            </div>
          </SyncProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
