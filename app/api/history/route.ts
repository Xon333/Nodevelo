import { NextResponse } from "next/server";
import { readBlockHistory } from "@/lib/data-store";

export async function GET() {
  try {
    const history = await readBlockHistory();
    return NextResponse.json(history);
  } catch {
    return NextResponse.json({ error: "Couldn't load block history." }, { status: 502 });
  }
}
