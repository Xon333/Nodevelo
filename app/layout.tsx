import type { Metadata } from "next";
import { Chakra_Petch, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import Nav from "@/components/Nav";

// Unified UI face — techno/cyber character, readable across the whole app.
const chakra = Chakra_Petch({
  variable: "--font-chakra",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
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
    <html
      lang="en"
      className={`${chakra.variable} ${jetbrains.variable} ${warriot.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Nav />
        {/* Reserve space for the fixed right rail on desktop; bottom bar on mobile */}
        <div className="sm:pr-44">
          <main className="mx-auto w-full max-w-5xl px-4 py-5 pb-24 sm:py-8 sm:pb-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
