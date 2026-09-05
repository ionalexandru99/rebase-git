import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  historyOid,
  historyReader,
  mergeHistory,
  renderGraph,
} from "#tests-ui/apps/web/commit-graph/commit-graph-fixture";

describe("commit message scrolling", () => {
  it("reveals every ref without moving the graph, other messages, or metadata", async () => {
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const subject = "A long commit message ".repeat(20);
    const commits = mergeHistory().map((commit, index) =>
      index === 0
        ? { ...commit, subject, parents: [historyOid(1), historyOid(2)] }
        : commit,
    );
    const reader = historyReader({ commits, status: "ready" });
    reader.getRefTargets.mockResolvedValue([
      { name: "main", oid: historyOid(0), type: "branch" },
      { name: "v1", oid: historyOid(0), type: "tag" },
      { name: "stable", oid: historyOid(0), type: "tag" },
      { name: "last-ref", oid: historyOid(0), type: "tag" },
    ]);
    const screen = await renderGraph(reader);
    const row = screen.getByRole("row", { name: /^A long commit message/ });
    const message = row.getByRole("region", {
      name: `Commit message ${subject}`,
    });
    await expect.element(message).toBeVisible();
    const graph = row.getByRole("button", { name: /^Expand merge/ }).element();
    const author = row.getByRole("gridcell", { name: /^Author / }).element();
    const neighbor = screen.getByRole("row", { name: /^Commit 1,/ }).element();
    const text = row.getByText(subject, { exact: true }).element();
    const before = [graph, author, neighbor, text].map(
      (node) => node.getBoundingClientRect().left,
    );
    message.element().focus();
    await userEvent.keyboard("{End}");
    await vi.waitFor(() =>
      expect(message.element().scrollLeft).toBeGreaterThan(0),
    );
    expect(getComputedStyle(message.element()).scrollbarWidth).toBe("none");
    expect(
      [graph, author, neighbor].map(
        (node) => node.getBoundingClientRect().left,
      ),
    ).toEqual(before.slice(0, 3));
    expect(text.getBoundingClientRect().left).toBeLessThan(before[3] ?? 0);
    await expect
      .element(row.getByRole("button", { name: "Copy last-ref" }))
      .toBeVisible();
    row.getByRole("button", { name: "Copy last-ref" }).element().focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith("last-ref"));
    message.element().focus();
    expect(screen.getByRole("grid").element().scrollLeft).toBe(0);
    await userEvent.keyboard("{Home}");
    await vi.waitFor(() => expect(message.element().scrollLeft).toBe(0));
    message.element().dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 120,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await vi.waitFor(() =>
      expect(message.element().scrollLeft).toBeGreaterThan(0),
    );
    await expect.element(row).toHaveAttribute("aria-expanded", "false");
    copy.mockRestore();
  });
});
