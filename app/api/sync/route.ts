import { NextResponse } from "next/server";
import { isIntervalsConfigured, runFullSync, IntervalsApiError } from "@/lib/intervals-api";
import { readCurrentBlock, readLastSync, writeLastSync } from "@/lib/data-store";

// GET returns the cached app state; it never hits Intervals.icu.
export async function GET() {
  const [lastSync, currentBlock] = await Promise.all([readLastSync(), readCurrentBlock()]);
  return NextResponse.json({
    configured: isIntervalsConfigured(),
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    lastSync,
    currentBlock,
  });
}

// POST pulls fresh data from Intervals.icu and caches it in data/last-sync.json.
export async function POST() {
  if (!isIntervalsConfigured()) {
    return NextResponse.json(
      { error: "Intervals.icu is not configured. Set INTERVALS_API_KEY and INTERVALS_ATHLETE_ID in .env.local." },
      { status: 400 }
    );
  }
  try {
    const lastSync = await runFullSync();
    await writeLastSync(lastSync);
    return NextResponse.json({ lastSync });
  } catch (err) {
    const status = err instanceof IntervalsApiError && err.status === 401 ? 401 : 502;
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status });
  }
}
