import { NextResponse } from "next/server";
import { setWorkoutLibraryStatus } from "@/lib/workout-library-service";
import { exportWorkoutLibraryEntry } from "@/lib/workout-library-export";

const ACTIONS = new Set(["retire", "restore", "retry-export"]);

// CSRF is enforced centrally on every /api/* write (proxy.ts) — no per-route check needed here.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const action = (body as Record<string, unknown> | null)?.action;
  if (typeof action !== "string" || !ACTIONS.has(action)) {
    return NextResponse.json({ error: 'action must be "retire", "restore", or "retry-export".' }, { status: 400 });
  }

  try {
    const entry =
      action === "retry-export"
        ? await exportWorkoutLibraryEntry(id)
        : await setWorkoutLibraryStatus(id, action === "retire" ? "retired" : "active");
    if (!entry) return NextResponse.json({ error: "No workout library entry with that id." }, { status: 404 });
    return NextResponse.json({ entry });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Local store failure." }, { status: 500 });
  }
}
