import type { RepositoryCommit } from "@rebase/contracts";
import type { ComponentProps } from "react";
import { vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CommitGraph,
  CommitGraphToolbarProvider,
  useCommitGraphToolbarModel,
} from "#web/features/commit-graph/index";
import { defaultKeyboardShortcutBindings } from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/repository-history-reader.contract";

export async function renderGraph(
  reader: ReturnType<typeof historyReader>,
  roots = [{ name: "main", oid: "0".repeat(40), type: "branch" as const }],
  options: Pick<
    ComponentProps<typeof CommitGraph>,
    "onRemoveHistoryRef" | "onCacheChanged" | "commandEnvironment" | "shortcuts"
  > = {},
) {
  return render(
    <div style={{ height: 520, width: 900 }}>
      <CommitGraphFixture
        reader={reader}
        repositoryName="rebase-test"
        roots={roots}
        commandEnvironment={{
          environmentId: "test-environment",
          logicalRepositoryId: "test-logical-repository",
          repositoryId: "test-repository",
          activeBranch: "main",
          activeWorktreePath: "/repo",
          capabilities: new Set(),
          connected: false,
          freshnessReady: false,
          operationState: "idle",
        }}
        shortcuts={{
          bindings: defaultKeyboardShortcutBindings,
          platform: "other",
        }}
        {...options}
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

export function CommitGraphFixture(props: ComponentProps<typeof CommitGraph>) {
  const toolbar = useCommitGraphToolbarModel();
  return (
    <CommitGraphToolbarProvider model={toolbar}>
      <CommitGraph {...props} />
    </CommitGraphToolbarProvider>
  );
}
