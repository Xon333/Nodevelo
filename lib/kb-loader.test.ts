import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { listKnowledgeFiles, loadKnowledgeBaseContext, stripObsidianSyntax, parseGoalsWeakpointsForMigration, stripGoalsWeakpointsSections } from "./kb-loader";
import { approveSeedsInMarkdown, markRetroSeedsApproved, parseRetroSeeds, retroFileId } from "./kb-loader";

const RETRO_DIR = path.join(process.cwd(), "knowledge-base", "block-retrospectives");

// CR-4: the loader must never hard-fail when knowledge-base/ is absent (a fresh clone / CI) — it
// falls back to the committed knowledge-base-defaults/ skeleton. These invariants hold whether or not
// a local KB exists, and guard against the defaults' README leaking into the editor list / prompt.
describe("kb-loader resilience (CR-4)", () => {
  it("always lists the core KB files and never the defaults README", async () => {
    const files = await listKnowledgeFiles();
    expect(files).toContain("training_knowledge.md");
    expect(files).toContain("cycling_database.md");
    expect(files).not.toContain("README.md");
  });

  it("loads non-empty context without throwing, and never injects the README", async () => {
    const ctx = await loadKnowledgeBaseContext();
    expect(ctx.length).toBeGreaterThan(0);
    expect(ctx).toContain("training_knowledge.md"); // the section header is present
    expect(ctx).not.toMatch(/knowledge-base-defaults/); // the defaults README is never concatenated in
  });

  it("strips Obsidian-only navigation syntax from the generation prompt", async () => {
    const ctx = await loadKnowledgeBaseContext();
    expect(ctx).not.toMatch(/\[\[/); // no wikilinks leak into the prompt
    expect(ctx).not.toMatch(/## Related notes/); // the navigation footer is dropped
  });
});

describe("stripObsidianSyntax", () => {
  it("flattens wikilinks: alias, else section, else target", () => {
    expect(stripObsidianSyntax("not in [[cycling_database]].")).toBe("not in cycling_database.");
    expect(stripObsidianSyntax("See [[cycling_database#3. RECOVERY]].")).toBe("See 3. RECOVERY.");
    expect(stripObsidianSyntax("the [[training_knowledge#5. FTP PLATEAU DIAGNOSIS|FTP plateau]] work")).toBe(
      "the FTP plateau work"
    );
  });

  it("removes the Related-notes footer and its preceding rule", () => {
    const src = "Body text.\n\n---\n\n## Related notes\n\n- [[cycling_database]] — foundations.";
    expect(stripObsidianSyntax(src)).toBe("Body text.");
  });

  it("keeps a heading that follows the footer (defensive against future sections)", () => {
    const src = "Body.\n\n## Related notes\n\n- [[x]]\n\n## Appendix\n\nKept.";
    const out = stripObsidianSyntax(src);
    expect(out).not.toMatch(/Related notes/);
    expect(out).toContain("## Appendix");
    expect(out).toContain("Kept.");
  });
});

describe("parseGoalsWeakpointsForMigration", () => {
  it("returns empty arrays when athlete_profile.md has no GOALS/WEAKPOINTS content or is missing", async () => {
    const result = await parseGoalsWeakpointsForMigration();
    // Whatever the real fixture file contains — this just asserts the shape and that it never throws.
    expect(Array.isArray(result.goals)).toBe(true);
    expect(Array.isArray(result.weakpoints)).toBe(true);
    for (const g of result.goals) expect(g.focus).toBe("general");
  });
});

describe("stripGoalsWeakpointsSections", () => {
  it("removes GOALS and WEAKPOINTS sections through the next top-level heading", () => {
    const src = "# Athlete Profile\n\n## GOALS\n\n| Goal | Target |\n|------|--------|\n| FTP | 300W |\n\n## WEAKPOINTS\n\n| Weakpoint | Detail |\n|-----------|--------|\n| Cornering | Late apex |\n\n## PERSONAL DATA\n\nKept.";
    const out = stripGoalsWeakpointsSections(src);
    expect(out).not.toContain("GOALS");
    expect(out).not.toContain("FTP");
    expect(out).not.toContain("WEAKPOINTS");
    expect(out).not.toContain("Cornering");
    expect(out).toContain("## PERSONAL DATA");
    expect(out).toContain("Kept.");
  });

  it("is a no-op on content with no GOALS/WEAKPOINTS headings", () => {
    const src = "# Athlete Profile\n\n## PERSONAL DATA\n\nSomething.";
    expect(stripGoalsWeakpointsSections(src)).toBe(src.trim());
  });
});

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

  it("handles CRLF frontmatter with whitespace-padded delimiters", () => {
    const src = [
      " --- \r",
      'id: "2026-06-01_build-ftp"\r',
      "seeds_approved: false\r",
      "next_block_seeds:\r",
      '  - "frontmatter seed"\r',
      "\t---\r",
      "## Retrospective\r",
      "Body.",
    ].join("\n");
    const out = approveSeedsInMarkdown(src);
    expect(out).toContain("seeds_approved: true");
    expect(parseRetroSeeds(out)).toEqual(["frontmatter seed"]);
  });
});

describe("parseRetroSeeds unescaping", () => {
  it("strips outer quotes and unescapes only writer-owned \\\" and \\\\ inside a quoted scalar", () => {
    const fm = [
      "---",
      'id: "x"',
      "seeds_approved: true",
      "next_block_seeds:",
      '  - "keep \\\\n and \\\\t, backslash \\\\ then quote \\""',
      "---",
    ].join("\n");
    expect(parseRetroSeeds(fm)).toEqual(['keep \\n and \\t, backslash \\ then quote "']);
  });

  it("preserves significant edge whitespace inside quoted seeds", () => {
    const fm = [
      "---",
      'id: "x"',
      "seeds_approved: true",
      "next_block_seeds:",
      '  - "  backslash \\\\ then quote \\"  "',
      "---",
    ].join("\n");
    expect(parseRetroSeeds(fm)).toEqual(['  backslash \\ then quote "  ']);
  });

  it("preserves unrecognized backslash sequences instead of dropping the slash", () => {
    const fm = [
      "---",
      'id: "x"',
      "seeds_approved: true",
      "next_block_seeds:",
      '  - "athlete kept \\n and \\t literally"',
      "---",
    ].join("\n");
    expect(parseRetroSeeds(fm)).toEqual(["athlete kept \\n and \\t literally"]);
  });

  it("leaves plain unescaped seed text untouched", () => {
    expect(parseRetroSeeds(md(`seeds_approved: true\nstatus: completed`))).toEqual([
      "Threshold executed well — evidence supports progressing Threshold load",
      "Minimal CTL gain (+1) — review session quality or effective volume",
    ]);
  });
});

describe("seed-gate frontmatter scoping", () => {
  const scoped = (flag: string, body: string) => `---
id: "2026-06-01_build-ftp"
${flag}
next_block_seeds:
  - "frontmatter seed"
---
## Retrospective
${body}`;

  it("a body line reading seeds_approved: true does NOT open the gate", () => {
    const src = scoped("seeds_approved: false", "Coach notes:\nseeds_approved: true\nMore prose.");
    expect(parseRetroSeeds(src)).toEqual([]);
  });

  it("approveSeedsInMarkdown flips the real stamp and leaves a body seeds_approved line untouched", () => {
    const src = scoped("seeds_approved: false", "Coach notes:\nseeds_approved: true");
    const out = approveSeedsInMarkdown(src);
    expect(out).toBe(`---
id: "2026-06-01_build-ftp"
seeds_approved: true
next_block_seeds:
  - "frontmatter seed"
---
## Retrospective
Coach notes:
seeds_approved: true`);
    expect(parseRetroSeeds(out)).toEqual(["frontmatter seed"]);
  });

  it("a body heading mentioning next_block_seeds: contributes no seeds", () => {
    const src = scoped(
      "seeds_approved: true",
      '## next_block_seeds:\n  - "body seed"\n  - "another body seed"'
    );
    expect(parseRetroSeeds(src)).toEqual(["frontmatter seed"]);
  });

  it("a file with no frontmatter region never yields seeds even if prose looks like frontmatter", () => {
    const prose = [
      "# Random note",
      "seeds_approved: true",
      "next_block_seeds:",
      '  - "prose seed"',
    ].join("\n");
    expect(parseRetroSeeds(prose)).toEqual([]);
  });
});

describe("retroFileId", () => {
  it("matches the filename the retrospective route writes", () => {
    expect(retroFileId("2026-06-01", "Build FTP!")).toBe("2026-06-01_build-ftp");
  });
});

describe("markRetroSeedsApproved", () => {
  it("returns false for malformed or missing frontmatter", async () => {
    const name = "2099-01-01_mark-retro-seeds-approved-malformed.md";
    await fs.mkdir(RETRO_DIR, { recursive: true });
    await fs.writeFile(path.join(RETRO_DIR, name), "# no frontmatter here", "utf-8");
    await expect(markRetroSeedsApproved(name)).resolves.toBe(false);
    await fs.unlink(path.join(RETRO_DIR, name));
  });

  it("rejects on storage failures instead of collapsing them into false", async () => {
    await expect(markRetroSeedsApproved("2099-01-01_mark-retro-seeds-approved-missing.md")).rejects.toThrow();
  });
});
