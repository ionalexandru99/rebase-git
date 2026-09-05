import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type {
  RepositoryHistoryReader,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/repository-history-reader.contract";
import { RepositoryHistoryStorageUnavailable } from "#web/features/repository-history/repository-history-reader.contract";
import type { RepositoryHistoryStorageDiagnostics } from "#web/features/repository-history/repository-history-storage.contract";
import { RepositoryHistoryCacheButton } from "#web-ui/features/repository-history/diagnostics/repository-history-cache-dialog";

const identity = {
  environmentId: "environment-1",
  repositoryId: "repository-1",
};
const diagnostics: RepositoryHistoryStorageDiagnostics = {
  persistent: true,
  usageBytes: 2048,
  quotaBytes: 4096,
  caches: [
    {
      ...identity,
      estimatedBytes: 1024,
      commitCount: 12,
      lastOpenedAt: undefined,
      open: true,
      state: "complete",
    },
    {
      environmentId: "environment-2",
      repositoryId: "repository-2",
      estimatedBytes: 512,
      commitCount: 5,
      lastOpenedAt: 1,
      open: false,
      state: "partial",
    },
  ],
};

function historyReader() {
  const listeners = new Set<() => void>();
  let snapshot: RepositoryHistorySnapshot = {
    status: "ready",
    revision: 1,
    historyRevision: 1,
    synchronization: "complete",
  };
  return {
    locateMany: vi.fn(async () => []),
    ancestryRoute: vi.fn(async () => undefined),
    locate: vi.fn(async () => undefined),
    fetch: vi.fn<RepositoryHistoryReader["fetch"]>(),
    configureFetch: vi.fn<RepositoryHistoryReader["configureFetch"]>(),
    close: vi.fn(),
    search: vi.fn(async () => ({
      commits: [],
      replicaComplete: false,
      synchronizedCommitCount: 0,
    })),
    getCommitSummaries: vi.fn(async () => []),
    getRefTargets: vi.fn(async () => []),
    read: vi.fn(async () => []),
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getCacheDiagnostics: vi.fn(async () => diagnostics),
    manageCache: vi.fn(async () => {}),
    publish(value: RepositoryHistorySnapshot) {
      snapshot = value;
      for (const listener of listeners) listener();
    },
  } satisfies RepositoryHistoryReader & {
    publish: (value: RepositoryHistorySnapshot) => void;
  };
}

async function openDialog(reader = historyReader()) {
  const changed = vi.fn();
  const screen = await render(
    <RepositoryHistoryCacheButton
      reader={reader}
      identity={identity}
      repositoryName="Rebase"
      onCacheChanged={changed}
    />,
  );
  await screen.getByRole("button", { name: "History storage" }).click();
  return { screen, reader, changed };
}

describe("history storage dialog", () => {
  it("lists cache estimates, persistence and open protection, and closes with Escape", async () => {
    const { screen } = await openDialog();
    await expect
      .element(page.getByRole("table", { name: "Repository history caches" }))
      .toBeVisible();
    await expect.element(page.getByText("Rebase (current)")).toBeVisible();
    await expect
      .element(page.getByText("repository-2", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("Persistent", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("Open · Protected")).toBeVisible();
    await expect
      .element(page.getByText("1.0 KB", { exact: true }))
      .toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "History storage" }))
      .toHaveFocus();
  });

  it("requires confirmation and leaves history untouched when cancelled", async () => {
    const { reader } = await openDialog();
    await page
      .getByRole("button", { name: "Clear cache", exact: true })
      .click();
    const confirmation = page.getByRole("alertdialog");
    await expect.element(confirmation).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(confirmation).not.toBeInTheDocument();
    expect(reader.manageCache).not.toHaveBeenCalled();
    await expect
      .element(page.getByRole("button", { name: "Clear cache", exact: true }))
      .toHaveFocus();
  });

  it("reports a successful removal separately from a failed view refresh", async () => {
    const { reader, changed } = await openDialog();
    changed.mockRejectedValueOnce(new Error("View refresh failed"));
    await page
      .getByRole("button", { name: "Remove cache", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove cache", exact: true })
      .click();
    await expect
      .element(
        page.getByText("Cache removed. Reopen the repository to load history."),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          "The cache changed, but the repository view could not refresh. Reopen the repository to update it.",
        ),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Rebuild cache", exact: true }))
      .toBeDisabled();
    expect(reader.manageCache).toHaveBeenCalledExactlyOnceWith("remove");
  });

  it.each(["clear", "rebuild", "remove", "clear-all"] as const)(
    "confirms %s and reports the affected identity",
    async (action) => {
      const labels = {
        clear: "Clear cache",
        rebuild: "Rebuild cache",
        remove: "Remove cache",
        "clear-all": "Clear all caches",
      };
      const { reader, changed } = await openDialog();
      await page
        .getByRole("button", { name: labels[action], exact: true })
        .click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: labels[action], exact: true })
        .click();
      await expect
        .poll(() => reader.manageCache.mock.calls)
        .toEqual([[action]]);
      await expect
        .poll(() => changed.mock.calls)
        .toEqual([[action, action === "clear-all" ? undefined : identity]]);
      await expect
        .element(page.getByRole("alertdialog"))
        .not.toBeInTheDocument();
      if (action === "remove")
        await expect
          .element(
            page.getByRole("button", { name: "Rebuild cache", exact: true }),
          )
          .toBeDisabled();
    },
  );

  it("shows action progress without trapping the user, then shows synchronization progress", async () => {
    const reader = historyReader();
    let finish: (() => void) | undefined;
    reader.manageCache.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await openDialog(reader);
    await page
      .getByRole("button", { name: "Rebuild cache", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Rebuild cache", exact: true })
      .click();
    await expect
      .element(page.getByText("Updating history storage…"))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Clear cache", exact: true }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Close", exact: true }))
      .toBeEnabled();
    finish?.();
    reader.publish({
      status: "ready",
      revision: 2,
      historyRevision: 2,
      synchronization: "syncing",
      synchronizedCommitCount: 256,
    });
    await expect
      .element(page.getByText("Synchronizing history · 256 commits stored"))
      .toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("recovers diagnostics and action failures and explains exhausted storage", async () => {
    const reader = historyReader();
    reader.getCacheDiagnostics.mockRejectedValueOnce(
      new Error("Storage unavailable"),
    );
    reader.getCacheDiagnostics.mockResolvedValue({
      ...diagnostics,
      usageBytes: 4096,
    });
    reader.manageCache.mockRejectedValueOnce(new Error("Quota exceeded"));
    reader.publish({
      status: "error",
      revision: 2,
      historyRevision: 2,
      error: new RepositoryHistoryStorageUnavailable(),
    });
    await openDialog(reader);
    await expect
      .element(
        page.getByText("Unable to read history storage. Try refreshing."),
      )
      .toBeVisible();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect
      .element(page.getByText(/Browser storage is full/))
      .toBeVisible();
    await page
      .getByRole("button", { name: "Clear cache", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Clear cache", exact: true })
      .click();
    await expect
      .element(
        page.getByText(
          "The cache action could not finish. Refresh storage details and try again.",
        ),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Rebuild cache", exact: true }))
      .toBeEnabled();
  });
});
