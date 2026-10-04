import { expect, it } from "vite-plus/test";
import { readRepositories } from "#web/features/repository-history/history-database.ts";

it("replaces history stored by a newer build", async () => {
  const newer = await openNewerDatabase();
  newer.close();

  await expect(readRepositories()).resolves.toEqual([]);
});

function openNewerDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(
      "rebase-repository-history",
      Number.MAX_SAFE_INTEGER,
    );
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
