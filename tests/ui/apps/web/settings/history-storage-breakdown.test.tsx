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
  quotaBytes: 5 * 1024 * 1024,
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

    await expect
      .element(page.getByText("/code/rebase-git · 82,401 commits · Open now"))
      .toBeVisible();
    await expect.element(page.getByText("2.0 MB available")).toBeVisible();
    expect(
      page
        .getByRole("heading", { level: 3 })
        .elements()
        .map((heading) => heading.textContent),
    ).toEqual([
      "rebase-git",
      "api-server",
      "Removed repository",
      "Unknown repository",
    ]);
    await expect
      .element(page.getByText(/^No longer in your projects · 1,230 commits/))
      .toBeVisible();
    await expect
      .element(page.getByText(/^From another environment · 40 commits/))
      .toBeVisible();
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
