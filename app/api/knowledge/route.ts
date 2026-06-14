import { NextResponse } from "next/server";
import {
  listKnowledgeFiles,
  listRetrospectives,
  readKnowledgeFile,
  readRetrospective,
  writeKnowledgeFile,
  writeRetrospective,
} from "@/lib/kb-loader";

// GET /api/knowledge             -> { files: string[], retrospectives: string[] }
// GET /api/knowledge?file=x.md   -> { file, content }      (core KB file)
// GET /api/knowledge?retro=x.md  -> { file, content }      (block retrospective)
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const file = params.get("file");
  const retro = params.get("retro");
  try {
    if (retro) {
      return NextResponse.json({ file: retro, content: await readRetrospective(retro) });
    }
    if (file) {
      return NextResponse.json({ file, content: await readKnowledgeFile(file) });
    }
    const [files, retrospectives] = await Promise.all([listKnowledgeFiles(), listRetrospectives()]);
    return NextResponse.json({ files, retrospectives });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read knowledge base.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

// PUT saves a core KB file ({ file, content }) or a retrospective ({ retro, content }).
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { file, retro, content } = (body ?? {}) as Record<string, unknown>;
  if (typeof content !== "string") {
    return NextResponse.json({ error: "content is required." }, { status: 400 });
  }
  try {
    if (typeof retro === "string") {
      await writeRetrospective(retro, content);
      return NextResponse.json({ ok: true });
    }
    if (typeof file === "string") {
      await writeKnowledgeFile(file, content);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "file or retro is required." }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save file.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
