import {
  encodeRepositoryHistoryBatch,
  encodeRepositoryHistoryPage,
  type RepositoryCommit,
} from "@rebase/contracts";
import { createRoot } from "react-dom/client";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import type {
  RepositoryHistoryGateway,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";
import {
  beginRepositoryHistorySynchronization,
  completeStoredRepositoryHistory,
  storeRepositoryHistoryBatch,
  storeRepositoryHistoryPage,
} from "#web/features/repository-history/repository-history-store";
import { CommitGraph } from "#web-ui/features/commit-graph/commit-graph";

const environmentId = crypto.randomUUID();
const name = crypto.randomUUID();
const workerUrl = new URL("./history-storage-quota-worker.ts", import.meta.url);
workerUrl.searchParams.set("channel", name);
const worker = new SharedWorker(workerUrl, { type: "module", name });
const channel = new BroadcastChannel(`history-storage-budget:${name}`);
let arm: (() => void) | undefined;
let quotaTriggered = false;
channel.onmessage = ({ data }) => {
  if (data === "armed") arm?.();
  if (data === "quota-triggered") quotaTriggered = true;
};

function fixture(count: number, disconnected = false) {
  const repositoryId = crypto.randomUUID();
  const oid = (index: number) => index.toString(16).padStart(40, "0");
  const commits: RepositoryCommit[] = Array.from(
    { length: count },
    (_, index) => {
      const identity = {
        name: "Storage benchmark",
        email: "storage@example.test",
        timestampSeconds: count - index,
        timezoneOffsetMinutes: 0,
      };
      return {
        oid: oid(index),
        parents: disconnected || index === count - 1 ? [] : [oid(index + 1)],
        subject: `Storage commit ${index}`,
        author: identity,
        committer: identity,
      };
    },
  );
  const roots = [{ name: "main", oid: oid(0), type: "branch" as const }];
  const query = { roots, limit: 100, order: "topological" as const };
  const snapshot = {
    id: "e".repeat(64),
    objectFormat: "sha1" as const,
    refTargets: roots,
    resumable: true,
    rootOids: [oid(0)],
  };
  const page = {
    commits: commits.slice(0, disconnected ? 1 : 100),
    objectFormat: "sha1" as const,
    refTargets: roots,
    repositoryId,
    requestId: crypto.randomUUID(),
  };
  const batches = Array.from(
    { length: Math.ceil(count / 500) },
    (_, sequence) => ({
      commits: commits.slice(sequence * 500, (sequence + 1) * 500),
      objectFormat: "sha1" as const,
      repositoryId,
      requestId: crypto.randomUUID(),
      sequence,
      snapshot,
    }),
  );
  const encodedPage = encodeRepositoryHistoryPage(page);
  const encodedBatches = batches.map(encodeRepositoryHistoryBatch);
  const first = batches[0];
  if (first === undefined) throw new Error("Storage fixture is empty");
  const empty = encodeRepositoryHistoryBatch({ ...first, commits: [] });
  const gateway: RepositoryHistoryGateway = {
    read: async () => encodedPage,
    synchronize: async (request, accept, signal) => {
      for (const bytes of request.basis?._tag === "Complete"
        ? [empty]
        : encodedBatches) {
        signal?.throwIfAborted();
        await accept(bytes);
      }
      return count;
    },
  };
  return { repositoryId, commits, roots, query, page, batches, gateway };
}

async function seed(data: ReturnType<typeof fixture>) {
  await storeRepositoryHistoryPage(
    environmentId,
    data.repositoryId,
    data.page,
    data.query,
  );
  await beginRepositoryHistorySynchronization(environmentId, data.repositoryId);
  for (const batch of data.batches)
    await storeRepositoryHistoryBatch(environmentId, data.repositoryId, batch);
  await completeStoredRepositoryHistory(
    environmentId,
    data.repositoryId,
    data.commits.length,
  );
}

function waitForCompletion(reader: RepositoryHistoryReader) {
  return new Promise<void>((resolve, reject) => {
    const check = () => {
      const snapshot = reader.getSnapshot();
      if (snapshot.synchronization === "complete") {
        unsubscribe();
        resolve();
      } else if (snapshot.status === "error") {
        unsubscribe();
        reject(snapshot.error);
      }
    };
    const unsubscribe = reader.subscribe(check);
    check();
  });
}

export async function prepareStorageInteraction() {
  const visible = fixture(500);
  const maintenance = fixture(20_000);
  const closed = fixture(20_000, true);
  await seed(visible);
  await seed(maintenance);
  await seed(closed);
  const connect = (data: ReturnType<typeof fixture>) =>
    createBrowserRepositoryHistoryReader({
      environmentId,
      repositoryId: data.repositoryId,
      gateway: data.gateway,
      worker,
    });
  const visibleReader = connect(visible);
  const maintenanceReader = connect(maintenance);
  await visibleReader.read(visible.query);
  await maintenanceReader.read(maintenance.query);
  await Promise.all([
    waitForCompletion(visibleReader),
    waitForCompletion(maintenanceReader),
  ]);
  const container = document.createElement("div");
  container.style.cssText = "height:720px;width:1280px";
  document.body.append(container);
  const root = createRoot(container);
  root.render(
    <CommitGraph
      reader={visibleReader}
      roots={visible.roots}
      repositoryName="Storage interaction"
    />,
  );
  return {
    run: async () => {
      await maintenanceReader.manageCache("clear");
      const cleared = await maintenanceReader.read(maintenance.query);
      if (cleared.length !== 0)
        throw new Error("Clear did not empty its cache");
      await new Promise<void>((resolve) => {
        arm = resolve;
        channel.postMessage("arm");
      });
      await maintenanceReader.manageCache("rebuild");
      await waitForCompletion(maintenanceReader);
      const diagnostics = await maintenanceReader.getCacheDiagnostics();
      const cache = (repositoryId: string) =>
        diagnostics.caches.find((item) => item.repositoryId === repositoryId);
      return {
        quotaTriggered,
        visible: cache(visible.repositoryId),
        rebuilt: cache(maintenance.repositoryId),
        pruned: cache(closed.repositoryId),
      };
    },
    close: () => {
      root.unmount();
      visibleReader.close();
      maintenanceReader.close();
      worker.port.close();
      channel.close();
    },
  };
}

declare global {
  interface Window {
    __storageMaintenance: Awaited<ReturnType<typeof prepareStorageInteraction>>;
  }
}
