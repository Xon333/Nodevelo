import { describe, expect, it } from "vitest";
import {
  RETROSPECTIVE_TOOL,
  RetrospectiveToolSchema,
} from "./retrospective-schema";
import type { StructuredReflection } from "./types";

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
