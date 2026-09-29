import { expect, it, onTestFinished } from "vite-plus/test";
import { openRepositoryHistory } from "#web/features/repository-history/repository-history.ts";

it("releases the history of a tab that closes without closing its history", async () => {
  const observer = openRepositoryHistory();
  onTestFinished(() => observer.close());
  const repositoryId = crypto.randomUUID();
  const query = new URLSearchParams({
    environment: crypto.randomUUID(),
    repository: repositoryId,
  });
  const tab = window.open(
    `${location.origin}/tests/integration/apps/web/repository-history/fixtures/history-tab.html?${query}`,
  );
  onTestFinished(() => tab?.close());
  const open = async () => {
    const storage = await observer.ask({ _tag: "Storage", action: "inspect" });
    return storage.caches.find((cache) => cache.repositoryId === repositoryId)
      ?.open;
  };

  await expect.poll(open).toBe(true);
  tab?.close();

  await expect.poll(open).toBe(false);
});

it("clears the stored history of a closed repository", async () => {
  const observer = openRepositoryHistory();
  onTestFinished(() => observer.close());
  const cache = {
    environmentId: crypto.randomUUID(),
    repositoryId: crypto.randomUUID(),
  };
  const history = openRepositoryHistory({
    ...cache,
    logicalRepositoryId: cache.repositoryId,
  });
  const stored = async () => {
    const storage = await observer.ask({ _tag: "Storage", action: "inspect" });
    return storage.caches.find(
      (current) => current.repositoryId === cache.repositoryId,
    )?.open;
  };
  await expect.poll(stored).toBe(true);
  history.close();
  await expect.poll(stored).toBe(false);

  const storage = await observer.ask({ _tag: "ClearCache", cache });

  expect(
    storage.caches.some(
      (current) => current.repositoryId === cache.repositoryId,
    ),
  ).toBe(false);
});
