import type { RepositoryRefs } from "@rebase/contracts";
import {
  type CommitGraphHistory,
  createBrowserHistoryFilterStore,
  loadFirstCommitGraphPage,
  openCommitGraphHistory,
  resolveHistoryScope,
} from "#web/features/commit-graph/index";
import {
  createBrowserRepositoryHistoryReader,
  type RepositoryHistoryGateway,
  type RepositoryHistoryReader,
  readRepositoryHistoryOrder,
} from "#web/features/repository-history/index";
import { resolveActiveWorktreePath } from "#web/features/repository-refs/index";
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
