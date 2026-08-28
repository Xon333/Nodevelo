import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withExclusivePersistence, withPersistenceAccess } from "./persistence-gate";
import {
  listKnowledgeFiles,
  loadKnowledgeBaseContext,
  parseGoalsWeakpointsForMigration,
  readKnowledgeFile,
  stripGoalsWeakpointsSections,
  stripObsidianSyntax,
  writeKnowledgeFile,
} from "./kb-loader";
import {
  approveSeedsInMarkdown,
  markRetroSeedsApproved,
  parseRetroSeeds,
  retroFileId,
  writeRetrospective,
} from "./kb-loader";

let kbTestDir: string;
const retroDir = () => path.join(kbTestDir, "block-retrospectives");

beforeAll(async () => {
  kbTestDir = await fs.mkdtemp(path.join(os.tmpdir(), "nodevelo-kb-loader-"));
  process.env.NODEVELO_KB_DIR = kbTestDir;
});

afterAll(async () => {
  delete process.env.NODEVELO_KB_DIR;
  await fs.rm(kbTestDir, { recursive: true, force: true });
});

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("knowledge-base persistence access", () => {
  it("allows a nested public KB read while exclusive persistence is queued", async () => {
    const outerStarted = deferred();
    const enterNested = deferred();
    const events: string[] = [];

    const outer = withPersistenceAccess(async () => {
      events.push("shared-start");
      outerStarted.resolve();
      await enterNested.promise;
      await parseGoalsWeakpointsForMigration();
      events.push("nested-read");
    });
    await outerStarted.promise;

    const exclusive = withExclusivePersistence(async () => {
      events.push("exclusive");
    });
    enterNested.resolve();

    await outer;
    await exclusive;
    expect(events).toEqual(["shared-start", "nested-read", "exclusive"]);
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

describe("atomic knowledge-base writes", () => {
  const core = () => path.join(process.env.NODEVELO_KB_DIR as string, "training_knowledge.md");
  const retro = (name: string) => path.join(retroDir(), name);

  it("replaces an existing knowledge file through a temp rename", async () => {
    await fs.writeFile(core(), "old", "utf-8");
    await writeKnowledgeFile("training_knowledge.md", "new");
    expect(await readKnowledgeFile("training_knowledge.md")).toBe("new");
    expect((await fs.readdir(process.env.NODEVELO_KB_DIR as string)).some((name) => name.endsWith(".tmp"))).toBe(
      false
    );
  });

  it.each([
    ["knowledge", async () => writeKnowledgeFile("training_knowledge.md", "lost"), core],
    [
      "retrospective",
      async () => writeRetrospective("2099-01-01_atomic.md", "lost"),
      () => retro("2099-01-01_atomic.md"),
    ],
    ["seed approval", async () => markRetroSeedsApproved("2099-01-01_atomic.md"), () => retro("2099-01-01_atomic.md")],
  ])("keeps the prior %s file when rename fails", async (_label, mutate, target) => {
    await fs.mkdir(path.dirname(target()), { recursive: true });
    const original = _label === "seed approval" ? md("seeds_approved: false\nstatus: completed") : "intact";
    await fs.writeFile(target(), original, "utf-8");
    const rename = vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("rename failed"));
    await expect(mutate()).rejects.toThrow("rename failed");
    rename.mockRestore();
    expect(await fs.readFile(target(), "utf-8")).toBe(original);
  });

  it("atomically writes retrospectives and approved seed changes", async () => {
    await writeRetrospective("2099-01-01_atomic.md", md("seeds_approved: false\nstatus: completed"));
    await expect(markRetroSeedsApproved("2099-01-01_atomic.md")).resolves.toBe(true);
    expect(await fs.readFile(retro("2099-01-01_atomic.md"), "utf-8")).toContain("seeds_approved: true");
    expect((await fs.readdir(retroDir())).some((name) => name.endsWith(".tmp"))).toBe(false);
  });
});

describe("markRetroSeedsApproved", () => {
  it("returns false for malformed or missing frontmatter", async () => {
    const name = "2099-01-01_mark-retro-seeds-approved-malformed.md";
    await fs.mkdir(retroDir(), { recursive: true });
    await fs.writeFile(path.join(retroDir(), name), "# no frontmatter here", "utf-8");
    await expect(markRetroSeedsApproved(name)).resolves.toBe(false);
    await fs.unlink(path.join(retroDir(), name));
  });

  it("rejects on storage failures instead of collapsing them into false", async () => {
    await expect(markRetroSeedsApproved("2099-01-01_mark-retro-seeds-approved-missing.md")).rejects.toThrow();
  });
});
