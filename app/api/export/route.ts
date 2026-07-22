import { NextResponse } from "next/server";
import { buildBackupBundle } from "@/lib/backup";

// Disaster-recovery export. The filesystem (data/*.json + knowledge-base/**/*.md) is this app's
// only source of truth and both dirs are gitignored, so this bundles them into one downloadable
// JSON file. Read-only — never mutates anything. Restore via POST /api/import. Auto off-machine
// snapshots (lib/backup.ts's snapshotBackup, wired into /api/sync) share this same bundle shape.

export async function GET() {
  try {
    const bundle = await buildBackupBundle();
    const filename = `nodevelo-backup-${bundle.exportedAt.slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Couldn't build the backup." }, { status: 502 });
  }
}
