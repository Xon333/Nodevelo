import { NextResponse } from "next/server";
import { logError } from "@/lib/log";
import {
  clearPhysiologyObsolete,
  markPhysiologyObsolete,
  readPhysiologyStatus,
} from "@/lib/physiology-freshness";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = (body as Record<string, unknown> | null)?.action;
  try {
    if (action === "mark-obsolete") {
      await markPhysiologyObsolete();
    } else if (action === "clear-obsolete") {
      await clearPhysiologyObsolete();
    } else {
      return NextResponse.json({ error: 'action must be "mark-obsolete" or "clear-obsolete".' }, { status: 400 });
    }

    const { status } = await readPhysiologyStatus();
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    logError("/api/physiology", "update", err);
    return NextResponse.json({ error: "Couldn't update physiology freshness." }, { status: 502 });
  }
}
