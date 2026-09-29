import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import type { HistoryCacheAction } from "#web/features/history-storage/use-history-cache-management.ts";
import type {
  HistorySnapshot,
  HistoryStorage,
} from "#web/features/repository-history/history-worker-protocol.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { RepositoryCacheSettings } from "#web/features/repository-settings/components/repository-cache-settings.tsx";
import { createStore } from "#web/platform/store/store.ts";

const identity = {
  environmentId: "environment-1",
  repositoryId: "repository-1",
};
const diagnostics: HistoryStorage = {
  usageBytes: 2048,
  quotaBytes: 4096,
  caches: [
    {
      ...identity,
      estimatedBytes: 1024,
      commitCount: 12,
      lastOpenedAt: 2,
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
  const store = createStore<HistorySnapshot>({
    status: "ready",
    revision: 1,
    synchronization: "complete",
    commitCount: 12,
    refTargets: [],
  });
  const getCacheDiagnostics = vi.fn(async () => diagnostics);
  const manageCache = vi.fn(async (_action: HistoryCacheAction) => {});
  const history: RepositoryHistory = {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    ask: async (query) => {
      if (query._tag !== "Storage") throw new Error("Unexpected query");
      if (query.action !== "inspect") await manageCache(query.action);
      return (await getCacheDiagnostics()) as never;
    },
    synchronize: () => {},
    close: () => {},
  };
  return {
    ...history,
    getCacheDiagnostics,
    manageCache,
    publish: (value: HistorySnapshot) => store.set(value),
  };
}

async function openDialog(reader = historyReader()) {
  const changed = vi.fn();
  const screen = await render(
    <RepositoryCacheSettings
      connected
      history={reader}
      identity={identity}
      onCacheChanged={changed}
    />,
  );
  await screen.getByText("Storage details", { exact: true }).click();
  return { screen, reader, changed };
}

describe("repository history storage", () => {
  it("shows the repository cache size and protection details", async () => {
    await openDialog();
    await expect.element(page.getByText(/1.0 KB/)).toBeVisible();
    await expect
      .element(page.getByText(/Open repositories are protected/))
      .toBeVisible();
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

  it.each(["clear", "rebuild", "remove"] as const)(
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
      await expect.poll(() => changed.mock.calls).toEqual([[action, identity]]);
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
    finish?.();
    reader.publish({
      status: "ready",
      revision: 2,
      synchronization: "syncing",
      commitCount: 256,
      refTargets: [],
    });
    await expect
      .element(page.getByText("Synchronizing history · 256 commits stored"))
      .toBeVisible();
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
      synchronization: "idle",
      commitCount: 0,
      refTargets: [],
      failure: { _tag: "StorageUnavailable" },
    });
    await openDialog(reader);
    await expect
      .element(
        page.getByText("Unable to read history storage. Try refreshing."),
      )
      .toBeVisible();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
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
