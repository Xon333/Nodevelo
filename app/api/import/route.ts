import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { logWarn } from "@/lib/log";
import { writeJsonFile } from "@/lib/json-store";

// Restore from a bundle produced by GET /api/export. Destructive — it overwrites the only source
// of truth — so it is heavily guarded: the payload must self-identify as a NodeVelo backup, every
// target path is confined to data/ or knowledge-base/ (no traversal), and data files go through
// writeJsonFile so the CRITICAL stores keep their .bak snapshot of the pre-import state.

const DATA_DIR = process.env.NODEVELO_DATA_DIR || path.join(process.cwd(), "data");
const KB_DIR = path.join(process.cwd(), "knowledge-base");

// Resolve `rel` under `baseDir`, returning null if it escapes the base (path traversal / absolute).
function safeResolve(baseDir: string, rel: string): string | null {
  const full = path.resolve(baseDir, rel);
  if (full !== baseDir && !full.startsWith(baseDir + path.sep)) return null;
  return full;
}

export async function POST(req: Request) {
  let bundle: unknown;
  try {
    bundle = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const b = bundle as Record<string, unknown> | null;
  if (!b || b.app !== "nodevelo" || b.kind !== "backup") {
    return NextResponse.json({ error: "Not a NodeVelo backup file." }, { status: 400 });
  }

  const data = (b.data ?? {}) as Record<string, unknown>;
  const kb = (b.knowledgeBase ?? {}) as Record<string, unknown>;
  let restored = 0;
  const skipped: string[] = [];

  // Data stores: parse then write through json-store (atomic + .bak for critical ledgers). A file
  // is data/-flat, so `rel` is just a filename — still range-checked for safety.
  for (const [rel, content] of Object.entries(data)) {
    if (typeof content !== "string" || !rel.endsWith(".json") || !safeResolve(DATA_DIR, rel)) {
      skipped.push(rel);
      continue;
    }
    try {
      await writeJsonFile(rel, JSON.parse(content));
      restored++;
    } catch (err) {
      logWarn("/api/import", "restore-data-file", err instanceof Error ? err.message : String(err), { rel });
      skipped.push(rel); // malformed JSON in the bundle — leave the live file untouched
    }
  }

  // Knowledge-base markdown (may be nested, e.g. block-retrospectives/): write raw.
  for (const [rel, content] of Object.entries(kb)) {
    const full = typeof content === "string" && rel.endsWith(".md") ? safeResolve(KB_DIR, rel) : null;
    if (!full) {
      skipped.push(rel);
      continue;
    }
    try {
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content as string, "utf-8");
      restored++;
    } catch (err) {
      logWarn("/api/import", "restore-kb-file", err instanceof Error ? err.message : String(err), { rel });
      skipped.push(rel);
    }
  }

  return NextResponse.json({ ok: true, restored, skipped });
}
