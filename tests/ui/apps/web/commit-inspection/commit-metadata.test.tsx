import type { CommitInspection } from "@rebase/contracts/commit-inspection/commit-inspection.contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { CommitMetadata } from "#web-ui/features/commit-inspection/components/commit-metadata";

const details: CommitInspection = {
  oid: "a".repeat(40),
  parentOid: null,
  parents: [],
  message: "Refresh history\n\nKeep the cache fresh.",
  author: {
    name: "Alex",
    email: "alex@example.test",
    date: "2026-09-15T10:00:00Z",
  },
  committer: {
    name: "Jamie",
    email: "jamie@example.test",
    date: "2026-09-15T11:00:00Z",
  },
  files: [],
  truncated: false,
};
const body =
  "First paragraph.\n\nSecond paragraph with the reason for this change.\n\nFinal paragraph with implementation details.";

afterEach(() => vi.restoreAllMocks());

describe("commit metadata", () => {
  it("copies the full SHA from its short label using the keyboard", async () => {
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    const screen = await render(<CommitMetadata details={details} />);
    const copy = screen.getByRole("button", { name: `Copy ${details.oid}` });
    await expect.element(copy).toHaveTextContent(details.oid.slice(0, 8));
    (copy.element() as HTMLButtonElement).focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith(details.oid));
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent(`Copied ${details.oid}`);
  });

  it("expands a long message, collapses it, and resets for another commit", async () => {
    const info = { ...details, message: `Refresh history\n\n${body}` };
    const screen = await render(
      <div style={{ width: 400 }}>
        <CommitMetadata key={info.oid} details={info} />
      </div>,
    );
    const more = screen.getByRole("button", { name: "Show more", exact: true });
    await expect.element(more).toHaveAttribute("aria-expanded", "false");
    const message = screen.getByText(body, { exact: true }).element();
    expect(message.clientHeight).toBeLessThan(message.scrollHeight);
    await more.click();
    await expect
      .element(screen.getByRole("button", { name: "Show less", exact: true }))
      .toHaveAttribute("aria-expanded", "true");
    expect(message.clientHeight).toBe(message.scrollHeight);
    await userEvent.keyboard("{Enter}");
    await expect.element(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await screen.rerender(
      <div style={{ width: 400 }}>
        <CommitMetadata key="next" details={{ ...info, oid: "b".repeat(40) }} />
      </div>,
    );
    await expect
      .element(screen.getByRole("button", { name: "Show more", exact: true }))
      .toHaveAttribute("aria-expanded", "false");
  });

  it("offers expansion only when the message exceeds two lines at the current width", async () => {
    const info = {
      ...details,
      message:
        "Refresh history\n\nKeep repository history fresh without changing the working tree or losing the current selection.",
    };
    const screen = await render(
      <div style={{ width: 800 }}>
        <CommitMetadata details={info} />
      </div>,
    );
    await expect
      .element(
        screen.getByText("Keep repository history fresh", { exact: false }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Show more", exact: true }))
      .not.toBeInTheDocument();
    await screen.rerender(
      <div style={{ width: 210 }}>
        <CommitMetadata details={info} />
      </div>,
    );
    await expect
      .element(screen.getByRole("button", { name: "Show more", exact: true }))
      .toBeVisible();
    await screen.rerender(
      <div style={{ width: 800 }}>
        <CommitMetadata details={info} />
      </div>,
    );
    await expect
      .element(screen.getByRole("button", { name: "Show more", exact: true }))
      .not.toBeInTheDocument();
  });
});
