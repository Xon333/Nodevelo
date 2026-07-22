"use client";

import { useRef, useState } from "react";
import { Card, PRIMARY_BUTTON_CLASS } from "./ui";

// Disaster-recovery UI: export the whole local store (data/ + knowledge-base/) as one JSON file,
// or restore from one. Restore is destructive, so it's gated behind a confirm and a reload.
export default function BackupRestore() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // S2-7: the highest-stakes destructive action in the app (overwrites all local data) — an
  // in-product confirm (not window.confirm) states the consequence before the file is processed.
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again later
    if (file) setPendingFile(file);
  }

  async function restore() {
    const file = pendingFile;
    if (!file) return;
    setPendingFile(null);
    setBusy(true);
    setStatus(null);
    try {
      const text = await file.text();
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const json = (await res.json()) as { error?: string; restored?: number; skipped?: string[] };
      if (!res.ok) throw new Error(json.error || "Import failed");
      // UXA-7: the route already reports exactly which files it couldn't restore — the client
      // previously discarded that and reported a partial restore as a full success.
      const skipped = json.skipped ?? [];
      const msg =
        skipped.length > 0
          ? `Restored ${json.restored ?? 0} files — ${skipped.length} couldn't be restored: ${skipped.join(", ")}. Reloading…`
          : `Restored ${json.restored ?? 0} files. Reloading…`;
      setStatus({ ok: skipped.length === 0, msg });
      setTimeout(() => window.location.reload(), skipped.length > 0 ? 4000 : 1000);
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : "Import failed" });
      setBusy(false);
    }
  }

  return (
    <Card title="Backup & restore">
      <p className="text-sm text-zinc-500">
        Your training data and knowledge base live only on this machine. Export a snapshot you can
        re-import after a reset or a move to a new machine.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a href="/api/export" download className={PRIMARY_BUTTON_CLASS}>
          Export backup
        </a>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-600"
        >
          {busy ? "Restoring…" : "Restore from file…"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={onFile}
          className="hidden"
        />
      </div>
      {pendingFile && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-800 dark:bg-red-950/50">
          <p className="text-xs text-red-800 dark:text-red-300">
            Restore from <span className="font-medium">{pendingFile.name}</span>? This overwrites ALL
            current training data and knowledge-base files on this machine. Critical stores keep a
            one-step <span className="font-mono">.bak</span>.
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={() => void restore()}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              Restore &amp; overwrite
            </button>
            <button
              onClick={() => setPendingFile(null)}
              className="py-1.5 text-xs text-red-700 hover:underline dark:text-red-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {status && (
        <p
          className={`mt-3 text-sm ${
            status.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {status.msg}
        </p>
      )}
    </Card>
  );
}
