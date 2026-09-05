import type { RepositoryCommit } from "@rebase/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  appendCommitLanes,
  createCommitLaneCheckpoint,
} from "#web/features/commit-graph/layout/commit-lanes";
import { createCommitGraphPageWindow } from "#web/features/commit-graph/paging/commit-graph-page-window";
import type { CommitGraphPageReader } from "#web/features/commit-graph/paging/commit-graph-page-window.contract";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";

const query: RepositoryHistoryQuery = {
  roots: [{ name: "main", oid: oid(0), type: "branch" }],
  order: "topological",
  limit: 100,
};

describe("commit graph page window", () => {
  it.each([2, 16])(
    "keeps a moving viewport resident with 350 ms reads and a %i-page budget",
    async (maximumPages) => {
      vi.useFakeTimers();
      const commits = history(3_000);
      const reader = fakeReader(commits);
      const window = createCommitGraphPageWindow(reader, { maximumPages });
      try {
        await window.loadInitial(query);
        reader.read.mockImplementation(async (request) => {
          await new Promise((resolve) => setTimeout(resolve, 350));
          return commits.slice(
            request.offset ?? 0,
            (request.offset ?? 0) + request.limit,
          );
        });
        const checkViewport = (first: number) => {
          window.setViewport(first, first + 39);
          const snapshot = window.getSnapshot();
          expect(snapshot.pages.length).toBeLessThanOrEqual(maximumPages);
          for (let offset = first; offset < first + 40; offset += 1) {
            const page = snapshot.pages.find(
              (item) =>
                item.offset <= offset &&
                item.offset + item.commits.length > offset,
            );
            expect(
              page?.commits[offset - (page?.offset ?? 0)]?.oid,
              `visible row ${offset} at viewport ${first}`,
            ).toBe(oid(offset));
          }
        };
        checkViewport(0);
        for (let first = 6; first <= 2_100; first += 6) {
          await vi.advanceTimersByTimeAsync(50);
          checkViewport(first);
        }
        for (let first = 2_094; first >= 0; first -= 6) {
          await vi.advanceTimersByTimeAsync(50);
          checkViewport(first);
        }
      } finally {
        window.dispose();
        vi.useRealTimers();
      }
    },
  );

  it.each([89, 299])(
    "preserves a contiguous cache when a pending prefetch outlives viewport 0..%i",
    async (last) => {
      const commits = history(300);
      const reader = fakeReader(commits);
      const window = createCommitGraphPageWindow(reader, { maximumPages: 2 });
      await window.loadInitial(query);
      await window.appendOlder();
      const pending = deferred<readonly RepositoryCommit[]>();
      reader.read.mockReturnValueOnce(pending.promise);
      window.setViewport(100, 139);
      await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(3));
      window.setViewport(0, last);
      pending.resolve(commits.slice(200));
      await vi.waitFor(() => expect(window.getSnapshot().loading).toBe(false));
      expect(window.getSnapshot().pages.map((page) => page.offset)).toEqual([
        0, 100,
      ]);
      expect(window.getSnapshot().knownEndOffset).toBe(200);
      window.dispose();
    },
  );

  it("protects an existing read when the viewport requests the same page", async () => {
    const commits = history(300);
    const reader = fakeReader(commits);
    const window = createCommitGraphPageWindow(reader, { maximumPages: 2 });
    await window.loadInitial(query);
    await window.appendOlder();
    const pending = deferred<readonly RepositoryCommit[]>();
    reader.read.mockReturnValueOnce(pending.promise);
    const loading = window.appendOlder();
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(3));
    window.setViewport(100, 139);
    window.setViewport(0, 299);
    pending.resolve(commits.slice(200));
    await loading;
    expect(window.getSnapshot().pages.map((page) => page.offset)).toEqual([
      0, 100,
    ]);
    expect(reader.read).toHaveBeenCalledTimes(3);
    window.dispose();
  });

  it("discards resident history and pending navigation while preserving the query for rebuild", async () => {
    const commits = history(12);
    const reader = fakeReader(commits);
    const window = createCommitGraphPageWindow(reader, { pageSize: 5 });
    await window.loadInitial(query);
    reader.read.mockRejectedValueOnce(new Error("Disconnected"));
    await window.appendOlder();
    expect(window.getSnapshot().error).toBeDefined();
    const pending = deferred<readonly RepositoryCommit[]>();
    reader.read.mockReturnValueOnce(pending.promise);
    const loading = window.prefetchOffset(5);
    const move = window.requestMove(6);
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(3));
    const epoch = window.getSnapshot().epoch;

    window.discard();

    await expect(move).resolves.toBeUndefined();
    expect(window.getSnapshot()).toMatchObject({
      query: { ...query, limit: 5, offset: 0 },
      pages: [],
      loading: false,
      error: undefined,
      pendingMove: undefined,
      hasOlder: false,
      checkpointCount: 0,
      startOffset: 0,
      endOffset: 0,
    });
    expect(window.getSnapshot().epoch).toBeGreaterThan(epoch);
    await window.retry();
    await window.appendOlder();
    expect(reader.read).toHaveBeenCalledTimes(3);
    pending.resolve(commits.slice(5, 10));
    await loading;
    expect(window.getSnapshot().pages).toEqual([]);

    await window.reload(query);
    expect(window.getSnapshot().endOffset).toBe(5);
    expect(reader.read).toHaveBeenCalledTimes(4);
    window.dispose();
  });

  it("automatically appends older rows from a checkpoint without changing prior plans", async () => {
    const commits = history(15).map((commit, index) =>
      index === 0
        ? { ...commit, parents: [oid(1), oid(2)] }
        : index === 1
          ? { ...commit, parents: [oid(3)] }
          : commit,
    );
    const reader = fakeReader(commits);
    const window = createCommitGraphPageWindow(reader, { pageSize: 5 });
    await window.loadInitial(query);
    const initial = window.getSnapshot().pages[0];
    window.setViewport(0, 4);
    await vi.waitFor(() => expect(window.getSnapshot().endOffset).toBe(10));
    expect(window.getSnapshot().pages[0]).toBe(initial);
    const rows = window.getSnapshot().pages.flatMap((page) => page.rows);
    expect(rows).toEqual(
      appendCommitLanes(createCommitLaneCheckpoint(), commits.slice(0, 10))
        .rows,
    );
    expect(reader.read).toHaveBeenLastCalledWith({
      ...query,
      limit: 5,
      offset: 5,
    });
    window.dispose();
  });

  it("keeps loaded history and exposes retry when an older page fails", async () => {
    const reader = fakeReader(history(12));
    const window = createCommitGraphPageWindow(reader, { pageSize: 5 });
    await window.loadInitial(query);
    const before = window.getSnapshot().pages[0];
    reader.read.mockRejectedValueOnce(new Error("Disconnected"));
    await window.appendOlder();
    expect(window.getSnapshot()).toMatchObject({
      endOffset: 5,
      error: { offset: 5, message: "Disconnected" },
    });
    expect(window.getSnapshot().pages[0]).toBe(before);
    await window.retry();
    expect(window.getSnapshot()).toMatchObject({
      endOffset: 10,
      error: undefined,
    });
    await window.appendOlder();
    expect(window.getSnapshot()).toMatchObject({
      endOffset: 12,
      hasOlder: false,
    });
    const calls = reader.read.mock.calls.length;
    await window.appendOlder();
    expect(reader.read).toHaveBeenCalledTimes(calls);
    window.dispose();
  });

  it("retains a failed older page retry while restoring another evicted page", async () => {
    const reader = fakeReader(history(25));
    const window = createCommitGraphPageWindow(reader, {
      pageSize: 5,
      maximumPages: 2,
    });
    await window.loadInitial(query);
    await window.appendOlder();
    await window.appendOlder();
    reader.read.mockRejectedValueOnce(new Error("Older page failed"));
    await window.appendOlder();
    expect(window.getSnapshot().error?.offset).toBe(15);
    await window.prefetchOffset(0);
    expect(window.getSnapshot().error).toEqual({
      offset: 15,
      message: "Older page failed",
    });
    await window.retry();
    expect(window.getSnapshot().error).toBeUndefined();
    expect(window.getSnapshot().pages.some((page) => page.offset === 15)).toBe(
      true,
    );
    window.dispose();
  });

  it("bounds resident metadata and checkpoints and restores evicted pages", async () => {
    const reader = fakeReader(history(120));
    const window = createCommitGraphPageWindow(reader, {
      pageSize: 2,
      maximumPages: 2,
      maximumBytes: 6_000,
    });
    await window.loadInitial(query);
    const firstPlans = window.getSnapshot().pages[0]?.rows;
    for (let page = 1; page < 50; page += 1) {
      await window.appendOlder();
      expect(window.getSnapshot().pages.length).toBeLessThanOrEqual(2);
      expect(window.getSnapshot().estimatedBytes).toBeLessThanOrEqual(6_000);
    }
    expect(window.getSnapshot().checkpointCount).toBeLessThan(30);
    expect(window.getSnapshot().startOffset).toBeGreaterThan(0);
    await window.prefetchOffset(0);
    expect(window.getSnapshot().pages[0]?.rows).toEqual(firstPlans);
    expect(await window.requestMove(0)).toEqual({ oid: oid(0), offset: 0 });
    window.dispose();
  });

  it("retains only one pending keyboard move while its page loads", async () => {
    const commits = history(15);
    const reader = fakeReader(commits);
    const window = createCommitGraphPageWindow(reader, { pageSize: 5 });
    await window.loadInitial(query);
    const pending = deferred<readonly RepositoryCommit[]>();
    reader.read.mockReturnValueOnce(pending.promise);
    const first = window.requestMove(5);
    const last = window.requestMove(6);
    await expect(first).resolves.toBeUndefined();
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(2));
    expect(window.getSnapshot().pendingMove).toBe(6);
    pending.resolve(commits.slice(5, 10));
    await expect(last).resolves.toEqual({ oid: oid(6), offset: 6 });
    expect(window.getSnapshot().pendingMove).toBeUndefined();
    expect(reader.read).toHaveBeenCalledTimes(2);
    window.dispose();
  });

  it("finishes an automatic refresh after a pointer cancels pending navigation", async () => {
    const reader = fakeReader(history(15));
    const window = createCommitGraphPageWindow(reader, { pageSize: 5 });
    await window.loadInitial(query);
    const pending = deferred<number | undefined>();
    reader.locate.mockReturnValueOnce(pending.promise);
    const refresh = window.reload(query, oid(2));
    expect(window.getSnapshot().loading).toBe(true);
    window.cancelNavigation();
    pending.resolve(2);
    await refresh;
    expect(window.getSnapshot()).toMatchObject({
      loading: false,
      anchorOid: oid(2),
    });
    expect(reader.read).toHaveBeenCalledTimes(2);
    window.dispose();
  });

  it.each([10, undefined])(
    "supersedes an older refresh anchor lookup with an explicit jump to %s",
    async (index) => {
      const reader = fakeReader(history(15));
      const window = createCommitGraphPageWindow(reader, { pageSize: 5 });
      await window.loadInitial(query);
      const pending = deferred<number | undefined>();
      reader.locate
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce(index);
      const refresh = window.reload(query, oid(2));
      const target = await window.jumpToOid(oid(10));
      expect(target?.offset).toBe(index);
      pending.resolve(2);
      await refresh;
      expect(window.getSnapshot()).toMatchObject({
        loading: false,
        startOffset: index ?? 0,
      });
      window.dispose();
    },
  );

  it("keeps the newest keyboard move after cancelling an earlier pending page", async () => {
    const commits = history(15);
    const reader = fakeReader(commits);
    const window = createCommitGraphPageWindow(reader, { pageSize: 5 });
    await window.loadInitial(query);
    const pending = deferred<readonly RepositoryCommit[]>();
    reader.read.mockReturnValueOnce(pending.promise);
    const first = window.requestMove(5);
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(2));
    window.cancelNavigation();
    const latest = window.requestMove(7);
    await expect(first).resolves.toBeUndefined();
    pending.resolve(commits.slice(5, 10));
    await expect(latest).resolves.toEqual({ oid: oid(7), offset: 7 });
    expect(reader.read).toHaveBeenCalledTimes(2);
    window.dispose();
  });

  it("follows a lane across intervening pages and restores an evicted previous node", async () => {
    const commits = history(30).map((commit, index) =>
      index === 4
        ? { ...commit, parents: [oid(10)] }
        : index === 9
          ? { ...commit, parents: [] }
          : commit,
    );
    const reader = fakeReader(commits);
    const window = createCommitGraphPageWindow(reader, {
      pageSize: 5,
      maximumPages: 2,
    });
    await window.loadInitial(query);
    const pending = deferred<readonly RepositoryCommit[]>();
    reader.read.mockReturnValueOnce(pending.promise);
    const first = window.requestLaneMove(4, 1);
    const second = window.requestLaneMove(4, 1);
    await expect(first).resolves.toBeUndefined();
    pending.resolve(commits.slice(5, 10));
    await expect(second).resolves.toEqual({ oid: oid(10), offset: 10 });
    expect(window.getSnapshot().pages.map((page) => page.offset)).toEqual([
      5, 10,
    ]);
    await expect(window.requestLaneMove(10, -1)).resolves.toEqual({
      oid: oid(4),
      offset: 4,
    });
    expect(window.getSnapshot().pages.length).toBeLessThanOrEqual(2);
    window.dispose();
  });

  it("stops lane navigation at an incomplete boundary without retrying the same partial page", async () => {
    const reader = fakeReader(history(4).slice(0, 3));
    const window = createCommitGraphPageWindow(reader, { pageSize: 5 });
    await window.loadInitial(query);
    await expect(window.requestLaneMove(2, 1)).resolves.toBeUndefined();
    await expect(window.requestLaneMove(0, -1)).resolves.toBeUndefined();
    expect(reader.read).toHaveBeenCalledTimes(1);
    window.dispose();
  });

  it("retains old rows during a refresh and ignores superseded pages", async () => {
    const commits = history(20);
    const reader = fakeReader(commits);
    const window = createCommitGraphPageWindow(reader, { pageSize: 5 });
    await window.loadInitial(query);
    const original = window.getSnapshot().pages[0];
    const pending = deferred<readonly RepositoryCommit[]>();
    reader.read.mockReturnValueOnce(pending.promise);
    const older = window.reload({ ...query, order: "chronological" });
    expect(window.getSnapshot().pages[0]).toBe(original);
    expect(window.getSnapshot().loading).toBe(true);
    await window.reload(query, oid(12));
    expect(window.getSnapshot()).toMatchObject({
      anchorOid: oid(12),
      startOffset: 10,
      loading: false,
    });
    pending.resolve(commits.slice(0, 5));
    await older;
    expect(window.getSnapshot()).toMatchObject({
      anchorOid: oid(12),
      startOffset: 10,
      query: { order: "topological" },
    });
    window.dispose();
  });

  it("jumps directly to a located window and replans a newer window with its anchor", async () => {
    const reader = fakeReader(history(500));
    const window = createCommitGraphPageWindow(reader, { pageSize: 5 });
    await window.loadInitial(query);
    await expect(window.jumpToOid(oid(402))).resolves.toMatchObject({
      oid: oid(402),
      offset: 402,
    });
    expect(reader.read.mock.calls.map(([request]) => request.offset)).toEqual([
      0, 400,
    ]);
    const epoch = window.getSnapshot().epoch;
    await window.prefetchOffset(399);
    expect(window.getSnapshot()).toMatchObject({
      startOffset: 395,
      endOffset: 405,
      anchorOid: oid(400),
    });
    expect(window.getSnapshot().epoch).toBeGreaterThan(epoch);
    expect(window.getSnapshot().pages.flatMap((page) => page.rows)).toEqual(
      appendCommitLanes(
        createCommitLaneCheckpoint(),
        history(500).slice(395, 405),
      ).rows,
    );
    window.dispose();
  });

  it("reveals ancestry routes before locating a hidden search result", async () => {
    const reader = fakeReader(history(20));
    reader.locate.mockImplementation(async (request, target) =>
      request.additionalParentEdges?.length
        ? Number.parseInt(target, 16)
        : undefined,
    );
    reader.ancestryRoute
      .mockResolvedValueOnce({
        edges: [{ childOid: oid(0), parentOid: oid(2) }],
        continuationOid: oid(2),
      })
      .mockResolvedValueOnce({
        edges: [{ childOid: oid(2), parentOid: oid(7) }],
      });
    const window = createCommitGraphPageWindow(reader, { pageSize: 5 });
    await window.loadInitial({ ...query, ancestry: "first-parent" });
    const result = await window.jumpToOid(oid(7));
    expect(result?.query.additionalParentEdges).toEqual([
      { childOid: oid(0), parentOid: oid(2) },
      { childOid: oid(2), parentOid: oid(7) },
    ]);
    expect(window.getSnapshot()).toMatchObject({
      startOffset: 5,
      anchorOid: oid(7),
    });
    expect(reader.ancestryRoute).toHaveBeenNthCalledWith(1, [oid(0)], oid(7));
    expect(reader.ancestryRoute).toHaveBeenNthCalledWith(2, [oid(2)], oid(7));
    window.dispose();
  });

  it("filters folded parents while keeping independently scoped parents outside the page", async () => {
    const commits = history(20);
    const merge = {
      ...(commits[0] as RepositoryCommit),
      parents: [oid(1), oid(10), oid(15)],
    };
    const reader = fakeReader([merge, ...commits.slice(1)]);
    reader.locateMany.mockResolvedValue([{ oid: oid(15), index: 15 }]);
    const window = createCommitGraphPageWindow(reader, { pageSize: 5 });
    await window.loadInitial({ ...query, ancestry: "first-parent" });
    expect(window.getSnapshot().pages[0]?.commits[0]?.parents).toEqual([
      oid(1),
      oid(10),
      oid(15),
    ]);
    expect(window.getSnapshot().pages[0]?.topology[0]?.parents).toEqual([
      oid(1),
      oid(15),
    ]);
    expect(reader.locateMany).toHaveBeenCalledWith(
      expect.objectContaining({ ancestry: "first-parent" }),
      [oid(10), oid(15)],
    );
    window.dispose();
  });

  it("rejects an oversized page without evicting usable rows", async () => {
    const commits = history(12);
    const reader = fakeReader(commits);
    const window = createCommitGraphPageWindow(reader, {
      pageSize: 5,
      maximumBytes: 12_000,
    });
    await window.loadInitial(query);
    const original = window.getSnapshot().pages[0];
    reader.read.mockResolvedValueOnce([
      { ...(commits[5] as RepositoryCommit), subject: "x".repeat(10_000) },
    ]);
    await window.appendOlder();
    expect(window.getSnapshot().error?.message).toContain("cache budget");
    expect(window.getSnapshot().pages[0]).toBe(original);
    window.dispose();
  });
});

function fakeReader(commits: readonly RepositoryCommit[]) {
  return {
    read: vi.fn<CommitGraphPageReader["read"]>(async (request) =>
      commits.slice(request.offset ?? 0, (request.offset ?? 0) + request.limit),
    ),
    locate: vi.fn<CommitGraphPageReader["locate"]>(async (_request, target) => {
      const index = commits.findIndex((commit) => commit.oid === target);
      return index < 0 ? undefined : index;
    }),
    locateMany: vi.fn<CommitGraphPageReader["locateMany"]>(
      async (_request, targets) =>
        commits.flatMap((commit, index) =>
          targets.includes(commit.oid) ? [{ oid: commit.oid, index }] : [],
        ),
    ),
    ancestryRoute: vi.fn<CommitGraphPageReader["ancestryRoute"]>(
      async () => undefined,
    ),
  } satisfies CommitGraphPageReader;
}

function oid(index: number) {
  return index.toString(16).padStart(40, "0");
}
function history(count: number): RepositoryCommit[] {
  return Array.from({ length: count }, (_, index) => {
    const identity = {
      name: "Alex",
      email: "alex@example.test",
      timestampSeconds: count - index,
      timezoneOffsetMinutes: 0,
    };
    return {
      oid: oid(index),
      parents: index + 1 < count ? [oid(index + 1)] : [],
      author: identity,
      committer: identity,
      subject: `Commit ${index}`,
    };
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
