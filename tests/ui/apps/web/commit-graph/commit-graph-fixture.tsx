import type { RepositoryCommit } from "@rebase/contracts";
import { type ComponentProps, useMemo } from "react";
import { vi } from "vite-plus/test";
import { render } from "#tests-ui/runtime/render";
import { CommitGraph } from "#web/features/commit-graph/commit-graph";
import type { CommitGraphReader } from "#web/features/commit-graph/commit-graph-model";
import { openCommitGraphHistory } from "#web/features/commit-graph/paging/commit-graph-history";
import { saveRepositoryHistoryOrder } from "#web/features/repository-history/preferences/repository-history-order";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/repository-history-reader";

const graphHistoryIdentity = {
  environmentId: "test-environment",
  repositoryId: "test-logical-repository",
};

export async function renderGraph(
  reader: ReturnType<typeof historyReader>,
  roots = [{ name: "main", oid: "0".repeat(40), type: "branch" as const }],
) {
  saveRepositoryHistoryOrder(graphHistoryIdentity, "topological");
  return render(
    <div style={{ height: 520, width: 900 }}>
      <CommitGraphFixture
        reader={reader}
        repositoryName="rebase-test"
        roots={roots}
        historyIdentity={graphHistoryIdentity}
      />
    </div>,
  );
}

export function mergeHistory() {
  const commits = history(6);
  const parents = [[1, 2], [5], [3, 4], [5], [5], []];
  return commits.map((commit, index) => ({
    ...commit,
    parents: (parents[index] ?? []).map((parent) =>
      parent.toString(16).padStart(40, "0"),
    ),
  }));
}

export function historyReader({
  commits,
  pending,
  status,
}: {
  readonly commits: readonly RepositoryCommit[];
  readonly pending?: Promise<readonly RepositoryCommit[]>;
  readonly status: "empty" | "loading" | "ready";
}) {
  let snapshot: RepositoryHistorySnapshot = {
    revision: 0,
    historyRevision: 0,
    status,
  };
  const listeners = new Set<() => void>();
  const matching = (query: RepositoryHistoryQuery) => {
    if (query.ancestry !== "first-parent") return commits;
    const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
    const visible = new Set<string>();
    const pending = query.roots.map((root) => root.oid);
    while (pending.length > 0) {
      const oid = pending.pop();
      if (oid === undefined || visible.has(oid)) continue;
      visible.add(oid);
      const commit = byOid.get(oid);
      if (commit === undefined) continue;
      pending.push(
        ...commit.parents.filter(
          (parentOid, index) =>
            index === 0 ||
            query.additionalParentEdges?.some(
              (edge) => edge.childOid === oid && edge.parentOid === parentOid,
            ),
        ),
      );
    }
    return commits.filter((commit) => visible.has(commit.oid));
  };

  const reader = {
    ancestryRoute: vi.fn<RepositoryHistoryReader["ancestryRoute"]>(
      async () => undefined,
    ),
    fetch: vi.fn<RepositoryHistoryReader["fetch"]>(),
    configureFetch: vi.fn<RepositoryHistoryReader["configureFetch"]>(),
    getCacheDiagnostics: async () => ({ caches: [], persistent: false }),
    manageCache: vi.fn<RepositoryHistoryReader["manageCache"]>(
      async () => undefined,
    ),
    search: vi.fn<RepositoryHistoryReader["search"]>(async () => ({
      commits: [],
      replicaComplete: true,
      synchronizedCommitCount: commits.length,
    })),
    locate: vi.fn<RepositoryHistoryReader["locate"]>(async (query, oid) => {
      const index = matching(query).findIndex((commit) => commit.oid === oid);
      return index < 0 ? undefined : index;
    }),
    locateMany: vi.fn<RepositoryHistoryReader["locateMany"]>(
      async (query, oids) =>
        matching(query).flatMap((commit, index) =>
          oids.includes(commit.oid) ? [{ oid: commit.oid, index }] : [],
        ),
    ),
    close: vi.fn(),
    getCommitSummaries: vi.fn<RepositoryHistoryReader["getCommitSummaries"]>(
      async () => commits,
    ),
    getRefTargets: vi.fn<RepositoryHistoryReader["getRefTargets"]>(
      async () => [],
    ),
    getSnapshot: (): RepositoryHistorySnapshot => snapshot,
    read: vi.fn<RepositoryHistoryReader["read"]>(
      (query) =>
        pending ??
        Promise.resolve(
          matching(query).slice(
            query.offset ?? 0,
            (query.offset ?? 0) + query.limit,
          ),
        ),
    ),
    get snapshot() {
      return snapshot;
    },
    set snapshot(value: RepositoryHistorySnapshot) {
      snapshot = value;
      for (const listener of listeners) listener();
    },
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  } satisfies RepositoryHistoryReader & {
    snapshot: RepositoryHistorySnapshot;
  };
  return reader;
}

export function history(count: number): readonly RepositoryCommit[] {
  return Array.from({ length: count }, (_, index) => ({
    author: identity(index),
    committer: identity(index),
    oid: index.toString(16).padStart(40, "0"),
    parents:
      index === count - 1 ? [] : [(index + 1).toString(16).padStart(40, "0")],
    subject: `Commit ${index}`,
  }));
}

export function historyOid(index: number) {
  return index.toString(16).padStart(40, "0");
}

export function identity(index: number) {
  return {
    email: "alex@example.test",
    name: "Alex I.",
    timestampSeconds: 1_777_777_777 - index,
    timezoneOffsetMinutes: 120,
  };
}

export function CommitGraphFixture({
  reader,
  ...props
}: Omit<ComponentProps<typeof CommitGraph>, "history"> & {
  readonly reader: CommitGraphReader | undefined;
}) {
  const history = useMemo(
    () => (reader === undefined ? undefined : openCommitGraphHistory(reader)),
    [reader],
  );
  return <CommitGraph {...props} history={history} />;
}
