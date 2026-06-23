import { NextResponse } from "next/server";
import { readCalibration, updateCalibration } from "@/lib/data-store";
import { clamp } from "@/lib/stats";

// Contest/correct for the Model page (ROADMAP #2): set or clear a manual override on a calibrated
// scoring parameter. Only `decouplingGood` is a learned CalibratedParameter today; its override must
// stay inside the same sane band deriveDecouplingGood clamps the derived value to, so a bad value
// can't distort scoring. The next sync preserves the override (deriveDecouplingGood reads prior.manualOverride).
const DECOUPLING_BOUNDS = { min: 2.5, max: 8 };

export async function GET() {
  return NextResponse.json({ calibration: await readCalibration() });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  if (b.param !== "decouplingGood") {
    return NextResponse.json({ error: "Unknown calibration parameter." }, { status: 400 });
  }

  // null clears the override (revert to the learned/default value); a finite number sets it, clamped.
  const raw = b.manualOverride;
  let manualOverride: number | null;
  if (raw === null) {
    manualOverride = null;
  } else if (typeof raw === "number" && Number.isFinite(raw)) {
    manualOverride = clamp(raw, DECOUPLING_BOUNDS.min, DECOUPLING_BOUNDS.max);
  } else {
    return NextResponse.json({ error: "manualOverride must be a number or null." }, { status: 400 });
  }

  const calibration = await updateCalibration((cur) => ({
    ...cur,
    decouplingGood: { ...cur.decouplingGood, manualOverride },
    updatedAt: new Date().toISOString(),
  }));

  return NextResponse.json({ calibration });
}
