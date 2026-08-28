import { NextResponse } from "next/server";
import { BackupRestoreError, BackupValidationError, restoreBackupBundle } from "@/lib/backup";
import { logWarn } from "@/lib/log";

const STAGING_FAILURE_MESSAGE = "Restore staging failed. Your current data was not changed.";

export async function POST(req: Request) {
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const result = await restoreBackupBundle(input);
    for (const warning of result.cleanupWarnings) logWarn("/api/import", "restore-cleanup", warning);
    return NextResponse.json({ ok: true, restored: result.restored });
  } catch (error) {
    if (error instanceof BackupValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof BackupRestoreError && error.recoveryConfirmed) {
      if (error.message === STAGING_FAILURE_MESSAGE) {
        logWarn("/api/import", "restore-staging", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      logWarn("/api/import", "restore-failed", error.message);
      return NextResponse.json({ error: "Restore failed. Your previous data was put back." }, { status: 500 });
    }
    if (error instanceof BackupRestoreError) {
      logWarn("/api/import", "restore-unconfirmed", error.message, { recoveryPaths: error.recoveryPaths });
    } else {
      logWarn("/api/import", "restore-unconfirmed", error instanceof Error ? error.message : String(error));
    }
    return NextResponse.json(
      {
        error:
          "Restore was interrupted and recovery could not be confirmed. Keep the backup file and restore it again before using NodeVelo.",
      },
      { status: 500 }
    );
  }
}
