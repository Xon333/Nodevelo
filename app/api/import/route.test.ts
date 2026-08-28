import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  class BackupValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "BackupValidationError";
    }
  }

  class BackupRestoreError extends Error {
    recoveryConfirmed: boolean;
    recoveryPaths: string[];

    constructor(message: string, recoveryConfirmed: boolean, recoveryPaths: string[] = []) {
      super(message);
      this.name = "BackupRestoreError";
      this.recoveryConfirmed = recoveryConfirmed;
      this.recoveryPaths = recoveryPaths;
    }
  }

  return {
    BackupValidationError,
    BackupRestoreError,
    logWarn: vi.fn(),
    restoreBackupBundle: vi.fn(),
  };
});

vi.mock("@/lib/backup", () => ({
  BackupRestoreError: h.BackupRestoreError,
  BackupValidationError: h.BackupValidationError,
  restoreBackupBundle: h.restoreBackupBundle,
}));
vi.mock("@/lib/log", () => ({ logWarn: h.logWarn }));

import { POST } from "@/app/api/import/route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/import", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/import", () => {
  it("rejects malformed JSON before calling the restore helper", async () => {
    const res = await POST(new Request("http://x/api/import", { method: "POST", body: "{not json" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid JSON body." });
    expect(h.restoreBackupBundle).not.toHaveBeenCalled();
  });

  it("maps backup validation failures to 400", async () => {
    h.restoreBackupBundle.mockRejectedValueOnce(new h.BackupValidationError("Backup bundle must be a plain object."));

    const res = await post({});

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Backup bundle must be a plain object." });
  });

  it("returns the restored count on success and logs cleanup warnings", async () => {
    h.restoreBackupBundle.mockResolvedValueOnce({ restored: 2, cleanupWarnings: ["cleanup note"] });

    const res = await post({ app: "nodevelo" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, restored: 2 });
    expect(h.logWarn).toHaveBeenCalledWith("/api/import", "restore-cleanup", "cleanup note");
  });

  it("returns the confirmed restore failure message for confirmed BackupRestoreError failures", async () => {
    h.restoreBackupBundle.mockRejectedValueOnce(
      new h.BackupRestoreError("Restore failed. Your previous data was put back.", true)
    );

    const res = await post({ app: "nodevelo" });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Restore failed. Your previous data was put back.",
    });
    expect(h.logWarn).toHaveBeenCalledWith(
      "/api/import",
      "restore-failed",
      "Restore failed. Your previous data was put back."
    );
  });

  it("returns the staging failure message when the restore never reached commit", async () => {
    h.restoreBackupBundle.mockRejectedValueOnce(
      new h.BackupRestoreError("Restore staging failed. Your current data was not changed.", true)
    );

    const res = await post({ app: "nodevelo" });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Restore staging failed. Your current data was not changed.",
    });
    expect(h.logWarn).toHaveBeenCalledWith(
      "/api/import",
      "restore-staging",
      "Restore staging failed. Your current data was not changed."
    );
  });

  it("returns the unconfirmed restore failure message for unconfirmed BackupRestoreError failures", async () => {
    h.restoreBackupBundle.mockRejectedValueOnce(
      new h.BackupRestoreError(
        "Restore could not confirm recovery. Keep the uploaded backup and recover manually.",
        false,
        ["/tmp/a", "/tmp/b"]
      )
    );

    const res = await post({ app: "nodevelo" });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error:
        "Restore was interrupted and recovery could not be confirmed. Keep the backup file and restore it again before using NodeVelo.",
    });
    expect(h.logWarn).toHaveBeenCalledWith(
      "/api/import",
      "restore-unconfirmed",
      "Restore could not confirm recovery. Keep the uploaded backup and recover manually.",
      { recoveryPaths: ["/tmp/a", "/tmp/b"] }
    );
  });
});
