import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import { catalogEntry } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { HistoryStorageBreakdown } from "#web/features/history-storage/history-storage-breakdown.tsx";
import type {
  HistoryCache,
  HistoryStorage,
} from "#web/features/repository-history/history-worker-protocol.ts";

const environmentId = "00000000-0000-4000-8000-000000000100";

function cache(entry: Partial<HistoryCache>): HistoryCache {
  return {
    environmentId,
    repositoryId: "repository",
    estimatedBytes: 1024,
    commitCount: 1,
    lastOpenedAt: 0,
    open: false,
    state: "complete",
    ...entry,
  };
}

const storage: HistoryStorage = {
  persistent: false,
  usageBytes: 3 * 1024 * 1024,
  quotaBytes: 10 * 1024 * 1024 * 1024,
  caches: [
    cache({ repositoryId: "api-server", commitCount: 12_904 }),
    cache({ repositoryId: "rebase-git", commitCount: 82_401, open: true }),
    cache({ repositoryId: "forgotten", commitCount: 1_230 }),
    cache({ repositoryId: "never-synced", commitCount: 0 }),
  ],
};

async function renderBreakdown() {
  const onClear = vi.fn();
  await render(
    <HistoryStorageBreakdown
      storage={storage}
      pending={false}
      onClear={onClear}
    />,
    {
      environment: {
        requests: fakeRequests(
          respond(RepositoryCatalogApi.list, () => ({
            repositories: [
              catalogEntry({
                id: "rebase-git",
                name: "rebase-git",
                path: "/code/rebase-git",
              }),
              catalogEntry({
                id: "api-server",
                name: "api-server",
                path: "/code/api-server",
              }),
            ],
          })),
        ),
      },
    },
  );
  return onClear;
}

describe("history storage breakdown", () => {
  it("names stored repositories, largest first, and hides empty closed caches", async () => {
    await renderBreakdown();

    await expect.element(page.getByText("/code/rebase-git")).toBeVisible();
    await expect
      .element(page.getByText("10.0 GB available in this browser"))
      .toBeVisible();
    const rows = page.getByRole("row").elements().slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^rebase-git.*82,401Open now/),
      expect.stringMatching(/^api-server.*12,904/),
      expect.stringMatching(
        /^Removed repositoryNo longer in your projects1,230/,
      ),
    ]);
  });

  it("clears one repository's history", async () => {
    const onClear = await renderBreakdown();

    await page
      .getByRole("button", { name: "Clear history for api-server" })
      .click();

    expect(onClear).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ environmentId, repositoryId: "api-server" }),
    );
  });
});
