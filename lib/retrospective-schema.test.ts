import { describe, expect, it } from "vitest";
import {
  RETROSPECTIVE_TOOL,
  RetrospectiveToolSchema,
  formatReflectionsForPrompt,
  latestApprovedReflections,
} from "./retrospective-schema";
import type { BlockHistoryEntry, StructuredReflection } from "./types";

const reflection: StructuredReflection = {
  dimension: "Threshold",
  hypothesis: "More threshold volume would lift sustained power.",
  observation: "Execution EWMA fell 6.1 → 5.2; verdict refuted.",
  root_cause: "Sessions were stacked on consecutive days with no recovery.",
  adjusted_strategy: "Space threshold days; cap to two per week.",
};

describe("RetrospectiveToolSchema", () => {
  it("accepts a well-formed reflections payload", () => {
    const parsed = RetrospectiveToolSchema.safeParse({ reflections: [reflection] });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty reflections array", () => {
    expect(RetrospectiveToolSchema.safeParse({ reflections: [] }).success).toBe(false);
  });

  it("rejects a reflection missing required fields", () => {
    expect(
      RetrospectiveToolSchema.safeParse({ reflections: [{ dimension: "Overall" }] }).success
    ).toBe(false);
  });
});

describe("RETROSPECTIVE_TOOL input_schema", () => {
  it("is a valid object schema with no JSON-Schema meta key", () => {
    const schema = RETROSPECTIVE_TOOL.input_schema as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toHaveProperty("properties");
  });
});

describe("formatReflectionsForPrompt", () => {
  it("returns empty string for no reflections", () => {
    expect(formatReflectionsForPrompt([])).toBe("");
  });

  it("renders each reflection with its dimension and adjusted strategy", () => {
    const out = formatReflectionsForPrompt([reflection]);
    expect(out).toContain("COACH REFLECTIONS FROM LAST BLOCK");
    expect(out).toContain("[Threshold]");
    expect(out).toContain("Space threshold days");
  });
});

const hist = (over: Partial<BlockHistoryEntry>): BlockHistoryEntry =>
  ({
    id: "h", goal: "g", startDate: "2026-06-01", endDate: "2026-06-14", lengthWeeks: 2,
    overview: "", createdAt: "2026-06-01T00:00:00.000Z",
    structuredReflections: [{ dimension: "Overall", hypothesis: "h", observation: "o", root_cause: "r", adjusted_strategy: "a" }],
    ...over,
  }) as BlockHistoryEntry;

describe("latestApprovedReflections", () => {
  const refl = [{ dimension: "Overall", hypothesis: "h", observation: "o", root_cause: "r", adjusted_strategy: "a" }];

  it("injects the NEWEST reflection-bearing entry only when its approval stamp is truthy", () => {
    expect(latestApprovedReflections([
      hist({ id: "new", structuredReflections: refl }),                                  // newest, unapproved
      hist({ id: "old", reflectionsApprovedAt: "2026-06-15T00:00:00.000Z", structuredReflections: refl }),
    ])).toEqual([]); // NO fallback to the older approved entry
  });

  it("injects when the newest reflection-bearing entry is approved", () => {
    expect(latestApprovedReflections([
      hist({ id: "new", reflectionsApprovedAt: "2026-06-15T00:00:00.000Z", structuredReflections: refl }),
      hist({ id: "old" }),
    ])).toEqual(refl);
  });

  it("skips newer entries WITHOUT reflections and honors an older approved one", () => {
    expect(latestApprovedReflections([
      hist({ id: "bare", structuredReflections: [] }),                                   // no reflections at all
      hist({ id: "approved", reflectionsApprovedAt: "2026-06-15T00:00:00.000Z", structuredReflections: refl }),
    ])).toEqual(refl);
  });

  it("returns [] for empty history and for entries with empty reflection arrays", () => {
    expect(latestApprovedReflections([])).toEqual([]);
    expect(latestApprovedReflections([hist({ id: "x", structuredReflections: [] })])).toEqual([]);
  });
});
