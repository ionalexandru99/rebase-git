import {
  encodeRepositoryHistoryBatch,
  encodeRepositoryHistoryPage,
  type RepositoryCommit,
} from "@rebase/contracts";
import { describe, expect, it, vi } from "vitest";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import { withRepositoryHistoryDatabase } from "#web/features/repository-history/repository-history-database";
import {
  readRepositoryCommits,
  readRepositoryHistory,
} from "#web/features/repository-history/repository-history-query";
import type { RepositoryHistoryGateway } from "#web/features/repository-history/repository-history-reader.contract";
import {
  RepositoryHistoryOffline,
  RepositoryHistoryRejected,
  RepositoryHistoryStorageUnavailable,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";
import {
  beginRepositoryHistorySynchronization,
  completeStoredRepositoryHistory,
  readStoredRepositoryHistoryState,
  restartRepositoryHistorySynchronization,
  storeRepositoryHistoryBatch,
  storeRepositoryHistoryPage,
} from "#web/features/repository-history/repository-history-store";

describe("browser repository history reader", () => {
  it("rejects oversized navigation requests without failing linked readers", async () => {
    const environmentId = crypto.randomUUID();
    const logicalRepositoryId = crypto.randomUUID();
    const commits = history(3);
    const main = { ...root("main"), oid: commits[0]?.oid ?? "" };
    const query = { limit: 100, order: "topological" as const, roots: [main] };
    await storeRepositoryHistoryPage(
      environmentId,
      logicalRepositoryId,
      {
        commits,
        objectFormat: "sha1",
        repositoryId: logicalRepositoryId,
        requestId: crypto.randomUUID(),
        refTargets: [main],
      },
      query,
    );
    await beginRepositoryHistorySynchronization(
      environmentId,
      logicalRepositoryId,
    );
    await storeRepositoryHistoryBatch(environmentId, logicalRepositoryId, {
      commits,
      objectFormat: "sha1",
      repositoryId: logicalRepositoryId,
      requestId: crypto.randomUUID(),
      sequence: 0,
      snapshot: snapshot("a", main),
    });
    await completeStoredRepositoryHistory(
      environmentId,
      logicalRepositoryId,
      commits.length,
    );
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => {
        throw new RepositoryHistoryOffline();
      }),
      synchronize: vi.fn(async () => {
        throw new RepositoryHistoryOffline();
      }),
    };
    const readers = [0, 1].map(() =>
      createBrowserRepositoryHistoryReader({
        environmentId,
        logicalRepositoryId,
        repositoryId: crypto.randomUUID(),
        gateway,
      }),
    );
    const first = readers[0];
    if (first === undefined) throw new Error("Missing reader");
    try {
      await Promise.all(readers.map((reader) => reader.getRefTargets()));
      for (const request of [
        () =>
          first.ancestryRoute(
            Array.from({ length: 257 }, () => main.oid),
            main.oid,
          ),
        () =>
          first.locateMany(
            query,
            Array.from({ length: 1_001 }, () => main.oid),
          ),
      ]) {
        await expect(request()).rejects.toBeInstanceOf(
          RepositoryHistoryUnavailable,
        );
        await Promise.all(readers.map((reader) => reader.getRefTargets()));
        for (const reader of readers) {
          expect(reader.getSnapshot().status).toBe("ready");
          expect(reader.getSnapshot().error).toBeUndefined();
          expect(await reader.locateMany(query, [main.oid])).toEqual([
            { oid: main.oid, index: 0 },
          ]);
        }
      }
      expect(gateway.read).not.toHaveBeenCalled();
      expect(gateway.synchronize).not.toHaveBeenCalled();
    } finally {
      for (const reader of readers) reader.close();
    }
  });

  it("does not retry failed synchronization when a non-owner reader closes", async () => {
    const repositoryId = crypto.randomUUID();
    const commits = history(3);
    const main = { ...root("main"), oid: commits[0]?.oid ?? "" };
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, commits, [main])),
      synchronize: vi.fn(() => Promise.reject(new RepositoryHistoryOffline())),
    };
    const connection = {
      environmentId: crypto.randomUUID(),
      repositoryId,
      gateway,
    };
    const existingLeases = new Set(
      (await navigator.locks.query()).held?.map(({ name }) => name),
    );
    const first = createBrowserRepositoryHistoryReader(connection);
    await first.getRefTargets();
    const firstLease = (await navigator.locks.query()).held?.find(
      ({ name }) =>
        name?.startsWith("rebase-history-reader:") && !existingLeases.has(name),
    )?.name;
    expect(firstLease).toBeDefined();
    const second = createBrowserRepositoryHistoryReader(connection);
    try {
      await Promise.all([first.getRefTargets(), second.getRefTargets()]);
      await second.read({ limit: 100, order: "topological", roots: [main] });
      await vi.waitFor(() =>
        expect(second.getSnapshot().error).toBeInstanceOf(
          RepositoryHistoryOffline,
        ),
      );
      expect(gateway.synchronize).toHaveBeenCalledTimes(1);
      const revision = second.getSnapshot().revision;
      first.close();
      await vi.waitFor(async () => {
        const leases = await navigator.locks.query();
        expect(
          [...(leases.held ?? []), ...(leases.pending ?? [])].some(
            ({ name }) => name === firstLease,
          ),
        ).toBe(false);
      });
      await second.getRefTargets();
      expect(second.getSnapshot().revision).toBe(revision);
      expect(second.getSnapshot().synchronization).toBe("idle");
      expect(gateway.synchronize).toHaveBeenCalledTimes(1);
    } finally {
      first.close();
      second.close();
    }
  });

  it("locates ordered commits and reveals hidden ancestry from a cached linked worktree", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const logicalRepositoryId = crypto.randomUUID();
    const oid = (index: number) => index.toString(16).padStart(40, "0");
    const commits = history(260).map((commit, index) => ({
      ...commit,
      oid: oid(index),
      parents:
        index === 0
          ? [oid(1), oid(120)]
          : index === 120
            ? [oid(121), oid(200)]
            : index === 119 || index === 199
              ? [oid(259)]
              : index === 259
                ? []
                : [oid(index + 1)],
    }));
    const main = { ...root("main"), oid: oid(0) };
    const query = {
      limit: 100,
      order: "topological" as const,
      ancestry: "first-parent" as const,
      roots: [main],
    };
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () =>
        page(repositoryId, commits.slice(0, 100), [main]),
      ),
      synchronize: vi.fn(async (_request, accept) => {
        await accept(
          encodeRepositoryHistoryBatch({
            commits,
            objectFormat: "sha1",
            repositoryId,
            requestId: crypto.randomUUID(),
            sequence: 0,
            snapshot: snapshot("a", main),
          }),
        );
        return commits.length;
      }),
    };
    const initial = createBrowserRepositoryHistoryReader({
      environmentId,
      repositoryId,
      logicalRepositoryId,
      gateway,
    });
    await initial.read(query);
    await vi.waitFor(() =>
      expect(initial.getSnapshot().synchronization).toBe("complete"),
    );
    const painted = await initial.read(query);
    expect(
      await initial.locate({ ...query, offset: 90, limit: 2 }, oid(80)),
    ).toBe(80);
    expect((await initial.read(query)).map(({ oid }) => oid)).toEqual(
      painted.map(({ oid }) => oid),
    );
    initial.close();
    const offline: RepositoryHistoryGateway = {
      read: vi.fn(async () => {
        throw new RepositoryHistoryOffline();
      }),
      synchronize: vi.fn(async () => {
        throw new RepositoryHistoryOffline();
      }),
    };
    const reader = createBrowserRepositoryHistoryReader({
      environmentId,
      repositoryId: crypto.randomUUID(),
      logicalRepositoryId,
      gateway: offline,
    });
    try {
      expect(await reader.locate(query, oid(250))).toBeUndefined();
      const route = await reader.ancestryRoute([main.oid], oid(250));
      expect(route).toEqual({
        edges: [
          { childOid: oid(0), parentOid: oid(120) },
          { childOid: oid(120), parentOid: oid(200) },
        ],
      });
      const expanded = { ...query, additionalParentEdges: route?.edges ?? [] };
      const position = await reader.locate(expanded, oid(250));
      expect(position).toBeGreaterThan(100);
      expect(
        await reader.locateMany(expanded, [
          oid(250),
          oid(80),
          oid(250),
          oid(999),
        ]),
      ).toEqual([
        { oid: oid(80), index: 80 },
        { oid: oid(250), index: position },
      ]);
      expect(await reader.locateMany(query, [oid(80), oid(250)])).toEqual([
        { oid: oid(80), index: 80 },
      ]);
      expect(await reader.locateMany(query, [])).toEqual([]);
      await expect(
        reader.locateMany(
          query,
          Array.from({ length: 1_001 }, () => oid(80)),
        ),
      ).rejects.toBeInstanceOf(RepositoryHistoryUnavailable);
      expect(offline.read).not.toHaveBeenCalled();
      expect(offline.synchronize).not.toHaveBeenCalled();
      expect(
        (await reader.read({ ...expanded, offset: position ?? 0, limit: 1 }))[0]
          ?.oid,
      ).toBe(oid(250));
      expect(
        await reader.locate(
          { ...query, roots: [{ ...main, oid: oid(120) }] },
          oid(80),
        ),
      ).toBeUndefined();
      expect(await reader.ancestryRoute([oid(259)], oid(250))).toBeUndefined();
      expect(offline.read).not.toHaveBeenCalled();
    } finally {
      reader.close();
    }
  });

  it("repairs cached shallow parents and topology when unchanged refs gain ancestors", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const commits = history(3);
    const [tip, boundary, ancestor] = commits;
    if (!tip || !boundary || !ancestor)
      throw new Error("Missing history fixture");
    const main = { ...root("main"), oid: tip.oid };
    const query = { limit: 100, order: "topological" as const, roots: [main] };
    const shallowCommits = [tip, { ...boundary, parents: [] }];
    const initialSnapshot = {
      ...snapshot("a", main),
      shallowOids: [boundary.oid],
    };
    const batch = {
      commits: shallowCommits,
      objectFormat: "sha1" as const,
      repositoryId,
      requestId: crypto.randomUUID(),
      sequence: 0,
      snapshot: initialSnapshot,
    };
    await storeRepositoryHistoryPage(
      environmentId,
      repositoryId,
      {
        commits: shallowCommits,
        objectFormat: "sha1",
        repositoryId,
        requestId: crypto.randomUUID(),
        refTargets: [main],
      },
      query,
    );
    await beginRepositoryHistorySynchronization(environmentId, repositoryId);
    await storeRepositoryHistoryBatch(environmentId, repositoryId, batch);
    await completeStoredRepositoryHistory(environmentId, repositoryId, 2);
    expect(
      await beginRepositoryHistorySynchronization(environmentId, repositoryId),
    ).toMatchObject({ _tag: "Complete", shallowOids: [boundary.oid] });
    await restartRepositoryHistorySynchronization(environmentId, repositoryId);
    expect(
      await beginRepositoryHistorySynchronization(environmentId, repositoryId),
    ).toBeUndefined();
    await storeRepositoryHistoryBatch(environmentId, repositoryId, {
      ...batch,
      commits,
      snapshot: { ...snapshot("b", main), shallowOids: [ancestor.oid] },
    });
    await completeStoredRepositoryHistory(environmentId, repositoryId, 3);
    expect(
      await readRepositoryHistory(environmentId, repositoryId, query),
    ).toEqual(commits);
    expect(
      await readRepositoryCommits(environmentId, repositoryId, [boundary.oid]),
    ).toEqual([boundary]);
    expect(
      await beginRepositoryHistorySynchronization(environmentId, repositoryId),
    ).toMatchObject({ _tag: "Complete", shallowOids: [ancestor.oid] });
  });

  it("shares committed history between registered linked worktrees and isolates other repositories", async () => {
    const environmentId = crypto.randomUUID();
    const logicalRepositoryId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const linkedRepositoryId = crypto.randomUUID();
    const commits = history(3);
    const main = { ...root("main"), oid: commits[0]?.oid ?? "" };
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, commits, [main])),
      synchronize: vi.fn(async (_request, accept) => {
        await accept(
          encodeRepositoryHistoryBatch({
            commits,
            objectFormat: "sha1",
            repositoryId,
            requestId: crypto.randomUUID(),
            sequence: 0,
            snapshot: snapshot("a", main),
          }),
        );
        return commits.length;
      }),
    };
    const reader = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway,
      logicalRepositoryId,
      repositoryId,
    });
    const offlineGateway: RepositoryHistoryGateway = {
      read: vi.fn(() => Promise.reject(new RepositoryHistoryOffline())),
      synchronize: vi.fn(() => Promise.reject(new RepositoryHistoryOffline())),
    };
    const linked = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway: offlineGateway,
      logicalRepositoryId,
      repositoryId: linkedRepositoryId,
    });
    const unrelated = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway: offlineGateway,
      logicalRepositoryId: crypto.randomUUID(),
      repositoryId: crypto.randomUUID(),
    });
    try {
      await reader.read({ limit: 100, order: "topological", roots: [main] });
      await vi.waitFor(() =>
        expect(linked.getSnapshot().synchronization).toBe("complete"),
      );
      expect(gateway.read).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryId }),
        expect.any(AbortSignal),
      );
      expect(gateway.synchronize).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryId }),
        expect.any(Function),
        expect.any(AbortSignal),
      );
      await expect(
        linked.read({ limit: 100, order: "topological", roots: [main] }),
      ).resolves.toEqual(commits);
      await expect(
        readRepositoryCommits(
          environmentId,
          logicalRepositoryId,
          commits.map(({ oid }) => oid),
        ),
      ).resolves.toEqual(commits);
      await expect(
        unrelated.getCommitSummaries(commits.map(({ oid }) => oid)),
      ).resolves.toEqual([]);
      expect(offlineGateway.read).not.toHaveBeenCalled();
    } finally {
      reader.close();
      linked.close();
      unrelated.close();
    }
    const reopened = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway: offlineGateway,
      logicalRepositoryId,
      repositoryId: linkedRepositoryId,
    });
    try {
      await expect(
        reopened.read({ limit: 100, order: "topological", roots: [main] }),
      ).resolves.toEqual(commits);
      expect(offlineGateway.read).not.toHaveBeenCalled();
    } finally {
      reopened.close();
    }
  });

  it("reopens the committed first page offline before synchronization completes", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const commits = history(3);
    const main = { ...root("main"), oid: commits[0]?.oid ?? "" };
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, commits, [main])),
      synchronize: vi.fn(
        (_request, _accept, signal) =>
          new Promise<number>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new RepositoryHistoryOffline()),
              { once: true },
            );
          }),
      ),
    };
    const reader = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway,
      repositoryId,
    });
    await reader.read({ limit: 100, order: "topological", roots: [main] });
    await vi.waitFor(() => expect(gateway.synchronize).toHaveBeenCalledOnce());
    reader.close();
    const offlineGateway: RepositoryHistoryGateway = {
      read: vi.fn(() => Promise.reject(new RepositoryHistoryOffline())),
      synchronize: vi.fn(() => Promise.reject(new RepositoryHistoryOffline())),
    };
    const reopened = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway: offlineGateway,
      repositoryId,
    });
    try {
      await expect(
        reopened.read({ limit: 100, order: "topological", roots: [main] }),
      ).resolves.toEqual(commits);
      expect(offlineGateway.read).not.toHaveBeenCalled();
    } finally {
      reopened.close();
    }
  });

  it("orders and pages the complete replica locally without starting more Git traversals", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const [merge, main, side, base] = history(4);
    if (!merge || !main || !side || !base) throw new Error("Missing fixture");
    const commits = [
      { ...merge, parents: [main.oid, side.oid] },
      { ...main, parents: [base.oid], committer: identity(10) },
      { ...side, parents: [base.oid], committer: identity(1) },
      base,
    ];
    const roots = [{ ...root("main"), oid: merge.oid }];
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, commits, roots)),
      synchronize: vi.fn(async (_request, accept) => {
        await accept(
          encodeRepositoryHistoryBatch({
            commits,
            objectFormat: "sha1",
            repositoryId,
            requestId: crypto.randomUUID(),
            sequence: 0,
          }),
        );
        return commits.length;
      }),
    };
    const reader = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway,
      repositoryId,
    });
    try {
      await reader.read({ roots, order: "topological", limit: 100 });
      await vi.waitFor(() =>
        expect(reader.getSnapshot().synchronization).toBe("complete"),
      );
      expect(
        (await reader.read({ roots, order: "chronological", limit: 2 })).map(
          ({ oid }) => oid,
        ),
      ).toEqual([merge.oid, side.oid]);
      expect(
        (
          await reader.read({
            roots,
            order: "chronological",
            offset: 2,
            limit: 2,
          })
        ).map(({ oid }) => oid),
      ).toEqual([main.oid, base.oid]);
      expect(gateway.read).toHaveBeenCalledTimes(1);
      expect(gateway.synchronize).toHaveBeenCalledTimes(1);
      const sibling = createBrowserRepositoryHistoryReader({
        environmentId,
        gateway,
        repositoryId,
      });
      try {
        const [chronological, topological] = await Promise.all([
          reader.read({ roots, order: "chronological", limit: 100 }),
          sibling.read({ roots, order: "topological", limit: 100 }),
        ]);
        expect(chronological.map(({ oid }) => oid)).toEqual([
          merge.oid,
          side.oid,
          main.oid,
          base.oid,
        ]);
        expect(topological.map(({ oid }) => oid)).toEqual([
          merge.oid,
          main.oid,
          side.oid,
          base.oid,
        ]);
        await sibling.read({ roots, order: "chronological", limit: 100 });
        expect(gateway.synchronize).toHaveBeenCalledTimes(1);
      } finally {
        sibling.close();
      }
    } finally {
      reader.close();
    }
  });

  it("reveals merge parents from the replica and keeps the initial page collapsed", async () => {
    const repositoryId = crypto.randomUUID();
    const [merge, main, side, base] = history(4);
    if (!merge || !main || !side || !base) throw new Error("Missing fixture");
    const commits = [
      { ...merge, parents: [main.oid, side.oid] },
      { ...main, parents: [base.oid] },
      { ...side, parents: [base.oid] },
      base,
    ];
    const roots = [{ ...root("main"), oid: merge.oid }];
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, commits, roots)),
      synchronize: vi.fn(async (_request, accept) => {
        await accept(
          encodeRepositoryHistoryBatch({
            commits,
            objectFormat: "sha1",
            repositoryId,
            requestId: crypto.randomUUID(),
            sequence: 0,
          }),
        );
        return commits.length;
      }),
    };
    const reader = createBrowserRepositoryHistoryReader({
      environmentId: crypto.randomUUID(),
      gateway,
      repositoryId,
    });
    const query = {
      roots,
      order: "topological",
      ancestry: "first-parent",
      limit: 100,
    } as const;
    try {
      expect((await reader.read(query)).map(({ oid }) => oid)).toEqual([
        merge.oid,
        main.oid,
        base.oid,
      ]);
      await vi.waitFor(() =>
        expect(reader.getSnapshot().synchronization).toBe("complete"),
      );
      expect(
        (
          await reader.read({
            ...query,
            additionalParentEdges: [
              { childOid: merge.oid, parentOid: side.oid },
            ],
          })
        ).map(({ oid }) => oid),
      ).toEqual(commits.map(({ oid }) => oid));
      expect((await reader.read(query)).map(({ oid }) => oid)).toEqual([
        merge.oid,
        main.oid,
        base.oid,
      ]);
      expect(gateway.read).toHaveBeenCalledOnce();
      expect(gateway.synchronize).toHaveBeenCalledOnce();
    } finally {
      reader.close();
    }
  });

  it("migrates version-two commit ordering into topological epochs", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const commits = history(2);
    const latest = commits[0];
    if (latest === undefined) {
      throw new Error("Commit fixture is missing");
    }
    const main = { ...root("main"), oid: latest.oid };
    await deleteRepositoryHistoryDatabase();
    await createVersionTwoRepositoryHistory(
      environmentId,
      repositoryId,
      commits,
      main,
    );

    await expect(
      readRepositoryHistory(environmentId, repositoryId, {
        limit: 100,
        order: "topological",
        roots: [main],
      }),
    ).resolves.toEqual(commits);
  });

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
    const otherTab = createBrowserRepositoryHistoryReader({
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
    await vi.waitFor(() =>
      expect(otherTab.getSnapshot().synchronization).toBe("syncing"),
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
    await vi.waitFor(() =>
      expect(otherTab.getSnapshot().synchronizedCommitCount).toBe(3),
    );
    await expect(
      readRepositoryCommits(environmentId, repositoryId, [
        synchronized[2]?.oid ?? "",
      ]),
    ).resolves.toEqual([synchronized[2]]);
    finishSynchronization?.(3);
    await vi.waitFor(() =>
      expect(reader.getSnapshot().synchronization).toBe("complete"),
    );
    await vi.waitFor(() =>
      expect(otherTab.getSnapshot().synchronization).toBe("complete"),
    );
    reader.close();
    otherTab.close();
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
    if (firstSignal === undefined) {
      expect(gateway.read).toHaveBeenCalledOnce();
    } else {
      expect(firstSignal.aborted).toBe(true);
    }
    expect(reader.getSnapshot().status).toBe("ready");
    reader.close();
  });

  it("shares repository snapshots across readers and reopens stored metadata", async () => {
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
    await expect(
      reopened.getCommitSummaries(commits.map(({ oid }) => oid)),
    ).resolves.toEqual(commits);
    expect(gateway.read).toHaveBeenCalledOnce();
    reopened.close();
  });

  it("starts one synchronization when readers load concurrently", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, history(1))),
      synchronize: vi.fn(
        (_request, _accept, signal) =>
          new Promise<number>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new RepositoryHistoryOffline()),
              { once: true },
            );
          }),
      ),
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

    await Promise.all([
      first.read({
        limit: 100,
        order: "topological",
        roots: [root("main")],
      }),
      second.read({
        limit: 100,
        order: "topological",
        roots: [root("main")],
      }),
    ]);
    await vi.waitFor(() => expect(gateway.synchronize).toHaveBeenCalledOnce());

    first.close();
    second.close();
  });

  it("preserves replacement synchronization after a closed reader batch fails", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const commits = history(1);
    let batchDispatched: (() => void) | undefined;
    const batchWasDispatched = new Promise<void>((resolve) => {
      batchDispatched = resolve;
    });
    const firstGateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, commits)),
      synchronize: vi.fn(async (_request, accept) => {
        const pendingBatch = accept(
          encodeRepositoryHistoryBatch({
            commits,
            objectFormat: "sha1",
            repositoryId,
            requestId: crypto.randomUUID(),
            sequence: 1,
          }),
        );
        batchDispatched?.();
        await pendingBatch;
        return commits.length;
      }),
    };
    const secondGateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, commits)),
      synchronize: vi.fn(
        (_request, _accept, signal) =>
          new Promise<number>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new RepositoryHistoryOffline()),
              { once: true },
            );
          }),
      ),
    };
    const first = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway: firstGateway,
      repositoryId,
    });
    const second = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway: secondGateway,
      repositoryId,
    });

    await first.read({
      limit: 100,
      order: "topological",
      roots: [root("main")],
    });
    await batchWasDispatched;
    first.close();

    await vi.waitFor(() =>
      expect(secondGateway.synchronize).toHaveBeenCalledOnce(),
    );
    expect(second.getSnapshot().synchronization).toBe("syncing");
    second.close();
  });

  it("retries synchronization after completion persistence fails", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const commits = history(1);
    const main = { ...root("main"), oid: commits[0]?.oid ?? "" };
    let synchronizationAttempt = 0;
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, commits, [main])),
      synchronize: vi.fn(async (_request, accept) => {
        await accept(
          encodeRepositoryHistoryBatch({
            commits,
            objectFormat: "sha1",
            repositoryId,
            requestId: crypto.randomUUID(),
            sequence: 0,
          }),
        );
        synchronizationAttempt += 1;
        return synchronizationAttempt === 1 ? 2 : 1;
      }),
    };
    const reader = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway,
      repositoryId,
    });

    await reader.read({
      limit: 100,
      order: "topological",
      roots: [main],
    });
    await vi.waitFor(() => {
      expect(reader.getSnapshot()).toMatchObject({
        error: expect.any(RepositoryHistoryUnavailable),
        status: "error",
        synchronization: "idle",
      });
    });

    await reader.read({
      limit: 100,
      order: "topological",
      roots: [main],
    });
    await vi.waitFor(() => {
      expect(gateway.synchronize).toHaveBeenCalledTimes(2);
      expect(reader.getSnapshot().synchronization).toBe("complete");
    });
    expect(gateway.read).toHaveBeenCalledOnce();
    const revision = reader.getSnapshot().revision;
    await expect(
      reader.read({
        limit: 1,
        offset: 1,
        order: "topological",
        roots: [root("missing")],
      }),
    ).rejects.toBeInstanceOf(RepositoryHistoryUnavailable);
    expect(reader.getSnapshot()).toMatchObject({ synchronization: "stale" });
    expect(reader.getSnapshot().revision).toBeGreaterThan(revision);
    reader.close();
  });

  it("reopens a completed repository from IndexedDB while offline", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const commits = history(3);
    const main = { ...root("main"), oid: commits[0]?.oid ?? "" };
    const firstGateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, commits, [main])),
      synchronize: vi.fn(async (_request, accept) => {
        await accept(
          encodeRepositoryHistoryBatch({
            commits,
            objectFormat: "sha1",
            repositoryId,
            requestId: crypto.randomUUID(),
            sequence: 0,
          }),
        );
        return commits.length;
      }),
    };
    const first = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway: firstGateway,
      repositoryId,
    });
    await first.read({ limit: 100, order: "topological", roots: [main] });
    await vi.waitFor(() =>
      expect(first.getSnapshot().synchronization).toBe("complete"),
    );
    first.close();

    const offlineGateway: RepositoryHistoryGateway = {
      read: vi.fn(() => Promise.reject(new RepositoryHistoryOffline())),
      synchronize: vi.fn(() => Promise.reject(new RepositoryHistoryOffline())),
    };
    const reopened = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway: offlineGateway,
      repositoryId,
    });

    await expect(
      reopened.read({ limit: 100, order: "topological", roots: [main] }),
    ).resolves.toEqual(commits);
    await expect(
      reopened.read({
        limit: 100,
        order: "topological",
        roots: [{ ...main, oid: commits[1]?.oid ?? "" }],
      }),
    ).resolves.toEqual(commits.slice(1));
    await expect(
      reopened.getCommitSummaries(["e".repeat(40)]),
    ).resolves.toEqual([]);
    expect(offlineGateway.read).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(reopened.getSnapshot()).toMatchObject({
        status: "ready",
        synchronization: "stale",
      }),
    );
    reopened.close();
  });

  it("reports offline and IndexedDB failures with separate types", async () => {
    const repositoryId = crypto.randomUUID();
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(() => Promise.reject(new RepositoryHistoryOffline())),
      synchronize: vi.fn(() => Promise.reject(new RepositoryHistoryOffline())),
    };
    const reader = createBrowserRepositoryHistoryReader({
      environmentId: crypto.randomUUID(),
      gateway,
      repositoryId,
    });

    await expect(
      reader.read({ limit: 100, order: "topological", roots: [root("main")] }),
    ).rejects.toBeInstanceOf(RepositoryHistoryOffline);
    expect(reader.getSnapshot().error).toBeInstanceOf(RepositoryHistoryOffline);
    reader.close();

    const unavailableIndexedDb = {
      open: () => {
        throw new Error("Storage disabled");
      },
    } as unknown as IDBFactory;
    const storageFailure = await readStoredRepositoryHistoryState(
      crypto.randomUUID(),
      crypto.randomUUID(),
      unavailableIndexedDb,
    ).catch((error: unknown) => error);
    expect(storageFailure).toBeInstanceOf(RepositoryHistoryStorageUnavailable);
    expect(storageFailure).toMatchObject({
      cause: expect.objectContaining({ message: "Storage disabled" }),
    });
  });

  it("does not classify application failures as storage failures", async () => {
    const applicationFailure = new Error("Repository history is incomplete");

    await expect(
      withRepositoryHistoryDatabase(indexedDB, () =>
        Promise.reject(applicationFailure),
      ),
    ).rejects.toBe(applicationFailure);
  });

  it("resumes an incomplete snapshot and publishes its refs only after completion", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const commits = history(2);
    const [firstCommit, secondCommit] = commits;
    if (firstCommit === undefined || secondCommit === undefined) {
      throw new Error("Commit fixture is missing");
    }
    const oldRef = { ...root("main"), oid: firstCommit.oid };
    const nextRef = { ...root("main"), oid: secondCommit.oid };
    const captured = snapshot("a", nextRef);
    let firstBatchStored: (() => void) | undefined;
    const batchStored = new Promise<void>((resolve) => {
      firstBatchStored = resolve;
    });
    const firstGateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, [firstCommit], [oldRef])),
      synchronize: vi.fn(async (_request, accept, signal) => {
        await accept(
          encodeRepositoryHistoryBatch({
            commits: [firstCommit],
            objectFormat: "sha1",
            repositoryId,
            requestId: crypto.randomUUID(),
            sequence: 0,
            snapshot: captured,
          }),
        );
        firstBatchStored?.();
        return new Promise<number>((_resolve, reject) =>
          signal?.addEventListener(
            "abort",
            () => reject(new RepositoryHistoryOffline()),
            { once: true },
          ),
        );
      }),
    };
    const first = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway: firstGateway,
      repositoryId,
    });
    await first.read({ limit: 100, order: "topological", roots: [oldRef] });
    await batchStored;
    first.close();

    let finish: (() => void) | undefined;
    const mayFinish = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const secondGateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, commits, [nextRef])),
      synchronize: vi.fn(async (request, accept) => {
        expect(request.basis).toEqual({
          _tag: "Incomplete",
          committedCommitCount: 1,
          nextBatchSequence: 1,
          objectFormat: "sha1",
          rootOids: captured.rootOids,
          snapshotId: captured.id,
        });
        await accept(
          encodeRepositoryHistoryBatch({
            commits: [secondCommit],
            objectFormat: "sha1",
            repositoryId,
            requestId: crypto.randomUUID(),
            sequence: 1,
          }),
        );
        await mayFinish;
        return 2;
      }),
    };
    const resumed = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway: secondGateway,
      repositoryId,
    });
    await resumed.read({ limit: 100, order: "topological", roots: [nextRef] });
    await vi.waitFor(() =>
      expect(secondGateway.synchronize).toHaveBeenCalled(),
    );

    await expect(resumed.getRefTargets()).resolves.toEqual([oldRef]);
    finish?.();
    await vi.waitFor(() =>
      expect(resumed.getSnapshot().synchronization).toBe("complete"),
    );
    await expect(resumed.getRefTargets()).resolves.toEqual([nextRef]);
    resumed.close();
  });

  it("restarts an invalid completed basis without publishing duplicate refs", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const commit = history(1)[0];
    if (commit === undefined) {
      throw new Error("Commit fixture is missing");
    }
    const oldRef = { ...root("main"), oid: commit.oid };
    const oldSnapshot = snapshot("b", oldRef);
    const initialGateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, [commit], [oldRef])),
      synchronize: vi.fn(async (_request, accept) => {
        await accept(
          encodeRepositoryHistoryBatch({
            commits: [commit],
            objectFormat: "sha1",
            repositoryId,
            requestId: crypto.randomUUID(),
            sequence: 0,
            snapshot: oldSnapshot,
          }),
        );
        return 1;
      }),
    };
    const initial = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway: initialGateway,
      repositoryId,
    });
    await initial.read({ limit: 100, order: "topological", roots: [oldRef] });
    await vi.waitFor(() =>
      expect(initial.getSnapshot().synchronization).toBe("complete"),
    );
    initial.close();

    const newRef = { ...oldRef, name: "trunk" };
    const newSnapshot = snapshot("c", newRef);
    let attempt = 0;
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, [commit], [newRef])),
      synchronize: vi.fn(async (request, accept) => {
        attempt += 1;
        if (attempt === 1) {
          expect(request.basis?._tag).toBe("Complete");
          throw new RepositoryHistoryRejected({
            failure: { _tag: "SnapshotInvalidated" },
          });
        }
        expect(request.basis).toBeUndefined();
        await accept(
          encodeRepositoryHistoryBatch({
            commits: [commit],
            objectFormat: "sha1",
            repositoryId,
            requestId: crypto.randomUUID(),
            sequence: 0,
            snapshot: newSnapshot,
          }),
        );
        return 1;
      }),
    };
    const reopened = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway,
      repositoryId,
    });
    await reopened.read({ limit: 100, order: "topological", roots: [oldRef] });
    await vi.waitFor(() =>
      expect(gateway.synchronize).toHaveBeenCalledTimes(2),
    );
    await vi.waitFor(() =>
      expect(reopened.getSnapshot().synchronization).toBe("complete"),
    );

    await expect(reopened.getRefTargets()).resolves.toEqual([newRef]);
    reopened.close();
  });

  it("reconciles a completed cache when its environment reconnects", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const commits = history(2);
    const [newCommit, oldCommit] = commits;
    if (newCommit === undefined || oldCommit === undefined) {
      throw new Error("Commit fixtures are missing");
    }
    const initialRef = { ...root("main"), oid: oldCommit.oid };
    const reconnectedRef = { ...root("trunk"), oid: newCommit.oid };
    let connected: (() => void) | undefined;
    let synchronization = 0;
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => page(repositoryId, [oldCommit], [initialRef])),
      subscribeAvailability: (listener) => {
        connected = listener;
        return () => {
          connected = undefined;
        };
      },
      synchronize: vi.fn(async (_request, accept) => {
        const initial = synchronization === 0;
        const ref = initial ? initialRef : reconnectedRef;
        synchronization += 1;
        await accept(
          encodeRepositoryHistoryBatch({
            commits: initial
              ? [oldCommit]
              : synchronization === 2
                ? [newCommit]
                : [],
            objectFormat: "sha1",
            repositoryId,
            requestId: crypto.randomUUID(),
            sequence: 0,
            snapshot: snapshot(initial ? "d" : "e", ref),
          }),
        );
        return initial ? 1 : 2;
      }),
    };
    const reader = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway,
      repositoryId,
    });
    await reader.read({
      limit: 100,
      order: "topological",
      roots: [initialRef],
    });
    await vi.waitFor(() =>
      expect(reader.getSnapshot().synchronization).toBe("complete"),
    );

    connected?.();

    await vi.waitFor(() =>
      expect(gateway.synchronize).toHaveBeenCalledTimes(2),
    );
    await vi.waitFor(() =>
      expect(reader.getSnapshot().synchronization).toBe("complete"),
    );
    await expect(reader.getRefTargets()).resolves.toEqual([reconnectedRef]);
    await expect(
      reader.read({
        limit: 100,
        order: "topological",
        roots: [reconnectedRef],
      }),
    ).resolves.toEqual(commits);
    expect(gateway.read).toHaveBeenCalledOnce();
    reader.close();
    expect(connected).toBeUndefined();
  });
});

function page(
  repositoryId: string,
  commits: readonly RepositoryCommit[],
  refTargets = [root("main")],
) {
  return encodeRepositoryHistoryPage({
    commits,
    objectFormat: "sha1",
    refTargets,
    repositoryId,
    requestId: "00000000-0000-4000-8000-000000000011",
  });
}

function root(name: string) {
  return { name, oid: "f".repeat(40), type: "branch" as const };
}

function snapshot(idCharacter: string, ref: ReturnType<typeof root>) {
  return {
    id: idCharacter.repeat(64),
    objectFormat: "sha1" as const,
    refTargets: [ref],
    resumable: true,
    rootOids: [ref.oid],
  };
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

function deleteRepositoryHistoryDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("rebase-repository-history");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function createVersionTwoRepositoryHistory(
  environmentId: string,
  repositoryId: string,
  commits: readonly RepositoryCommit[],
  main: ReturnType<typeof root>,
) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("rebase-repository-history", 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      const commitStore = database.createObjectStore("commits", {
        keyPath: "key",
      });
      commitStore.createIndex("repositoryOrder", [
        "environmentId",
        "repositoryId",
        "topologicalOrder",
      ]);
      database.createObjectStore("repositories", { keyPath: "key" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(
        ["commits", "repositories"],
        "readwrite",
      );
      const commitStore = transaction.objectStore("commits");
      for (const [topologicalOrder, commit] of commits.entries()) {
        commitStore.put({
          commit,
          environmentId,
          key: `${environmentId}\0${repositoryId}\0${commit.oid}`,
          repositoryId,
          topologicalOrder,
        });
      }
      transaction.objectStore("repositories").put({
        completion: { commitCount: commits.length },
        environmentId,
        key: `${environmentId}\0${repositoryId}`,
        objectFormat: "sha1",
        progress: {
          committedCommitCount: commits.length,
          nextBatchSequence: 1,
        },
        refTargets: [main],
        repositoryId,
      });
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    };
  });
}
