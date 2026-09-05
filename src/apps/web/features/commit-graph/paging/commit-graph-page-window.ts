import { createCommitLaneCheckpoint } from "#web/features/commit-graph/commit-lanes";
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
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";

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
    pages: [],
    startOffset: 0,
    endOffset: 0,
    knownEndOffset: 0,
    hasOlder: true,
    loading: false,
    error: undefined,
    anchorOid: undefined,
    pendingMove: undefined,
    estimatedBytes: 0,
    checkpointCount: 0,
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
  let snapshot = emptyCommitGraphPageWindowSnapshot;
  let view: PageView | undefined;
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
        lane?: {
          id: number;
          readonly direction: -1 | 1;
          readonly activeOid: string;
          epoch: number;
        };
        resolve: (value: { oid: string; offset: number } | undefined) => void;
      }
    | undefined;
  const loads = new Map<number, Promise<void>>();
  const listeners = new Set<() => void>();

  const publish = (changes: Partial<CommitGraphPageWindowSnapshot> = {}) => {
    const nextPages = [...(view?.pages.values() ?? [])].sort(
      (left, right) => left.offset - right.offset,
    );
    const pages =
      nextPages.length === snapshot.pages.length &&
      nextPages.every((page, index) => page === snapshot.pages[index])
        ? snapshot.pages
        : nextPages;
    const first = pages[0];
    const last = pages.at(-1);
    snapshot = {
      ...snapshot,
      epoch: view?.epoch ?? 0,
      query: view?.query,
      pages,
      startOffset: first?.offset ?? 0,
      endOffset: last === undefined ? 0 : last.offset + last.commits.length,
      knownEndOffset: view?.knownEndOffset ?? 0,
      hasOlder: view?.hasOlder ?? true,
      estimatedBytes: view === undefined ? 0 : estimateGraphPageCache(view),
      checkpointCount: view?.checkpoints.size ?? 0,
      pendingMove: pendingMove?.offset,
      ...changes,
    };
    for (const listener of listeners) listener();
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
  ) => {
    if (disposed) return;
    controller.abort();
    controller = new AbortController();
    const signal = controller.signal;
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
    const hadPendingMove = pendingMove !== undefined;
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
      publish({ loading: false });
    } else if (hadPendingMove) publish();
  };

  const loadInitial = async (
    query: RepositoryHistoryQuery,
    anchorOid?: string,
  ) => {
    if (disposed) return;
    cancelNavigation();
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
    if (existing !== undefined) return existing;
    const signal = controller.signal;
    const task = queue.then(async () => {
      if (signal.aborted || view === undefined) return;
      const target: PageView = {
        ...view,
        pages: new Map(view.pages),
        checkpoints: new Map(view.checkpoints),
      };
      if (offset < target.originOffset) {
        const adjacent = offset + pageSize === snapshot.startOffset;
        await replace(
          target.query,
          offset,
          adjacent ? snapshot.pages[0]?.commits[0]?.oid : undefined,
          adjacent ? snapshot.startOffset : offset,
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
          retain(target, page, protectViewport);
          checkpoint = page.outgoingCheckpoint;
          cursor += pageSize;
          if (page.commits.length < pageSize) break;
        }
        signal.throwIfAborted();
        view = target;
        const failedOffset = snapshot.error?.offset;
        const recovered =
          failedOffset === undefined ||
          target.pages.has(Math.floor(failedOffset / pageSize) * pageSize);
        if (recovered) retryTask = undefined;
        publish({ loading: false, ...(recovered ? { error: undefined } : {}) });
      } catch (error) {
        if (!signal.aborted) fail(offset, error, () => prefetchOffset(offset));
      }
    });
    loads.set(offset, task);
    queue = task.catch(() => undefined);
    const cleanup = () => {
      if (loads.get(offset) === task) loads.delete(offset);
    };
    void task.then(cleanup, cleanup);
    return task;
  };

  const requestMove = (
    offset: number,
    lane?: {
      id: number;
      readonly direction: -1 | 1;
      readonly activeOid: string;
      epoch: number;
    },
  ) => {
    cancelNavigation();
    if (disposed || replacing || !Number.isInteger(offset) || offset < 0) {
      pendingMove = undefined;
      publish();
      return Promise.resolve(undefined);
    }
    return new Promise<{ oid: string; offset: number } | undefined>(
      (resolve) => {
        const move = {
          offset,
          resolve,
          ...(lane === undefined ? {} : { lane }),
        };
        pendingMove = move;
        publish();
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
        let targetOffset = move.offset;
        if (move.lane !== undefined && page !== undefined) {
          const lane = move.lane;
          if (lane.epoch !== snapshot.epoch) {
            const activeRow = snapshot.pages
              .flatMap((item) => item.rows)
              .find((row) => row.oid === lane.activeOid);
            if (activeRow === undefined) {
              pendingMove = undefined;
              publish();
              move.resolve(undefined);
              continue;
            }
            lane.id = activeRow.nodeLaneId;
            lane.epoch = snapshot.epoch;
          }
          let index = move.offset - pageOffset;
          while (
            index >= 0 &&
            index < page.rows.length &&
            page.rows[index]?.nodeLaneId !== lane.id
          )
            index += lane.direction;
          targetOffset = pageOffset + index;
          if (index < 0 || index >= page.rows.length) {
            const checkpoint =
              lane.direction > 0
                ? page.outgoingCheckpoint
                : page.incomingCheckpoint;
            if (
              targetOffset >= 0 &&
              (lane.direction < 0 || page.commits.length === pageSize) &&
              checkpoint.lanes.some((item) => item.id === lane.id)
            ) {
              move.offset = targetOffset;
              publish();
              continue;
            }
          }
        }
        const commit = page?.commits[targetOffset - pageOffset];
        pendingMove = undefined;
        publish();
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

  const jumpToOid = async (oid: string) => {
    if (view === undefined || disposed) return undefined;
    initialRequest += 1;
    cancelNavigation();
    const request = navigationRequest;
    jumping = true;
    const signal = controller.signal;
    try {
      const target = await locateCommitGraphTarget(
        reader,
        view.query,
        oid,
        signal,
      );
      if (target === undefined || request !== navigationRequest)
        return undefined;
      const { offset, query } = target;
      const expectedEpoch = generation + 1;
      await replace(query, Math.floor(offset / pageSize) * pageSize, oid);
      if (
        request !== navigationRequest ||
        snapshot.error !== undefined ||
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
        if (snapshot.loading) publish({ loading: false });
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
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
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
      snapshot = emptyCommitGraphPageWindowSnapshot;
      listeners.clear();
    },
    loadInitial,
    discard,
    reload: loadInitial,
    appendOlder: async () => {
      if (snapshot.hasOlder) await prefetchOffset(snapshot.endOffset);
    },
    prefetchOffset,
    setViewport: (first, last) => {
      if (viewport !== undefined && first !== viewport.first)
        scrollingBackwards = first < viewport.first;
      viewport = { first, last };
      const lookahead = Math.max(1, (last - first + 1) * 2);
      if (scrollingBackwards) {
        const offset = Math.max(0, snapshot.startOffset - pageSize);
        const lastVisiblePage = Math.floor(last / pageSize) * pageSize;
        if (
          first < snapshot.startOffset + lookahead &&
          snapshot.startOffset > 0 &&
          (lastVisiblePage - offset) / pageSize < maximumPages
        )
          void prefetchOffset(offset, true);
      } else {
        const firstVisiblePage = Math.floor(first / pageSize) * pageSize;
        if (
          last >= snapshot.endOffset - lookahead &&
          snapshot.hasOlder &&
          (snapshot.endOffset - firstVisiblePage) / pageSize < maximumPages
        )
          void prefetchOffset(snapshot.endOffset, true);
      }
    },
    requestMove,
    requestLaneMove: (offset, direction) => {
      const pageOffset = Math.floor(offset / pageSize) * pageSize;
      const page = view?.pages.get(pageOffset);
      const row = page?.rows[offset - pageOffset];
      if (
        row === undefined ||
        (direction > 0 && !row.lanesAfter.includes(row.nodeLaneId))
      )
        return Promise.resolve(undefined);
      return requestMove(offset + direction, {
        id: row.nodeLaneId,
        direction,
        activeOid: row.oid,
        epoch: snapshot.epoch,
      });
    },
    cancelNavigation,
    jumpToOid,
    retry: async () => {
      await retryTask?.();
    },
  };
}
