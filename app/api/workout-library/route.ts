import { NextResponse } from "next/server";
import { readWorkoutLibrary } from "@/lib/data-store";
import { promoteWorkoutManually, type PromotionRejectReason } from "@/lib/workout-library-service";
import { exportWorkoutLibraryEntry } from "@/lib/workout-library-export";

export async function GET() {
  const { entries } = await readWorkoutLibrary();
  return NextResponse.json({ entries });
}

// CSRF is enforced centrally on every /api/* write (proxy.ts) — no per-route check needed here.
const REJECT_STATUS: Record<PromotionRejectReason, number> = {
  "day-not-found": 404,
  "not-scored": 400,
  "not-completed": 400,
  "unsupported-type": 400,
  retired: 400,
  "protocol-invalid": 400,
};

const REJECT_MESSAGE: Record<PromotionRejectReason, string> = {
  "day-not-found": "No prescribed workout was found for that date.",
  "not-scored": "That session hasn't been scored yet.",
  "not-completed": "That session's disposition is partial, missed, or compromised — it can't be promoted.",
  "unsupported-type": "Only Threshold, VO2max, SIT, and RaceSim sessions can be promoted.",
  retired: "This prescription was retired — restore it instead of re-promoting.",
  "protocol-invalid": "This prescription doesn't pass current protocol validation.",
};

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
  if (!date) return NextResponse.json({ error: "A valid date is required." }, { status: 400 });

  let result;
  try {
    result = await promoteWorkoutManually(date);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Local store failure." }, { status: 500 });
  }

  if (!result.ok) {
    return NextResponse.json({ error: REJECT_MESSAGE[result.reason] }, { status: REJECT_STATUS[result.reason] });
  }

  // exportWorkoutLibraryEntry has already persisted synced/failed state locally before returning —
  // if remote export fails, the entry it returns is still active with intervalsExport.status "failed",
  // so the athlete sees a usable local entry rather than an error for something that locally succeeded.
  const exported = await exportWorkoutLibraryEntry(result.entry.id);
  return NextResponse.json({ entry: exported ?? result.entry });
}
