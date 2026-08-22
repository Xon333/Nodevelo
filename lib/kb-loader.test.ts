import { describe, expect, it } from "vitest";
import { approveSeedsInMarkdown, parseRetroSeeds, retroFileId } from "./kb-loader";

const md = (flag: string) => `---
id: "2026-06-01_build-ftp"
goal: "Build FTP"
start_date: "2026-06-01"
${flag}
next_block_seeds:
  - "Threshold executed well — evidence supports progressing Threshold load"
  - "Minimal CTL gain (+1) — review session quality or effective volume"
generated_at: "2026-06-15T08:00:00.000Z"
---
## Retrospective
Fine block.`;

describe("parseRetroSeeds", () => {
  it("returns [] when seeds_approved is absent (pre-Phase-1 file)", () => {
    expect(parseRetroSeeds(md(`status: completed`))).toEqual([]);
  });

  it("returns [] when seeds_approved is false", () => {
    expect(parseRetroSeeds(md(`seeds_approved: false\nstatus: completed`))).toEqual([]);
  });

  it("returns the list when seeds_approved is true", () => {
    const out = parseRetroSeeds(md(`seeds_approved: true\nstatus: completed`));
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("Threshold");
  });
});

describe("approveSeedsInMarkdown", () => {
  it("flips false → true", () => {
    const out = approveSeedsInMarkdown(md(`seeds_approved: false\nstatus: completed`));
    expect(out).toContain("seeds_approved: true");
    expect(parseRetroSeeds(out)).toHaveLength(2);
  });

  it("inserts the flag into a pre-Phase-1 file without one", () => {
    const out = approveSeedsInMarkdown(md(`status: completed`));
    expect(out).toContain("seeds_approved: true");
    expect(out.indexOf("seeds_approved")).toBeLessThan(out.indexOf("next_block_seeds"));
  });

  it("is idempotent", () => {
    const once = approveSeedsInMarkdown(md(`seeds_approved: false\nstatus: completed`));
    expect(approveSeedsInMarkdown(once)).toBe(once);
  });
});

describe("retroFileId", () => {
  it("matches the filename the retrospective route writes", () => {
    expect(retroFileId("2026-06-01", "Build FTP!")).toBe("2026-06-01_build-ftp");
  });
});
