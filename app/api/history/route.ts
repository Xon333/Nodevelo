import { NextResponse } from "next/server";
import { readBlockHistory, updateBlockHistory } from "@/lib/data-store";
import { logError } from "@/lib/log";
import { markRetroSeedsApproved, retroFileId } from "@/lib/kb-loader";

export async function GET() {
  try {
    const history = await readBlockHistory();
    return NextResponse.json(history);
  } catch {
    return NextResponse.json({ error: "Couldn't load block history." }, { status: 502 });
  }
}

// Phase 1 adoption: the ONE explicit action that lets a closed block's proposed lessons influence
// another block — flips `seeds_approved:` on the retro markdown and stamps reflectionsApprovedAt
// on the entry. FAILURE-SAFE by construction:
//   * the retro filename is DERIVED from the entry itself — a caller cannot omit it, so neither
//     adoption channel can be silently skipped;
//   * the flip runs BEFORE the stamp and both steps are idempotent: a crash between them leaves at
//     most "flipped but unstamped", which a retry CONVERGES out of (no 409 dead-end);
//   * a missing/malformed retro file means NOTHING was stamped, so adoption cannot claim success
//     without a real, writable frontmatter gate.
export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    const b = (body ?? {}) as Record<string, unknown>;
    const id = typeof b.id === "string" ? b.id : "";
    if (!id) return NextResponse.json({ error: "History entry id required." }, { status: 400 });

    const target = (await readBlockHistory()).find((e) => e.id === id);
    if (!target) return NextResponse.json({ error: "No such history entry." }, { status: 404 });

    const approved = await markRetroSeedsApproved(`${retroFileId(target.startDate, target.goal)}.md`);
    if (!approved) {
      return NextResponse.json({ error: "Couldn't approve retrospective seeds." }, { status: 409 });
    }

    let alreadyAdopted = false;
    const updated = await updateBlockHistory((entries) =>
      entries.map((e) => {
        if (e.id !== id) return e;
        if (e.reflectionsApprovedAt) {
          alreadyAdopted = true;
          return e;
        }
        return { ...e, reflectionsApprovedAt: new Date().toISOString() };
      })
    );
    if (!updated.some((e) => e.id === id)) {
      // The entry vanished between the read and the lock — nothing was adopted.
      return NextResponse.json({ error: "No such history entry." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...(alreadyAdopted ? { alreadyAdopted: true } : {}) });
  } catch (err) {
    logError("/api/history", "adopt", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Couldn't record the adoption." }, { status: 502 });
  }
}
