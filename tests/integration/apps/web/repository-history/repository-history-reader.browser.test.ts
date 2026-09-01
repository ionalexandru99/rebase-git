import {
  encodeRepositoryHistoryPage,
  type RepositoryCommit,
} from "@rebase/contracts";
import { describe, expect, it, vi } from "vitest";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import type { RepositoryHistoryGateway } from "#web/features/repository-history/repository-history-reader.contract";
import { RepositoryHistoryUnavailable } from "#web/features/repository-history/repository-history-reader.contract";
import { readRepositoryCommits } from "#web/features/repository-history/repository-history-store";

describe("browser repository history reader", () => {
  it("stores a page in IndexedDB before publishing its repository snapshot", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const commits = history(100);
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, commits)),
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
