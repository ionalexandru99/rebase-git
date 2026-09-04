import {
  encodeRepositoryHistoryBatch,
  encodeRepositoryHistoryPage,
  type RepositoryCommit,
  type RepositoryFreshness,
} from "@rebase/contracts";
import { describe, expect, it, vi } from "vitest";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import {
  type RepositoryHistoryGateway,
  RepositoryHistoryOffline,
} from "#web/features/repository-history/repository-history-reader.contract";

const fresh: RepositoryFreshness = {
  defaultIntervalSeconds: 300,
  fetching: false,
  stale: false,
  revision: 0,
  setting: { _tag: "Inherit" },
};

describe("browser repository freshness", () => {
  it("shares a subscription across worktree readers and sends actions through its owner", async () => {
    const environmentId = crypto.randomUUID();
    const logicalRepositoryId = crypto.randomUUID();
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const firstGateway = fixture(firstId);
    const secondGateway = fixture(secondId);
    const first = createBrowserRepositoryHistoryReader({
      environmentId,
      logicalRepositoryId,
      repositoryId: firstId,
      gateway: firstGateway.gateway,
    });
    await vi.waitFor(() =>
      expect(first.getSnapshot().freshness).toEqual(fresh),
    );
    const second = createBrowserRepositoryHistoryReader({
      environmentId,
      logicalRepositoryId,
      repositoryId: secondId,
      gateway: secondGateway.gateway,
    });
    try {
      await vi.waitFor(() =>
        expect(second.getSnapshot().freshness).toEqual(fresh),
      );
      expect(firstGateway.subscribe).toHaveBeenCalledOnce();
      expect(secondGateway.subscribe).not.toHaveBeenCalled();
      await second.fetch();
      expect(firstGateway.fetch).toHaveBeenCalledWith(
        firstId,
        expect.any(AbortSignal),
      );
      expect(secondGateway.fetch).not.toHaveBeenCalled();
      await second.configureFetch({ _tag: "Disabled" });
      expect(firstGateway.configure).toHaveBeenCalledWith(
        firstId,
        { _tag: "Disabled" },
        expect.any(AbortSignal),
      );
      await vi.waitFor(() =>
        expect(first.getSnapshot().freshness?.setting).toEqual({
          _tag: "Disabled",
        }),
      );
      first.close();
      await vi.waitFor(() =>
        expect(secondGateway.subscribe).toHaveBeenCalledOnce(),
      );
      expect(firstGateway.release).toHaveBeenCalledOnce();
      await second.fetch();
      expect(secondGateway.fetch).toHaveBeenCalledOnce();
    } finally {
      first.close();
      second.close();
    }
    expect(secondGateway.release).toHaveBeenCalledOnce();
  });

  it("keeps cached history ready after fetch failure without flashing commit progress for no changes", async () => {
    const repositoryId = crypto.randomUUID();
    const data = fixture(repositoryId);
    const reader = createBrowserRepositoryHistoryReader({
      environmentId: crypto.randomUUID(),
      repositoryId,
      gateway: data.gateway,
    });
    try {
      await reader.read({ limit: 100, order: "topological", roots: [ref()] });
      await vi.waitFor(() =>
        expect(reader.getSnapshot().synchronization).toBe("complete"),
      );
      const progress: boolean[] = [];
      const unsubscribe = reader.subscribe(() =>
        progress.push(reader.getSnapshot().storingCommits ?? false),
      );
      const failure: RepositoryFreshness = {
        ...fresh,
        revision: 1,
        stale: true,
        failure: { _tag: "FetchFailed", reason: "Failed" },
      };
      data.fetch.mockImplementation(async () => {
        data.publish(failure);
        return failure;
      });
      await reader.fetch();
      await vi.waitFor(() => expect(data.synchronize).toHaveBeenCalledTimes(2));
      await vi.waitFor(() =>
        expect(reader.getSnapshot().synchronization).toBe("complete"),
      );
      expect(reader.getSnapshot()).toMatchObject({
        status: "ready",
        freshness: failure,
        storingCommits: false,
      });
      expect(reader.getSnapshot().error).toBeUndefined();
      expect(await reader.getCommitSummaries([commit().oid])).toEqual([
        commit(),
      ]);
      expect(progress.every((value) => !value)).toBe(true);
      data.fail(new RepositoryHistoryOffline());
      await vi.waitFor(() =>
        expect(reader.getSnapshot().freshnessError?._tag).toBe(
          "RepositoryHistoryOffline",
        ),
      );
      expect(reader.getSnapshot().status).toBe("ready");
      data.publish({ ...fresh, revision: 2 });
      await vi.waitFor(() =>
        expect(reader.getSnapshot().freshnessError).toBeUndefined(),
      );
      unsubscribe();
    } finally {
      reader.close();
    }
  });

  it("reconciles local changes from the completed basis and coalesces movements during synchronization", async () => {
    const repositoryId = crypto.randomUUID();
    const data = fixture(repositoryId);
    const next = commit("b", [commit().oid]);
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    data.synchronize.mockImplementation(async (_request, accept) => {
      const attempt = data.synchronize.mock.calls.length;
      await accept(
        batch(
          repositoryId,
          attempt === 1 ? [commit()] : attempt === 2 ? [next] : [],
          attempt === 1 ? commit() : next,
        ),
      );
      if (attempt === 2) await pending;
      return attempt === 1 ? 1 : 2;
    });
    const reader = createBrowserRepositoryHistoryReader({
      environmentId: crypto.randomUUID(),
      repositoryId,
      gateway: data.gateway,
    });
    try {
      await reader.read({ limit: 100, order: "topological", roots: [ref()] });
      await vi.waitFor(() =>
        expect(reader.getSnapshot().synchronization).toBe("complete"),
      );
      data.publish({ ...fresh, revision: 1 });
      await vi.waitFor(() => expect(data.synchronize).toHaveBeenCalledTimes(2));
      expect(data.synchronize.mock.calls[1]?.[0].basis).toMatchObject({
        _tag: "Complete",
        rootOids: [commit().oid],
      });
      expect(await reader.getRefTargets()).toEqual([ref()]);
      data.publish({ ...fresh, revision: 2 });
      data.publish({ ...fresh, revision: 3 });
      await vi.waitFor(() =>
        expect(reader.getSnapshot().freshness?.revision).toBe(3),
      );
      expect(data.synchronize).toHaveBeenCalledTimes(2);
      finish?.();
      await vi.waitFor(() => expect(data.synchronize).toHaveBeenCalledTimes(3));
      await vi.waitFor(() =>
        expect(reader.getSnapshot().synchronization).toBe("complete"),
      );
      expect(data.synchronize.mock.calls[2]?.[0].basis).toMatchObject({
        _tag: "Complete",
        rootOids: [next.oid],
      });
      expect(await reader.getRefTargets()).toEqual([ref(next)]);
      expect(await reader.getCommitSummaries([next.oid])).toEqual([next]);
    } finally {
      finish?.();
      reader.close();
    }
  });
});

function fixture(repositoryId: string) {
  let publish: (freshness: RepositoryFreshness) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  let current = fresh;
  const release = vi.fn();
  const subscribe = vi.fn<
    NonNullable<RepositoryHistoryGateway["freshness"]>["subscribe"]
  >((_id, listener, onError) => {
    publish = listener;
    fail = onError;
    listener(current);
    return release;
  });
  const fetch = vi.fn<
    NonNullable<RepositoryHistoryGateway["freshness"]>["fetch"]
  >(async () => current);
  const configure = vi.fn<
    NonNullable<RepositoryHistoryGateway["freshness"]>["configure"]
  >(async (_id, setting) => {
    current = { ...current, setting };
    publish(current);
    return current;
  });
  const synchronize = vi.fn<RepositoryHistoryGateway["synchronize"]>(
    async (request, accept) => {
      await accept(
        batch(repositoryId, request.basis === undefined ? [commit()] : []),
      );
      return 1;
    },
  );
  const gateway: RepositoryHistoryGateway = {
    freshness: { subscribe, fetch, configure },
    read: async () =>
      encodeRepositoryHistoryPage({
        commits: [commit()],
        objectFormat: "sha1",
        refTargets: [ref()],
        repositoryId,
        requestId: crypto.randomUUID(),
      }),
    synchronize,
  };
  return {
    fail: (error: unknown) => fail(error),
    gateway,
    release,
    subscribe,
    fetch,
    configure,
    synchronize,
    publish: (freshness: RepositoryFreshness) => {
      current = freshness;
      publish(freshness);
    },
  };
}

function batch(
  repositoryId: string,
  commits: readonly RepositoryCommit[],
  latest = commit(),
) {
  return encodeRepositoryHistoryBatch({
    commits,
    objectFormat: "sha1",
    repositoryId,
    requestId: crypto.randomUUID(),
    sequence: 0,
    snapshot: {
      id: latest.oid[0]?.repeat(64) ?? "a".repeat(64),
      objectFormat: "sha1",
      refTargets: [ref(latest)],
      resumable: true,
      rootOids: [latest.oid],
    },
  });
}

function ref(latest = commit()) {
  return { name: "main", oid: latest.oid, type: "branch" as const };
}

function commit(
  character = "a",
  parents: readonly string[] = [],
): RepositoryCommit {
  const identity = {
    email: "test@example.com",
    name: "Test",
    timestampSeconds: 1_000,
    timezoneOffsetMinutes: 0,
  };
  return {
    oid: character.repeat(40),
    author: identity,
    committer: identity,
    parents,
    subject: character,
  };
}
