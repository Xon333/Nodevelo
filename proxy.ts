// Next.js 16 Proxy (formerly `middleware.ts`, renamed in v16 — see node_modules/next/dist/docs).
// Single enforcement point for the same-origin guard (CR-D) so no individual route can forget it.
// The policy itself lives in lib/csrf.ts (pure + unit-tested); this is the thin header-reading shell.
import { NextResponse, type NextRequest } from "next/server";
import { isForbiddenCrossSiteWrite } from "@/lib/csrf";

export function proxy(request: NextRequest): NextResponse | undefined {
  if (
    isForbiddenCrossSiteWrite(
      request.method,
      request.headers.get("origin"),
      request.headers.get("host")
    )
  ) {
    return NextResponse.json(
      { error: "Cross-site request blocked: this API only accepts same-origin requests." },
      { status: 403 }
    );
  }
  // Returning nothing lets the request continue to the route handler.
}

// Guard every API route. All mutating endpoints live under /api, and the safe-method exemption in
// the guard keeps GET reads (the TanStack Query state load, /api/export) unaffected.
export const config = {
  matcher: "/api/:path*",
};
