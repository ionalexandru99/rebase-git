import type { RepositoryCommit } from "@rebase/contracts";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  type RepositoryHistoryReader,
  type RepositoryHistorySnapshot,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";
import { CommitGraph } from "#web-ui/features/commit-graph/commit-graph";

describe("commit graph", () => {
  it("shows background synchronization without covering the graph", async () => {
    const reader = historyReader({ commits: history(2), status: "ready" });
    reader.snapshot = {
      revision: 1,
      status: "ready",
      synchronization: "syncing",
      synchronizedCommitCount: 256,
    };
    const screen = await renderGraph(reader);

    await expect.element(screen.getByText("Syncing")).toBeVisible();
    await expect
      .element(screen.getByRole("option", { name: /^Commit 0,/ }))
      .toBeVisible();
  });

  it("keeps the selected row and viewport anchored while refs reconcile", async () => {
    const commits = history(100);
    const firstCommit = commits[0];
    if (firstCommit === undefined) {
      throw new Error("Commit fixture is missing");
    }
    let finishReconciliation:
      | ((commits: readonly RepositoryCommit[]) => void)
      | undefined;
    const reconciliation = new Promise<readonly RepositoryCommit[]>(
      (resolve) => {
        finishReconciliation = resolve;
      },
    );
    const reader = historyReader({ commits, status: "ready" });
    reader.read
      .mockResolvedValueOnce(commits)
      .mockReturnValueOnce(reconciliation);
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("listbox", { name: "Commit history" });
    grid.element().scrollTop = 20 * 36 + 7;
    grid.element().dispatchEvent(new Event("scroll"));
    const selected = grid.getByRole("option", { name: /^Commit 22,/ });
    await expect.element(selected).toBeVisible();
    await selected.click();

    await screen.rerender(
      <div style={{ height: 520, width: 900 }}>
        <CommitGraph
          reader={reader}
          repositoryName="rebase-test"
          roots={[
            { name: "main", oid: "e".repeat(40), type: "branch" as const },
          ]}
        />
      </div>,
    );

    await expect.element(selected).toHaveAttribute("aria-selected", "true");
    expect(grid.element().scrollTop).toBe(20 * 36 + 7);
    finishReconciliation?.([
      {
        ...firstCommit,
        oid: "e".repeat(40),
        parents: [firstCommit.oid],
        subject: "New tip",
      },
      ...commits,
    ]);
    await expect
      .element(grid.getByRole("option", { name: /^Commit 22,/ }))
      .toHaveAttribute("aria-selected", "true");
    await vi.waitFor(() => expect(grid.element().scrollTop).toBe(21 * 36 + 7));
  });

  it("keeps stale history visible and offers a retry", async () => {
    const reader = historyReader({ commits: history(2), status: "ready" });
    reader.snapshot = {
      error: new RepositoryHistoryUnavailable(),
      revision: 2,
      status: "ready",
      synchronization: "stale",
      synchronizedCommitCount: 2,
    };
    const screen = await renderGraph(reader);

    await expect
      .element(screen.getByRole("option", { name: /^Commit 0,/ }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Stale. Retry" }).click();
    expect(reader.read).toHaveBeenCalledTimes(2);
  });

  it("renders 100 connected commits with bounded semantic rows and selection", async () => {
    const commits = history(100);
    const reader = historyReader({ commits, status: "ready" });
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("listbox", { name: "Commit history" });

    await expect
      .element(grid.getByRole("option", { name: /Commit 0/ }))
      .toHaveAttribute("aria-setsize", "100");
    await expect
      .element(grid.getByRole("option", { name: /Commit 0/ }))
      .toBeVisible();
    expect(grid.getByRole("option").all().length).toBeLessThan(40);
    await expect.element(grid.getByRole("presentation")).toBeInTheDocument();
    expect(document.querySelector("canvas")).not.toBeNull();

    const second = grid.getByRole("option", { name: /^Commit 1,/ });
    await second.click();
    await expect.element(second).toHaveAttribute("aria-selected", "true");
    grid.element().focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(grid.getByRole("option", { name: /^Commit 2,/ }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("shows loading, empty, and failure states without hiding retry", async () => {
    let rejectLoad: ((error: unknown) => void) | undefined;
    const pending = new Promise<readonly RepositoryCommit[]>((_, reject) => {
      rejectLoad = reject;
    });
    const reader = historyReader({ commits: [], pending, status: "loading" });
    const screen = await renderGraph(reader);

    await expect
      .element(screen.getByRole("status", { name: "Loading commit history" }))
      .toBeVisible();
    reader.snapshot = {
      error: new RepositoryHistoryUnavailable(),
      revision: 1,
      status: "error",
    };
    rejectLoad?.(new RepositoryHistoryUnavailable());
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Commit history is unavailable");

    reader.read.mockResolvedValue([]);
    await screen.getByRole("button", { name: "Retry" }).click();
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("This repository has no commits yet.");
    expect(reader.read).toHaveBeenCalledTimes(2);
  });

  it("shows an unborn repository without requesting Git history", async () => {
    const reader = historyReader({ commits: [], status: "empty" });
    const screen = await renderGraph(reader, []);

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("This repository has no commits yet.");
    expect(reader.read).not.toHaveBeenCalled();
  });

  it("starts loading before the reader is available", async () => {
    const screen = await render(
      <div style={{ height: 520, width: 900 }}>
        <CommitGraph
          reader={undefined}
          repositoryName="rebase-test"
          roots={undefined}
        />
      </div>,
    );

    await expect
      .element(screen.getByRole("status", { name: "Loading commit history" }))
      .toBeVisible();
    await expect
      .element(screen.getByText("This repository has no commits yet."))
      .not.toBeInTheDocument();
  });

  it("removes the previous repository rows before a replacement read fails", async () => {
    const first = historyReader({ commits: history(2), status: "ready" });
    const screen = await renderGraph(first);
    await expect
      .element(screen.getByRole("option", { name: /^Commit 0,/ }))
      .toBeVisible();
    let rejectRead: ((error: unknown) => void) | undefined;
    const pending = new Promise<readonly RepositoryCommit[]>((_, reject) => {
      rejectRead = reject;
    });
    const second = historyReader({ commits: [], pending, status: "loading" });

    await screen.rerender(
      <div style={{ height: 520, width: 900 }}>
        <CommitGraph
          reader={second}
          repositoryName="replacement"
          roots={[
            { name: "main", oid: "e".repeat(40), type: "branch" as const },
          ]}
        />
      </div>,
    );
    second.snapshot = {
      error: new RepositoryHistoryUnavailable(),
      revision: 1,
      status: "error",
    };
    rejectRead?.(new RepositoryHistoryUnavailable());

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Commit history is unavailable");
    await expect
      .element(screen.getByRole("option", { name: /^Commit 0,/ }))
      .not.toBeInTheDocument();
  });
});

async function renderGraph(
  reader: ReturnType<typeof historyReader>,
  roots = [{ name: "main", oid: "f".repeat(40), type: "branch" as const }],
) {
  return render(
    <div style={{ height: 520, width: 900 }}>
      <CommitGraph reader={reader} repositoryName="rebase-test" roots={roots} />
    </div>,
  );
}

function historyReader({
  commits,
  pending,
  status,
}: {
  readonly commits: readonly RepositoryCommit[];
  readonly pending?: Promise<readonly RepositoryCommit[]>;
  readonly status: "empty" | "loading" | "ready";
}) {
  let snapshot: RepositoryHistorySnapshot = { revision: 0, status };
  const reader = {
    close: vi.fn(),
    getCommitSummaries: vi.fn(async () => commits),
    getRefTargets: vi.fn(async () => []),
    getSnapshot: (): RepositoryHistorySnapshot => snapshot,
    read: vi.fn(() => pending ?? Promise.resolve(commits)),
    get snapshot() {
      return snapshot;
    },
    set snapshot(value: RepositoryHistorySnapshot) {
      snapshot = value;
    },
    subscribe: vi.fn(() => () => undefined),
  } satisfies RepositoryHistoryReader & {
    snapshot: RepositoryHistorySnapshot;
  };
  return reader;
}

function history(count: number): readonly RepositoryCommit[] {
  return Array.from({ length: count }, (_, index) => ({
    author: identity(index),
    committer: identity(index),
    oid: index.toString(16).padStart(40, "0"),
    parents:
      index === count - 1 ? [] : [(index + 1).toString(16).padStart(40, "0")],
    subject: `Commit ${index}`,
  }));
}

function identity(index: number) {
  return {
    email: "alex@example.test",
    name: "Alex I.",
    timestampSeconds: 1_777_777_777 - index,
    timezoneOffsetMinutes: 120,
  };
}
