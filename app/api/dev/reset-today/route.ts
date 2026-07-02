import { NextResponse } from "next/server";
import { writeTodayAnalysis } from "@/lib/data-store";

// Dev-only escape hatch: clears today-analysis.json so the next sync recomputes it from scratch.
// Ends the manual "erase the todays page analysis so i can resync" request — call via
// `npm run reset:today` while iterating on sync/scoring logic against a real ride.
export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Dev-only route." }, { status: 403 });
  }
  await writeTodayAnalysis(null);
  return NextResponse.json({ ok: true });
}
