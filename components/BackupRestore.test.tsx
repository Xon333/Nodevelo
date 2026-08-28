// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import BackupRestore from "./BackupRestore";

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.stubGlobal("fetch", h.fetch);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function selectBackup(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]');
  expect(input).not.toBeNull();
  const file = new File([JSON.stringify({ app: "nodevelo" })], "backup.json", { type: "application/json" });
  fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
}

function hasReloadTimer(spy: { mock: { calls: Array<[TimerHandler, number?]> } }) {
  return spy.mock.calls.some(([fn, delay]) => delay === 1000 && String(fn).includes("window.location.reload"));
}

describe("BackupRestore", () => {
  it("confirms the exact snapshot replacement before restoring", async () => {
    const { container } = render(<BackupRestore />);

    selectBackup(container);

    expect(screen.getByText(/exact backup snapshot/i)).toBeTruthy();
    expect(screen.getByText(/Files not in the backup will be removed\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace with backup" })).toBeTruthy();
    expect(screen.getByText(/Keep the backup file: a process or machine crash during the final swap can interrupt restoration\./)).toBeTruthy();
  });

  it("shows the restored count and schedules a reload on success", async () => {
    h.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, restored: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const { container } = render(<BackupRestore />);

    selectBackup(container);
    fireEvent.click(screen.getByRole("button", { name: "Replace with backup" }));

    expect(
      await screen.findByText("Restored the complete backup snapshot (2 files). Reloading…")
    ).toBeTruthy();
    expect(hasReloadTimer(timeoutSpy)).toBe(true);
  });

  it("surfaces API failures without partial-success wording or a reload timer", async () => {
    h.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Restore failed. Your previous data was put back." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const { container } = render(<BackupRestore />);

    selectBackup(container);
    fireEvent.click(screen.getByRole("button", { name: "Replace with backup" }));

    expect(await screen.findByText("Restore failed. Your previous data was put back.")).toBeTruthy();
    expect(screen.queryByText(/Restored the complete backup snapshot/i)).toBeNull();
    expect(screen.queryByText(/couldn't be restored/i)).toBeNull();
    expect(hasReloadTimer(timeoutSpy)).toBe(false);
  });

  it("falls back cleanly on a malformed non-JSON response", async () => {
    h.fetch.mockResolvedValueOnce(new Response("not json", { status: 500 }));
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const { container } = render(<BackupRestore />);

    selectBackup(container);
    fireEvent.click(screen.getByRole("button", { name: "Replace with backup" }));

    expect(
      await screen.findByText(
        "Restore status could not be confirmed. Keep the backup file and restore it again before using NodeVelo."
      )
    ).toBeTruthy();
    expect(screen.queryByText(/current data was unchanged/i)).toBeNull();
    expect(hasReloadTimer(timeoutSpy)).toBe(false);
  });
});
