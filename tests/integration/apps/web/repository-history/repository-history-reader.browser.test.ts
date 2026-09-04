import {
  encodeRepositoryHistoryBatch,
  encodeRepositoryHistoryPage,
  type RepositoryCommit,
} from "@rebase/contracts";
import { describe, expect, it, vi } from "vitest";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import type { RepositoryHistoryGateway } from "#web/features/repository-history/repository-history-reader.contract";
import { RepositoryHistoryUnavailable } from "#web/features/repository-history/repository-history-reader.contract";
import { readRepositoryCommits } from "#web/features/repository-history/repository-history-store";

describe("browser repository history reader", () => {
  it("publishes only IndexedDB-committed synchronization progress", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    let acceptBatch: ((bytes: Uint8Array) => Promise<void>) | undefined;
    let finishSynchronization: ((count: number) => void) | undefined;
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, history(2))),
      synchronize: vi.fn(
        (_request, accept) =>
          new Promise<number>((resolve) => {
            acceptBatch = accept;
            finishSynchronization = resolve;
          }),
      ),
    };
    const reader = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway,
      repositoryId,
    });
    await reader.read({
      limit: 100,
      order: "topological",
      roots: [root("main")],
    });
    await vi.waitFor(() =>
      expect(reader.getSnapshot().synchronization).toBe("syncing"),
    );
    const synchronized = history(3);

    await acceptBatch?.(
      encodeRepositoryHistoryBatch({
        commits: synchronized,
        objectFormat: "sha1",
        repositoryId,
        requestId: crypto.randomUUID(),
        sequence: 0,
      }),
    );

    expect(reader.getSnapshot().synchronizedCommitCount).toBe(3);
    await expect(
      readRepositoryCommits(environmentId, repositoryId, [
        synchronized[2]?.oid ?? "",
      ]),
    ).resolves.toEqual([synchronized[2]]);
    finishSynchronization?.(3);
    await vi.waitFor(() =>
      expect(reader.getSnapshot().synchronization).toBe("complete"),
    );
    reader.close();
  });

  it("cancels synchronization when the final reader closes", async () => {
    const repositoryId = crypto.randomUUID();
    let synchronizationSignal: AbortSignal | undefined;
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, history(1))),
      synchronize: vi.fn((_request, _accept, signal) => {
        synchronizationSignal = signal;
        return new Promise<number>(() => undefined);
      }),
    };
    const reader = createBrowserRepositoryHistoryReader({
      environmentId: crypto.randomUUID(),
      gateway,
      repositoryId,
    });
    await reader.read({
      limit: 100,
      order: "topological",
      roots: [root("main")],
    });
    await vi.waitFor(() => expect(gateway.synchronize).toHaveBeenCalledOnce());

    reader.close();

    expect(synchronizationSignal?.aborted).toBe(true);
  });

  it("stores a page in IndexedDB before publishing its repository snapshot", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const commits = history(100);
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, commits)),
      synchronize: vi.fn(async () => 0),
    };
    const reader = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway,
      repositoryId,
    });
    const changed = vi.fn();
    reader.subscribe(changed);

    const result = await reader.read({
      limit: 100,
      order: "topological",
      roots: [root("main")],
    });

    expect(result).toEqual(commits);
    expect(reader.getSnapshot()).toMatchObject({ status: "ready" });
    expect(changed).toHaveBeenCalled();
    await expect(
      reader.getCommitSummaries([commits[3]?.oid ?? ""]),
    ).resolves.toEqual([commits[3]]);
    await expect(
      readRepositoryCommits(environmentId, repositoryId, [
        commits[9]?.oid ?? "",
      ]),
    ).resolves.toEqual([commits[9]]);
    await expect(reader.getRefTargets()).resolves.toEqual([root("main")]);
    reader.close();
  });

  it("cancels a superseded epoch and publishes only the latest page", async () => {
    const repositoryId = crypto.randomUUID();
    let firstSignal: AbortSignal | undefined;
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn((request, signal) => {
        if (request.roots[0]?.name === "old") {
          firstSignal = signal;
          return new Promise<Uint8Array>(() => undefined);
        }
        return Promise.resolve(page(repositoryId, history(2)));
      }),
      synchronize: vi.fn(async () => 0),
    };
    const reader = createBrowserRepositoryHistoryReader({
      environmentId: crypto.randomUUID(),
      gateway,
      repositoryId,
    });

    const stale = reader.read({
      limit: 100,
      order: "topological",
      roots: [root("old")],
    });
    const current = reader.read({
      limit: 100,
      order: "topological",
      roots: [root("main")],
    });

    await expect(stale).rejects.toBeInstanceOf(RepositoryHistoryUnavailable);
    await expect(current).resolves.toHaveLength(2);
    expect(firstSignal?.aborted).toBe(true);
    expect(reader.getSnapshot().status).toBe("ready");
    reader.close();
  });

  it("shares repository snapshots across readers and releases the final session", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const commits = history(3);
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, commits)),
      synchronize: vi.fn(async () => 0),
    };
    const first = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway,
      repositoryId,
    });
    const second = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway,
      repositoryId,
    });
    const secondChanged = vi.fn();
    second.subscribe(secondChanged);

    await first.read({
      limit: 100,
      order: "topological",
      roots: [root("main")],
    });

    await vi.waitFor(() => expect(second.getSnapshot().status).toBe("ready"));
    expect(secondChanged).toHaveBeenCalled();
    await expect(
      second.getCommitSummaries([commits[1]?.oid ?? ""]),
    ).resolves.toEqual([commits[1]]);
    first.close();
    second.close();

    const reopened = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway,
      repositoryId,
    });
    await new Promise<void>((resolve) => {
      const unsubscribe = reopened.subscribe(() => {
        unsubscribe();
        resolve();
      });
    });
    expect(reopened.getSnapshot().status).toBe("empty");
    reopened.close();
  });
});

function page(repositoryId: string, commits: readonly RepositoryCommit[]) {
  return encodeRepositoryHistoryPage({
    commits,
    objectFormat: "sha1",
    refTargets: [root("main")],
    repositoryId,
    requestId: "00000000-0000-4000-8000-000000000011",
  });
}

function root(name: string) {
  return { name, oid: "f".repeat(40), type: "branch" as const };
}

function history(count: number): readonly RepositoryCommit[] {
  return Array.from({ length: count }, (_, index) => ({
    author: identity(index),
    committer: identity(index),
    oid: index.toString(16).padStart(40, "0"),
    parents:
      index === count - 1 ? [] : [(index + 1).toString(16).padStart(40, "0")],
    subject: `Commit ${index}`,
  }));
}

function identity(index: number) {
  return {
    email: "alex@example.test",
    name: "Alex I.",
    timestampSeconds: 1_777_777_777 - index,
    timezoneOffsetMinutes: 120,
  };
}
