import { NextResponse } from "next/server";
import type { CurrentBlock } from "./types";

// UXA-24: guards destructive block mutations (delete/write/reschedule) against acting on state a
// client's tab hasn't seen yet — e.g. tab B already replaced/cleared the block tab A still shows.
// `createdAt` already uniquely identifies a block generation instance, so no new field is needed.
// `expected` undefined means the caller didn't send one (skip the check); present-but-mismatched
// rejects with 409 before any mutation happens.
export function blockChangedResponse(actual: CurrentBlock | null, expected: string | null | undefined): NextResponse | null {
  if (expected === undefined) return null;
  if ((actual?.createdAt ?? null) === expected) return null;
  return NextResponse.json(
    { error: "This plan changed in another tab — reload to see the latest before continuing." },
    { status: 409 }
  );
}
