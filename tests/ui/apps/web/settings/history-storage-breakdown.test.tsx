import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import { catalogEntry } from "#tests-support/fixtures.ts";
import { historyCache } from "#tests-support/history.ts";
import { render } from "#tests-support/render.tsx";
import { HistoryStorageBreakdown } from "#web/features/history-storage/history-storage-breakdown.tsx";
import type { HistoryStorage } from "#web/features/repository-history/history-worker-protocol.ts";

const environmentId = "00000000-0000-4000-8000-000000000100";

const storage: HistoryStorage = {
  usageBytes: 3 * 1024 * 1024,
  quotaBytes: 10 * 1024 * 1024 * 1024,
  caches: [
    historyCache({
      environmentId,
      repositoryId: "api-server",
      commitCount: 12_904,
    }),
    historyCache({
      environmentId,
      repositoryId: "rebase-logical",
      commitCount: 82_401,
      open: true,
    }),
    historyCache({
      environmentId,
      repositoryId: "forgotten",
      commitCount: 1_230,
    }),
    historyCache({ repositoryId: "api-server", commitCount: 40 }),
    historyCache({
      environmentId,
      repositoryId: "never-synced",
      commitCount: 0,
    }),
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
                logicalRepositoryId: "rebase-logical",
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
  it("names stored repositories by their history key, largest first, and hides empty closed caches", async () => {
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
      expect.stringMatching(/^Unknown repositoryFrom another environment40/),
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
