import type { RepositoryCatalogEntry, RepositoryRefs } from "@rebase/contracts";
import type { CommitGraphHistory } from "#web/features/commit-graph/commit-graph.contract";
import {
  loadFirstCommitGraphPage,
  openCommitGraphHistory,
} from "#web/features/commit-graph/paging/commit-graph-history";
import { createBrowserHistoryFilterStore } from "#web/features/commit-graph/scope/browser-history-filter-store";
import { resolveHistoryScope } from "#web/features/commit-graph/scope/history-scope";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import { readRepositoryHistoryOrder } from "#web/features/repository-history/preferences/repository-history-order";
import type {
  RepositoryHistoryGateway,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";
import { resolveActiveWorktreePath } from "#web/features/repository-refs/activate-repository-ref";
import { createStore, type ReadableStore } from "#web/platform/store/store";

export interface OpenedRepositoryTarget {
  readonly environmentId: string;
  readonly repositoryId: string;
  readonly logicalRepositoryId: string;
  readonly worktreePath: string;
}

export interface OpenedRepositoryHistory extends CommitGraphHistory {
  readonly reader: RepositoryHistoryReader;
}

export interface OpenedRepository {
  readonly key: string;
  readonly history: OpenedRepositoryHistory;
}

export interface OpenedRepositoryStore
  extends ReadableStore<OpenedRepository | undefined> {
  readonly open: (target: OpenedRepositoryTarget | undefined) => void;
  readonly refsArrived: (refs: RepositoryRefs) => void;
}

export function openedRepositoryTarget(
  environmentId: string,
  repository: RepositoryCatalogEntry,
  worktreePath: string,
): OpenedRepositoryTarget {
  return {
    environmentId,
    repositoryId: repository.id,
    logicalRepositoryId: repository.logicalRepositoryId ?? repository.id,
    worktreePath,
  };
}

export function openedRepositoryKey(target: OpenedRepositoryTarget) {
  return JSON.stringify([
    target.environmentId,
    target.repositoryId,
    target.logicalRepositoryId,
  ]);
}

export function createOpenedRepositoryStore(
  gateway: RepositoryHistoryGateway,
): OpenedRepositoryStore {
  const store = createStore<OpenedRepository | undefined>(undefined);
  let awaitingRefs: OpenedRepositoryTarget | undefined;

  const close = () => {
    awaitingRefs = undefined;
    const current = store.getSnapshot();
    if (current === undefined) return;
    store.set(undefined);
    current.history.pages.dispose();
    current.history.reader.close();
  };

  const open = (target: OpenedRepositoryTarget | undefined) => {
    if (target === undefined) {
      close();
      return;
    }
    const key = openedRepositoryKey(target);
    if (store.getSnapshot()?.key === key) return;
    close();
    const reader = createBrowserRepositoryHistoryReader({
      gateway,
      environmentId: target.environmentId,
      repositoryId: target.repositoryId,
      logicalRepositoryId: target.logicalRepositoryId,
    });
    store.set({ key, history: { ...openCommitGraphHistory(reader), reader } });
    awaitingRefs = target;
  };

  const refsArrived = (refs: RepositoryRefs) => {
    const target = awaitingRefs;
    const history = store.getSnapshot()?.history;
    if (
      target === undefined ||
      history === undefined ||
      refs.repositoryId !== target.repositoryId
    )
      return;
    awaitingRefs = undefined;
    loadFirstPage(history, target, refs);
  };

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    open,
    refsArrived,
  };
}

function loadFirstPage(
  history: OpenedRepositoryHistory,
  target: OpenedRepositoryTarget,
  refs: RepositoryRefs,
) {
  const scope = createBrowserHistoryFilterStore().load(
    target.environmentId,
    target.logicalRepositoryId,
  );
  const roots = resolveHistoryScope(
    scope,
    refs,
    resolveActiveWorktreePath(refs, target.worktreePath),
  ).roots;
  const order = readRepositoryHistoryOrder({
    environmentId: target.environmentId,
    repositoryId: target.logicalRepositoryId,
  });
  loadFirstCommitGraphPage(history, roots, order);
}
