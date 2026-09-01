import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createLocalGitCommandRunner } from "@rebase/server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "@rebase/server/adapters/local-git/local-repository-watcher";
import type { GitCommandRunner } from "@rebase/server/domain/git-command.contract";
import { createEnvironmentEventPublisher } from "@rebase/server/features/environment-connection/events/environment-event-publisher";
import { createRepositoryCatalog } from "@rebase/server/features/repository-catalog/repository-catalog";
import { acquireRepositoryChangePublisher } from "@rebase/server/features/repository-refs/repository-change-publisher";
import { createRepositoryRefsService } from "@rebase/server/features/repository-refs/repository-refs";
import { acquireEnvironmentContext } from "@rebase/server/persistence/environment-context";
import { environmentPaths } from "@rebase/server/persistence/storage/environment-paths";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const execFilePromise = promisify(execFile);
const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
  directories.clear();
});

describe("repository refs", { timeout: 30_000 }, () => {
  it("reads branches with tracking, worktrees, remotes, and tags", async () => {
    const fixture = await createFixture();

    const refs = await withRefsService(fixture, ({ refs, repositoryId }) =>
      refs.read(repositoryId),
    );

    expect(refs.worktrees).toEqual([
      expect.objectContaining({
        head: expect.objectContaining({ branch: "main" }),
        main: true,
        path: fixture.repositoryPath,
      }),
      expect.objectContaining({
        head: expect.objectContaining({ branch: "topic" }),
        main: false,
        path: fixture.worktreePath,
      }),
    ]);
    expect(refs.branches).toEqual(
      expect.arrayContaining([
        {
          name: "main",
          target: expect.stringMatching(/^[0-9a-f]{40}$/),
          upstream: { ahead: 0, behind: 0, gone: false, name: "origin/main" },
          worktreePath: fixture.repositoryPath,
        },
        {
          name: "feature",
          target: expect.stringMatching(/^[0-9a-f]{40}$/),
          upstream: {
            ahead: 1,
            behind: 0,
            gone: false,
            name: "origin/feature",
          },
        },
        {
          name: "topic",
          target: expect.stringMatching(/^[0-9a-f]{40}$/),
          worktreePath: fixture.worktreePath,
        },
      ]),
    );
    expect(refs.remoteBranches).toEqual(
      expect.arrayContaining([
        {
          name: "main",
          remote: "origin",
          target: expect.stringMatching(/^[0-9a-f]{40}$/),
        },
        {
          name: "remote-only",
          remote: "origin",
          target: expect.stringMatching(/^[0-9a-f]{40}$/),
        },
      ]),
    );
    expect(refs.tags).toEqual([
      { name: "v1.0.0", target: expect.stringMatching(/^[0-9a-f]{40}$/) },
    ]);
    expect(refs.truncated).toEqual({
      branches: false,
      remoteBranches: false,
      tags: false,
    });
  });

  it("checks out a branch after stashing and restoring local changes", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.repositoryPath, "notes.md"), "draft");
    await writeFile(join(fixture.repositoryPath, "README.md"), "edited");

    const result = await withRefsService(fixture, ({ refs, repositoryId }) =>
      refs.checkout({
        repositoryId,
        target: { _tag: "LocalBranch", name: "feature" },
        worktreePath: fixture.repositoryPath,
      }),
    );

    expect(result).toMatchObject({
      head: { branch: "feature" },
      stash: "restored",
      worktreePath: fixture.repositoryPath,
    });
    await expect(
      readFile(join(fixture.repositoryPath, "notes.md"), "utf8"),
    ).resolves.toBe("draft");
    await expect(
      readFile(join(fixture.repositoryPath, "README.md"), "utf8"),
    ).resolves.toBe("edited");
    await expect(git(fixture.repositoryPath, "stash", "list")).resolves.toBe(
      "",
    );
  });

  it("restores each worktree's own auto-stash when checkouts overlap", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.repositoryPath, "README.md"), "user edit");
    await git(fixture.repositoryPath, "stash", "push", "-m", "user stash");
    await writeFile(join(fixture.repositoryPath, "README.md"), "main edit");
    await writeFile(join(fixture.worktreePath, "README.md"), "topic edit");
    await git(fixture.repositoryPath, "branch", "spare-main");
    await git(fixture.repositoryPath, "branch", "spare-topic");

    const results = await withRefsService(fixture, ({ refs, repositoryId }) =>
      Effect.all(
        [
          refs.checkout({
            repositoryId,
            target: { _tag: "LocalBranch", name: "spare-main" },
            worktreePath: fixture.repositoryPath,
          }),
          refs.checkout({
            repositoryId,
            target: { _tag: "LocalBranch", name: "spare-topic" },
            worktreePath: fixture.worktreePath,
          }),
        ],
        { concurrency: "unbounded" },
      ),
    );

    expect(results.map((result) => result.stash)).toEqual([
      "restored",
      "restored",
    ]);
    await expect(
      readFile(join(fixture.repositoryPath, "README.md"), "utf8"),
    ).resolves.toBe("main edit");
    await expect(
      readFile(join(fixture.worktreePath, "README.md"), "utf8"),
    ).resolves.toBe("topic edit");
    await expect(
      git(fixture.repositoryPath, "stash", "list", "--format=%s"),
    ).resolves.toBe("On main: user stash\n");
  });

  it("restores its own auto-stash when a foreign stash lands right after it", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.repositoryPath, "README.md"), "mine");
    const local = createLocalGitCommandRunner();
    const racing: GitCommandRunner = {
      run: (command) =>
        local.run(command).pipe(
          Effect.tap(() =>
            command.arguments[0] === "stash" && command.arguments[1] === "push"
              ? Effect.promise(async () => {
                  await writeFile(
                    join(fixture.repositoryPath, "notes.md"),
                    "theirs",
                  );
                  await git(
                    fixture.repositoryPath,
                    "stash",
                    "push",
                    "-u",
                    "-m",
                    "foreign",
                  );
                })
              : Effect.void,
          ),
        ),
    };

    const result = await withRefsService(
      fixture,
      ({ refs, repositoryId }) =>
        refs.checkout({
          repositoryId,
          target: { _tag: "LocalBranch", name: "feature" },
          worktreePath: fixture.repositoryPath,
        }),
      createEnvironmentEventPublisher(),
      racing,
    );

    expect(result).toMatchObject({
      head: { branch: "feature" },
      stash: "restored",
    });
    await expect(
      readFile(join(fixture.repositoryPath, "README.md"), "utf8"),
    ).resolves.toBe("mine");
    await expect(
      git(fixture.repositoryPath, "stash", "list", "--format=%s"),
    ).resolves.toBe("On main: foreign\n");
  });

  it("refuses to check out a branch that another worktree holds", async () => {
    const fixture = await createFixture();

    await expect(
      withRefsService(fixture, ({ refs, repositoryId }) =>
        refs.checkout({
          repositoryId,
          target: { _tag: "LocalBranch", name: "topic" },
          worktreePath: fixture.repositoryPath,
        }),
      ),
    ).rejects.toMatchObject({
      failure: {
        _tag: "BranchCheckedOutElsewhere",
        name: "topic",
        worktreePath: fixture.worktreePath,
      },
    });
  });

  it("creates a tracking branch from a remote branch and detaches on tags", async () => {
    const fixture = await createFixture();

    const results = await withRefsService(fixture, ({ refs, repositoryId }) =>
      Effect.gen(function* () {
        const tracked = yield* refs.checkout({
          repositoryId,
          target: {
            _tag: "RemoteBranch",
            name: "remote-only",
            remote: "origin",
          },
          worktreePath: fixture.repositoryPath,
        });
        const detached = yield* refs.checkout({
          repositoryId,
          target: { _tag: "Tag", name: "v1.0.0" },
          worktreePath: fixture.repositoryPath,
        });
        return { detached, refs: yield* refs.read(repositoryId), tracked };
      }),
    );

    expect(results.tracked).toMatchObject({
      head: { branch: "remote-only" },
      stash: "none",
    });
    expect(results.detached.head.branch).toBeUndefined();
    expect(results.refs.branches).toEqual(
      expect.arrayContaining([
        {
          name: "remote-only",
          target: expect.stringMatching(/^[0-9a-f]{40}$/),
          upstream: {
            ahead: 0,
            behind: 0,
            gone: false,
            name: "origin/remote-only",
          },
        },
      ]),
    );
  });

  it("detaches on a remote branch when the local branch tracks another remote", async () => {
    const fixture = await createFixture();
    await git(
      fixture.repositoryPath,
      "remote",
      "add",
      "upstream",
      fixture.originPath,
    );
    await git(fixture.repositoryPath, "fetch", "upstream");

    const result = await withRefsService(fixture, ({ refs, repositoryId }) =>
      refs.checkout({
        repositoryId,
        target: { _tag: "RemoteBranch", name: "feature", remote: "upstream" },
        worktreePath: fixture.repositoryPath,
      }),
    );

    expect(result.head.branch).toBeUndefined();
    await expect(
      git(fixture.repositoryPath, "rev-parse", "upstream/feature"),
    ).resolves.toBe(`${result.head.commit}\n`);
  });

  it("returns typed failures for unknown repositories, worktrees, and refs", async () => {
    const fixture = await createFixture();
    const missingId = "00000000-0000-4000-8000-000000000099";

    await expect(
      withRefsService(fixture, ({ refs }) => refs.read(missingId)),
    ).rejects.toMatchObject({
      failure: { _tag: "RepositoryMissing", repositoryId: missingId },
    });
    await expect(
      withRefsService(fixture, ({ refs, repositoryId }) =>
        refs.checkout({
          repositoryId,
          target: { _tag: "LocalBranch", name: "feature" },
          worktreePath: join(fixture.root, "elsewhere"),
        }),
      ),
    ).rejects.toMatchObject({
      failure: { _tag: "WorktreeMissing" },
    });
    await expect(
      withRefsService(fixture, ({ refs, repositoryId }) =>
        refs.checkout({
          repositoryId,
          target: { _tag: "LocalBranch", name: "missing" },
          worktreePath: fixture.repositoryPath,
        }),
      ),
    ).rejects.toMatchObject({
      failure: { _tag: "RefMissing", name: "missing" },
    });
  });

  it("publishes an Environment change when refs change on disk", async () => {
    const fixture = await createFixture();
    const events = createEnvironmentEventPublisher();
    const changed = vi.fn();
    events.subscribe(changed);

    await withRefsService(
      fixture,
      ({ refs, repositoryId }) =>
        Effect.gen(function* () {
          yield* refs.read(repositoryId);
          yield* Effect.promise(() =>
            git(fixture.repositoryPath, "branch", "watched-branch"),
          );
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(changed).toHaveBeenCalled(), {
              timeout: 3_000,
            }),
          );
        }),
      events,
    );

    expect(events.currentSequence()).toBeGreaterThan(0);
  });
});

function withRefsService<Value, Failure>(
  fixture: Fixture,
  use: (dependencies: {
    readonly refs: ReturnType<typeof createRepositoryRefsService>;
    readonly repositoryId: string;
  }) => Effect.Effect<Value, Failure>,
  events = createEnvironmentEventPublisher(),
  git = createLocalGitCommandRunner(),
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* acquireEnvironmentContext(
          environmentPaths(join(fixture.root, ".rebase")),
        );
        const catalog = createRepositoryCatalog(context);
        const remembered = yield* catalog.remember(fixture.repositoryPath);
        const refs = createRepositoryRefsService({
          catalog,
          changes: yield* acquireRepositoryChangePublisher(
            git,
            createLocalRepositoryWatcher(),
            events,
          ),
          git,
        });
        return yield* use({ refs, repositoryId: remembered.id });
      }),
    ),
  );
}

async function createFixture(): Promise<Fixture> {
  const root = await createTemporaryDirectory();
  const originPath = join(root, "origin.git");
  const repositoryPath = join(root, "repository");
  const worktreePath = join(root, "topic worktree");
  await mkdir(originPath);
  await git(originPath, "init", "--bare", "-b", "main");
  await mkdir(repositoryPath);
  await git(repositoryPath, "init", "-b", "main");
  await git(repositoryPath, "remote", "add", "origin", originPath);
  await writeFile(join(repositoryPath, "README.md"), "hello");
  await git(repositoryPath, "add", "README.md");
  await commit(repositoryPath, "initial");
  await git(repositoryPath, "push", "-u", "origin", "main");
  await git(repositoryPath, "tag", "v1.0.0");
  await git(repositoryPath, "checkout", "-b", "feature");
  await commit(repositoryPath, "feature base");
  await git(repositoryPath, "push", "-u", "origin", "feature");
  await commit(repositoryPath, "feature ahead");
  await git(repositoryPath, "checkout", "-b", "remote-only");
  await git(repositoryPath, "push", "-u", "origin", "remote-only");
  await git(repositoryPath, "checkout", "main");
  await git(repositoryPath, "branch", "-D", "remote-only");
  await git(repositoryPath, "worktree", "add", worktreePath, "-b", "topic");
  return { originPath, repositoryPath, root, worktreePath };
}

async function commit(path: string, message: string) {
  await git(
    path,
    "-c",
    "user.name=Rebase test",
    "-c",
    "user.email=rebase@example.test",
    "commit",
    "--allow-empty",
    "-m",
    message,
  );
}

async function git(path: string, ...arguments_: string[]) {
  const { stdout } = await execFilePromise("git", ["-C", path, ...arguments_]);
  return stdout;
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "rebase refs "));
  directories.add(directory);
  return realpath(directory);
}

interface Fixture {
  readonly originPath: string;
  readonly repositoryPath: string;
  readonly root: string;
  readonly worktreePath: string;
}
