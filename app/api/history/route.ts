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

// Retrospective acknowledgement: records review by flipping the legacy `seeds_approved:` field and
// stamping reflectionsApprovedAt. Neither stamp grants deterministic generation authority.
// FAILURE-SAFE by construction:
//   * the retro filename is DERIVED from the entry itself — a caller cannot omit it, so neither
//     acknowledgement store can be silently skipped;
//   * an entry already carrying reflectionsApprovedAt stays a successful no-op retry even if the
//     retrospective file later goes missing or unreadable;
//   * the flip runs BEFORE the stamp and both steps are idempotent: a crash between them leaves at
//     most "flipped but unstamped", which a retry CONVERGES out of (no 409 dead-end);
//   * a missing/malformed retro file means NOTHING was stamped, so acknowledgement cannot claim success
//     without a real, writable frontmatter gate.
export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    const b = (body ?? {}) as Record<string, unknown>;
    const id = typeof b.id === "string" ? b.id : "";
    if (!id) return NextResponse.json({ error: "History entry id required." }, { status: 400 });

    const target = (await readBlockHistory()).find((e) => e.id === id);
    if (!target) return NextResponse.json({ error: "No such history entry." }, { status: 404 });
    const alreadyAdopted = Boolean(target.reflectionsApprovedAt);
    let approved = false;
    try {
      approved = await markRetroSeedsApproved(`${retroFileId(target.startDate, target.goal)}.md`);
    } catch (err) {
      if (alreadyAdopted) {
        return NextResponse.json({ ok: true, alreadyAdopted: true });
      }
      throw err;
    }
    if (!approved) {
      if (alreadyAdopted) {
        return NextResponse.json({ ok: true, alreadyAdopted: true });
      }
      return NextResponse.json({ error: "Couldn't acknowledge retrospective notes." }, { status: 409 });
    }
    if (alreadyAdopted) {
      return NextResponse.json({ ok: true, alreadyAdopted: true });
    }

    let racedAlreadyAdopted = false;
    const updated = await updateBlockHistory((entries) =>
      entries.map((e) => {
        if (e.id !== id) return e;
        if (e.reflectionsApprovedAt) {
          racedAlreadyAdopted = true;
          return e;
        }
        return { ...e, reflectionsApprovedAt: new Date().toISOString() };
      })
    );
    if (!updated.some((e) => e.id === id)) {
      // The entry vanished between the read and the lock — nothing was acknowledged.
      return NextResponse.json({ error: "No such history entry." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...(racedAlreadyAdopted ? { alreadyAdopted: true } : {}) });
  } catch (err) {
    logError("/api/history", "acknowledge", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Couldn't record the acknowledgement." }, { status: 502 });
  }
}
