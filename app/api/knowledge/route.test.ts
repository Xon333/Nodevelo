import { beforeEach, describe, expect, it, vi } from "vitest";

// Route test for /api/knowledge (destructive-route sweep, extends SUB-3). PUT overwrites either a core
// KB file or a block retrospective; the two targets are mutually exclusive and one of them is required.
vi.mock("@/lib/kb-loader", () => ({
  listKnowledgeFiles: vi.fn(),
  listRetrospectives: vi.fn(),
  readKnowledgeFile: vi.fn(),
  readRetrospective: vi.fn(),
  writeKnowledgeFile: vi.fn(),
  writeRetrospective: vi.fn(),
}));

import * as kb from "@/lib/kb-loader";
import { GET, PUT } from "@/app/api/knowledge/route";

const get = (qs = "") => GET(new Request(`http://x/api/knowledge${qs}`));
const put = (body: unknown) => PUT(new Request("http://x/api/knowledge", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/knowledge", () => {
  it("lists files and retrospectives with no params", async () => {
    (kb.listKnowledgeFiles as ReturnType<typeof vi.fn>).mockResolvedValue(["nutrition.md"]);
    (kb.listRetrospectives as ReturnType<typeof vi.fn>).mockResolvedValue(["2026-01-01_block.md"]);
    const json = await (await get()).json();
    expect(json).toEqual({ files: ["nutrition.md"], retrospectives: ["2026-01-01_block.md"] });
  });

  it("reads a single core file when ?file= is given", async () => {
    (kb.readKnowledgeFile as ReturnType<typeof vi.fn>).mockResolvedValue("# Nutrition");
    const json = await (await get("?file=nutrition.md")).json();
    expect(json).toEqual({ file: "nutrition.md", content: "# Nutrition" });
    expect(kb.readKnowledgeFile).toHaveBeenCalledWith("nutrition.md");
  });

  it("reads a retrospective when ?retro= is given", async () => {
    (kb.readRetrospective as ReturnType<typeof vi.fn>).mockResolvedValue("# Block retro");
    const json = await (await get("?retro=2026-01-01_block.md")).json();
    expect(json).toEqual({ file: "2026-01-01_block.md", content: "# Block retro" });
  });

  it("maps a read failure to 404 with the error message", async () => {
    (kb.readKnowledgeFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ENOENT"));
    const res = await get("?file=missing.md");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("ENOENT");
  });
});

describe("PUT /api/knowledge", () => {
  it("rejects an invalid JSON body", async () => {
    const res = await PUT(new Request("http://x/api/knowledge", { method: "PUT", body: "{not json" }));
    expect(res.status).toBe(400);
  });

  it("rejects a body with no content", async () => {
    const res = await put({ file: "nutrition.md" });
    expect(res.status).toBe(400);
    expect(kb.writeKnowledgeFile).not.toHaveBeenCalled();
  });

  it("rejects a body with neither file nor retro", async () => {
    const res = await put({ content: "hello" });
    expect(res.status).toBe(400);
    expect(kb.writeKnowledgeFile).not.toHaveBeenCalled();
    expect(kb.writeRetrospective).not.toHaveBeenCalled();
  });

  it("writes a retrospective (not the core file) when retro is given", async () => {
    const res = await put({ retro: "2026-01-01_block.md", content: "updated" });
    expect(res.status).toBe(200);
    expect(kb.writeRetrospective).toHaveBeenCalledWith("2026-01-01_block.md", "updated");
    expect(kb.writeKnowledgeFile).not.toHaveBeenCalled();
  });

  it("writes a core KB file when file is given", async () => {
    const res = await put({ file: "nutrition.md", content: "updated" });
    expect(res.status).toBe(200);
    expect(kb.writeKnowledgeFile).toHaveBeenCalledWith("nutrition.md", "updated");
  });

  it("maps a write failure to 400 with the error message", async () => {
    (kb.writeKnowledgeFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("disk full"));
    const res = await put({ file: "nutrition.md", content: "updated" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("disk full");
  });
});
