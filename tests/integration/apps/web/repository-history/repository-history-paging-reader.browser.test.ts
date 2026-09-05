import {
  encodeRepositoryHistoryPage,
  type RepositoryCommit,
} from "@rebase/contracts";
import { describe, expect, it, vi } from "vitest";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import type {
  RepositoryHistoryGateway,
  RepositoryHistoryQuery,
} from "#web/features/repository-history/repository-history-reader.contract";

describe("progressive browser history paging", () => {
  it.each(["all", "first-parent"] as const)(
    "reads and caches successive %s pages before synchronization completes",
    async (ancestry) => {
      const repositoryId = crypto.randomUUID();
      const commits = history(250);
      const root = { name: "main", oid: oid(0), type: "branch" as const };
      const additionalParentEdges = [{ childOid: oid(0), parentOid: oid(200) }];
      const query: RepositoryHistoryQuery = {
        ancestry,
        additionalParentEdges,
        limit: 100,
        order: "topological",
        roots: [root],
      };
      const gateway: RepositoryHistoryGateway = {
        read: vi.fn(async (request) =>
          encodeRepositoryHistoryPage({
            commits: commits.slice(
              request.offset ?? 0,
              (request.offset ?? 0) + request.limit,
            ),
            objectFormat: "sha1",
            refTargets: [root],
            repositoryId,
            requestId: crypto.randomUUID(),
          }),
        ),
        synchronize: vi.fn(
          (_request, _acceptBatch, signal) =>
            new Promise<number>((_resolve, reject) => {
              const abort = () =>
                reject(new DOMException("Aborted", "AbortError"));
              if (signal?.aborted) abort();
              else signal?.addEventListener("abort", abort, { once: true });
            }),
        ),
      };
      const reader = createBrowserRepositoryHistoryReader({
        environmentId: crypto.randomUUID(),
        repositoryId,
        gateway,
      });
      try {
        expect(await reader.read(query)).toEqual(commits.slice(0, 100));
        await vi.waitFor(() =>
          expect(gateway.synchronize).toHaveBeenCalledOnce(),
        );
        expect(reader.getSnapshot().synchronization).toBe("syncing");

        const secondQuery = { ...query, offset: 100 };
        expect(await reader.read(secondQuery)).toEqual(commits.slice(100, 200));
        expect(gateway.read).toHaveBeenNthCalledWith(
          2,
          {
            ancestry,
            additionalParentEdges,
            limit: 100,
            offset: 100,
            order: "topological",
            repositoryId,
            roots: [root],
          },
          expect.any(AbortSignal),
        );
        expect(await reader.read(secondQuery)).toEqual(commits.slice(100, 200));
        expect(gateway.read).toHaveBeenCalledTimes(2);
        expect(await reader.read({ ...query, offset: 200 })).toEqual(
          commits.slice(200),
        );
        expect(await reader.read({ ...query, offset: 250 })).toEqual([]);
        expect(gateway.read).toHaveBeenCalledTimes(3);
        expect(reader.getSnapshot().synchronization).toBe("syncing");
      } finally {
        reader.close();
      }
    },
  );
});

function oid(index: number) {
  return index.toString(16).padStart(40, "0");
}

function history(count: number): readonly RepositoryCommit[] {
  return Array.from({ length: count }, (_, index) => {
    const identity = {
      email: "alex@example.test",
      name: "Alex I.",
      timestampSeconds: 1_777_777_777 - index,
      timezoneOffsetMinutes: 120,
    };
    return {
      author: identity,
      committer: identity,
      oid: oid(index),
      parents:
        index === 0
          ? [oid(1), oid(200)]
          : index === count - 1
            ? []
            : [oid(index + 1)],
      subject: `Commit ${index}`,
    };
  });
}
