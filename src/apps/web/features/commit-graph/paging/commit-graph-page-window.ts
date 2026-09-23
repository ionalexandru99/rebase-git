import { createCommitLaneCheckpoint } from "#web/features/commit-graph/layout/commit-lanes";
import {
  type CommitGraphPageCache,
  estimateGraphPageCache,
  retainGraphPage,
} from "#web/features/commit-graph/paging/commit-graph-page-cache";
import type {
  CommitGraphPageReader,
  CommitGraphPageWindow,
  CommitGraphPageWindowOptions,
  CommitGraphPageWindowSnapshot,
} from "#web/features/commit-graph/paging/commit-graph-page-window.contract";
import { locateCommitGraphTarget } from "#web/features/commit-graph/paging/locate-commit-graph-target";
import { prepareCommitGraphPage } from "#web/features/commit-graph/paging/prepare-commit-graph-page";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/index";
import { createStore } from "#web/platform/store/store";

interface PendingPageLoad {
  readonly task: Promise<void>;
  protectViewport: boolean;
}

interface PageView extends CommitGraphPageCache {
  readonly epoch: number;
  readonly query: RepositoryHistoryQuery;
  readonly originOffset: number;
  knownEndOffset: number;
  hasOlder: boolean;
}

export const emptyCommitGraphPageWindowSnapshot: CommitGraphPageWindowSnapshot =
  {
    epoch: 0,
    query: undefined,
    requestedQuery: undefined,
    pages: [],
    startOffset: 0,
    endOffset: 0,
    knownEndOffset: 0,
    hasOlder: true,
    loading: false,
    error: undefined,
    anchorOid: undefined,
  };

export function createCommitGraphPageWindow(
  reader: CommitGraphPageReader,
  options: CommitGraphPageWindowOptions = {},
): CommitGraphPageWindow {
  const pageSize = options.pageSize ?? 100;
  const maximumPages = options.maximumPages ?? 16;
  const maximumBytes = options.maximumBytes ?? 64 * 1_048_576;
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 1_000 ||
    !Number.isInteger(maximumPages) ||
    maximumPages < 2 ||
    !Number.isFinite(maximumBytes) ||
    maximumBytes < 1
  )
    throw new Error("Invalid graph page cache limits");
  const store = createStore(emptyCommitGraphPageWindowSnapshot);
  const snapshot = store.getSnapshot;
  let view: PageView | undefined;
  let requestedQuery: RepositoryHistoryQuery | undefined;
  let controller = new AbortController();
  let generation = 0;
  let navigationRequest = 0;
  let initialRequest = 0;
  let jumping = false;
  let disposed = false;
  let replacing = false;
  let queue = Promise.resolve();
  let retryTask: (() => Promise<void>) | undefined;
  let moving = false;
  let viewport: { first: number; last: number } | undefined;
  let scrollingBackwards = false;
  let pendingMove:
    | {
        offset: number;
        resolve: (value: { oid: string; offset: number } | undefined) => void;
      }
    | undefined;
  const loads = new Map<number, PendingPageLoad>();

  const publish = (changes: Partial<CommitGraphPageWindowSnapshot> = {}) => {
    const { pages: currentPages } = snapshot();
    const nextPages = [...(view?.pages.values() ?? [])].sort(
      (left, right) => left.offset - right.offset,
    );
    const pages =
      nextPages.length === currentPages.length &&
      nextPages.every((page, index) => page === currentPages[index])
        ? currentPages
        : nextPages;
    const first = pages[0];
    const last = pages.at(-1);
    store.set({
      ...snapshot(),
      epoch: view?.epoch ?? 0,
      query: view?.query,
      requestedQuery,
      pages,
      startOffset: first?.offset ?? 0,
      endOffset: last === undefined ? 0 : last.offset + last.commits.length,
      knownEndOffset: view?.knownEndOffset ?? 0,
      hasOlder: view?.hasOlder ?? true,
      ...changes,
    });
  };
  const retain = (
    target: PageView,
    page: Awaited<ReturnType<typeof prepareCommitGraphPage>>,
    protectViewport = false,
  ) => {
    retainGraphPage(
      target,
      page,
      pageSize,
      maximumPages,
      maximumBytes,
      protectViewport ? viewport : undefined,
    );
    if (!target.pages.has(page.offset)) return;
    target.knownEndOffset = Math.max(
      target.knownEndOffset,
      page.offset + page.commits.length,
    );
    if (page.commits.length < pageSize) target.hasOlder = false;
  };
  const fail = (offset: number, error: unknown, retry: () => Promise<void>) => {
    retryTask = retry;
    publish({
      loading: false,
      error: {
        offset,
        message:
          error instanceof Error && error.message.length > 0
            ? error.message
            : "Could not load history.",
      },
    });
  };
  const replace = async (
    query: RepositoryHistoryQuery,
    offset: number,
    anchorOid?: string,
    throughOffset = offset,
    callerSignal?: AbortSignal,
  ) => {
    if (disposed) return;
    callerSignal?.throwIfAborted();
    controller.abort();
    controller = new AbortController();
    const signal =
      callerSignal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, callerSignal]);
    const epoch = ++generation;
    loads.clear();
    queue = Promise.resolve();
    replacing = true;
    viewport = undefined;
    scrollingBackwards = false;
    const next: PageView = {
      epoch,
      query: { ...query, limit: pageSize, offset: 0 },
      originOffset: offset,
      pages: new Map(),
      checkpoints: new Map([[offset, createCommitLaneCheckpoint()]]),
      knownEndOffset: offset,
      hasOlder: query.roots.length > 0,
    };
    const previousRows = snapshot().pages.flatMap((page) => page.rows);
    requestedQuery = next.query;
    publish({ loading: true, error: undefined });
    try {
      for (
        let cursor = offset;
        cursor <= throughOffset && query.roots.length > 0;
        cursor += pageSize
      ) {
        const checkpoint = next.checkpoints.get(cursor);
        if (checkpoint === undefined) break;
        const page = await prepareCommitGraphPage(
          reader,
          next.query,
          cursor,
          checkpoint,
          signal,
          previousRows,
        );
        retain(next, page);
        if (page.commits.length < pageSize) break;
      }
      signal.throwIfAborted();
      view = next;
      retryTask = undefined;
      publish({
        loading: false,
        error: undefined,
        anchorOid: anchorOid ?? next.pages.get(offset)?.commits[0]?.oid,
      });
    } catch (error) {
      if (!signal.aborted)
        fail(offset, error, () =>
          replace(query, offset, anchorOid, throughOffset),
        );
    } finally {
      if (epoch === generation) replacing = false;
    }
  };

  const cancelNavigation = () => {
    navigationRequest += 1;
    pendingMove?.resolve(undefined);
    pendingMove = undefined;
    if (jumping) {
      jumping = false;
      controller.abort();
      controller = new AbortController();
      generation += 1;
      loads.clear();
      queue = Promise.resolve();
      replacing = false;
      requestedQuery = view?.query ?? requestedQuery;
      publish({ loading: false });
    }
  };

  const loadInitial = async (
    query: RepositoryHistoryQuery,
    anchorOid?: string,
  ) => {
    if (disposed) return;
    cancelNavigation();
    requestedQuery = { ...query, limit: pageSize, offset: 0 };
    const request = ++initialRequest;
    let offset = 0;
    if (anchorOid !== undefined) {
      publish({ loading: true, error: undefined });
      try {
        offset = (await reader.locate(query, anchorOid)) ?? 0;
      } catch (error) {
        if (request === initialRequest && !disposed)
          fail(0, error, () => loadInitial(query, anchorOid));
        return;
      }
      if (request !== initialRequest || disposed) return;
    }
    await replace(query, Math.floor(offset / pageSize) * pageSize, anchorOid);
  };

  const prefetchOffset = (
    requestedOffset: number,
    protectViewport = false,
  ): Promise<void> => {
    if (
      !Number.isInteger(requestedOffset) ||
      requestedOffset < 0 ||
      disposed ||
      replacing ||
      view === undefined
    )
      return Promise.resolve();
    const offset = Math.floor(requestedOffset / pageSize) * pageSize;
    if (view.pages.has(offset)) return Promise.resolve();
    if (!view.hasOlder && offset >= view.knownEndOffset)
      return Promise.resolve();
    const existing = loads.get(offset);
    if (existing !== undefined) {
      existing.protectViewport ||= protectViewport;
      return existing.task;
    }
    const signal = controller.signal;
    const load: PendingPageLoad = {
      protectViewport,
      task: queue.then(async () => {
        if (signal.aborted || view === undefined) return;
        const target: PageView = {
          ...view,
          pages: new Map(view.pages),
          checkpoints: new Map(view.checkpoints),
        };
        if (offset < target.originOffset) {
          const adjacent = offset + pageSize === snapshot().startOffset;
          await replace(
            target.query,
            offset,
            adjacent ? snapshot().pages[0]?.commits[0]?.oid : undefined,
            adjacent ? snapshot().startOffset : offset,
          );
          return;
        }
        publish({ loading: true });
        try {
          const checkpointOffset = [...target.checkpoints.keys()]
            .filter((position) => position <= offset)
            .sort((left, right) => right - left)[0];
          let cursor = checkpointOffset ?? target.originOffset;
          let checkpoint =
            target.checkpoints.get(cursor) ?? createCommitLaneCheckpoint();
          while (cursor <= offset) {
            const page = await prepareCommitGraphPage(
              reader,
              target.query,
              cursor,
              checkpoint,
              signal,
            );
            retain(target, page, load.protectViewport);
            checkpoint = page.outgoingCheckpoint;
            cursor += pageSize;
            if (page.commits.length < pageSize) break;
          }
          signal.throwIfAborted();
          view = target;
          const failedOffset = snapshot().error?.offset;
          const recovered =
            failedOffset === undefined ||
            target.pages.has(Math.floor(failedOffset / pageSize) * pageSize);
          if (recovered) retryTask = undefined;
          publish({
            loading: false,
            ...(recovered ? { error: undefined } : {}),
          });
        } catch (error) {
          if (!signal.aborted)
            fail(offset, error, () => prefetchOffset(offset));
        }
      }),
    };
    const { task } = load;
    loads.set(offset, load);
    queue = task.catch(() => undefined);
    const cleanup = () => {
      if (loads.get(offset) === load) loads.delete(offset);
    };
    void task.then(cleanup, cleanup);
    return task;
  };

  const requestMove = (offset: number) => {
    cancelNavigation();
    if (disposed || replacing || !Number.isInteger(offset) || offset < 0)
      return Promise.resolve(undefined);
    return new Promise<{ oid: string; offset: number } | undefined>(
      (resolve) => {
        pendingMove = { offset, resolve };
        void finishPendingMove();
      },
    );
  };

  const finishPendingMove = async () => {
    if (moving) return;
    moving = true;
    try {
      while (pendingMove !== undefined) {
        const move = pendingMove;
        await prefetchOffset(move.offset);
        if (pendingMove !== move) continue;
        const pageOffset = Math.floor(move.offset / pageSize) * pageSize;
        const page = view?.pages.get(pageOffset);
        const targetOffset = move.offset;
        const commit = page?.commits[targetOffset - pageOffset];
        pendingMove = undefined;
        move.resolve(
          commit === undefined
            ? undefined
            : { oid: commit.oid, offset: targetOffset },
        );
      }
    } finally {
      moving = false;
    }
  };

  const jumpToOid = async (oid: string, callerSignal?: AbortSignal) => {
    callerSignal?.throwIfAborted();
    const scopeQuery = requestedQuery;
    if (scopeQuery === undefined || disposed) return undefined;
    initialRequest += 1;
    cancelNavigation();
    const request = navigationRequest;
    jumping = true;
    const signal =
      callerSignal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, callerSignal]);
    try {
      const target = await locateCommitGraphTarget(
        reader,
        scopeQuery,
        oid,
        signal,
      );
      if (
        signal.aborted ||
        target === undefined ||
        request !== navigationRequest
      )
        return undefined;
      const { offset, query } = target;
      const expectedEpoch = generation + 1;
      const offsetStart = Math.floor(offset / pageSize) * pageSize;
      await replace(query, offsetStart, oid, offsetStart, callerSignal);
      if (
        callerSignal?.aborted ||
        request !== navigationRequest ||
        snapshot().error !== undefined ||
        disposed ||
        view?.epoch !== expectedEpoch
      )
        return undefined;
      return { oid, offset, query };
    } catch (error) {
      if (!signal.aborted && request === navigationRequest)
        fail(0, error, async () => {
          await jumpToOid(oid);
        });
      return undefined;
    } finally {
      if (request === navigationRequest) {
        jumping = false;
        requestedQuery = view?.query ?? scopeQuery;
        if (snapshot().loading || snapshot().requestedQuery !== requestedQuery)
          publish({ loading: false });
      }
    }
  };

  const discard = () => {
    if (disposed) return;
    controller.abort();
    controller = new AbortController();
    generation += 1;
    navigationRequest += 1;
    initialRequest += 1;
    pendingMove?.resolve(undefined);
    pendingMove = undefined;
    jumping = false;
    replacing = false;
    loads.clear();
    queue = Promise.resolve();
    retryTask = undefined;
    viewport = undefined;
    scrollingBackwards = false;
    if (view !== undefined) {
      view = {
        ...view,
        epoch: generation,
        originOffset: 0,
        pages: new Map(),
        checkpoints: new Map(),
        knownEndOffset: 0,
        hasOlder: false,
      };
    }
    publish({
      loading: false,
      error: undefined,
      anchorOid: undefined,
      hasOlder: false,
    });
  };

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    dispose: () => {
      disposed = true;
      controller.abort();
      generation += 1;
      pendingMove?.resolve(undefined);
      pendingMove = undefined;
      loads.clear();
      view = undefined;
      viewport = undefined;
      scrollingBackwards = false;
      store.set(emptyCommitGraphPageWindowSnapshot);
    },
    loadInitial,
    discard,
    reload: loadInitial,
    appendOlder: async () => {
      const { hasOlder, endOffset } = snapshot();
      if (hasOlder) await prefetchOffset(endOffset);
    },
    prefetchOffset,
    diagnostics: () => ({
      estimatedBytes: view === undefined ? 0 : estimateGraphPageCache(view),
      checkpointCount: view?.checkpoints.size ?? 0,
    }),
    setViewport: (first, last) => {
      if (viewport !== undefined && first !== viewport.first)
        scrollingBackwards = first < viewport.first;
      viewport = { first, last };
      const lookahead = Math.max(pageSize, (last - first + 1) * 2);
      const { startOffset, endOffset, hasOlder } = snapshot();
      if (scrollingBackwards) {
        const offset = Math.max(0, startOffset - pageSize);
        const lastVisiblePage = Math.floor(last / pageSize) * pageSize;
        if (
          first < startOffset + lookahead &&
          startOffset > 0 &&
          (lastVisiblePage - offset) / pageSize < maximumPages
        )
          void prefetchOffset(offset, true);
      } else {
        const firstVisiblePage = Math.floor(first / pageSize) * pageSize;
        if (
          last >= endOffset - lookahead &&
          hasOlder &&
          (endOffset - firstVisiblePage) / pageSize < maximumPages
        )
          void prefetchOffset(endOffset, true);
      }
    },
    requestMove,
    cancelNavigation,
    jumpToOid,
    retry: async () => {
      await retryTask?.();
    },
  };
}
