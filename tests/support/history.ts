import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
} from "#contracts/repository-history/repository-history.contract.ts";
import {
  openRepository,
  storeCommits,
  updateRepository,
} from "#web/features/repository-history/history-database.ts";
import { HistoryGraph } from "#web/features/repository-history/history-graph.ts";
import {
  findInHistory,
  type HistoryScopeQuery,
  HistoryView,
} from "#web/features/repository-history/history-view.ts";
import type {
  HistoryAnswers,
  HistoryQuery,
  HistorySnapshot,
} from "#web/features/repository-history/history-worker-protocol.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";

export function historyOid(index: number) {
  return index.toString(16).padStart(40, "0");
}

export function historyIdentity(index: number) {
  return {
    email: "alex@example.test",
    name: "Alex I.",
    timestampSeconds: 1_777_777_777 - index,
    timezoneOffsetMinutes: 120,
  };
}

export function historyCommit(
  oid: string,
  parents: readonly string[] = [],
  timestamp = 0,
  subject = `Commit ${oid}`,
): RepositoryCommit {
  const identity = {
    email: "alex@example.test",
    name: "Alex I.",
    timestampSeconds: timestamp,
    timezoneOffsetMinutes: 0,
  };
  return { oid, parents, subject, author: identity, committer: identity };
}

export function linearHistory(count: number): readonly RepositoryCommit[] {
  return Array.from({ length: count }, (_, index) => ({
    author: historyIdentity(index),
    committer: historyIdentity(index),
    oid: historyOid(index),
    parents: index === count - 1 ? [] : [historyOid(index + 1)],
    subject: `Commit ${index}`,
  }));
}

export function historyGraph(commits: readonly RepositoryCommit[]) {
  const graph = new HistoryGraph();
  for (const [index, commit] of commits.entries()) graph.add(commit, index);
  return graph;
}

export function historyScope(
  roots: readonly (RepositoryHistoryRefTarget | string)[],
  overrides: Partial<HistoryScopeQuery> = {},
): HistoryScopeQuery {
  return {
    roots: roots.map((root) =>
      typeof root === "string"
        ? { name: root, oid: root, type: "branch" }
        : root,
    ),
    order: "topological",
    expanded: [],
    ...overrides,
  };
}

export async function storeHistory(
  environmentId: string,
  repositoryId: string,
  commits: readonly RepositoryCommit[],
  refTargets: readonly RepositoryHistoryRefTarget[],
) {
  const record = await openRepository(environmentId, repositoryId);
  const stored = {
    ...record,
    commitCount: commits.length,
    minimumEpoch: -1,
  };
  await storeCommits(
    stored,
    commits.map((commit, order) => ({ commit, epoch: -1, order })),
  );
  await updateRepository({
    ...stored,
    tips: {
      _tag: "RepositoryHistoryTips",
      objectFormat: "sha1",
      rootOids: refTargets.map(({ oid }) => oid),
      shallowOids: [],
      refTargets,
    },
  });
}

export interface FakeRepositoryHistory extends RepositoryHistory {
  readonly asked: HistoryQuery[];
  readonly synchronizations: () => number;
  readonly publish: (
    snapshot: Omit<Partial<HistorySnapshot>, "failure"> & {
      readonly failure?: HistorySnapshot["failure"] | undefined;
    },
  ) => void;
  readonly replace: (commits: readonly RepositoryCommit[]) => void;
  hold: Promise<void> | undefined;
}

export function fakeRepositoryHistory({
  commits,
  refTargets = [],
  snapshot = {},
}: {
  readonly commits: readonly RepositoryCommit[];
  readonly refTargets?: readonly RepositoryHistoryRefTarget[];
  readonly snapshot?: Partial<HistorySnapshot>;
}): FakeRepositoryHistory {
  let current = commits;
  let graph = historyGraph(current);
  let byOid = new Map(current.map((commit) => [commit.oid, commit]));
  let state: HistorySnapshot = {
    revision: 1,
    status: current.length === 0 ? "empty" : "ready",
    synchronization: "complete",
    commitCount: current.length,
    refTargets,
    ...snapshot,
  };
  let synchronizations = 0;
  const listeners = new Set<() => void>();
  const asked: HistoryQuery[] = [];
  const view = (scope: HistoryScopeQuery) =>
    new HistoryView(graph, scope, state.refTargets);
  const answer = (query: HistoryQuery): unknown => {
    switch (query._tag) {
      case "Rows": {
        const scoped = view(query.scope);
        const found =
          query.anchor === undefined ? undefined : scoped.row(query.anchor.oid);
        const shift =
          query.anchor === undefined || found === undefined
            ? 0
            : found - query.anchor.index;
        const start = Math.max(0, query.start + shift);
        return {
          total: scoped.total,
          start,
          shift,
          rows: scoped.rows(start, query.end + shift).flatMap((row) => {
            const commit = byOid.get(row.oid);
            return commit === undefined ? [] : [{ ...row, commit }];
          }),
        } satisfies HistoryAnswers["Rows"];
      }
      case "Oids":
        return view(query.scope).oids(query.start, query.end);
      case "Locate": {
        const scoped = view(query.scope);
        return query.oids.map((oid) => scoped.row(oid));
      }
      case "Find":
        return findInHistory(
          graph,
          state.refTargets,
          query.scope,
          query.oid,
          view,
        );
      case "Search": {
        const words = query.text.trim().toLowerCase();
        return {
          commits: current
            .filter((commit) => commit.subject.toLowerCase().includes(words))
            .slice(0, query.limit),
          complete: true,
          commitCount: current.length,
        } satisfies HistoryAnswers["Search"];
      }
      case "Commits":
        return query.oids.flatMap((oid) => {
          const commit = byOid.get(oid);
          return commit === undefined ? [] : [commit];
        });
      case "Relation":
        return graph.relation(query.from, query.to);
      case "Storage":
        return {
          caches: [],
          persistent: false,
        } satisfies HistoryAnswers["Storage"];
    }
  };
  const fake: FakeRepositoryHistory = {
    asked,
    hold: undefined,
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ask: async (query, signal) => {
      asked.push(query);
      await fake.hold;
      signal?.throwIfAborted();
      return answer(query) as never;
    },
    synchronize: () => {
      synchronizations += 1;
    },
    close: () => undefined,
    synchronizations: () => synchronizations,
    publish: ({ failure, ...next }) => {
      const { failure: _, ...previous } = state;
      state = {
        ...previous,
        revision: state.revision + 1,
        ...next,
        ...(failure === undefined ? {} : { failure }),
      };
      for (const listener of listeners) listener();
    },
    replace: (next) => {
      current = next;
      graph = historyGraph(next);
      byOid = new Map(next.map((commit) => [commit.oid, commit]));
      fake.publish({ commitCount: next.length });
    },
  };
  return fake;
}
