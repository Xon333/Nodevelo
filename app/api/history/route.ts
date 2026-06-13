import { NextResponse } from "next/server";
import { readBlockHistory } from "@/lib/data-store";

export async function GET() {
  const history = await readBlockHistory();
  return NextResponse.json(history);
}
