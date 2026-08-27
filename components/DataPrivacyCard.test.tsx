/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DataPrivacyCard from "./DataPrivacyCard";

describe("DataPrivacyCard", () => {
  it("separates local persistence from remote Anthropic processing", () => {
    render(<DataPrivacyCard />);

    expect(screen.getByText("Stored locally.")).toBeDefined();
    expect(screen.getByText("Processed remotely by Anthropic.")).toBeDefined();
    expect(screen.getByText(/Intent parsing is deterministic and does not contact Anthropic/)).toBeDefined();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("Stored locally.");
    expect(items[0].textContent).not.toContain("Processed remotely by Anthropic.");
    expect(items[1].textContent).toContain("Processed remotely by Anthropic.");
    expect(items[1].textContent).toContain("Anthropic");

    expect(screen.getByText("Stored locally.").tagName).toBe("STRONG");
    expect(screen.getByText("Processed remotely by Anthropic.").tagName).toBe("STRONG");
  });
});
