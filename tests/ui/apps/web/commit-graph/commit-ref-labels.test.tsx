import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { CommitRefLabels } from "#web-ui/features/commit-graph/components/commit-ref-labels";
import { GraphRefAppearance } from "#web-ui/features/commit-graph/components/graph-ref-appearance";

afterEach(() => vi.restoreAllMocks());

describe("commit reference pills", () => {
  it("copies the branch name without its remote on keyboard activation and preserves pill width", async () => {
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const screen = await render(
      <GraphRefAppearance
        colors={new Map([["origin/feature/cache", "#2DD4BF"]])}
        remoteProviders={[{ remote: "origin", provider: "github" }]}
      >
        <CommitRefLabels
          labels={[
            { name: "origin/feature/cache", oid: "a", type: "remote-branch" },
          ]}
        />
      </GraphRefAppearance>,
    );
    const pill = screen.getByRole("button", {
      name: "Copy feature/cache",
    });
    expect(pill.element().textContent).toBe("feature/cache");
    expect(pill.element().querySelector("svg")).not.toBeNull();
    await document.fonts.ready;
    const width = pill.element().getBoundingClientRect().width;
    pill.element().focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith("feature/cache"));
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Copied feature/cache");
    expect(pill.element().getBoundingClientRect().width).toBe(width);
    await expect.element(screen.getByRole("status")).toHaveTextContent("");
  });

  it("keeps local refs and tags when the remote tip is on the same commit", async () => {
    const screen = await render(
      <CommitRefLabels
        labels={[
          { name: "main", oid: "a", type: "branch" },
          { name: "origin/main", oid: "a", type: "remote-branch" },
          { name: "v1", oid: "a", type: "tag" },
        ]}
      />,
    );
    await expect
      .element(screen.getByRole("button", { name: "Copy main", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Copy v1", exact: true }))
      .toBeVisible();
    expect(
      screen.getByRole("button", { name: "Copy main", exact: true }).all(),
    ).toHaveLength(1);
  });

  it("reports a failed clipboard write inside the pill", async () => {
    vi.spyOn(document, "execCommand").mockReturnValue(false);
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("Unavailable"),
    );
    const screen = await render(
      <CommitRefLabels
        labels={[{ name: "feature/cache", oid: "a", type: "branch" }]}
      />,
    );
    await screen.getByRole("button", { name: "Copy feature/cache" }).click();
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Could not copy feature/cache");
  });

  it("falls back to selection copying after an async clipboard rejection", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("Denied"),
    );
    const fallback = vi
      .spyOn(document, "execCommand")
      .mockImplementation(() => {
        const field = document.activeElement;
        expect(field).toBeInstanceOf(HTMLTextAreaElement);
        expect((field as HTMLTextAreaElement).value).toBe("main");
        return true;
      });
    const screen = await render(
      <CommitRefLabels
        labels={[{ name: "origin/main", oid: "a", type: "remote-branch" }]}
      />,
    );
    const pill = screen.getByRole("button", { name: "Copy main" });
    pill.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Copied main");
    expect(fallback).toHaveBeenCalledWith("copy");
    expect(document.activeElement).toBe(pill.element());
    expect(document.querySelector("textarea")).toBeNull();
  });
});
