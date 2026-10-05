import { QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import { CommitGraph } from "#web/features/commit-graph/commit-graph.tsx";
import { NotificationsProvider } from "#web/features/notifications/notifications.tsx";
import { HistoryGraph } from "#web/features/repository-history/history-graph.ts";
import { HistoryView } from "#web/features/repository-history/history-view.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import {
  type Environment,
  EnvironmentProvider,
} from "#web/platform/query/environment-context.tsx";
import { createEnvironmentQueryClient } from "#web/platform/query/environment-query.ts";

const offlineEnvironment: Environment = {
  environmentId: undefined,
  requests: async () => {
    throw new Error("Performance fixtures do not reach an environment.");
  },
  subscribe: async () => {
    throw new Error("Performance fixtures do not reach an environment.");
  },
  connected: false,
  readable: false,
  writable: false,
  status: {
    availability: "unavailable",
    connectionState: "Connecting",
    detail: "Performance fixtures run without an environment.",
    status: "Offline",
  },
};

export async function prepareStorageInteraction() {
  const worker = new Worker(
    new URL("./history-storage-worker.ts", import.meta.url),
    { type: "module" },
  );
  const reply = <T,>() =>
    new Promise<T>((resolve) => {
      worker.onmessage = ({ data }: MessageEvent<T>) => resolve(data);
    });
  const seeded = reply<{ readonly _tag: "Seeded" }>();
  worker.postMessage("seed");
  await seeded;
  const container = document.createElement("div");
  container.style.cssText = "height:720px;width:1280px";
  document.body.append(container);
  const root = createRoot(container);
  const history = visibleHistory(500);
  root.render(
    <StorageGraph
      history={history}
      roots={[{ name: "main", oid: oid(0), type: "branch" }]}
      repositoryName="Storage interaction"
    />,
  );
  return {
    run: async () => {
      const maintained = reply<{
        readonly quotaTriggered: boolean;
        readonly visible: unknown;
        readonly rebuilt: unknown;
        readonly pruned: unknown;
      }>();
      worker.postMessage("run");
      const { quotaTriggered, visible, rebuilt, pruned } = await maintained;
      return { quotaTriggered, visible, rebuilt, pruned };
    },
    close: () => {
      root.unmount();
      worker.terminate();
    },
  };
}

function oid(index: number) {
  return index.toString(16).padStart(40, "0");
}

function visibleHistory(count: number): RepositoryHistory {
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
        parents: index === count - 1 ? [] : [oid(index + 1)],
        subject: `Storage commit ${index}`,
        author: identity,
        committer: identity,
      };
    },
  );
  const graph = new HistoryGraph();
  for (const [index, commit] of commits.entries()) graph.add(commit, index);
  const snapshot = {
    revision: 1,
    status: "ready",
    synchronization: "complete",
    commitCount: count,
    refTargets: [],
  } as const;
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    ask: async (query) => {
      if (query._tag === "Search")
        return { commits: [], complete: true, commitCount: count } as never;
      if (!("scope" in query)) return [] as never;
      const view = new HistoryView(graph, query.scope, []);
      if (query._tag === "Locate")
        return query.oids.map((value) => view.row(value)) as never;
      if (query._tag === "Oids")
        return view.oids(query.start, query.end) as never;
      if (query._tag !== "Rows") return undefined as never;
      return {
        total: view.total,
        start: query.start,
        shift: 0,
        rows: view.rows(query.start, query.end).map((row) => ({
          ...row,
          commit: commits[Number.parseInt(row.oid, 16)] as RepositoryCommit,
        })),
      } as never;
    },
    synchronize: () => {},
    close: () => {},
  };
}

declare global {
  interface Window {
    __storageMaintenance: Awaited<ReturnType<typeof prepareStorageInteraction>>;
  }
}

function StorageGraph(props: ComponentProps<typeof CommitGraph>) {
  return (
    <QueryClientProvider client={queryClient}>
      <EnvironmentProvider environment={offlineEnvironment}>
        <NotificationsProvider
          repositories={[]}
          currentRepositoryId={undefined}
          openRepository={() => {}}
          openGitIdentity={() => {}}
        >
          <CommitGraph {...props} />
        </NotificationsProvider>
      </EnvironmentProvider>
    </QueryClientProvider>
  );
}

const queryClient = createEnvironmentQueryClient();
