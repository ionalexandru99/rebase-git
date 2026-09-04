import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  createBinaryMessageReassembler,
  createCurrentEnvironmentHello,
  decodeRepositoryHistoryBatch,
  decodeRepositoryHistoryPage,
  type EnvironmentAccessCapability,
  type EnvironmentHello,
  environmentLivePath,
  type RepositoryCommit,
  type RepositoryHistoryBatch,
  type RepositoryHistorySnapshot,
} from "@rebase/contracts";
import { createLocalGitCommandRunner } from "@rebase/server/adapters/local-git/local-git-command-runner";
import {
  RepositoryHistoryError,
  type RepositoryHistoryService,
} from "@rebase/server/domain/repository-history.contract";
import type { EnvironmentAuthorization } from "@rebase/server/features/environment-authorization/environment-authorization.contract";
import { createEnvironmentEventPublisher } from "@rebase/server/features/environment-connection/events/environment-event-publisher";
import { acquireEnvironmentListener } from "@rebase/server/features/environment-server/server/environment-listener";
import { createRepositoryCatalog } from "@rebase/server/features/repository-catalog/repository-catalog";
import { synchronizeRepositoryHistory } from "@rebase/server/features/repository-history/git/synchronize-repository-history";
import { createRepositoryHistoryService } from "@rebase/server/features/repository-history/repository-history";
import { acquireEnvironmentContext } from "@rebase/server/persistence/environment-context";
import { environmentPaths } from "@rebase/server/persistence/storage/environment-paths";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const execFilePromise = promisify(execFile);
const directories = new Set<string>();
const environmentId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000011";

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
  directories.clear();
});

describe("repository history", { timeout: 30_000 }, () => {
  it("waits for each committed-batch acknowledgement before sending the next", async () => {
    const continuedAfterFirst = vi.fn();
    const history: RepositoryHistoryService = {
      read: () => Effect.die("unused"),
      synchronize: (request, emit) =>
        Effect.gen(function* () {
          yield* emit(emptyBatch(request.repositoryId, request.requestId, 0));
          continuedAfterFirst();
          yield* emit(emptyBatch(request.repositoryId, request.requestId, 1));
          return 0;
        }),
    };
    await withHistoryListener(async ({ origin }) => {
      const socket = await openHistorySocket(
        origin,
        createCurrentEnvironmentHello("0.0.0"),
      );
      expect(socket.extensions).toContain("permessage-deflate");
      const first = collectBinaryMessage(
        socket,
        createBinaryMessageReassembler(),
        [],
      );
      socket.send(
        JSON.stringify({
          _tag: "SynchronizeRepositoryHistory",
          priority: "visible",
          repositoryId: environmentId,
          requestId,
        }),
      );
      await first;
      expect(continuedAfterFirst).not.toHaveBeenCalled();

      const second = collectBinaryMessage(
        socket,
        createBinaryMessageReassembler(),
        [],
      );
      socket.send(
        JSON.stringify({
          _tag: "AcknowledgeRepositoryHistoryBatch",
          requestId,
          sequence: 0,
        }),
      );
      await second;
      expect(continuedAfterFirst).toHaveBeenCalledOnce();

      const completed = nextTextMessage(socket);
      socket.send(
        JSON.stringify({
          _tag: "AcknowledgeRepositoryHistoryBatch",
          requestId,
          sequence: 0,
        }),
      );
      socket.send(
        JSON.stringify({
          _tag: "AcknowledgeRepositoryHistoryBatch",
          requestId,
          sequence: 1,
        }),
      );
      expect(JSON.parse(await completed)).toMatchObject({
        _tag: "RepositoryHistorySynchronized",
        requestId,
      });
      socket.close();
    }, history);
  });

  it("synchronizes a bare repository without a worktree HEAD", async () => {
    const root = await createTemporaryDirectory();
    const source = join(root, "bare-source");
    const bare = join(root, "repository.git");
    await createRepository(source, "sha1", 3);
    await execFilePromise("git", ["clone", "--bare", source, bare]);
    const commits: RepositoryCommit[] = [];

    const count = await Effect.runPromise(
      synchronizeRepositoryHistory(
        createLocalGitCommandRunner(),
        bare,
        {
          _tag: "SynchronizeRepositoryHistory",
          priority: "visible",
          repositoryId: environmentId,
          requestId,
        },
        (batch) =>
          Effect.sync(() => {
            commits.push(...batch.commits);
          }),
      ),
    );

    expect(count).toBe(3);
    expect(commits.map((commit) => commit.subject)).toEqual([
      "commit 2",
      "commit 1",
      "commit 0",
    ]);
  });

  it("preserves failures raised while emitting streamed batches", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "emit-failure");
    await createRepository(repositoryPath, "sha1", 1);
    const failure = new RepositoryHistoryError({
      failure: {
        _tag: "GitFailed",
        detail: "Batch delivery failed",
        reason: "Failed",
      },
    });

    await expect(
      Effect.runPromise(
        synchronizeRepositoryHistory(
          createLocalGitCommandRunner(),
          repositoryPath,
          {
            _tag: "SynchronizeRepositoryHistory",
            priority: "visible",
            repositoryId: environmentId,
            requestId,
          },
          () => Effect.fail(failure),
        ),
      ),
    ).rejects.toBe(failure);
  });

  it("synchronizes refs, stashes, and detached linked worktree heads", async () => {
    await withHistoryListener(async ({ catalog, origin, root }) => {
      const repositoryPath = join(root, "complete");
      const linkedPath = join(root, "linked");
      await createRepository(repositoryPath, "sha1", 2);
      await git(repositoryPath, "checkout", "-b", "side");
      await git(repositoryPath, "commit", "--allow-empty", "-m", "side");
      const side = await gitOutput(repositoryPath, "rev-parse", "HEAD");
      await git(repositoryPath, "checkout", "main");
      await git(repositoryPath, "update-ref", "refs/remotes/origin/side", side);
      await git(repositoryPath, "tag", "snapshot");
      await writeFile(join(repositoryPath, "stashed-one.txt"), "one");
      await git(repositoryPath, "add", "stashed-one.txt");
      await git(repositoryPath, "stash", "push", "-m", "saved work one");
      await writeFile(join(repositoryPath, "stashed-two.txt"), "two");
      await git(repositoryPath, "add", "stashed-two.txt");
      await git(repositoryPath, "stash", "push", "-m", "saved work two");
      await git(
        repositoryPath,
        "worktree",
        "add",
        "--detach",
        linkedPath,
        "main",
      );
      await git(linkedPath, "commit", "--allow-empty", "-m", "detached linked");
      const detached = await gitOutput(linkedPath, "rev-parse", "HEAD");
      const repository = await Effect.runPromise(
        catalog.remember(repositoryPath),
      );
      const stashRoots = (
        await gitOutput(repositoryPath, "stash", "list", "--format=%H")
      ).split("\n");
      const expected = new Set(
        (
          await gitOutput(
            repositoryPath,
            "rev-list",
            "--all",
            detached,
            ...stashRoots,
          )
        ).split("\n"),
      );

      const commits = await synchronizeHistory(origin, repository.id);

      expect(new Set(commits.map((commit) => commit.oid))).toEqual(expected);
      expect(
        commits.some((commit) => commit.subject === "detached linked"),
      ).toBe(true);
      expect(
        commits.some((commit) => commit.subject.includes("saved work one")),
      ).toBe(true);
      expect(
        commits.some((commit) => commit.subject.includes("saved work two")),
      ).toBe(true);
    });
  });

  it.each(["sha1", "sha256"] as const)(
    "delivers the first 100 %s commits through fragmented binary messages",
    async (objectFormat) => {
      await withHistoryListener(async ({ catalog, origin, root }) => {
        const repositoryPath = join(root, objectFormat);
        await createRepository(repositoryPath, objectFormat, 110);
        const repository = await Effect.runPromise(
          catalog.remember(repositoryPath),
        );
        const head = await gitOutput(repositoryPath, "rev-parse", "main");
        const socket = await openHistorySocket(origin, smallFrameHello());
        const reassembler = createBinaryMessageReassembler();
        const fragments: Uint8Array[] = [];
        const received = collectBinaryMessage(socket, reassembler, fragments);
        socket.send(
          JSON.stringify({
            _tag: "ReadRepositoryHistory",
            limit: 100,
            order: "topological",
            repositoryId: repository.id,
            requestId,
            roots: [{ name: "main", oid: head, type: "branch" }],
          }),
        );

        const complete = await received;
        socket.close();

        expect(fragments.length).toBeGreaterThan(1);
        const page = decodeRepositoryHistoryPage(complete.payload);
        expect(page.objectFormat).toBe(objectFormat);
        expect(page.commits).toHaveLength(100);
        expect(page.commits[0]?.subject).toBe("commit 109");
        expect(page.commits.at(-1)?.subject).toBe("commit 10");
        expect(
          page.commits.every(
            (commit) =>
              commit.oid.length === (objectFormat === "sha1" ? 40 : 64),
          ),
        ).toBe(true);
      });
    },
  );

  it("cancels an in-flight history request without closing the connection", async () => {
    const canceled = vi.fn();
    const history: RepositoryHistoryService = {
      read: () => Effect.never.pipe(Effect.ensuring(Effect.sync(canceled))),
      synchronize: () => Effect.never,
    };
    await withHistoryListener(async ({ catalog, origin, root }) => {
      const repositoryPath = join(root, "cancel");
      await createRepository(repositoryPath, "sha1", 1);
      const repository = await Effect.runPromise(
        catalog.remember(repositoryPath),
      );
      const head = await gitOutput(repositoryPath, "rev-parse", "main");
      const socket = await openHistorySocket(
        origin,
        createCurrentEnvironmentHello("0.0.0"),
      );
      socket.send(
        JSON.stringify({
          _tag: "ReadRepositoryHistory",
          limit: 100,
          order: "topological",
          repositoryId: repository.id,
          requestId,
          roots: [{ name: "main", oid: head, type: "branch" }],
        }),
      );
      socket.send(
        JSON.stringify({ _tag: "CancelRepositoryHistory", requestId }),
      );

      await vi.waitFor(() => expect(canceled).toHaveBeenCalledOnce());
      expect(socket.readyState).toBe(WebSocket.OPEN);
      socket.close();
    }, history);
  });

  it("preserves nested and octopus merge topology", async () => {
    await withHistoryListener(async ({ catalog, origin, root }) => {
      const repositoryPath = join(root, "merges");
      await createMergeRepository(repositoryPath);
      const repository = await Effect.runPromise(
        catalog.remember(repositoryPath),
      );
      const head = await gitOutput(repositoryPath, "rev-parse", "main");

      const page = await readHistoryPage(origin, repository.id, head);

      expect(page.commits[0]?.subject).toBe("octopus");
      expect(page.commits[0]?.parents).toHaveLength(3);
      expect(
        page.commits.find((commit) => commit.subject === "nested merge")
          ?.parents,
      ).toHaveLength(2);
      const positions = new Map(
        page.commits.map((commit, index) => [commit.oid, index]),
      );
      expect(
        page.commits.every((commit, index) =>
          commit.parents.every(
            (parent) => (positions.get(parent) ?? index + 1) > index,
          ),
        ),
      ).toBe(true);
    });
  });

  it("stops at a shallow repository boundary", async () => {
    await withHistoryListener(async ({ catalog, origin, root }) => {
      const source = join(root, "shallow-source");
      const repositoryPath = join(root, "shallow-clone");
      await createRepository(source, "sha1", 5);
      await execFilePromise("git", [
        "clone",
        "--branch=main",
        "--depth=2",
        pathToFileURL(source).href,
        repositoryPath,
      ]);
      const repository = await Effect.runPromise(
        catalog.remember(repositoryPath),
      );
      const head = await gitOutput(repositoryPath, "rev-parse", "main");

      const page = await readHistoryPage(origin, repository.id, head);

      expect(page.commits).toHaveLength(2);
      expect(page.commits.at(-1)?.parents).toEqual([]);
      const synchronized: RepositoryCommit[] = [];
      await Effect.runPromise(
        synchronizeRepositoryHistory(
          createLocalGitCommandRunner(),
          repositoryPath,
          {
            _tag: "SynchronizeRepositoryHistory",
            priority: "visible",
            repositoryId: repository.id,
            requestId,
          },
          (batch) =>
            Effect.sync(() => {
              synchronized.push(...batch.commits);
            }),
        ),
      );
      expect(synchronized).toHaveLength(2);
      expect(synchronized.at(-1)?.parents).toEqual([]);
    });
  });

  it("rejects history reads without closing an authorized environment connection", async () => {
    await withHistoryListener(
      async ({ catalog, origin, root }) => {
        const repositoryPath = join(root, "denied");
        await createRepository(repositoryPath, "sha1", 1);
        const repository = await Effect.runPromise(
          catalog.remember(repositoryPath),
        );
        const head = await gitOutput(repositoryPath, "rev-parse", "main");
        const socket = await openHistorySocket(
          origin,
          createCurrentEnvironmentHello("0.0.0"),
        );
        socket.send(
          JSON.stringify({
            _tag: "ReadRepositoryHistory",
            limit: 100,
            order: "topological",
            repositoryId: repository.id,
            requestId,
            roots: [{ name: "main", oid: head, type: "branch" }],
          }),
        );

        expect(JSON.parse(await nextTextMessage(socket))).toEqual({
          _tag: "RepositoryHistoryFailed",
          failure: { _tag: "AuthorizationDenied" },
          requestId,
        });
        expect(socket.readyState).toBe(WebSocket.OPEN);
        socket.close();
      },
      undefined,
      testAuthorization(["environment.read"]),
    );
  });

  it("bounds concurrent history reads within one connection", async () => {
    const history: RepositoryHistoryService = {
      read: vi.fn(() => Effect.never),
      synchronize: () => Effect.never,
    };
    await withHistoryListener(async ({ origin }) => {
      const socket = await openHistorySocket(
        origin,
        createCurrentEnvironmentHello("0.0.0"),
      );
      const requestIds = [
        "00000000-0000-4000-8000-000000000021",
        "00000000-0000-4000-8000-000000000022",
        "00000000-0000-4000-8000-000000000023",
      ];
      for (const currentRequestId of requestIds) {
        socket.send(
          JSON.stringify({
            _tag: "ReadRepositoryHistory",
            limit: 100,
            order: "topological",
            repositoryId: "00000000-0000-4000-8000-000000000001",
            requestId: currentRequestId,
            roots: [{ name: "main", oid: "a".repeat(40), type: "branch" }],
          }),
        );
      }

      expect(JSON.parse(await nextTextMessage(socket))).toEqual({
        _tag: "RepositoryHistoryFailed",
        failure: {
          _tag: "GitFailed",
          detail: "Too many concurrent repository history requests",
          reason: "Failed",
        },
        requestId: requestIds[2],
      });
      expect(history.read).toHaveBeenCalledTimes(2);
      expect(socket.readyState).toBe(WebSocket.OPEN);
      socket.close();
    }, history);
  });

  it("coalesces ref movement during traversal before publishing the latest refs", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "moving-refs");
    await createRepository(repositoryPath, "sha1", 2);
    const batches: RepositoryHistoryBatch[] = [];
    let moved = false;

    const count = await Effect.runPromise(
      synchronizeRepositoryHistory(
        createLocalGitCommandRunner(),
        repositoryPath,
        {
          _tag: "SynchronizeRepositoryHistory",
          priority: "visible",
          repositoryId: environmentId,
          requestId,
        },
        (batch) =>
          Effect.promise(async () => {
            batches.push(batch);
            if (batch.snapshot !== undefined && !moved) {
              moved = true;
              await git(
                repositoryPath,
                "commit",
                "--allow-empty",
                "-m",
                "arrived during traversal",
              );
            }
          }),
      ),
    );

    const latestHead = await gitOutput(repositoryPath, "rev-parse", "main");
    expect(count).toBe(3);
    expect(batches.flatMap((batch) => batch.commits)).toHaveLength(3);
    expect(batches.at(-2)?.snapshot?.refTargets).toContainEqual({
      name: "main",
      oid: latestHead,
      type: "branch",
    });
    expect(batches.map((batch) => batch.sequence)).toEqual(
      batches.map((_, index) => index),
    );
  });

  it("resumes an unchanged incomplete snapshot from its committed batch", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "resumable");
    await createRepository(repositoryPath, "sha1", 300);
    let snapshot: RepositoryHistorySnapshot | undefined;
    const committed: RepositoryHistoryBatch[] = [];
    const interrupted = new RepositoryHistoryError({
      failure: { _tag: "GitFailed", reason: "Failed" },
    });

    await expect(
      Effect.runPromise(
        synchronizeRepositoryHistory(
          createLocalGitCommandRunner(),
          repositoryPath,
          {
            _tag: "SynchronizeRepositoryHistory",
            priority: "visible",
            repositoryId: environmentId,
            requestId,
          },
          (batch) => {
            if (batch.snapshot !== undefined) {
              snapshot = batch.snapshot;
            }
            if (batch.commits.length > 0) {
              committed.push(batch);
            }
            return batch.commits.length === 256
              ? Effect.fail(interrupted)
              : Effect.void;
          },
        ),
      ),
    ).rejects.toBe(interrupted);
    const captured = snapshot;
    if (captured === undefined) {
      throw new Error("Snapshot metadata was not sent");
    }
    const resumed: RepositoryHistoryBatch[] = [];

    const count = await Effect.runPromise(
      synchronizeRepositoryHistory(
        createLocalGitCommandRunner(),
        repositoryPath,
        {
          _tag: "SynchronizeRepositoryHistory",
          basis: {
            _tag: "Incomplete",
            committedCommitCount: 256,
            nextBatchSequence: 2,
            objectFormat: captured.objectFormat,
            rootOids: captured.rootOids,
            snapshotId: captured.id,
          },
          priority: "visible",
          repositoryId: environmentId,
          requestId,
        },
        (batch) =>
          Effect.sync(() => {
            resumed.push(batch);
          }),
      ),
    );

    expect(committed).toHaveLength(1);
    expect(resumed[0]?.sequence).toBe(2);
    expect(resumed.flatMap((batch) => batch.commits)).toHaveLength(44);
    expect(count).toBe(300);
  });

  it("sends only the delta for a completed basis and reconciles force resets", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "completed-basis");
    await createRepository(repositoryPath, "sha1", 3);
    await git(repositoryPath, "branch", "side", "main~1");
    const initial: RepositoryHistoryBatch[] = [];
    await runSynchronization(repositoryPath, undefined, initial);
    const initialSnapshot = lastSnapshot(initial);
    const resetTarget = await gitOutput(repositoryPath, "rev-parse", "main~1");
    await git(repositoryPath, "commit", "--allow-empty", "-m", "delta commit");
    const delta: RepositoryHistoryBatch[] = [];

    await runSynchronization(
      repositoryPath,
      {
        _tag: "Complete",
        commitCount: 3,
        objectFormat: initialSnapshot.objectFormat,
        rootOids: initialSnapshot.rootOids,
        snapshotId: initialSnapshot.id,
      },
      delta,
    );

    expect(delta.flatMap((batch) => batch.commits)).toHaveLength(1);
    expect(delta[0]?.snapshot?.resumable).toBe(false);
    const deltaSnapshot = lastSnapshot(delta);
    await git(repositoryPath, "branch", "-D", "side");
    await git(repositoryPath, "reset", "--hard", resetTarget);
    const reset: RepositoryHistoryBatch[] = [];

    await runSynchronization(
      repositoryPath,
      {
        _tag: "Complete",
        commitCount: 4,
        objectFormat: deltaSnapshot.objectFormat,
        rootOids: deltaSnapshot.rootOids,
        snapshotId: deltaSnapshot.id,
      },
      reset,
    );

    expect(reset.flatMap((batch) => batch.commits)).toEqual([]);
    expect(lastSnapshot(reset).refTargets).toContainEqual({
      name: "main",
      oid: resetTarget,
      type: "branch",
    });
    expect(
      lastSnapshot(reset).refTargets.some((target) => target.name === "side"),
    ).toBe(false);
  });

  it("rejects a resume basis whose captured roots no longer exist", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "invalid-basis");
    await createRepository(repositoryPath, "sha1", 1);

    const failure = await Effect.runPromise(
      Effect.flip(
        synchronizeRepositoryHistory(
          createLocalGitCommandRunner(),
          repositoryPath,
          {
            _tag: "SynchronizeRepositoryHistory",
            basis: {
              _tag: "Incomplete",
              committedCommitCount: 1,
              nextBatchSequence: 2,
              objectFormat: "sha1",
              rootOids: ["f".repeat(40)],
              snapshotId: "e".repeat(64),
            },
            priority: "visible",
            repositoryId: environmentId,
            requestId,
          },
          () => Effect.void,
        ),
      ),
    );

    expect(failure.failure).toEqual({ _tag: "SnapshotInvalidated" });
  });
});

async function runSynchronization(
  repositoryPath: string,
  basis: Parameters<typeof synchronizeRepositoryHistory>[2]["basis"],
  batches: RepositoryHistoryBatch[],
) {
  return Effect.runPromise(
    synchronizeRepositoryHistory(
      createLocalGitCommandRunner(),
      repositoryPath,
      {
        _tag: "SynchronizeRepositoryHistory",
        ...(basis === undefined ? {} : { basis }),
        priority: "visible",
        repositoryId: environmentId,
        requestId,
      },
      (batch) =>
        Effect.sync(() => {
          batches.push(batch);
        }),
    ),
  );
}

function lastSnapshot(batches: readonly RepositoryHistoryBatch[]) {
  const snapshot = batches.findLast((batch) => batch.snapshot)?.snapshot;
  if (snapshot === undefined) {
    throw new Error("Snapshot metadata was not sent");
  }
  return snapshot;
}

function withHistoryListener(
  use: (fixture: ListenerFixture) => Promise<void>,
  historyOverride?: RepositoryHistoryService,
  authorization: EnvironmentAuthorization = testAuthorization(),
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.promise(createTemporaryDirectory);
        const context = yield* acquireEnvironmentContext(
          environmentPaths(join(root, ".rebase")),
        );
        const catalog = createRepositoryCatalog(context);
        const history =
          historyOverride ??
          createRepositoryHistoryService({
            catalog,
            git: createLocalGitCommandRunner(),
          });
        const listener = yield* acquireEnvironmentListener({
          authorization,
          environmentId,
          events: createEnvironmentEventPublisher(),
          history,
          productVersion: "0.0.0",
        });
        listener.readiness.value = true;
        yield* Effect.promise(() =>
          use({ catalog, origin: listener.origin, root }),
        );
      }),
    ),
  );
}

async function createRepository(
  path: string,
  objectFormat: "sha1" | "sha256",
  commitCount: number,
) {
  await mkdir(path, { recursive: true });
  await git(path, "init", `--object-format=${objectFormat}`, "-b", "main");
  for (let index = 0; index < commitCount; index += 1) {
    await git(path, "commit", "--allow-empty", "-m", `commit ${index}`);
  }
}

async function createMergeRepository(path: string) {
  await mkdir(path, { recursive: true });
  await git(path, "init", "-b", "main");
  await commitFile(path, "base.txt", "base", "base");
  await git(path, "checkout", "-b", "feature");
  await commitFile(path, "feature.txt", "one", "feature one");
  await git(path, "checkout", "-b", "nested");
  await commitFile(path, "nested.txt", "nested", "nested");
  await git(path, "checkout", "feature");
  await commitFile(path, "feature.txt", "two", "feature two");
  await git(path, "merge", "--no-ff", "nested", "-m", "nested merge");
  await git(path, "checkout", "main");
  await commitFile(path, "main.txt", "main", "main");
  await git(path, "merge", "--no-ff", "feature", "-m", "feature merge");
  await git(path, "checkout", "-b", "octo-a");
  await commitFile(path, "octo-a.txt", "a", "octo a");
  await git(path, "checkout", "main");
  await git(path, "checkout", "-b", "octo-b");
  await commitFile(path, "octo-b.txt", "b", "octo b");
  await git(path, "checkout", "main");
  await git(path, "merge", "--no-ff", "octo-a", "octo-b", "-m", "octopus");
}

async function commitFile(
  path: string,
  name: string,
  value: string,
  subject: string,
) {
  await writeFile(join(path, name), value);
  await git(path, "add", name);
  await git(path, "commit", "-m", subject);
}

async function readHistoryPage(
  origin: string,
  repositoryId: string,
  oid: string,
) {
  const socket = await openHistorySocket(origin, smallFrameHello());
  const received = collectBinaryMessage(
    socket,
    createBinaryMessageReassembler(),
    [],
  );
  socket.send(
    JSON.stringify({
      _tag: "ReadRepositoryHistory",
      limit: 100,
      order: "topological",
      repositoryId,
      requestId,
      roots: [{ name: "main", oid, type: "branch" }],
    }),
  );
  const complete = await received;
  socket.close();
  return decodeRepositoryHistoryPage(complete.payload);
}

async function synchronizeHistory(origin: string, repositoryId: string) {
  const socket = await openHistorySocket(origin, smallFrameHello());
  const synchronizationRequestId = crypto.randomUUID();
  const reassembler = createBinaryMessageReassembler();
  const commits: RepositoryCommit[] = [];
  const completed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for history synchronization")),
      10_000,
    );
    socket.addEventListener("message", (event) => {
      void Promise.resolve()
        .then(async () => {
          if (typeof event.data === "string") {
            const message = JSON.parse(event.data) as {
              readonly _tag: string;
              readonly requestId?: string;
            };
            if (
              message._tag === "RepositoryHistorySynchronized" &&
              message.requestId === synchronizationRequestId
            ) {
              clearTimeout(timeout);
              resolve();
            }
            return;
          }
          const fragment = await binaryBytes(event.data);
          const message = reassembler.accept(fragment);
          if (message === undefined) {
            return;
          }
          const batch = decodeRepositoryHistoryBatch(message.payload);
          commits.push(...batch.commits);
          socket.send(
            JSON.stringify({
              _tag: "AcknowledgeRepositoryHistoryBatch",
              requestId: synchronizationRequestId,
              sequence: batch.sequence,
            }),
          );
        })
        .catch(reject);
    });
  });
  socket.send(
    JSON.stringify({
      _tag: "SynchronizeRepositoryHistory",
      priority: "visible",
      repositoryId,
      requestId: synchronizationRequestId,
    }),
  );
  await completed;
  socket.close();
  return commits;
}

function smallFrameHello(): EnvironmentHello {
  return {
    ...createCurrentEnvironmentHello("0.0.0"),
    receiveLimits: {
      maxCapturedOutputBytes: 1_048_576,
      maxHttpResponseBytes: 1_048_576,
      maxWebSocketResponseBytes: 1_024,
    },
  };
}

function emptyBatch(
  repositoryId: string,
  batchRequestId: string,
  sequence: number,
) {
  return {
    commits: [],
    objectFormat: "sha1" as const,
    repositoryId,
    requestId: batchRequestId,
    sequence,
  };
}

async function openHistorySocket(origin: string, hello: EnvironmentHello) {
  const socket = await new Promise<WebSocket>((resolveOpen, rejectOpen) => {
    const current = new WebSocket(
      `${origin.replace("http://", "ws://")}${environmentLivePath}?ticket=test-ticket`,
    );
    current.binaryType = "arraybuffer";
    current.addEventListener("open", () => resolveOpen(current), {
      once: true,
    });
    current.addEventListener(
      "error",
      () => rejectOpen(new Error("WebSocket failed")),
      { once: true },
    );
  });
  socket.send(JSON.stringify(hello));
  await nextTextMessage(socket);
  return socket;
}

function nextTextMessage(socket: WebSocket) {
  return nextMessage(socket, (data) =>
    typeof data === "string" ? data : undefined,
  );
}

function collectBinaryMessage(
  socket: WebSocket,
  reassembler: ReturnType<typeof createBinaryMessageReassembler>,
  fragments: Uint8Array[],
) {
  return new Promise<NonNullable<ReturnType<typeof reassembler.accept>>>(
    (resolveMessage, rejectMessage) => {
      const timeout = setTimeout(() => {
        cleanup();
        rejectMessage(new Error("Timed out waiting for binary history"));
      }, 10_000);
      const received = (event: MessageEvent) => {
        void binaryBytes(event.data).then(
          (fragment) => {
            fragments.push(fragment);
            const complete = reassembler.accept(fragment);
            if (complete === undefined) {
              return;
            }
            cleanup();
            resolveMessage(complete);
          },
          (error: unknown) => {
            cleanup();
            rejectMessage(error);
          },
        );
      };
      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeEventListener("message", received);
      };
      socket.addEventListener("message", received);
    },
  );
}

async function binaryBytes(data: unknown) {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new Error(`Expected binary history, received ${String(data)}`);
}

function nextMessage<T>(
  socket: WebSocket,
  select: (data: unknown) => T | undefined,
) {
  return new Promise<T>((resolveMessage, rejectMessage) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectMessage(new Error("Timed out waiting for WebSocket message"));
    }, 10_000);
    const received = (event: MessageEvent) => {
      const selected = select(event.data);
      if (selected === undefined) {
        return;
      }
      cleanup();
      resolveMessage(selected);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", received);
    };
    socket.addEventListener("message", received);
  });
}

function testAuthorization(
  capabilities: readonly EnvironmentAccessCapability[] = [
    "environment.read",
    "repository.read",
  ],
): EnvironmentAuthorization {
  const authorization = {
    capabilities,
    id: "00000000-0000-4000-8000-000000000002",
    label: "Test device",
    role: "custom" as const,
  };
  return {
    authorize: () => Effect.succeed(authorization),
    consumeTicket: () => Effect.succeed(authorization),
    createPairing: () => Effect.die("unused"),
    exchangePairing: () => Effect.die("unused"),
    mintTicket: () => Effect.die("unused"),
    revoke: () => Effect.die("unused"),
  };
}

async function git(path: string, ...arguments_: string[]) {
  await execFilePromise("git", [
    "-C",
    path,
    "-c",
    "user.name=Rebase test",
    "-c",
    "user.email=rebase@example.test",
    ...arguments_,
  ]);
}

async function gitOutput(path: string, ...arguments_: string[]) {
  const result = await execFilePromise("git", ["-C", path, ...arguments_]);
  return result.stdout.trim();
}

async function createTemporaryDirectory() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "rebase history ")),
  );
  directories.add(directory);
  return directory;
}

interface ListenerFixture {
  readonly catalog: ReturnType<typeof createRepositoryCatalog>;
  readonly origin: string;
  readonly root: string;
}
