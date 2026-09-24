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
import {
  type RepositoryRefsController,
  resolveActiveWorktreePath,
} from "#web/features/repository-refs/index";
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
}

export function openedRepositoryKey(target: OpenedRepositoryTarget) {
  return JSON.stringify([
    target.environmentId,
    target.repositoryId,
    target.logicalRepositoryId,
  ]);
}

export function createOpenedRepositoryStore(dependencies: {
  readonly history: RepositoryHistoryGateway;
  readonly refs: RepositoryRefsController;
}): OpenedRepositoryStore {
  const store = createStore<OpenedRepository | undefined>(undefined);
  let stopFirstPage = () => {};

  const close = () => {
    stopFirstPage();
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
      gateway: dependencies.history,
      environmentId: target.environmentId,
      repositoryId: target.repositoryId,
      logicalRepositoryId: target.logicalRepositoryId,
    });
    const history = { ...openCommitGraphHistory(reader), reader };
    store.set({ key, history });
    stopFirstPage = whenRefsArrive(dependencies.refs, target, () =>
      loadFirstPage(history, target, dependencies.refs),
    );
  };

  return { getSnapshot: store.getSnapshot, subscribe: store.subscribe, open };
}

function whenRefsArrive(
  refs: RepositoryRefsController,
  target: OpenedRepositoryTarget,
  arrived: () => void,
) {
  const ready = () =>
    refs.getSnapshot().refs?.repositoryId === target.repositoryId;
  if (ready()) {
    arrived();
    return () => {};
  }
  const unsubscribe = refs.subscribe(() => {
    if (!ready()) return;
    unsubscribe();
    arrived();
  });
  return unsubscribe;
}

function loadFirstPage(
  history: OpenedRepositoryHistory,
  target: OpenedRepositoryTarget,
  refsController: RepositoryRefsController,
) {
  const refs = refsController.getSnapshot().refs;
  if (refs === undefined) return;
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
