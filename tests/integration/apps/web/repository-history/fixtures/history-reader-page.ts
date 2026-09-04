import {
  encodeRepositoryHistoryBatch,
  encodeRepositoryHistoryPage,
  type RepositoryCommit,
} from "@rebase/contracts";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";

const parameters = new URLSearchParams(location.search);
const repositoryId = parameters.get("repository") ?? "";
const environmentId = parameters.get("environment") ?? "";
const name = parameters.get("name") ?? "";
const oid = "a".repeat(40);
const root = { name: "main", oid, type: "branch" as const };
const identity = {
  email: "alex@example.test",
  name: "Alex",
  timestampSeconds: 1_777_777_777,
  timezoneOffsetMinutes: 0,
};
const commit: RepositoryCommit = {
  author: identity,
  committer: identity,
  oid,
  parents: [],
  subject: "One commit",
};
const query = { limit: 100, order: "topological" as const, roots: [root] };
const events = new BroadcastChannel(
  parameters.get("events") ?? "history-lifecycle",
);
const report = (event: string) => events.postMessage(`${name}:${event}`);
globalThis.addEventListener("pageshow", (event) => {
  report(`pageshow:${event.persisted}`);
  if (event.persisted && parameters.has("cacheAction"))
    setTimeout(
      () =>
        void reader.read(query).then(
          (commits) => report(`restored-read:${commits.length}`),
          () => report("restored-read:closed"),
        ),
      0,
    );
});
events.onmessage = async (event: MessageEvent<string>) => {
  if (event.data === "navigate")
    location.assign(`history-reader-away.html${location.search}`);
  if (event.data === "close") window.close();
  if (
    event.data === "clear" ||
    event.data === "clear-all" ||
    event.data === "remove"
  ) {
    await reader.manageCache(event.data);
    report("cache-changed");
  }
};
const reader = createBrowserRepositoryHistoryReader({
  environmentId,
  repositoryId,
  gateway: {
    read: async () => {
      report("downloaded");
      return encodeRepositoryHistoryPage({
        commits: [commit],
        objectFormat: "sha1",
        refTargets: [root],
        repositoryId,
        requestId: crypto.randomUUID(),
      });
    },
    synchronize: async (_request, accept, signal) => {
      report("started");
      await accept(
        encodeRepositoryHistoryBatch({
          commits: [commit],
          objectFormat: "sha1",
          repositoryId,
          requestId: crypto.randomUUID(),
          sequence: 0,
        }),
      );
      report("committed");
      return new Promise<number>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            report("aborted");
            reject(new Error("Synchronization cancelled"));
          },
          { once: true },
        );
      });
    },
  },
});
reader.subscribe(() => {
  document.body.dataset.synchronization = reader.getSnapshot().synchronization;
});
if (parameters.get("read") !== "false") {
  await reader.read(query);
}
await reader.getRefTargets();
document.body.dataset.ready = "true";
