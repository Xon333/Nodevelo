import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

function resolveLocal(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(ROOT, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (!base) return null;
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")].find(existsSync) ?? null;
}

describe("the sync route's LLM-free boundary", () => {
  it("has no transitive local import of the Anthropic SDK", () => {
    const pending: Array<{ file: string; chain: string[] }> = [
      { file: path.join(ROOT, "app/api/sync/route.ts"), chain: ["app/api/sync/route.ts"] },
    ];
    const seen = new Set<string>();
    const violations: string[] = [];

    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current.file)) continue;
      seen.add(current.file);
      const source = readFileSync(current.file, "utf8");
      const imports = [...source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g)].map((match) => match[2]);
      for (const specifier of imports) {
        if (specifier === "@anthropic-ai/sdk") violations.push([...current.chain, specifier].join(" -> "));
        const next = resolveLocal(current.file, specifier);
        if (next) pending.push({ file: next, chain: [...current.chain, path.relative(ROOT, next)] });
      }
    }

    expect(violations).toEqual([]);
  });
});
