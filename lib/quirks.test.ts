import { describe, expect, it } from "vitest";
import { extractQuirks, formatQuirksForPrompt } from "./quirks";
import type { QuirkEntry } from "./types";

// Helper: build activities with notes. Dates descend so ordering is exercised too.
function acts(notes: Array<{ id: string; date: string; description: string | null }>) {
  return notes;
}

describe("extractQuirks", () => {
  it("only surfaces patterns seen on ≥2 distinct rides", () => {
    const store = extractQuirks(
      acts([
        { id: "1", date: "2026-06-01", description: "Legs cramped badly on the final climb." },
        { id: "2", date: "2026-06-05", description: "Calf cramping again near the end." },
        { id: "3", date: "2026-06-09", description: "Dropped the chain once, otherwise fine." }, // single mention
      ]),
      "2026-06-10T00:00:00Z"
    );
    const patterns = store.entries.map((e) => e.pattern);
    expect(patterns).toContain("cramp");
    expect(patterns).not.toContain("chain issue"); // only one ride → below the ≥2 gate
  });

  it("aggregates frequency, first/last seen, and category", () => {
    const store = extractQuirks(
      acts([
        { id: "a", date: "2026-05-01", description: "Cramp in the left leg." },
        { id: "b", date: "2026-05-10", description: "Cramping returned today." },
        { id: "c", date: "2026-05-20", description: "Bad cramps in the heat." },
      ]),
      "2026-05-21T00:00:00Z"
    );
    const cramp = store.entries.find((e) => e.pattern === "cramp") as QuirkEntry;
    expect(cramp.frequency).toBe(3);
    expect(cramp.category).toBe("symptom");
    expect(cramp.firstSeen).toBe("2026-05-01");
    expect(cramp.lastSeen).toBe("2026-05-20");
    expect(cramp.evidence.toLowerCase()).toContain("cramp");
  });

  it("collapses morphological variants (cramp/cramping/cramped) to one tag", () => {
    const store = extractQuirks(
      acts([
        { id: "1", date: "2026-06-01", description: "I cramped." },
        { id: "2", date: "2026-06-02", description: "Cramping all day." },
      ]),
      "2026-06-03T00:00:00Z"
    );
    expect(store.entries.filter((e) => e.pattern === "cramp")).toHaveLength(1);
  });

  it("counts one ride once even with repeated mentions", () => {
    const store = extractQuirks(
      acts([
        { id: "1", date: "2026-06-01", description: "Cramp early. Cramp again later. Still cramping." },
        { id: "2", date: "2026-06-02", description: "Cramped again." },
      ]),
      "2026-06-03T00:00:00Z"
    );
    expect(store.entries.find((e) => e.pattern === "cramp")?.frequency).toBe(2);
  });

  it("respects negation within a clause", () => {
    const store = extractQuirks(
      acts([
        { id: "1", date: "2026-06-01", description: "No cramp today, felt great." },
        { id: "2", date: "2026-06-02", description: "Didn't cramp at all." },
      ]),
      "2026-06-03T00:00:00Z"
    );
    expect(store.entries.find((e) => e.pattern === "cramp")).toBeUndefined();
  });

  it("negates only the offending clause, not the whole sentence", () => {
    const store = extractQuirks(
      acts([
        { id: "1", date: "2026-06-01", description: "No mechanicals, but cramp hit hard on the climb." },
        { id: "2", date: "2026-06-02", description: "Felt strong, though cramps crept in late." },
      ]),
      "2026-06-03T00:00:00Z"
    );
    expect(store.entries.find((e) => e.pattern === "cramp")?.frequency).toBe(2);
  });

  it("skips empty/blank descriptions without throwing", () => {
    const store = extractQuirks(
      acts([
        { id: "1", date: "2026-06-01", description: null },
        { id: "2", date: "2026-06-02", description: "   " },
      ]),
      "2026-06-03T00:00:00Z"
    );
    expect(store.entries).toEqual([]);
    expect(store.engine).toBe("compromise+lexicon");
  });
});

describe("formatQuirksForPrompt", () => {
  it("returns empty string for no entries", () => {
    expect(formatQuirksForPrompt([])).toBe("");
  });

  it("frames patterns as hints, not facts", () => {
    const out = formatQuirksForPrompt([
      { pattern: "cramp", category: "symptom", frequency: 3, firstSeen: "2026-05-01", lastSeen: "2026-06-15", evidence: "x" },
    ]);
    expect(out).toContain("hints");
    expect(out).toContain("not clinical facts");
    expect(out).toContain("cramp (symptom, 3×, last 2026-06-15)");
  });
});
