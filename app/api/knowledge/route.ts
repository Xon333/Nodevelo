import { NextResponse } from "next/server";
import { listKnowledgeFiles, readKnowledgeFile, writeKnowledgeFile } from "@/lib/kb-loader";

// GET /api/knowledge            -> { files: string[] }
// GET /api/knowledge?file=x.md  -> { file, content }
export async function GET(req: Request) {
  const file = new URL(req.url).searchParams.get("file");
  try {
    if (!file) {
      return NextResponse.json({ files: await listKnowledgeFiles() });
    }
    return NextResponse.json({ file, content: await readKnowledgeFile(file) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read knowledge base.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

// PUT saves an existing .md file. No creation, no deletion.
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { file, content } = (body ?? {}) as Record<string, unknown>;
  if (typeof file !== "string" || typeof content !== "string") {
    return NextResponse.json({ error: "file and content are required." }, { status: 400 });
  }
  try {
    await writeKnowledgeFile(file, content);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save file.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
