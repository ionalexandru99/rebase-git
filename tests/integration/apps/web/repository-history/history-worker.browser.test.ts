import { expect, it, onTestFinished } from "vite-plus/test";
import { openRepositoryHistory } from "#web/features/repository-history/repository-history";

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
