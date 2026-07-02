import { NextResponse } from "next/server";
import { readCalibration, updateCalibration } from "@/lib/data-store";
import { CARBS_OPTIMUM_BOUNDS, DECOUPLING_GOOD_BOUNDS, defaultParameter } from "@/lib/calibration";
import { clamp } from "@/lib/stats";

// Contest/correct for the Model page (ROADMAP #2): set or clear a manual override on a calibrated
// scoring parameter. Each param's override is clamped into the same sane band its derivation uses, so
// a bad value can't distort what reads it. The next sync preserves overrides (each derive reads
// prior.manualOverride).

const PARAM_BOUNDS = {
  decouplingGood: DECOUPLING_GOOD_BOUNDS,
  carbsOptimum: CARBS_OPTIMUM_BOUNDS,
} as const;
type ParamName = keyof typeof PARAM_BOUNDS;

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

  const param = b.param as ParamName;
  const bounds = typeof param === "string" ? PARAM_BOUNDS[param] : undefined;
  if (!bounds) {
    return NextResponse.json({ error: "Unknown calibration parameter." }, { status: 400 });
  }

  // null clears the override (revert to the learned/default value); a finite number sets it, clamped.
  const raw = b.manualOverride;
  let manualOverride: number | null;
  if (raw === null) {
    manualOverride = null;
  } else if (typeof raw === "number" && Number.isFinite(raw)) {
    manualOverride = clamp(raw, bounds.min, bounds.max);
  } else {
    return NextResponse.json({ error: "manualOverride must be a number or null." }, { status: 400 });
  }

  const calibration = await updateCalibration((cur) => ({
    ...cur,
    // A store written before the param existed parses back with the field undefined — seed a blank.
    [param]: { ...(cur[param] ?? defaultParameter()), manualOverride },
    updatedAt: new Date().toISOString(),
  }));

  return NextResponse.json({ calibration });
}
