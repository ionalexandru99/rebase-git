import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import type { CommitInspection } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { render } from "#tests-support/render.tsx";
import { CommitMetadata } from "#web/features/commit-inspection/components/commit-metadata.tsx";

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
    await expect.poll(() => write).toHaveBeenCalledWith(details.oid);
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent(`Copied ${details.oid}`);
  });

  it("shows the first paragraph until expanded, collapses it, and resets for another commit", async () => {
    const info = { ...details, message: `Refresh history\n\n${body}` };
    const screen = await render(
      <div style={{ width: 400 }}>
        <CommitMetadata key={info.oid} details={info} />
      </div>,
    );
    const more = screen.getByRole("button", { name: "More", exact: true });
    await expect.element(more).toHaveAttribute("aria-expanded", "false");
    await expect
      .element(screen.getByText("First paragraph.", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Second paragraph", { exact: false }))
      .not.toBeInTheDocument();
    await more.click();
    await expect
      .element(screen.getByRole("button", { name: "Less", exact: true }))
      .toHaveAttribute("aria-expanded", "true");
    await expect.element(screen.getByText(body, { exact: true })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect.element(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await screen.rerender(
      <div style={{ width: 400 }}>
        <CommitMetadata key="next" details={{ ...info, oid: "b".repeat(40) }} />
      </div>,
    );
    await expect
      .element(screen.getByRole("button", { name: "More", exact: true }))
      .toHaveAttribute("aria-expanded", "false");
  });

  it("offers expansion only when the title or message is clipped at the current width", async () => {
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
      .element(screen.getByRole("button", { name: "More", exact: true }))
      .not.toBeInTheDocument();
    await screen.rerender(
      <div style={{ width: 210 }}>
        <CommitMetadata details={info} />
      </div>,
    );
    await expect
      .element(screen.getByRole("button", { name: "More", exact: true }))
      .toBeVisible();
    await screen.rerender(
      <div style={{ width: 800 }}>
        <CommitMetadata details={info} />
      </div>,
    );
    await expect
      .element(screen.getByRole("button", { name: "More", exact: true }))
      .not.toBeInTheDocument();
  });

  it("joins hard-wrapped lines and keeps list items on their own lines", async () => {
    const screen = await render(
      <div style={{ width: 400 }}>
        <CommitMetadata
          details={{
            ...details,
            message:
              "Refresh history\n\nThe cache went stale\nafter a fetch.\n\n- Refresh on fetch\n- Keep the\nselection",
          }}
        />
      </div>,
    );
    await screen.getByRole("button", { name: "More", exact: true }).click();
    await expect
      .poll(
        () =>
          screen.getByText("The cache went stale", { exact: false }).element()
            .textContent,
      )
      .toBe(
        "The cache went stale after a fetch.\n\n- Refresh on fetch\n- Keep the selection",
      );
  });
});
