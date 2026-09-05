import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  history,
  historyReader,
  renderGraph,
} from "#tests-ui/apps/web/commit-graph/commit-graph-fixture";

describe("commit graph layout", () => {
  it("keeps wide merge rails and buttons beneath the fixed metadata", async () => {
    const commits = history(193).map((commit, index) => ({
      ...commit,
      parents: (index < 64
        ? [index + 64, index + 128]
        : index < 192
          ? [192]
          : []
      ).map((parent) => parent.toString(16).padStart(40, "0")),
    }));
    const roots = commits.slice(0, 64).map((commit, index) => ({
      name: `branch-${index}`,
      oid: commit.oid,
      type: "branch" as const,
    }));
    const reader = historyReader({ commits, status: "ready" });
    const screen = await renderGraph(reader, roots);
    const grid = screen.getByRole("grid").element();
    await expect
      .element(screen.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    grid.scrollTop = 38 * 26;
    grid.dispatchEvent(new Event("scroll"));
    for (const [index, label] of [
      [40, /^Author /],
      [46, /^Commit SHA /],
      [52, /^Commit date /],
    ] as const) {
      const row = screen.getByRole("row", {
        name: new RegExp(`^Commit ${index},`),
      });
      await expect.element(row).toBeVisible();
      const metadata = row.getByRole("gridcell", { name: label }).element();
      const button = screen
        .getByRole("button", { name: `Expand merge Commit ${index}` })
        .element();
      const point = () => {
        const bounds = button.getBoundingClientRect();
        return {
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        };
      };
      const assertCovered = () => {
        const { x, y } = point();
        const bounds = metadata.getBoundingClientRect();
        expect(x).toBeGreaterThan(bounds.left);
        expect(x).toBeLessThan(bounds.right);
        expect(document.elementFromPoint(x, y)?.closest("td")).toBe(metadata);
        const background = document.createElement("canvas").getContext("2d");
        if (background === null)
          throw new Error("Missing color sampling context");
        background.fillStyle = getComputedStyle(metadata).backgroundColor;
        background.fillRect(0, 0, 1, 1);
        expect(background.getImageData(0, 0, 1, 1).data[3]).toBe(255);
        const tile = [...grid.querySelectorAll("canvas")].find((canvas) => {
          const bounds = canvas.getBoundingClientRect();
          return (
            x >= bounds.left &&
            x < bounds.right &&
            y >= bounds.top &&
            y < bounds.bottom
          );
        });
        if (tile === undefined)
          throw new Error("Expected a graph tile beneath metadata");
        const tileRow = tile.closest("tr");
        if (tileRow === null) throw new Error("Missing graph tile row");
        expect(Number(getComputedStyle(metadata).zIndex)).toBeGreaterThan(
          Number(getComputedStyle(tileRow).zIndex),
        );
      };
      await vi.waitFor(assertCovered);
      await row.getByRole("gridcell", { name: label }).click();
      assertCovered();
      await expect.element(row).toHaveAttribute("aria-expanded", "false");
      await expect.element(row).toHaveAttribute("aria-selected", "true");
      await userEvent.keyboard("{ArrowRight}");
      await expect.element(row).toHaveAttribute("aria-expanded", "true");
      await userEvent.keyboard("{ArrowLeft}");
      await expect.element(row).toHaveAttribute("aria-expanded", "false");
    }
  });

  it("moves painted nodes and text together before scroll handlers run", async () => {
    const screen = await renderGraph(
      historyReader({ commits: history(100), status: "ready" }),
    );
    const grid = screen.getByRole("grid").element();
    const row = screen.getByRole("row", { name: /^Commit 2,/ });
    await expect.element(row).toBeVisible();
    const canvas = grid.querySelector("canvas");
    if (canvas === null) throw new Error("Missing graph canvas");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Missing graph context");
    const ratio = canvas.width / Number.parseFloat(canvas.style.width);
    const pixel = context.getImageData(
      Math.round(19 * ratio),
      Math.round(65 * ratio),
      1,
      1,
    ).data;
    expect(pixel[3]).toBeGreaterThan(0);
    const before =
      canvas.getBoundingClientRect().top +
      65 -
      (row.element().getBoundingClientRect().top + 13);
    grid.scrollTop = 13;
    const after =
      canvas.getBoundingClientRect().top +
      65 -
      (row.element().getBoundingClientRect().top + 13);
    expect(before).toBe(0);
    expect(after).toBe(0);
    expect(row.element().getBoundingClientRect().height).toBe(26);
  });

  it("pins metadata over long messages and uses matching solid and tinted branch pills", async () => {
    const commits = history(4).map((commit, index) => ({
      ...commit,
      subject: index === 2 ? "Long message ".repeat(50) : commit.subject,
      author: { ...commit.author, name: "Alexandru Ion" },
    }));
    const reader = historyReader({ commits, status: "ready" });
    reader.getRefTargets.mockResolvedValue([
      { type: "branch", name: "main", oid: commits[0]?.oid ?? "" },
      {
        type: "remote-branch",
        name: "origin/main",
        oid: commits[1]?.oid ?? "",
      },
    ]);
    const screen = await renderGraph(reader);
    const local = screen
      .getByRole("row", { name: /^Commit 0,/ })
      .getByRole("button", { name: "Copy main", exact: true });
    const remote = screen
      .getByRole("row", { name: /^Commit 1,/ })
      .getByRole("button", { name: "Copy origin/main", exact: true });
    await expect.element(local).toBeVisible();
    await expect.element(remote).toBeVisible();
    const filled = getComputedStyle(local.element());
    const hollow = getComputedStyle(remote.element());
    expect(filled.backgroundColor).toBe(hollow.color);
    expect(hollow.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    const author = screen
      .getByRole("row", { name: /^Long message/ })
      .getByRole("gridcell", { name: "Author Alexandru Ion" })
      .element();
    const bounds = author.getBoundingClientRect();
    expect(bounds.width).toBe(149);
    expect(
      document
        .elementFromPoint(bounds.left + 3, bounds.top + 13)
        ?.closest("td"),
    ).toBe(author);
    const firstRow = local.element().closest("tr");
    expect(firstRow?.children[1]?.getBoundingClientRect().left ?? 0).toBe(
      (firstRow?.getBoundingClientRect().left ?? 0) + 28,
    );
  });
});
