import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  createCurrentEnvironmentHello,
  decodeRepositoryHistoryBatch,
  decodeRepositoryHistoryPage,
  type EnvironmentAccessCapability,
  type EnvironmentHello,
  maximumRepositoryHistorySequence,
  type RepositoryCommit,
  type RepositoryHistoryBatch,
  type RepositoryHistorySnapshot,
} from "@rebase/contracts";
import {
  connectEnvironment,
  fetchEnvironmentDiscovery,
} from "@rebase/web/features/environment-connection";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import {
  RepositoryHistoryError,
  type RepositoryHistoryService,
} from "#server/domain/repository-history.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import { createEnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher";
import { acquireEnvironmentListener } from "#server/features/environment-server/server/environment-listener";
import { createRepositoryCatalog } from "#server/features/repository-catalog/repository-catalog";
import { readRepositoryHistorySnapshot } from "#server/features/repository-history/git/read-repository-history-snapshot";
import { synchronizeRepositoryHistory } from "#server/features/repository-history/git/synchronize-repository-history";
import { createRepositoryHistoryService } from "#server/features/repository-history/repository-history";
import { acquireEnvironmentContext } from "#server/persistence/environment-context";
import { environmentPaths } from "#server/persistence/storage/environment-paths";

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

  it.each([
    { objectFormat: "sha1", smallFrames: false },
    { objectFormat: "sha256", smallFrames: false },
    { objectFormat: "sha1", smallFrames: true },
    { objectFormat: "sha256", smallFrames: true },
  ] as const)(
    "delivers the first 100 $objectFormat commits with small frames: $smallFrames",
    async ({ objectFormat, smallFrames }) => {
      await withHistoryListener(async ({ catalog, origin, root }) => {
        const repositoryPath = join(root, objectFormat);
        await createRepository(repositoryPath, objectFormat, 110);
        const repository = await Effect.runPromise(
          catalog.remember(repositoryPath),
        );
        const head = await gitOutput(repositoryPath, "rev-parse", "main");
        const hello = smallFrames
          ? smallFrameHello()
          : createCurrentEnvironmentHello("0.0.0");
        const page = await readHistoryPage(origin, repository.id, head, hello);
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
      const missingParent = await gitOutput(source, "rev-parse", "main~2");
      expect(page.commits.at(-1)?.parents).toEqual([missingParent]);
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
      expect(synchronized.at(-1)?.parents).toEqual([missingParent]);
    });
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
            shallowOids: captured.shallowOids ?? [],
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

  it("resumes across bounded merge pages while captured refs move", async () => {
    const root = await createTemporaryDirectory();
    const path = join(root, "bounded-resume");
    await createRepository(path, "sha1", 10_001);
    await git(path, "checkout", "-b", "side", "main~7500");
    await git(path, "commit", "--allow-empty", "-m", "side commit");
    await git(path, "checkout", "main");
    await git(path, "merge", "--no-ff", "side", "-m", "merge side");
    const initial: RepositoryHistoryBatch[] = [];
    await runSynchronization(path, undefined, initial);
    const commits = initial.flatMap((batch) => batch.commits);
    expect(commits).toHaveLength(10_003);
    expect(new Set(commits.map((commit) => commit.oid)).size).toBe(10_003);
    const expectedParents = new Map(
      (await gitOutput(path, "rev-list", "--parents", "main"))
        .split("\n")
        .map((line) => {
          const [oid, ...parents] = line.split(" ");
          return [oid, parents] as const;
        }),
    );
    const seen = new Set<string>();
    for (const commit of commits) {
      expect(commit.parents).toEqual(expectedParents.get(commit.oid));
      expect(commit.parents.some((parent) => seen.has(parent))).toBe(false);
      seen.add(commit.oid);
    }
    const prefix: RepositoryCommit[] = [];
    let nextSequence = 0;
    for (const batch of initial) {
      if (batch.commits.length === 0) continue;
      prefix.push(...batch.commits);
      nextSequence = batch.sequence + 1;
      if (prefix.length > 5_000) break;
    }
    await git(path, "commit", "--allow-empty", "-m", "new tip");
    const snapshot = lastSnapshot(initial);
    const resumed: RepositoryHistoryBatch[] = [];
    const count = await runSynchronization(
      path,
      {
        _tag: "Incomplete",
        committedCommitCount: prefix.length,
        nextBatchSequence: nextSequence,
        objectFormat: snapshot.objectFormat,
        rootOids: snapshot.rootOids,
        snapshotId: snapshot.id,
        shallowOids: snapshot.shallowOids ?? [],
      },
      resumed,
    );
    const combined = [...prefix, ...resumed.flatMap((batch) => batch.commits)];
    expect(count).toBe(10_004);
    expect(combined).toHaveLength(10_004);
    expect(new Set(combined.map((commit) => commit.oid)).size).toBe(10_004);
    expect(resumed[0]?.sequence).toBe(nextSequence);
  });

  it("rejects a legacy traversal basis before skipping any commits", async () => {
    const root = await createTemporaryDirectory();
    const path = join(root, "legacy-traversal");
    await createRepository(path, "sha1", 3);
    const snapshot = await Effect.runPromise(
      readRepositoryHistorySnapshot(createLocalGitCommandRunner(), path),
    );
    const emitted: RepositoryHistoryBatch[] = [];
    await expect(
      runSynchronization(
        path,
        {
          _tag: "Incomplete",
          committedCommitCount: 1,
          nextBatchSequence: 2,
          objectFormat: snapshot.objectFormat,
          rootOids: snapshot.rootOids,
          snapshotId: "e".repeat(64),
          shallowOids: [],
        },
        emitted,
      ),
    ).rejects.toMatchObject({ failure: { _tag: "SnapshotInvalidated" } });
    expect(emitted).toEqual([]);
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
        shallowOids: initialSnapshot.shallowOids ?? [],
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
        shallowOids: deltaSnapshot.shallowOids ?? [],
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

  it("rejects a resume that has exhausted the batch sequence", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "exhausted-sequence");
    await createRepository(repositoryPath, "sha1", 1);
    const oid = await gitOutput(repositoryPath, "rev-parse", "HEAD");
    const snapshot = await Effect.runPromise(
      readRepositoryHistorySnapshot(
        createLocalGitCommandRunner(),
        repositoryPath,
      ),
    );
    const emitted: RepositoryHistoryBatch[] = [];

    const failure = await Effect.runPromise(
      Effect.flip(
        synchronizeRepositoryHistory(
          createLocalGitCommandRunner(),
          repositoryPath,
          {
            _tag: "SynchronizeRepositoryHistory",
            basis: {
              _tag: "Incomplete",
              committedCommitCount: 0,
              nextBatchSequence: maximumRepositoryHistorySequence,
              shallowOids: [],
              objectFormat: "sha1",
              rootOids: [oid],
              snapshotId: snapshot.id,
            },
            priority: "visible",
            repositoryId: environmentId,
            requestId,
          },
          (batch) =>
            Effect.sync(() => {
              emitted.push(batch);
            }),
        ),
      ),
    );

    expect(failure.failure).toMatchObject({
      _tag: "GitFailed",
      detail: "Repository history batch sequence is exhausted",
    });
    expect(emitted).toEqual([]);
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
  const commands: string[] = [];
  for (let index = 0; index < commitCount; index += 1) {
    const subject = `commit ${index}`;
    commands.push(
      "commit refs/heads/main\n",
      `mark :${index + 1}\n`,
      `committer Rebase test <rebase@example.test> ${1_700_000_000 + index} +0000\n`,
      `data ${Buffer.byteLength(subject)}\n${subject}\n`,
      index === 0 ? "" : `from :${index}\n`,
      "\n",
    );
  }
  const imported = execFilePromise("git", [
    "-C",
    path,
    "fast-import",
    "--quiet",
  ]);
  imported.child.stdin?.end(`${commands.join("")}done\n`);
  await imported;
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
  hello = smallFrameHello(),
) {
  const connection = await connectHistory(origin, hello);
  try {
    return decodeRepositoryHistoryPage(
      await Effect.runPromise(
        connection.repositoryHistory.read({
          repositoryId,
          order: "topological",
          limit: 100,
          roots: [{ name: "main", oid, type: "branch" }],
        }),
      ),
    );
  } finally {
    connection.close();
    await Effect.runPromise(connection.closed);
  }
}

async function synchronizeHistory(origin: string, repositoryId: string) {
  const connection = await connectHistory(origin, smallFrameHello());
  const commits: RepositoryCommit[] = [];
  try {
    await Effect.runPromise(
      connection.repositoryHistory.synchronize(
        { repositoryId, priority: "visible" },
        (bytes) =>
          Effect.sync(() => {
            commits.push(...decodeRepositoryHistoryBatch(bytes).commits);
          }),
      ),
    );
    return commits;
  } finally {
    connection.close();
    await Effect.runPromise(connection.closed);
  }
}

async function connectHistory(origin: string, hello: EnvironmentHello) {
  return connectEnvironment(
    origin,
    await fetchEnvironmentDiscovery(origin),
    hello,
    { type: "bearer", value: "test" },
  );
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
    mintTicket: () =>
      Effect.succeed({
        ticket: "test-ticket-material-00000000000000000000",
        expiresAt: "2026-09-06T00:00:00.000Z",
      }),
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
