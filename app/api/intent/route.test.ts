import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/intent-runner", () => ({ runIntentParsing: vi.fn() }));
vi.mock("@/lib/date", () => ({ resolveToday: vi.fn(() => "2026-08-07") }));

import { resolveToday } from "@/lib/date";
import { runIntentParsing } from "@/lib/intent-runner";
import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runIntentParsing).mockResolvedValue({ processed: 1, remaining: 2, stalled: false, failedIds: ["a1"] });
});

describe("POST /api/intent", () => {
  it("passes boolean force and string skip ids to the runner", async () => {
    const response = await POST(
      new Request("http://localhost/api/intent", {
        method: "POST",
        body: JSON.stringify({ today: "2026-08-07", force: true, skip: ["a1", 2, null] }),
      })
    );
    expect(resolveToday).toHaveBeenCalledWith("2026-08-07");
    expect(runIntentParsing).toHaveBeenCalledWith("2026-08-07", expect.any(Array), {
      force: true,
      skip: ["a1"],
    });
    expect(await response.json()).toEqual({ processed: 1, remaining: 2, stalled: false, failedIds: ["a1"], warnings: [] });
  });

  it("tolerates an absent body", async () => {
    await POST(new Request("http://localhost/api/intent", { method: "POST" }));
    expect(resolveToday).toHaveBeenCalledWith(undefined);
    expect(runIntentParsing).toHaveBeenCalledWith("2026-08-07", expect.any(Array), { force: false, skip: [] });
  });
});
